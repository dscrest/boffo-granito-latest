/* CR-336: the guard's route classification for a create-only (Staff) role.
   Run: cd functions/data-ops && node --test lib/ */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { routeAction, hasPerm, STAFF_MATRIX } = require("./appauth");

const staff = { matrix: STAFF_MATRIX.modules };
const allowed = (path, method, body) => {
  const act = routeAction(path, method, body);
  if (!act) return "legacy";
  if (act.admin) return false;
  if (act.readonly) return true;
  return hasPerm(staff, act.module, act.action);
};

test("Staff may view and create, never edit or delete", () => {
  assert.equal(allowed("/Customer", "GET"), true);
  assert.equal(allowed("/Customer", "POST"), true);
  assert.equal(allowed("/Customer/1", "PATCH"), false);
  assert.equal(allowed("/Customer/1", "DELETE"), false);
  assert.equal(allowed("/Customer/1/restore", "POST"), false);
  assert.equal(allowed("/quote-with-items", "POST"), true);
  assert.equal(allowed("/update-quote-with-items", "POST"), false);
});

test("former legacy-fallback routes are now mapped", () => {
  assert.equal(allowed("/production-delete/1", "POST"), false);
  assert.equal(allowed("/delete-order-item/1", "POST"), false);
  assert.equal(allowed("/update-so-with-items/1", "POST"), false);
  assert.equal(allowed("/allocate-stock", "POST"), false);
  assert.equal(allowed("/load-box-delete/1", "POST"), false);
  assert.equal(allowed("/pal-line-release/1", "POST"), false); // CR-361
  assert.equal(allowed("/DISPATCH/1", "POST"), false); // case-insensitive like Express
});

test("upserts: create without rowid, edit with one", () => {
  assert.equal(allowed("/panel-order-save", "POST", {}), true);
  assert.equal(allowed("/panel-order-save", "POST", { rowid: "1" }), false);
  // CR-347: loads are an edit; removing one is a delete; the old supply route is gone.
  assert.equal(allowed("/panel-load-save", "POST", {}), false);
  assert.equal(allowed("/panel-load-delete/1", "POST", {}), false);
  assert.equal(allowed("/sample-order-save", "POST", { rowid: "1" }), false);
  assert.equal(allowed("/panel-save", "POST", {}), true);
});

test("maintenance routes are Admin-only; fit-suggest is open", () => {
  assert.equal(allowed("/renumber-loads", "POST"), false);
  assert.equal(allowed("/seed/masters", "POST"), false);
  assert.equal(allowed("/fit-suggest", "POST"), true);
  assert.equal(allowed("/Vehicle", "POST"), "legacy"); // side table → legacy fallback
});

test("Staff matrix has no edit/delete anywhere and no settings module", () => {
  for (const [mod, acts] of Object.entries(STAFF_MATRIX.modules)) {
    assert.notEqual(mod, "settings");
    assert.deepEqual(acts, ["view", "create", "export"]);
  }
});
