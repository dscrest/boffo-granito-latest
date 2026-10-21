/* Dummy Panel Craft data for UI testing — a test customer + four panel orders in Dhiraj's name that
   leave the loading / dispatch conditions in every state (CR-347…352). NOTHING is torn down: the rows
   stay on LIVE for hands-on testing; remove them from the UI (Delete with reason) when done.

     Customer  "Dhiraj Test Traders" (code DHJTEST)
     Order A   PANEL-004 ×2 (MDF 7 mm) + PANEL-005 ×1 → Ready → panels of PANEL-004 loaded, MDF + PANEL-005 pending
               (Partially loaded — finish it in the UI: load the MDF only, then PANEL-005)
     Order B   PANEL-005 ×3 + loose cut pieces ×10 → Ready → trip 1 panels, trip 2 pieces → Dispatched (derived)
     Order C   PANEL-004 ×1 → Received only (Not loaded; Record Load warns to book first)
     Order D   PANEL-004 ×2 + PANEL-005 ×2 → Ready → MDF boards loaded first, every panel pending

   Run:  BOFFO_TOKEN=<AuthSession token> node scripts/seed-panel-dhiraj.mjs
         (or BOFFO_TOKEN_FILE=<file holding the token>; SEED_HOST overrides the host) */
import { readFileSync } from "node:fs";

const HOST = process.env.SEED_HOST || "https://boffo-granito-export-tracker-925638796.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;
const TOKEN = (process.env.BOFFO_TOKEN || (process.env.BOFFO_TOKEN_FILE ? readFileSync(process.env.BOFFO_TOKEN_FILE, "utf8") : "")).trim();
if (!TOKEN) throw new Error("BOFFO_TOKEN (or BOFFO_TOKEN_FILE) is required");

const SALESPERSON = "Dhiraj Sajagure";
const PANEL_004 = "69851000000326334"; // mdf_size 1200x2400 → MDF 7 mm row below
const PANEL_005 = "69851000000351399"; // no MDF size → no board
const MDF_7MM = "69851000000325598";

async function call(method, path, body, { expect = 200 } = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-App-Token": TOKEN },
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
const rows = async (t, where) => ((await get(`${t}?where=${encodeURIComponent(where)}&limit=300`)).rows || []).filter((r) => !r.deleted_at);
const today = new Date().toISOString().slice(0, 10);
const log = (s) => console.log(`· ${s}`);

async function order(customer, lines, label) {
  const id = String((await post("panel-order-save", { customer, salesperson: SALESPERSON, order_date: today, lines })).rowid);
  const o = (await rows("PanelOrder", `ROWID=${id}`))[0];
  const ls = await rows("PanelOrderLine", `panel_order=${id}`);
  log(`${label}: ${o.order_number} (${ls.length} lines)`);
  return { id, number: String(o.order_number), lines: ls };
}
const lineOf = (o, panel) => o.lines.find((l) => (panel ? String(l.panel) === panel : !l.panel || String(l.panel) === ""));
async function status(o, s) {
  await post(`panel-order-status/${o.id}`, { status: s });
}
async function ready(o) {
  await status(o, "Received");
  await status(o, "InCutting");
  await status(o, "Ready"); // adds the pending need to cut stock and books it
}
async function load(o, picks, vehicle, driver, mobile, note) {
  const r = await post("panel-load-save", {
    load_date: today,
    vehicle_number: vehicle,
    driver_name: driver,
    driver_mobile: mobile,
    note,
    orders: [{ order_type: "Panel", order: o.id, lines: picks }],
  });
  log(`  ${r.data.order_number} on ${vehicle} (${driver}) → ${o.number} is ${r.data.loads[0].status}`);
  return r.data.order_number;
}

async function main() {
  const me = await get("auth/me");
  log(`signed in as ${me.user?.email || "?"} (${me.user?.role || "?"})`);

  // Customer
  const existing = (await rows("Customer", "code='DHJTEST'"))[0];
  const customer = existing
    ? String(existing.ROWID)
    : String((await post("Customer", {
        code: "DHJTEST",
        name: "Dhiraj Test Traders",
        country_code: "IN",
        currency: "INR",
        address: "Test lane, Morbi, Gujarat",
        port_of_discharge: "",
        active: true,
      })).rowid);
  log(`customer Dhiraj Test Traders → ${customer}${existing ? " (already there)" : ""}`);

  // A loose cut-piece line uses a design + cut size that PANEL-005 already carries.
  const p5 = (await rows("PanelLine", `panel=${PANEL_005}`))[0];
  if (!p5) throw new Error("PANEL-005 has no lines on live");

  // Order A — panels first, MDF later
  const a = await order(customer, [{ panel: PANEL_004, qty: 2, mdf: MDF_7MM }, { panel: PANEL_005, qty: 1 }], "Order A (panels first, MDF + PANEL-005 pending)");
  await ready(a);
  await load(a, [{ line: lineOf(a, PANEL_004).ROWID, material: "Panel", qty: 2 }], "GJ-01-DH-0001", "Ramesh Patel", "98250 11111", "Panels only — boards follow");

  // Order B — fully dispatched over two trips
  const b = await order(customer, [{ panel: PANEL_005, qty: 3 }, { design: String(p5.design), cut_piece_size: String(p5.cut_piece_size), qty: 10 }], "Order B (two trips → Dispatched)");
  await ready(b);
  await load(b, [{ line: lineOf(b, PANEL_005).ROWID, material: "Panel", qty: 3 }], "GJ-01-DH-0002", "Suresh Makwana", "98250 22222", "Trip 1 — panels");
  await load(b, [{ line: lineOf(b, "").ROWID, material: "Item", qty: 10 }], "GJ-01-DH-0003", "Mahesh Jadeja", "98250 33333", "Trip 2 — loose cut pieces");

  // Order C — nothing loaded, not yet booked
  const c = await order(customer, [{ panel: PANEL_004, qty: 1, mdf: MDF_7MM }], "Order C (Received, nothing loaded)");
  await status(c, "Received");

  // Order D — MDF boards first, every panel pending
  const d = await order(customer, [{ panel: PANEL_004, qty: 2, mdf: MDF_7MM }, { panel: PANEL_005, qty: 2 }], "Order D (MDF first, panels pending)");
  await ready(d);
  await load(d, [{ line: lineOf(d, PANEL_004).ROWID, material: "Mdf", qty: 2 }], "GJ-01-DH-0004", "Ramesh Patel", "98250 11111", "Boards only — panels follow");

  console.log("\nDone. Open Panel Craft ▸ Orders (customer Dhiraj Test Traders) and Panel Craft ▸ Loading.");
}

main().catch((e) => { console.error("✗ seed aborted:", e.message); process.exit(1); });
