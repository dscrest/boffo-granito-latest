/* DEMO masters seed — fills the EMPTY demo backend (export-tracker-demo) with the
   base masters every screen needs, through the same data-ops routes the UI uses.
   Idempotent: every row is looked up by its natural key first.

     Size ×3 · Finish/Brand/Category/Glaze/Grade/PaymentTerm lookups · Currency ×4
     Warehouse ×2 (+ A1…A6 locations, Main = primary) · AdjustmentReason ×6
     Pallet ×3 · ContainerFormat ×3 · Vehicle ×2 · Customer ×5 · Design ×6

   After this, scripts/seed-multi.mjs and scripts/seed-panel-stages.mjs add the
   transactional flows (they expect the 480/540-box formats + 48-box pallet made here).

   Run:  BOFFO_EMAIL=… BOFFO_PASSWORD=… node scripts/seed-demo-masters.mjs
         (SEED_HOST defaults to the demo project; the live host is REFUSED.) */

const HOST = process.env.SEED_HOST || "https://export-tracker-demo-925638796.development.catalystserverless.com";
if (/boffo-granito-export-tracker/.test(HOST)) throw new Error("Refusing to seed demo data into the LIVE project");
const BASE = `${HOST}/server/data-ops`;

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
const q = (s) => String(s).replace(/'/g, "''");

async function login() {
  if (process.env.BOFFO_TOKEN) { TOKEN = process.env.BOFFO_TOKEN; return; }
  const { BOFFO_EMAIL: email, BOFFO_PASSWORD: password } = process.env;
  if (!email || !password) throw new Error("Set BOFFO_EMAIL and BOFFO_PASSWORD (the demo Admin) or BOFFO_TOKEN");
  TOKEN = (await post("auth/login", { email, password })).token;
  log(`· signed in as ${email}`);
}

/** Insert unless a row with `${key}='${value}'` exists; returns the ROWID. */
async function upsert(table, key, value, body) {
  // The generic `where` only takes [A-Za-z0-9 _-] inside quotes; other names are matched client-side.
  const hit = /^[A-Za-z0-9 _-]*$/.test(value)
    ? one(await get(`${table}?where=${key}='${q(value)}'&columns=ROWID&limit=1`))
    : rows(await get(`${table}?columns=ROWID,${key}&limit=300`)).find((r) => String(r[key]) === String(value));
  if (hit) return String(hit.ROWID);
  const id = String((await post(table, body)).rowid);
  log(`  + ${table} ${value} ${id}`);
  return id;
}

/* ---------------- sizes ---------------- */
const SIZES = [
  { w: 800, l: 1600, pcs: 2, kg: 50, seq: "01" },
  { w: 600, l: 1200, pcs: 4, kg: 28, seq: "02" },
  { w: 600, l: 600, pcs: 4, kg: 26, seq: "03" },
];
async function sizes() {
  const out = {};
  for (const s of SIZES) {
    const code = `${s.w}x${s.l}`;
    const sqm = (s.w / 1000) * (s.l / 1000) * s.pcs;
    out[code] = await upsert("Size", "code", code, {
      code, name: `${code} - GVT - 9mm - ${s.pcs}`, width_mm: s.w, length_mm: s.l, seq_code: s.seq, tile_type: "GVT",
      thickness_mm: 9, pcs_per_packing: s.pcs, box_weight_kg: s.kg, sqm_per_box: +sqm.toFixed(4),
      sqft_per_box: +(sqm * 10.7639).toFixed(4), remark: "",
    });
  }
  return out;
}

/* ---------------- lookups + customers + items (one idempotent route) ---------------- */
const CUSTOMERS = [
  { code: "DEMO-NOVA", name: "Nova Ceramics Trading", country_code: "AE", currency: "USD" },
  { code: "DEMO-ATLAS", name: "Atlas Tiles Import", country_code: "GB", currency: "GBP" },
  { code: "DEMO-RIO", name: "Rio Stone Depot", country_code: "BR", currency: "USD" },
  { code: "DEMO-BALTIC", name: "Baltic Surfaces", country_code: "PL", currency: "EUR" },
  { code: "DEMO-KENYA", name: "Savanna Building Supplies", country_code: "KE", currency: "USD" },
];
const ITEM = (name, size, finish, cat, pcs, kg, rate) => {
  const [w, l] = size.split("x").map(Number);
  const sqm = (w / 1000) * (l / 1000) * pcs;
  return {
    design_name: name, unique_name: `${name} - ${size} - ${finish}`, size, finish, brand: "Boffo", category: cat,
    glaze: "Full Body", grade: "Premium", pcs_per_box: pcs, box_weight_kg: kg, coverage_sqm: +sqm.toFixed(4),
    coverage_sqft: +(sqm * 10.7639).toFixed(4), rate_per_sqft: rate, rate_per_sqmt: +(rate * 10.7639).toFixed(2),
  };
};
async function lookupsCustomersItems() {
  const r = await post("seed/masters", {
    finishes: ["Glossy", "Matt", "Carving", "Satin"],
    brands: ["Boffo", "Granito Select"],
    categories: ["Marble", "Wood", "Stone", "Cement", "Concrete"],
    glazes: ["Full Body", "Double Charge", "Glazed"],
    grades: ["Premium", "Standard", "Commercial"],
    paymentTerms: ["30% advance, 70% against BL", "100% advance", "LC at sight"],
    customers: CUSTOMERS,
    designs: [
      ITEM("Statuario Bianco", "800x1600", "Glossy", "Marble", 2, 50, 1.25),
      ITEM("Nero Marquina", "800x1600", "Matt", "Marble", 2, 50, 1.3),
      ITEM("Oakwood Natural", "600x1200", "Matt", "Wood", 4, 28, 0.95),
      ITEM("Travertine Beige", "600x1200", "Glossy", "Stone", 4, 28, 0.9),
      ITEM("Urban Grey", "600x600", "Matt", "Cement", 4, 26, 0.7),
      ITEM("Terrazzo Mix", "600x600", "Satin", "Concrete", 4, 26, 0.75),
    ],
  });
  log("· seed/masters:", JSON.stringify(r.seeded));
}

/* ---------------- currencies ---------------- */
async function currencies() {
  for (const c of [
    { code: "INR", name: "Indian Rupee", symbol: "₹", exchange_rate: 1 },
    { code: "USD", name: "US Dollar", symbol: "$", exchange_rate: 83.5 },
    { code: "EUR", name: "Euro", symbol: "€", exchange_rate: 90.2 },
    { code: "GBP", name: "British Pound", symbol: "£", exchange_rate: 105.4 },
  ]) await upsert("Currency", "code", c.code, { ...c, manual_override: true });
}

/* ---------------- warehouses + locations ---------------- */
async function warehouses() {
  const main = await upsert("Warehouse", "name", "Main Warehouse", {
    name: "Main Warehouse", purposes: "Production,Palletization,Loading Bay", note: "Demo plant stock",
  });
  await upsert("Warehouse", "name", "Raw Material Store", {
    name: "Raw Material Store", purposes: "Raw Material,Sample Cut Panels", note: "Demo panel materials",
  });
  const have = new Set(rows(await get(`Warehouse?where=parent=${main}&columns=name&limit=300`)).map((r) => r.name));
  const codes = ["A1", "A2", "A3", "A4", "A5", "A6"].filter((c) => !have.has(c));
  if (codes.length) { await post("Warehouse", { rows: codes.map((c) => ({ name: c, parent: main, note: "" })) }); log(`  + locations ${codes.join(" ")}`); }
  const row = one(await get(`Warehouse/${main}`));
  if (String(row?.is_primary) !== "true") { await post(`warehouse-primary/${main}`, {}); log("  ✓ Main Warehouse = primary"); }
}

/* ---------------- adjustment reasons ---------------- */
async function reasons() {
  const names = ["Breakage", "Damaged in transit", "Theft", "Count correction", "Sample / Display", "Other"];
  for (const [i, name] of names.entries()) await upsert("AdjustmentReason", "name", name, { name, seq_code: String(i + 1).padStart(2, "0") });
}

/* ---------------- pallets + container formats ---------------- */
async function palletsAndFormats(sizeIds) {
  const PALLETS = [
    { name: "P-48 800x1600", size: "800x1600", bpp: 48 },
    { name: "P-60 800x1600", size: "800x1600", bpp: 60 },
    { name: "P-40 600x1200", size: "600x1200", bpp: 40 },
  ];
  const pal = {};
  for (const p of PALLETS) {
    const s = SIZES.find((x) => `${x.w}x${x.l}` === p.size);
    const sqm = (s.w / 1000) * (s.l / 1000) * s.pcs;
    pal[p.name] = await upsert("Pallet", "name", p.name, {
      name: p.name, packing_details: `${s.pcs} pcs/box`, pallet_type: "Wooden", pallet_size_label: p.size,
      coverage_sqm: +sqm.toFixed(4), coverage_sqft: +(sqm * 10.7639).toFixed(4), box_weight_kg: s.kg,
      boxes_per_pallet: p.bpp, empty_pallet_weight_kg: 25, remarks: "", size: sizeIds[p.size],
    });
  }
  // seed-multi.mjs picks formats by total_boxes (480 + 540, one Size) and the 48-box pallet of that Size.
  const FORMATS = [
    { size: "800x1600", pallet: "P-48 800x1600", count: 10 }, // 480
    { size: "800x1600", pallet: "P-60 800x1600", count: 9 }, // 540
    { size: "600x1200", pallet: "P-40 600x1200", count: 11 }, // 440
  ];
  for (const f of FORMATS) {
    const bpp = PALLETS.find((p) => p.name === f.pallet).bpp;
    const total = f.count * bpp;
    const name = `${f.size} · ${f.count} pallets = ${total} boxes`;
    await upsert("ContainerFormat", "name", name, {
      name, size: sizeIds[f.size], pallets_json: JSON.stringify([{ pallet: pal[f.pallet], count: f.count }]),
      total_pallets: f.count, total_boxes: total, remarks: "",
    });
  }
}

/* ---------------- vehicles ---------------- */
async function vehicles() {
  for (const v of [
    { vehicle_number: "GJ-12-AB-4521", driver_name: "Ramesh Patel", mobile_number: "+919876543210" },
    { vehicle_number: "GJ-05-CD-7788", driver_name: "Suresh Kumar", mobile_number: "+919812345678" },
  ]) await upsert("Vehicle", "vehicle_number", v.vehicle_number, v);
}

await login();
const sizeIds = await sizes();
await lookupsCustomersItems();
await currencies();
await warehouses();
await reasons();
await palletsAndFormats(sizeIds);
await vehicles();
log("✓ demo masters ready");
