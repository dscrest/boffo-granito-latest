/* Panel Craft demo fixture: ONE dummy customer, FOUR orders on the SAME panel left at four
   different stages, plus ONE completed order of TWO panels. Drives the LIVE data-ops routes
   the way the UI does; every record is prefixed ZZT and the state file makes --teardown exact.

     masters        → POST Design (ZZT stone) · POST CutPieceSize ×2 · /cut-piece-save ×2 (weights)
                      · POST Mdf ×2 (ZZT size, 8 mm / 12 mm) · /panel-save ×2 (Alpha: 2 cut pieces + MDF,
                      Beta: 1 cut piece, no MDF) · POST Customer
     stock          → /cut-stock-entry receipt (pieces to book against)
     O1  New        → panel Alpha ×2         left as NewRequest (nothing done)
     O2  Received   → panel Alpha ×3         partial booking (3 of 6 pcs), MDF "Ordered"
     O3  In Cutting → panel Alpha ×1         MDF Ready, Vinyl "Printing"
     O4  Ready      → panel Alpha ×2         all marks Ready, booked; trip loads the 2 PANELS only → MDF pending
                                             (Partially loaded, still Ready)
     O5  Completed  → Alpha ×1 + Beta ×2     all marks Ready; trip 1 = Alpha panel + MDF, trip 2 = Beta panels
                                             → Dispatched (derived from the loads)

   Works on today's LIVE (order-level marks) and on the CR-376/381 build (per-panel marks + loading
   gate): marks always carry `panel`, are made mdf → vinyl → pasted, and precede every Panel/MDF load.

   Run:      BOFFO_TOKEN=<admin AuthSession> node scripts/seed-panel-stages.mjs
             (or BOFFO_EMAIL=… BOFFO_PASSWORD=…)   SEED_HOST overrides the host.
   Teardown: node scripts/seed-panel-stages.mjs --teardown */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";

const HOST =
  process.env.SEED_HOST ||
  "https://boffo-granito-export-tracker-925638796.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;
const STATE_FILE = new URL("./.seed-flow-state-panel.json", import.meta.url).pathname; // matches .gitignore

const PLAN = {
  customer: { code: "ZZT-PANEL", name: "ZZT Panel Craft Studio" },
  salesperson: "ZZT seed",
  design: { unique: "ZZT Panel Stone - 800x1600 - Glossy", name: "ZZT Panel Stone", sku: "ZZTPS-800X1600" },
  cuts: { c1: { name: "ZZT 400x800", weight: 2.5 }, c2: { name: "ZZT 200x800", weight: 1.25 } },
  mdfSize: "ZZT 1200x2400",
  mdfs: { m8: { thickness: "8", weight_kg: 9.5 }, m12: { thickness: "12", weight_kg: 14 } },
  panels: {
    alpha: { size: "1200x2400", vinyl: "1200x2400", mdf: true, lines: [{ cut: "c1", qty: 2 }, { cut: "c2", qty: 1 }] },
    beta: { size: "1600x2400", vinyl: "1600x1600", mdf: false, lines: [{ cut: "c1", qty: 3 }] },
  },
  receipt: { c1: 10, c2: 5 }, // pieces on hand before any order (booking stock for O2)
  orders: [
    { key: "O1", label: "New", lines: [{ panel: "alpha", qty: 2, mdf: "m8" }], status: "NewRequest" },
    { key: "O2", label: "Received · partly booked", lines: [{ panel: "alpha", qty: 3, mdf: "m12" }], status: "Received", book: { c1: 3 }, marks: { alpha: { mdf: "Ordered" } } },
    { key: "O3", label: "In Cutting", lines: [{ panel: "alpha", qty: 1, mdf: "m8" }], status: "InCutting", marks: { alpha: { mdf: "Ready", vinyl: "Printing" } } },
    { key: "O4", label: "Ready · panels loaded, MDF pending", lines: [{ panel: "alpha", qty: 2, mdf: "m8" }], status: "Ready", ready: ["alpha"], trips: [[{ panel: "alpha", material: "Panel", qty: 2 }]] },
    { key: "O5", label: "Completed (2 panels)", lines: [{ panel: "alpha", qty: 1, mdf: "m12" }, { panel: "beta", qty: 2 }], status: "Ready", ready: ["alpha", "beta"],
      trips: [[{ panel: "alpha", material: "Panel", qty: 1 }, { panel: "alpha", material: "Mdf", qty: 1 }], [{ panel: "beta", material: "Panel", qty: 2 }]] },
  ],
  vehicles: ["GJ-01-ZP-0001", "GJ-01-ZP-0002", "GJ-01-ZP-0003"],
};

let TOKEN = "";
async function call(method, path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(TOKEN ? { "X-App-Token": TOKEN } : {}) }, // never Bearer (gateway 401s)
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
const rows = (j) => (j.rows || (j.row ? [j.row] : [])).filter((r) => !r.deleted_at);
const one = (j) => j.row || (j.rows || [])[0] || null;
const log = (...a) => console.log(...a);
const n = (v) => Number(v) || 0;
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

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

/** Find by a quoted natural key, else create. The GET filter only takes [A-Za-z0-9 _-] literals. */
async function findOrCreate(table, col, val, body, state) {
  if (S[state]) return S[state];
  const hit = one(await get(`${table}?where=${col}='${val}'&columns=ROWID&limit=1`));
  S[state] = String(hit ? hit.ROWID : (await post(table, body)).rowid); save();
  log(`· ${table} ${val} ${S[state]}${hit ? " (already there)" : ""}`);
  return S[state];
}

async function seedMasters() {
  await findOrCreate("Customer", "code", PLAN.customer.code, {
    code: PLAN.customer.code, name: PLAN.customer.name, country_code: "IN", currency: "INR", active: true,
    customer_type: "business", company_name: PLAN.customer.name, address: "ZZT demo record — safe to delete",
    contact_first_name: "ZZT", contact_last_name: "Panel", contact_email: "zzt-panel@example.invalid",
    billing_country: "India", billing_city: "Morbi", billing_state: "Gujarat", shipping_country: "India", shipping_city: "Morbi",
  }, "customer");
  const d = PLAN.design;
  await findOrCreate("Design", "unique_name", d.unique, { design_name: d.name, base_design_name: d.name, unique_name: d.unique, sku: d.sku, status: "Active", is_batched: false, box_weight_kg: 50, pcs_per_box: 2 }, "design");
  S.cuts = S.cuts || {};
  for (const [k, c] of Object.entries(PLAN.cuts)) {
    if (S.cuts[k]) continue;
    const hit = one(await get(`CutPieceSize?where=name='${c.name}'&columns=ROWID&limit=1`));
    S.cuts[k] = String(hit ? hit.ROWID : (await post("CutPieceSize", { name: c.name })).rowid); save();
    // The cut-piece ITEM row (CutPieceStock, qty 0) with its weight — what the panel lines point at.
    await post("cut-piece-save", { design: S.design, cut_piece_size: S.cuts[k], weight_kg: c.weight });
    log(`· cut piece ${c.name} ${S.cuts[k]} (${c.weight} kg)`);
  }
  S.mdfs = S.mdfs || {};
  for (const [k, m] of Object.entries(PLAN.mdfs)) {
    if (S.mdfs[k]) continue;
    const hit = rows(await get(`Mdf?where=size='${PLAN.mdfSize}'&columns=ROWID,thickness&limit=50`)).find((r) => String(r.thickness) === m.thickness);
    S.mdfs[k] = String(hit ? hit.ROWID : (await post("Mdf", { size: PLAN.mdfSize, thickness: m.thickness, weight_kg: m.weight_kg })).rowid); save();
    log(`· MDF ${PLAN.mdfSize} · ${m.thickness} mm ${S.mdfs[k]}`);
  }
  S.panels = S.panels || {};
  for (const [k, p] of Object.entries(PLAN.panels)) {
    if (S.panels[k]) continue;
    const r = await post("panel-save", {
      panel_code: "", // server mints PANEL-NNN
      panel_size: p.size, vinyl_size: p.vinyl, mdf_size: p.mdf ? PLAN.mdfSize : "",
      lines: p.lines.map((l) => ({ design: S.design, cut_piece_size: S.cuts[l.cut], cut_piece_qty: l.qty })),
    });
    S.panels[k] = String(r.rowid); save();
    const code = one(await get(`Panel/${S.panels[k]}`))?.panel_code;
    S.panelCodes = { ...(S.panelCodes || {}), [k]: code }; save();
    log(`· panel ${k} = ${code} ${S.panels[k]} (${p.lines.map((l) => `${PLAN.cuts[l.cut].name} ×${l.qty}`).join(", ")}${p.mdf ? ", MDF" : ", no MDF"})`);
  }
  if (!S.receipt) {
    await post("cut-stock-entry", {
      entry_date: today(), kind: "receipt", note: "ZZT seed — opening pieces",
      lines: Object.entries(PLAN.receipt).map(([k, qty]) => ({ design: S.design, cut_piece_size: S.cuts[k], qty })),
    });
    S.receipt = true; save();
    log(`· cut stock receipt ${Object.entries(PLAN.receipt).map(([k, q]) => `${PLAN.cuts[k].name} ×${q}`).join(", ")}`);
  }
}

/* ---------------- orders ---------------- */

const stockKey = (cut) => `${S.design}|${S.cuts[cut]}`;
const lineOf = (lines, panelKey) => lines.find((l) => String(l.panel) === S.panels[panelKey]);

/** mdf → vinyl → pasted for one panel (order satisfies the CR-366 gate on the new build;
    `panel` is ignored by today's LIVE and makes the mark per-panel on the CR-376 build). */
async function mark(orderId, panelKey, marks) {
  for (const key of ["mdf", "vinyl", "pasted", "cut"]) {
    if (!marks[key]) continue;
    await post(`panel-order-checkpoint/${orderId}`, { key, status: marks[key], ...(key === "cut" ? {} : { panel: S.panels[panelKey] }) });
  }
}

async function seedOrders() {
  S.orders = S.orders || {};
  let trip = 0;
  for (const o of PLAN.orders) {
    const st = (S.orders[o.key] = S.orders[o.key] || {});
    if (!st.id) {
      const r = await post("panel-order-save", {
        customer: S.customer, salesperson: PLAN.salesperson, order_date: today(),
        lines: o.lines.map((l) => ({ panel: S.panels[l.panel], qty: l.qty, ...(l.mdf ? { mdf: S.mdfs[l.mdf] } : {}) })),
      });
      st.id = String(r.rowid); st.number = r.data?.order_number; save();
      log(`· ${st.number} ${o.label}: ${o.lines.map((l) => `${S.panelCodes[l.panel]} ×${l.qty}`).join(" + ")}`);
    }
    // Lifecycle: born NewRequest → Received → InCutting → Ready (Ready adds the pending need to stock and books it).
    const steps = ["Received", "InCutting", "Ready"];
    const upto = steps.indexOf(o.status);
    for (let i = 0; i <= upto; i++) {
      if ((st.steps || []).includes(steps[i])) continue;
      await post(`panel-order-status/${st.id}`, { status: steps[i] });
      st.steps = [...(st.steps || []), steps[i]]; save();
    }
    if (o.book && !st.booked) {
      await post(`panel-order-allocate/${st.id}`, { allocation: Object.fromEntries(Object.entries(o.book).map(([c, q]) => [stockKey(c), q])) });
      st.booked = true; save();
      log(`·   booked ${Object.entries(o.book).map(([c, q]) => `${PLAN.cuts[c].name} ×${q}`).join(", ")}`);
    }
    if (!st.marked) {
      for (const [panelKey, marks] of Object.entries(o.marks || {})) await mark(st.id, panelKey, marks);
      // A panel that will LOAD needs its three marks Ready (CR-381 gate) + cut Ready for the derived progress.
      for (const panelKey of o.ready || []) await mark(st.id, panelKey, { mdf: "Ready", vinyl: "Ready", pasted: "Ready" });
      if (o.ready?.length) await post(`panel-order-checkpoint/${st.id}`, { key: "cut", status: "Ready" });
      st.marked = true; save();
      if (o.marks || o.ready) log(`·   marks: ${o.ready?.length ? "MDF · Vinyl · Pasted · Cut Ready" : Object.values(o.marks).map((m) => Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", ")).join("; ")}`);
    }
    st.trips = st.trips || [];
    for (let t = 0; t < (o.trips || []).length; t++, trip++) {
      if (st.trips[t]) continue;
      const lines = rows(await get(`PanelOrderLine?where=panel_order=${st.id}&limit=50`));
      const r = await post("panel-load-save", {
        load_date: today(), vehicle_number: PLAN.vehicles[trip % PLAN.vehicles.length],
        driver_name: `ZZT Driver ${trip + 1}`, driver_mobile: `98250 0000${trip + 1}`, note: `ZZT trip ${t + 1} — ${o.label}`,
        orders: [{ order_type: "Panel", order: st.id, lines: o.trips[t].map((p) => ({ line: String(lineOf(lines, p.panel).ROWID), material: p.material, qty: p.qty })) }],
      });
      st.trips[t] = { id: String(r.data.loads[0].ROWID), number: r.data.order_number, status: r.data.loads[0].status }; save();
      log(`·   ${r.data.order_number} on ${PLAN.vehicles[trip % PLAN.vehicles.length]}: ${o.trips[t].map((p) => `${S.panelCodes[p.panel]} ${p.material} ×${p.qty}`).join(", ")} → ${st.trips[t].status}`);
    }
  }
}

/* ---------------- flow map ---------------- */

async function flowMap() {
  const cust = one(await get(`Customer/${S.customer}`));
  log(`\n${cust.name}  (${cust.code})   panels ${Object.values(S.panelCodes).join(" · ")}`);
  const stock = rows(await get(`CutPieceStock?where=design=${S.design}&limit=50`));
  let bad = 0;
  for (const o of PLAN.orders) {
    const st = S.orders[o.key];
    const row = one(await get(`PanelOrder/${st.id}`));
    const loads = rows(await get(`PanelLoad?where=panel_order=${st.id}&limit=50`));
    const alloc = JSON.parse(row.allocation || "{}");
    const cp = JSON.parse(row.checkpoints || "{}");
    const marks = (k) => (cp.panels?.[S.panels[k]] || cp);
    const last = o === PLAN.orders[PLAN.orders.length - 1];
    log(`${last ? "└─" : "├─"} ${st.number}  ${String(row.status).padEnd(10)} ${o.label}`);
    log(`${last ? "  " : "│ "}    booked ${Object.entries(alloc).map(([k, q]) => `${Object.entries(PLAN.cuts).find(([c]) => stockKey(c) === k)?.[1].name || k} ×${q}`).join(", ") || "—"}`);
    for (const l of o.lines) {
      const m = marks(l.panel);
      log(`${last ? "  " : "│ "}    ${S.panelCodes[l.panel]} ×${l.qty}  mdf ${m.mdf?.status || "Pending"} · vinyl ${m.vinyl?.status || "Pending"} · pasted ${m.pasted?.status || "Pending"}`);
    }
    if (loads.length) log(`${last ? "  " : "│ "}    loads: ${loads.map((x) => `${x.order_number} ${x.vehicle_number}`).join(", ")}`);
    const want = o.key === "O5" ? "Dispatched" : o.status;
    if (String(row.status) !== want) { log(`${last ? "  " : "│ "}    ✗ expected ${want}`); bad++; }
  }
  log(`\ncut stock on hand: ${stock.map((s) => `${Object.entries(PLAN.cuts).find(([c]) => S.cuts[c] === String(s.cut_piece_size))?.[1].name || s.cut_piece_size} ${n(s.qty)}`).join(" · ")}`);
  if (stock.some((s) => n(s.qty) < 0)) { log("✗ negative cut stock"); bad++; }
  if (bad) throw new Error(`${bad} order(s) not in the expected state`);
}

/* ---------------- teardown ---------------- */

async function teardown() {
  const hard = async (table, id) => {
    try { await del(`${table}/${id}?hard=1`); log(`  − ${table} ${id}`); }
    catch (e) { log(`  ! ${table} ${id}: ${e.message}`); }
  };
  for (const st of Object.values(S.orders || {})) {
    if (!st.id) continue;
    for (const ld of rows(await get(`PanelLoad?where=panel_order=${st.id}&limit=50`))) {
      for (const l of rows(await get(`PanelLoadLine?where=panel_load=${ld.ROWID}&limit=50`))) await hard("PanelLoadLine", l.ROWID);
      await hard("PanelLoad", ld.ROWID);
    }
    for (const l of rows(await get(`PanelOrderLine?where=panel_order=${st.id}&limit=50`))) await hard("PanelOrderLine", l.ROWID);
    await hard("PanelOrder", st.id);
  }
  for (const id of Object.values(S.panels || {})) {
    for (const l of rows(await get(`PanelLine?where=panel=${id}&limit=50`))) await hard("PanelLine", l.ROWID); // orphans otherwise
    await hard("Panel", id);
  }
  for (const id of Object.values(S.mdfs || {})) await hard("Mdf", id);
  if (S.design) {
    for (const t of ["CutStockEntry", "CutPieceStock"]) for (const r of rows(await get(`${t}?where=design=${S.design}&limit=300`))) await hard(t, r.ROWID);
    await hard("Design", S.design);
  }
  for (const id of Object.values(S.cuts || {})) await hard("CutPieceSize", id);
  if (S.customer) await hard("Customer", S.customer);
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  log("\nTeardown done. OperationLog / StatusTransition rows are kept — they are the audit trail.");
}

/* ---------------- main ---------------- */

(async () => {
  await login();
  if (process.argv.includes("--teardown")) return teardown();
  await seedMasters();
  await seedOrders();
  await flowMap();
  log(`Seeded. Open Panel Craft ▸ Orders (customer ${PLAN.customer.name}). Teardown: node scripts/seed-panel-stages.mjs --teardown`);
})().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
