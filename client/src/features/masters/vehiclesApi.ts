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
