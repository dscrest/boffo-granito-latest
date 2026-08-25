/* Container Plan snapshot (Plan Containerisation) — read-only card shared by
   the Quote and Sales Order "Container Planning" tabs. Parses the plan JSON
   stored on the document; links to its editor (…/containerise).
   Pass `dispatchedByDesign` (Design ROWID → boxes already dispatched) and each
   container marks itself Sent / Partially sent / Planned — see planProgress. */
import { Link } from "react-router-dom";
import { parseContainerPlan } from "@/data";
import { fmt } from "@/lib/format";
import { EmptyState } from "@/ui/States";
import { planProgress, progressChip, progressSummary } from "./planProgress";

export function ContainerPlanCard({ containerPlan, docNo, plannerPath, dispatchedByDesign, designKey }: {
  containerPlan: string | undefined;
  docNo: string;
  plannerPath: string;
  /** Boxes dispatched so far, keyed the same way `designKey` resolves plan lines. */
  dispatchedByDesign?: Map<string, number>;
  /** Plan line's design name → the key used above (default: the name itself). */
  designKey?: (design: string) => string;
}) {
  const plan = parseContainerPlan(containerPlan);
  if (!plan) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <EmptyState
          title="No container plan yet"
          hint="Build one in Plan Containerisation"
          action={<Link className="btn" to={plannerPath}>Open planner</Link>}
        />
      </div>
    );
  }
  const colors = ["var(--c-blue)", "var(--c-green)", "var(--c-amber)", "var(--c-violet)", "var(--c-cyan)"];
  const colorOf = new Map<string, string>();
  plan.containers.forEach((c) => c.lines.forEach((l) => {
    if (!colorOf.has(l.design)) colorOf.set(l.design, colors[colorOf.size % colors.length]);
  }));
  // Derived shipping progress — absent when the host passes no dispatch data.
  const progress = dispatchedByDesign ? planProgress(plan, dispatchedByDesign, designKey) : null;
  const byNo = new Map((progress || []).map((p) => [p.no, p]));
  const summary = progress ? progressSummary(progress) : null;
  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 600 }}>Container Plan</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {plan.containers.length} container{plan.containers.length === 1 ? "" : "s"} planned on{" "}
          <Link className="linkish" to={plannerPath}>{docNo}</Link>
        </span>
        {summary && (
          <span className="mono" style={{ fontSize: 12, color: summary.sent > 0 ? "var(--c-green)" : "var(--dim)" }}>
            {summary.sent} of {summary.total} sent · {fmt(summary.boxes)} of {fmt(summary.planned)} boxes
          </span>
        )}
        <Link className="btn" style={{ marginLeft: "auto" }} to={plannerPath}>
          Open planner
        </Link>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: 14 }}>
        {plan.containers.map((c) => {
          const p = byNo.get(c.no);
          const chip = p ? progressChip(p) : null;
          return (
          <div
            key={c.no}
            style={{
              minWidth: 240, borderRadius: 8, padding: "10px 12px",
              border: `1px solid ${p?.status === "Sent" ? "var(--c-green)" : p?.status === "Partial" ? "var(--c-amber)" : "var(--border)"}`,
              opacity: p?.status === "Sent" ? 0.8 : 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
              <span className="mono" style={{ fontWeight: 600 }}>{docNo} · C{c.no}</span>
              <span className="mono dim" style={{ fontSize: "var(--t-sm)" }}>{c.pallets} pallets · {fmt(c.boxes)} boxes · {c.fillPct}%</span>
            </div>
            {chip && (
              <div style={{ marginBottom: 6 }}>
                <span className={`chip ${chip.cls}`} style={{ whiteSpace: "nowrap" }}>{chip.label}</span>
              </div>
            )}
            {c.lines.map((l, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--t-sm)", padding: "2px 0" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf.get(l.design), flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{l.design}</span>
                <span className="mono dim">{l.pallets}P · {fmt(l.boxes)}B</span>
              </div>
            ))}
          </div>
          );
        })}
      </div>
    </div>
  );
}
