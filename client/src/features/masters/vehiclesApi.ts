/* ============================================================
   Vehicle master — typed Data Store wrapper. The Vehicle table holds
   the trucks (number + driver + mobile) a palletization plan is loaded
   onto. CRUD reuses the generic master helpers (createMaster); reads are
   cached like every other list. Every write is logged in OperationLog.
   ============================================================ */
import { listAll, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";
import { createMaster } from "./mastersApi";

const str = (v: unknown) => (v == null ? "" : String(v));

/** Format an Indian vehicle registration as the user types → SS-DD-L(L)-NNNN,
    e.g. "gj01nr4757" or "GJ 01 NR 4757" → "GJ-01-NR-4757". Lenient: accepts
    partial input and keeps unexpected trailing chars so it never blocks typing.
    ponytail: heuristic for the common HSRP layout (2 letters, 2 digits, 0-2
    letters, up to 4 digits); exotic plates (e.g. BH-series) still format best-effort. */
export function formatVehicleNumber(raw: string): string {
  const s = (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const parts: string[] = [];
  let i = 0;
  const take = (re: RegExp, max: number) => {
    let seg = "";
    while (i < s.length && seg.length < max && re.test(s[i])) seg += s[i++];
    if (seg) parts.push(seg);
  };
  take(/[A-Z]/, 2); // state code
  take(/[0-9]/, 2); // RTO district
  take(/[A-Z]/, 2); // series
  take(/[0-9]/, 4); // running number
  if (i < s.length) parts.push(s.slice(i)); // overflow → keep, don't block typing
  return parts.join("-");
}

export interface VehicleRow {
  id: string; // ROWID
  vehicleNumber: string;
  driverName: string;
  mobile: string;
}

export interface VehicleInput {
  vehicle_number: string;
  driver_name: string;
  mobile_number: string;
}

const cache = createListCache(fetchVehicles);

export function listVehicles(): Promise<{ ok: boolean; vehicles: VehicleRow[]; error?: string }> {
  return cache.load();
}
export function invalidateVehicles(): void {
  cache.invalidate();
}

async function fetchVehicles(): Promise<{ ok: boolean; vehicles: VehicleRow[]; error?: string }> {
  const res = await listAll("Vehicle", { order: "ROWID desc", columns: ["vehicle_number", "driver_name", "mobile_number", "deleted_at"] });
  if (!res.ok) return { ok: false, vehicles: [], error: res.error };
  const vehicles: VehicleRow[] = (res.rows || [])
    .filter((v) => !str(v.deleted_at))
    .map((v) => ({
      id: String(v.ROWID),
      vehicleNumber: str(v.vehicle_number),
      driverName: str(v.driver_name),
      mobile: str(v.mobile_number),
    }));
  return { ok: true, vehicles };
}

/** Create a Vehicle (all three fields required) → returns the new ROWID. */
export function createVehicle(input: VehicleInput): Promise<OpResult> {
  return createMaster("Vehicle", { ...input }).then((r) => {
    cache.invalidate();
    return r;
  });
}
