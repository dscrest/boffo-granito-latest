/* CR-411…413 API drive — location at every stage — against the deployed data-ops function.
   Every record is prefixed ZZT and removed at the end. Needs the three warehouses with bays
   (Production ▸ A1…, Palletization ▸ A1…, Loading Bay ▸ A1…) already on live.

   CR-411  production writers carry a location
     seed             → batched ZZT Design
     bulk sheet path  → /production-log (plan) + /production-complete {warehouse: Production ▸ B3} → record row at B3
     Record Output    → /production-log + /production-record/:id {warehouse: Production ▸ C4} → record row at C4
   CR-412  a pallet has a location
     seed             → SO (80) + allocate 30 (all of the first batch) → one Planning line, no location
     Start            → /pal-line-status Palletizing {warehouse: Palletization ▸ A1} → line at Palletization ▸ A1
     partial Complete → /pal-line-status ReadyToLoad boxes 20 {warehouse: Loading Bay ▸ A1}
                        → the 20-box slice is Ready for Loading at Loading Bay ▸ A1; the remainder re-queues (CR-281)
     Set Location     → PATCH PalletizationPlanLine/:slice {warehouse: Loading Bay ▸ A2} → moved; {warehouse: null} → cleared
     Load             → /pal-line-box slice → box; location column reads "—" client-side (load_box set) — not asserted here
   CR-413  panel order form location
     → /panel-order-save {warehouse: Production ▸ A1} → PanelOrder.warehouse set; save again with "" → cleared

   Run:  BOFFO_TOKEN=<AuthSession token of an Admin> node scripts/drive-cr411.mjs   (SEED_HOST overrides the host) */

const HOST = process.env.SEED_HOST || "https://boffo-granito-export-tracker-925638796.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;
const TOKEN = process.env.BOFFO_TOKEN || "";
let pass = 0;
let fail = 0;
const made = { design: null, so: null, box: null, panelOrder: null };

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
const patch = (p, b, o) => call("PATCH", p, b, o);
const get = (p) => call("GET", p);
const del = (p, o) => call("DELETE", p, undefined, o);
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`✓ ${name}`); }
  catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); }
};
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };
const rows = async (t, where) => ((await get(`${t}?where=${encodeURIComponent(where)}&limit=300`)).rows || []).filter((r) => !r.deleted_at);
const n = (v) => Number(v) || 0;
const s = (v) => (v == null ? "" : String(v));
const today = new Date().toISOString().slice(0, 10);
const reason = "ZZT drive";

/** Warehouse node ids by "<warehouse purpose> ▸ <bay>" — the leaves the pickers offer. */
async function bays() {
  const all = (await get("Warehouse?limit=300")).rows || [];
  const top = all.filter((w) => !w.parent);
  const byPurpose = (p) => top.find((w) => s(w.purposes).split(",").map((x) => x.trim()).includes(p));
  const bay = (w, code) => {
    const hit = w && all.find((x) => s(x.parent) === s(w.ROWID) && s(x.name) === code);
    if (!hit) throw new Error(`need ${w ? s(w.name) : "a warehouse"} ▸ ${code} on live (generate the grid first)`);
    return s(hit.ROWID);
  };
  const prod = byPurpose("Production"), pal = byPurpose("Palletization"), lb = byPurpose("Loading Bay");
  return { PROD_A1: bay(prod, "A1"), PROD_B3: bay(prod, "B3"), PROD_C4: bay(prod, "C4"), PAL_A1: bay(pal, "A1"), LB_A1: bay(lb, "A1"), LB_A2: bay(lb, "A2") };
}

async function production(stamp, W) {
  const batch1 = `ZZT/${stamp}/001`;
  const batch2 = `ZZT/${stamp}/002`;
  const records = async () => (await rows("ProductionLog", `design=${made.design}`)).filter((r) => r.entry_type === "record");

  await check("seed: batched ZZT item", async () => {
    const d = await post("Design", { design_name: `ZZT LOC ${stamp}`, unique_name: `ZZT LOC ${stamp}`, sku: `ZZTLOC${stamp}`, is_batched: true, status: "Active" });
    made.design = String(d.rowid);
  });

  await check("CR-411 bulk sheet path: /production-log + /production-complete {warehouse} → record row at Production ▸ B3", async () => {
    const req = await post("production-log", { lines: [{ design: made.design, qty_requested: 30 }], production_date: today, performed_by: "ZZT", stage: "InProduction" });
    const id = String((req.data?.ids || [])[0] || "");
    if (!id) throw new Error("no plan id back");
    await post("production-complete", { lines: [{ id, qty_boxes: 30, batch_number: batch1 }], production_date: today, performed_by: "ZZT", warehouse: W.PROD_B3 });
    const rec = (await records()).find((r) => s(r.batch_number) === batch1);
    if (!rec) throw new Error("no record row for batch 1");
    eq(s(rec.warehouse), W.PROD_B3, "record.warehouse");
  });

  await check("CR-411 Record Output path: /production-record {warehouse} → record row at Production ▸ C4", async () => {
    const req = await post("production-log", { lines: [{ design: made.design, qty_requested: 20 }], production_date: today, performed_by: "ZZT", stage: "InProduction" });
    const id = String((req.data?.ids || [])[0] || "");
    await post(`production-record/${id}`, { qty_boxes: 20, production_date: today, performed_by: "ZZT", batch_number: batch2, warehouse: W.PROD_C4 });
    const rec = (await records()).find((r) => s(r.batch_number) === batch2);
    if (!rec) throw new Error("no record row for batch 2");
    eq(s(rec.warehouse), W.PROD_C4, "record.warehouse");
  });
  return batch1;
}

async function palletization(stamp, customer, W, batch) {
  const pallet = ((await get("Pallet?limit=1")).rows || [])[0];
  if (!pallet) throw new Error("need one Pallet on live");
  const lines = async () => (await rows("PalletizationPlanLine", `sales_order=${made.so}`)).sort((a, b) => (a.ROWID < b.ROWID ? -1 : 1));
  const oi = async () => (await rows("OrderItem", `sales_order=${made.so}`))[0];
  let line, slice;

  await check("seed: SO 80 + allocate 30 (all of batch 1) → one Planning line with no location", async () => {
    const so = await post("so-with-items", {
      customer: customer.name, po_number: `ZZT-PO-${stamp}`, order_date: today,
      lines: [{ item: `ZZT LOC ${stamp}`, qty: 80, rate: 1, pallet: String(pallet.ROWID) }],
    });
    made.so = String(so.rowid);
    await post("allocate-stock", { order_item: String((await oi()).ROWID), rows: [{ batch_number: batch, qty_boxes: 30 }] });
    const ls = await lines();
    eq(ls.length, 1, "Planning lines");
    eq(s(ls[0].status), "Planning", "status");
    eq(s(ls[0].warehouse), "", "no location yet");
    line = ls[0];
  });

  await check("CR-412 Start: /pal-line-status Palletizing {warehouse} → line at Palletization ▸ A1", async () => {
    await post(`pal-line-status/${line.ROWID}`, { status: "Palletizing", pallet: String(pallet.ROWID), warehouse: W.PAL_A1 });
    const l = (await lines())[0];
    eq(s(l.status), "Palletizing", "status");
    eq(s(l.warehouse), W.PAL_A1, "line.warehouse");
  });

  await check("CR-412 partial Complete: 20 of 30 → slice Ready for Loading at Loading Bay ▸ A1; remainder back to Planning", async () => {
    const r = await post(`pal-line-status/${line.ROWID}`, { status: "ReadyToLoad", pallet: String(pallet.ROWID), boxes: 20, warehouse: W.LB_A1 });
    const sliceId = String(r.rowid || r.data?.ROWID || "");
    if (!sliceId || sliceId === String(line.ROWID)) throw new Error("no split slice returned");
    const ls = await lines();
    slice = ls.find((x) => String(x.ROWID) === sliceId);
    const rem = ls.find((x) => String(x.ROWID) === String(line.ROWID));
    if (!slice || !rem) throw new Error("slice / remainder missing");
    eq(s(slice.status), "ReadyToLoad", "slice status");
    eq(n(slice.boxes), 20, "slice boxes");
    eq(s(slice.warehouse), W.LB_A1, "slice.warehouse");
    eq(s(rem.status), "Planning", "remainder re-queued (CR-281)");
    eq(n(rem.boxes), 10, "remainder boxes");
  });

  await check("CR-412 Set Location: generic PATCH moves the slice to Loading Bay ▸ A2, then clears it", async () => {
    await patch(`PalletizationPlanLine/${slice.ROWID}`, { warehouse: W.LB_A2 });
    eq(s((await lines()).find((x) => String(x.ROWID) === String(slice.ROWID)).warehouse), W.LB_A2, "moved");
    await patch(`PalletizationPlanLine/${slice.ROWID}`, { warehouse: null });
    eq(s((await lines()).find((x) => String(x.ROWID) === String(slice.ROWID)).warehouse), "", "cleared");
    await patch(`PalletizationPlanLine/${slice.ROWID}`, { warehouse: W.LB_A1 });
  });

  await check("CR-412 load into a container keeps the column (client shows —); remainder of a partial load keeps the location", async () => {
    const b = await post("load-box", { container_number: `ZZTU${stamp}` });
    made.box = String(b.rowid);
    const r = await post(`pal-line-box/${slice.ROWID}`, { box: made.box, boxes: 5 }); // partial load → 15 stay Ready
    void r;
    const ls = await lines();
    const loaded = ls.find((x) => String(x.ROWID) === String(slice.ROWID));
    const rest = ls.find((x) => s(x.status) === "ReadyToLoad" && !x.load_box);
    eq(s(loaded.load_box), made.box, "loaded into the box");
    if (!rest) throw new Error("no Ready remainder after the partial load");
    eq(n(rest.boxes), 15, "remainder boxes");
    eq(s(rest.warehouse), W.LB_A1, "remainder keeps Loading Bay ▸ A1");
  });
}

async function panelForm(stamp, customer, W) {
  await check("CR-413 panel order form: save with {warehouse} → set; save with \"\" → cleared", async () => {
    const panel = ((await get("Panel?limit=1")).rows || [])[0];
    if (!panel) throw new Error("need one Panel on live");
    const r = await post("panel-order-save", { customer: String(customer.ROWID), salesperson: "ZZT", order_date: today, warehouse: W.PROD_A1, lines: [{ panel: String(panel.ROWID), qty: 1 }] });
    made.panelOrder = String(r.rowid);
    eq(s((await rows("PanelOrder", `ROWID=${made.panelOrder}`))[0].warehouse), W.PROD_A1, "warehouse set on create");
    await post("panel-order-save", { rowid: made.panelOrder, customer: String(customer.ROWID), salesperson: "ZZT", order_date: today, warehouse: "", lines: [{ panel: String(panel.ROWID), qty: 1 }] });
    eq(s((await rows("PanelOrder", `ROWID=${made.panelOrder}`))[0].warehouse), "", "warehouse cleared on edit");
  });
}

async function main() {
  const me = await get("auth/me");
  console.log(`· token user ${me.user?.email || "?"} (${me.user?.role || "?"})`);
  const stamp = Date.now().toString(36).toUpperCase();
  const customer = ((await get("Customer?limit=1")).rows || [])[0];
  if (!customer) throw new Error("need one Customer on live");
  const W = await bays();
  const batch = await production(stamp, W);
  await palletization(stamp, customer, W, batch);
  await panelForm(stamp, customer, W);
}

async function teardown() {
  console.log("· teardown");
  const hard = async (t, id) => del(`${t}/${id}?hard=1`).catch((e) => console.log(`  (skip ${t}/${id}: ${e.message})`));
  if (made.panelOrder) {
    for (const l of (await get(`PanelOrderLine?where=panel_order%3D${made.panelOrder}&limit=50`).catch(() => ({ rows: [] }))).rows || []) await hard("PanelOrderLine", l.ROWID);
    await hard("PanelOrder", made.panelOrder);
  }
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
  if (made.box) await post(`load-box-delete/${made.box}`, { reason }).catch((e) => console.log(`  (skip box: ${e.message})`));
  if (made.design) {
    for (const r of (await get(`ProductionLog?where=design%3D${made.design}&limit=300`).catch(() => ({ rows: [] }))).rows || []) await hard("ProductionLog", r.ROWID);
    await hard("Design", made.design);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { fail++; console.error("✗ drive aborted:", e.message); })
  .finally(() => teardown().then(() => process.exit(fail ? 1 : 0)));
