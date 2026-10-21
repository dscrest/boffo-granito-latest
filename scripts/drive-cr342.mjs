/* CR-342 API drive — MDF thickness variants under the Panel master, against the
   deployed data-ops function. Every record is prefixed ZZT and removed at the end.

     item + cut piece               → POST /Design, POST /cut-piece-save
     panel with 3 thicknesses       → POST /panel-save {mdf_size, mdf:[…]}  → 3 Mdf rows, size stamped
     bad variants                   → 400 (dup thickness · weight 0 · rows without mdf_size)
     order: foreign / missing / ok  → POST /panel-order-save 400 · 400 · 200 (line.mdf stored)
     edit panel                     → drop the thickness on the order → 409; drop another → soft-deleted;
                                      keep an id → updated in place
     clone                          → POST /panel-save without rowid carrying the source ids → fresh rows
     generic writes on Mdf          → POST / PATCH / DELETE refused
     panel delete                   → 409 while the order exists; after /panel-order-delete → 200, Mdf rows gone

   Teardown gotcha: the generic GET hides soft-deleted rows, so the Mdf / PanelLine / PanelOrderLine
   rows that /panel-delete and /panel-order-delete soft-deleted are NOT found here — remove them by
   ZCQL afterwards: DELETE FROM Mdf / PanelLine / PanelOrderLine WHERE panel IN (<ZZT panel ids>).

   Run:  BOFFO_TOKEN=<AuthSession token> node scripts/drive-cr342.mjs   (SEED_HOST overrides the host) */

const HOST = process.env.SEED_HOST || "https://boffo-granito-export-tracker-925638796.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;
const TOKEN = process.env.BOFFO_TOKEN || "";
let pass = 0;
let fail = 0;
const made = { panels: [], orders: [], design: null };

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
const liveMdf = async (panelId) => ((await get(`Mdf?where=panel%3D${panelId}&limit=300`)).rows || []).filter((r) => !r.deleted_at);
const byThick = (rows) => Object.fromEntries(rows.map((r) => [String(r.thickness), r]));

async function main() {
  const me = await get("auth/me");
  console.log(`· token user ${me.user?.email || "?"}`);
  const stamp = Date.now().toString(36).toUpperCase();
  const customer = String(((await get("Customer?limit=1")).rows || [])[0]?.ROWID || "");
  const cutSize = String(((await get("CutPieceSize?limit=1")).rows || [])[0]?.ROWID || "");
  if (!customer || !cutSize) throw new Error("need one Customer and one CutPieceSize on live");
  let design, panel, panel2, order, mdf, code = "";
  const variants = [{ thickness: "7 mm", weight_kg: 4.8 }, { thickness: "8 mm", weight_kg: 5.5 }, { thickness: "9 mm", weight_kg: 6.2 }];
  const panelBody = (extra) => ({ panel_code: extra && extra.rowid ? code : "", panel_size: "1200x2400", vinyl_size: "1200x2400", mdf_size: "1200x2400", mdf: variants, lines: [{ design, cut_piece_size: cutSize, cut_piece_qty: 2 }], ...extra });

  await check("item + cut piece", async () => {
    design = String((await post("Design", { design_name: `ZZT MDF ${stamp}`, unique_name: `ZZT MDF ${stamp}`, sku: `ZZTMDF${stamp}`, status: "Active" })).rowid);
    made.design = design;
    await post("cut-piece-save", { design, cut_piece_size: cutSize, weight_kg: 1.5 });
  });

  await check("panel with 3 thicknesses → 3 Mdf rows owned by it, size stamped", async () => {
    panel = String((await post("panel-save", panelBody())).rowid);
    made.panels.push(panel);
    code = String(((await get(`Panel?where=ROWID%3D${panel}&limit=1`)).rows || [])[0]?.panel_code || "");
    if (!code) throw new Error("no PANEL-NNN assigned");
    mdf = byThick(await liveMdf(panel));
    eq(Object.keys(mdf).length, 3, "rows");
    eq(String(mdf["8 mm"].size), "1200x2400", "size stamped from mdf_size");
    eq(Number(mdf["8 mm"].weight_kg), 5.5, "weight");
  });

  await check("bad variants → 400 (dup thickness · weight 0 · no mdf_size)", async () => {
    await post("panel-save", panelBody({ rowid: panel, mdf: [...variants, { thickness: "8 MM", weight_kg: 1 }] }), { expect: 400 });
    await post("panel-save", panelBody({ rowid: panel, mdf: [{ thickness: "6 mm", weight_kg: 0 }] }), { expect: 400 });
    await post("panel-save", panelBody({ rowid: panel, mdf_size: "" }), { expect: 400 });
    eq(Object.keys(byThick(await liveMdf(panel))).length, 3, "nothing written on a refused save");
  });

  await check("order: a thickness of another panel → 400; none while configured → 400; the panel's own → 200", async () => {
    const foreign = String(((await get("Mdf?limit=300")).rows || []).find((r) => String(r.panel) !== panel && !r.deleted_at)?.ROWID || "1");
    await post("panel-order-save", { customer, salesperson: "ZZT", lines: [{ panel, qty: 10, mdf: foreign }] }, { expect: 400 });
    const r = await post("panel-order-save", { customer, salesperson: "ZZT", lines: [{ panel, qty: 10 }] }, { expect: 400 });
    if (!/Pick the MDF thickness/.test(r.error || "")) throw new Error(`wrong message: ${r.error}`);
    order = String((await post("panel-order-save", { customer, salesperson: "ZZT", lines: [{ panel, qty: 10, mdf: mdf["8 mm"].ROWID }] })).rowid);
    made.orders.push(order);
    const line = ((await get(`PanelOrderLine?where=panel_order%3D${order}&limit=10`)).rows || [])[0];
    eq(String(line?.mdf), String(mdf["8 mm"].ROWID), "line.mdf stored");
  });

  await check("edit: dropping the thickness on the order → 409; dropping another soft-deletes it; a kept id updates in place", async () => {
    const keep = (t) => ({ id: mdf[t].ROWID, thickness: t, weight_kg: Number(mdf[t].weight_kg) });
    await post("panel-save", panelBody({ rowid: panel, mdf: [keep("7 mm"), keep("9 mm")] }), { expect: 409 });
    await post("panel-save", panelBody({ rowid: panel, mdf: [keep("7 mm"), { ...keep("8 mm"), weight_kg: 5.75 }] }));
    const now = byThick(await liveMdf(panel));
    eq(Object.keys(now).sort().join(","), "7 mm,8 mm", "9 mm gone");
    eq(String(now["8 mm"].ROWID), String(mdf["8 mm"].ROWID), "8 mm kept its ROWID");
    eq(Number(now["8 mm"].weight_kg), 5.75, "8 mm weight updated");
    mdf = now;
  });

  await check("clone: source ids on a new panel insert fresh rows", async () => {
    const src = Object.values(mdf).map((r) => ({ id: r.ROWID, thickness: r.thickness, weight_kg: Number(r.weight_kg) }));
    panel2 = String((await post("panel-save", panelBody({ mdf: src }))).rowid);
    made.panels.push(panel2);
    const rows = await liveMdf(panel2);
    eq(rows.length, src.length, "clone carries every source row");
    if (rows.some((r) => src.some((s) => String(s.id) === String(r.ROWID)))) throw new Error("clone reused a source ROWID");
    eq((await liveMdf(panel)).length, src.length, "source untouched");
  });

  await check("generic POST / PATCH / DELETE on Mdf refused", async () => {
    await post("Mdf", { size: "x", thickness: "1 mm", weight_kg: 1 }, { expect: 400 });
    await patch(`Mdf/${mdf["8 mm"].ROWID}`, { weight_kg: 1 }, { expect: 400 });
    await del(`Mdf/${mdf["8 mm"].ROWID}`, { expect: 400 });
  });

  await check("panel delete → 409 while ordered; after the order goes, 200 and its Mdf rows are soft-deleted", async () => {
    await post(`panel-delete/${panel}`, { reason: "ZZT drive" }, { expect: 409 });
    await post(`panel-order-delete/${order}`, { reason: "ZZT drive" });
    await post(`panel-delete/${panel}`, { reason: "ZZT drive" });
    eq((await liveMdf(panel)).length, 0, "no live Mdf rows left");
  });
}

async function teardown() {
  console.log("· teardown");
  for (const o of made.orders) {
    for (const l of (await get(`PanelOrderLine?where=panel_order%3D${o}&limit=50`).catch(() => ({ rows: [] }))).rows || []) await del(`PanelOrderLine/${l.ROWID}?hard=1`).catch(() => {});
    await del(`PanelOrder/${o}?hard=1`).catch((e) => console.log(`  (skip PanelOrder/${o}: ${e.message})`));
  }
  for (const p of made.panels) {
    for (const t of ["Mdf", "PanelLine"]) {
      for (const r of (await get(`${t}?where=panel%3D${p}&limit=50`).catch(() => ({ rows: [] }))).rows || []) await del(`${t}/${r.ROWID}?hard=1`).catch((e) => console.log(`  (skip ${t}/${r.ROWID}: ${e.message})`));
    }
    await del(`Panel/${p}?hard=1`).catch((e) => console.log(`  (skip Panel/${p}: ${e.message})`));
  }
  if (made.design) {
    for (const t of ["CutStockEntry", "CutPieceStock"]) {
      for (const r of (await get(`${t}?where=design%3D${made.design}&limit=50`).catch(() => ({ rows: [] }))).rows || []) await del(`${t}/${r.ROWID}?hard=1`).catch((e) => console.log(`  (skip ${t}/${r.ROWID}: ${e.message})`));
    }
    await del(`Design/${made.design}?hard=1`).catch((e) => console.log(`  (skip Design/${made.design}: ${e.message})`));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { fail++; console.error("✗ drive aborted:", e.message); })
  .finally(() => teardown().then(() => process.exit(fail ? 1 : 0)));
