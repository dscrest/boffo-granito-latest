/* Customer → Dispatch flow seed. Drives the LIVE data-ops sagas in the order
   the UI drives them, so every counter and status lands the way the app would
   compute it — nothing is written by hand.

     customer                      → POST /Customer
     quote (+ container plan)      → POST /quote-with-items
     approval walk                 → POST /quote-status/:id  ×4
     3 sales orders off one quote  → POST /convert-quote/:id  ×3
     confirm (auto-queues prod)    → POST /so-status/:id
     production output (batched)   → POST /production-record-lines/:id
     palletise                     → POST /pal-line-status/:id
     container + loading           → POST /load-box, /pal-line-box/:id
     dispatch                      → POST /load-box-dispatch/:id

   Three orders at three depths: A complete, B partial at every stage,
   C palletised but not loaded. All records marked ZZT.

   Run:      BOFFO_EMAIL=… BOFFO_PASSWORD=… node scripts/seed-flow.mjs
   Teardown: BOFFO_EMAIL=… BOFFO_PASSWORD=… node scripts/seed-flow.mjs --teardown
   Batch-tracked sample (own quote + state file): add --batch to either.
   Host override: SEED_HOST env. */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";

const HOST =
  process.env.SEED_HOST ||
  "https://boffo-granito-export-tracker-925638796.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;
const SET = process.argv.includes("--batch") ? "batch" : "default";
const STATE_FILE = () => new URL(`.seed-flow-state${SET === "default" ? "" : `-${SET}`}.json`, import.meta.url).pathname;

let TOKEN = "";

async function call(method, path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    // Bearer is intercepted by the Catalyst gateway (401 before our function
    // runs) — the app token has to ride on its own header.
    headers: { "Content-Type": "application/json", ...(TOKEN ? { "X-App-Token": TOKEN } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { ok: false, error: text }; }
  if (!res.ok || json.ok === false)
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${json.error || text}`);
  return json;
}
const get = (p) => call("GET", p);
const post = (p, b) => call("POST", p, b);
const del = (p) => call("DELETE", p);
/* List reads answer {rows}, single reads {row} — both already exclude
   soft-deleted rows, so callers never re-filter on deleted_at. */
const rows = (j) => j.rows || (j.row ? [j.row] : []);
const one = (j) => j.row || (j.rows || [])[0] || null;
const log = (...a) => console.log(...a);

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + (5.5 + n * 24) * 3600 * 1000).toISOString().slice(0, 10);

/* State: every ROWID we mint, so teardown is exact and a half-run resumes.
   The GET ?where= filter only accepts [A-Za-z0-9 _-] literals, so anything
   with a "/" (quote/SO/batch numbers) can't be looked up by name anyway. */
const S = existsSync(STATE_FILE()) ? JSON.parse(readFileSync(STATE_FILE(), "utf8")) : {};
const save = () => writeFileSync(STATE_FILE(), JSON.stringify(S, null, 2));

async function login() {
  // BOFFO_TOKEN = an existing session token (the ZCQL-minted one from
  // SYSTEM.md §10); otherwise sign in normally.
  if (process.env.BOFFO_TOKEN) {
    TOKEN = process.env.BOFFO_TOKEN;
    const me = await get("auth/me");
    log(`· using supplied token — ${me.user?.email || "?"}`);
    return;
  }
  const email = process.env.BOFFO_EMAIL, password = process.env.BOFFO_PASSWORD;
  if (!email || !password) throw new Error("Set BOFFO_EMAIL and BOFFO_PASSWORD (an Admin app user), or BOFFO_TOKEN");
  const r = await post("auth/login", { email, password });
  TOKEN = r.token;
  log(`· signed in as ${email}`);
}

/* ---------------- scenarios ---------------- */

/* Two independent sample runs, each with its own quote and its own state file.
   `palletise`/`load`: "all" = every card / the whole line, a number = that many
   cards / that many boxes (a box count below the card's total splits the card). */
const SETS = {
  // The mixed-depth walkthrough: one complete order, one partial at every
  // stage, one palletised but never loaded.
  default: [
    { key: "A", label: "complete",        design: "Desert Beige - 600x1200 - Glossy", ordered: 320, rate: 4.2, produce: [200, 120], palletise: "all", load: "all" },
    { key: "B", label: "partial",         design: "Hawai Crema - 600x1200 - Glossy",  ordered: 640, rate: 3.9, produce: [224, 160], palletise: 1,     load: 120   },
    { key: "C", label: "palletised only", design: "Onyx Gris - 600x1200 - Glossy",    ordered: 320, rate: 4.5, produce: [320],      palletise: "all", load: 0     },
  ],
  // Same chain on a BATCH-TRACKED item (Design.is_batched = true): three
  // distinct batches off one order line, each becoming its own palletisation
  // card, so the batch trail stays visible right through to dispatch.
  batch: [
    { key: "D", label: "batch-tracked", design: "BATCH TESTING ITEM 2 - 600x1200 - Carving", ordered: 480, rate: 4.1, produce: [160, 160, 160], palletise: 2, load: 160 },
  ],
};
const SCEN = SETS[SET];

/* ---------------- masters (reused, never created) ---------------- */

const PALLET_NAME = "600x1200 - [32 * 28] = 896 - Junglee";
const BOXES_PER_PALLET = 32, PALLETS_PER_CONTAINER = 28;

async function masters() {
  const found = {};
  const wanted = SCEN.map((s) => s.design);
  const ds = rows(await get("Design?columns=ROWID,unique_name,design_name,box_weight_kg,is_batched&limit=300"));
  for (const d of ds) if (wanted.includes(d.unique_name)) found[d.unique_name] = d;
  const missing = wanted.filter((u) => !found[u]);
  if (missing.length) throw new Error(`Missing designs in the item master: ${missing.join(", ")}`);

  const pallet = rows(await get("Pallet?columns=ROWID,name,boxes_per_pallet&limit=300"))
    .find((p) => p.name === PALLET_NAME);
  if (!pallet) throw new Error(`Missing pallet master: ${PALLET_NAME}`);

  const vehicle = one(await get("Vehicle?columns=ROWID,vehicle_number&limit=50"));
  if (!vehicle) throw new Error("No vehicle in the master — add one before seeding");

  log(`· masters: ${wanted.length} design(s), pallet ${pallet.ROWID}, vehicle ${vehicle.vehicle_number}`);
  return { designs: found, pallet, vehicle };
}

/** The container plan the quote carries — same shape PlanContainerisation saves. */
function containerPlan(m) {
  const perContainer = BOXES_PER_PALLET * PALLETS_PER_CONTAINER; // 896
  const lines = SCEN.map((s) => {
    const d = m.designs[s.design];
    return { unique: s.design, boxes: s.ordered, weight: Number(d.box_weight_kg) || 27.5 };
  });
  // Greedy fill, one container after another — mirrors the box-mode packer.
  const containers = [];
  let cur = { no: 1, lines: [] }, left = perContainer;
  for (const l of lines) {
    let rem = l.boxes;
    while (rem > 0) {
      const take = Math.min(rem, left);
      cur.lines.push({
        design: l.unique,
        palletId: String(m.pallet.ROWID),
        palletName: PALLET_NAME,
        pallets: Math.ceil(take / BOXES_PER_PALLET),
        boxes: take,
      });
      rem -= take; left -= take;
      if (left === 0) { containers.push(cur); cur = { no: containers.length + 1, lines: [] }; left = perContainer; }
    }
  }
  if (cur.lines.length) containers.push(cur);
  return JSON.stringify({
    v: 1,
    mode: "boxes",
    containers: containers.map((c) => {
      const boxes = c.lines.reduce((s, x) => s + x.boxes, 0);
      const pallets = c.lines.reduce((s, x) => s + x.pallets, 0);
      const kg = c.lines.reduce((s, x) => s + x.boxes * (lines.find((l) => l.unique === x.design)?.weight || 0), 0);
      return {
        no: c.no,
        fillPct: Math.min(100, Math.round((boxes / perContainer) * 100)),
        pallets,
        boxes,
        tonnes: Math.round((kg / 1000) * 10) / 10,
        palletCapacity: PALLETS_PER_CONTAINER,
        lines: c.lines,
      };
    }),
  });
}

/* ---------------- the chain ---------------- */

async function seedCustomer() {
  if (S.customer) return S.customer;
  const existing = one(await get("Customer?where=code='ZZT-DEMO'&columns=ROWID,code&limit=1"));
  if (existing) { S.customer = existing.ROWID; save(); return S.customer; }
  const r = await post("Customer", {
    code: "ZZT-DEMO",
    name: "ZZT Demo Exports",
    country_code: "PL",
    currency: "INR",
    active: true,
    address: "ZZT demo record — safe to delete",
    port_of_discharge: "Gdansk",
    contact_first_name: "ZZT",
    contact_last_name: "Demo",
    contact_email: "zzt-demo@example.invalid",
    billing_country: "Poland",
    billing_city: "Warsaw",
    shipping_country: "Poland",
    shipping_city: "Warsaw",
  });
  S.customer = r.rowid; save();
  log(`· customer ZZT-DEMO ${S.customer}`);
  return S.customer;
}

async function seedQuote(m) {
  if (S.quote) return S.quote;
  const number = `ZZT-Q-${String(Date.now()).slice(-6)}`;
  const r = await post("quote-with-items", {
    quote_number: number,
    customer: "ZZT Demo Exports",
    quote_date: today(),
    expiry_date: plusDays(30),
    port_of_discharge: "Gdansk",
    currency: "INR",
    exchange_rate: 1,
    remarks: "ZZT demo — end-to-end flow seed",
    container_plan: containerPlan(m),
    lines: SCEN.map((s) => ({
      item: s.design,
      qty: s.ordered,
      rate: s.rate,
      rate_basis: "box",
      description: `ZZT scenario ${s.key} — ${s.label}`,
    })),
  });
  S.quote = r.rowid; S.quote_number = number; save();
  // Born Draft, always — walk the approval machine.
  for (const st of ["PendingApproval", "Approved", "Sent", "Accepted"])
    await post(`quote-status/${S.quote}`, { status: st });
  log(`· quote ${number} ${S.quote} → Accepted`);
  return S.quote;
}

async function seedOrders() {
  S.orders = S.orders || {};
  for (const s of SCEN) {
    if (S.orders[s.key]) continue;
    const r = await post(`convert-quote/${S.quote}`, {
      mode: "Partial",
      po_number: `ZZT-PO-${s.key}`,
      order_date: today(),
      shipment_date: plusDays(21),
      remarks: `ZZT scenario ${s.key} — ${s.label}`,
      lines: [{ item: s.design, qty: s.ordered, rate: s.rate, pallet: S.pallet }],
    });
    S.orders[s.key] = { id: r.data.so_rowid, number: r.data.order_number }; save();
    for (const st of ["PendingApproval", "Confirmed"])
      await post(`so-status/${r.data.so_rowid}`, { status: st });
    log(`· ${r.data.order_number} ${r.data.so_rowid} → Confirmed (scenario ${s.key})`);
  }
}

async function recordProduction() {
  S.produced = S.produced || {};
  for (const s of SCEN) {
    if (S.produced[s.key]) continue;
    const so = S.orders[s.key];
    // Confirming the SO already queued one 'plan' row per line — record against
    // it; a second /production-log would blow the requested-vs-ordered cap.
    const plans = rows(await get(`ProductionLog?where=sales_order=${so.id}&limit=100`))
      .filter((p) => p.entry_type === "plan");
    if (!plans.length) throw new Error(`No production plan rows for ${so.number}`);
    // One batch row per chunk — batch_number left blank so the server mints B/FY/NNN.
    await post(`production-record-lines/${plans[0].ROWID}`, {
      rows: s.produce.map((qty, i) => ({ qty_boxes: qty, mfg_date: plusDays(-2 - i), note: `ZZT batch ${i + 1}` })),
      shift: "A",
      performed_by: "ZZT seed",
    });
    S.produced[s.key] = true; save();
    log(`· ${so.number} produced ${s.produce.join(" + ")} boxes`);
  }
}

async function palletise() {
  S.palletised = S.palletised || {};
  for (const s of SCEN) {
    if (S.palletised[s.key]) continue;
    const so = S.orders[s.key];
    // Production auto-enqueued these as Planning lines, one per batch.
    const lines = rows(await get(`PalletizationPlanLine?where=sales_order=${so.id}&limit=200`))
      .filter((l) => l.status === "Planning")
      .sort((a, b) => String(a.ROWID).localeCompare(String(b.ROWID)));
    const move = s.palletise === "all" ? lines : lines.slice(0, s.palletise);
    for (const l of move)
      // One hop Planning → ReadyToLoad, the way the board palletises since 2026-08-27.
      await post(`pal-line-status/${l.ROWID}`, { status: "ReadyToLoad", pallet: S.pallet });
    S.palletised[s.key] = move.map((l) => l.ROWID); save();
    log(`· ${so.number} palletised ${move.reduce((n, l) => n + Number(l.boxes || 0), 0)} boxes (${move.length}/${lines.length} cards)`);
  }
}

async function loadAndDispatch(m) {
  if (!S.box) {
    const r = await post("load-box", {
      vehicle: String(m.vehicle.ROWID),
      container_number: "ZZTU1234567",
      container_size: "40HC",
      line_seal: "ZZT-LS-0001",
      electronic_seal: "ZZT-ES-0001",
      loading_supervisor: "ZZT Supervisor",
      transporter: "ZZT Logistics",
      lr_number: "ZZT-LR-0001",
      destination: "Gdansk",
      dispatch_date: today(),
    });
    S.box = r.rowid; S.box_number = r.data?.box_number; save();
    log(`· load container ${S.box} (box ${S.box_number ?? "?"})`);
  }
  if (!S.loaded) {
    for (const s of SCEN) {
      if (!s.load) continue;
      for (const lineId of S.palletised[s.key]) {
        const line = one(await get(`PalletizationPlanLine/${lineId}`));
        if (!line || line.load_box) continue;
        // A number < the line's boxes splits the line: that many load, the
        // remainder stays Ready — this is the partial dispatch of scenario B.
        const body = s.load === "all" ? { box: String(S.box) } : { box: String(S.box), boxes: s.load };
        await post(`pal-line-box/${lineId}`, body);
        log(`· ${S.orders[s.key].number} loaded ${s.load === "all" ? line.boxes : s.load} boxes`);
        if (s.load !== "all") break; // only the first card takes the partial load
      }
    }
    S.loaded = true; save();
  }
  if (!S.dispatched) {
    await post(`load-box-dispatch/${S.box}`, {});
    S.dispatched = true; save();
    log(`· container dispatched`);
  }
  // "Status updated" on the orders that actually moved.
  for (const s of SCEN) {
    if (!s.load || S.inprogress?.[s.key]) continue;
    await post(`so-status/${S.orders[s.key].id}`, { status: "InProgress" });
    S.inprogress = { ...(S.inprogress || {}), [s.key]: true }; save();
  }
}

/* ---------------- flow map ---------------- */

const pad = (v, n) => String(v).padStart(n);

async function flowMap() {
  const cust = one(await get(`Customer/${S.customer}`));
  const q = one(await get(`Quote/${S.quote}`));
  const plan = JSON.parse(q.container_plan || '{"containers":[]}');
  log("");
  log(`${cust.name}  (${cust.code})`);
  log(`└─ Quote ${q.quote_number}   ${q.status} / ${q.conversion_flag}   plan: ${plan.containers.length} containers`);

  let bad = 0;
  for (let i = 0; i < SCEN.length; i++) {
    const s = SCEN[i], last = i === SCEN.length - 1;
    const so = one(await get(`SalesOrder/${S.orders[s.key].id}`));
    const items = rows(await get(`OrderItem?where=sales_order=${so.ROWID}&limit=100`));
    const palLines = rows(await get(`PalletizationPlanLine?where=sales_order=${so.ROWID}&limit=200`));
    const planIds = [...new Set(palLines.map((l) => String(l.plan)))].filter(Boolean);
    const plans = [];
    for (const id of planIds) plans.push(one(await get(`PalletizationPlan/${id}`)));
    const prod = rows(await get(`ProductionLog?where=sales_order=${so.ROWID}&limit=200`))
      .filter((p) => p.entry_type === "record");
    const boxIds = [...new Set(palLines.map((l) => String(l.load_box || "")).filter(Boolean))];
    const boxes = [];
    for (const id of boxIds) boxes.push(one(await get(`LoadBox/${id}`)));

    const head = [
      `${so.order_number}`,
      so.status,
      plans.map((p) => `${p.pal_number} ${p.status}`).join(", ") || "no plan",
      boxes.map((b) => `Box ${b.box_number} ${b.status}`).join(", "),
    ].filter(Boolean).join("   ");
    log(`   ${last ? "└─" : "├─"} ${head}`);

    for (const it of items) {
      const design = one(await get(`Design/${it.design}`));
      const n = { o: +it.ordered_qty_boxes || 0, p: +it.produced_qty_boxes || 0, pal: +it.palletized_qty_boxes || 0, l: +it.loaded_qty_boxes || 0, d: +it.dispatched_qty_boxes || 0 };
      log(`   ${last ? "  " : "│ "}    ${(design?.design_name || "?").padEnd(14)} ordered ${pad(n.o, 4)}  produced ${pad(n.p, 4)}  palletized ${pad(n.pal, 4)}  loaded ${pad(n.l, 4)}  dispatched ${pad(n.d, 4)}  stage ${it.stage}`);
      // The golden rule: dispatched ≤ loaded ≤ palletized ≤ produced ≤ ordered.
      if (!(n.d <= n.l && n.l <= n.pal && n.pal <= n.p && n.p <= n.o)) {
        log(`   ${last ? "  " : "│ "}    ✗ counter chain violated on OrderItem ${it.ROWID}`);
        bad++;
      }
    }
    const batches = prod.map((p) => `${p.batch_number} (${p.qty_boxes})`).join(", ");
    if (batches) log(`   ${last ? "  " : "│ "}    batches: ${batches}`);
    const queued = palLines.filter((l) => l.status === "Planning");
    if (queued.length) log(`   ${last ? "  " : "│ "}    still queued: ${queued.reduce((n, l) => n + (+l.boxes || 0), 0)} boxes in Ready for Palletization`);
    const ready = palLines.filter((l) => l.status === "ReadyToLoad" && !l.load_box);
    if (ready.length) log(`   ${last ? "  " : "│ "}    awaiting a container: ${ready.reduce((n, l) => n + (+l.boxes || 0), 0)} boxes`);
  }
  log("");
  if (bad) throw new Error(`${bad} order line(s) break the ordered ≥ produced ≥ palletized ≥ loaded ≥ dispatched chain`);
}

/* ---------------- teardown ---------------- */

async function teardown() {
  const hard = async (table, id) => {
    try { await del(`${table}/${id}?hard=1`); log(`  − ${table} ${id}`); }
    catch (e) { log(`  ! ${table} ${id}: ${e.message}`); }
  };
  const soIds = Object.values(S.orders || {}).map((o) => o.id);

  // The box holds no lines once they're gone, but a Dispatched box is
  // undeletable through the API — report it and move on.
  for (const soId of soIds) {
    const lines = rows(await get(`PalletizationPlanLine?where=sales_order=${soId}&limit=200`));
    const planIds = [...new Set(lines.map((l) => String(l.plan)).filter(Boolean))];
    for (const l of lines) await hard("PalletizationPlanLine", l.ROWID);
    for (const p of planIds) await hard("PalletizationPlan", p);
  }
  for (const soId of soIds) {
    const prod = rows(await get(`ProductionLog?where=sales_order=${soId}&limit=200`));
    for (const p of prod.filter((x) => x.entry_type === "record")) await hard("ProductionLog", p.ROWID);
    for (const p of prod.filter((x) => x.entry_type !== "record")) await hard("ProductionLog", p.ROWID);
  }
  for (const soId of soIds) {
    const items = rows(await get(`OrderItem?where=sales_order=${soId}&limit=100`));
    for (const it of items) await hard("OrderItem", it.ROWID);
    await hard("SalesOrder", soId);
  }
  if (S.quote) await hard("Quote", S.quote);
  if (S.customer) await hard("Customer", S.customer);

  if (S.box) {
    if (S.dispatched)
      log(`\n  ⚠ LoadBox ${S.box} is Dispatched — the API refuses to delete it.\n    Finish with ZCQL: DELETE FROM LoadBox WHERE ROWID = ${S.box}`);
    else { try { await post(`load-box-delete/${S.box}`, {}); log(`  − LoadBox ${S.box}`); } catch (e) { log(`  ! LoadBox: ${e.message}`); } }
  }
  if (existsSync(STATE_FILE())) unlinkSync(STATE_FILE());
  log("\nTeardown done. OperationLog / StatusTransition / OrderItemEvent rows are kept — they are the audit trail.");
}

/* ---------------- main ---------------- */

(async () => {
  await login();
  if (process.argv.includes("--teardown")) return teardown();
  const m = await masters();
  S.pallet = String(m.pallet.ROWID); save();
  await seedCustomer();
  await seedQuote(m);
  await seedOrders();
  await recordProduction();
  await palletise();
  await loadAndDispatch(m);
  await flowMap();
  log(`Seeded (${SET}). Teardown: node scripts/seed-flow.mjs --teardown${SET === "default" ? "" : ` --${SET}`}`);
})().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
