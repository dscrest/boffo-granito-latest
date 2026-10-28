"use strict";

/**
 * CR-359 — Zoho CRM Accounts adapter for lib/customerSync.js. The active customer source.
 *
 *   listChanged  GET /Accounts?fields=…&sort_by=Modified_Time&sort_order=desc with
 *                If-Modified-Since: <watermark> (304 = nothing changed — one cheap call).
 *                Import pages (200) run without the header and walk `page_token`s (CR-477 — page
 *                numbers stop at record 2 000; tokens reach 100 000, valid 24 h).
 *   fetch        GET /Accounts/{id} + GET /Accounts/{id}/Contacts (contact persons)
 *                + CR-362: Books GET /contacts?zcrm_account_id={id} when Books is connected — Zoho's own
 *                CRM ⇄ Books integration stamps that id, so the hit's contact_id → books_contact_id
 *                ("Synced in CRM & Books" on the customer); no hit / Books down → left as is.
 *   recheck      CR-363: Books-only lookup for accounts the import skips as unchanged but that have no
 *                Books link yet (Import all = the re-check). Books failures surface via aux.note.
 *   loadAux      PaymentTerm maps + the org's CUSTOM Account fields matched by label (GSTIN, PAN,
 *                GST treatment, place of supply, credit limit, payment term, opening balance) —
 *                CRM has no standard tax fields, so whatever the org added is picked up without
 *                configuration. Cached per warm instance for 10 min.
 *   toCustomer   Account_Name → name/company, Website, Description → notes, Billing_x / Shipping_x,
 *                first Contact → contact_* columns, the rest → contact_persons JSON, custom fields →
 *                the CR-356 columns. Non-empty values only; add-on-only columns never touched.
 *   toRecord / create / update  the reverse; Contacts are created with the account and upserted
 *                by email on update (CRM Contacts need Last_Name — the first name stands in).
 *
 * Self-check: node lib/crmSync.check.js
 */
const zoho = require("./zoho");
const core = require("./customerSync");
const { titleCase } = require("./names"); // CR-429: a pull never flips a stored name's case

const s = core.s;
const label = "Zoho CRM";
const linkColumn = "crm_account_id";

const ACCOUNT_FIELDS = ["id", "Account_Name", "Website", "Phone", "Description", "Account_Type", "Modified_Time"];
const ADDRESS_FIELDS = ["Street", "City", "State", "Code", "Country"];
const ADDRESS_MAP = [
  ["Street", "street1"],
  ["City", "city"],
  ["State", "state"],
  ["Code", "pincode"],
  ["Country", "country"],
];
const CONTACT_FIELDS = ["id", "Salutation", "First_Name", "Last_Name", "Email", "Phone", "Mobile", "Title"];

/* Custom-field detection: Customer column → label pattern (first custom field whose label matches). */
const CUSTOM_PATTERNS = [
  ["gst_no", /gstin|gst\s*(no|number|registration)/i],
  ["gst_treatment", /gst\s*treatment/i],
  ["pan_no", /\bpan\b/i],
  ["place_of_contact", /place\s*of\s*(supply|contact)/i],
  ["credit_limit", /credit\s*limit/i],
  ["payment_term", /payment\s*term/i],
  ["opening_balance", /opening\s*balance/i],
];
/** Pure: the Accounts field list → { customerColumn: api_name }. Only custom fields qualify. */
function detectCustomFields(fields) {
  const map = {};
  for (const [col, re] of CUSTOM_PATTERNS) {
    const f = (fields || []).find((x) => x && x.custom_field && re.test(s(x.field_label)));
    if (f) map[col] = s(f.api_name);
  }
  return map;
}
/* Books GST treatment codes from whatever text the CRM field holds. */
function gstTreatmentCode(v) {
  const t = s(v).toLowerCase();
  if (!t) return "";
  if (/business_gst|business_none|consumer|overseas/.test(t)) return t;
  if (/unregister/.test(t)) return "business_none";
  if (/register|regular|composition/.test(t)) return "business_gst";
  if (/consumer|individual/.test(t)) return "consumer";
  if (/overseas|export|foreign/.test(t)) return "overseas";
  return s(v);
}

/** { account, contacts, booksContactId } → Customer patch. */
function accountToCustomer({ account, contacts, booksContactId }, aux = {}) {
  const a = account || {};
  const fieldMap = aux.fieldMap || {};
  const terms = (aux.terms && aux.terms.idByLabel) || new Map();
  const out = {};
  const put = (k, v) => {
    const str = s(v);
    if (str) out[k] = str;
  };
  put("crm_account_id", a.id);
  // CR-362 — ponytail: never clears a stale Books link; add "clear when Books says none" if contacts get deleted there.
  put("books_contact_id", booksContactId);
  put("name", titleCase(a.Account_Name));
  put("company_name", titleCase(a.Account_Name));
  put("website", a.Website);
  put("notes", a.Description);
  if (a.Currency) put("currency", typeof a.Currency === "object" ? a.Currency.name : a.Currency);
  if (/individual|consumer/i.test(s(a.Account_Type))) out.customer_type = "individual";

  for (const [prefix, crm] of [["billing", "Billing"], ["shipping", "Shipping"]]) {
    for (const [from, to] of ADDRESS_MAP) put(`${prefix}_${to}`, a[`${crm}_${from}`]);
  }
  const iso = core.NAME_TO_ISO.get(s(a.Billing_Country));
  if (iso) out.country_code = iso;
  put("address", core.composeAddress({ street1: a.Billing_Street, city: a.Billing_City, state: a.Billing_State, pincode: a.Billing_Code, country: a.Billing_Country }));

  for (const [col, api] of Object.entries(fieldMap)) {
    const raw = a[api];
    const v = raw && typeof raw === "object" ? raw.name || raw.id : raw;
    if (col === "payment_term") {
      const id = terms.get(s(v).toLowerCase());
      if (id) out.payment_term = id;
    } else if (col === "gst_treatment") put(col, gstTreatmentCode(v));
    else put(col, v);
  }

  const people = (Array.isArray(contacts) ? contacts : []).map((c) => ({
    id: s(c.id),
    salutation: s(c.Salutation),
    first_name: titleCase(c.First_Name),
    last_name: titleCase(c.Last_Name),
    email: s(c.Email),
    work_phone: s(c.Phone),
    mobile: s(c.Mobile),
  }));
  const [primary, ...others] = people;
  if (primary) {
    put("contact_salutation", primary.salutation);
    put("contact_first_name", primary.first_name);
    put("contact_last_name", primary.last_name);
    put("contact_email", primary.email);
    put("contact_work_phone", primary.work_phone);
    put("contact_mobile", primary.mobile);
  } else put("contact_work_phone", a.Phone);
  const rest = others
    .map((p) => ({ salutation: p.salutation, first_name: p.first_name, last_name: p.last_name, email: p.email, work_phone: p.work_phone, mobile: p.mobile, ch_email: true, ch_sms: false }))
    .filter((p) => p.first_name || p.last_name || p.email || p.work_phone || p.mobile);
  if (rest.length) out.contact_persons = JSON.stringify(rest);
  return out;
}

/** Customer row → { account, contacts } bodies (CRM field API names). Opening balance never pushed. */
function customerToAccount(row, aux = {}) {
  const fieldMap = aux.fieldMap || {};
  const terms = (aux.terms && aux.terms.labelById) || new Map();
  const account = { Account_Name: s(row.name) || s(row.company_name) };
  const put = (k, v) => {
    const str = s(v);
    if (str) account[k] = str;
  };
  put("Website", row.website);
  put("Phone", row.contact_work_phone);
  put("Description", row.notes);
  for (const [prefix, crm] of [["billing", "Billing"], ["shipping", "Shipping"]]) {
    for (const [to, from] of ADDRESS_MAP) put(`${crm}_${to}`, row[`${prefix}_${from}`]);
  }
  for (const [col, api] of Object.entries(fieldMap)) {
    if (col === "opening_balance") continue;
    if (col === "payment_term") put(api, terms.get(s(row.payment_term)));
    else if (col === "credit_limit") {
      const n = Number(s(row.credit_limit));
      if (s(row.credit_limit) && !Number.isNaN(n)) account[api] = n;
    } else put(api, row[col]);
  }

  const contacts = [];
  const person = (p, isPrimary) => {
    const c = {
      Salutation: s(p.salutation),
      First_Name: s(p.first_name),
      Last_Name: s(p.last_name) || s(p.first_name) || (isPrimary ? account.Account_Name : ""),
      Email: s(p.email),
      Phone: s(p.work_phone),
      Mobile: s(p.mobile),
    };
    if (!(s(p.first_name) || s(p.last_name) || s(p.email) || s(p.work_phone) || s(p.mobile))) return null;
    for (const k of Object.keys(c)) if (!c[k]) delete c[k];
    return c;
  };
  const primary = person(
    { salutation: row.contact_salutation, first_name: row.contact_first_name, last_name: row.contact_last_name, email: row.contact_email, work_phone: row.contact_work_phone, mobile: row.contact_mobile },
    true,
  );
  if (primary) contacts.push(primary);
  let others = [];
  try {
    others = JSON.parse(s(row.contact_persons) || "[]");
  } catch {
    others = [];
  }
  for (const p of Array.isArray(others) ? others : []) {
    const c = person(p, false);
    if (c) contacts.push(c);
  }
  return { account, contacts };
}

/* ---------------- adapter ---------------- */
const q = (v) => encodeURIComponent(s(v));
const crm = (ctx, path, opts) => zoho.apiCall(ctx.catalyst, ctx.rowList, "crm", path, opts);

let fieldCache = null; // { at, map } — per warm instance
async function loadFieldMap(ctx) {
  if (fieldCache && Date.now() - fieldCache.at < 10 * 60_000) return fieldCache.map;
  let map = {};
  try {
    const data = await crm(ctx, "/settings/fields?module=Accounts");
    map = detectCustomFields(data.fields || []);
  } catch (e) {
    if (e && e.statusCode === 409) throw e; // reauth
    map = {}; // metadata scope missing on an old consent → standard fields only
  }
  fieldCache = { at: Date.now(), map };
  return map;
}

async function relatedContacts(ctx, id) {
  const data = await crm(ctx, `/Accounts/${q(id)}/Contacts?fields=${CONTACT_FIELDS.join(",")}&per_page=200`);
  return data.data || [];
}

/* CR-362: Zoho's CRM ⇄ Books integration stamps zcrm_account_id on the Books contact — one filtered
   list call says whether this account is also in Books. aux.books = the Books connection (null = skip).
   CR-363: ANY Books failure stops the checks for this run and is reported once via aux.note (the core
   appends it to summary.errors) — never again a silent "CRM only". */
async function booksContactFor(ctx, aux, accountId) {
  if (!aux.books) return "";
  try {
    const d = await zoho.apiCall(ctx.catalyst, ctx.rowList, "books", `/contacts?zcrm_account_id=${q(accountId)}`, { conn: aux.books });
    return s(((d.contacts || [])[0] || {}).contact_id);
  } catch (e) {
    aux.books = null;
    aux.note = `Zoho Books check stopped: ${(e && e.message) || e} — run Import all again to fill the CRM & Books status`;
    return ""; // a Books hiccup never fails the CRM record
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const adapter = {
  name: "crm",
  label,
  linkColumn,
  /* CR-477: the full import pages by `page_token` (page numbers stop at record 2 000); a token is bound
     to the request it came from, so fields / sort / per_page never change between pages. */
  async listChanged(ctx, { watermark, full, perPage, token }) {
    const fields = ["id", "Account_Name", "Modified_Time"].join(",");
    const base = `/Accounts?fields=${fields}&sort_by=Modified_Time&sort_order=desc&per_page=${perPage}`;
    const path = full && token ? `${base}&page_token=${q(token)}` : `${base}&page=1`;
    const headers = !full && watermark ? { "If-Modified-Since": watermark } : undefined;
    const data = await crm(ctx, path, { headers });
    if (data.notModified) return { hits: [], hasMore: false, next: "" };
    const info = data.info || {};
    return {
      hits: (data.data || []).map((a) => ({ id: s(a.id), name: s(a.Account_Name), modified: s(a.Modified_Time) })),
      hasMore: !!info.more_records,
      next: s(info.next_page_token),
    };
  },
  /** CR-477: which already-imported rows the import still owes a Books check (the rest cost nothing). */
  needsRecheck: (row) => !!s(row.crm_account_id) && !s(row.books_contact_id),
  async loadAux(ctx) {
    const [terms, fieldMap, books] = await Promise.all([
      core.loadTerms(ctx.catalyst, ctx.rowList),
      loadFieldMap(ctx),
      zoho.getConnection(ctx.catalyst, ctx.rowList, "books"), // CR-362: null when Books is not connected
    ]);
    return { terms, fieldMap, books };
  },
  async fetch(ctx, id, aux = {}) {
    const data = await crm(ctx, `/Accounts/${q(id)}`);
    const account = (data.data || [])[0];
    if (!account) return null;
    return { account, contacts: await relatedContacts(ctx, id), booksContactId: await booksContactFor(ctx, aux, id) };
  },
  toCustomer: accountToCustomer,
  toRecord: customerToAccount,
  /* CR-363: an already-imported, unchanged account skipped by the import still gets its Books link
     checked (one Books call, no CRM fetch) when it has none yet. Returns a Customer patch or null. */
  async recheck(ctx, aux, row) {
    if (!aux.books || s(row.books_contact_id) || !s(row.crm_account_id)) return null;
    await sleep(700); // ponytail: keeps back-to-back import pages under Books' 100 calls/min
    const id = await booksContactFor(ctx, aux, s(row.crm_account_id));
    return id ? { books_contact_id: id } : null;
  },
  async create(ctx, { account, contacts }) {
    const res = await crm(ctx, "/Accounts", { method: "POST", body: { data: [account] } });
    const id = s(res.data && res.data[0] && res.data[0].details && res.data[0].details.id);
    if (id && contacts.length) {
      await crm(ctx, "/Contacts", { method: "POST", body: { data: contacts.map((c) => ({ ...c, Account_Name: { id } })) } });
    }
    return id;
  },
  async update(ctx, id, { account, contacts }) {
    await crm(ctx, `/Accounts/${q(id)}`, { method: "PUT", body: { data: [account] } });
    if (contacts.length) {
      // Upsert by email against the related list; contacts without an email are created only when
      // the account has none yet (no safe key to match them on).
      const existing = await relatedContacts(ctx, id);
      const byEmail = new Map(existing.filter((c) => s(c.Email)).map((c) => [s(c.Email).toLowerCase(), s(c.id)]));
      const toCreate = [];
      const toUpdate = [];
      for (const c of contacts) {
        const key = s(c.Email).toLowerCase();
        if (key && byEmail.has(key)) toUpdate.push({ ...c, id: byEmail.get(key) });
        else if (key || !existing.length) toCreate.push({ ...c, Account_Name: { id } });
      }
      if (toUpdate.length) await crm(ctx, "/Contacts", { method: "PUT", body: { data: toUpdate } });
      if (toCreate.length) await crm(ctx, "/Contacts", { method: "POST", body: { data: toCreate } });
    }
    return id;
  },
  async search(ctx, term) {
    const fields = ACCOUNT_FIELDS.concat(["Billing_City"]).join(",");
    const data = term
      ? await crm(ctx, `/Accounts/search?criteria=${q(`(Account_Name:starts_with:${term.replace(/[(),\\]/g, " ")})`)}&per_page=25`)
      : await crm(ctx, `/Accounts?fields=${fields}&sort_by=Modified_Time&sort_order=desc&per_page=25`);
    return (data.data || []).map((a) => ({
      id: s(a.id),
      name: s(a.Account_Name),
      detail: s(a.Website),
      phone: s(a.Phone),
      place: s(a.Billing_City),
    }));
  },
};

module.exports = {
  ...adapter,
  ACCOUNT_FIELDS,
  ADDRESS_FIELDS,
  detectCustomFields,
  gstTreatmentCode,
  accountToCustomer,
  customerToAccount,
};
