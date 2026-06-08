/* One-shot dev seeding of FK parents for the Quotes + Sales Orders slice.
   Posts mock masters/customers/designs to the deployed data-ops /seed/masters
   endpoint (idempotent). Run: node scripts/seed-dev.mjs
   Override host with SEED_HOST env var. */

const HOST =
  process.env.SEED_HOST ||
  "https://boffo-latest-project-926227227.development.catalystserverless.com";
const BASE = `${HOST}/server/data-ops`;

const SIZES = ["600x1200", "600x600", "300x600", "200x1200", "800x1600", "75x600"];
const FINISHES = ["Glossy", "Matt", "Carving", "High Glossy", "Hard Matt"];

const DESIGNS = [
  ["Desert Beige", "600x1200", "Glossy", "Bonza"],
  ["Hawai Crema", "600x1200", "Glossy", "Bonza"],
  ["Hawai White", "600x1200", "Glossy", "Bonza"],
  ["Onyx Gris", "600x1200", "Glossy", "Bonza"],
  ["Onyx Prime", "600x1200", "Matt", "Bonza"],
  ["Onyx Turquoise", "600x1200", "High Glossy", "Bonza"],
  ["Pacyfic", "600x1200", "Glossy", "Bonza"],
  ["Pasionate", "600x1200", "Glossy", "Bonza"],
  ["Pietrasanta Legal", "600x1200", "Matt", "Bonza"],
  ["Solace Beige", "600x1200", "Glossy", "Bonza"],
  ["Streetline Antracyt", "600x1200", "Matt", "Bonza"],
  ["Streetline Grey", "600x1200", "Matt", "Bonza"],
  ["Etna Beige", "600x1200", "Carving", "Bonza"],
  ["New Carrara", "600x1200", "Glossy", "Bonza"],
  ["Chester Wood Natural", "200x1200", "Carving", "BIG"],
  ["Elmi Wood Ash", "200x1200", "Carving", "BIG"],
  ["Benito Wood Choco", "200x1200", "Carving", "BIG"],
  ["Lamer Wood Sand", "200x1200", "Carving", "BIG"],
  ["Balmo Wood Pearl", "200x1200", "Matt", "BIG"],
  ["Burl Wood Honey", "200x1200", "Matt", "BIG"],
  ["Lorien Wood Miel", "200x1200", "Matt", "BIG"],
  ["Taptik Wood Honey", "200x1200", "Matt", "BIG"],
  ["Aspen Wood Bianco", "200x1200", "Matt", "BIG"],
  ["Axial Wood Grey", "200x1200", "Matt", "BIG"],
  ["Axial Wood Natural", "200x1200", "Matt", "BIG"],
  ["Purl Marfil", "75x600", "Glossy", "Bonza"],
  ["Earth", "600x600", "Carving", "Bonza"],
  ["Gres Pine Beige", "600x600", "Matt", "BIG"],
];

const payload = {
  sizes: SIZES,
  finishes: FINISHES,
  brands: ["Bonza", "BIG"],
  categories: ["PL"],
  glazes: ["PL"],
  grades: ["1st"],
  paymentTerms: ["Advance", "Credit 30", "Net 15", "Net 30", "Net 45", "Net 60"],
  customers: [
    { code: "MRK", name: "Merkury Market", country_code: "PL", currency: "EUR" },
    { code: "FLB", name: "Fliba D.O.O.", country_code: "PL", currency: "EUR" },
    { code: "ABS", name: "AB Specializuota", country_code: "LT", currency: "EUR" },
    { code: "DDM", name: "S.C. Dedeman SRL", country_code: "RO", currency: "EUR" },
  ],
  designs: DESIGNS.map(([name, size, finish, brand]) => ({
    design_name: name,
    unique_name: `${name} - ${size} - ${finish}`,
    size,
    finish,
    brand,
    category: "PL",
    glaze: "PL",
    grade: "1st",
  })),
};

async function main() {
  console.log("Seeding via", `${BASE}/seed/masters`);
  const res = await fetch(`${BASE}/seed/masters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log("HTTP", res.status);
  console.log(text);
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
