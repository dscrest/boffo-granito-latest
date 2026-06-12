/* ============================================================
   Container master — typed Data Store wrapper over lib/dataOps.

   The Container table (Catalyst) holds shipping-container specs that
   Phase 4 (load-container, dispatch, fit-suggest) operates on. All
   columns are scalar (no FKs). Date columns (etd/eta) reject "" → we
   omit them when blank. Every write is recorded server-side in
   OperationLog. See palletsApi.ts for the sibling pattern.
   ============================================================ */
import { listAll, insert, update, remove, op, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export const CONTAINER_TYPES = ["20ft", "40ft", "40HQ"] as const;
export const CONTAINER_STATUSES = ["planned", "loading", "sealed", "dispatched"] as const;
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number];

export interface ContainerRow {
  id: string; // ROWID
  containerNumber: string;
  containerType: string;
  capacityBoxes: number;
  capacityPallets: number;
  capacityAreaSqm: number; // 0 = unset (area constraint not enforced)
  maxWeightKg: number; // 0 = unset (weight constraint not enforced — Q1 deferred)
  vesselName: string;
  etd: string;
  eta: string;
  portOfLoading: string;
  portOfDischarge: string;
  status: string;
}

/* Stale-while-revalidate cache (lib/cache); mutations below invalidate.
   load-container / dispatch sagas (palletisationApi) also invalidate
   this cache since they change container status. */
const cache = createListCache(fetchContainers);

/** Last fetched containers, or null if never fetched this session. */
export function cachedContainers(): ContainerRow[] | null {
  return cache.cached()?.containers ?? null;
}
/** Drop the cache so the next listContainers() hits the network. */
export function invalidateContainers(): void {
  cache.invalidate();
}

/** All containers (newest first). Cached + deduped. */
export function listContainers(): Promise<{
  ok: boolean;
  containers: ContainerRow[];
  error?: string;
}> {
  return cache.load();
}

async function fetchContainers(): Promise<{
  ok: boolean;
  containers: ContainerRow[];
  error?: string;
}> {
  // listAll pages past ZCQL's 300-row cap.
  const res = await listAll("Container", { order: "ROWID desc" });
  if (!res.ok) return { ok: false, containers: [], error: res.error };

  const rows: ContainerRow[] = (res.rows || []).map((c) => ({
    id: String(c.ROWID),
    containerNumber: str(c.container_number),
    containerType: str(c.container_type),
    capacityBoxes: num(c.capacity_boxes),
    capacityPallets: num(c.capacity_pallets),
    capacityAreaSqm: num(c.capacity_area_sqm),
    maxWeightKg: num(c.max_weight_kg),
    vesselName: str(c.vessel_name),
    etd: str(c.etd),
    eta: str(c.eta),
    portOfLoading: str(c.port_of_loading),
    portOfDischarge: str(c.port_of_discharge),
    status: str(c.status) || "planned",
  }));

  return { ok: true, containers: rows };
}

export interface ContainerInput {
  container_number: string;
  container_type: string;
  capacity_boxes: number;
  capacity_pallets: number;
  capacity_area_sqm: number; // 0 = unset
  max_weight_kg: number; // 0 = unset (Q1 deferred)
  vessel_name: string;
  etd: string; // "" = leave unset
  eta: string; // "" = leave unset
  port_of_loading: string;
  port_of_discharge: string;
  status: string;
}

/** Drop empty date columns so Catalyst's date type isn't sent blank (rejects ""). */
function toPayload(input: ContainerInput): Record<string, unknown> {
  const p: Record<string, unknown> = {
    container_number: input.container_number.trim(),
    container_type: input.container_type.trim(),
    capacity_boxes: input.capacity_boxes,
    capacity_pallets: input.capacity_pallets,
    vessel_name: input.vessel_name.trim(),
    port_of_loading: input.port_of_loading.trim(),
    port_of_discharge: input.port_of_discharge.trim(),
    status: input.status || "planned",
  };
  if (input.etd) p.etd = input.etd; // date only when set
  if (input.eta) p.eta = input.eta;
  // Area/weight nullable: send only when set so the fit module treats absent as unconstrained.
  if (input.capacity_area_sqm > 0) p.capacity_area_sqm = input.capacity_area_sqm;
  if (input.max_weight_kg > 0) p.max_weight_kg = input.max_weight_kg;
  return p;
}

/* Mutations invalidate the cache so the next listContainers() refetches. */
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}

export function createContainer(input: ContainerInput) {
  return bust(insert("Container", toPayload(input)));
}

export function updateContainer(rowid: string, input: ContainerInput) {
  // On edit, send dates explicitly (allow clearing → null) so they can be unset.
  const patch = toPayload(input);
  if (!input.etd) patch.etd = null;
  if (!input.eta) patch.eta = null;
  // Allow clearing area/weight back to unconstrained.
  if (!(input.capacity_area_sqm > 0)) patch.capacity_area_sqm = null;
  if (!(input.max_weight_kg > 0)) patch.max_weight_kg = null;
  return bust(update("Container", rowid, patch));
}

export function deleteContainer(rowid: string) {
  return bust(remove("Container", rowid));
}

/* ---- Bulk ops (client-side fan-out; each row logged in OperationLog) ---- */

export interface BulkResult {
  ok: boolean;
  done: number;
  failed: number;
  firstError?: string;
}

async function fanOut(rowids: string[], fn: (id: string) => Promise<OpResult>): Promise<BulkResult> {
  const results = await Promise.all(rowids.map(fn));
  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    done: results.length - failed.length,
    failed: failed.length,
    firstError: failed[0]?.error,
  };
}

export function bulkDeleteContainers(rowids: string[]): Promise<BulkResult> {
  return bust(fanOut(rowids, (id) => remove("Container", id)));
}

/* ---- Container-fit suggester (read-only, multi-constraint, POST /fit-suggest) ----
   Server packs pending batches under up to 4 co-equal caps (slots / area /
   weight / boxes). Each cap is null when unconstrained; each utilization pct is
   null when its cap is absent (weight_pct also 0 when all batches uncalibrated).
   `assigned` is batch ROWIDs only — resolve to batch detail separately if needed.
   See functions/data-ops/lib/fit.js for the engine. */
export type FitDim = "slots" | "area" | "weight" | "boxes";

export interface FitCapacity {
  slots: number | null;
  area: number | null;
  weight: number | null;
  boxes: number | null;
}
export interface FitUsed {
  slots: number;
  area: number;
  weight: number;
  boxes: number;
}
export interface FitUtilization {
  slots_pct: number | null;
  area_pct: number | null;
  weight_pct: number | null;
  boxes_pct: number | null;
}
export interface FitContainer {
  container: string;
  container_number: string;
  capacity: FitCapacity;
  used: FitUsed;
  utilization: FitUtilization;
  binding: FitDim | null;
  underfilled: boolean;
  assigned: string[]; // batch ROWIDs (NEW suggestions only, excludes seed load)
}
export interface FitUnassigned {
  batch: string;
  design: string;
  boxes: number;
  reason: FitDim | "no_space";
}
export interface FitResult {
  perContainer: FitContainer[];
  unassigned: FitUnassigned[];
}

/** Ask the server for a greedy container-fit plan. Read-only — writes nothing. */
export async function fitSuggest(): Promise<{ ok: boolean; data?: FitResult; error?: string }> {
  const res = await op<FitResult>("fit-suggest", {});
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: res.data };
}
