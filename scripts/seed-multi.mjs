/* Multi-container demo fixture: ONE dummy customer whose order walks the whole
   chain with every stage left in a mixed state. Drives the LIVE data-ops sagas
   the way the UI does, so every counter lands the way the app computes it.

     masters         → POST Design ×2 (ZZT, batched), POST Vehicle, POST Customer
     opening stock   → POST /opening-stock/:design   (3 + 2 batches)
     sales order     → POST /so-with-items           (+ 2-container plan: two formats,
                                                       one item split, one mixed container)
     allocate        → POST /allocate-stock          (auto-queues one PAL plan, a line per batch)
     palletise       → POST /pal-line-status/:line   full · PARTIAL (60 of 100) · one left Palletizing
     load            → POST /load-box ×2 + /pal-lines-box   C1 FULL 480/480 (one line split 180+20)
                                                            C2 PARTIAL 260/540, siblings via load_plan.group
     dispatch        → POST /load-box-dispatch/C1    C2 stays Open
     status          → POST /so-status InProgress

   Run:      BOFFO_TOKEN=<admin AuthSession> node scripts/seed-multi.mjs
             (or BOFFO_EMAIL=… BOFFO_PASSWORD=…)   SEED_HOST overrides the host.
   Teardown: node scripts/seed-multi.mjs --teardown
   Quantities live in PLAN below; the state file keeps every minted ROWID so a
   half-run resumes and teardown is exact. */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";

const HOST =
  process.env.SEED_HOST ||
  "https://boffo-granito-export-tracker-925638796.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;
// Matches the .gitignore pattern scripts/.seed-flow-state*.json
const STATE_FILE = new URL("./.seed-flow-state-multi.json", import.meta.url).pathname;

const PLAN = {
  customer: { code: "ZZT-MULTI", name: "ZZT Multi Container Exports" },
  vehicle: { vehicle_number: "GJ-01-ZZ-0001", driver_name: "ZZT Driver", mobile_number: "+919999900000" },
  // Opening-stock batches (boxes) and the order qty per item. Batch qtys are
  // distinct per item so the minted batch numbers can be matched back by qty.
  designs: {
    alpha: { unique: "ZZT Multi Alpha - 800x1600 - Glossy", name: "ZZT Multi Alpha", sku: "ZZTMA-800X1600", stock: [300, 200, 100], ordered: 600, rate: 9.5 },
    beta: { unique: "ZZT Multi Beta - 800x1600 - Glossy", name: "ZZT Multi Beta", sku: "ZZTMB-800X1600", stock: [200, 100], ordered: 300, rate: 8.75 },
  },
  palletBoxes: 48, // the pallet master (within the formats' size) every line packs on
  // The SO container plan AND the two loadings; formatBoxes picks the Container Master row.
  containers: [
    { formatBoxes: 480, number: "ZZTU0000001", lines: [{ design: "alpha", boxes: 480 }] },
    { formatBoxes: 540, number: "ZZTU0000002", lines: [{ design: "alpha", boxes: 120 }, { design: "beta", boxes: 300 }] },
  ],
  // Per batch (same index as `stock`): "all" → Ready, a number → that many Ready
  // (rest stays queued), "palletizing" → moved to In Palletization and left there.
  palletise: { alpha: ["all", "all", 60], beta: ["all", "palletizing"] },
  // What each container really loads: Ready lines by batch index, `boxes` < line = partial.
  load: [
    [{ design: "alpha", batch: 0 }, { design: "alpha", batch: 1, boxes: 180 }],
    [{ design: "alpha", batch: 2 }, { design: "beta", batch: 0 }],
  ],
  dispatch: [true, false],
};

let TOKEN = "";
async function call(method, path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    // Bearer is intercepted by the Catalyst gateway (401 before our function runs).
    headers: { "Content-Type": "application/json", ...(TOKEN ? { "X-App-Token": TOKEN } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { ok: false, error: text }; }
  if (!res.ok || json.ok === false) throw new Error(`${method} ${path} → HTTP ${res.status}: ${json.error || text}`);
  return json;
}
const get = (p) => call("GET", p);
const post = (p, b) => call("POST", p, b);
const del = (p) => call("DELETE", p);
const rows = (j) => j.rows || (j.row ? [j.row] : []);
const one = (j) => j.row || (j.rows || [])[0] || null;
const log = (...a) => console.log(...a);
const n = (v) => Number(v) || 0;
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const plusDays = (d) => new Date(Date.now() + (5.5 + d * 24) * 3600 * 1000).toISOString().slice(0, 10);

const S = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(S, null, 2));

async function login() {
  if (process.env.BOFFO_TOKEN) {
    TOKEN = process.env.BOFFO_TOKEN;
    const me = await get("auth/me");
    log(`· using supplied token — ${me.user?.email || "?"} (${me.user?.role || "?"})`);
    return;
  }
  const email = process.env.BOFFO_EMAIL, password = process.env.BOFFO_PASSWORD;
  if (!email || !password) throw new Error("Set BOFFO_TOKEN, or BOFFO_EMAIL and BOFFO_PASSWORD (an Admin app user)");
  TOKEN = (await post("auth/login", { email, password })).token;
  log(`· signed in as ${email}`);
}

/* ---------------- masters ---------------- */

/** Container formats by total_boxes (must share one Size) + that size's pallet. Reused, never created. */
async function masters() {
  const formats = rows(await get("ContainerFormat?columns=ROWID,name,size,total_pallets,total_boxes&limit=300"));
  const byBoxes = new Map(formats.map((f) => [n(f.total_boxes), f]));
  const picked = PLAN.containers.map((c) => {
    const f = byBoxes.get(c.formatBoxes);
    if (!f) throw new Error(`No Container Master format with ${c.formatBoxes} boxes (have: ${formats.map((x) => x.total_boxes).join(", ")})`);
    return f;
  });
  const size = String(picked[0].size || "");
  if (!size || picked.some((f) => String(f.size) !== size)) throw new Error("The picked container formats must share one Size");
  const pallet = rows(await get(`Pallet?where=size=${size}&columns=ROWID,name,boxes_per_pallet,size&limit=50`))
    .find((p) => n(p.boxes_per_pallet) === PLAN.palletBoxes);
  if (!pallet) throw new Error(`No ${PLAN.palletBoxes}-box pallet for size ${size}`);
  log(`· masters: formats ${picked.map((f) => f.name).join(" | ")} · pallet ${pallet.name}`);
  return { formats: picked, size, pallet };
}

async function seedMasters(m) {
  S.designs = S.designs || {};
  for (const [key, d] of Object.entries(PLAN.designs)) {
    if (S.designs[key]) continue;
    const existing = one(await get(`Design?where=unique_name='${d.unique}'&columns=ROWID&limit=1`));
    const id = existing ? existing.ROWID : (await post("Design", {
      design_name: d.name, base_design_name: d.name, unique_name: d.unique, sku: d.sku,
      size: m.size, is_batched: true, status: "Active", box_weight_kg: 50, pcs_per_box: 2,
    })).rowid;
    S.designs[key] = String(id); save();
    log(`· design ${d.unique} ${id}`);
  }
  if (!S.vehicle) {
    const v = rows(await get("Vehicle?columns=ROWID,vehicle_number&limit=300")).find((x) => x.vehicle_number === PLAN.vehicle.vehicle_number);
    S.vehicle = String(v ? v.ROWID : (await post("Vehicle", PLAN.vehicle)).rowid); save();
    log(`· vehicle ${PLAN.vehicle.vehicle_number} ${S.vehicle}`);
  }
  if (!S.customer) {
    const c = one(await get(`Customer?where=code='${PLAN.customer.code}'&columns=ROWID&limit=1`));
    S.customer = String(c ? c.ROWID : (await post("Customer", {
      code: PLAN.customer.code, name: PLAN.customer.name, country_code: "PL", currency: "INR", active: true,
      overseas: "true", customer_type: "business", company_name: PLAN.customer.name,
      address: "ZZT demo record — safe to delete", port_of_discharge: "Gdansk",
      contact_first_name: "ZZT", contact_last_name: "Multi", contact_email: "zzt-multi@example.invalid",
      billing_country: "Poland", billing_city: "Warsaw", shipping_country: "Poland", shipping_city: "Warsaw",
    })).rowid); save();
    log(`· customer ${PLAN.customer.code} ${S.customer}`);
  }
}

/* ---------------- stock ---------------- */

async function openingStock() {
  S.batches = S.batches || {};
  for (const [key, d] of Object.entries(PLAN.designs)) {
    if (S.batches[key]) continue;
    const id = S.designs[key];
    // Batch numbers left blank → the server mints B/YYYY-MM/NNN; read them back by qty.
    const have = rows(await get(`ProductionLog?where=design=${id}&limit=300`)).filter((r) => r.entry_type === "opening");
    if (!have.length) await post(`opening-stock/${id}`, { rows: d.stock.map((q, i) => ({ qty_boxes: q, mfg_date: plusDays(-7 + i), note: `ZZT opening ${i + 1}` })) });
    const opening = rows(await get(`ProductionLog?where=design=${id}&limit=300`)).filter((r) => r.entry_type === "opening");
    S.batches[key] = d.stock.map((q) => {
      const i = opening.findIndex((r) => n(r.qty_boxes) === q);
      if (i < 0) throw new Error(`No opening batch of ${q} boxes on ${d.unique}`);
      return String(opening.splice(i, 1)[0].batch_number);
    });
    save();
    log(`· ${d.name} opening stock ${d.stock.join(" + ")} → ${S.batches[key].join(", ")}`);
  }
}

/* ---------------- order + plan ---------------- */

/** The SO container plan — same JSON PlanContainerisation saves (ContainerPlan, boxes mode, CR-300 shape). */
function containerPlan(m) {
  const bpp = PLAN.palletBoxes;
  return JSON.stringify({
    v: 1,
    mode: "boxes",
    containers: PLAN.containers.map((c, i) => {
      const f = m.formats[i];
      const lines = c.lines.map((l) => ({
        design: PLAN.designs[l.design].unique, palletId: String(m.pallet.ROWID), palletName: m.pallet.name,
        pallets: Math.ceil(l.boxes / bpp), boxes: l.boxes,
      }));
      const pallets = lines.reduce((s, l) => s + l.pallets, 0);
      const boxes = lines.reduce((s, l) => s + l.boxes, 0);
      return {
        no: i + 1, fillPct: Math.round((pallets / n(f.total_pallets)) * 100), pallets, boxes,
        tonnes: Math.round((boxes * 50) / 100) / 10,
        palletCapacity: n(f.total_pallets), containerFormat: String(f.ROWID), containerFormatName: f.name, lines,
      };
    }),
  });
}

async function seedOrder(m) {
  if (S.so) return;
  const r = await post("so-with-items", {
    customer: PLAN.customer.name,
    po_number: "ZZT-PO-MULTI",
    order_date: today(),
    shipment_date: plusDays(21),
    currency: "INR",
    exchange_rate: 1,
    remarks: "ZZT demo — multi-container fixture (seed-multi.mjs)",
    container_plan: containerPlan(m),
    lines: Object.values(PLAN.designs).map((d) => ({ item: d.unique, qty: d.ordered, rate: d.rate, rate_basis: "box", pallet: String(m.pallet.ROWID) })),
  });
  S.so = String(r.rowid); S.so_number = r.data?.order_number; save();
  // Born Confirmed for an approver; otherwise walk the approval machine.
  let so = one(await get(`SalesOrder/${S.so}`));
  for (const st of ["PendingApproval", "Confirmed"]) {
    if (["Confirmed", "InProgress"].includes(so.status)) break;
    await post(`so-status/${S.so}`, { status: st });
    so = one(await get(`SalesOrder/${S.so}`));
  }
  log(`· ${S.so_number} ${S.so} → ${so.status} (plan: ${PLAN.containers.length} containers)`);
}

async function allocate() {
  if (S.allocated) return;
  const items = rows(await get(`OrderItem?where=sales_order=${S.so}&limit=50`));
  for (const [key, d] of Object.entries(PLAN.designs)) {
    const oi = items.find((it) => String(it.design) === S.designs[key]);
    if (!oi) throw new Error(`No order line for ${d.unique}`);
    if (n(oi.produced_qty_boxes) >= d.ordered) continue;
    await post("allocate-stock", { order_item: String(oi.ROWID), rows: S.batches[key].map((b, i) => ({ batch_number: b, qty_boxes: d.stock[i] })) });
    log(`· ${d.name} allocated ${d.stock.join(" + ")} → queued for palletization`);
  }
  S.allocated = true; save();
}

/* ---------------- palletise ---------------- */

async function palletise(m) {
  if (S.ready) return;
  const lines = rows(await get(`PalletizationPlanLine?where=sales_order=${S.so}&limit=300`));
  const pallet = String(m.pallet.ROWID);
  S.ready = {};
  for (const [key, steps] of Object.entries(PLAN.palletise)) {
    S.ready[key] = [];
    for (let i = 0; i < steps.length; i++) {
      const batch = S.batches[key][i];
      const line = lines.find((l) => String(l.design) === S.designs[key] && l.batch_number === batch && l.status === "Planning");
      if (!line) throw new Error(`No queued line for ${key} batch ${batch}`);
      const step = steps[i];
      if (step === "palletizing") {
        await post(`pal-line-status/${line.ROWID}`, { status: "Palletizing", pallet });
        S.ready[key].push(null);
        log(`· ${PLAN.designs[key].name} ${batch}: ${line.boxes} boxes → In Palletization (left there)`);
      } else if (step === "all") {
        await post(`pal-line-status/${line.ROWID}`, { status: "ReadyToLoad", pallet });
        S.ready[key].push(String(line.ROWID));
        log(`· ${PLAN.designs[key].name} ${batch}: ${line.boxes} boxes → Ready for Loading`);
      } else {
        // Partial: the moved slice is a NEW line (returned rowid); the rest stays queued.
        const r = await post(`pal-line-status/${line.ROWID}`, { status: "ReadyToLoad", pallet, boxes: step });
        S.ready[key].push(String(r.rowid));
        log(`· ${PLAN.designs[key].name} ${batch}: ${step} of ${line.boxes} → Ready, ${n(line.boxes) - step} still queued`);
      }
    }
  }
  save();
}

/* ---------------- load + dispatch ---------------- */

async function load(m) {
  S.boxes = S.boxes || [];
  const total = PLAN.containers.length;
  for (let i = 0; i < total; i++) {
    if (S.boxes[i]) continue;
    const c = PLAN.containers[i];
    const picks = [];
    for (const p of PLAN.load[i]) {
      const id = S.ready[p.design][p.batch];
      if (!id) throw new Error(`${p.design} batch ${p.batch} is not Ready`);
      const line = one(await get(`PalletizationPlanLine/${id}`));
      picks.push({ id, design: p.design, boxes: p.boxes ?? n(line.boxes), line });
    }
    const loadPlan = (group) => JSON.stringify({
      v: 1,
      lines: picks.map((p) => ({ so: S.so, design: PLAN.designs[p.design].unique, batch: p.line.batch_number || "", boxes: p.boxes, palletId: String(m.pallet.ROWID) })),
      ...(group ? { group } : {}),
      plan: { [S.so]: i }, // CR-338: this loading claims plan container C(i+1)
    });
    const b = await post("load-box", {
      vehicle: S.vehicle,
      container_format: String(m.formats[i].ROWID),
      container_number: c.number,
      container_size: "40HC",
      line_seal: `ZZT-LS-000${i + 1}`,
      electronic_seal: `ZZT-ES-000${i + 1}`,
      loading_supervisor: "ZZT Supervisor",
      transporter: "ZZT Logistics",
      lr_number: `ZZT-LR-000${i + 1}`,
      destination: "Gdansk",
      dispatch_date: today(),
      // Siblings carry the group from birth; the primary's slice is patched in after (its ROWID is the group id).
      load_plan: loadPlan(i > 0 ? { id: S.boxes[0], no: i + 1, of: total } : undefined),
    });
    S.boxes[i] = String(b.rowid); S.loads = [...(S.loads || []), b.data?.load_number]; save();
    await post("pal-lines-box", { box: S.boxes[i], lines: picks.map((p) => ({ id: p.id, ...(p.boxes < n(p.line.boxes) ? { boxes: p.boxes } : {}) })) });
    const sum = picks.reduce((s, p) => s + p.boxes, 0);
    log(`· ${b.data?.load_number} C${i + 1} (${m.formats[i].name}) loaded ${sum} / ${c.formatBoxes} boxes${sum >= c.formatBoxes ? " — FULL" : " — partial"}`);
    if (i === total - 1) {
      // Primary's own slice: group {id: self, no: 1, of: n} — same patch LoadingSession does last.
      const first = one(await get(`LoadBox/${S.boxes[0]}`));
      const lp = JSON.parse(first.load_plan || "{}");
      await post(`load-box-update/${S.boxes[0]}`, { load_plan: JSON.stringify({ ...lp, group: { id: S.boxes[0], no: 1, of: total } }) });
    }
  }
  S.dispatched = S.dispatched || [];
  for (let i = 0; i < total; i++) {
    if (!PLAN.dispatch[i] || S.dispatched[i]) continue;
    await post(`load-box-dispatch/${S.boxes[i]}`, {});
    S.dispatched[i] = true; save();
    log(`· C${i + 1} dispatched`);
  }
  if (!S.inprogress) {
    const so = one(await get(`SalesOrder/${S.so}`));
    if (so.status === "Confirmed") await post(`so-status/${S.so}`, { status: "InProgress" });
    S.inprogress = true; save();
  }
}

/* ---------------- flow map ---------------- */

const pad = (v, w) => String(v).padStart(w);

async function flowMap() {
  const cust = one(await get(`Customer/${S.customer}`));
  const so = one(await get(`SalesOrder/${S.so}`));
  const plan = JSON.parse(so.container_plan || '{"containers":[]}');
  const items = rows(await get(`OrderItem?where=sales_order=${S.so}&limit=50`));
  const lines = rows(await get(`PalletizationPlanLine?where=sales_order=${S.so}&limit=300`));
  const planIds = [...new Set(lines.map((l) => String(l.plan)).filter(Boolean))];
  const pals = [];
  for (const id of planIds) pals.push(one(await get(`PalletizationPlan/${id}`)));
  const boxes = [];
  for (const id of S.boxes) boxes.push(one(await get(`LoadBox/${id}`)));

  log("");
  log(`${cust.name}  (${cust.code})`);
  log(`└─ ${so.order_number}  ${so.status}   plan: ${plan.containers.map((c) => `C${c.no} ${c.containerFormatName} ${c.boxes} boxes ${c.fillPct}%`).join(" | ")}`);
  log(`   ├─ ${pals.map((p) => `${p.pal_number} ${p.status}`).join(", ") || "no PAL plan"}`);
  let bad = 0;
  for (const it of items) {
    const key = Object.keys(PLAN.designs).find((k) => S.designs[k] === String(it.design));
    const d = key ? PLAN.designs[key] : null;
    const c = { o: n(it.ordered_qty_boxes), p: n(it.produced_qty_boxes), pal: n(it.palletized_qty_boxes), l: n(it.loaded_qty_boxes), dsp: n(it.dispatched_qty_boxes) };
    log(`   │    ${(d?.name || "?").padEnd(16)} ordered ${pad(c.o, 4)}  produced ${pad(c.p, 4)}  palletized ${pad(c.pal, 4)}  loaded ${pad(c.l, 4)}  dispatched ${pad(c.dsp, 4)}  stage ${it.stage}`);
    if (!(c.dsp <= c.l && c.l <= c.pal && c.pal <= c.p && c.p <= c.o)) { log(`   │    ✗ counter chain violated on OrderItem ${it.ROWID}`); bad++; }
    const mine = lines.filter((l) => String(l.order_item) === String(it.ROWID));
    const sum = (st, boxed) => mine.filter((l) => l.status === st && (boxed === undefined || Boolean(l.load_box) === boxed)).reduce((s, l) => s + n(l.boxes), 0);
    log(`   │       queued ${sum("Planning")} · palletizing ${sum("Palletizing")} · ready (unloaded) ${sum("ReadyToLoad", false)} · in containers ${sum("ReadyToLoad", true)}`);
  }
  for (const [i, b] of boxes.entries()) {
    const inBox = lines.filter((l) => String(l.load_box) === String(b.ROWID)).reduce((s, l) => s + n(l.boxes), 0);
    const grp = JSON.parse(b.load_plan || "{}").group || {};
    log(`   ${i === boxes.length - 1 ? "└─" : "├─"} ${b.load_number}  C${grp.no ?? "?"}/${grp.of ?? "?"}  ${b.status.padEnd(10)} ${b.container_number}  ${inBox} / ${PLAN.containers[i].formatBoxes} boxes`);
  }
  log("");
  if (bad) throw new Error(`${bad} order line(s) break ordered ≥ produced ≥ palletized ≥ loaded ≥ dispatched`);
}

/* ---------------- teardown ---------------- */

async function teardown() {
  const hard = async (table, id) => {
    try { await del(`${table}/${id}?hard=1`); log(`  − ${table} ${id}`); }
    catch (e) { log(`  ! ${table} ${id}: ${e.message}`); }
  };
  // Open containers first (lines fall back to Ready); a Dispatched one is API-undeletable.
  for (const [i, id] of (S.boxes || []).entries()) {
    if (!id) continue;
    if (S.dispatched?.[i]) { log(`  ⚠ LoadBox ${id} is Dispatched — finish with ZCQL: DELETE FROM LoadBox WHERE ROWID = ${id}`); continue; }
    try { await post(`load-box-delete/${id}`, { reason: "ZZT seed teardown" }); log(`  − LoadBox ${id}`); } catch (e) { log(`  ! LoadBox ${id}: ${e.message}`); }
  }
  if (S.so) {
    const lines = rows(await get(`PalletizationPlanLine?where=sales_order=${S.so}&limit=300`));
    for (const l of lines) await hard("PalletizationPlanLine", l.ROWID);
    for (const p of [...new Set(lines.map((l) => String(l.plan)).filter(Boolean))]) await hard("PalletizationPlan", p);
    for (const it of rows(await get(`OrderItem?where=sales_order=${S.so}&limit=50`))) {
      for (const r of rows(await get(`ProductionLog?where=order_item=${it.ROWID}&limit=300`))) await hard("ProductionLog", r.ROWID);
      await hard("OrderItem", it.ROWID);
    }
    await hard("SalesOrder", S.so);
  }
  if (S.customer) await hard("Customer", S.customer);
  for (const id of Object.values(S.designs || {})) {
    for (const r of rows(await get(`ProductionLog?where=design=${id}&limit=300`))) await hard("ProductionLog", r.ROWID);
    await hard("Design", id);
  }
  if (S.vehicle) await hard("Vehicle", S.vehicle);
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  log("\nTeardown done. OperationLog / StatusTransition / OrderItemEvent rows are kept — they are the audit trail.");
}

/* ---------------- main ---------------- */

(async () => {
  await login();
  if (process.argv.includes("--teardown")) return teardown();
  const m = await masters();
  await seedMasters(m);
  await openingStock();
  await seedOrder(m);
  await allocate();
  await palletise(m);
  await load(m);
  await flowMap();
  log(`Seeded. Teardown: node scripts/seed-multi.mjs --teardown`);
})().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
