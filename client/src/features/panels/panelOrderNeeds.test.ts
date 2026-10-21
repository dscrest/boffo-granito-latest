/* Self-check for panelOrderNeeds — run with:  npx tsx client/src/features/panels/panelOrderNeeds.test.ts
   Plain asserts, no framework (same style as newLoadingRows.test.ts). */
import assert from "node:assert";
import {
  allocatedByKey,
  demandByKey,
  lineWeightSplit,
  loadingStatus,
  loadProgress,
  mdfLabel,
  panelWeight,
  panelWeightSplit,
  pendingNeedLines,
  pendingText,
  readiness,
  requirementsFor,
  shortagesFor,
  stockKey,
} from "./panelOrderNeeds";
import type { PanelRow } from "./panelsApi";

const panel = (id: string, lines: { d: string; c: string; q: number }[]): PanelRow =>
  ({
    id,
    panelCode: id,
    panelSize: "",
    vinylSize: "",
    mdfSize: "",
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

// CR-344: the MDF label comes from the size-keyed master row the line picked.
{
  const p: PanelRow = { ...panels.get("A")!, mdfSize: "1200x2400" };
  const m8 = { id: "m8", size: "1200x2400", thickness: "8 mm", weightKg: 5.5, label: "1200x2400 · 8 mm" };
  assert.strictEqual(mdfLabel(m8), "1200x2400 · 8 mm");
  assert.strictEqual(mdfLabel(undefined), "");
  const w = new Map<string, number | null>([[stockKey("grey", "300x300"), 1.5], [stockKey("ivory", "600x300"), 4]]);
  assert.strictEqual(panelWeight(p, w, m8.weightKg), 2 * 1.5 + 1 * 4 + 5.5, "order weight = pieces + the picked thickness's board");
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

// CR-313: readiness is derived from the marks (four since CR-323); dispatched orders read "—".
{
  assert.strictEqual(readiness({}, "Received"), "Pending");
  assert.strictEqual(readiness({ mdf: { status: "Ordered", by: "x", at: "" } }, "Received"), "In Progress");
  const three = { mdf: { status: "Ready", by: "", at: "" }, vinyl: { status: "Ready", by: "", at: "" }, cut: { status: "Ready", by: "", at: "" } };
  assert.strictEqual(readiness(three, "InCutting"), "In Progress", "CR-323: three Ready without pasted is not ready");
  const all = { ...three, pasted: { status: "Ready", by: "", at: "" } };
  assert.strictEqual(readiness(all, "InCutting"), "Ready for Production");
  assert.strictEqual(readiness({ ...all, cut: { status: "Pending", by: "", at: "" } }, "InCutting"), "In Progress");
  assert.strictEqual(readiness(all, "Dispatched"), "—");
}

console.log("panelOrderNeeds: booking + readiness checks passed");

// CR-346: a loose cut-piece line needs its own pieces — one per unit — beside the panels.
{
  const r = requirementsFor([{ panelId: "B", qty: 1 }, { panelId: "", qty: 20, designId: "grey", cutSizeId: "300x300", designName: "Grey", cutSizeName: "300x300" }], panels, stock);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].need, 3 + 20);
  assert.deepStrictEqual(r[0].panels, [{ panelId: "B", panelCode: "B", qty: 3 }, { panelId: "", panelCode: "Cut piece", qty: 20 }]);
  assert.strictEqual(requirementsFor([{ panelId: "", qty: 5 }], panels, stock).length, 0, "a cut line without design/cut size needs nothing");
}

// CR-347: loads → progress per line × material, derived Loading Status, pending text, pending needs.
{
  const lines = [
    { id: "L1", qty: 3, panelId: "A", mdfId: "m8" },
    { id: "L2", qty: 2, panelId: "B" }, // no board picked → no MDF material
    { id: "L3", qty: 20, panelId: "", designId: "grey", cutSizeId: "300x300" },
  ];
  const none = loadProgress(lines, []);
  assert.deepStrictEqual(none.map((r) => `${r.lineId}|${r.material}`), ["L1|Panel", "L1|Mdf", "L2|Panel", "L3|Item"]);
  assert.strictEqual(loadingStatus(none), "Not loaded");
  assert.strictEqual(pendingText(none), "5 panels · 3 MDF · 20 pcs");
  const partial = loadProgress(lines, [{ id: "ld1", lines: [{ lineId: "L1", material: "Mdf", qty: 3, weightKg: 16.5 }, { lineId: "L3", material: "Item", qty: 8, weightKg: 12 }] }]);
  assert.strictEqual(loadingStatus(partial), "Partially loaded");
  assert.strictEqual(pendingText(partial), "5 panels · 12 pcs", "MDF fully loaded drops out; 12 pcs remain");
  const full = loadProgress(lines, [
    { id: "ld1", lines: [{ lineId: "L1", material: "Mdf", qty: 3, weightKg: 16.5 }, { lineId: "L3", material: "Item", qty: 20, weightKg: 30 }] },
    { id: "ld2", lines: [{ lineId: "L1", material: "Panel", qty: 3, weightKg: null }, { lineId: "L2", material: "Panel", qty: 2, weightKg: 9 }] },
  ]);
  assert.strictEqual(loadingStatus(full), "Loaded");
  assert.strictEqual(pendingText(full), "");
  assert.strictEqual(loadingStatus([], "Dispatched"), "Loaded", "a legacy Dispatched order with no loads reads Loaded");
  // Pending need lines shrink with the Panel / Item material only (MDF never touches cut stock).
  const pend = pendingNeedLines(lines, [{ id: "ld1", lines: [{ lineId: "L1", material: "Mdf", qty: 3, weightKg: null }, { lineId: "L3", material: "Item", qty: 8, weightKg: null }, { lineId: "L2", material: "Panel", qty: 2, weightKg: null }] }]);
  assert.deepStrictEqual(pend.map((l) => l.qty), [3, 0, 12]);
  const r = requirementsFor(pend, panels, stock);
  assert.strictEqual(r.find((x) => x.key === stockKey("grey", "300x300"))!.need, 3 * 2 + 0 + 12, "a partial load shrinks the need instead of raising toCut");
}

// CR-349: weight split — pieces vs board; shipped kg are frozen on the load, pending kg follow the master.
{
  const w = new Map<string, number | null>([[stockKey("grey", "300x300"), 1.5], [stockKey("ivory", "600x300"), 4]]);
  assert.deepStrictEqual(panelWeightSplit(panels.get("A")!, w, 5.5), { pieces: 7, mdf: 5.5 });
  assert.deepStrictEqual(panelWeightSplit(panels.get("A")!, w, null), { pieces: 7, mdf: null });
  const line = { id: "L1", qty: 3, panelId: "A", mdfId: "m8" };
  const live = { pieces: 7, mdf: 5.5 };
  assert.deepStrictEqual(lineWeightSplit(line, [], live), { pieces: 21, mdf: 16.5 }, "nothing loaded = live × qty");
  const loads = [{ id: "ld1", lines: [{ lineId: "L1", material: "Mdf" as const, qty: 2, weightKg: 11 }, { lineId: "L1", material: "Panel" as const, qty: 1, weightKg: 7 }] }];
  assert.deepStrictEqual(lineWeightSplit(line, loads, live), { pieces: 7 + 2 * 7, mdf: 11 + 1 * 5.5 });
  // The master changes (board now 6 kg): the loaded 2 boards stay 11 kg, only the pending one moves.
  assert.deepStrictEqual(lineWeightSplit(line, loads, { pieces: 7, mdf: 6 }), { pieces: 21, mdf: 11 + 6 });
  assert.strictEqual(lineWeightSplit(line, [{ id: "x", lines: [{ lineId: "L1", material: "Mdf", qty: 1, weightKg: null }] }], live).mdf, null, "an unweighed shipped line = unknown");
  assert.deepStrictEqual(lineWeightSplit({ id: "L3", qty: 4, panelId: "" }, [], { pieces: 1.5, mdf: null }), { pieces: 6, mdf: null }, "a cut-piece line has no board");
}
console.log("panelOrderNeeds: loads + weight split checks passed");
