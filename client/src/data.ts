/* Mock data, ported from prototype/data.jsx (ceramic tiles; real party/design/size names).
   Behaviour preserved exactly — same seed (42) and arithmetic so the generated orders
   match the prototype. Phase: visual/page designs only; real data arrives with the
   Data Store backend later. Globals (window.*) replaced with module exports + types. */

export interface Party {
  code: string;
  name: string;
  country: string;
  flag: string;
}

export interface Design {
  name: string;
  size: string;
  finish: string;
  brand: string;
}

export interface Stage {
  id: string;
  label: string;
  short: string;
  color: string;
}

export interface Order {
  id: string;
  poNumber: string;
  partyCode: string;
  party: string;
  country: string;
  flag: string;
  design: string;
  size: string;
  finish: string;
  brand: string;
  orderQty: number;
  producedQty: number;
  palletizedQty: number;
  loadedQty: number;
  boxesPerPallet: number;
  totalBoxes: number;
  pallets: number;
  stage: string;
  orderDate: string;
  dueDate: string;
  invoice: string | null;
  priority: "high" | "normal" | "low";
  daysFromPI: number;
}

export interface Activity {
  time: string;
  who: string;
  action: string;
  detail: string;
  tag: string;
}

export const PARTIES: Party[] = [
  { code: "MRK", name: "Merkury Market", country: "Poland", flag: "🇵🇱" },
  { code: "FLB", name: "Fliba D.O.O.", country: "Poland", flag: "🇵🇱" },
  { code: "ABS", name: "AB Specializuota", country: "Lithuania", flag: "🇱🇹" },
  { code: "DDM", name: "S.C. Dedeman SRL", country: "Romania", flag: "🇷🇴" },
];

export const SIZES = ["600x1200", "600x600", "300x600", "200x1200", "800x1600", "75x600"];

export const FINISHES = ["Glossy", "Matt", "Carving", "High Glossy", "Hard Matt"];

export const DESIGNS: Design[] = [
  // 600x1200 Glossy
  { name: "Desert Beige", size: "600x1200", finish: "Glossy", brand: "Bonza" },
  { name: "Hawai Crema", size: "600x1200", finish: "Glossy", brand: "Bonza" },
  { name: "Hawai White", size: "600x1200", finish: "Glossy", brand: "Bonza" },
  { name: "Onyx Gris", size: "600x1200", finish: "Glossy", brand: "Bonza" },
  { name: "Onyx Prime", size: "600x1200", finish: "Matt", brand: "Bonza" },
  { name: "Onyx Turquoise", size: "600x1200", finish: "High Glossy", brand: "Bonza" },
  { name: "Pacyfic", size: "600x1200", finish: "Glossy", brand: "Bonza" },
  { name: "Pasionate", size: "600x1200", finish: "Glossy", brand: "Bonza" },
  { name: "Pietrasanta Legal", size: "600x1200", finish: "Matt", brand: "Bonza" },
  { name: "Solace Beige", size: "600x1200", finish: "Glossy", brand: "Bonza" },
  { name: "Streetline Antracyt", size: "600x1200", finish: "Matt", brand: "Bonza" },
  { name: "Streetline Grey", size: "600x1200", finish: "Matt", brand: "Bonza" },
  { name: "Etna Beige", size: "600x1200", finish: "Carving", brand: "Bonza" },
  { name: "New Carrara", size: "600x1200", finish: "Glossy", brand: "Bonza" },
  // 200x1200
  { name: "Chester Wood Natural", size: "200x1200", finish: "Carving", brand: "BIG" },
  { name: "Elmi Wood Ash", size: "200x1200", finish: "Carving", brand: "BIG" },
  { name: "Benito Wood Choco", size: "200x1200", finish: "Carving", brand: "BIG" },
  { name: "Lamer Wood Sand", size: "200x1200", finish: "Carving", brand: "BIG" },
  { name: "Balmo Wood Pearl", size: "200x1200", finish: "Matt", brand: "BIG" },
  { name: "Burl Wood Honey", size: "200x1200", finish: "Matt", brand: "BIG" },
  { name: "Lorien Wood Miel", size: "200x1200", finish: "Matt", brand: "BIG" },
  { name: "Taptik Wood Honey", size: "200x1200", finish: "Matt", brand: "BIG" },
  { name: "Aspen Wood Bianco", size: "200x1200", finish: "Matt", brand: "BIG" },
  { name: "Axial Wood Grey", size: "200x1200", finish: "Matt", brand: "BIG" },
  { name: "Axial Wood Natural", size: "200x1200", finish: "Matt", brand: "BIG" },
  // 75x600
  { name: "Purl Marfil", size: "75x600", finish: "Glossy", brand: "Bonza" },
  // 600x600
  { name: "Earth", size: "600x600", finish: "Carving", brand: "Bonza" },
  { name: "Gres Pine Beige", size: "600x600", finish: "Matt", brand: "BIG" },
];

export const STAGES: Stage[] = [
  { id: "po", label: "Purchase Order", short: "PO", color: "amber" },
  { id: "prod", label: "In Production", short: "Production", color: "blue" },
  { id: "packing", label: "Pallet Packing", short: "Packing", color: "violet" },
  { id: "loading", label: "Loading", short: "Loading", color: "cyan" },
  { id: "final", label: "Final Loading", short: "Final", color: "green" },
];

/** STAGES lookup that the prototype did inline via STAGES.find(...). */
export function stageOf(id: string): Stage {
  return STAGES.find((s) => s.id === id)!;
}

// Deterministic pseudo-random so re-renders are stable (matches prototype).
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
const rand = seeded(42);
function int(min: number, max: number) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function buildOrders(): Order[] {
  const orders: Order[] = [];
  let id = 1000;
  const months = ["01", "02", "03", "04", "05", "06", "07"];

  const dist: Record<string, number> = { po: 8, prod: 14, packing: 11, loading: 6, final: 5 };

  Object.entries(dist).forEach(([stage, count]) => {
    for (let i = 0; i < count; i++) {
      const design = DESIGNS[Math.floor(rand() * DESIGNS.length)];
      const party = PARTIES[Math.floor(rand() * PARTIES.length)];
      const month = months[Math.floor(rand() * months.length)];
      const orderQty = [
        544, 928, 1456, 1742, 1856, 2800, 4762, 6272, 6890, 6033, 8772, 12484, 12724, 23847, 28662,
        47862,
      ][Math.floor(rand() * 16)];
      const boxesPerPallet = design.size === "200x1200" ? 38 : 32;
      const totalBoxes = Math.ceil(orderQty / 60);
      const pallets = Math.ceil(totalBoxes / boxesPerPallet);

      let produced = 0,
        palletized = 0,
        loaded = 0;
      if (stage === "po") {
        produced = 0;
        palletized = 0;
        loaded = 0;
      }
      if (stage === "prod") {
        produced = Math.floor(orderQty * (0.2 + rand() * 0.6));
        palletized = Math.floor(produced * (0.2 + rand() * 0.5));
      }
      if (stage === "packing") {
        produced = orderQty;
        palletized = Math.floor(orderQty * (0.6 + rand() * 0.35));
      }
      if (stage === "loading") {
        produced = orderQty;
        palletized = orderQty;
        loaded = Math.floor(orderQty * (0.3 + rand() * 0.5));
      }
      if (stage === "final") {
        produced = orderQty;
        palletized = orderQty;
        loaded = orderQty;
      }

      const day = int(1, 28);
      const orderDate = `${String(day).padStart(2, "0")}/04/2026`;
      const dueDay = ((day + 35) % 28) + 1;
      const dueDate = `${String(dueDay).padStart(2, "0")}/05/2026`;

      orders.push({
        id: "O" + id++,
        poNumber: `${month}/2026-27`,
        partyCode: party.code,
        party: party.name,
        country: party.country,
        flag: party.flag,
        design: design.name,
        size: design.size,
        finish: design.finish,
        brand: design.brand,
        orderQty,
        producedQty: produced,
        palletizedQty: palletized,
        loadedQty: loaded,
        boxesPerPallet,
        totalBoxes,
        pallets,
        stage,
        orderDate,
        dueDate,
        invoice: stage === "final" ? `EX-${10 + (id % 8)}/2026-27` : null,
        priority: rand() < 0.18 ? "high" : rand() < 0.5 ? "normal" : "low",
        daysFromPI: int(20, 60),
      });
    }
  });

  return orders;
}

export const ORDERS: Order[] = buildOrders();

export const ACTIVITY: Activity[] = [
  { time: "08:42", who: "Ramesh", action: "updated production", detail: "836 boxes — Etna Beige 600x1200", tag: "production" },
  { time: "08:21", who: "Priya", action: "closed pallet", detail: "[38x22] Etna Beige · 17-05 batch", tag: "packing" },
  { time: "07:58", who: "Anil", action: "loaded", detail: "EX-14/2026-27 — 25 pallets · Merkury Market", tag: "loading" },
  { time: "07:30", who: "Kavita", action: "created PO", detail: "06/2026-27 · Merkury Market · 47,862 sqm", tag: "po" },
  { time: "Yest.", who: "Suresh", action: "invoice issued", detail: "EX-13/2026-27 — Fliba D.O.O.", tag: "final" },
  { time: "Yest.", who: "Priya", action: "started packing", detail: "Onyx Turquoise · 928 boxes", tag: "packing" },
  { time: "Yest.", who: "Ramesh", action: "updated production", detail: "1,710 boxes — Etna Beige 600x1200", tag: "production" },
  { time: "2d", who: "Kavita", action: "created PO", detail: "04/2026-27 · AB Specializuota · 1,000 sqm", tag: "po" },
];

export const READY_TO_LOAD: Order[] = ORDERS.filter(
  (o) => o.stage === "loading" || (o.stage === "packing" && o.palletizedQty >= o.orderQty * 0.85),
).slice(0, 7);
