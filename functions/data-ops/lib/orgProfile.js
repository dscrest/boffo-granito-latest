/* CR-445: Organization profile = AppSetting rows prefixed `org_` (logo, company
   name, tax ids, contact, bank). ONE allowlist shared by the public read route
   and the Admin-only write guard. Pure — no Catalyst here. */
"use strict";

const ORG_KEYS = Object.freeze([
  "org_name", "org_legal_name", "org_logo",
  "org_gstin", "org_pan", "org_iec",
  "org_address", "org_phone", "org_email", "org_website",
  "org_bank_beneficiary", "org_bank_name", "org_bank_account", "org_bank_ifsc", "org_bank_swift",
]);

const isOrgKey = (k) => String(k || "").startsWith("org_");

/** AppSetting rows → { org_name: "…", … } (only allowlisted, non-deleted, non-empty). */
function profileFromRows(rows) {
  const out = {};
  for (const r of rows || []) {
    const key = String(r.setting_key || "");
    if (!ORG_KEYS.includes(key) || r.deleted_at) continue;
    const v = String(r.setting_value ?? "").trim();
    if (v) out[key] = v;
  }
  return out;
}

module.exports = { ORG_KEYS, isOrgKey, profileFromRows };
