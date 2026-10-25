/* CR-365…371 API drive — panel-order pasting gate + cancel, sample cancel, palletization discard /
   plan delete / SO cancel cascade — against the deployed data-ops function. Every record is
   prefixed ZZT and removed at the end.

   Panel Craft
     seed            → Design + cut piece (full size) + 20 pcs receipt + Panel (1 line ×2) + PanelOrder (qty 1) + Accept
     CR-366/376      → mark without panel → 400; pasted=Ready → 409; mdf=Ready, vinyl=Ready (per panel) → pasted=Ready → 200; cut order-level
     CR-368 panel    → cancel without reason → 400; allocate 2 → cancel → status Cancelled, allocation {} ;
                        a second order can now book all 20 (the cancelled booking no longer counts); cancel again → 409
     CR-368 sample   → sample order (Cut ×1) → cancel → Cancelled; cancel again → 409; load on it → 409
     CR-380…383      → on order2 (booked, no marks): Panel pick → 409 "MDF not ready…"; Mdf pick → 409;
                        mdf+vinyl Ready → Mdf pick still 409 (not pasted); pasted Ready → Panel pick 200
                        WITHOUT a cut mark (booked = ready) → load deleted (stock + booking back)
   Palletization
     seed            → batched Design + opening 100 + SO + allocate 50 → one Planning line
     CR-369          → discard without reason → 400; discard 10 of the Planning line → line 40, alloc 40;
                        Palletizing → discard 10 → line 30, alloc 30
     CR-370          → DELETE plan → line gone, alloc gone, produced 0; re-allocate 20 → load into a box → DELETE plan → 409
     CR-371          → cancel SO without reason → 400; cancel → box emptied, no lines, no allocs, status Cancelled
                        (dispatched-box 409 not driven: a Dispatched LoadBox is undeletable through the API)

   Run:  BOFFO_TOKEN=<AuthSession token of an Admin> node scripts/drive-cr365.mjs   (SEED_HOST overrides the host) */

const HOST = process.env.SEED_HOST || "https://boffo-granito-export-tracker-925638796.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;
const TOKEN = process.env.BOFFO_TOKEN || "";
let pass = 0;
let fail = 0;
const made = { design: null, panels: [], orders: [], samples: [], palDesign: null, so: null, box: null };

async function call(method, path, body, { expect = 200 } = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(TOKEN ? { "X-App-Token": TOKEN } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { ok: false, error: text }; }
  if (res.status !== expect) throw new Error(`${method} ${path} → HTTP ${res.status} (wanted ${expect}): ${json.error || text}`);
  return json;
}
const post = (p, b, o) => call("POST", p, b, o);
const get = (p) => call("GET", p);
const del = (p, o) => call("DELETE", p, undefined, o);
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); }
};
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };
const rows = async (t, where) => ((await get(`${t}?where=${encodeURIComponent(where)}&limit=300`)).rows || []).filter((r) => !r.deleted_at);
const n = (v) => Number(v) || 0;
const reason = "ZZT drive";

async function panelCraft(stamp, customer) {
  let design, cutSize, panel, order, order2, sample;
  const today = new Date().toISOString().slice(0, 10);
  const orderRow = async (id) => (await rows("PanelOrder", `ROWID=${id}`))[0];

  await check("seed: item + cut piece + 20 pcs + panel (×2) + order (qty 1) → Received", async () => {
    design = String((await post("Design", { design_name: `ZZT CAN ${stamp}`, unique_name: `ZZT CAN ${stamp}`, sku: `ZZTCAN${stamp}`, status: "Active" })).rowid);
    made.design = design;
    cutSize = String(((await get("CutPieceSize?limit=1")).rows || [])[0]?.ROWID || "");
    if (!cutSize) throw new Error("need one CutPieceSize on live");
    await post("cut-piece-save", { design, cut_piece_size: cutSize, weight_kg: 1 });
    await post("cut-stock-entry", { entry_date: today, kind: "receipt", lines: [{ design, cut_piece_size: cutSize, qty: 20 }] });
    panel = String((await post("panel-save", { panel_code: "", panel_size: "1200x2400", vinyl_size: "1200x2400", lines: [{ design, cut_piece_size: cutSize, cut_piece_qty: 2 }] })).rowid);
    made.panels.push(panel);
    order = String((await post("panel-order-save", { customer, salesperson: "ZZT", lines: [{ panel, qty: 1 }] })).rowid);
    made.orders.push(order);
    await post(`panel-order-status/${order}`, { status: "Received" });
    eq(String((await orderRow(order)).status), "Received", "status");
  });

  await check("CR-366/376: per-panel marks — no panel → 400, foreign panel → 400; pasted=Ready before mdf/vinyl → 409; after both Ready → 200", async () => {
    await post(`panel-order-checkpoint/${order}`, { key: "mdf", status: "Ready" }, { expect: 400 }); // CR-376: panel required
    await post(`panel-order-checkpoint/${order}`, { key: "mdf", status: "Ready", panel: "1" }, { expect: 400 }); // not on this order
    await post(`panel-order-checkpoint/${order}`, { key: "pasted", status: "Ready", panel }, { expect: 409 });
    await post(`panel-order-checkpoint/${order}`, { key: "mdf", status: "Ready", panel });
    await post(`panel-order-checkpoint/${order}`, { key: "pasted", status: "Ready", panel }, { expect: 409 });
    await post(`panel-order-checkpoint/${order}`, { key: "vinyl", status: "Ready", panel });
    const r = await post(`panel-order-checkpoint/${order}`, { key: "pasted", status: "Ready", panel });
    eq(r.data?.checkpoints?.panels?.[panel]?.pasted?.status, "Ready", "pasted mark stored under the panel");
    eq(r.data?.checkpoints?.pasted, undefined, "no order-level pasted mark written");
    const c = await post(`panel-order-checkpoint/${order}`, { key: "cut", status: "Ready" }); // cut stays order-level
    eq(c.data?.checkpoints?.cut?.status, "Ready", "cut mark");
  });

  await check("CR-368 panel: no reason → 400; booked 2 → cancel → Cancelled, allocation {}, booking freed", async () => {
    await post(`panel-order-allocate/${order}`, { allocation: { [`${design}|${cutSize}`]: 2 } });
    await post(`panel-order-cancel/${order}`, {}, { expect: 400 });
    const r = await post(`panel-order-cancel/${order}`, { reason });
    eq(r.data?.status, "Cancelled", "status");
    const row = await orderRow(order);
    eq(String(row.status), "Cancelled", "stored status");
    eq(Object.keys(JSON.parse(row.allocation || "{}")).length, 0, "allocation cleared");
    // A second order can book every piece — the cancelled order no longer counts.
    order2 = String((await post("panel-order-save", { customer, salesperson: "ZZT", lines: [{ panel, qty: 10 }] })).rowid);
    made.orders.push(order2);
    await post(`panel-order-status/${order2}`, { status: "Received" });
    await post(`panel-order-allocate/${order2}`, { allocation: { [`${design}|${cutSize}`]: 20 } });
    eq(n((await rows("CutPieceStock", `design=${design}`))[0].qty), 20, "on hand untouched");
  });

  await check("CR-368 guards: cancel again → 409; status / checkpoint / allocate on a cancelled order → 409", async () => {
    await post(`panel-order-cancel/${order}`, { reason }, { expect: 409 });
    await post(`panel-order-status/${order}`, { status: "InCutting" }, { expect: 409 });
    await post(`panel-order-checkpoint/${order}`, { key: "cut", status: "Ready" }, { expect: 409 });
    await post(`panel-order-allocate/${order}`, { allocation: {} }, { expect: 409 });
  });

  await check("CR-403/405: loading gate — pieces load once booked (marks Pending); the MDF row exists without a thickness (CR-406) but waits for pasted; material Panel → 400", async () => {
    const line = String((await rows("PanelOrderLine", `panel_order=${order2}`))[0].ROWID);
    const load = (material, expect, qty = 1) => post("panel-load-save", { load_date: today, vehicle_number: "GJ01ZZ0002", orders: [{ order_type: "Panel", order: order2, lines: [{ line, material, qty, design, cut_piece_size: cutSize }] }] }, { expect });
    await load("Panel", 400); // CR-405: whole-panel picks are gone — pieces per cut piece
    await load("Mdf", 409); // CR-406: the board row is there; CR-403: not pasted yet
    await post(`panel-order-checkpoint/${order2}`, { key: "vinyl", status: "Ready", panel }); // CR-431: vinyl no longer waits for MDF
    await post(`panel-order-checkpoint/${order2}`, { key: "mdf", status: "Ready", panel });
    await post(`panel-order-checkpoint/${order2}`, { key: "vinyl", status: "Ready", panel });
    await load("Mdf", 409); // pasted still Pending
    await post(`panel-order-checkpoint/${order2}`, { key: "pasted", status: "Ready", panel });
    const r = await load("Item", 200, 2); // CR-403: booked = ready whatever the marks; 2 pcs of the one kind
    const loadId = String((r.data?.loads || [])[0]?.ROWID || "");
    eq(n((await rows("CutPieceStock", `design=${design}`))[0].qty), 18, "2 pcs left with the load");
    if (loadId) await post(`panel-load-delete/${loadId}`, { reason });
    eq(n((await rows("CutPieceStock", `design=${design}`))[0].qty), 20, "load deleted → stock back");
  });

  await check("CR-368 sample: cancel → Cancelled; again → 409; a load on it → 409", async () => {
    sample = String((await post("sample-order-save", { customer, salesperson: "ZZT", lines: [{ design, piece_kind: "Cut", cut_piece_size: cutSize, qty: 1 }] })).rowid);
    made.samples.push(sample);
    await post(`sample-order-cancel/${sample}`, {}, { expect: 400 });
    const r = await post(`sample-order-cancel/${sample}`, { reason });
    eq(r.data?.status, "Cancelled", "status");
    await post(`sample-order-cancel/${sample}`, { reason }, { expect: 409 });
    const line = (await rows("SampleOrderLine", `sample_order=${sample}`))[0];
    await post("panel-load-save", { load_date: today, vehicle_number: "GJ01ZZ0001", orders: [{ order_type: "Sample", order: sample, lines: [{ line: String(line.ROWID), material: "Item", qty: 1 }] }] }, { expect: 409 });
  });
}

async function palletization(stamp, customer) {
  const pallet = ((await get("Pallet?limit=1")).rows || [])[0];
  const vehicle = ((await get("Vehicle?limit=1")).rows || [])[0];
  if (!pallet) throw new Error("need one Pallet on live");
  const batch = `ZZT/${stamp}/001`;
  const lines = async () => (await rows("PalletizationPlanLine", `sales_order=${made.so}`)).sort((a, b) => (a.ROWID < b.ROWID ? -1 : 1));
  const oi = async () => (await rows("OrderItem", `sales_order=${made.so}`))[0];
  const allocs = async () => (await rows("ProductionLog", `order_item=${(await oi()).ROWID}`)).filter((r) => r.entry_type === "alloc");
  const allocate = (q) => oi().then((it) => post("allocate-stock", { order_item: String(it.ROWID), rows: [{ batch_number: batch, qty_boxes: q }] }));
  let line;

  await check("seed: batched item + opening 100 + SO + allocate 50 → one Planning line", async () => {
    const d = await post("Design", { design_name: `ZZT DIS ${stamp}`, unique_name: `ZZT DIS ${stamp}`, sku: `ZZTDIS${stamp}`, is_batched: true, status: "Active" });
    made.palDesign = String(d.rowid);
    await post(`opening-stock/${made.palDesign}`, { rows: [{ qty_boxes: 100, batch_number: batch }] });
    const so = await post("so-with-items", {
      customer: customer.name, po_number: `ZZT-PO-${stamp}`, order_date: new Date().toISOString().slice(0, 10),
      lines: [{ item: `ZZT DIS ${stamp}`, qty: 80, rate: 1, pallet: String(pallet.ROWID) }],
    });
    made.so = String(so.rowid);
    await allocate(50);
    const ls = await lines();
    eq(ls.length, 1, "Planning lines");
    eq(String(ls[0].status), "Planning", "status");
    line = ls[0];
  });

  await check("CR-369: discard without reason → 400; discard 10 of a Planning line → 40 / alloc 40", async () => {
    await post(`pal-line-release/${line.ROWID}`, { boxes: 10 }, { expect: 400 });
    const r = await post(`pal-line-release/${line.ROWID}`, { boxes: 10, reason });
    eq(r.data?.to, "stock", "direction");
    eq(n((await lines())[0].boxes), 40, "line boxes");
    eq(n((await allocs())[0].qty_boxes), 40, "alloc qty");
    eq(n((await oi()).produced_qty_boxes), 40, "produced");
  });

  await check("CR-369: Palletizing line → discard 10 → 30 / alloc 30, Released transition from Palletizing", async () => {
    await post(`pal-line-status/${line.ROWID}`, { status: "Palletizing", pallet: String(pallet.ROWID) });
    await post(`pal-line-release/${line.ROWID}`, { boxes: 10, reason });
    eq(n((await lines())[0].boxes), 30, "line boxes");
    eq(n((await allocs())[0].qty_boxes), 30, "alloc qty");
    const t = await rows("StatusTransition", `entity_rowid=${line.ROWID}`);
    if (!t.some((x) => String(x.to_status) === "Released" && String(x.from_status) === "Palletizing")) throw new Error("no Palletizing → Released transition");
  });

  await check("CR-370: DELETE plan → lines gone, alloc gone, produced 0", async () => {
    await del(`PalletizationPlan/${line.plan}?reason=${encodeURIComponent(reason)}`);
    eq((await lines()).length, 0, "live lines");
    eq((await allocs()).length, 0, "alloc rows");
    eq(n((await oi()).produced_qty_boxes), 0, "produced");
  });

  await check("CR-370 guard: a boxed line → DELETE plan 409; no reason → 400", async () => {
    await allocate(20);
    const q = (await lines())[0];
    await post(`pal-line-status/${q.ROWID}`, { status: "ReadyToLoad", pallet: String(pallet.ROWID) });
    const b = await post("load-box", { ...(vehicle ? { vehicle: String(vehicle.ROWID) } : {}), container_number: `ZZTU${stamp}` });
    made.box = String(b.rowid);
    await post(`pal-line-box/${q.ROWID}`, { box: made.box });
    await del(`PalletizationPlan/${q.plan}`, { expect: 400 });
    await del(`PalletizationPlan/${q.plan}?reason=${encodeURIComponent(reason)}`, { expect: 409 });
    eq((await lines()).length, 1, "line kept");
  });

  await check("CR-371: cancel SO without reason → 400; cancel → box emptied, no lines, no allocs, Cancelled", async () => {
    await post(`so-status/${made.so}`, { status: "Cancelled" }, { expect: 400 });
    const r = await post(`so-status/${made.so}`, { status: "Cancelled", reason });
    eq(r.data?.status, "Cancelled", "status");
    eq((await lines()).length, 0, "live lines");
    eq((await allocs()).length, 0, "alloc rows");
    eq(n((await oi()).produced_qty_boxes), 0, "produced");
    eq(n((await oi()).loaded_qty_boxes), 0, "loaded");
    const boxed = (await rows("PalletizationPlanLine", `load_box=${made.box}`)).length;
    eq(boxed, 0, "lines left in the box");
  });
}

async function main() {
  const me = await get("auth/me");
  console.log(`· token user ${me.user?.email || "?"} (${me.user?.role || "?"})`);
  const stamp = Date.now().toString(36).toUpperCase();
  const customer = ((await get("Customer?limit=1")).rows || [])[0];
  if (!customer) throw new Error("need one Customer on live");
  await panelCraft(stamp, customer.name);
  await palletization(stamp, customer);
}

async function teardown() {
  console.log("· teardown");
  const hard = async (t, id) => del(`${t}/${id}?hard=1`).catch((e) => console.log(`  (skip ${t}/${id}: ${e.message})`));
  for (const o of made.orders) {
    for (const l of (await get(`PanelOrderLine?where=panel_order%3D${o}&limit=50`).catch(() => ({ rows: [] }))).rows || []) await hard("PanelOrderLine", l.ROWID);
    await hard("PanelOrder", o);
  }
  for (const s of made.samples) {
    for (const l of (await get(`SampleOrderLine?where=sample_order%3D${s}&limit=50`).catch(() => ({ rows: [] }))).rows || []) await hard("SampleOrderLine", l.ROWID);
    await hard("SampleOrder", s);
  }
  for (const p of made.panels) {
    for (const r of (await get(`PanelLine?where=panel%3D${p}&limit=50`).catch(() => ({ rows: [] }))).rows || []) await hard("PanelLine", r.ROWID);
    await hard("Panel", p);
  }
  if (made.design) {
    for (const t of ["CutStockEntry", "CutPieceStock"]) {
      for (const r of (await get(`${t}?where=design%3D${made.design}&limit=100`).catch(() => ({ rows: [] }))).rows || []) await hard(t, r.ROWID);
    }
    await hard("Design", made.design);
  }
  if (made.box) await post(`load-box-delete/${made.box}`, { reason }).catch((e) => console.log(`  (skip box: ${e.message})`));
  if (made.so) {
    const ls = (await get(`PalletizationPlanLine?where=sales_order%3D${made.so}&limit=300`).catch(() => ({ rows: [] }))).rows || [];
    for (const l of ls) await hard("PalletizationPlanLine", l.ROWID);
    for (const p of [...new Set(ls.map((l) => String(l.plan)).filter(Boolean))]) await hard("PalletizationPlan", p);
    for (const it of (await get(`OrderItem?where=sales_order%3D${made.so}&limit=50`).catch(() => ({ rows: [] }))).rows || []) {
      for (const r of (await get(`ProductionLog?where=order_item%3D${it.ROWID}&limit=300`).catch(() => ({ rows: [] }))).rows || []) await hard("ProductionLog", r.ROWID);
      await hard("OrderItem", it.ROWID);
    }
    await hard("SalesOrder", made.so);
  }
  if (made.palDesign) {
    for (const r of (await get(`ProductionLog?where=design%3D${made.palDesign}&limit=300`).catch(() => ({ rows: [] }))).rows || []) await hard("ProductionLog", r.ROWID);
    await hard("Design", made.palDesign);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { fail++; console.error("✗ drive aborted:", e.message); })
  .finally(() => teardown().then(() => process.exit(fail ? 1 : 0)));
