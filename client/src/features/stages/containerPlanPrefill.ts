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
import { planProgress } from "@/features/quotes/planProgress";
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

/** Every not-yet-Sent container of the SO's LATEST plan, in plan order — what the next loadings are
    slated to carry. Plan-only loadings render the first live instead of their minted load_plan
    snapshot (which stays as the fallback), so a plan edit shows everywhere immediately. [] = no
    parseable plan. ponytail: progress counts DISPATCHED boxes only, so Open loadings planned
    earlier still list their container here; the multi-container page (CR-301) de-dupes within
    its own session via each section's `planCi`, nothing more. */
export type PlanSlice = { ci: number; lines: ContainerPlanLine[]; containerFormat?: string };
export function unsentPlanContainers(
  soId: string,
  planBySo: Map<string, { docNo: string; plan: ContainerPlan }>,
  plans: PalPlan[],
  boxes: LoadBox[],
  designIdOf: (name: string) => string,
): PlanSlice[] {
  const cp = soId ? planBySo.get(soId) : undefined;
  if (!cp) return [];
  const prog = planProgress(cp.plan, dispatchedByDesign(dispatchRows(plans, boxes, { kind: "so", salesOrderIds: [soId] })), designIdOf);
  return cp.plan.containers.flatMap((c, ci) => (prog[ci]?.status !== "Sent" ? [{ ci, lines: c.lines, containerFormat: c.containerFormat }] : []));
}

/** The first unsent container (null = no plan / all sent). */
export function nextPlanContainer(
  soId: string,
  planBySo: Map<string, { docNo: string; plan: ContainerPlan }>,
  plans: PalPlan[],
  boxes: LoadBox[],
  designIdOf: (name: string) => string,
): PlanSlice | null {
  return unsentPlanContainers(soId, planBySo, plans, boxes, designIdOf)[0] ?? null;
}
