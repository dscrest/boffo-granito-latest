/* ============================================================
   CR-347: loading entries — ONE vehicle trip recorded against one or
   several Panel / Sample orders in a single call (/panel-load-save); a load
   moves the stock it carries and may flip the order to Dispatched /
   Supplied, so every cache involved is busted here. Removing a load
   (/panel-load-delete, reason mandatory) unwinds it while the order is open.
   ============================================================ */
import { op, type OpResult } from "@/lib/dataOps";
import type { DesignImage } from "@/features/masters/designsApi";
import { invalidateCutStock, invalidatePanelOrders, type Material } from "./panelOrdersApi";
import { invalidateSampleOrders } from "./sampleOrdersApi";
import { resolveVehicle } from "@/features/masters/vehiclesApi";

export interface LoadPick {
  line: string; // PanelOrderLine / SampleOrderLine ROWID
  material: Material;
  qty: number; // 0 = skip
}
export interface LoadOrderInput {
  order_type: "Panel" | "Sample";
  order: string;
  lines: LoadPick[];
}
export interface LoadInput {
  load_date: string; // yyyy-MM-dd
  vehicle_number: string;
  driver_name?: string; // CR-351 — also kept on the Vehicle master (CR-185 rule)
  driver_mobile?: string;
  note?: string;
  photos?: DesignImage[];
  orders: LoadOrderInput[];
}
export interface LoadResult {
  order_number: string;
  loads: { ROWID: string; order: string; order_type: "Panel" | "Sample"; status: string }[];
}

function bust<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    invalidatePanelOrders();
    invalidateSampleOrders();
    invalidateCutStock();
    return r;
  });
}

/** Record one trip — the server verifies every order before writing any row.
    CR-351: the vehicle + driver are also kept on the Vehicle master silently (CR-185);
    the load itself stores free text, so a master failure never blocks the load. */
export async function saveLoad(input: LoadInput): Promise<OpResult<LoadResult>> {
  await resolveVehicle({ vehicle_number: input.vehicle_number, driver_name: input.driver_name, mobile_number: input.driver_mobile }).catch(() => undefined);
  return bust(op<LoadResult>("panel-load-save", input));
}
/** Remove one order's row of a trip (open orders only; reason mandatory). */
export function deleteLoad(rowid: string, reason?: string): Promise<OpResult> {
  return bust(op(`panel-load-delete/${rowid}`, { reason }));
}
