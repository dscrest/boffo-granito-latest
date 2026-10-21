/* CR-344…348 API drive — size-keyed MDF master, cut-piece lines, loading entries, auto-dispatch,
   sample loads — against the deployed data-ops function. Every record is prefixed ZZT and removed.

     MDF master                     → generic POST / PATCH on Mdf allowed again (CR-344); /migrate-mdf-sizes ×2 (admin)
     panel (mdf_size only)          → POST /panel-save; order line: other-size Mdf 400 · missing 400 · match 200
     cut-piece line (CR-346)        → a line {design, cut_piece_size, qty} beside the panel; need = pieces
     loads (CR-347)                 → MDF only (status unchanged), panels unbooked 409, book → Ready → load 2 of 3
                                      (stock −, booking −, still Ready) → last panel + pieces → Dispatched + transition
     guards                         → over-pending 400, edit/delete loaded order 409, final load delete 409,
                                      generic POST on PanelLoad 400, /sample-order-supply 404, status Dispatched 409
     multi-order trip               → one LD number on a panel order AND a sample order; sample Cut line → stock −,
                                      supplied_qty, PartiallySupplied; removing that load unwinds it
     weight stamp (CR-349)          → PanelLoadLine.weight_kg = unit × qty at load time

   Run:  BOFFO_TOKEN=<AuthSession token of an Admin> node scripts/drive-cr347.mjs   (SEED_HOST overrides the host) */

const HOST = process.env.SEED_HOST || "https://boffo-granito-export-tracker-925638796.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;
const TOKEN = process.env.BOFFO_TOKEN || "";
let pass = 0;
let fail = 0;
const made = { design: null, mdf: [], panels: [], orders: [], samples: [], loads: [] };

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
const order1 = async (id) => (await rows("PanelOrder", `ROWID=${id}`))[0];
const onHand = async (design, cut) => Number(((await rows("CutPieceStock", `design=${design}`)).find((r) => String(r.cut_piece_size) === String(cut)) || {}).qty || 0);
const alloc = async (id) => JSON.parse((await order1(id)).allocation || "{}");

async function main() {
  const me = await get("auth/me");
  console.log(`· token user ${me.user?.email || "?"} (${me.user?.role || "?"})`);
  const stamp = Date.now().toString(36).toUpperCase();
  const customer = String(((await get("Customer?limit=1")).rows || [])[0]?.ROWID || "");
  const cutSize = String(((await get("CutPieceSize?limit=1")).rows || [])[0]?.ROWID || "");
  if (!customer || !cutSize) throw new Error("need one Customer and one CutPieceSize on live");
  const size = `ZZT${stamp}`;
  let design, panel, code, order, pLine, cLine, order2, p2Line, sample, sLine, key, m8, m12, mOther;
  const today = new Date().toISOString().slice(0, 10);

  await check("MDF master is size-keyed and editable again: generic POST / PATCH on Mdf → 200", async () => {
    m8 = String((await post("Mdf", { size, thickness: "8 mm", weight_kg: 5.5 })).rowid);
    m12 = String((await post("Mdf", { size, thickness: "12 mm", weight_kg: 7 })).rowid);
    mOther = String((await post("Mdf", { size: `${size}-other`, thickness: "8 mm", weight_kg: 5 })).rowid);
    made.mdf.push(m8, m12, mOther);
    await patch(`Mdf/${m12}`, { weight_kg: 7.25 });
    eq(Number((await rows("Mdf", `ROWID=${m12}`))[0].weight_kg), 7.25, "patched weight");
  });

  await check("/migrate-mdf-sizes runs twice; the second merges nothing", async () => {
    await post("migrate-mdf-sizes", {});
    const r = await post("migrate-mdf-sizes", {});
    eq(Number(r.data?.merged), 0, "second run merged");
  });

  await check("item + cut piece + panel (mdf_size only — no variant rows on /panel-save)", async () => {
    design = String((await post("Design", { design_name: `ZZT LOAD ${stamp}`, unique_name: `ZZT LOAD ${stamp}`, sku: `ZZTLD${stamp}`, status: "Active" })).rowid);
    made.design = design;
    key = `${design}|${cutSize}`;
    await post("cut-piece-save", { design, cut_piece_size: cutSize, weight_kg: 1.5 });
    panel = String((await post("panel-save", { panel_code: "", panel_size: "1200x2400", vinyl_size: "1200x2400", mdf_size: size, lines: [{ design, cut_piece_size: cutSize, cut_piece_qty: 2 }] })).rowid);
    made.panels.push(panel);
    code = String((await rows("Panel", `ROWID=${panel}`))[0]?.panel_code || "");
    if (!code) throw new Error("no PANEL-NNN assigned");
  });

  await check("order line: an Mdf of another size → 400; none while the size has rows → 400; a match + a loose cut-piece line → 200", async () => {
    await post("panel-order-save", { customer, salesperson: "ZZT", lines: [{ panel, qty: 3, mdf: mOther }] }, { expect: 400 });
    const r = await post("panel-order-save", { customer, salesperson: "ZZT", lines: [{ panel, qty: 3 }] }, { expect: 400 });
    if (!/Pick the MDF thickness/.test(r.error || "")) throw new Error(`wrong message: ${r.error}`);
    await post("panel-order-save", { customer, salesperson: "ZZT", lines: [{ design, cut_piece_size: cutSize, qty: 20, mdf: m8 }] }, { expect: 400 }); // CR-346: a cut line has no MDF
    order = String((await post("panel-order-save", { customer, salesperson: "ZZT", lines: [{ panel, qty: 3, mdf: m8 }, { design, cut_piece_size: cutSize, qty: 20 }] })).rowid);
    made.orders.push(order);
    const ls = await rows("PanelOrderLine", `panel_order=${order}`);
    eq(ls.length, 2, "two lines");
    pLine = ls.find((l) => String(l.panel) === panel);
    cLine = ls.find((l) => !l.panel || String(l.panel) === "");
    if (!pLine || !cLine) throw new Error("panel line + cut-piece line expected");
    eq(String(cLine.design), design, "cut line design");
    eq(String(pLine.mdf), m8, "line.mdf stored");
  });

  await check("Accept; load the MDF boards only → status unchanged, Partially loaded, booking untouched, kg stamped", async () => {
    await post(`panel-order-status/${order}`, { status: "Received" });
    const r = await post("panel-load-save", { load_date: today, vehicle_number: "GJ01ZZT0001", note: "ZZT boards", orders: [{ order_type: "Panel", order, lines: [{ line: pLine.ROWID, material: "Mdf", qty: 3 }] }] });
    const ld = r.data.loads[0];
    made.loads.push(ld.ROWID);
    if (!/^LD\//.test(r.data.order_number)) throw new Error(`no LD number: ${r.data.order_number}`);
    eq(ld.status, "Received", "status unchanged");
    const ll = await rows("PanelLoadLine", `panel_load=${ld.ROWID}`);
    eq(ll.length, 1, "one load line");
    eq(Number(ll[0].weight_kg), 16.5, "3 boards × 5.5 kg stamped");
    eq(Object.keys(await alloc(order)).length, 0, "booking untouched by an MDF load");
  });

  await check("panels unbooked → 409 'Book …'; book + stock → InCutting → Ready adds the PENDING need and books it", async () => {
    const r = await post("panel-load-save", { load_date: today, vehicle_number: "GJ01ZZT0002", orders: [{ order_type: "Panel", order, lines: [{ line: pLine.ROWID, material: "Panel", qty: 1 }] }] }, { expect: 409 });
    if (!/Book /.test(r.error || "")) throw new Error(`wrong message: ${r.error}`);
    await post(`panel-order-status/${order}`, { status: "InCutting" });
    const before = await onHand(design, cutSize);
    await post(`panel-order-status/${order}`, { status: "Ready" });
    eq((await onHand(design, cutSize)) - before, 3 * 2 + 20, "Ready added the pending need (3 panels × 2 + 20 loose)");
    eq(Number((await alloc(order))[key]), 26, "booked = need");
  });

  await check("load 2 of 3 panels → stock −4, booking −4, still Ready; over-pending → 400", async () => {
    const before = await onHand(design, cutSize);
    await post("panel-load-save", { load_date: today, vehicle_number: "GJ01ZZT0003", orders: [{ order_type: "Panel", order, lines: [{ line: pLine.ROWID, material: "Panel", qty: 5 }] }] }, { expect: 400 });
    const r = await post("panel-load-save", { load_date: today, vehicle_number: "GJ01ZZT0003", orders: [{ order_type: "Panel", order, lines: [{ line: pLine.ROWID, material: "Panel", qty: 2 }] }] });
    made.loads.push(r.data.loads[0].ROWID);
    eq(r.data.loads[0].status, "Ready", "still Ready");
    eq(before - (await onHand(design, cutSize)), 4, "2 panels × 2 pieces left stock");
    eq(Number((await alloc(order))[key]), 22, "booking shrank with the stock");
    const ll = await rows("PanelLoadLine", `panel_load=${r.data.loads[0].ROWID}`);
    eq(Number(ll[0].weight_kg), 2 * 2 * 1.5, "2 panels × 2 pieces × 1.5 kg stamped");
    await post("panel-order-save", { rowid: order, customer, salesperson: "ZZT", lines: [{ panel, qty: 3, mdf: m8 }] }, { expect: 409 });
    await post(`panel-order-delete/${order}`, { reason: "ZZT" }, { expect: 409 });
  });

  await check("last panel + the 20 loose pieces → Dispatched (derived) + StatusTransition; the final load cannot be removed", async () => {
    const r = await post("panel-load-save", { load_date: today, vehicle_number: "GJ01ZZT0004", orders: [{ order_type: "Panel", order, lines: [{ line: pLine.ROWID, material: "Panel", qty: 1 }, { line: cLine.ROWID, material: "Item", qty: 20 }] }] });
    made.loads.push(r.data.loads[0].ROWID);
    eq(r.data.loads[0].status, "Dispatched", "flipped");
    eq(String((await order1(order)).status), "Dispatched", "stored");
    eq(Object.keys(await alloc(order)).length, 0, "booking consumed");
    const tr = await rows("StatusTransition", `entity_rowid=${order}`);
    if (!tr.some((t) => String(t.to_status) === "Dispatched")) throw new Error("no Dispatched transition row");
    await post(`panel-load-delete/${r.data.loads[0].ROWID}`, { reason: "ZZT" }, { expect: 409 });
    await post(`panel-order-status/${order}`, { status: "Dispatched" }, { expect: 409 });
  });

  await check("multi-order trip: a second panel order + a sample order share ONE LD number; sample Cut line → stock −, PartiallySupplied", async () => {
    order2 = String((await post("panel-order-save", { customer, salesperson: "ZZT", lines: [{ panel, qty: 1, mdf: m12 }] })).rowid);
    made.orders.push(order2);
    await post(`panel-order-status/${order2}`, { status: "Received" });
    p2Line = (await rows("PanelOrderLine", `panel_order=${order2}`))[0];
    sample = String((await post("sample-order-save", { customer, salesperson: "ZZT", lines: [{ design, piece_kind: "Cut", cut_piece_size: cutSize, qty: 5 }] })).rowid);
    made.samples.push(sample);
    sLine = (await rows("SampleOrderLine", `sample_order=${sample}`))[0];
    await post("cut-stock-entry", { entry_date: today, kind: "receipt", lines: [{ design, cut_piece_size: cutSize, qty: 10 }] });
    const before = await onHand(design, cutSize);
    const r = await post("panel-load-save", {
      load_date: today, vehicle_number: "GJ01ZZT0005",
      orders: [
        { order_type: "Panel", order: order2, lines: [{ line: p2Line.ROWID, material: "Mdf", qty: 1 }] },
        { order_type: "Sample", order: sample, lines: [{ line: sLine.ROWID, material: "Item", qty: 2 }] },
      ],
    });
    for (const l of r.data.loads) made.loads.push(l.ROWID);
    eq(r.data.loads.length, 2, "two PanelLoad rows");
    const nums = new Set((await rows("PanelLoad", `order_number='${r.data.order_number}'`)).map((x) => String(x.order_number)));
    eq(nums.size, 1, "one LD number shared");
    eq(r.data.loads[1].status, "PartiallySupplied", "sample status derived");
    eq(before - (await onHand(design, cutSize)), 2, "sample Cut pieces left stock");
    eq(Number((await rows("SampleOrderLine", `ROWID=${sLine.ROWID}`))[0].supplied_qty), 2, "supplied_qty");
  });

  await check("removing the sample's load unwinds supply + stock; removing the open panel order's MDF load → 200", async () => {
    const sampleLoad = (await rows("PanelLoad", `sample_order=${sample}`))[0];
    const before = await onHand(design, cutSize);
    await post(`panel-load-delete/${sampleLoad.ROWID}`, { reason: "ZZT undo" });
    eq((await onHand(design, cutSize)) - before, 2, "pieces back");
    eq(Number((await rows("SampleOrderLine", `ROWID=${sLine.ROWID}`))[0].supplied_qty), 0, "supplied_qty unwound");
    eq(String((await rows("SampleOrder", `ROWID=${sample}`))[0].status), "New", "status re-derived");
    const l2 = (await rows("PanelLoad", `panel_order=${order2}`))[0];
    await post(`panel-load-delete/${l2.ROWID}`, { reason: "ZZT undo" });
    eq((await rows("PanelLoad", `panel_order=${order2}`)).length, 0, "load gone");
  });

  await check("guards: generic POST on PanelLoad → 400; /sample-order-supply → 404", async () => {
    await post("PanelLoad", { order_type: "Panel", panel_order: order2 }, { expect: 400 });
    await post(`sample-order-supply/${sample}`, { date: today, lines: [] }, { expect: 404 });
  });
}

async function teardown() {
  console.log("· teardown");
  const hard = async (t, id) => del(`${t}/${id}?hard=1`).catch((e) => console.log(`  (skip ${t}/${id}: ${e.message})`));
  for (const id of made.loads) {
    for (const l of (await get(`PanelLoadLine?where=panel_load%3D${id}&limit=50`).catch(() => ({ rows: [] }))).rows || []) await hard("PanelLoadLine", l.ROWID);
    await hard("PanelLoad", id);
  }
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
  for (const m of made.mdf) await hard("Mdf", m);
  if (made.design) {
    for (const t of ["CutStockEntry", "CutPieceStock"]) {
      for (const r of (await get(`${t}?where=design%3D${made.design}&limit=100`).catch(() => ({ rows: [] }))).rows || []) await hard(t, r.ROWID);
    }
    await hard("Design", made.design);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { fail++; console.error("✗ drive aborted:", e.message); })
  .finally(() => teardown().then(() => process.exit(fail ? 1 : 0)));
