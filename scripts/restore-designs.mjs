/* One-shot recovery after accidental bulk-delete of all Design rows (2026-06-12 08:50).
   Run AFTER `node scripts/seed-dev.mjs` has recreated the 28 base designs.

   1. Re-applies the spec patches (pcs/coverage/weight/rates/category/glaze) that
      seed-realtime's backfill had applied to 8 designs — payloads recovered from
      the OperationLog update entries of 08:43.
   2. Re-links QuoteItem.design / OrderItem.design (nulled by ON-DELETE-SET-NULL)
      by matching each line's qty+rate against the seed-realtime quote definitions.

   Run: node scripts/restore-designs.mjs */

const HOST =
  process.env.SEED_HOST ||
  "https://boffo-latest-project-926227227.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;

const get = async (p) => (await fetch(`${BASE}/${p}`)).json();
const patch = async (p, body) =>
  (
    await fetch(`${BASE}/${p}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  ).json();

const rows = (r) => (Array.isArray(r.rows) ? r.rows : Array.isArray(r.data) ? r.data : []);

async function tableMap(table, keyField) {
  const r = await get(`${table}?limit=300`);
  const m = new Map();
  for (const row of rows(r)) m.set(String(row[keyField]).toLowerCase(), row);
  return m;
}

/* Spec patches — identical to seed-realtime MASTERS.designs / OperationLog 08:43. */
const SPECS = [
  ["Desert Beige - 600x1200 - Glossy", "PGVT", "Glossy Glaze", 2, 1.44, 32.5, 4.2],
  ["Hawai Crema - 600x1200 - Glossy", "PGVT", "Glossy Glaze", 2, 1.44, 32.5, 4.35],
  ["Onyx Gris - 600x1200 - Glossy", "PGVT", "Glossy Glaze", 2, 1.44, 32.5, 4.5],
  ["Streetline Grey - 600x1200 - Matt", "GVT", "Matt Glaze", 2, 1.44, 33.0, 4.1],
  ["Etna Beige - 600x1200 - Carving", "GVT", "Carving Glaze", 2, 1.44, 33.0, 4.6],
  ["Chester Wood Natural - 200x1200 - Carving", "GVT", "Carving Glaze", 5, 1.2, 26.0, 3.8],
  ["Elmi Wood Ash - 200x1200 - Carving", "GVT", "Carving Glaze", 5, 1.2, 26.0, 3.8],
  ["Gres Pine Beige - 600x600 - Matt", "Full Body", "Matt Glaze", 4, 1.44, 30.0, 3.5],
];

/* Quote / SO line ownership — from seed-realtime QUOTES (design name per qty+rate). */
const QUOTE_LINES = {
  "QT/2026-27/001": [
    ["Desert Beige", 1200, 6.1],
    ["Hawai Crema", 800, 6.3],
    ["Streetline Grey", 600, 5.9],
  ],
  "QT/2026-27/002": [
    ["Chester Wood Natural", 1500, 4.8],
    ["Elmi Wood Ash", 900, 4.8],
  ],
  "QT/2026-27/003": [
    ["Onyx Gris", 700, 6.6],
    ["Etna Beige", 500, 6.9],
  ],
  "QT/2026-27/004": [
    ["Gres Pine Beige", 1100, 5.2],
    ["Streetline Grey", 400, 6.0],
  ],
  "QT/2026-27/005": [["Hawai Crema", 950, 6.4]],
  "QT/2026-27/006": [
    ["Desert Beige", 640, 6.2],
    ["Etna Beige", 320, 7.0],
  ],
};

const SO_LINES = {
  "SO/2026-27/101": QUOTE_LINES["QT/2026-27/001"], // Full conversion
  "SO/2026-27/102": [
    ["Chester Wood Natural", 1000, 4.8], // Partial conversion
    ["Elmi Wood Ash", 900, 4.8],
  ],
  "SO/2026-27/103": QUOTE_LINES["QT/2026-27/003"], // Full conversion
};

async function main() {
  console.log("Restore against", BASE, "\n");

  const designByUnique = await tableMap("Design", "unique_name");
  const designByName = new Map();
  for (const d of designByUnique.values()) designByName.set(String(d.design_name).toLowerCase(), d);
  if (designByUnique.size === 0) {
    console.error("Design table still empty — run `node scripts/seed-dev.mjs` first.");
    process.exit(1);
  }
  console.log(`designs present: ${designByUnique.size}`);

  /* 1. Spec patches */
  const catByName = await tableMap("Category", "name");
  const glazeByName = await tableMap("Glaze", "name");
  for (const [unique, cat, glaze, pcs, cov, bw, rateSqm] of SPECS) {
    const row = designByUnique.get(unique.toLowerCase());
    if (!row) {
      console.warn(`SKIP spec (design missing): ${unique}`);
      continue;
    }
    if (Number(row.coverage_sqm) > 0) {
      console.log(`spec already set: ${unique}`);
      continue;
    }
    const body = {
      pcs_per_box: pcs,
      coverage_sqm: cov,
      coverage_sqft: Math.round(cov * 10.7639 * 100) / 100,
      box_weight_kg: bw,
      rate_per_sqmt: rateSqm,
      rate_per_sqft: Math.round((rateSqm / 10.7639) * 100) / 100,
    };
    const c = catByName.get(cat.toLowerCase());
    const g = glazeByName.get(glaze.toLowerCase());
    if (c) body.category = String(c.ROWID);
    if (g) body.glaze = String(g.ROWID);
    await patch(`Design/${row.ROWID}`, body);
    console.log(`spec restored: ${unique}`);
  }

  /* 2. Re-link QuoteItem.design */
  const quoteByNumber = await tableMap("Quote", "quote_number");
  for (const [qno, lines] of Object.entries(QUOTE_LINES)) {
    const q = quoteByNumber.get(qno.toLowerCase());
    if (!q) {
      console.warn(`SKIP quote (missing): ${qno}`);
      continue;
    }
    const items = rows(await get(`QuoteItem?limit=300`)).filter(
      (it) => String(it.quote) === String(q.ROWID),
    );
    for (const [name, qty, rate] of lines) {
      const it = items.find(
        (x) =>
          !x.design &&
          Number(x.quantity_boxes) === qty &&
          Math.abs(Number(x.rate) - rate) < 0.001,
      );
      const d = designByName.get(name.toLowerCase());
      if (!it || !d) {
        console.warn(`SKIP line ${qno} ${name} ${qty}@${rate} (item or design not found)`);
        continue;
      }
      await patch(`QuoteItem/${it.ROWID}`, { design: String(d.ROWID) });
      console.log(`relinked ${qno}: ${name} ${qty}@${rate}`);
    }
  }

  /* 3. Re-link OrderItem.design */
  const soByNumber = await tableMap("SalesOrder", "order_number");
  for (const [sono, lines] of Object.entries(SO_LINES)) {
    const so = soByNumber.get(sono.toLowerCase());
    if (!so) {
      console.warn(`SKIP SO (missing): ${sono}`);
      continue;
    }
    const items = rows(await get(`OrderItem?limit=300`)).filter(
      (it) => String(it.sales_order) === String(so.ROWID),
    );
    for (const [name, qty, rate] of lines) {
      const it = items.find(
        (x) =>
          !x.design &&
          Number(x.ordered_qty_boxes) === qty &&
          Math.abs(Number(x.rate) - rate) < 0.001,
      );
      const d = designByName.get(name.toLowerCase());
      if (!it || !d) {
        console.warn(`SKIP line ${sono} ${name} ${qty}@${rate} (item or design not found)`);
        continue;
      }
      await patch(`OrderItem/${it.ROWID}`, { design: String(d.ROWID) });
      console.log(`relinked ${sono}: ${name} ${qty}@${rate}`);
    }
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("Restore failed:", e);
  process.exit(1);
});
