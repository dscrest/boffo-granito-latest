/* CR-446 / CR-447 API drive — per-line date · reason on the two adjustment routes, the per-bay floor,
   and the Title Case columns CR-447 added — against a deployed data-ops function (DEMO first).
   Every record is prefixed ZZT and removed at the end. Needs a warehouse with bay A1 (Production purpose).

   CR-446  /stock-adjust
     seed            → batched ZZT Design, opening 10 boxes (batch ZZT/<stamp>/001) at Production ▸ A1
     floor per bay   → [−6 "ZZT a", −6 "ZZT b"] same batch / bay / date → 409
     per-line rows   → [−4 "ZZT a" today, −3 "ZZT b" yesterday] → 200, two adjust rows with their own reason + date
     no reason       → 400 "Every line needs a reason"
     old body shape  → {date, reason, lines:[{qty_boxes:+1}]} (header only) → 200, row carries the header reason
   CR-446  /cut-stock-entry
     receipt 10      → kind receipt at A1 (defines the full-size pair)
     floor per bay   → adjustment [−6, −6] same pair / bay → 409
     per-line rows   → adjustment [−4 "ZZT a", −3 "ZZT b" yesterday] → two CutStockEntry rows, own reason + date
   CR-447  Title Case
     POST /Design {collection_name:"summer COLLECTION"} → "Summer Collection"
     POST /Container {vessel_name:"maersk hangzhou"}    → "Maersk Hangzhou"

   Run:  BOFFO_TOKEN=<AuthSession token of an Admin> SEED_HOST=https://export-tracker-demo-925638796.development.catalystserverless.com node scripts/drive-cr446.mjs */

const HOST = process.env.SEED_HOST || "https://export-tracker-demo-925638796.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;
const TOKEN = process.env.BOFFO_TOKEN || "";
let pass = 0;
let fail = 0;
const made = { design: null, design2: null, container: null };

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
const n = (v) => Number(v) || 0;
const s = (v) => (v == null ? "" : String(v));
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function bayA1() {
  const all = (await get("Warehouse?limit=300")).rows || [];
  const top = all.filter((w) => !w.parent);
  const prod = top.find((w) => s(w.purposes).split(",").map((x) => x.trim()).includes("Production")) || top[0];
  if (!prod) throw new Error("need a warehouse (generate Production ▸ A1 first)");
  const hit = all.find((x) => s(x.parent) === s(prod.ROWID) && s(x.name) === "A1");
  return s((hit || prod).ROWID);
}

async function boxStock(stamp, A1) {
  const batch = `ZZT/${stamp}/001`;
  const adjusts = async () => (await rows("ProductionLog", `design=${made.design}`)).filter((r) => r.entry_type === "adjust");

  await check("seed: batched ZZT item with 10 opening boxes at A1", async () => {
    const d = await post("Design", { design_name: `ZZT ADJ ${stamp}`, unique_name: `ZZT ADJ ${stamp}`, sku: `ZZTADJ${stamp}`, is_batched: true, status: "Active" });
    made.design = String(d.rowid);
    await post(`opening-stock/${made.design}`, { rows: [{ batch_number: batch, qty_boxes: 10 }], warehouse: A1 });
  });

  await check("CR-446 floor per bay: −6 'a' + −6 'b' on 10 boxes at one bay → 409", async () => {
    await post("stock-adjust", { lines: [
      { design: made.design, batch_number: batch, qty_boxes: -6, warehouse: A1, date: today, reason: "ZZT a" },
      { design: made.design, batch_number: batch, qty_boxes: -6, warehouse: A1, date: today, reason: "ZZT b" },
    ] }, { expect: 409 });
    eq((await adjusts()).length, 0, "nothing written");
  });

  await check("CR-446 per-line date + reason: two rows, each with its own", async () => {
    await post("stock-adjust", { lines: [
      { design: made.design, batch_number: batch, qty_boxes: -4, warehouse: A1, date: today, reason: "ZZT a", note: "first" },
      { design: made.design, batch_number: batch, qty_boxes: -3, warehouse: A1, date: yesterday, reason: "ZZT b" },
    ] });
    const a = await adjusts();
    eq(a.length, 2, "adjust rows");
    const ra = a.find((r) => s(r.reason) === "ZZT a"), rb = a.find((r) => s(r.reason) === "ZZT b");
    if (!ra || !rb) throw new Error("rows do not carry their own reason");
    eq(n(ra.qty_boxes), -4, "a qty"); eq(s(ra.production_date).slice(0, 10), today, "a date");
    eq(n(rb.qty_boxes), -3, "b qty"); eq(s(rb.production_date).slice(0, 10), yesterday, "b date");
    eq(s(ra.request_group), s(rb.request_group), "one submission group");
  });

  await check("CR-446 a line with no reason anywhere → 400", async () => {
    await post("stock-adjust", { lines: [{ design: made.design, batch_number: batch, qty_boxes: 1, warehouse: A1 }] }, { expect: 400 });
  });

  await check("CR-446 old header-only body still works (reason + date from the body)", async () => {
    await post("stock-adjust", { date: today, reason: "ZZT header", warehouse: A1, lines: [{ design: made.design, batch_number: batch, qty_boxes: 1 }] });
    const r = (await adjusts()).find((x) => s(x.reason) === "ZZT header");
    if (!r) throw new Error("header reason not written");
    eq(n(r.qty_boxes), 1, "qty");
  });
}

async function cutStock(stamp, A1) {
  const entries = async () => (await rows("CutStockEntry", `design=${made.design}`)).filter((r) => r.kind === "adjustment");
  let cut = "";
  await check("seed: receipt 10 pcs (full size) at A1", async () => {
    await post("cut-stock-entry", { kind: "receipt", entry_date: today, warehouse: A1, lines: [{ design: made.design, cut_piece_size: "", qty: 10 }] });
    const st = await rows("CutPieceStock", `design=${made.design}`);
    eq(st.length, 1, "one pair defined");
    eq(n(st[0].qty), 10, "on hand");
    cut = s(st[0].cut_piece_size);
  });

  await check("CR-446 cut floor per bay: −6 + −6 on 10 pcs at one bay → 409", async () => {
    await post("cut-stock-entry", { kind: "adjustment", lines: [
      { design: made.design, cut_piece_size: cut, qty: -6, warehouse: A1, entry_date: today, reason: "ZZT a" },
      { design: made.design, cut_piece_size: cut, qty: -6, warehouse: A1, entry_date: today, reason: "ZZT b" },
    ] }, { expect: 409 });
    eq((await entries()).length, 0, "nothing written");
  });

  await check("CR-446 cut per-line date + reason: two ledger rows", async () => {
    await post("cut-stock-entry", { kind: "adjustment", lines: [
      { design: made.design, cut_piece_size: cut, qty: -4, warehouse: A1, entry_date: today, reason: "ZZT a" },
      { design: made.design, cut_piece_size: cut, qty: -3, warehouse: A1, entry_date: yesterday, reason: "ZZT b" },
    ] });
    const e = await entries();
    eq(e.length, 2, "ledger rows");
    const rb = e.find((r) => s(r.reason) === "ZZT b");
    if (!rb) throw new Error("row b missing");
    eq(n(rb.qty), -3, "b qty"); eq(s(rb.entry_date).slice(0, 10), yesterday, "b date");
    eq(n((await rows("CutPieceStock", `design=${made.design}`))[0].qty), 3, "on hand 10 − 7");
  });
}

async function names(stamp) {
  await check("CR-447 Design.collection_name saves Title Case", async () => {
    const d = await post("Design", { design_name: `ZZT NAMES ${stamp}`, unique_name: `ZZT NAMES ${stamp}`, sku: `ZZTNM${stamp}`, status: "Active", collection_name: "summer COLLECTION" });
    made.design2 = String(d.rowid);
    eq(s((await rows("Design", `ROWID=${made.design2}`))[0].collection_name), "Summer Collection", "collection_name");
  });
  await check("CR-447 Container.vessel_name saves Title Case", async () => {
    const c = await post("Container", { container_number: `ZZTU${stamp}`.slice(0, 11), vessel_name: "maersk hangzhou" });
    made.container = String(c.rowid);
    eq(s((await rows("Container", `ROWID=${made.container}`))[0].vessel_name), "Maersk Hangzhou", "vessel_name");
  });
}

async function cleanup() {
  const wipe = async (t, where) => { for (const r of await rows(t, where)) await del(`${t}/${r.ROWID}`).catch(() => {}); };
  if (made.design) {
    await wipe("CutStockEntry", `design=${made.design}`);
    await wipe("CutPieceStock", `design=${made.design}`);
    await wipe("ProductionLog", `design=${made.design}`);
    await del(`Design/${made.design}`).catch(() => {});
  }
  if (made.design2) await del(`Design/${made.design2}`).catch(() => {});
  if (made.container) await del(`Container/${made.container}`).catch(() => {});
}

(async () => {
  const stamp = String(Date.now()).slice(-6);
  console.log(`drive-cr446 against ${HOST}`);
  try {
    const A1 = await bayA1();
    await boxStock(stamp, A1);
    await cutStock(stamp, A1);
    await names(stamp);
  } finally {
    await cleanup();
  }
  console.log(`\n${pass} passed · ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
