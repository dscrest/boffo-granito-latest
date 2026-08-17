/* ============================================================
   Palletization Plan (vehicle load) — typed Data Store wrapper.

   A PalletizationPlan is a first-class, human-numbered (PAL/FY/NNN)
   record that groups OrderItems from MULTIPLE Sales Orders onto a
   vehicle. Palletising is PER LINE (PalletizationPlanLine.status:
   Ready for Palletization → Ready for Loading); loading/dispatch is PER PLAN
   (status: Planning → Loading → Completed). Header (PalletizationPlan)
   + lines (PalletizationPlanLine) mirror SalesOrder + OrderItem. All writes go
   through the data-ops business routes and are logged in OperationLog.
   See containersApi.ts (cache) and palletisationApi.ts (op sagas).
   ============================================================ */
import { listAll, op, remove, type OpResult } from "@/lib/dataOps";
import { createListCache } from "@/lib/cache";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const str = (v: unknown) => (v == null ? "" : String(v));

// PLAN status (per vehicle load). Palletising is tracked PER LINE (see PalLineStatus);
// the plan only runs the loading/dispatch portion. The retired "Palletized"/plan-level
// "ReadyToLoad" states are folded into Planning by the migration.
export const PAL_STATUSES = ["Planning", "Loading", "Completed"] as const;
export type PalStatus = (typeof PAL_STATUSES)[number];

/** Allowed PLAN status transitions — mirrors the server PAL_TRANSITIONS. */
export const PAL_TRANSITIONS: Record<PalStatus, PalStatus[]> = {
  Planning: ["Loading"], // → Loading captures the vehicle
  Loading: ["Completed", "Planning"],
  Completed: [],
};

// LINE status (per palletised item). The item-wise move on the kanban.
export const PAL_LINE_STATUSES = ["Planning", "ReadyToLoad"] as const;
export type PalLineStatus = (typeof PAL_LINE_STATUSES)[number];
export const PAL_LINE_TRANSITIONS: Record<PalLineStatus, PalLineStatus[]> = {
  Planning: ["ReadyToLoad"],
  ReadyToLoad: ["Planning"],
};
export const PAL_LINE_STATUS_LABEL: Record<PalLineStatus, string> = {
  Planning: "Ready for Palletization",
  ReadyToLoad: "Ready for Loading",
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
  palletCapacity: number; // container capacity: A + B arrangements, as in palletsApi.totalBoxesPerContainer (0 = unknown)
  boxes: number;
  position: number;
  status: PalLineStatus; // Ready for Palletization → Ready for Loading (per-item kanban move)
  itemCode: string; // display-only sequential PAL-NNN (mirrors Production's PROD-NNN)
  customerId: string; // via SalesOrder.customer
  customerName: string;
  countryCode: string; // Customer.country_code (ISO-2) → export country
  sizeCode: string; // via Design.size → Size.code
  loadBoxId: string; // LoadBox ROWID ("" = not loaded into a box yet)
  batchNumber: string; // production batch this line's boxes come from ("" = legacy aggregate)
}

/** True when one order item's boxes span more than one batch across these
    lines — the "mixed batches" warning (uniform tile texture per customer). */
export function mixedBatchOrderItems(lines: PalPlanLine[]): boolean {
  const byOi = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!l.batchNumber) continue;
    const set = byOi.get(l.orderItemId) || new Set<string>();
    set.add(l.batchNumber);
    byOi.set(l.orderItemId, set);
  }
  return [...byOi.values()].some((s) => s.size > 1);
}

/** A vehicle slot ("box") that Ready-for-Loading lines are dragged into. */
export type LoadBoxStatus = "Open" | "Dispatched";
export interface LoadBox {
  id: string; // LoadBox ROWID
  boxNumber: number; // display "Box N" (server-minted)
  vehicleId: string; // Vehicle ROWID ("" until allocated)
  vehicleNumber: string;
  driverName: string;
  mobileNumber: string;
  capacity: number; // advisory boxes capacity
  status: LoadBoxStatus;
  dispatchDate: string;
  // Loading capture (entered at the box / at dispatch).
  containerNumber: string;
  lineSeal: string;
  electronicSeal: string;
  loadingSupervisor: string;
  createdTime: string;
}

export interface PalPlan {
  id: string; // ROWID
  palNumber: string;
  status: PalStatus;
  vehicleId: string; // Vehicle ROWID ("" until loading)
  vehicleNumber: string; // from the Vehicle master (fallback: legacy free-text)
  driverName: string;
  mobileNumber: string;
  plannedDate: string;
  dispatchDate: string;
  salespersonId: string;
  salespersonName: string;
  salespersonPhone: string; // for the pallet QR "call back" contact
  salespersonEmail: string;
  remarks: string;
  lines: PalPlanLine[];
  soNumbers: string[]; // distinct associated SO numbers (grid column)
  customerNames: string[]; // distinct customers across lines (grid column + filter)
  vehicleNumbers: string[]; // distinct vehicles: legacy plan vehicle + the lines' boxes
  totalBoxes: number;
  createdTime: string; // Catalyst CREATEDTIME
  modifiedTime: string; // Catalyst MODIFIEDTIME
}

export interface PalPlanInput {
  pal_number: string; // "" → server mints
  vehicle_number: string; // legacy free-text (unused by the form)
  vehicle: string; // Vehicle ROWID ("" = assign later, at Loading)
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
    batch_number: string; // carried opaquely — server replaces lines on update
  }[];
}

/* ---- Fractional fill (box % is measured against each line's PALLET capacity,
   not the LoadBox's advisory capacity column). A single-pallet box reads as
   loaded/palletCapacity; mixed-pallet boxes sum per-line fractions. ---- */

/** Fraction of a full container this line represents (0 when its pallet capacity is unknown). */
export function lineFrac(l: PalPlanLine): number {
  return l.palletCapacity > 0 ? l.boxes / l.palletCapacity : 0;
}
/** Box fill fraction (0..n) = Σ lines' pallet-relative fractions. */
export function boxFill(lines: PalPlanLine[]): number {
  return lines.reduce((s, l) => s + lineFrac(l), 0);
}
/** The one pallet capacity shared by all lines, or 0 when mixed/unknown —
    lets the UI show absolute "X boxes short" only when that number is meaningful. */
export function sharedCapacity(lines: PalPlanLine[]): number {
  const caps = [...new Set(lines.map((l) => l.palletCapacity).filter((c) => c > 0))];
  return caps.length === 1 ? caps[0] : 0;
}

/* Stale-while-revalidate cache (lib/cache); mutations below invalidate. */
const cache = createListCache(fetchPalPlans);

export function cachedPalPlans(): PalPlan[] | null {
  return cache.cached()?.plans ?? null;
}
export function cachedLoadBoxes(): LoadBox[] | null {
  return cache.cached()?.boxes ?? null;
}
export function subscribePalPlans(cb: () => void): () => void {
  return cache.subscribe(cb);
}
export function invalidatePalPlans(): void {
  cache.invalidate();
}

/** All palletization plans (newest first) + load boxes. Cached + deduped. */
export function listPalPlans(): Promise<{ ok: boolean; plans: PalPlan[]; boxes: LoadBox[]; error?: string }> {
  return cache.load();
}

async function fetchPalPlans(): Promise<{ ok: boolean; plans: PalPlan[]; boxes: LoadBox[]; error?: string }> {
  // FKs are bigint ROWID strings; no JOINs — resolve names client-side (house convention).
  const [plans, lines, sos, designs, pallets, reps, vehicles, customers, sizes, loadBoxes] = await Promise.all([
    listAll("PalletizationPlan", { order: "ROWID desc" }),
    listAll("PalletizationPlanLine"),
    listAll("SalesOrder", { columns: ["order_number", "po_number", "customer"] }),
    listAll("Design", { columns: ["design_name", "unique_name", "size"] }),
    listAll("Pallet", { columns: ["name", "boxes_per_pallet", "pallets_per_container", "b_boxes_per_pallet", "b_pallets_per_container"] }),
    listAll("SalesPerson", { columns: ["name", "phone", "email"] }),
    listAll("Vehicle", { columns: ["vehicle_number", "driver_name", "mobile_number"] }),
    listAll("Customer", { columns: ["name", "country_code"] }),
    listAll("Size", { columns: ["code"] }),
    listAll("LoadBox", { order: "ROWID asc" }),
  ]);
  if (!plans.ok) return { ok: false, plans: [], boxes: [], error: plans.error };

  const vehicleById = new Map<string, { number: string; driver: string; mobile: string }>();
  (vehicles.rows || []).forEach((v) =>
    vehicleById.set(String(v.ROWID), { number: str(v.vehicle_number), driver: str(v.driver_name), mobile: str(v.mobile_number) }),
  );

  const soNo = new Map<string, string>();
  const soCustomer = new Map<string, string>(); // SalesOrder ROWID → Customer ROWID
  (sos.rows || []).forEach((s) => {
    soNo.set(String(s.ROWID), str(s.order_number) || str(s.po_number) || String(s.ROWID));
    soCustomer.set(String(s.ROWID), str(s.customer));
  });
  const customerById = new Map<string, { name: string; countryCode: string }>();
  (customers.rows || []).forEach((c) =>
    customerById.set(String(c.ROWID), { name: str(c.name), countryCode: str(c.country_code) }),
  );
  const sizeCodeById = new Map<string, string>();
  (sizes.rows || []).forEach((s) => sizeCodeById.set(String(s.ROWID), str(s.code)));
  const designLabel = new Map<string, string>();
  const designSize = new Map<string, string>(); // Design ROWID → Size ROWID
  (designs.rows || []).forEach((d) => {
    designLabel.set(String(d.ROWID), str(d.unique_name) || str(d.design_name));
    designSize.set(String(d.ROWID), str(d.size));
  });
  const palletName = new Map<string, string>();
  const palletCap = new Map<string, number>(); // Pallet ROWID → boxes per full container
  (pallets.rows || []).forEach((p) => {
    palletName.set(String(p.ROWID), str(p.name));
    // Mixed-config pallets ("[64*12] + [32*4] = 896") stack a second B arrangement.
    palletCap.set(
      String(p.ROWID),
      num(p.boxes_per_pallet) * num(p.pallets_per_container) + num(p.b_boxes_per_pallet) * num(p.b_pallets_per_container),
    );
  });
  const repById = new Map<string, { name: string; phone: string; email: string }>();
  (reps.rows || []).forEach((r) =>
    repById.set(String(r.ROWID), { name: str(r.name), phone: str(r.phone), email: str(r.email) }),
  );

  const boxes: LoadBox[] = (loadBoxes.rows || [])
    .filter((b) => !str(b.deleted_at))
    .map((b) => {
      const veh = vehicleById.get(str(b.vehicle));
      return {
        id: String(b.ROWID),
        boxNumber: num(b.box_number),
        vehicleId: str(b.vehicle),
        vehicleNumber: veh?.number || "",
        driverName: veh?.driver || "",
        mobileNumber: veh?.mobile || "",
        capacity: num(b.capacity),
        status: (str(b.status) || "Open") as LoadBoxStatus,
        dispatchDate: str(b.dispatch_date),
        containerNumber: str(b.container_number),
        lineSeal: str(b.line_seal),
        electronicSeal: str(b.electronic_seal),
        loadingSupervisor: str(b.loading_supervisor),
        createdTime: str(b.CREATEDTIME),
      };
    });
  const boxById = new Map(boxes.map((b) => [b.id, b]));

  // Lines grouped by plan (soft-deleted skipped), ordered by position.
  const linesByPlan = new Map<string, PalPlanLine[]>();
  (lines.rows || []).forEach((l) => {
    if (str(l.deleted_at)) return;
    const planId = str(l.plan);
    if (!planId) return;
    const soId = str(l.sales_order);
    const designId = str(l.design);
    const palletId = str(l.pallet);
    const customer = customerById.get(soCustomer.get(soId) || "");
    const row: PalPlanLine = {
      id: String(l.ROWID),
      salesOrderId: soId,
      soNumber: soNo.get(soId) || soId,
      orderItemId: str(l.order_item),
      designId,
      designLabel: designLabel.get(designId) || "—",
      palletId,
      palletName: palletName.get(palletId) || "—",
      palletCapacity: palletCap.get(palletId) || 0,
      boxes: num(l.boxes),
      position: num(l.position),
      status: (str(l.status) || "Planning") as PalLineStatus,
      itemCode: "", // assigned below, once all plans are built
      customerId: soCustomer.get(soId) || "",
      customerName: customer?.name || "",
      countryCode: customer?.countryCode || "",
      sizeCode: sizeCodeById.get(designSize.get(designId) || "") || "",
      loadBoxId: str(l.load_box),
      batchNumber: str(l.batch_number),
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
      const veh = vehicleById.get(str(p.vehicle));
      const vehicleNumbers = [
        ...new Set(
          [veh?.number || str(p.vehicle_number), ...planLines.map((l) => boxById.get(l.loadBoxId)?.vehicleNumber || "")].filter(Boolean),
        ),
      ];
      return {
        id,
        palNumber: str(p.pal_number),
        status: (str(p.status) || "Planning") as PalStatus,
        vehicleId: str(p.vehicle),
        vehicleNumber: veh?.number || str(p.vehicle_number),
        driverName: veh?.driver || "",
        mobileNumber: veh?.mobile || "",
        plannedDate: str(p.planned_date),
        dispatchDate: str(p.dispatch_date),
        salespersonId: repId,
        salespersonName: repById.get(repId)?.name || "",
        salespersonPhone: repById.get(repId)?.phone || "",
        salespersonEmail: repById.get(repId)?.email || "",
        remarks: str(p.remarks),
        lines: planLines,
        soNumbers,
        customerNames: [...new Set(planLines.map((l) => l.customerName).filter(Boolean))],
        vehicleNumbers,
        totalBoxes: planLines.reduce((s, l) => s + l.boxes, 0),
        createdTime: str(p.CREATEDTIME),
        modifiedTime: str(p.MODIFIEDTIME),
      };
    });

  // Display-only sequential per-item code (PAL-NNN), oldest plan first then line
  // position — mirrors Production's PROD-NNN so each palletised item reads as an
  // individual record. ponytail: renumbers if lines change; a persistent code
  // would need a server-assigned column like pal_number.
  result
    .flatMap((p) => p.lines.map((l) => ({ createdTime: p.createdTime, planId: p.id, line: l })))
    .sort((a, b) =>
      a.createdTime !== b.createdTime
        ? a.createdTime < b.createdTime ? -1 : 1
        : a.planId !== b.planId
          ? a.planId < b.planId ? -1 : 1
          : a.line.position - b.line.position,
    )
    .forEach((x, i) => { x.line.itemCode = `PAL-${String(i + 1).padStart(3, "0")}`; });

  return { ok: true, plans: result, boxes };
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

/** Advance a plan. Dispatch (→ Completed) requires a vehicle already assigned. */
export function setPalStatus(rowid: string, status: PalStatus, vehicle?: string) {
  return bust(op<{ ROWID: string; status: string }>(`pal-status/${rowid}`, vehicle ? { status, vehicle } : { status }));
}

/** Assign (or reassign) the vehicle to a plan — only valid while it is In Loading. */
export function setPalVehicle(rowid: string, vehicle: string) {
  return bust(op<{ ROWID: string; vehicle: string }>(`pal-vehicle/${rowid}`, { vehicle }));
}

/** Palletise one item (Ready for Palletization ↔ Ready for Loading) without touching its plan. */
export function setPalLineStatus(lineId: string, status: PalLineStatus) {
  return bust(op<{ ROWID: string; status: string }>(`pal-line-status/${lineId}`, { status }));
}

/* ---- Load boxes (vehicle slots on the board) ---- */

export function createLoadBox(capacity?: number) {
  return bust(op<{ ROWID: string; box_number: number }>("load-box", capacity ? { capacity } : {}));
}

/** Mint (or fetch) the box's public share token — keys its scannable QR label
    page (#/share/box/<token> → GET /public/pallet/<token>). Idempotent. */
export async function shareLoadBox(rowid: string): Promise<string> {
  const r = await op<string>(`load-box-share/${rowid}`, {});
  if (!r.ok || !r.data) throw new Error(r.error || "Could not create the QR link");
  return r.data;
}

/** Loading-capture fields entered at the box or at dispatch. */
export interface LoadingCapture {
  container_number?: string;
  line_seal?: string;
  electronic_seal?: string;
  loading_supervisor?: string;
}

/** Assign/reassign the box's vehicle, adjust capacity, or set loading-capture
    fields (Open boxes only). */
export function updateLoadBox(rowid: string, patch: { vehicle?: string; capacity?: number } & LoadingCapture) {
  return bust(op<{ ROWID: string }>(`load-box-update/${rowid}`, patch));
}

/** Remove an Open box; its lines fall back to Ready for Loading. */
export function deleteLoadBox(rowid: string) {
  return bust(op<{ ROWID: string }>(`load-box-delete/${rowid}`, {}));
}

/** Dispatch a box (needs a vehicle + ≥1 line). Auto-completes fully-dispatched plans. */
export function dispatchLoadBox(rowid: string, capture?: LoadingCapture) {
  return bust(op<{ ROWID: string; status: string; dispatch_date: string }>(`load-box-dispatch/${rowid}`, capture || {}));
}

/** Put a Ready line into an Open box (box="" pulls it back out). A `boxes`
    count below the line's total loads that many and splits off a Ready remainder. */
export function setLineBox(lineId: string, box: string, boxes?: number) {
  return bust(op<{ ROWID: string; load_box: string | null }>(`pal-line-box/${lineId}`, boxes ? { box, boxes } : { box }));
}

export function deletePalPlan(rowid: string) {
  return bust(remove("PalletizationPlan", rowid));
}

/** Seed a create form from an existing plan (clone) — drops the auto-gen PAL number. */
export function planToInput(p: PalPlan): PalPlanInput {
  return {
    pal_number: "",
    vehicle_number: p.vehicleNumber,
    vehicle: p.vehicleId,
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
      batch_number: l.batchNumber,
    })),
  };
}

/** Human label for a PLAN status (spaced). */
export const PAL_STATUS_LABEL: Record<PalStatus, string> = {
  Planning: "Ready for Palletization",
  Loading: "In Dispatch",
  Completed: "Dispatched",
};
