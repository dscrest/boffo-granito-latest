"use strict";
/* CR-356 self-check: node functions/data-ops/lib/booksSync.check.js
   Pure parts only (mapping both ways, code twin, watermark picking) — the workers need Catalyst. */
const assert = require("assert");
const { contactToCustomer, customerToContact, nextCustomerCode, pickChanged, syncFromBooks, INCREMENTAL_CAP } = require("./booksSync");
const zoho = require("./zoho");

const contact = {
  contact_id: "9001",
  contact_name: "Acme Tiles",
  company_name: "Acme Tiles Pvt Ltd",
  customer_sub_type: "Business",
  currency_code: "INR",
  payment_terms_label: "Net 30",
  gst_no: "24AAAAA0000A1Z5",
  gst_treatment: "business_gst",
  place_of_contact: "GJ",
  pan_no: "AAAAA0000A",
  website: "https://acme.example",
  credit_limit: 50000,
  notes: "Key account",
  opening_balances: [{ opening_balance_amount: 1234.5 }],
  status: "active",
  billing_address: { attention: "Accounts", address: "1 Ring Rd", city: "Morbi", state: "Gujarat", zip: "363641", country: "India", phone: "" },
  shipping_address: { address: "Plot 7", city: "Morbi", country: "India" },
  contact_persons: [
    { first_name: "Ravi", last_name: "Shah", email: "ravi@acme.example", phone: "0281-1", mobile: "", is_primary_contact: true },
    { first_name: "Meena", email: "meena@acme.example", mobile: "98", is_primary_contact: false },
    { first_name: "", last_name: "", email: "" },
  ],
};
const terms = new Map([["net 30", "77"]]);

/* Books → Customer */
const p = contactToCustomer(contact, terms);
assert.strictEqual(p.books_contact_id, "9001");
assert.strictEqual(p.company_name, "Acme Tiles Pvt Ltd");
assert.strictEqual(p.customer_type, "business");
assert.strictEqual(p.payment_term, "77");
assert.strictEqual(p.gst_no, "24AAAAA0000A1Z5");
assert.strictEqual(p.gst_treatment, "business_gst");
assert.strictEqual(p.place_of_contact, "GJ");
assert.strictEqual(p.pan_no, "AAAAA0000A");
assert.strictEqual(p.website, "https://acme.example");
assert.strictEqual(p.credit_limit, "50000");
assert.strictEqual(p.notes, "Key account");
assert.strictEqual(p.opening_balance, "1234.5");
assert.strictEqual(p.active, true);
assert.strictEqual(p.contact_first_name, "Ravi");
assert.strictEqual(p.contact_email, "ravi@acme.example");
assert.strictEqual(p.billing_street1, "1 Ring Rd");
assert.strictEqual(p.billing_pincode, "363641");
assert.strictEqual(p.shipping_street1, "Plot 7");
assert.strictEqual(p.country_code, "IN");
assert.strictEqual(p.address, "Accounts, 1 Ring Rd, Morbi Gujarat 363641, India");
assert.ok(!("billing_phone" in p), "blank Books value must not be written");
assert.deepStrictEqual(JSON.parse(p.contact_persons).map((x) => x.first_name), ["Meena"]);
assert.ok(!("code" in p) && !("box_brand" in p) && !("overseas" in p), "add-on-only columns untouched");
assert.strictEqual(contactToCustomer({ contact_id: "1", contact_name: "X", status: "inactive" }).active, false);
assert.strictEqual(contactToCustomer({ contact_id: "1", contact_name: "X", opening_balance_amount: 9 }).opening_balance, "9");
assert.strictEqual(contactToCustomer({ contact_id: "1", contact_name: "X" }).company_name, "X");

/* Customer → Books (round trip of the eight + addresses + persons) */
const row = { ...p, name: "Acme Tiles", payment_term: "77", contact_persons: p.contact_persons };
const body = customerToContact(row, new Map([["77", "Net 30"]]));
assert.strictEqual(body.contact_name, "Acme Tiles");
assert.strictEqual(body.contact_type, "customer");
assert.strictEqual(body.customer_sub_type, "business");
assert.strictEqual(body.payment_terms_label, "Net 30");
assert.strictEqual(body.gst_no, "24AAAAA0000A1Z5");
assert.strictEqual(body.credit_limit, 50000);
assert.strictEqual(body.notes, "Key account");
assert.ok(!("opening_balance" in body) && !("opening_balances" in body), "opening balance never pushed");
assert.strictEqual(body.billing_address.address, "1 Ring Rd");
assert.strictEqual(body.billing_address.zip, "363641");
assert.strictEqual(body.contact_persons.length, 2);
assert.strictEqual(body.contact_persons[0].is_primary_contact, true);
assert.strictEqual(body.contact_persons[1].first_name, "Meena");
assert.strictEqual(body.contact_persons[1].mobile, "98");
assert.strictEqual(customerToContact({ company_name: "Only Co" }).contact_name, "Only Co");

/* code twin */
assert.strictEqual(nextCustomerCode(["CUS-00003", "DUMMY", "CUS-00010"]), "CUS-00011");
assert.strictEqual(nextCustomerCode([]), "CUS-00001");

/* watermark picking: list is newest first */
const t = (h) => ({ id: String(h), modified: `2026-10-21T${String(h).padStart(2, "0")}:00:00+0530` });
const list = [t(12), t(11), t(10), t(9)];
let r = pickChanged(list, "2026-10-21T10:00:00+0530", { full: false });
assert.deepStrictEqual(r.rows.map((x) => x.id), ["11", "12"], "newer than the watermark, oldest first");
assert.strictEqual(r.reachedWatermark, true);
r = pickChanged(list, "2026-10-21T13:00:00+0530", { full: false });
assert.strictEqual(r.rows.length, 0);
r = pickChanged(list, "", { full: true });
assert.strictEqual(r.rows.length, 4, "full walks the whole page");
/* CR-362: a re-run skips linked + unchanged hits (a failed page no longer costs a full redo) */
r = pickChanged(list, "2026-10-21T11:00:00+0530", { full: true, linked: new Set(["9", "10", "12"]) });
assert.deepStrictEqual(r.rows.map((x) => x.id), ["12", "11"], "12 changed since the watermark, 11 never linked");
assert.strictEqual(r.skipped, 2);
assert.deepStrictEqual(r.unchanged.map((x) => x.id), ["10", "9"], "CR-363: the skipped hits are handed back for the cheap re-check");
r = pickChanged(list, "", { full: true, linked: new Set(["9"]) });
assert.strictEqual(r.rows.length, 4, "no watermark yet = nothing is known unchanged");
const big = Array.from({ length: INCREMENTAL_CAP + 10 }, (_, i) => t(159 - i)); // newest first
r = pickChanged(big, "", { full: false });
assert.strictEqual(r.rows.length, INCREMENTAL_CAP, "capped per run");
assert.strictEqual(r.rows[0].id, "100", "cap keeps the OLDEST so the watermark advances safely");
assert.strictEqual(r.rows[r.rows.length - 1].id, "149");

/* CR-358: concurrent runs serialize (no watermark → each run = settingRows then putSetting; the two
   pairs must not interleave). Stubs the Catalyst-facing helpers on the shared zoho module. */
(async () => {
  const trace = [];
  const tick = () => new Promise((r) => setTimeout(r, 5));
  zoho.settingRows = async () => (trace.push("read"), await tick(), []);
  zoho.putSetting = async () => (trace.push("write"), await tick());
  const ctx = { catalyst: {}, rowList: (x) => x, writeOpLog: async () => {} };
  await Promise.all([syncFromBooks(ctx, { full: false }), syncFromBooks(ctx, { full: false })]);
  assert.deepStrictEqual(trace, ["read", "write", "read", "write"], "two runs never overlap");
  console.log("booksSync.check: ok");
})();
