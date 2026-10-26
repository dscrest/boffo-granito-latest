"use strict";
/* CR-429 — human-entered NAMES are stored Title Case, once, at the server.
   Rule: every word capitalised, rest lower-cased; a word typed ALL-CAPS with ≤3
   letters is kept as typed (ABC, MDF, A12); legal suffixes are always upper
   (LLP, LLC, LTD, PVT, INC, PLC, FZE, FZCO, GMBH). Mirror: client/src/lib/format.ts
   titleCase (the Item form needs the same text for unique_name / the SKU segment).
   ponytail: whitespace words only — "o'brien" → "O'brien"; add '/- splitting if a
   real name needs it. */

const UPPER = new Set(["LLP", "LLC", "LTD", "PVT", "INC", "PLC", "FZE", "FZCO", "GMBH"]);
const keep = (w) => w.length <= 3 && w === w.toUpperCase() && /[A-Z]/.test(w);

function titleCase(s) {
  return String(s == null ? "" : s)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const bare = w.replace(/[.,]+$/, "");
      if (UPPER.has(bare.toUpperCase())) return w.toUpperCase();
      return keep(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/* Which columns per table. Deliberately NOT here: Size.name, every code / seq_code,
   Currency, CutPieceSize, Mdf, unique_name / sku, vehicle_number (UPPER), ports,
   LoadBox.name / destination, performed_by. Warehouse locations (A1…F12) pass
   through `keep`. */
const NAME_COLUMNS = {
  Customer: ["name", "company_name", "main_party_name", "contact_first_name", "contact_last_name", "billing_attention", "shipping_attention"],
  // CR-447: collection_name (Marketing data) was missed by CR-429.
  Design: ["design_name", "base_design_name", "party_brand_name", "collection_name"],
  Vehicle: ["driver_name"],
  Container: ["vessel_name"],
  AppUser: ["name"],
  SalesPerson: ["name"],
  Brand: ["name"],
  PartyBrand: ["name"],
  Finish: ["name"],
  Category: ["name"],
  Glaze: ["name"],
  Grade: ["name"],
  Series: ["name"],
  Catalogue: ["name"],
  Punch: ["name"],
  SurfaceApplication: ["name"],
  Pallet: ["name"],
  Warehouse: ["name"],
  AdjustmentReason: ["name"],
  PaymentTerm: ["name"],
};

const PERSON_KEYS = ["name", "first_name", "last_name"];
// Customer JSON columns whose entries carry a name key (CR-447: additional_addresses.attention joined contact_persons).
const JSON_NAME_KEYS = { contact_persons: PERSON_KEYS, additional_addresses: ["attention"] };

/** Title-case the name keys inside a JSON-array column, in place; a non-JSON value is left as typed. */
function normalizeJsonNames(row, col, keys) {
  if (typeof row[col] !== "string" || !row[col].trim()) return;
  try {
    const arr = JSON.parse(row[col]);
    if (!Array.isArray(arr)) return;
    for (const p of arr) if (p && typeof p === "object") for (const k of keys) if (typeof p[k] === "string") p[k] = titleCase(p[k]);
    row[col] = JSON.stringify(arr);
  } catch (_) {
    /* not JSON — leave as typed */
  }
}

/** Title-case the name columns of `row` in place (only string values present on the row). */
function normalizeNames(table, row) {
  if (!row || typeof row !== "object") return row;
  for (const c of NAME_COLUMNS[table] || []) if (typeof row[c] === "string") row[c] = titleCase(row[c]);
  if (table === "Customer") for (const [col, keys] of Object.entries(JSON_NAME_KEYS)) normalizeJsonNames(row, col, keys);
  return row;
}

/* Self-check: `node lib/names.js` */
if (require.main === module) {
  const assert = require("assert");
  assert.strictEqual(titleCase("dhiraj SHAH of ABC exports llp"), "Dhiraj Shah Of ABC Exports LLP");
  assert.strictEqual(titleCase("  a12 "), "A12");
  assert.strictEqual(titleCase("MAIN GODOWN"), "Main Godown");
  assert.strictEqual(titleCase("acme pvt. ltd."), "Acme PVT. LTD.");
  assert.strictEqual(titleCase("MDF board"), "MDF Board");
  assert.strictEqual(titleCase(""), "");
  assert.strictEqual(titleCase(null), "");
  const r = normalizeNames("Customer", { name: "boffo granito", code: "bg01", contact_persons: JSON.stringify([{ first_name: "ravi", last_name: "PATEL" }]) });
  assert.strictEqual(r.name, "Boffo Granito");
  assert.strictEqual(r.code, "bg01");
  assert.deepStrictEqual(JSON.parse(r.contact_persons), [{ first_name: "Ravi", last_name: "Patel" }]);
  assert.strictEqual(normalizeNames("Size", { name: "600x600" }).name, "600x600");
  // CR-447
  assert.strictEqual(normalizeNames("Design", { collection_name: "summer COLLECTION", sku: "ab-01" }).collection_name, "Summer Collection");
  assert.strictEqual(normalizeNames("Container", { vessel_name: "maersk hangzhou", container_number: "MSKU1234567" }).vessel_name, "Maersk Hangzhou");
  const a = normalizeNames("Customer", { additional_addresses: JSON.stringify([{ type: "shipping", attention: "ravi PATEL", city: "morbi" }]) });
  assert.deepStrictEqual(JSON.parse(a.additional_addresses), [{ type: "shipping", attention: "Ravi Patel", city: "morbi" }]);
  console.log("names.js ok");
}

module.exports = { titleCase, normalizeNames, NAME_COLUMNS };
