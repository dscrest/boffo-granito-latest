/* ============================================================
   Dispatch — "how much of this has actually shipped?", one component for
   the Sales Order, Palletization, Quote and Customer detail pages.

   Ground truth is the same source the loading board uses: PalletizationPlan
   lines whose LoadBox is Dispatched. No new table, no new counter — the
   scope just selects which lines count.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fmt } from "@/lib/format";
import { EmptyState } from "@/ui/States";
import { cachedLoadBoxes, cachedPalPlans, listPalPlans, boxLabel, type LoadBox, type PalPlan, type PalPlanLine } from "./palPlansApi";

/** Which lines count as "this record's" dispatches. */
export type DispatchScope =
  | { kind: "so"; salesOrderIds: string[] } // one order, or a quote's orders
  | { kind: "plan"; planId: string }
  | { kind: "customer"; customerId: string };

export interface DispatchRow {
  line: PalPlanLine;
  plan: PalPlan;
  box: LoadBox;
}

/** Dispatched lines in scope, newest dispatch first. */
export function dispatchRows(plans: PalPlan[], boxes: LoadBox[], scope: DispatchScope): DispatchRow[] {
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const inScope = (p: PalPlan, l: PalPlanLine) =>
    scope.kind === "so" ? scope.salesOrderIds.includes(l.salesOrderId)
    : scope.kind === "plan" ? p.id === scope.planId
    : l.customerId === scope.customerId;
  return plans
    .flatMap((p) => p.lines.map((l) => ({ plan: p, line: l })))
    .flatMap(({ plan, line }) => {
      const box = line.loadBoxId ? boxById.get(line.loadBoxId) : undefined;
      return box?.status === "Dispatched" && inScope(plan, line) ? [{ plan, line, box }] : [];
    })
    .sort((a, b) => (b.box.dispatchDate || "").localeCompare(a.box.dispatchDate || ""));
}

/** Boxes dispatched per Design ROWID — feeds ContainerPlanCard's progress. */
export function dispatchedByDesign(rows: DispatchRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const { line } of rows) m.set(line.designId, (m.get(line.designId) || 0) + line.boxes);
  return m;
}

export function DispatchTab({ scope, orderedBoxes }: {
  scope: DispatchScope;
  /** Ordered total for the progress strip; omitted = show dispatched only. */
  orderedBoxes?: number;
}) {
  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [boxes, setBoxes] = useState<LoadBox[]>(() => cachedLoadBoxes() ?? []);
  const [loading, setLoading] = useState(() => cachedPalPlans() == null);

  useEffect(() => {
    let alive = true;
    void listPalPlans().then((r) => {
      if (!alive) return;
      setLoading(false);
      if (r.ok) {
        setPlans(r.plans);
        setBoxes(r.boxes);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Hosts pass `scope` as an inline literal, so key the memo on its contents.
  const scopeKey = JSON.stringify(scope);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => dispatchRows(plans, boxes, scope), [plans, boxes, scopeKey]);
  const total = rows.reduce((s, r) => s + r.line.boxes, 0);
  const containers = new Set(rows.map((r) => r.box.id)).size;
  const pct = orderedBoxes && orderedBoxes > 0 ? Math.min(100, Math.round((total / orderedBoxes) * 100)) : null;

  if (loading && plans.length === 0) return <div className="muted mono" style={{ padding: 18 }}>Loading dispatch…</div>;
  if (rows.length === 0) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <EmptyState title="Nothing dispatched yet" hint="Containers show here once they leave the loading board" />
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 600 }}>Dispatched</span>
        <span className="mono">
          {fmt(total)}{orderedBoxes ? ` of ${fmt(orderedBoxes)}` : ""} boxes
        </span>
        {pct != null && (
          <span
            style={{ flex: 1, maxWidth: 260, display: "flex", height: 10, borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)", background: "var(--panel-2)" }}
            title={`${fmt(total)} of ${fmt(orderedBoxes!)} boxes dispatched`}
          >
            <span style={{ width: `${pct}%`, background: "var(--c-green)" }} />
          </span>
        )}
        {pct != null && <span className="mono" style={{ fontWeight: 600, color: "var(--c-green)" }}>{pct}%</span>}
        <span className="muted" style={{ fontSize: 14, marginLeft: "auto" }}>
          {containers} container{containers === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Loading</th>
              <th>Container No.</th>
              <th>Vehicle</th>
              <th>Dispatch Date</th>
              <th>Design</th>
              <th>Batch</th>
              <th className="num" style={{ textAlign: "right" }}>Boxes</th>
              <th>Order</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line, box }) => (
              <tr key={line.id}>
                <td className="mono" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  <Link className="linkish" to={`/loading/${encodeURIComponent(box.id)}`} title="Open loading">{boxLabel(box)}</Link>
                </td>
                <td className="mono">{box.containerNumber || "—"}{box.containerSize ? ` · ${box.containerSize}` : ""}</td>
                <td>{[box.vehicleNumber, box.driverName].filter(Boolean).join("  ·  ") || "—"}</td>
                <td className="mono muted">{box.dispatchDate ? box.dispatchDate.slice(0, 10) : "—"}</td>
                <td><span className="design-name">{line.designLabel}</span></td>
                <td className="mono">{line.batchNumber || "—"}</td>
                <td className="num mono">{fmt(line.boxes)}</td>
                <td className="mono">
                  {line.salesOrderId ? (
                    <Link className="linkish" to={`/orders/${encodeURIComponent(line.salesOrderId)}`} title="Open order">{line.soNumber}</Link>
                  ) : (
                    line.soNumber || "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
