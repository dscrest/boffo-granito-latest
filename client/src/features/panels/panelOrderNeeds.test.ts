/* Self-check for panelOrderNeeds — run with:  npx tsx client/src/features/panels/panelOrderNeeds.test.ts
   Plain asserts, no framework (same style as newLoadingRows.test.ts). */
import assert from "node:assert";
import {
  allocatedByKey,
  sampleNeedLines,
  demandByKey,
  lineCheckpoint,
  lineLoadRows,
  lineStages,
  lineWeightSplit,
  loadingStatus,
  loadProgress,
  materialReadiness,
  mdfLabel,
  panelProgress,
  withLineMark,
  panelWeight,
  panelWeightSplit,
  pastedAllowed,
  pendingNeedLines,
  pendingText,
  requirementsFor,
  rowKey,
  pieceLabel,
  rowLabel,
  shortagesFor,
  stockKey,
  type LoadIn,
  type ProgressRow,
} from "./panelOrderNeeds";
import type { PanelRow } from "./panelsApi";

const panel = (id: string, lines: { d: string; c: string; q: number }[]): PanelRow =>
  ({
    id,
    panelCode: id,
    panelSize: "",
    vinylSize: "",
    mdfSize: "",
    remarks: "",
    images: [],
    createdTime: "",
    modifiedTime: "",
    lines: lines.map((l, i) => ({ id: `${id}-${i}`, designId: l.d, designName: l.d, itemCode: "", sizeLabel: "", cutSizeId: l.c, cutSizeName: l.c, qty: l.q })),
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

// CR-367/400: ONE derived status — New · Ready · Completed · Dispatched · Cancelled (no buttons).
{
  const mk = (status: string) => ({ status, by: "x", at: "" });
  const three = { mdf: mk("Ready"), vinyl: mk("Ready"), cut: mk("Ready") };
  const all = { ...three, pasted: mk("Ready") };
  const booked = [{ need: 4, allocated: 4 }];
  const open = [{ need: 4, allocated: 0 }];
  const lines = [{ panelId: "A" }, { panelId: "B" }, { panelId: "" }]; // CR-376: two panels + a cut-piece line (no marks)
  // Legacy order-level marks (CR-313…366) still read for every panel through the fallback.
  assert.strictEqual(panelProgress({ status: "NewRequest", checkpoints: {}, lines }, open), "New");
  assert.strictEqual(panelProgress({ status: "NewRequest", checkpoints: { mdf: mk("Ordered") }, lines }, open), "New");
  assert.strictEqual(panelProgress({ status: "Received", checkpoints: three, lines }, booked), "New", "CR-323: three Ready without pasted is not ready");
  assert.strictEqual(panelProgress({ status: "NewRequest", checkpoints: all, lines }, open), "Ready", "every panel pasted, pieces unbooked");
  assert.strictEqual(panelProgress({ status: "NewRequest", checkpoints: all, lines }, [{ need: 4, allocated: 1 }]), "Ready", "partly booked is still Ready");
  assert.strictEqual(panelProgress({ status: "NewRequest", checkpoints: all, lines }, booked), "Completed", "pasted + booked");
  assert.strictEqual(panelProgress({ status: "InCutting", checkpoints: all, lines }, booked), "Completed", "legacy stage reads the same");
  assert.strictEqual(panelProgress({ status: "Dispatched", checkpoints: {}, lines }, open), "Dispatched");
  assert.strictEqual(panelProgress({ status: "Cancelled", checkpoints: all, lines }, booked), "Cancelled");

  // CR-376: per-panel marks — Ready needs EVERY panel.
  const ready3 = { mdf: mk("Ready"), vinyl: mk("Ready"), pasted: mk("Ready") };
  const perPanel = { panels: { A: ready3, B: ready3 } };
  assert.strictEqual(panelProgress({ status: "NewRequest", checkpoints: perPanel, lines }, open), "Ready", "the dormant cut mark is not needed");
  assert.strictEqual(panelProgress({ status: "NewRequest", checkpoints: perPanel, lines }, booked), "Completed");
  assert.strictEqual(panelProgress({ status: "NewRequest", checkpoints: { panels: { A: ready3 } }, lines }, booked), "New", "panel B still pending");
  assert.strictEqual(panelProgress({ status: "NewRequest", checkpoints: { ...all, panels: { A: { mdf: mk("Pending") } } }, lines }, booked), "New", "a panel's own mark beats the legacy order-level one");
  assert.strictEqual(panelProgress({ status: "NewRequest", checkpoints: {}, lines: [{ panelId: "" }] }, open), "Ready", "cut-piece-only order has nothing to paste");
  assert.strictEqual(panelProgress({ status: "NewRequest", checkpoints: {}, lines: [{ panelId: "" }] }, booked), "Completed");
  assert.strictEqual(lineCheckpoint({ panels: { A: { mdf: mk("Received") } } }, "A", "mdf"), "Received");
  assert.strictEqual(lineCheckpoint({ mdf: mk("Ordered"), panels: { A: { mdf: mk("Received") } } }, "B", "mdf"), "Ordered", "legacy fallback");
  assert.strictEqual(lineCheckpoint({}, "B", "vinyl"), "Pending");

  // CR-366: pasted waits for MDF + vinyl — CR-376: per panel.
  assert.strictEqual(pastedAllowed({}, "A"), false);
  assert.strictEqual(pastedAllowed({ mdf: mk("Ready") }, "A"), false);
  assert.strictEqual(pastedAllowed({ mdf: mk("Ready"), vinyl: mk("Printing") }, "A"), false);
  assert.strictEqual(pastedAllowed({ mdf: mk("Ready"), vinyl: mk("Ready") }, "A"), true, "legacy order-level marks");
  assert.strictEqual(pastedAllowed({ panels: { A: { mdf: mk("Ready"), vinyl: mk("Ready") } } }, "A"), true);
  assert.strictEqual(pastedAllowed({ panels: { A: { mdf: mk("Ready"), vinyl: mk("Ready") } } }, "B"), false, "another panel's marks do not count");
  // CR-432: optimistic mark — only that panel's key changes, the input is untouched.
  const cp0 = { panels: { A: { mdf: mk("Ready") }, B: { mdf: mk("Ordered") } } };
  const cp1 = withLineMark(cp0, "A", "vinyl", "Printing");
  assert.strictEqual(lineCheckpoint(cp1, "A", "vinyl"), "Printing");
  assert.strictEqual(lineCheckpoint(cp1, "A", "mdf"), "Ready");
  assert.strictEqual(lineCheckpoint(cp1, "B", "vinyl"), "Pending");
  assert.strictEqual(lineCheckpoint(cp0, "A", "vinyl"), "Pending", "input not mutated");

  // CR-365/403: per line × material readiness for the Actions tab — pieces = booked, MDF = pasted.
  const reqs = requirementsFor([{ panelId: "A", qty: 2 }, { panelId: "", qty: 3, designId: "grey", cutSizeId: "300x300" }], panels, stock, { allocation: { [stockKey("grey", "300x300")]: 7, [stockKey("ivory", "600x300")]: 2 } });
  const pl = { panelId: "A" };
  assert.deepStrictEqual(materialReadiness({ material: "Mdf" }, pl, {}, reqs), { ready: false, missing: ["Not pasted on MDF"] });
  assert.deepStrictEqual(materialReadiness({ material: "Mdf" }, pl, { ...all, pasted: mk("Pending") }, reqs).missing, ["Not pasted on MDF"], "mdf + vinyl Ready is not enough");
  assert.deepStrictEqual(materialReadiness({ material: "Mdf" }, pl, all, reqs), { ready: true, missing: [] });
  assert.deepStrictEqual(materialReadiness({ material: "Panel" }, pl, all, reqs), { ready: true, missing: [] }, "grey 4+3 booked 7, ivory 2 booked 2");
  assert.deepStrictEqual(materialReadiness({ material: "Panel" }, pl, {}, reqs), { ready: true, missing: [] }, "CR-403: pieces load once booked, whatever the marks say");
  // CR-376: the row reads ITS panel's marks.
  const threeA = { panels: { A: { mdf: mk("Ready"), vinyl: mk("Ready"), pasted: mk("Ready") } } };
  assert.deepStrictEqual(materialReadiness({ material: "Mdf" }, pl, threeA, reqs), { ready: true, missing: [] });
  assert.deepStrictEqual(materialReadiness({ material: "Mdf" }, { panelId: "B" }, threeA, reqs).missing, ["Not pasted on MDF"]);
  const short = requirementsFor([{ panelId: "A", qty: 2 }], panels, stock, { allocation: { [stockKey("grey", "300x300")]: 4 } });
  assert.deepStrictEqual(materialReadiness({ material: "Panel" }, pl, all, short).missing, ["Cut 2 more"], "ivory: need 2, nothing on hand");
  const item = { panelId: "", designId: "grey", cutSizeId: "300x300" };
  assert.deepStrictEqual(materialReadiness({ material: "Item" }, item, {}, reqs), { ready: true, missing: [] }, "cut-piece line ignores the checkpoints");
  assert.deepStrictEqual(materialReadiness({ material: "Item" }, item, {}, requirementsFor([{ panelId: "", qty: 3, designId: "grey", cutSizeId: "300x300" }], panels, stock)).missing, ["Book 3 more pcs"]);
}

console.log("panelOrderNeeds: booking + progress checks passed");

// CR-346: a loose cut-piece line needs its own pieces — one per unit — beside the panels.
{
  const r = requirementsFor([{ panelId: "B", qty: 1 }, { panelId: "", qty: 20, designId: "grey", cutSizeId: "300x300", designName: "Grey", cutSizeName: "300x300" }], panels, stock);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].need, 3 + 20);
  assert.deepStrictEqual(r[0].panels, [{ panelId: "B", panelCode: "B", qty: 3 }, { panelId: "", panelCode: "Cut piece", qty: 20 }]);
  assert.strictEqual(requirementsFor([{ panelId: "", qty: 5 }], panels, stock).length, 0, "a cut line without design/cut size needs nothing");
}

// CR-347/405: loads → progress per line × piece kind (+ the board), derived Loading Status, pending text, pending needs.
{
  const lines = [
    { id: "L1", qty: 3, panelId: "A", mdfId: "m8" },
    { id: "L2", qty: 2, panelId: "B" }, // no board picked → CR-406: the MDF row is still there
    { id: "L3", qty: 20, panelId: "", designId: "grey", cutSizeId: "300x300", designName: "Grey", cutSizeName: "300x300" },
  ];
  const none = loadProgress(lines, [], panels);
  assert.deepStrictEqual(none.map(rowKey), ["L1|Item|grey|300x300", "L1|Item|ivory|600x300", "L1|Mdf||", "L2|Item|grey|300x300", "L2|Mdf||", "L3|Item|grey|300x300"]);
  assert.deepStrictEqual(none.map((r) => r.ordered), [6, 3, 3, 6, 2, 20], "pieces = pcs on panel × line qty; MDF = line qty");
  assert.deepStrictEqual(none.map(pieceLabel), ["grey · 300x300", "ivory · 600x300", "MDF", "grey · 300x300", "MDF", "Grey · 300x300"]);
  assert.deepStrictEqual(none.map(rowLabel), ["300x300", "600x300", "MDF", "300x300", "MDF", "300x300"], "CR-415: on-screen cell = cut size only");
  assert.strictEqual(loadingStatus(none), "Not loaded");
  assert.strictEqual(pendingText(none), "35 pcs · 5 MDF");
  assert.deepStrictEqual(lineLoadRows({ id: "L9", qty: 1, panelId: "ghost" }, panels).map((r) => r.material), ["Mdf"], "unknown panel → board only");
  // A partial piece load on ONE kind of panel A, a board, and 8 loose pieces.
  const partial = loadProgress(lines, [{ id: "ld1", lines: [
    { lineId: "L1", material: "Item", qty: 2, weightKg: 3, designId: "grey", cutSizeId: "300x300" },
    { lineId: "L1", material: "Mdf", qty: 3, weightKg: 16.5 },
    { lineId: "L3", material: "Item", qty: 8, weightKg: 12, designId: "grey", cutSizeId: "300x300" },
  ] }], panels);
  assert.strictEqual(loadingStatus(partial), "Partially loaded");
  assert.deepStrictEqual(partial.map((r) => r.pending), [4, 3, 0, 6, 2, 12], "2 of 6 grey left; ivory untouched; boards of L1 gone");
  assert.strictEqual(pendingText(partial), "25 pcs · 2 MDF");
  // A LEGACY whole-panel load line (material Panel) reads as qty × pcs under every piece key of that panel.
  const full = loadProgress(lines, [
    { id: "ld1", lines: [{ lineId: "L1", material: "Mdf", qty: 3, weightKg: 16.5 }, { lineId: "L3", material: "Item", qty: 20, weightKg: 30, designId: "grey", cutSizeId: "300x300" }, { lineId: "L2", material: "Mdf", qty: 2, weightKg: null }] },
    { id: "ld2", lines: [{ lineId: "L1", material: "Panel", qty: 3, weightKg: null }, { lineId: "L2", material: "Panel", qty: 2, weightKg: 9 }] },
  ], panels);
  assert.strictEqual(loadingStatus(full), "Loaded");
  assert.strictEqual(pendingText(full), "");
  assert.strictEqual(loadingStatus([], "Dispatched"), "Loaded", "a legacy Dispatched order with no loads reads Loaded");
  // Pending need lines = one per line × piece kind with the PIECES still pending (MDF never touches cut stock).
  const pend = pendingNeedLines(lines, [{ id: "ld1", lines: [{ lineId: "L1", material: "Mdf", qty: 3, weightKg: null }, { lineId: "L3", material: "Item", qty: 8, weightKg: null, designId: "grey", cutSizeId: "300x300" }, { lineId: "L2", material: "Panel", qty: 2, weightKg: null }] }], panels);
  assert.deepStrictEqual(pend.map((l) => `${l.panelId}|${l.designId}|${l.cutSizeId}|${l.qty}`), ["A|grey|300x300|6", "A|ivory|600x300|3", "B|grey|300x300|0", "|grey|300x300|12"]);
  const r = requirementsFor(pend, panels, stock);
  assert.strictEqual(r.find((x) => x.key === stockKey("grey", "300x300"))!.need, 6 + 0 + 12, "a partial load shrinks the need instead of raising toCut");
  assert.deepStrictEqual(r.find((x) => x.key === stockKey("grey", "300x300"))!.panels, [{ panelId: "A", panelCode: "A", qty: 6 }, { panelId: "B", panelCode: "B", qty: 0 }, { panelId: "", panelCode: "Cut piece", qty: 12 }], "shares stay per panel");
  // CR-405: an Item row's readiness is the booking of ITS piece kind.
  const booked = requirementsFor(pend, panels, stock, { allocation: { [stockKey("grey", "300x300")]: 18 } });
  const greyRow = partial[0];
  const ivoryRow = partial[1];
  assert.deepStrictEqual(materialReadiness(greyRow, lines[0], {}, booked), { ready: true, missing: [] }, "grey fully booked");
  assert.deepStrictEqual(materialReadiness(ivoryRow, lines[0], {}, booked).missing, ["Cut 3 more"], "ivory: nothing on hand");
}

// CR-349/405: weight split — pieces vs board; shipped kg are frozen on the load, pending kg follow the master per row.
{
  const w = new Map<string, number | null>([[stockKey("grey", "300x300"), 1.5], [stockKey("ivory", "600x300"), 4]]);
  assert.deepStrictEqual(panelWeightSplit(panels.get("A")!, w, 5.5), { pieces: 7, mdf: 5.5 });
  assert.deepStrictEqual(panelWeightSplit(panels.get("A")!, w, null), { pieces: 7, mdf: null });
  const line = { id: "L1", qty: 3, panelId: "A", mdfId: "m8" };
  const unitOf = (mdf: number | null) => (r: ProgressRow) => (r.material === "Mdf" ? mdf : (w.get(stockKey(r.designId, r.cutSizeId)) ?? null));
  const rowsOf = (loads: LoadIn[]) => loadProgress([line], loads, panels);
  assert.deepStrictEqual(lineWeightSplit("L1", [], rowsOf([]), unitOf(5.5)), { pieces: 21, mdf: 16.5 }, "nothing loaded = live × qty");
  const loads: LoadIn[] = [{ id: "ld1", lines: [{ lineId: "L1", material: "Mdf", qty: 2, weightKg: 11 }, { lineId: "L1", material: "Panel", qty: 1, weightKg: 7 }] }];
  assert.deepStrictEqual(lineWeightSplit("L1", loads, rowsOf(loads), unitOf(5.5)), { pieces: 7 + 2 * 7, mdf: 11 + 1 * 5.5 });
  // The master changes (board now 6 kg): the loaded 2 boards stay 11 kg, only the pending one moves.
  assert.deepStrictEqual(lineWeightSplit("L1", loads, rowsOf(loads), unitOf(6)), { pieces: 21, mdf: 11 + 6 });
  const partial: LoadIn[] = [{ id: "ld2", lines: [{ lineId: "L1", material: "Item", qty: 4, weightKg: 6.5, designId: "grey", cutSizeId: "300x300" }] }];
  assert.deepStrictEqual(lineWeightSplit("L1", partial, rowsOf(partial), unitOf(5.5)), { pieces: 6.5 + 2 * 1.5 + 3 * 4, mdf: 16.5 }, "4 of 6 grey shipped frozen; 2 grey + 3 ivory pending live");
  assert.strictEqual(lineWeightSplit("L1", [{ id: "x", lines: [{ lineId: "L1", material: "Mdf", qty: 1, weightKg: null }] }], rowsOf([]), unitOf(5.5)).mdf, null, "an unweighed shipped line = unknown");
  const loose = { id: "L3", qty: 4, panelId: "", designId: "grey", cutSizeId: "300x300" };
  assert.deepStrictEqual(lineWeightSplit("L3", [], loadProgress([loose], [], panels), unitOf(null)), { pieces: 6, mdf: null }, "a cut-piece line has no board");
}

// CR-404: readiness stages per line — marks · booked · weighed · loaded; a loose cut piece skips the marks.
{
  const ready = { status: "Ready", by: "x", at: "2026-10-23 10:00:00" };
  const cp = { panels: { A: { mdf: ready, vinyl: ready, pasted: ready }, B: { mdf: ready } } };
  const lines = [
    { id: "L1", qty: 2, panelId: "A", mdfId: "m8" },
    { id: "L2", qty: 1, panelId: "B" },
    { id: "L3", qty: 4, panelId: "", designId: "grey", cutSizeId: "300x300" },
  ];
  const reqs = requirementsFor(lines, panels, stock, { allocation: { [stockKey("grey", "300x300")]: 50, [stockKey("ivory", "600x300")]: 10 } });
  const loads = [{ id: "ld1", lines: [{ lineId: "L1", material: "Panel" as const, qty: 2, weightKg: 14 }, { lineId: "L1", material: "Mdf" as const, qty: 2, weightKg: 11 }] }];
  const a = lineStages(lines[0], { checkpoints: cp, loads }, reqs, true, panels);
  assert.deepStrictEqual(a.map((s) => s.name), ["MDF", "Vinyl", "Pasted", "Cut pieces", "Weighed", "Loaded"]);
  assert.deepStrictEqual(a.map((s) => s.done), [true, true, true, true, true, true], "A: pasted, booked, weighed, fully loaded");
  const b = lineStages(lines[1], { checkpoints: cp, loads }, reqs, false, panels);
  assert.deepStrictEqual(b.map((s) => s.done), [true, false, false, true, false, false], "B: only MDF marked, pieces booked, no kg, nothing loaded");
  const c = lineStages(lines[2], { checkpoints: cp, loads }, reqs, true, panels);
  assert.deepStrictEqual(c.map((s) => s.applicable), [false, false, false, true, true, true], "a loose cut piece has no marks");
  assert.deepStrictEqual(c.map((s) => s.done), [true, true, true, true, true, false], "marks count done; booked; weighed; not loaded");
  // A line whose pieces already left reads Cut pieces done even when the order is short on booking.
  const d = lineStages(lines[0], { checkpoints: cp, loads }, requirementsFor(lines, panels, stock), true, panels);
  assert.strictEqual(d[3].done, true, "loaded pieces = done, booked or not");
  assert.strictEqual(lineStages(lines[1], { checkpoints: cp, loads }, requirementsFor(lines, panels, stock), true, panels)[3].done, false, "unbooked, not loaded = pending");
}
// CR-487: sample orders book cut pieces too — every line's PENDING qty is a need line; CR-489: a Full tile keys on the
// item's full-size piece (an unresolved one — legacy row, no such piece yet — drops out); open = New / PartiallySupplied.
{
  const sLines = [
    { pieceKind: "Cut", designId: "grey", cutSizeId: "300x300", designName: "Grey", cutSizeName: "300x300", qty: 10, suppliedQty: 4 },
    { pieceKind: "Full", designId: "grey", cutSizeId: "600x600", designName: "Grey", cutSizeName: "600x600", qty: 3, suppliedQty: 0 },
    { pieceKind: "Full", designId: "ivory", cutSizeId: "", designName: "Ivory", cutSizeName: "", qty: 3, suppliedQty: 0 },
    { pieceKind: "Cut", designId: "ivory", cutSizeId: "600x300", designName: "Ivory", cutSizeName: "600x300", qty: 2, suppliedQty: 2 },
  ];
  const need = sampleNeedLines(sLines);
  assert.deepStrictEqual(need.map((l) => [l.designId, l.cutSizeId, l.cutSizeName, l.qty]), [["grey", "300x300", "300x300", 6], ["grey", "600x600", "Full tile", 3]], "pending pieces; a Full tile on its full-size piece; unresolved and supplied lines drop out");
  const k = stockKey("grey", "300x300");
  const panelsOpen = [{ status: "Received", allocation: { [k]: 5 } }];
  const samples = [
    { status: "New", allocation: { [k]: 4 } },
    { status: "PartiallySupplied", allocation: { [k]: 1 } },
    { status: "Supplied", allocation: { [k]: 9 } },
    { status: "Cancelled", allocation: { [k]: 9 } },
  ];
  assert.strictEqual(allocatedByKey(panelsOpen, samples).get(k), 10, "panel 5 + open samples 4 + 1; supplied / cancelled drop out");
  assert.strictEqual(allocatedByKey(panelsOpen).get(k), 5, "no samples = the CR-312 figure");
  const [r] = requirementsFor(need, new Map(), new Map([[k, 12]]), { allocation: { [k]: 4 }, booked: allocatedByKey(panelsOpen, samples) });
  assert.deepStrictEqual([r.need, r.allocated, r.free, r.toCut], [6, 4, 2, 0], "need 6, 4 booked, 12 − 10 free, nothing to cut");
  const demand = demandByKey([], new Map(), new Map([[k, 12]]), [], [{ id: "s1", orderNumber: "SMP/1", status: "New", lines: need, allocation: { [k]: 4 } }]);
  assert.deepStrictEqual(demand.map((d) => [d.key, d.required, d.allocated]), [[k, 6, 4], ["grey|600x600", 3, 0]], "a sample order's lines — cut piece AND full tile — are demand on Pending Cut Stock");
}
console.log("panelOrderNeeds: loads + weight split + sample booking checks passed");
