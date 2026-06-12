/* Realtime data seed — drives the SAME data-ops sagas the UI forms call,
   so every row lands exactly as if a user typed it in:

     masters (lookups/customers/designs)  → POST /seed/masters
     quotes (mixed statuses)              → POST /quote-with-items
     quote → master order conversion      → POST /convert-quote/:rowid
     production progress                  → PATCH /OrderItem/:rowid
     pallet packing                       → POST /close-pallet
     container create + loading           → POST /Container, /load-container
     dispatch                             → POST /dispatch/:rowid

   Invoices intentionally SKIPPED (user request). Idempotent-ish: quotes
   are keyed by quote_number — re-running skips ones that already exist.
   Run: node scripts/seed-realtime.mjs  (override host: SEED_HOST env) */

const HOST =
  process.env.SEED_HOST ||
  "https://boffo-latest-project-926227227.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;

async function call(method, path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, error: text };
  }
  if (!res.ok || json.ok === false) {
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${json.error || text}`);
  }
  return json;
}
const get = (p) => call("GET", p);
const post = (p, b) => call("POST", p, b);
const patch = (p, b) => call("PATCH", p, b);

const log = (...a) => console.log(...a);

/* ---------------- 1. Masters ---------------- */

const MASTERS = {
  sizes: ["600x1200", "600x600", "300x600", "200x1200", "800x1600", "75x600"],
  finishes: ["Glossy", "Matt", "Carving", "High Glossy", "Hard Matt"],
  brands: ["Bonza", "BIG", "Boffo Granito"],
  categories: ["GVT", "PGVT", "Ceramic Wall", "Full Body", "Porcelain"],
  glazes: ["Glossy Glaze", "Matt Glaze", "Sugar", "Satin", "Carving Glaze"],
  grades: ["1st", "Premium", "Standard"],
  paymentTerms: ["Advance", "Credit 30", "Net 15", "Net 30", "Net 45", "Net 60"],
  customers: [
    { code: "MRK", name: "Merkury Market", country_code: "PL", currency: "EUR" },
    { code: "FLB", name: "Fliba D.O.O.", country_code: "PL", currency: "EUR" },
    { code: "ABS", name: "AB Specializuota", country_code: "LT", currency: "EUR" },
    { code: "DDM", name: "S.C. Dedeman SRL", country_code: "RO", currency: "EUR" },
    { code: "PGM", name: "Pagona Marble & Granite", country_code: "GR", currency: "EUR" },
    { code: "BWX", name: "Bauwelt GmbH", country_code: "DE", currency: "EUR" },
  ],
  // A few designs with full specs so detail pages look real (existing ones
  // from earlier seeds are kept; matching unique_name rows are skipped).
  designs: [
    ["Desert Beige", "600x1200", "Glossy", "Bonza", "PGVT", "Glossy Glaze", 2, 1.44, 32.5, 4.2],
    ["Hawai Crema", "600x1200", "Glossy", "Bonza", "PGVT", "Glossy Glaze", 2, 1.44, 32.5, 4.35],
    ["Onyx Gris", "600x1200", "Glossy", "Bonza", "PGVT", "Glossy Glaze", 2, 1.44, 32.5, 4.5],
    ["Streetline Grey", "600x1200", "Matt", "Bonza", "GVT", "Matt Glaze", 2, 1.44, 33.0, 4.1],
    ["Etna Beige", "600x1200", "Carving", "Bonza", "GVT", "Carving Glaze", 2, 1.44, 33.0, 4.6],
    ["Chester Wood Natural", "200x1200", "Carving", "BIG", "GVT", "Carving Glaze", 5, 1.2, 26.0, 3.8],
    ["Elmi Wood Ash", "200x1200", "Carving", "BIG", "GVT", "Carving Glaze", 5, 1.2, 26.0, 3.8],
    ["Gres Pine Beige", "600x600", "Matt", "BIG", "Full Body", "Matt Glaze", 4, 1.44, 30.0, 3.5],
  ].map(([name, size, finish, brand, category, glaze, pcs, cov, bw, rateSqm]) => ({
    design_name: name,
    unique_name: `${name} - ${size} - ${finish}`,
    size,
    finish,
    brand,
    category,
    glaze,
    grade: "1st",
    pcs_per_box: pcs,
    coverage_sqm: cov,
    coverage_sqft: Math.round(cov * 10.7639 * 100) / 100,
    box_weight_kg: bw,
    rate_per_sqmt: rateSqm,
    rate_per_sqft: Math.round((rateSqm / 10.7639) * 100) / 100,
  })),
};

/* ---------------- 2. Quotes ---------------- */
/* rate = EUR per box (qty × rate − line discount, then doc charges). */

const QUOTES = [
  {
    quote_number: "QT/2026-27/001",
    customer: "Merkury Market",
    status: "Accepted",
    quote_date: "2026-05-18",
    expiry_date: "2026-07-18",
    salesperson: "Dhiraj",
    payment_term: "Net 30",
    port_of_discharge: "Gdansk",
    currency: "EUR",
    reference_no: "MRK-2026-118",
    lines: [
      { item: "Desert Beige", qty: 1200, rate: 6.1 },
      { item: "Hawai Crema", qty: 800, rate: 6.3 },
      { item: "Streetline Grey", qty: 600, rate: 5.9, discount: 2 },
    ],
    convert: {
      mode: "Full",
      order_number: "SO/2026-27/101",
      po_number: "MRK-PO-4521",
      box_branding: "Merkury Home", // customer's own branding on the boxes
      shipment_date: "2026-07-05",
    },
  },
  {
    quote_number: "QT/2026-27/002",
    customer: "S.C. Dedeman SRL",
    status: "Accepted",
    quote_date: "2026-05-24",
    expiry_date: "2026-07-24",
    salesperson: "Dhiraj",
    payment_term: "Net 45",
    port_of_discharge: "Constanta",
    currency: "EUR",
    discount: 150,
    tax_type: "TCS",
    tax_pct: 1,
    lines: [
      { item: "Chester Wood Natural", qty: 1500, rate: 4.8 },
      { item: "Elmi Wood Ash", qty: 900, rate: 4.8 },
    ],
    convert: {
      mode: "Partial",
      order_number: "SO/2026-27/102",
      po_number: "DDM-PO-887",
      box_branding: "BIG",
      shipment_date: "2026-07-20",
      lines: [
        { item: "Chester Wood Natural", qty: 1000, rate: 4.8 },
        { item: "Elmi Wood Ash", qty: 900, rate: 4.8 },
      ],
    },
  },
  {
    quote_number: "QT/2026-27/003",
    customer: "Fliba D.O.O.",
    status: "Accepted",
    quote_date: "2026-06-01",
    expiry_date: "2026-08-01",
    salesperson: "Ravi",
    payment_term: "Advance",
    port_of_discharge: "Koper",
    currency: "EUR",
    lines: [
      { item: "Onyx Gris", qty: 700, rate: 6.6 },
      { item: "Etna Beige", qty: 500, rate: 6.9 },
    ],
    convert: {
      mode: "Full",
      order_number: "SO/2026-27/103",
      po_number: "FLB-PO-2210",
      box_branding: "Bonza",
      shipment_date: "2026-08-10",
    },
  },
  {
    quote_number: "QT/2026-27/004",
    customer: "AB Specializuota",
    status: "Sent",
    quote_date: "2026-06-08",
    expiry_date: "2026-08-08",
    salesperson: "Ravi",
    payment_term: "Net 60",
    port_of_discharge: "Klaipeda",
    currency: "EUR",
    lines: [
      { item: "Gres Pine Beige", qty: 1100, rate: 5.2 },
      { item: "Streetline Grey", qty: 400, rate: 6.0 },
    ],
  },
  {
    quote_number: "QT/2026-27/005",
    customer: "Pagona Marble & Granite",
    status: "Sent",
    quote_date: "2026-06-10",
    expiry_date: "2026-08-10",
    salesperson: "Dhiraj",
    payment_term: "Net 30",
    port_of_discharge: "Piraeus",
    currency: "EUR",
    lines: [{ item: "Hawai Crema", qty: 950, rate: 6.4 }],
  },
  {
    quote_number: "QT/2026-27/006",
    customer: "Bauwelt GmbH",
    status: "Draft",
    quote_date: "2026-06-11",
    salesperson: "Ravi",
    payment_term: "Net 30",
    port_of_discharge: "Hamburg",
    currency: "EUR",
    lines: [
      { item: "Desert Beige", qty: 640, rate: 6.2 },
      { item: "Etna Beige", qty: 320, rate: 7.0 },
    ],
  },
];

/* Production / packing / loading plan, keyed by order_number.
   Invariants: loaded ≤ palletized ≤ produced ≤ ordered. */
const PIPELINE = {
  // SO 101: fully produced, fully packed, loaded + DISPATCHED (stage final).
  "SO/2026-27/101": { produceFrac: 1, packFrac: 1, load: true },
  // SO 102: fully produced, packed, loaded — container left in "loading".
  "SO/2026-27/102": { produceFrac: 1, packFrac: 1, load: true },
  // SO 103: production underway, partially packed, not loaded (ready-to-load feed).
  "SO/2026-27/103": { produceFrac: 0.6, packFrac: 0.5, load: false },
};

const CONTAINERS = [
  {
    container_number: "MSKU-440731-8",
    container_type: "40HQ",
    capacity_boxes: 2800,
    capacity_pallets: 40,
    vessel_name: "MSC Anna",
    port_of_loading: "Mundra",
    port_of_discharge: "Gdansk",
    etd: "2026-06-20",
    eta: "2026-07-12",
    status: "planned",
    loadOrders: ["SO/2026-27/101"],
    dispatch: true,
  },
  {
    container_number: "TGHU-882140-2",
    container_type: "40ft",
    capacity_boxes: 2600,
    capacity_pallets: 40,
    vessel_name: "Maersk Cabo",
    port_of_loading: "Mundra",
    port_of_discharge: "Constanta",
    etd: "2026-07-01",
    eta: "2026-07-25",
    status: "planned",
    loadOrders: ["SO/2026-27/102"],
    dispatch: false,
  },
];

/* ---------------- helpers over live rows ---------------- */

const rows = (r) => (Array.isArray(r.rows) ? r.rows : Array.isArray(r.data) ? r.data : []);

async function tableMap(table, keyField) {
  const r = await get(`${table}?limit=300`);
  const m = new Map();
  for (const row of rows(r)) m.set(String(row[keyField]).toLowerCase(), row);
  return m;
}

/* ---------------- main ---------------- */

async function main() {
  log("Seeding against", BASE, "\n");

  // 1. Masters (idempotent on natural keys).
  const seeded = await post("seed/masters", MASTERS);
  log("masters:", JSON.stringify(seeded.seeded));

  // 1b. Backfill specs onto designs that pre-date this seed (seed/masters
  //     skips existing unique_names, so their coverage/rates/category stay 0).
  const designByUnique = await tableMap("Design", "unique_name");
  const catByName = await tableMap("Category", "name");
  const glazeByName = await tableMap("Glaze", "name");
  for (const d of MASTERS.designs) {
    const row = designByUnique.get(d.unique_name.toLowerCase());
    if (!row) continue;
    if (Number(row.coverage_sqm) > 0) continue; // already has specs
    const patchBody = {
      pcs_per_box: d.pcs_per_box,
      coverage_sqm: d.coverage_sqm,
      coverage_sqft: d.coverage_sqft,
      box_weight_kg: d.box_weight_kg,
      rate_per_sqmt: d.rate_per_sqmt,
      rate_per_sqft: d.rate_per_sqft,
    };
    const cat = catByName.get(d.category.toLowerCase());
    const gl = glazeByName.get(d.glaze.toLowerCase());
    if (cat) patchBody.category = String(cat.ROWID);
    if (gl) patchBody.glaze = String(gl.ROWID);
    await patch(`Design/${row.ROWID}`, patchBody);
    log(`design specs backfilled: ${d.design_name}`);
  }

  // 2. Quotes (+ optional conversion). Skip quote_numbers that already exist.
  const existingQuotes = await tableMap("Quote", "quote_number");
  const soByNumber = new Map(); // order_number → SO ROWID
  const existingSOs = await tableMap("SalesOrder", "order_number");

  for (const q of QUOTES) {
    const { convert, ...quote } = q;
    let quoteId;
    if (existingQuotes.has(q.quote_number.toLowerCase())) {
      quoteId = String(existingQuotes.get(q.quote_number.toLowerCase()).ROWID);
      log(`quote ${q.quote_number}: exists (#${quoteId})`);
    } else {
      const res = await post("quote-with-items", quote);
      quoteId = String(res.rowid);
      log(`quote ${q.quote_number}: created #${quoteId} (${q.status})`);
    }

    if (!convert) continue;
    if (existingSOs.has(convert.order_number.toLowerCase())) {
      soByNumber.set(convert.order_number, String(existingSOs.get(convert.order_number.toLowerCase()).ROWID));
      log(`  convert → ${convert.order_number}: exists`);
      continue;
    }
    const lines = convert.lines || q.lines;
    const conv = await post(`convert-quote/${quoteId}`, {
      mode: convert.mode,
      lines,
      order_number: convert.order_number,
      po_number: convert.po_number,
      box_branding: convert.box_branding || "",
      shipment_date: convert.shipment_date || "",
    });
    soByNumber.set(convert.order_number, String(conv.rowid));
    log(`  convert → ${convert.order_number}: SO #${conv.rowid} (${convert.mode})`);
  }

  // Refresh SO map for pipeline work (covers pre-existing SOs too).
  for (const [k, v] of await tableMap("SalesOrder", "order_number")) {
    soByNumber.set(v.order_number, String(v.ROWID));
  }

  // 3. Production progress: bump produced_qty_boxes per OrderItem.
  const allItems = rows(await get("OrderItem?limit=300"));
  const itemsBySo = new Map();
  for (const it of allItems) {
    const k = String(it.sales_order);
    if (!itemsBySo.has(k)) itemsBySo.set(k, []);
    itemsBySo.get(k).push(it);
  }

  for (const [orderNumber, plan] of Object.entries(PIPELINE)) {
    const soId = soByNumber.get(orderNumber);
    if (!soId) {
      log(`pipeline ${orderNumber}: SO missing, skipped`);
      continue;
    }
    const items = itemsBySo.get(soId) || [];
    for (const it of items) {
      const ordered = Number(it.ordered_qty_boxes) || 0;
      const target = Math.round(ordered * plan.produceFrac);
      if ((Number(it.produced_qty_boxes) || 0) >= target) continue;
      await patch(`OrderItem/${it.ROWID}`, {
        produced_qty_boxes: target,
        stage: plan.produceFrac >= 1 ? "production" : "production",
      });
      log(`produce ${orderNumber} item #${it.ROWID}: ${target}/${ordered}`);
    }
  }

  // 4. Pallet packing — close-pallet per order item (one batch per item,
  //    capped at ~960 boxes per batch to stay realistic).
  const palletRows = rows(await get("Pallet?limit=300"));
  if (!palletRows.length) throw new Error("No Pallet master rows — seed pallets first");
  const palletId = String(palletRows[0].ROWID);
  const freshItems = rows(await get("OrderItem?limit=300"));
  const batchesBySo = new Map(); // soId → [batchId]

  for (const [orderNumber, plan] of Object.entries(PIPELINE)) {
    if (!plan.packFrac) continue;
    const soId = soByNumber.get(orderNumber);
    if (!soId) continue;
    for (const it of freshItems.filter((x) => String(x.sales_order) === soId)) {
      const produced = Number(it.produced_qty_boxes) || 0;
      const already = Number(it.palletized_qty_boxes) || 0;
      const target = Math.round((Number(it.ordered_qty_boxes) || 0) * plan.packFrac);
      let remaining = Math.min(target, produced) - already;
      while (remaining > 0) {
        const boxes = Math.min(remaining, 960);
        const res = await post("close-pallet", {
          sales_order: soId,
          pallet: palletId,
          design: it.design || null,
          performed_by: "seed",
          lines: [{ order_item: String(it.ROWID), boxes }],
        });
        if (!batchesBySo.has(soId)) batchesBySo.set(soId, []);
        batchesBySo.get(soId).push(String(res.rowid));
        log(`pack ${orderNumber} item #${it.ROWID}: batch #${res.rowid} (${boxes} boxes)`);
        remaining -= boxes;
      }
    }
  }

  // 5. Containers: create (by container_number), load planned batches, dispatch.
  const existingContainers = await tableMap("Container", "container_number");
  for (const c of CONTAINERS) {
    const { loadOrders, dispatch, ...row } = c;
    let cid;
    if (existingContainers.has(c.container_number.toLowerCase())) {
      cid = String(existingContainers.get(c.container_number.toLowerCase()).ROWID);
      log(`container ${c.container_number}: exists (#${cid})`);
    } else {
      const res = await post("Container", row);
      cid = String(res.rowid || res.data?.ROWID);
      log(`container ${c.container_number}: created #${cid}`);
    }

    const batchIds = loadOrders.flatMap((on) => batchesBySo.get(soByNumber.get(on)) || []);
    if (batchIds.length) {
      try {
        const res = await post("load-container", { container: cid, batches: batchIds, loaded_by: "seed" });
        log(`  loaded ${res.data?.loaded_batches} batch(es) into ${c.container_number}`);
      } catch (e) {
        log(`  load skipped: ${e.message}`);
      }
    }
    if (dispatch) {
      try {
        const res = await post(`dispatch/${cid}`, { performed_by: "seed" });
        log(`  dispatched ${c.container_number} (${res.data?.batches} batches)`);
      } catch (e) {
        log(`  dispatch skipped: ${e.message}`);
      }
    }
  }

  log("\nSeed complete. Invoices intentionally skipped.");
}

main().catch((e) => {
  console.error("\nSEED FAILED:", e.message);
  process.exit(1);
});
