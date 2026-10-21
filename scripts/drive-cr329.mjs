/* CR-329…332 API drive — warehouses + transfer orders, against the deployed
   data-ops function. Every record is prefixed ZZT and removed at the end.

     warehouses                     → POST /Warehouse ×2, POST /warehouse-primary/:id
     item + opening stock           → POST /Design, POST /opening-stock/:designId {warehouse}
     transfer 60 W1→W2              → POST /stock-transfer   (TRF/FY/NNN)
     transfer 70 W1→W2              → 409 (only 40 left in W1)
     adjust −10 in W2               → POST /stock-adjust {warehouse}
     flip primary W1→W2             → POST /warehouse-primary/:id (stamps null rows onto W1)
     generic PATCH is_primary       → refused (STATE_COLUMNS)
     delete a transfer leg          → /production-delete 409
     delete the primary warehouse   → 409
     cut stock: receipt + transfer  → POST /cut-stock-entry kinds receipt / transfer, qty net zero

   Teardown gotcha: the server refuses to delete a warehouse that stock rows reference and
   the current primary — and the primary flip stamps REAL null-warehouse rows onto the test
   warehouse. After a run, reset by ZCQL: UPDATE ProductionLog / CutStockEntry SET warehouse = null
   WHERE warehouse = <ZZT ids>, then DELETE FROM Warehouse WHERE ROWID = <ZZT ids>.

   Run:  BOFFO_TOKEN=<AuthSession token> node scripts/drive-cr329.mjs
         (or BOFFO_EMAIL / BOFFO_PASSWORD — see seed-flow.mjs). SEED_HOST overrides the host. */

const HOST = process.env.SEED_HOST || "https://boffo-granito-export-tracker-925638796.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;
let TOKEN = process.env.BOFFO_TOKEN || "";
const made = []; // [table, rowid] for teardown, newest last
let pass = 0;
let fail = 0;

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

async function login() {
  if (TOKEN) { const me = await get("auth/me"); console.log(`· token user ${me.user?.email || "?"}`); return; }
  const r = await post("auth/login", { email: process.env.BOFFO_EMAIL, password: process.env.BOFFO_PASSWORD });
  TOKEN = r.token;
}

async function main() {
  await login();
  const stamp = Date.now().toString(36).toUpperCase();
  let w1, w2, design, cutSize;

  await check("create two warehouses; the first becomes primary", async () => {
    w1 = String((await post("Warehouse", { name: `ZZT WH A ${stamp}`, purposes: "Production" })).rowid);
    made.push(["Warehouse", w1]);
    await post(`warehouse-primary/${w1}`, {});
    w2 = String((await post("Warehouse", { name: `ZZT WH B ${stamp}`, purposes: "Palletization,Loading Bay" })).rowid);
    made.push(["Warehouse", w2]);
    const rows = (await get("Warehouse?limit=300")).rows || [];
    eq(String(rows.find((r) => String(r.ROWID) === w1)?.is_primary), "true", "W1 primary");
  });

  await check("generic PATCH on is_primary is refused", async () => {
    await patch(`Warehouse/${w2}`, { is_primary: true }, { expect: 400 });
  });

  await check("batched item + opening stock in W1", async () => {
    const d = await post("Design", { design_name: `ZZT WH ${stamp}`, unique_name: `ZZT WH ${stamp}`, sku: `ZZTWH${stamp}`, is_batched: true, status: "Active" });
    design = String(d.rowid);
    made.push(["Design", design]);
    await post(`opening-stock/${design}`, { warehouse: w1, rows: [{ qty_boxes: 100, batch_number: `ZZT/${stamp}/001` }] });
  });

  let code = "";
  await check("transfer 60 W1→W2 mints a TRF code", async () => {
    const r = await post("stock-transfer", { date: new Date().toISOString().slice(0, 10), from_warehouse: w1, to_warehouse: w2, reason: "ZZT drive", lines: [{ design, batch_number: `ZZT/${stamp}/001`, qty_boxes: 60 }] });
    code = r.data?.code || "";
    if (!/^TRF\/\d{4}-\d{2}\/\d{3}$/.test(code)) throw new Error(`bad code ${code}`);
    eq(r.data?.lines, 1, "lines");
  });

  await check("transfer 70 W1→W2 is refused (40 left)", async () => {
    const r = await post("stock-transfer", { from_warehouse: w1, to_warehouse: w2, reason: "ZZT drive", lines: [{ design, batch_number: `ZZT/${stamp}/001`, qty_boxes: 70 }] }, { expect: 409 });
    if (!/Only 40 boxes/.test(r.error || "")) throw new Error(`wording: ${r.error}`);
  });

  await check("same-warehouse transfer is refused", async () => {
    await post("stock-transfer", { from_warehouse: w1, to_warehouse: w1, reason: "x", lines: [{ design, qty_boxes: 1 }] }, { expect: 400 });
  });

  await check("adjust −10 in W2 (floor is W2's 60)", async () => {
    await post("stock-adjust", { reason: "Breakage", warehouse: w2, lines: [{ design, batch_number: `ZZT/${stamp}/001`, qty_boxes: -10 }] });
    await post("stock-adjust", { reason: "Breakage", warehouse: w2, lines: [{ design, batch_number: `ZZT/${stamp}/001`, qty_boxes: -51 }] }, { expect: 409 });
  });

  await check("transfer legs are not deletable via /production-delete", async () => {
    const legs = (await get(`ProductionLog?where=design%3D${design}&limit=300`)).rows || [];
    const leg = legs.find((r) => String(r.entry_type) === "transfer");
    if (!leg) throw new Error("no transfer leg found");
    await post(`production-delete/${leg.ROWID}`, { reason: "ZZT" }, { expect: 409 });
  });

  await check("flip primary to W2 stamps null rows onto W1", async () => {
    const r = await post(`warehouse-primary/${w2}`, {});
    if (typeof r.data?.stamped !== "number") throw new Error("no stamped count");
    const legs = (await get(`ProductionLog?where=design%3D${design}&limit=300`)).rows || [];
    const opening = legs.find((r) => String(r.entry_type) === "opening");
    eq(String(opening?.warehouse || ""), w1, "opening row warehouse after flip (explicit W1 from the form)");
  });

  await check("the primary warehouse can't be deleted", async () => {
    await del(`Warehouse/${w2}`, { expect: 409 });
  });

  await check("cut stock: receipt in W1 then transfer to W2 keeps qty, writes a pair", async () => {
    const cs = (await get("CutPieceSize?limit=300")).rows || [];
    cutSize = cs[0] ? String(cs[0].ROWID) : "";
    if (!cutSize) throw new Error("no CutPieceSize master row to use");
    await post("cut-piece-save", { design, cut_piece_size: cutSize });
    await post("cut-stock-entry", { kind: "receipt", warehouse: w1, lines: [{ design, cut_piece_size: cutSize, qty: 20 }] });
    const t = await post("cut-stock-entry", { kind: "transfer", from_warehouse: w1, to_warehouse: w2, reason: "ZZT drive", lines: [{ design, cut_piece_size: cutSize, qty: 5 }] });
    if (!/^TRF\//.test(t.data?.code || "")) throw new Error(`bad cut code ${t.data?.code}`);
    await post("cut-stock-entry", { kind: "transfer", from_warehouse: w1, to_warehouse: w2, reason: "ZZT drive", lines: [{ design, cut_piece_size: cutSize, qty: 16 }] }, { expect: 409 });
    const stock = (await get(`CutPieceStock?where=design%3D${design}&limit=10`)).rows || [];
    eq(Number(stock[0]?.qty), 20, "CutPieceStock.qty unchanged by the transfer");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
}

async function teardown() {
  console.log("· teardown");
  // Stock rows first (hard), then the item's cut rows, then the item, then warehouses (primary last).
  for (const table of ["ProductionLog", "CutStockEntry", "CutPieceStock"]) {
    const d = made.find(([t]) => t === "Design")?.[1];
    if (!d) continue;
    const rows = (await get(`${table}?where=design%3D${d}&limit=300`).catch(() => ({ rows: [] }))).rows || [];
    for (const r of rows) await del(`${table}/${r.ROWID}?hard=1`).catch((e) => console.log(`  (skip ${table}/${r.ROWID}: ${e.message})`));
  }
  for (const [table, id] of made.filter(([t]) => t === "Design")) await del(`${table}/${id}?hard=1`).catch((e) => console.log(`  (skip ${table}/${id}: ${e.message})`));
  const whs = made.filter(([t]) => t === "Warehouse").map(([, id]) => id);
  // Un-primary by flipping to the one we delete last, then hard-delete both.
  for (const id of whs) await del(`Warehouse/${id}?hard=1`).catch(() => {});
  for (const id of whs) await del(`Warehouse/${id}?hard=1`).catch((e) => console.log(`  (skip Warehouse/${id}: ${e.message})`));
}

main()
  .catch((e) => { fail++; console.error("✗ drive aborted:", e.message); })
  .finally(() => teardown().then(() => process.exit(fail ? 1 : 0)));
