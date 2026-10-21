"use strict";
/* CR-359 self-check: node functions/data-ops/lib/crmSync.check.js — pure parts only. */
const assert = require("assert");
const { detectCustomFields, gstTreatmentCode, accountToCustomer, customerToAccount } = require("./crmSync");

/* custom-field detection on a fake Accounts field list */
const fields = [
  { api_name: "Account_Name", field_label: "Account Name", custom_field: false },
  { api_name: "GSTIN", field_label: "GSTIN", custom_field: true },
  { api_name: "PAN_Number", field_label: "PAN Number", custom_field: true },
  { api_name: "GST_Treatment", field_label: "GST Treatment", custom_field: true },
  { api_name: "Place_of_Supply", field_label: "Place of Supply", custom_field: true },
  { api_name: "Credit_Limit", field_label: "Credit Limit", custom_field: true },
  { api_name: "Payment_Terms", field_label: "Payment Terms", custom_field: true },
  { api_name: "Company_Pan", field_label: "Company PAN (old)", custom_field: false }, // standard-flagged → ignored
];
const fieldMap = detectCustomFields(fields);
assert.deepStrictEqual(fieldMap, {
  gst_no: "GSTIN",
  gst_treatment: "GST_Treatment",
  pan_no: "PAN_Number",
  place_of_contact: "Place_of_Supply",
  credit_limit: "Credit_Limit",
  payment_term: "Payment_Terms",
});
assert.deepStrictEqual(detectCustomFields([]), {});

/* gst treatment normalisation */
assert.strictEqual(gstTreatmentCode("Registered Business - Regular"), "business_gst");
assert.strictEqual(gstTreatmentCode("Unregistered Business"), "business_none");
assert.strictEqual(gstTreatmentCode("Consumer"), "consumer");
assert.strictEqual(gstTreatmentCode("Overseas"), "overseas");
assert.strictEqual(gstTreatmentCode("business_none"), "business_none");
assert.strictEqual(gstTreatmentCode("SEZ"), "SEZ", "unknown text passes through");

/* Account + Contacts → Customer */
const aux = { fieldMap, terms: { idByLabel: new Map([["net 30", "77"]]), labelById: new Map([["77", "Net 30"]]) } };
const record = {
  account: {
    id: "4876876000000123456",
    Account_Name: "Acme Tiles",
    Website: "https://acme.example",
    Phone: "0281-1",
    Description: "Key account",
    Account_Type: "Customer",
    Billing_Street: "1 Ring Rd",
    Billing_City: "Morbi",
    Billing_State: "Gujarat",
    Billing_Code: "363641",
    Billing_Country: "India",
    Shipping_Street: "Plot 7",
    Shipping_City: "Morbi",
    GSTIN: "24AAAAA0000A1Z5",
    PAN_Number: "AAAAA0000A",
    GST_Treatment: "Registered Business - Regular",
    Place_of_Supply: "GJ",
    Credit_Limit: 50000,
    Payment_Terms: "Net 30",
    Modified_Time: "2026-10-21T10:00:00+05:30",
  },
  contacts: [
    { id: "1", Salutation: "Mr.", First_Name: "Ravi", Last_Name: "Shah", Email: "ravi@acme.example", Phone: "0281-2", Mobile: "" },
    { id: "2", First_Name: "Meena", Last_Name: "Patel", Email: "meena@acme.example", Mobile: "98" },
  ],
};
const p = accountToCustomer(record, aux);
assert.strictEqual(p.crm_account_id, "4876876000000123456");
assert.strictEqual(p.name, "Acme Tiles");
assert.strictEqual(p.company_name, "Acme Tiles");
assert.strictEqual(p.website, "https://acme.example");
assert.strictEqual(p.notes, "Key account");
assert.ok(!("customer_type" in p), "Account_Type Customer leaves customer_type alone");
assert.strictEqual(p.billing_street1, "1 Ring Rd");
assert.strictEqual(p.billing_pincode, "363641");
assert.strictEqual(p.shipping_street1, "Plot 7");
assert.strictEqual(p.country_code, "IN");
assert.strictEqual(p.address, "1 Ring Rd, Morbi Gujarat 363641, India");
assert.strictEqual(p.gst_no, "24AAAAA0000A1Z5");
assert.strictEqual(p.pan_no, "AAAAA0000A");
assert.strictEqual(p.gst_treatment, "business_gst");
assert.strictEqual(p.place_of_contact, "GJ");
assert.strictEqual(p.credit_limit, "50000");
assert.strictEqual(p.payment_term, "77", "payment term by label");
assert.strictEqual(p.contact_first_name, "Ravi", "first related contact = primary");
assert.strictEqual(p.contact_work_phone, "0281-2", "contact phone wins over account phone");
assert.deepStrictEqual(JSON.parse(p.contact_persons).map((x) => x.first_name), ["Meena"]);
assert.ok(!("code" in p) && !("box_brand" in p) && !("overseas" in p) && !("opening_balance" in p), "add-on-only columns untouched");
/* CR-362: Books link rides along when Books confirms it, never written blank */
assert.ok(!("books_contact_id" in p), "no Books hit → books_contact_id untouched");
assert.strictEqual(accountToCustomer({ ...record, booksContactId: "55" }, aux).books_contact_id, "55");
const bare = accountToCustomer({ account: { id: "9", Account_Name: "Solo", Phone: "123", Account_Type: "Individual" }, contacts: [] }, {});
assert.strictEqual(bare.contact_work_phone, "123", "account phone used when no contacts");
assert.strictEqual(bare.customer_type, "individual");
assert.ok(!("billing_street1" in bare));

/* Customer → Account + Contacts (round trip) */
const row = { ...p, payment_term: "77" };
const { account, contacts } = customerToAccount(row, aux);
assert.strictEqual(account.Account_Name, "Acme Tiles");
assert.strictEqual(account.Website, "https://acme.example");
assert.strictEqual(account.Description, "Key account");
assert.strictEqual(account.Billing_Street, "1 Ring Rd");
assert.strictEqual(account.Billing_Code, "363641");
assert.strictEqual(account.Shipping_Street, "Plot 7");
assert.strictEqual(account.GSTIN, "24AAAAA0000A1Z5");
assert.strictEqual(account.PAN_Number, "AAAAA0000A");
assert.strictEqual(account.Credit_Limit, 50000, "credit limit pushed as a number");
assert.strictEqual(account.Payment_Terms, "Net 30");
assert.ok(!("Opening_Balance" in account));
assert.strictEqual(contacts.length, 2);
assert.strictEqual(contacts[0].Last_Name, "Shah");
assert.strictEqual(contacts[0].Phone, "0281-2");
assert.strictEqual(contacts[1].Email, "meena@acme.example");
const solo = customerToAccount({ name: "Solo Co", contact_first_name: "Anu" }, {});
assert.strictEqual(solo.contacts[0].Last_Name, "Anu", "CRM Contacts need Last_Name — first name stands in");
assert.deepStrictEqual(customerToAccount({ company_name: "Only Co" }, {}), { account: { Account_Name: "Only Co" }, contacts: [] });

console.log("crmSync.check: ok");
