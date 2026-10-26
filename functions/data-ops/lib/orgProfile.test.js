/* CR-445 org profile allowlist. Run: node --test functions/data-ops/lib/*.test.js */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ORG_KEYS, isOrgKey, profileFromRows } = require("./orgProfile");

test("maps only allowlisted, live, non-empty rows", () => {
  const rows = [
    { setting_key: "org_name", setting_value: " Acme " },
    { setting_key: "org_gstin", setting_value: "" },
    { setting_key: "org_pan", setting_value: "ABCDE1234F", deleted_at: "2026-01-01" },
    { setting_key: "zoho_books_refresh_token", setting_value: "secret" },
    { setting_key: "org_not_a_field", setting_value: "x" },
  ];
  assert.deepEqual(profileFromRows(rows), { org_name: "Acme" });
  assert.deepEqual(profileFromRows(undefined), {});
});

test("every org_ key is admin-only, nothing else matches", () => {
  for (const k of ORG_KEYS) assert.equal(isOrgKey(k), true);
  assert.equal(isOrgKey("allow_duplicate_batches"), false);
  assert.equal(isOrgKey(undefined), false);
});
