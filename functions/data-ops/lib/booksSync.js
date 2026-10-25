"use strict";

/**
 * CR-356/358 — Zoho Books adapter for lib/customerSync.js (CR-359 split the core out).
 * Hidden behind zoho.ACTIVE_PROVIDER = "crm" since CR-359 but fully working: the Books connection,
 * routes (/zoho/books/*), cron/webhook target and books_contact_id values all stay.
 *
 * Mapping: a Books value overwrites only where non-empty; add-on-only columns are never touched;
 * status=inactive → active=false; payment term by label; country_code from the billing country.
 * Cost: one list call per page + one GET /contacts/:id per changed contact (the list payload has no
 * addresses / contact persons). Self-check: node lib/booksSync.check.js.
 */
const zoho = require("./zoho");
const core = require("./customerSync");
const { titleCase } = require("./names"); // CR-429: a pull never flips a stored name's case

const s = core.s;
const label = "Zoho Books";
const linkColumn = "books_contact_id";

/* Books address keys → Customer address suffixes (billing_* / shipping_*). */
const ADDRESS_MAP = [
  ["attention", "attention"],
  ["country", "country"],
  ["address", "street1"],
  ["street2", "street2"],
  ["city", "city"],
  ["state", "state"],
  ["zip", "pincode"],
  ["phone", "phone"],
];
/* Books flat fields ↔ Customer columns, same name both sides (CR-356 columns). */
const FLAT = ["gst_no", "gst_treatment", "place_of_contact", "pan_no", "website", "credit_limit", "notes"];

function openingBalance(c) {
  if (c.opening_balance_amount != null && c.opening_balance_amount !== "") return s(c.opening_balance_amount);
  const ob = Array.isArray(c.opening_balances) ? c.opening_balances[0] : null;
  return ob ? s(ob.opening_balance_amount) : "";
}

/** Books contact → Customer patch (only non-empty Books values). `termIdByLabel`: lowercased
    PaymentTerm label → ROWID. (Second arg may also be the adapter `aux`.) */
function contactToCustomer(contact, termsOrAux = new Map()) {
  const termIdByLabel = termsOrAux instanceof Map ? termsOrAux : (termsOrAux.terms && termsOrAux.terms.idByLabel) || new Map();
  const out = {};
  const put = (k, v) => {
    const str = s(v);
    if (str) out[k] = str;
  };
  put("books_contact_id", contact.contact_id);
  put("name", titleCase(contact.contact_name));
  put("company_name", titleCase(contact.company_name || contact.contact_name));
  const sub = s(contact.customer_sub_type).toLowerCase();
  if (sub === "business" || sub === "individual") out.customer_type = sub;
  put("currency", contact.currency_code);
  const term = termIdByLabel.get(s(contact.payment_terms_label).toLowerCase());
  if (term) out.payment_term = term;
  for (const k of FLAT) put(k, contact[k]);
  put("opening_balance", openingBalance(contact));
  if (s(contact.status)) out.active = s(contact.status).toLowerCase() !== "inactive";

  const persons = Array.isArray(contact.contact_persons) ? contact.contact_persons : [];
  const primary = persons.find((p) => p.is_primary_contact) || contact;
  put("contact_salutation", primary.salutation);
  put("contact_first_name", titleCase(primary.first_name));
  put("contact_last_name", titleCase(primary.last_name));
  put("contact_email", primary.email);
  put("contact_work_phone", primary.phone);
  put("contact_mobile", primary.mobile);

  for (const [prefix, addr] of [["billing", contact.billing_address], ["shipping", contact.shipping_address]]) {
    for (const [from, to] of ADDRESS_MAP) put(`${prefix}_${to}`, addr && addr[from]);
  }
  const b = contact.billing_address || {};
  const iso = core.NAME_TO_ISO.get(s(b.country));
  if (iso) out.country_code = iso;
  put("address", core.composeAddress({ attention: b.attention, street1: b.address, street2: b.street2, city: b.city, state: b.state, pincode: b.zip, country: b.country }));

  const others = persons
    .filter((p) => p !== primary)
    .map((p) => ({
      salutation: s(p.salutation),
      first_name: titleCase(p.first_name),
      last_name: titleCase(p.last_name),
      email: s(p.email),
      work_phone: s(p.phone),
      mobile: s(p.mobile),
      ch_email: true,
      ch_sms: false,
    }))
    .filter((p) => p.first_name || p.last_name || p.email || p.work_phone || p.mobile);
  if (others.length) out.contact_persons = JSON.stringify(others);
  return out;
}

/** Customer row → Books contact body (POST/PUT). `termLabelById`: PaymentTerm ROWID → label.
    Opening balance is never pushed. */
function customerToContact(row, termsOrAux = new Map()) {
  const termLabelById = termsOrAux instanceof Map ? termsOrAux : (termsOrAux.terms && termsOrAux.terms.labelById) || new Map();
  const body = { contact_name: s(row.name) || s(row.company_name), contact_type: "customer" };
  const put = (k, v) => {
    const str = s(v);
    if (str) body[k] = str;
  };
  put("company_name", row.company_name);
  const sub = s(row.customer_type).toLowerCase();
  if (sub === "business" || sub === "individual") body.customer_sub_type = sub;
  put("currency_code", row.currency);
  put("payment_terms_label", termLabelById.get(s(row.payment_term)));
  for (const k of FLAT) put(k, row[k]);
  if (body.credit_limit) body.credit_limit = Number(body.credit_limit) || 0;

  const addr = (prefix) => {
    const a = {};
    for (const [to, from] of ADDRESS_MAP) {
      const v = s(row[`${prefix}_${from}`]);
      if (v) a[to] = v;
    }
    return Object.keys(a).length ? a : null;
  };
  const billing = addr("billing");
  const shipping = addr("shipping");
  if (billing) body.billing_address = billing;
  if (shipping) body.shipping_address = shipping;

  const persons = [];
  const primary = {
    salutation: s(row.contact_salutation),
    first_name: s(row.contact_first_name),
    last_name: s(row.contact_last_name),
    email: s(row.contact_email),
    phone: s(row.contact_work_phone),
    mobile: s(row.contact_mobile),
    is_primary_contact: true,
  };
  if (primary.first_name || primary.last_name || primary.email || primary.phone || primary.mobile) persons.push(primary);
  let others = [];
  try {
    others = JSON.parse(s(row.contact_persons) || "[]");
  } catch {
    others = [];
  }
  for (const p of Array.isArray(others) ? others : []) {
    const q = {
      salutation: s(p.salutation),
      first_name: s(p.first_name),
      last_name: s(p.last_name),
      email: s(p.email),
      phone: s(p.work_phone),
      mobile: s(p.mobile),
      is_primary_contact: false,
    };
    if (q.first_name || q.last_name || q.email || q.phone || q.mobile) persons.push(q);
  }
  if (persons.length) body.contact_persons = persons;
  return body;
}

/* ---------------- adapter ---------------- */
const q = (v) => encodeURIComponent(s(v));

const adapter = {
  name: "books",
  label,
  linkColumn,
  async listChanged({ catalyst, rowList }, { full, page, perPage }) {
    const list = await zoho.booksCall(
      catalyst,
      rowList,
      `/contacts?contact_type=customer&sort_column=last_modified_time&sort_order=D&per_page=${perPage}&page=${full ? page : 1}`,
    );
    return {
      hits: (list.contacts || []).map((c) => ({ id: s(c.contact_id), name: s(c.contact_name), modified: s(c.last_modified_time) })),
      hasMore: !!(list.page_context && list.page_context.has_more_page),
    };
  },
  async loadAux({ catalyst, rowList }) {
    return { terms: await core.loadTerms(catalyst, rowList) };
  },
  async fetch({ catalyst, rowList }, id) {
    return (await zoho.booksCall(catalyst, rowList, `/contacts/${q(id)}`)).contact || null;
  },
  toCustomer: contactToCustomer,
  toRecord: customerToContact,
  async create({ catalyst, rowList }, body) {
    const data = await zoho.booksCall(catalyst, rowList, "/contacts", { method: "POST", body });
    return s(data.contact && data.contact.contact_id);
  },
  async update({ catalyst, rowList }, id, body) {
    await zoho.booksCall(catalyst, rowList, `/contacts/${q(id)}`, { method: "PUT", body });
    return id;
  },
  async search({ catalyst, rowList }, term) {
    const filter = term ? `&contact_name_contains=${q(term)}` : "";
    const data = await zoho.booksCall(catalyst, rowList, `/contacts?contact_type=customer&per_page=25${filter}`);
    return (data.contacts || []).map((c) => ({
      id: s(c.contact_id),
      name: s(c.contact_name),
      detail: s(c.company_name) || s(c.email),
      phone: s(c.phone),
      place: s(c.gst_no) || (s(c.status) === "active" ? "" : s(c.status)),
    }));
  },
};

/* Legacy names (callers + booksSync.check.js). */
const syncFromBooks = (ctx, opts) => core.sync(ctx, adapter, opts);
const pushToBooks = (ctx, rowid) => core.push(ctx, adapter, rowid);
const lastSummary = (catalyst, rowList) => core.lastSummary(catalyst, rowList, adapter);

module.exports = {
  ...adapter,
  INCREMENTAL_CAP: core.INCREMENTAL_CAP,
  IMPORT_PAGE: core.IMPORT_PAGE,
  contactToCustomer,
  customerToContact,
  nextCustomerCode: core.nextCustomerCode,
  pickChanged: core.pickChanged,
  lastSummary,
  syncFromBooks,
  pushToBooks,
};
