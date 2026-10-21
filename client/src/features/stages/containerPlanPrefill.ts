/* ============================================================
   Container-plan lookup shared by the palletization + loading flows.
   Keys each SO's containerisation plan (the SO's OWN editable copy wins;
   the source quote's snapshot is the fallback for SOs converted before SOs
   owned plans) and answers "which pallet does the plan want for this
   design?" — the palletise-time prefill. Plan lines store a design NAME;
   everything else is keyed by Design ROWID, so a name→id map rides along.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseContainerPlan, type ContainerPlan, type ContainerPlanLine, type Order, type Quote } from "@/data";
import { cachedQuotes, listQuotes, subscribeQuotes } from "@/features/quotes/quotesApi";
import { cachedOrders, listOrders, subscribeOrders } from "@/features/orders/ordersApi";
import { useMasters } from "@/features/masters/useMasters";
import { planClaims, planProgress, type ContainerProgressStatus } from "@/features/quotes/planProgress";
import { dispatchRows, dispatchedByDesign } from "./DispatchTab";
import type { LoadBox, PalPlan } from "./palPlansApi";

export function useContainerPlanBySo() {
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  useEffect(() => {
    let alive = true;
    // Subscribe so a plan saved elsewhere (SO planner, loading tab) reaches
    // every mounted consumer; adopt only non-null snapshots (invalidate()
    // notifies with an empty cache mid-refetch).
    const unsubQ = subscribeQuotes(() => {
      const c = cachedQuotes();
      if (alive && c) setQuotes(c);
    });
    const unsubO = subscribeOrders(() => {
      const c = cachedOrders();
      if (alive && c) setOrders(c);
    });
    void listQuotes().then((r) => {
      if (alive && r.ok) setQuotes(r.quotes);
    });
    void listOrders().then((r) => {
      if (alive && r.ok) setOrders(r.orders);
    });
    return () => {
      alive = false;
      unsubQ();
      unsubO();
    };
  }, []);

  const planBySo = useMemo(() => {
    const m = new Map<string, { docNo: string; plan: ContainerPlan }>();
    quotes.forEach((qt) => {
      const plan = parseContainerPlan(qt.containerPlan);
      if (plan) qt.sos?.forEach((so) => m.set(so.id, { docNo: qt.quoteNo, plan }));
    });
    orders.forEach((o) => {
      if (!o.salesOrderId) return;
      const plan = parseContainerPlan(o.containerPlan);
      if (plan) m.set(o.salesOrderId, { docNo: o.orderNumber || o.poNumber, plan });
    });
    return m;
  }, [quotes, orders]);

  const { designRows } = useMasters();
  const designIdOf = useMemo(() => {
    const byName = new Map<string, string>();
    designRows.forEach((d) => {
      if (d.designName) byName.set(d.designName, d.id);
      if (d.uniqueName) byName.set(d.uniqueName, d.id);
    });
    return (name: string) => byName.get(name) || name;
  }, [designRows]);

  // First planned pallet for this design, in container order ("" = unplanned).
  const defaultPalletFor = useCallback(
    (salesOrderId: string, designId: string): string => {
      const cp = planBySo.get(salesOrderId);
      if (!cp || !designId) return "";
      for (const c of cp.plan.containers)
        for (const ln of c.lines) if (ln.palletId && designIdOf(ln.design) === designId) return ln.palletId;
      return "";
    },
    [planBySo, designIdOf],
  );

  return { planBySo, designIdOf, defaultPalletFor };
}

/** One container of the SO's LATEST plan as the loading sees it: its lines + format, its progress
    (dispatched drain, see planProgress) and the Open loading that already claims it (CR-338). */
export type PlanSlice = {
  ci: number;
  no: number;
  lines: ContainerPlanLine[];
  containerFormat?: string;
  containerFormatName?: string;
  pallets: number;
  boxes: number;
  status: ContainerProgressStatus;
  /** An Open loading whose `load_plan.plan[soId]` points here. */
  claimedBy?: LoadBox;
};

/** EVERY container of the SO's plan, in plan order. [] = no parseable plan. Plan-only loadings render
    their claimed (else first unsent) container live instead of their minted load_plan snapshot, so a
    plan edit shows everywhere immediately. */
export function planSlices(
  soId: string,
  planBySo: Map<string, { docNo: string; plan: ContainerPlan }>,
  plans: PalPlan[],
  boxes: LoadBox[],
  designIdOf: (name: string) => string,
): PlanSlice[] {
  const cp = soId ? planBySo.get(soId) : undefined;
  if (!cp) return [];
  const prog = planProgress(cp.plan, dispatchedByDesign(dispatchRows(plans, boxes, { kind: "so", salesOrderIds: [soId] })), designIdOf);
  const claims = planClaims(boxes, soId);
  return cp.plan.containers.map((c, ci) => ({
    ci,
    no: c.no,
    lines: c.lines,
    containerFormat: c.containerFormat,
    containerFormatName: c.containerFormatName,
    pallets: c.pallets,
    boxes: c.boxes,
    status: prog[ci]?.status ?? "Planned",
    claimedBy: claims.get(ci),
  }));
}

/** The containers still open to a NEW loading: not Sent (dispatched drain) and not claimed by an Open
    loading — what the next loadings are slated to carry. */
export function unsentPlanContainers(
  soId: string,
  planBySo: Map<string, { docNo: string; plan: ContainerPlan }>,
  plans: PalPlan[],
  boxes: LoadBox[],
  designIdOf: (name: string) => string,
): PlanSlice[] {
  return planSlices(soId, planBySo, plans, boxes, designIdOf).filter((s) => s.status !== "Sent" && !s.claimedBy);
}

/** The container a loading shows: its OWN claim when `forBoxId` is given, else the first unsent
    (null = no plan / nothing left). */
export function nextPlanContainer(
  soId: string,
  planBySo: Map<string, { docNo: string; plan: ContainerPlan }>,
  plans: PalPlan[],
  boxes: LoadBox[],
  designIdOf: (name: string) => string,
  forBoxId?: string,
): PlanSlice | null {
  const all = planSlices(soId, planBySo, plans, boxes, designIdOf);
  return (forBoxId && all.find((s) => s.claimedBy?.id === forBoxId)) || all.find((s) => s.status !== "Sent" && !s.claimedBy) || null;
}
