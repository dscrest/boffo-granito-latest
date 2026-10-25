/* ============================================================
   deriveWarehouseStock (CR-329) — the pure reducer behind "what sits in
   which warehouse". Zero imports on purpose: warehouseStock.check.ts runs
   it under plain Node, and index.js carries a JS twin of the spread
   (serverWarehouseOnHand) for the transfer / adjustment floors.
   // ponytail: spread mirrored in functions/data-ops/index.js — change both.

   Model: stock rows (box and cut-piece alike) are SIGNED moves on a key
   (design|batch or design|cutSize) that may name a warehouse:
     · qty > 0, warehouse W        → supply lands in W
     · qty > 0, warehouse null     → supply lands in the PRIMARY warehouse
     · qty < 0, warehouse W        → leaves W (below zero = that cell's `over`)
     · qty < 0, warehouse null     → leaves whichever warehouses hold the key:
                                     Loading Bay-purpose warehouses first, then
                                     the largest balance, ties by warehouse id;
                                     never below zero; what no warehouse can
                                     absorb lands on the primary as `over`.
   Claims (boxes reserved by orders / pieces booked by panel orders) spread
   the same way over on-hand and surface as `committed` — never a movement.
   An unknown / deleted warehouse id counts as the primary. No warehouses at
   all = one implicit bucket "" (the feature is dormant; nothing is lost).

   Invariant (the check asserts it), per key:
     Σ onHand = Σ moves + Σ over
   ============================================================ */

export const WAREHOUSE_PURPOSES = ["Production", "Palletization", "Loading Bay", "Raw Material", "Sample Cut Panels"] as const;
export const LOADING_BAY = "Loading Bay";

export interface WarehouseIn {
  id: string;
  isPrimary: boolean;
  purposes: string[];
}

/** One signed stock move on a key; `warehouse` null = not stated (see header). */
export interface WhMoveIn {
  key: string;
  warehouse: string | null;
  qty: number;
}

/** A claim on a key's on-hand (reserved / booked); spread like a null-warehouse removal. */
export interface WhClaimIn {
  key: string;
  warehouse: string | null;
  qty: number;
}

export interface WhCell {
  key: string;
  warehouseId: string;
  onHand: number;
  committed: number; // claims attributed here (≤ onHand)
  over: number; // removals this warehouse could not cover — anomaly marker
}

/** "Production,Loading Bay" → ["Production", "Loading Bay"]. */
export function parsePurposes(raw: string | null | undefined): string[] {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function primaryWarehouseId(warehouses: WarehouseIn[]): string {
  return warehouses.find((w) => w.isPrimary)?.id ?? warehouses[0]?.id ?? "";
}

/** CR-409: raw `Warehouse` rows → reducer nodes. A row with `parent` is a LOCATION
    inside that warehouse: it inherits the warehouse's purposes and is never primary
    (only top-level rows carry the flag). One helper so the two fetch paths
    (warehousesApi, batchStockApi) cannot drift. */
export function toWarehouseIn(rows: { ROWID: unknown; is_primary?: unknown; purposes?: unknown; parent?: unknown }[]): WarehouseIn[] {
  const pid = (v: unknown) => (v == null || v === "" ? "" : String(v));
  const top = new Map(rows.filter((r) => !pid(r.parent)).map((r) => [String(r.ROWID), r]));
  return rows.map((r) => {
    const p = pid(r.parent) ? top.get(pid(r.parent)) : undefined;
    return {
      id: String(r.ROWID),
      isPrimary: !pid(r.parent) && (r.is_primary === true || String(r.is_primary) === "true"),
      purposes: parsePurposes(String((p ? p.purposes : r.purposes) || "")),
    };
  });
}

/** CR-409: location codes are a grid (A1 … F12) — sort A1, A2, …, A10, B1; never lexical. */
export const codeCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** CR-409: the grid — rows `A`–`F` × bays `1`–`12` → ["A1", …, "A12", "B1", …, "F12"]. [] on a bad range. Pure. */
export function gridCodes(fromRow: string, toRow: string, fromBay: number, toBay: number): string[] {
  const a = fromRow.trim().toUpperCase().charCodeAt(0);
  const z = toRow.trim().toUpperCase().charCodeAt(0);
  if (!(a >= 65 && a <= 90 && z >= a && z <= 90)) return [];
  const lo = Math.max(1, Math.floor(fromBay));
  const hi = Math.min(999, Math.floor(toBay));
  if (!(hi >= lo)) return [];
  const out: string[] = [];
  for (let r = a; r <= z; r++) for (let b = lo; b <= hi; b++) out.push(`${String.fromCharCode(r)}${b}`);
  return out;
}

export function deriveWarehouseStock(warehouses: WarehouseIn[], moves: WhMoveIn[], claims: WhClaimIn[] = []): WhCell[] {
  const primary = primaryWarehouseId(warehouses);
  const known = new Map(warehouses.map((w) => [w.id, w]));
  const resolve = (w: string | null) => (w && known.has(w) ? w : primary);
  const bay = (id: string) => (known.get(id)?.purposes ?? []).includes(LOADING_BAY);

  type Cells = Map<string, WhCell>; // warehouseId → cell
  const byKey = new Map<string, Cells>();
  const cell = (key: string, wh: string): WhCell => {
    const cells = byKey.get(key) ?? byKey.set(key, new Map()).get(key)!;
    let c = cells.get(wh);
    if (!c) {
      c = { key, warehouseId: wh, onHand: 0, committed: 0, over: 0 };
      cells.set(wh, c);
    }
    return c;
  };
  /** Warehouses holding the key, in take-from order: Loading Bay first, then most stock, then id. */
  const order = (cells: Cells, room: (c: WhCell) => number) =>
    [...cells.values()]
      .filter((c) => room(c) > 0)
      .sort((a, b) => Number(bay(b.warehouseId)) - Number(bay(a.warehouseId)) || room(b) - room(a) || (a.warehouseId < b.warehouseId ? -1 : 1));
  /** Take `qty` from the key's warehouses by the rule above; returns what nobody could absorb. */
  const spread = (key: string, qty: number, room: (c: WhCell) => number, take: (c: WhCell, n: number) => void) => {
    let left = qty;
    const cells = byKey.get(key);
    if (!cells) return left;
    for (const c of order(cells, room)) {
      if (left <= 0) break;
      const n = Math.min(left, room(c));
      take(c, n);
      left -= n;
    }
    return left;
  };

  // Deterministic regardless of input order: supply first, then explicit
  // removals, then the spread ones (which need the final balances).
  const rank = (m: WhMoveIn) => (m.qty >= 0 ? 0 : m.warehouse != null && known.has(m.warehouse) ? 1 : 2);
  const sorted = [...moves].filter((m) => m.qty !== 0).sort((a, b) => rank(a) - rank(b));
  for (const m of sorted) {
    if (m.qty > 0) {
      cell(m.key, resolve(m.warehouse)).onHand += m.qty;
    } else if (rank(m) === 1) {
      const c = cell(m.key, m.warehouse as string);
      const short = Math.max(0, -m.qty - c.onHand);
      c.onHand = Math.max(0, c.onHand + m.qty);
      c.over += short;
    } else {
      const left = spread(m.key, -m.qty, (c) => c.onHand, (c, n) => (c.onHand -= n));
      if (left > 0) cell(m.key, primary).over += left;
    }
  }
  for (const cl of claims) {
    if (cl.qty <= 0) continue;
    const room = (c: WhCell) => c.onHand - c.committed;
    const wh = cl.warehouse != null && known.has(cl.warehouse) ? cl.warehouse : null;
    if (wh) {
      const c = cell(cl.key, wh);
      c.committed += Math.min(cl.qty, Math.max(0, room(c)));
    } else {
      spread(cl.key, cl.qty, room, (c, n) => (c.committed += n)); // a claim beyond stock reserves nothing extra
    }
  }

  const out: WhCell[] = [];
  for (const cells of byKey.values()) for (const c of cells.values()) if (c.onHand || c.committed || c.over) out.push(c);
  return out;
}
