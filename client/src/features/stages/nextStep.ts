/* ============================================================
   nextStep — "what to do first" for a Sales Order (CR-328). Pure, type-only
   imports (npx tsx self-check in nextStep.test.ts).

   Every stage gate in the app (New Loading, New Palletization, the SO detail
   Items card, Send to Loading) explains itself through ONE rule so the
   reasons can never disagree. Inputs are what the client already caches:
   the SO's OrderItems (counters) and its PalletizationPlanLines (statuses).
   OrderItem.palletized_qty counts ONLY Ready-for-Loading / boxed lines
   (recountOrderItems), so queued + in-palletization boxes come from the lines.
   ============================================================ */
import type { Order } from "@/data";
import type { PalPlanLine } from "./palPlansApi";

export type Step = "closed" | "approve" | "allocate" | "palletize" | "palletizing" | "load" | "dispatch" | "done";
export interface NextStep {
  step: Step;
  /** One sentence, no trailing stop: "120 boxes in palletization. Complete palletization first". */
  reason: string;
  /** Where that happens ("" = nowhere to go). */
  to: string;
}

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + (f(x) || 0), 0);

/** The next thing that has to happen on ONE order. `items` = its OrderItems; `lines` = any
    plan lines (filtered to the order here, so a page can pass every line it holds). */
export function soNextStep(items: Order[], lines: PalPlanLine[]): NextStep {
  const soId = items[0]?.salesOrderId || "";
  const status = items[0]?.status || "Confirmed";
  const so = soId ? `/orders/${encodeURIComponent(soId)}` : "";
  if (["Cancelled", "Rejected"].includes(status)) return { step: "closed", reason: "Order is closed", to: so };
  if (["Draft", "PendingApproval"].includes(status)) return { step: "approve", reason: "Awaiting approval. Approve the order first", to: so };

  const ordered = sum(items, (o) => o.orderQty);
  const allocated = sum(items, (o) => o.producedQty);
  const palletized = sum(items, (o) => o.palletizedQty);
  const loaded = sum(items, (o) => o.loadedQty);
  const dispatched = sum(items, (o) => o.dispatchedQty);
  if (ordered > 0 && dispatched >= ordered) return { step: "done", reason: "Every box is dispatched", to: "" };

  const live = lines.filter((l) => l.salesOrderId === soId);
  const ready = sum(live.filter((l) => l.status === "ReadyToLoad" && !l.loadBoxId), (l) => l.boxes);
  const palletizing = sum(live.filter((l) => l.status === "Palletizing"), (l) => l.boxes);
  const queued = sum(live.filter((l) => l.status === "Planning"), (l) => l.boxes);
  if (ready > 0) return { step: "load", reason: `${ready} boxes ready for loading`, to: `/loading/new?so=${encodeURIComponent(soId)}` };
  if (palletizing > 0) return { step: "palletizing", reason: `${palletizing} boxes in palletization. Complete palletization first`, to: "/palletizing" };
  if (queued > 0) return { step: "palletize", reason: `${queued} boxes ready for palletization. Start palletization first`, to: "/packing" };
  const unplanned = allocated - palletized - palletizing - queued;
  if (unplanned > 0) return { step: "palletize", reason: `${unplanned} allocated boxes not palletized yet. Send to Palletization`, to: `/packing/new?fromOrder=${encodeURIComponent(soId)}` };
  if (allocated < ordered)
    return {
      step: "allocate",
      reason: allocated > 0 ? `${ordered - allocated} boxes still need stock. Record production, then Allocate Stock` : "No stock allocated. Record production, then Allocate Stock",
      to: so,
    };
  if (loaded > dispatched) return { step: "dispatch", reason: `${loaded - dispatched} boxes loaded, awaiting dispatch`, to: "/loading" };
  return { step: "done", reason: "Nothing left on this order", to: "" };
}

export interface Blocker { label: string; reason: string; to: string }

/** Why `want` can't proceed for a customer ("" = everyone): one entry per order that is not there
    yet. Empty = something CAN proceed. Orders that are complete or closed are left out, unless
    they are all there is. */
export function blockers(want: "load" | "palletize", customerId: string, orders: Order[], lines: PalPlanLine[]): Blocker[] {
  const bySo = new Map<string, Order[]>();
  for (const o of orders) {
    if (!o.salesOrderId || (customerId && o.customerId !== customerId)) continue;
    bySo.set(o.salesOrderId, [...(bySo.get(o.salesOrderId) ?? []), o]);
  }
  if (bySo.size === 0) return [{ label: "", reason: customerId ? "No sales orders for this customer yet. Create a Sales Order first" : "No sales orders yet. Create a Sales Order first", to: "/orders/new" }];
  // Steps that mean "go ahead" for each ask.
  const ok: Step[] = want === "load" ? ["load", "dispatch"] : ["palletize", "load", "dispatch"];
  const out: Blocker[] = [];
  let finished = 0;
  for (const [soId, items] of bySo) {
    const n = soNextStep(items, lines);
    if (ok.includes(n.step)) return [];
    if (n.step === "done" || n.step === "closed") {
      finished++;
      continue;
    }
    out.push({ label: items[0].orderNumber || items[0].poNumber || soId, reason: n.reason, to: n.to });
  }
  if (out.length === 0 && finished > 0) return [{ label: "", reason: finished === 1 ? "The only order is complete or closed" : `All ${finished} orders are complete or closed`, to: "" }];
  return out;
}
