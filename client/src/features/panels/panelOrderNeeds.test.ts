/* Self-check for panelOrderNeeds — run with:  npx tsx client/src/features/panels/panelOrderNeeds.test.ts
   Plain asserts, no framework (same style as newLoadingRows.test.ts). */
import assert from "node:assert";
import { allocatedByKey, demandByKey, panelWeight, readiness, requirementsFor, shortagesFor, stockKey } from "./panelOrderNeeds";
import type { PanelRow } from "./panelsApi";

const panel = (id: string, lines: { d: string; c: string; q: number }[]): PanelRow =>
  ({
    id,
    panelCode: id,
    panelSize: "",
    vinylSize: "",
    images: [],
    createdTime: "",
    modifiedTime: "",
    lines: lines.map((l, i) => ({ id: `${id}-${i}`, designId: l.d, designName: l.d, sizeLabel: "", cutSizeId: l.c, cutSizeName: l.c, qty: l.q })),
  }) as PanelRow;

const panels = new Map([
  ["A", panel("A", [{ d: "grey", c: "300x300", q: 2 }, { d: "ivory", c: "600x300", q: 1 }])],
  ["B", panel("B", [{ d: "grey", c: "300x300", q: 3 }])],
]);
const stock = new Map([[stockKey("grey", "300x300"), 10]]);

// Two panels sharing a design × cut size sum into one requirement; order qty multiplies.
const reqs = requirementsFor([{ panelId: "A", qty: 2 }, { panelId: "B", qty: 1 }], panels, stock);
assert.strictEqual(reqs.length, 2);
const grey = reqs.find((r) => r.key === stockKey("grey", "300x300"))!;
assert.strictEqual(grey.need, 2 * 2 + 3 * 1);
assert.strictEqual(grey.have, 10);
assert.strictEqual(grey.short, false);
// CR-303: each row names the panels it serves and their share of the need.
assert.deepStrictEqual(grey.panels, [{ panelId: "A", panelCode: "A", qty: 4 }, { panelId: "B", panelCode: "B", qty: 3 }]);
const ivory = reqs.find((r) => r.key === stockKey("ivory", "600x300"))!;
assert.strictEqual(ivory.need, 2);
assert.strictEqual(ivory.have, 0);
assert.strictEqual(ivory.short, true);

// Only the short rows come back from shortagesFor; a qty bump flips grey short too.
assert.deepStrictEqual(shortagesFor([{ panelId: "A", qty: 2 }, { panelId: "B", qty: 1 }], panels, stock).map((r) => r.key), [ivory.key]);
assert.strictEqual(shortagesFor([{ panelId: "B", qty: 4 }], panels, stock).length, 1);

// Unknown panels and empty lines are ignored.
assert.deepStrictEqual(requirementsFor([{ panelId: "nope", qty: 5 }], panels, stock), []);
assert.deepStrictEqual(requirementsFor([], panels, stock), []);

// CR-309: panel weight = Σ piece weight × pieces + MDF; any unknown piece → null.
{
  const w = new Map<string, number | null>([[stockKey("grey", "300x300"), 1.5], [stockKey("ivory", "600x300"), 4]]);
  assert.strictEqual(panelWeight(panels.get("A")!, w, 6), 2 * 1.5 + 1 * 4 + 6);
  assert.strictEqual(panelWeight(panels.get("B")!, w, null), 4.5, "no MDF picked = pieces only");
  assert.strictEqual(panelWeight(panels.get("A")!, new Map([[stockKey("grey", "300x300"), 1.5]]), 6), null, "an unweighed piece makes the panel unknown");
}

console.log("panelOrderNeeds: all checks passed");

// CR-312: booking — free = on hand − every open order's booking; toCut = need − allocated − free.
{
  const orders = [
    { id: "o1", orderNumber: "PNL/1", status: "Received", lines: [{ panelId: "B", qty: 2 }], allocation: { [stockKey("grey", "300x300")]: 6 } },
    { id: "o2", orderNumber: "PNL/2", status: "InCutting", lines: [{ panelId: "A", qty: 1 }], allocation: { [stockKey("grey", "300x300")]: 2 } },
    { id: "o3", orderNumber: "PNL/3", status: "Dispatched", lines: [{ panelId: "A", qty: 9 }], allocation: { [stockKey("grey", "300x300")]: 99 } },
    { id: "o4", orderNumber: "PNL/4", status: "NewRequest", lines: [{ panelId: "A", qty: 1 }], allocation: {} },
  ];
  const booked = allocatedByKey(orders);
  assert.strictEqual(booked.get(stockKey("grey", "300x300")), 8, "dispatched + unaccepted orders do not count");
  // o1 needs 6 grey, booked 6 → nothing to cut; free = 10 − 8 = 2.
  const r1 = requirementsFor(orders[0].lines, panels, stock, { allocation: orders[0].allocation, booked })[0];
  assert.strictEqual(r1.allocated, 6);
  assert.strictEqual(r1.free, 2);
  assert.strictEqual(r1.toCut, 0);
  // o2 needs 2 grey (booked 2) + 1 ivory (none in stock) → ivory toCut 1.
  const r2 = requirementsFor(orders[1].lines, panels, stock, { allocation: orders[1].allocation, booked });
  assert.strictEqual(r2.find((r) => r.designId === "ivory")!.toCut, 1);
  assert.strictEqual(r2.find((r) => r.designId === "grey")!.toCut, 0);
  // Without booking info the old meaning holds: toCut = need − have.
  assert.strictEqual(requirementsFor([{ panelId: "B", qty: 4 }], panels, stock)[0].toCut, 2);
  // Pending Cut Stock: demand over every non-dispatched order (+ stock-only keys).
  const d = demandByKey(orders, panels, stock, [stockKey("beige", "300x300")]);
  const grey = d.find((r) => r.key === stockKey("grey", "300x300"))!;
  assert.strictEqual(grey.required, 6 + 2 + 2, "o1 + o2 + o4 (new request counts as demand)");
  assert.strictEqual(grey.onHand, 10);
  assert.strictEqual(grey.allocated, 8);
  assert.strictEqual(grey.free, 2);
  assert.strictEqual(grey.shortage, 0);
  assert.deepStrictEqual(grey.orders.map((o) => o.orderNumber), ["PNL/1", "PNL/2", "PNL/4"]);
  const ivory = d.find((r) => r.designId === "ivory")!;
  assert.strictEqual(ivory.required, 2);
  assert.strictEqual(ivory.shortage, 2);
  const beige = d.find((r) => r.designId === "beige")!;
  assert.strictEqual(beige.required, 0, "stock-only row shows up with zero demand");
  assert.strictEqual(beige.onHand, 0);
}

// CR-313: readiness is derived from the three marks; dispatched orders read "—".
{
  assert.strictEqual(readiness({}, "Received"), "Pending");
  assert.strictEqual(readiness({ mdf: { status: "Ordered", by: "x", at: "" } }, "Received"), "In Progress");
  const all = { mdf: { status: "Ready", by: "", at: "" }, vinyl: { status: "Ready", by: "", at: "" }, cut: { status: "Ready", by: "", at: "" } };
  assert.strictEqual(readiness(all, "InCutting"), "Ready for Production");
  assert.strictEqual(readiness({ ...all, cut: { status: "Pending", by: "", at: "" } }, "InCutting"), "In Progress");
  assert.strictEqual(readiness(all, "Dispatched"), "—");
}

console.log("panelOrderNeeds: booking + readiness checks passed");
