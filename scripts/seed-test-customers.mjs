/* Test entries: 5 new customers, quotes in mixed statuses, three converted
   to Master Orders — one mid-production, one part-palletised, one fully
   palletised (not loaded). Drives the same data-ops sagas as the UI.
   Idempotent on customer code / quote_number / order_number.
   Run: node scripts/seed-test-customers.mjs */

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

const rows = (r) => (Array.isArray(r.rows) ? r.rows : Array.isArray(r.data) ? r.data : []);

async function tableMap(table, keyField) {
  const r = await get(`${table}?limit=300`);
  const m = new Map();
  for (const row of rows(r)) m.set(String(row[keyField]).toLowerCase(), row);
  return m;
}

/* ---------------- 5 new test customers ---------------- */

const CUSTOMERS = [
  { code: "NRD", name: "Nordica Bygg AB", country_code: "SE", currency: "EUR" },
  { code: "CBI", name: "Casa Bella Imports", country_code: "IT", currency: "EUR" },
  { code: "ATL", name: "Atlas Trading FZE", country_code: "AE", currency: "USD" },
  { code: "QTZ", name: "Quartz & Co Ltd", country_code: "GB", currency: "EUR" },
  { code: "HEL", name: "Helios Ceramics SA", country_code: "ES", currency: "EUR" },
];

/* ---------------- Quotes (mixed statuses) ----------------
   Designs reused from existing master (the 8 with full specs). */

const QUOTES = [
  {
    quote_number: "QT/2026-27/007",
    customer: "Nordica Bygg AB",
    status: "Rejected",
    quote_date: "2026-05-28",
    expiry_date: "2026-07-28",
    salesperson: "Dhiraj",
    payment_term: "Net 30",
    port_of_discharge: "Gothenburg",
    currency: "EUR",
    lines: [{ item: "Onyx Gris", qty: 500, rate: 6.8 }],
  },
  {
    quote_number: "QT/2026-27/008",
    customer: "Nordica Bygg AB",
    status: "Accepted",
    quote_date: "2026-06-02",
    expiry_date: "2026-08-02",
    salesperson: "Dhiraj",
    payment_term: "Net 30",
    port_of_discharge: "Gothenburg",
    currency: "EUR",
    lines: [
      { item: "Onyx Gris", qty: 500, rate: 6.5 },
      { item: "Desert Beige", qty: 700, rate: 6.1 },
    ],
    convert: {
      mode: "Full",
      order_number: "SO/2026-27/104",
      po_number: "NRD-PO-1042",
      box_branding: "Nordica",
      shipment_date: "2026-08-15",
    },
  },
  {
    quote_number: "QT/2026-27/009",
    customer: "Casa Bella Imports",
    status: "Accepted",
    quote_date: "2026-06-04",
    expiry_date: "2026-08-04",
    salesperson: "Ravi",
    payment_term: "Net 45",
    port_of_discharge: "Genoa",
    currency: "EUR",
    lines: [
      { item: "Hawai Crema", qty: 900, rate: 6.4 },
      { item: "Etna Beige", qty: 400, rate: 6.9, discount: 1.5 },
    ],
    convert: {
      mode: "Full",
      order_number: "SO/2026-27/105",
      po_number: "CBI-PO-3318",
      box_branding: "Casa Bella",
      shipment_date: "2026-08-25",
    },
  },
  {
    quote_number: "QT/2026-27/010",
    customer: "Atlas Trading FZE",
    status: "Accepted",
    quote_date: "2026-06-06",
    expiry_date: "2026-08-06",
    salesperson: "Dhiraj",
    payment_term: "Advance",
    port_of_discharge: "Jebel Ali",
    currency: "USD",
    lines: [
      { item: "Chester Wood Natural", qty: 1200, rate: 5.1 },
      { item: "Gres Pine Beige", qty: 800, rate: 5.6 },
    ],
    convert: {
      mode: "Partial",
      order_number: "SO/2026-27/106",
      po_number: "ATL-PO-771",
      box_branding: "BIG",
      shipment_date: "2026-09-01",
      lines: [{ item: "Chester Wood Natural", qty: 1200, rate: 5.1 }],
    },
  },
  {
    quote_number: "QT/2026-27/011",
    customer: "Quartz & Co Ltd",
    status: "Sent",
    quote_date: "2026-06-10",
    expiry_date: "2026-08-10",
    salesperson: "Ravi",
    payment_term: "Net 15",
    port_of_discharge: "Felixstowe",
    currency: "EUR",
    lines: [
      { item: "Streetline Grey", qty: 650, rate: 6.0 },
      { item: "Elmi Wood Ash", qty: 350, rate: 4.9 },
    ],
  },
  {
    quote_number: "QT/2026-27/012",
    customer: "Helios Ceramics SA",
    status: "Draft",
    quote_date: "2026-06-12",
    salesperson: "Dhiraj",
    payment_term: "Net 60",
    port_of_discharge: "Valencia",
    currency: "EUR",
    lines: [{ item: "Desert Beige", qty: 480, rate: 6.3 }],
  },
];

/* Pipeline: SO/104 mid-production; SO/105 produced, half palletised;
   SO/106 produced + fully palletised (not loaded). */
const PIPELINE = {
  "SO/2026-27/104": { produceFrac: 0.5, packFrac: 0 },
  "SO/2026-27/105": { produceFrac: 1, packFrac: 0.5 },
  "SO/2026-27/106": { produceFrac: 1, packFrac: 1 },
};

async function main() {
  log("Seeding test entries against", BASE, "\n");

  // 1. Customers (idempotent on natural keys).
  const seeded = await post("seed/masters", { customers: CUSTOMERS });
  log("customers:", JSON.stringify(seeded.seeded?.Customer || seeded.seeded));

  // 2. Quotes + conversions.
  const existingQuotes = await tableMap("Quote", "quote_number");
  const existingSOs = await tableMap("SalesOrder", "order_number");
  const soByNumber = new Map();

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

  // 3. Production progress.
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
    for (const it of itemsBySo.get(soId) || []) {
      const ordered = Number(it.ordered_qty_boxes) || 0;
      const target = Math.round(ordered * plan.produceFrac);
      if ((Number(it.produced_qty_boxes) || 0) >= target) continue;
      await patch(`OrderItem/${it.ROWID}`, {
        produced_qty_boxes: target,
        stage: "production",
      });
      log(`produce ${orderNumber} item #${it.ROWID}: ${target}/${ordered}`);
    }
  }

  // 4. Pallet packing (close-pallet saga, one batch per item, ≤960 boxes).
  const palletRows = rows(await get("Pallet?limit=300"));
  if (!palletRows.length) throw new Error("No Pallet master rows — seed pallets first");
  const palletId = String(palletRows[0].ROWID);
  const freshItems = rows(await get("OrderItem?limit=300"));

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
        log(`pack ${orderNumber} item #${it.ROWID}: batch #${res.rowid} (${boxes} boxes)`);
        remaining -= boxes;
      }
    }
  }

  log("\nTest seed complete.");
}

main().catch((e) => {
  console.error("\nSEED FAILED:", e.message);
  process.exit(1);
});
