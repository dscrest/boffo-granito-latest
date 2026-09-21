/* SO status roll-up (CR-230) — pure. The SalesOrder status is the order
   LIFECYCLE only (CR-233): dispatch closes it as Partially Completed /
   Completed. Palletization + loading progress are their own grid columns,
   derived client-side from the counters — never an SO status. Only statuses
   in SO_RANK are auto-managed; approval states and Cancelled are never touched.
   InPalletization / InLoading stay ranked only so a row that got one during
   the short CR-230 window can still promote to Completed. */
const SO_RANK = { Confirmed: 0, InProgress: 1, InPalletization: 2, InLoading: 3, PartiallyCompleted: 4, Completed: 5 };

/** t = { ordered, dispatched } summed over ALL the SO's lines. */
function deriveSoStatus(t) {
  if (t.dispatched > 0) return t.dispatched >= t.ordered ? "Completed" : "PartiallyCompleted";
  return null;
}

/** The status to write, or null to leave it. Promote-only unless allowDemote
    (an SO edit), so a manual "Completed" on a partial order sticks. */
function nextSoStatus(current, t, allowDemote) {
  if (!(current in SO_RANK)) return null;
  const derived = deriveSoStatus(t);
  if (!derived || derived === current) return null;
  return allowDemote || SO_RANK[derived] > SO_RANK[current] ? derived : null;
}

module.exports = { SO_RANK, deriveSoStatus, nextSoStatus };

if (require.main === module) {
  const assert = require("assert");
  const t = (o) => ({ ordered: 1000, dispatched: 0, ...o });
  assert.equal(deriveSoStatus(t({})), null);
  assert.equal(nextSoStatus("InLoading", t({ dispatched: 1000 })), "Completed"); // CR-230-window row still closes
  assert.equal(deriveSoStatus(t({ dispatched: 400 })), "PartiallyCompleted");
  assert.equal(deriveSoStatus(t({ dispatched: 1000 })), "Completed");
  assert.equal(nextSoStatus("Confirmed", t({ dispatched: 400 })), "PartiallyCompleted");
  assert.equal(nextSoStatus("Completed", t({ dispatched: 400 })), null); // manual Completed sticks
  assert.equal(nextSoStatus("Completed", t({ dispatched: 400 }), true), "PartiallyCompleted"); // edit 400→1000
  assert.equal(nextSoStatus("Draft", t({ dispatched: 1000 })), null);
  assert.equal(nextSoStatus("Cancelled", t({ dispatched: 1000 }), true), null);
  console.log("soStatus ok");
}
