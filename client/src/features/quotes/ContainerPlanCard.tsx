/* Container Plan snapshot (Plan Containerisation) — read-only card shared by
   the Quote and Sales Order "Container Planning" tabs. Parses the plan JSON
   stored on the document; links to its editor (…/containerise). */
import { Link } from "react-router-dom";
import { parseContainerPlan } from "@/data";
import { fmt } from "@/lib/format";
import { EmptyState } from "@/ui/States";

export function ContainerPlanCard({ containerPlan, docNo, plannerPath }: {
  containerPlan: string | undefined;
  docNo: string;
  plannerPath: string;
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
  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 600 }}>Container Plan</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {plan.containers.length} container{plan.containers.length === 1 ? "" : "s"} planned on{" "}
          <Link className="linkish" to={plannerPath}>{docNo}</Link>
        </span>
        <Link className="btn" style={{ marginLeft: "auto" }} to={plannerPath}>
          Open planner
        </Link>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: 14 }}>
        {plan.containers.map((c) => (
          <div key={c.no} style={{ minWidth: 240, border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
              <span className="mono" style={{ fontWeight: 600 }}>{docNo} · C{c.no}</span>
              <span className="mono dim" style={{ fontSize: "var(--t-sm)" }}>{c.pallets} pallets · {fmt(c.boxes)} boxes · {c.fillPct}%</span>
            </div>
            {c.lines.map((l, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--t-sm)", padding: "2px 0" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf.get(l.design), flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{l.design}</span>
                <span className="mono dim">{l.pallets}P · {fmt(l.boxes)}B</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
