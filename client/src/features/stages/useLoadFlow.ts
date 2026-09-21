/* ============================================================
   useLoadFlow — the shared load-into-container flow: picker state,
   the all-or-nothing confirm, and the SO-plan hint. Extracted from
   LoadingBay (2026-09-04) when the Load entry point moved to the
   Palletization board (/packing); boards mount LoadContainerModal
   themselves. "New Loading" on /loading is the Loading Session page instead.
   ============================================================ */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { planProgress } from "@/features/quotes/planProgress";
import { dispatchRows, dispatchedByDesign } from "./DispatchTab";
import { useContainerPlanBySo } from "./containerPlanPrefill";
import {
  boxLabel,
  createLoadBox,
  invalidatePalPlans,
  sendToLoading,
  setLinesBox,
  type LoadBox,
  type LoadingCapture,
  type PalPlan,
  type PalPlanLine,
} from "./palPlansApi";

export type LoadEntry = { p: PalPlan; l: PalPlanLine };
export type LoadTarget =
  | { boxId: string }
  | { details: { vehicle?: string; dispatch_date?: string } & LoadingCapture };

export function useLoadFlow({ plans, boxes, onChanged }: { plans: PalPlan[]; boxes: LoadBox[]; onChanged: () => void }) {
  const navigate = useNavigate();
  const [picker, setPicker] = useState<{ lineIds: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const { planBySo, designIdOf } = useContainerPlanBySo();

  const allLines: LoadEntry[] = plans.flatMap((p) => p.lines.map((l) => ({ p, l })));
  const openBoxes = boxes.filter((b) => b.status === "Open");
  const linesOfBox = (boxId: string) => allLines.filter(({ l }) => l.loadBoxId === boxId);

  const finish = (ok: boolean, err: string, msg: string) => {
    if (!ok) { toast.error(err); return; }
    toast.success(msg);
    invalidatePalPlans();
    onChanged();
  };

  // Guide-by-plan: the SO/quote container plan's next unfilled container that
  // wants this design — shown as a hint (never enforced) in LoadContainerModal.
  const planHintFor = (salesOrderId: string, designId: string) => {
    const cp = planBySo.get(salesOrderId);
    if (!cp) return undefined;
    const prog = planProgress(
      cp.plan,
      dispatchedByDesign(dispatchRows(plans, boxes, { kind: "so", salesOrderIds: [salesOrderId] })),
      designIdOf,
    );
    for (let i = 0; i < cp.plan.containers.length; i++) {
      if (prog[i].status === "Sent") continue;
      const ln = cp.plan.containers[i].lines.find((x) => designIdOf(x.design) === designId);
      if (ln) return { docNo: cp.docNo, containerNo: cp.plan.containers[i].no, boxes: ln.boxes, palletName: ln.palletName };
    }
    return undefined;
  };

  // Confirm from the load modal. `target` is either an existing container or
  // the details of a new one to mint first (container-first: the container
  // lands complete, no follow-up Confirm Load needed). `entries` is what the
  // modal showed the user — every line, with a `boxes` count only on a partial
  // (split server-side). One all-or-nothing batch call: a bad line loads
  // nothing.
  const confirmLoad = async (
    target: LoadTarget,
    entries: Array<{ lineId: string; boxes?: number }>,
    prodEntries: Array<{ salesOrderId: string; orderItemId: string; boxes: number }> = [],
    onDone?: () => void,
  ) => {
    if (!picker || busy) return; // in-flight guard: a double-confirm must not double-load
    setBusy(true);
    let toBox: string;
    let label: string;
    if ("boxId" in target) {
      toBox = target.boxId;
      label = boxLabel(boxes.find((b) => b.id === target.boxId)!);
    } else {
      const created = await createLoadBox(target.details);
      if (!created.ok || !created.data?.ROWID) {
        setBusy(false);
        finish(false, created.error || "Could not create the container", "");
        return;
      }
      toBox = String(created.data.ROWID);
      label = created.data.load_number || target.details.container_number || `Container ${created.data.box_number ?? ""}`.trim();
    }
    // Pallet lines first — all-or-nothing, so a failure aborts before any
    // direct-from-production lines are minted.
    if (entries.length > 0) {
      const res = await setLinesBox(toBox, entries);
      if (!res.ok) {
        setBusy(false);
        setPicker(null);
        finish(false, res.error || "Could not load the items", "");
        return;
      }
    }
    // Direct-from-production picks: /send-to-loading mints ReadyToLoad lines
    // and lands them in the box in one call. One call per SO, sequential.
    let prodError = "";
    const bySo = new Map<string, { order_item: string; boxes: number }[]>();
    for (const e of prodEntries) bySo.set(e.salesOrderId, [...(bySo.get(e.salesOrderId) ?? []), { order_item: e.orderItemId, boxes: e.boxes }]);
    for (const [so, soLines] of bySo) {
      const res = await sendToLoading({ sales_order: so, box: toBox, lines: soLines });
      if (!res.ok) {
        prodError = res.error || "Could not add the order items";
        break;
      }
    }
    setBusy(false);
    setPicker(null);
    onDone?.();
    if (prodError) {
      // Pallets (if any) are already in — recoverable via Add Items on the loading.
      toast.error(
        entries.length > 0
          ? `Pallets loaded into ${label}, but adding order items failed: ${prodError} — retry via Add Items on the loading`
          : prodError,
      );
      invalidatePalPlans();
      onChanged();
      return;
    }
    const total = entries.length + prodEntries.length;
    finish(true, "", `${total} item${total === 1 ? "" : "s"} → ${label}`);
    // Land on the loading's detail page so the batch just added is visible.
    navigate(`/loading/${encodeURIComponent(toBox)}`);
  };

  return { picker, setPicker, busy, allLines, openBoxes, linesOfBox, planHintFor, confirmLoad, planBySo, designIdOf };
}
