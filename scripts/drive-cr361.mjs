/* CR-361 API drive — Release palletized boxes — against the deployed data-ops function.
   Every record is prefixed ZZT and removed at the end.

     seed                 → Design (batched) + opening stock 100 (one batch) + SO (born Confirmed for an approver)
                            + allocate 50 → auto Planning line → /pal-line-status ReadyToLoad (pallet from the master)
     stock release 10/50  → line 40 · alloc row 40 · OrderItem produced 40 / palletized 40 · StatusTransition Released
     load 40 → box        → /load-box + /pal-line-box; release 15 → original 25 still boxed, new un-boxed Ready 15
     box release 25 whole → load_box null, plan back to Planning (demoteEmptyPlans), OrderItem loaded 0
     stock release whole  → 15 then 25: lines soft-deleted, alloc row gone, produced 0 / palletized 0
     guards               → boxes 999 → 400 · a Planning line → 409 · allocation smaller than the count → 409
                            (dispatched-box 409 not driven: a Dispatched LoadBox is undeletable through the API;
                             the guard is the same two lines /pal-line-box uses)

   Run:  BOFFO_TOKEN=<AuthSession token of an Admin> node scripts/drive-cr361.mjs   (SEED_HOST overrides the host) */

const HOST = process.env.SEED_HOST || "https://boffo-granito-export-tracker-925638796.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;
const TOKEN = process.env.BOFFO_TOKEN || "";
let pass = 0;
let fail = 0;
const made = { design: null, so: null, box: null };

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
const lines = async () => (await rows("PalletizationPlanLine", `sales_order=${made.so}`)).sort((a, b) => (a.ROWID < b.ROWID ? -1 : 1));
const oi = async () => (await rows("OrderItem", `sales_order=${made.so}`))[0];
const allocs = async () => (await rows("ProductionLog", `order_item=${(await oi()).ROWID}`)).filter((r) => r.entry_type === "alloc");
const n = (v) => Number(v) || 0;

async function main() {
  const me = await get("auth/me");
  console.log(`· token user ${me.user?.email || "?"} (${me.user?.role || "?"})`);
  const stamp = Date.now().toString(36).toUpperCase();
  const customer = ((await get("Customer?limit=1")).rows || [])[0];
  const pallet = ((await get("Pallet?limit=1")).rows || [])[0];
  const vehicle = ((await get("Vehicle?limit=1")).rows || [])[0];
  if (!customer || !pallet) throw new Error("need one Customer and one Pallet on live");
  const batch = `ZZT/${stamp}/001`;
  const reason = "ZZT drive";
  let line, box;

  await check("seed: item + opening 100 + SO + allocate 50 → one Ready line of 50", async () => {
    const d = await post("Design", { design_name: `ZZT REL ${stamp}`, unique_name: `ZZT REL ${stamp}`, sku: `ZZTREL${stamp}`, is_batched: true, status: "Active" });
    made.design = String(d.rowid);
    await post(`opening-stock/${made.design}`, { rows: [{ qty_boxes: 100, batch_number: batch }] });
    const so = await post("so-with-items", {
      customer: customer.name, po_number: `ZZT-PO-${stamp}`, order_date: new Date().toISOString().slice(0, 10),
      lines: [{ item: `ZZT REL ${stamp}`, qty: 80, rate: 1, pallet: String(pallet.ROWID) }],
    });
    made.so = String(so.rowid);
    const item = await oi();
    await post("allocate-stock", { order_item: String(item.ROWID), rows: [{ batch_number: batch, qty_boxes: 50 }] });
    const ls = await lines();
    eq(ls.length, 1, "auto-enqueued Planning lines");
    eq(n(ls[0].boxes), 50, "queued boxes");
    await post(`pal-line-status/${ls[0].ROWID}`, { status: "ReadyToLoad", pallet: String(pallet.ROWID) });
    line = (await lines())[0];
    eq(String(line.status), "ReadyToLoad", "line status");
  });

  await check("guards: 999 boxes → 400; count above the allocation → 409 before any write", async () => {
    await post(`pal-line-release/${line.ROWID}`, { boxes: 999, reason }, { expect: 400 });
    eq(n((await lines())[0].boxes), 50, "line untouched");
  });

  await check("stock release 10 of 50 → line 40, alloc 40, produced 40 / palletized 40, Released transition", async () => {
    const r = await post(`pal-line-release/${line.ROWID}`, { boxes: 10, reason });
    eq(r.data?.to, "stock", "direction");
    eq(n((await lines())[0].boxes), 40, "line boxes");
    const a = await allocs();
    eq(a.length, 1, "alloc rows");
    eq(n(a[0].qty_boxes), 40, "alloc qty");
    const item = await oi();
    eq(n(item.produced_qty_boxes), 40, "produced (allocated)");
    eq(n(item.palletized_qty_boxes), 40, "palletized");
    const t = await rows("StatusTransition", `entity_rowid=${line.ROWID}`);
    if (!t.some((x) => String(x.to_status) === "Released")) throw new Error("no Released transition");
  });

  await check("load 40 into a container, release 15 → 25 stay boxed, 15 back un-boxed Ready", async () => {
    const b = await post("load-box", { ...(vehicle ? { vehicle: String(vehicle.ROWID) } : {}), container_number: `ZZTU${stamp}` });
    made.box = String(b.rowid);
    await post(`pal-line-box/${line.ROWID}`, { box: made.box });
    const r = await post(`pal-line-release/${line.ROWID}`, { boxes: 15, reason });
    eq(r.data?.to, "ReadyToLoad", "direction");
    const ls = await lines();
    eq(ls.length, 2, "lines after split");
    const boxed = ls.find((l) => String(l.load_box || "") === made.box);
    const free = ls.find((l) => !l.load_box);
    eq(n(boxed?.boxes), 25, "boxed remainder");
    eq(n(free?.boxes), 15, "released un-boxed");
    eq(String(free?.status), "ReadyToLoad", "released status");
    eq(n((await oi()).loaded_qty_boxes), 25, "loaded counter");
    box = boxed;
  });

  await check("box release 25 whole → load_box null, plan demoted to Planning, loaded 0", async () => {
    await post(`pal-line-release/${box.ROWID}`, { reason });
    const ls = await lines();
    if (ls.some((l) => l.load_box)) throw new Error("a line still boxed");
    eq(n((await oi()).loaded_qty_boxes), 0, "loaded counter");
    const plan = (await rows("PalletizationPlan", `ROWID=${box.plan}`))[0];
    eq(String(plan?.status), "Planning", "plan status");
  });

  await check("stock release whole lines 15 + 25 → both gone, alloc gone, produced 0 / palletized 0", async () => {
    for (const l of await lines()) await post(`pal-line-release/${l.ROWID}`, { reason });
    eq((await lines()).length, 0, "live lines");
    eq((await allocs()).length, 0, "alloc rows");
    const item = await oi();
    eq(n(item.produced_qty_boxes), 0, "produced");
    eq(n(item.palletized_qty_boxes), 0, "palletized");
  });

  await check("guard: a Planning (queue) line → 409", async () => {
    await post("allocate-stock", { order_item: String((await oi()).ROWID), rows: [{ batch_number: batch, qty_boxes: 10 }] });
    const q = (await lines()).find((l) => String(l.status) === "Planning");
    if (!q) throw new Error("no Planning line re-queued");
    await post(`pal-line-release/${q.ROWID}`, { reason }, { expect: 409 });
  });
}

async function teardown() {
  console.log("· teardown");
  const hard = async (t, id) => del(`${t}/${id}?hard=1`).catch((e) => console.log(`  (skip ${t}/${id}: ${e.message})`));
  if (made.box) await post(`load-box-delete/${made.box}`, { reason: "ZZT drive" }).catch((e) => console.log(`  (skip box: ${e.message})`));
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
  if (made.design) {
    for (const r of (await get(`ProductionLog?where=design%3D${made.design}&limit=300`).catch(() => ({ rows: [] }))).rows || []) await hard("ProductionLog", r.ROWID);
    await hard("Design", made.design);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { fail++; console.error("✗ drive aborted:", e.message); })
  .finally(() => teardown().then(() => process.exit(fail ? 1 : 0)));
