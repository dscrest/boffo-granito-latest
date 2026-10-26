/* DEMO flows seed — fills every module of the demo site with realistic dummy records, through the
   same data-ops routes the UI uses. Runs AFTER scripts/seed-demo-masters.mjs. Resumable: every
   minted id lands in scripts/.seed-flow-state-demo.json (gitignored) and finished steps are skipped.

     users      Role "Sales" (quotes/orders create+edit, no approvals) + sales.demo@octfis.com
     items      3 batched items (Calacatta Gold, Emperador Dark, Ash Wood)
     quotes     Draft · PendingApproval (by Sales → Approvals page + bell) · Sent · Accepted → partly converted
     orders     SO-A InProgress (produced, allocated, palletised part) · SO-B PendingApproval (by Sales, with a
                container plan) · SO-C Confirmed, nothing produced · SO-D fully loaded + dispatched (Completed)
     production make-to-stock job recorded (free stock) · job In Production · job at QC
     stock      adjustment (breakage) · transfer A1 → A2 · cut-piece adjustment + transfer
     samples    sample order, one line part-supplied
     containers 2 shipping-container records

   Run:  BOFFO_EMAIL=… BOFFO_PASSWORD=… node scripts/seed-demo-flows.mjs      (Admin)
         SEED_HOST defaults to the demo project; the live host is REFUSED. */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const HOST = process.env.SEED_HOST || "https://export-tracker-demo-925638796.development.catalystserverless.com";
if (/boffo-granito-export-tracker/.test(HOST)) throw new Error("Refusing to seed demo data into the LIVE project");
const BASE = `${HOST}/server/data-ops`;
const STATE_FILE = new URL("./.seed-flow-state-demo.json", import.meta.url).pathname;
const DEMO_PASSWORD = "Demo@1234";

let TOKEN = "";
async function call(method, path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
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
const rows = (j) => j.rows || (j.row ? [j.row] : []);
const one = (j) => j.row || (j.rows || [])[0] || null;
const log = (...a) => console.log(...a);
const n = (v) => Number(v) || 0;
const q = (s) => String(s).replace(/'/g, "''");
const day = (d) => new Date(Date.now() + (5.5 + d * 24) * 3600 * 1000).toISOString().slice(0, 10);
const today = () => day(0);

const S = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(S, null, 2));

async function loginAs(email, password) {
  TOKEN = (await post("auth/login", { email, password })).token;
}
/** Run `fn` signed in as the Sales user, then return to the Admin token. */
async function asSales(fn) {
  const admin = TOKEN;
  await loginAs(S.salesEmail, DEMO_PASSWORD);
  try { return await fn(); } finally { TOKEN = admin; }
}
const byName = async (table, key, value) => one(await get(`${table}?where=${key}='${q(value)}'&columns=ROWID,${key}&limit=1`));
const idOf = async (table, key, value) => {
  const r = await byName(table, key, value);
  if (!r) throw new Error(`${table} ${value} not found — run seed-demo-masters.mjs first`);
  return String(r.ROWID);
};

/* ---------------- masters we rely on ---------------- */
async function masters() {
  const m = {};
  m.size1600 = await idOf("Size", "code", "800x1600");
  m.size1200 = await idOf("Size", "code", "600x1200");
  m.pallet48 = await idOf("Pallet", "name", "P-48 800x1600");
  m.pallet40 = await idOf("Pallet", "name", "P-40 600x1200");
  const formats = rows(await get("ContainerFormat?columns=ROWID,name,total_boxes,total_pallets&limit=300"));
  m.format480 = formats.find((f) => n(f.total_boxes) === 480);
  if (!m.format480) throw new Error("No 480-box container format");
  m.vehicle = await idOf("Vehicle", "vehicle_number", "GJ-12-AB-4521");
  for (const c of ["DEMO-NOVA", "DEMO-ATLAS", "DEMO-RIO", "DEMO-BALTIC", "DEMO-KENYA"]) {
    const r = one(await get(`Customer?where=code='${c}'&columns=ROWID,name&limit=1`));
    if (!r) throw new Error(`Customer ${c} missing`);
    m[c] = { id: String(r.ROWID), name: r.name };
  }
  const wh = rows(await get("Warehouse?columns=ROWID,name,parent,is_primary&limit=300"));
  m.main = wh.find((w) => w.name === "Main Warehouse" && !w.parent);
  m.A1 = wh.find((w) => w.name === "A1" && String(w.parent) === String(m.main.ROWID));
  m.A2 = wh.find((w) => w.name === "A2" && String(w.parent) === String(m.main.ROWID));
  m.A3 = wh.find((w) => w.name === "A3" && String(w.parent) === String(m.main.ROWID));
  return m;
}

/* ---------------- users ---------------- */
async function users() {
  S.salesEmail = "sales.demo@octfis.com";
  if (!S.salesRole) {
    const list = await get("auth/roles");
    const have = (list.roles || list.rows || []).find((r) => r.name === "Sales");
    const only = (acts) => acts;
    S.salesRole = String(have ? have.rowid || have.ROWID : (await post("auth/roles", {
      name: "Sales",
      matrix: {
        modules: {
          quotes: only(["view", "create", "edit", "export"]), orders: only(["view", "create", "edit", "export"]),
          customers: ["view", "create", "edit", "export"], items: ["view", "export"], stages: ["view"],
          panel_craft: ["view"], invoices: ["view"], reports: ["view", "export"],
        },
        approve: [],
      },
    })).rowid); save();
    log(`· role Sales ${S.salesRole}`);
  }
  if (!S.salesUser) {
    const list = await get("auth/users");
    const have = (list.users || list.rows || []).find((u) => u.email === S.salesEmail);
    S.salesUser = String(have ? have.rowid || have.ROWID : (await post("auth/users", {
      email: S.salesEmail, name: "Priya Shah", password: DEMO_PASSWORD, role: S.salesRole,
    })).rowid); save();
    log(`· user ${S.salesEmail} (Sales) ${S.salesUser}`);
  }
}

/* ---------------- items (batched, so production mints batch numbers) ---------------- */
const ITEMS = {
  calacatta: { name: "Calacatta Gold", size: "size1600", finish: "Glossy", cat: "Marble", sku: "CAL-GLD-816", pcs: 2, kg: 50, rate: 1.35 },
  emperador: { name: "Emperador Dark", size: "size1600", finish: "Matt", cat: "Marble", sku: "EMP-DRK-816", pcs: 2, kg: 50, rate: 1.2 },
  ashwood: { name: "Ash Wood", size: "size1200", finish: "Matt", cat: "Wood", sku: "ASH-WD-612", pcs: 4, kg: 28, rate: 0.95 },
};
const unique = (k) => `${ITEMS[k].name} - ${ITEMS[k].size === "size1600" ? "800x1600" : "600x1200"} - ${ITEMS[k].finish}`;
async function items(m) {
  S.items = S.items || {};
  for (const [k, it] of Object.entries(ITEMS)) {
    if (S.items[k]) continue;
    const hit = await byName("Design", "unique_name", unique(k));
    S.items[k] = String(hit ? hit.ROWID : (await post("Design", {
      design_name: it.name, base_design_name: it.name, unique_name: unique(k), sku: it.sku, size: m[it.size],
      finish: await idOf("Finish", "name", it.finish), category: await idOf("Category", "name", it.cat), brand: await idOf("Brand", "name", "Boffo"),
      is_batched: true, status: "Active", box_weight_kg: it.kg, pcs_per_box: it.pcs,
    })).rowid); save();
    log(`· item ${unique(k)} ${S.items[k]}`);
  }
}

/* ---------------- quotes ---------------- */
const qLine = (k, qty, desc) => ({ item: unique(k), qty, rate: ITEMS[k].rate, rate_basis: "box", description: desc || "" });
async function quote(key, customer, lines, extra = {}) {
  S.quotes = S.quotes || {};
  if (S.quotes[key]) return S.quotes[key];
  const r = await post("quote-with-items", {
    customer: customer.name, quote_date: day(-7), expiry_date: day(23), port_of_discharge: extra.port || "Jebel Ali",
    currency: extra.currency || "USD", exchange_rate: extra.fx || 83.5, remarks: extra.remarks || "", lines,
    ...(extra.salesperson ? { salesperson: extra.salesperson } : {}),
  });
  const row = one(await get(`Quote/${r.rowid}`));
  S.quotes[key] = { id: String(r.rowid), number: row?.quote_number }; save();
  log(`· quote ${S.quotes[key].number} (${customer.name}) ${S.quotes[key].id} — born ${row?.status}`);
  return S.quotes[key];
}
const QUOTE_CHAIN = ["Draft", "PendingApproval", "Approved", "Sent", "Accepted"];
/** Post only the steps still ahead of the quote's current status (an approver's quote is born Approved). */
async function walk(path, id, steps) {
  const cur = String(one(await get(`Quote/${id}`))?.status || "Draft");
  for (const st of steps) if (QUOTE_CHAIN.indexOf(st) > QUOTE_CHAIN.indexOf(cur)) await post(`${path}/${id}`, { status: st });
}
async function quotes(m) {
  S.qsteps = S.qsteps || {};
  // Q1 Nova — approved, not yet sent (an approver's quote is born Approved)
  await quote("nova", m["DEMO-NOVA"], [qLine("calacatta", 300, "Lobby floor"), qLine("ashwood", 200, "Bedrooms")], { port: "Jebel Ali" });
  // Q0 Savanna — a Draft, raised by Sales and left there
  if (!S.quotes?.savanna) await asSales(() => quote("savanna", m["DEMO-KENYA"], [qLine("ashwood", 90, "Villa project — budget")], { port: "Mombasa" }));
  // Q2 Atlas — raised by Sales, waiting for approval
  if (!S.quotes?.atlas) {
    await asSales(async () => {
      const qq = await quote("atlas", m["DEMO-ATLAS"], [qLine("emperador", 180, "Showroom")], { port: "Felixstowe", currency: "GBP", fx: 105.4 });
      await walk("quote-status", qq.id, ["PendingApproval"]);
    });
    log("·   Atlas quote → PendingApproval (by Sales)");
  }
  // Q3 Rio — Sent
  const rio = await quote("rio", m["DEMO-RIO"], [qLine("calacatta", 120), qLine("emperador", 120)], { port: "Santos" });
  if (!S.qsteps.rio) { await walk("quote-status", rio.id, ["PendingApproval", "Approved", "Sent"]); S.qsteps.rio = true; save(); log("·   Rio quote → Sent"); }
  // Q4 Baltic — Accepted, then part-converted to SO-A
  const baltic = await quote("baltic", m["DEMO-BALTIC"], [qLine("emperador", 600, "Phase 1 + 2"), qLine("ashwood", 150)], { port: "Gdansk", currency: "EUR", fx: 90.2 });
  if (!S.qsteps.baltic) { await walk("quote-status", baltic.id, ["PendingApproval", "Approved", "Sent", "Accepted"]); S.qsteps.baltic = true; save(); log("·   Baltic quote → Accepted"); }
}

/* ---------------- sales orders ---------------- */
function plan(m, lines) {
  // Same JSON PlanContainerisation saves (boxes mode); ONE 480-box container of 48-box pallets.
  const pl = lines.map((l) => ({ design: unique(l.k), palletId: m.pallet48, palletName: "P-48 800x1600", pallets: Math.ceil(l.boxes / 48), boxes: l.boxes }));
  const pallets = pl.reduce((s, l) => s + l.pallets, 0), boxes = pl.reduce((s, l) => s + l.boxes, 0);
  return JSON.stringify({ v: 1, mode: "boxes", containers: [{
    no: 1, fillPct: Math.round((pallets / n(m.format480.total_pallets)) * 100), pallets, boxes, tonnes: Math.round((boxes * 50) / 100) / 10,
    palletCapacity: n(m.format480.total_pallets), containerFormat: String(m.format480.ROWID), containerFormatName: m.format480.name, lines: pl,
  }] });
}
async function confirm(id) {
  let so = one(await get(`SalesOrder/${id}`));
  for (const st of ["PendingApproval", "Confirmed"]) {
    if (["Confirmed", "InProgress", "PartiallyCompleted", "Completed"].includes(so.status)) break;
    await post(`so-status/${id}`, { status: st });
    so = one(await get(`SalesOrder/${id}`));
  }
  return so;
}
async function orders(m) {
  S.so = S.so || {};
  // SO-A — from the Baltic quote (partial), Emperador 400 of 600
  if (!S.so.A) {
    const r = await post(`convert-quote/${S.quotes.baltic.id}`, {
      mode: "Partial", po_number: "BAL-PO-2041", order_date: day(-5), shipment_date: day(25), remarks: "Phase 1 — first container",
      lines: [{ item: unique("emperador"), qty: 400, rate: ITEMS.emperador.rate, pallet: m.pallet48 }],
    });
    S.so.A = { id: String(r.data.so_rowid), number: r.data.order_number }; save();
    const so = await confirm(S.so.A.id);
    log(`· ${S.so.A.number} (Baltic, from quote) → ${so.status}`);
  }
  // SO-B — raised by Sales with a container plan, waiting for approval
  if (!S.so.B) {
    await asSales(async () => {
      const r = await post("so-with-items", {
        customer: m["DEMO-NOVA"].name, po_number: "NOVA-PO-7781", order_date: day(-2), shipment_date: day(30), currency: "USD", exchange_rate: 83.5,
        remarks: "Pending approval — raised by Sales", container_plan: plan(m, [{ k: "calacatta", boxes: 240 }, { k: "emperador", boxes: 240 }]),
        lines: [{ item: unique("calacatta"), qty: 240, rate: 1.35, rate_basis: "box", pallet: m.pallet48 }, { item: unique("emperador"), qty: 240, rate: 1.2, rate_basis: "box", pallet: m.pallet48 }],
      });
      S.so.B = { id: String(r.rowid), number: r.data?.order_number }; save();
      const so = one(await get(`SalesOrder/${S.so.B.id}`));
      if (so.status === "Draft") await post(`so-status/${S.so.B.id}`, { status: "PendingApproval" });
    });
    log(`· ${S.so.B.number} (Nova, by Sales) → PendingApproval`);
  }
  // SO-C — Confirmed, nothing produced yet
  if (!S.so.C) {
    const r = await post("so-with-items", {
      customer: m["DEMO-RIO"].name, po_number: "RIO-PO-0119", order_date: day(-1), shipment_date: day(40), currency: "USD", exchange_rate: 83.5,
      remarks: "Awaiting production", lines: [{ item: unique("ashwood"), qty: 300, rate: 0.95, rate_basis: "box", pallet: m.pallet40 }],
    });
    S.so.C = { id: String(r.rowid), number: r.data?.order_number }; save();
    const so = await confirm(S.so.C.id);
    log(`· ${S.so.C.number} (Rio) → ${so.status}`);
  }
  // SO-D — one full container, produced → palletised → loaded → dispatched
  if (!S.so.D) {
    const r = await post("so-with-items", {
      customer: m["DEMO-KENYA"].name, po_number: "SAV-PO-3307", order_date: day(-20), shipment_date: day(-3), currency: "USD", exchange_rate: 83.5,
      remarks: "Shipped", container_plan: plan(m, [{ k: "calacatta", boxes: 480 }]),
      lines: [{ item: unique("calacatta"), qty: 480, rate: 1.35, rate_basis: "box", pallet: m.pallet48 }],
    });
    S.so.D = { id: String(r.rowid), number: r.data?.order_number }; save();
    const so = await confirm(S.so.D.id);
    log(`· ${S.so.D.number} (Savanna) → ${so.status}`);
  }
}

/* ---------------- production + allocation + palletisation ---------------- */
async function produceFor(key, itemKey, chunks, note) {
  S.prod = S.prod || {};
  if (S.prod[key]) return S.prod[key];
  const job = await post("production-log", { lines: [{ design: S.items[itemKey], qty_requested: chunks.reduce((a, b) => a + b, 0) }], performed_by: "Demo Admin", note });
  const planId = String(job.data.ids[0]);
  const rec = await post(`production-record-lines/${planId}`, {
    rows: chunks.map((qty, i) => ({ qty_boxes: qty, mfg_date: day(-10 + i), note: `Kiln ${i + 1}` })), shift: "A", performed_by: "Demo Admin",
  });
  S.prod[key] = { planId, batches: rec.data.batch_numbers, chunks }; save();
  log(`· produced ${unique(itemKey)} ${chunks.join(" + ")} → ${rec.data.batch_numbers.join(", ")}`);
  return S.prod[key];
}
async function allocate(soKey, itemKey, prodKey) {
  S.alloc = S.alloc || {};
  if (S.alloc[soKey]) return;
  const oi = rows(await get(`OrderItem?where=sales_order=${S.so[soKey].id}&limit=50`)).find((o) => String(o.design) === S.items[itemKey]);
  if (!oi) throw new Error(`No ${itemKey} line on ${soKey}`);
  const p = S.prod[prodKey];
  let room = n(oi.ordered_qty_boxes);
  const alloc = p.batches.map((b, i) => { const q = Math.min(p.chunks[i], room); room -= q; return { batch_number: b, qty_boxes: q }; }).filter((r) => r.qty_boxes > 0);
  await post("allocate-stock", { order_item: String(oi.ROWID), rows: alloc });
  S.alloc[soKey] = true; save();
  log(`· ${S.so[soKey].number} allocated ${alloc.map((a) => `${a.qty_boxes} of ${a.batch_number}`).join(", ")}`);
}
async function palletise(soKey, steps, pallet) {
  S.pal = S.pal || {};
  if (S.pal[soKey]) return S.pal[soKey];
  const lines = rows(await get(`PalletizationPlanLine?where=sales_order=${S.so[soKey].id}&limit=300`)).filter((l) => l.status === "Planning");
  const ready = [];
  for (let i = 0; i < steps.length && i < lines.length; i++) {
    const st = steps[i];
    if (st === "palletizing") { await post(`pal-line-status/${lines[i].ROWID}`, { status: "Palletizing", pallet }); continue; }
    const r = await post(`pal-line-status/${lines[i].ROWID}`, { status: "ReadyToLoad", pallet, ...(typeof st === "number" ? { boxes: st } : {}) });
    ready.push(String(typeof st === "number" ? r.rowid : lines[i].ROWID));
  }
  S.pal[soKey] = ready; save();
  log(`· ${S.so[soKey].number} palletised: ${steps.join(", ")}`);
  return ready;
}
async function loadAndDispatch(m) {
  if (S.loadD) return;
  const lines = [];
  for (const id of S.pal.D) lines.push(one(await get(`PalletizationPlanLine/${id}`)));
  const b = await post("load-box", {
    vehicle: m.vehicle, container_format: String(m.format480.ROWID), container_number: "MSKU4471902", container_size: "40HC",
    line_seal: "LS-204411", electronic_seal: "ES-991020", loading_supervisor: "Ramesh Patel", transporter: "Morbi Freight Lines",
    lr_number: "LR-2026-0471", destination: "Mombasa", dispatch_date: day(-3),
    load_plan: JSON.stringify({ v: 1, lines: lines.map((l) => ({ so: S.so.D.id, design: unique("calacatta"), batch: l.batch_number || "", boxes: n(l.boxes), palletId: m.pallet48 })), plan: { [S.so.D.id]: 0 } }),
  });
  S.loadD = { box: String(b.rowid), number: b.data?.load_number }; save();
  await post("pal-lines-box", { box: S.loadD.box, lines: lines.map((l) => ({ id: String(l.ROWID) })) });
  await post(`load-box-dispatch/${S.loadD.box}`, {});
  log(`· ${S.loadD.number} MSKU4471902 loaded ${lines.reduce((s, l) => s + n(l.boxes), 0)} boxes → Dispatched`);
}
async function production(m) {
  // SO-A: 250 + 150 produced; batch 1 Ready for Loading, batch 2 left In Palletization; order In Progress
  await produceFor("A", "emperador", [250, 150], "Baltic phase 1");
  await allocate("A", "emperador", "A");
  await palletise("A", ["all", "palletizing"], m.pallet48);
  if (!S.soAProgress) { const so = one(await get(`SalesOrder/${S.so.A.id}`)); if (so.status === "Confirmed") await post(`so-status/${S.so.A.id}`, { status: "InProgress" }); S.soAProgress = true; save(); }
  // SO-D: 480 produced, all Ready, loaded, dispatched
  await produceFor("D", "calacatta", [480], "Savanna full container");
  await allocate("D", "calacatta", "D");
  await palletise("D", ["all"], m.pallet48);
  await loadAndDispatch(m);
  // Make-to-stock: Ash Wood 120 in free stock
  await produceFor("stock", "ashwood", [120], "Make to stock");
  // A job still In Production and one at QC
  S.jobs = S.jobs || {};
  if (!S.jobs.inprod) {
    const j = await post("production-log", { lines: [{ design: S.items.emperador, qty_requested: 200 }], stage: "InProduction", performed_by: "Demo Admin", note: "Kiln 2 — running" });
    S.jobs.inprod = String(j.data.ids[0]); save(); log("· job Emperador 200 → In Production");
  }
  if (!S.jobs.qc) {
    const j = await post("production-log", { lines: [{ design: S.items.calacatta, qty_requested: 96 }], stage: "InProduction", performed_by: "Demo Admin", note: "Sorting line" });
    const id = String(j.data.ids[0]);
    await post("production-stage", { stage: "QC", ids: [id], note: "Shade check" });
    S.jobs.qc = id; save(); log("· job Calacatta 96 → QC");
  }
}

/* ---------------- stock moves ---------------- */
async function stockMoves(m) {
  // Ash Wood 120, one batch. An API production record with no location lands on the PRIMARY node
  // (Main Warehouse ▸ Unassigned) — the UI sends the Production bay, a script does not.
  const p = S.prod.stock;
  const at = String(m.main.ROWID);
  if (!S.adjust) {
    await post("stock-adjust", { date: day(-1), reason: "Breakage", note: "Forklift damage", lines: [{ design: S.items.ashwood, qty_boxes: -3, batch_number: p.batches[0], warehouse: at }] });
    S.adjust = true; save(); log("· stock adjustment −3 Ash Wood (Breakage)");
  }
  if (!S.transfer) {
    await post("stock-transfer", { date: today(), reason: "Rebalance racks", note: "", from_warehouse: at, to_warehouse: String(m.A2.ROWID), lines: [{ design: S.items.ashwood, qty_boxes: 40, batch_number: p.batches[0] }] });
    S.transfer = true; save(); log("· transfer 40 Ash Wood → A2");
  }
  // Cut-piece stock (panel craft): the ZZT Panel Stone pieces from seed-panel-stages
  const stone = await byName("Design", "unique_name", "ZZT Panel Stone - 800x1600 - Glossy");
  const cut = await byName("CutPieceSize", "name", "ZZT 400x800");
  if (stone && cut) {
    if (!S.cutAdjust) {
      await post("cut-stock-entry", { kind: "adjustment", reason: "Count correction", entry_date: day(-1), lines: [{ design: String(stone.ROWID), cut_piece_size: String(cut.ROWID), qty: -1 }] });
      S.cutAdjust = true; save(); log("· cut-piece adjustment −1 (Count correction)");
    }
    if (!S.cutTransfer) {
      await post("cut-stock-entry", { kind: "transfer", reason: "Move to cutting bay", from_warehouse: String(m.main.ROWID), to_warehouse: String(m.A3.ROWID), lines: [{ design: String(stone.ROWID), cut_piece_size: String(cut.ROWID), qty: 2 }] });
      S.cutTransfer = true; save(); log("· cut-piece transfer 2 pcs → A3");
    }
  }
}

/* ---------------- sample order ---------------- */
async function samples(m) {
  if (S.sample) return;
  const stone = await byName("Design", "unique_name", "ZZT Panel Stone - 800x1600 - Glossy");
  const cut = await byName("CutPieceSize", "name", "ZZT 400x800");
  const lines = [{ design: S.items.calacatta, piece_kind: "Full", qty: 2 }];
  if (stone && cut) lines.push({ design: String(stone.ROWID), piece_kind: "Cut", cut_piece_size: String(cut.ROWID), qty: 3 });
  const r = await post("sample-order-save", { customer: m["DEMO-ATLAS"].id, salesperson: "Demo Admin", order_date: day(-4), note: "Showroom samples", lines });
  S.sample = { id: String(r.rowid), number: r.data?.order_number }; save();
  const sl = rows(await get(`SampleOrderLine?where=sample_order=${S.sample.id}&limit=50`)).find((l) => l.piece_kind === "Cut");
  if (sl) {
    await post("panel-load-save", { load_date: today(), vehicle_number: "GJ-05-CD-7788", driver_name: "Suresh Kumar", driver_mobile: "98123 45678", note: "Courier — part supply",
      orders: [{ order_type: "Sample", order: S.sample.id, lines: [{ line: String(sl.ROWID), material: "Item", qty: 1 }] }] });
  }
  log(`· sample order ${S.sample.number} (Atlas) — cut line part-supplied`);
}

/* ---------------- shipping containers ---------------- */
async function containers() {
  if (S.containers) return;
  for (const c of [
    { container_number: "MSKU4471902", container_type: "40HC", capacity_boxes: 480, capacity_pallets: 10, vessel_name: "MSC Carla", port_of_loading: "Mundra", port_of_discharge: "Mombasa", status: "dispatched", etd: day(-3), eta: day(14) },
    { container_number: "TGHU7720165", container_type: "40HC", capacity_boxes: 540, capacity_pallets: 9, vessel_name: "Maersk Elba", port_of_loading: "Mundra", port_of_discharge: "Gdansk", status: "planned", etd: day(12), eta: day(38) },
  ]) {
    if (await byName("Container", "container_number", c.container_number)) continue;
    await post("Container", c);
    log(`· container ${c.container_number} (${c.status})`);
  }
  S.containers = true; save();
}

/* ---------------- approvals → bell notifications ---------------- */
async function notifications(m) {
  S.noti = S.noti || {};
  // Raised by Sales on behalf of Demo Admin → approved → Demo Admin's bell
  if (!S.noti.approved) {
    const qq = await asSales(async () => {
      const x = await quote("noti_approved", m["DEMO-ATLAS"], [qLine("ashwood", 60, "Office lobby")], { port: "Felixstowe", currency: "GBP", fx: 105.4, salesperson: "Demo Admin" });
      await walk("quote-status", x.id, ["PendingApproval"]);
      return x;
    });
    await post(`quote-status/${qq.id}`, { status: "Approved" });
    S.noti.approved = true; save(); log("· quote (Atlas, for Demo Admin) → Approved — bell for Demo Admin");
  }
  // Raised by Sales on behalf of Dhiraj → rejected with a reason → Dhiraj's bell + a Rejected quote
  // (ponytail: the function caches the SalesPerson map per instance, so a rep created this run may
  // not resolve yet — Dhiraj's row predates every instance)
  if (!S.noti.rejected) {
    const qq = await asSales(async () => {
      const x = await quote("noti_rejected", m["DEMO-RIO"], [qLine("calacatta", 48, "Spot order")], { port: "Santos", salesperson: "Dhiraj Sajagure" });
      await walk("quote-status", x.id, ["PendingApproval"]);
      return x;
    });
    await post(`quote-status/${qq.id}`, { status: "Rejected", reason: "Rate below the floor price for Calacatta" });
    S.noti.rejected = true; save(); log("· quote (Rio, for Dhiraj) → Rejected — bell for Dhiraj");
  }
}

/* ---------------- quote numbers (the FORM mints QT/<FY>/NNN; the API leaves it blank) ---------------- */
async function numberQuotes() {
  const all = rows(await get("Quote?columns=ROWID,quote_number&limit=300")).sort((a, b) => (a.ROWID > b.ROWID ? 1 : -1));
  let seq = all.reduce((mx, r) => Math.max(mx, Number(String(r.quote_number || "").split("/").pop()) || 0), 0);
  for (const r of all) {
    if (String(r.quote_number || "").trim()) continue;
    const number = `QT/2026-27/${String(++seq).padStart(3, "0")}`;
    await call("PATCH", `Quote/${r.ROWID}`, { quote_number: number });
    log(`· quote ${r.ROWID} numbered ${number}`);
  }
}

/* ---------------- run ---------------- */
const { BOFFO_EMAIL: email, BOFFO_PASSWORD: password } = process.env;
if (!email || !password) throw new Error("Set BOFFO_EMAIL and BOFFO_PASSWORD (the demo Admin)");
await loginAs(email, password);
log(`· signed in as ${email}`);
const m = await masters();
await users();
await items(m);
await quotes(m);
await orders(m);
await production(m);
await stockMoves(m);
await samples(m);
await containers();
await numberQuotes(); // before the verdicts, so the bell text carries the quote number
await notifications(m);
await numberQuotes(); // the two verdict quotes
log("✓ demo flows ready");
