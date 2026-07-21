/* ============================================================
   Palletization Plan (vehicle load) — typed Data Store wrapper.

   A PalletizationPlan is a first-class, human-numbered (PAL/FY/NNN)
   record that groups OrderItems from MULTIPLE Sales Orders onto a
   vehicle and runs the 4-stage lifecycle Planning → ReadyToLoad →
   Loading → Completed. Header (PalletizationPlan) + lines
   (PalletizationPlanLine) mirror SalesOrder + OrderItem. All writes go
   through the data-ops business routes and are logged in OperationLog.
   See containersApi.ts (cache) and palletisationApi.ts (op sagas).
   ============================================================ */
import { listAll, op, remove, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export const PAL_STATUSES = ["Planning", "ReadyToLoad", "Loading", "Completed"] as const;
export type PalStatus = (typeof PAL_STATUSES)[number];

/** Allowed status transitions — mirrors the server PAL_TRANSITIONS. */
export const PAL_TRANSITIONS: Record<PalStatus, PalStatus[]> = {
  Planning: ["ReadyToLoad"],
  ReadyToLoad: ["Loading", "Planning"],
  Loading: ["Completed", "ReadyToLoad"],
  Completed: [],
};

export interface PalPlanLine {
  id: string; // PalletizationPlanLine ROWID
  salesOrderId: string;
  soNumber: string; // SalesOrder.order_number (fallback po_number / id)
  orderItemId: string;
  designId: string;
  designLabel: string;
  palletId: string;
  palletName: string;
  boxes: number;
  position: number;
}

export interface PalPlan {
  id: string; // ROWID
  palNumber: string;
  status: PalStatus;
  vehicleNumber: string;
  plannedDate: string;
  dispatchDate: string;
  salespersonId: string;
  salespersonName: string;
  remarks: string;
  lines: PalPlanLine[];
  soNumbers: string[]; // distinct associated SO numbers (grid column)
  totalBoxes: number;
  createdTime: string; // Catalyst CREATEDTIME
  modifiedTime: string; // Catalyst MODIFIEDTIME
}

export interface PalPlanInput {
  pal_number: string; // "" → server mints
  vehicle_number: string;
  planned_date: string; // "" omitted server-side
  salesperson: string; // SalesPerson name → resolved server-side ("" = none)
  remarks: string;
  lines: {
    sales_order: string;
    order_item: string;
    design: string;
    pallet: string;
    boxes: number;
    position: number;
  }[];
}

/* Stale-while-revalidate cache (lib/cache); mutations below invalidate. */
const cache = createListCache(fetchPalPlans);

export function cachedPalPlans(): PalPlan[] | null {
  return cache.cached()?.plans ?? null;
}
export function subscribePalPlans(cb: () => void): () => void {
  return cache.subscribe(cb);
}
export function invalidatePalPlans(): void {
  cache.invalidate();
}

/** All palletization plans (newest first). Cached + deduped. */
export function listPalPlans(): Promise<{ ok: boolean; plans: PalPlan[]; error?: string }> {
  return cache.load();
}

async function fetchPalPlans(): Promise<{ ok: boolean; plans: PalPlan[]; error?: string }> {
  // FKs are bigint ROWID strings; no JOINs — resolve names client-side (house convention).
  const [plans, lines, sos, designs, pallets, reps] = await Promise.all([
    listAll("PalletizationPlan", { order: "ROWID desc" }),
    listAll("PalletizationPlanLine"),
    listAll("SalesOrder", { columns: ["order_number", "po_number"] }),
    listAll("Design", { columns: ["design_name", "unique_name"] }),
    listAll("Pallet", { columns: ["name"] }),
    listAll("SalesPerson", { columns: ["name"] }),
  ]);
  if (!plans.ok) return { ok: false, plans: [], error: plans.error };

  const soNo = new Map<string, string>();
  (sos.rows || []).forEach((s) => soNo.set(String(s.ROWID), str(s.order_number) || str(s.po_number) || String(s.ROWID)));
  const designLabel = new Map<string, string>();
  (designs.rows || []).forEach((d) => designLabel.set(String(d.ROWID), str(d.unique_name) || str(d.design_name)));
  const palletName = new Map<string, string>();
  (pallets.rows || []).forEach((p) => palletName.set(String(p.ROWID), str(p.name)));
  const repName = new Map<string, string>();
  (reps.rows || []).forEach((r) => repName.set(String(r.ROWID), str(r.name)));

  // Lines grouped by plan (soft-deleted skipped), ordered by position.
  const linesByPlan = new Map<string, PalPlanLine[]>();
  (lines.rows || []).forEach((l) => {
    if (str(l.deleted_at)) return;
    const planId = str(l.plan);
    if (!planId) return;
    const soId = str(l.sales_order);
    const designId = str(l.design);
    const palletId = str(l.pallet);
    const row: PalPlanLine = {
      id: String(l.ROWID),
      salesOrderId: soId,
      soNumber: soNo.get(soId) || soId,
      orderItemId: str(l.order_item),
      designId,
      designLabel: designLabel.get(designId) || "—",
      palletId,
      palletName: palletName.get(palletId) || "—",
      boxes: num(l.boxes),
      position: num(l.position),
    };
    (linesByPlan.get(planId) ?? linesByPlan.set(planId, []).get(planId)!).push(row);
  });
  linesByPlan.forEach((arr) => arr.sort((a, b) => a.position - b.position));

  const result: PalPlan[] = (plans.rows || [])
    .filter((p) => !str(p.deleted_at))
    .map((p) => {
      const id = String(p.ROWID);
      const planLines = linesByPlan.get(id) || [];
      const soNumbers = [...new Set(planLines.map((l) => l.soNumber))];
      const repId = str(p.sales_person);
      return {
        id,
        palNumber: str(p.pal_number),
        status: (str(p.status) || "Planning") as PalStatus,
        vehicleNumber: str(p.vehicle_number),
        plannedDate: str(p.planned_date),
        dispatchDate: str(p.dispatch_date),
        salespersonId: repId,
        salespersonName: repName.get(repId) || "",
        remarks: str(p.remarks),
        lines: planLines,
        soNumbers,
        totalBoxes: planLines.reduce((s, l) => s + l.boxes, 0),
        createdTime: str(p.CREATEDTIME),
        modifiedTime: str(p.MODIFIEDTIME),
      };
    });

  return { ok: true, plans: result };
}

/* Mutations invalidate the cache so the next listPalPlans() refetches. */
function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    cache.invalidate();
    return r;
  });
}

export function createPalPlan(input: PalPlanInput): Promise<OpResult<{ ROWID: string; pal_number: string }>> {
  return bust(op<{ ROWID: string; pal_number: string }>("pal-plan", input));
}

export function updatePalPlan(rowid: string, input: PalPlanInput) {
  return bust(op<{ ROWID: string; pal_number: string }>(`update-pal-plan/${rowid}`, input));
}

export function setPalStatus(rowid: string, status: PalStatus) {
  return bust(op<{ ROWID: string; status: string }>(`pal-status/${rowid}`, { status }));
}

export function deletePalPlan(rowid: string) {
  return bust(remove("PalletizationPlan", rowid));
}

/** Seed a create form from an existing plan (clone) — drops the auto-gen PAL number. */
export function planToInput(p: PalPlan): PalPlanInput {
  return {
    pal_number: "",
    vehicle_number: p.vehicleNumber,
    planned_date: p.plannedDate,
    salesperson: p.salespersonName,
    remarks: p.remarks,
    lines: p.lines.map((l) => ({
      sales_order: l.salesOrderId,
      order_item: l.orderItemId,
      design: l.designId,
      pallet: l.palletId,
      boxes: l.boxes,
      position: l.position,
    })),
  };
}

/** Human label for a status (spaced). */
export const PAL_STATUS_LABEL: Record<PalStatus, string> = {
  Planning: "Planning",
  ReadyToLoad: "Ready to Load",
  Loading: "Loading",
  Completed: "Completed",
};
