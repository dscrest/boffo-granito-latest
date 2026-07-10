/* ============================================================
   Container-Fit Suggester — read-only view over POST /fit-suggest.
   "Containers shall not go empty": the server greedily fills the
   earliest-ETD containers with whole pending pallets (closed batches
   not yet loaded) under up to four co-equal caps — pallet slots, area
   (m²), weight (kg), boxes — and flags any container under 95% on
   every active dimension. Each card shows one bar per active cap plus
   a "capped by" badge naming the binding constraint. This view only
   reads — loading is committed from the Loading screen.
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ProgressBar } from "@/ui/primitives";
import { fmt } from "@/lib/format";
import {
  fitSuggest,
  type FitResult,
  type FitContainer,
  type FitDim,
} from "@/features/masters/containersApi";

const DIM_LABEL: Record<FitDim, string> = {
  slots: "Slots",
  area: "Area",
  weight: "Weight",
  boxes: "Boxes",
};
const DIM_UNIT: Record<FitDim, string> = {
  slots: "",
  area: " m²",
  weight: " kg",
  boxes: "",
};
const REASON_LABEL: Record<string, string> = {
  slots: "no pallet slot",
  area: "over area",
  weight: "over weight",
  boxes: "over boxes",
  no_space: "no space",
};

/** Bars shown per card, in display order. Area (m²) dropped from display —
    indicators are box-based; the server still caps by area if configured.
    Weight included so it lights up the moment per-box weight + container
    max_weight are calibrated. */
const BAR_DIMS: FitDim[] = ["slots", "weight", "boxes"];

function CapBar({ c, dim }: { c: FitContainer; dim: FitDim }) {
  const pct = c.utilization[`${dim}_pct`];
  const cap = c.capacity[dim];
  if (pct == null || cap == null) return null; // dimension unconstrained → no bar
  const used = c.used[dim];
  const over = pct > 100;
  const color = over ? "var(--c-red)" : c.underfilled ? "var(--c-amber)" : "var(--c-green)";
  return (
    <div style={{ marginBottom: 7 }}>
      <div className="row between" style={{ fontSize: 10, marginBottom: 3 }}>
        <span className="muted">{DIM_LABEL[dim]}</span>
        <span className="mono" style={{ color }}>
          {fmt(used)}
          {DIM_UNIT[dim]} / {fmt(cap)}
          {DIM_UNIT[dim]} · {pct}%
        </span>
      </div>
      <ProgressBar value={Math.min(pct, 100)} max={100} color={color} height={4} />
    </div>
  );
}

export function FitSuggest() {
  const [data, setData] = useState<FitResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await fitSuggest();
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(res.error || "Failed to compute fit plan");
      return;
    }
    setError(null);
    setData(res.data);
  };

  useEffect(() => {
    void load();
  }, []);

  const perContainer = data?.perContainer || [];
  const unassigned = data?.unassigned || [];
  const totalAssigned = perContainer.reduce((s, c) => s + c.assigned.length, 0);
  const underfilled = perContainer.filter((c) => c.underfilled).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Fit Suggester</div>
          <div className="sub">
            {loading
              ? "Computing…"
              : `${perContainer.length} containers · ${totalAssigned} pallets assigned · ${unassigned.length} unassigned`}
          </div>
        </div>
        <div className="right">
          <button className="hbtn primary" onClick={() => void load()} title="Recompute">
            <Icon name="clock" size={13} />
            Recompute
          </button>
        </div>
      </div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      {loading && !data && <SkeletonRows rows={6} />}

      {!loading && !error && perContainer.length === 0 && unassigned.length === 0 && (
        <EmptyState
          icon="package"
          title="Nothing to plan"
          hint="Close some pallets (Pallet Packing) and add planned containers (Container Master) first"
        />
      )}

      {underfilled > 0 && (
        <div
          className="card"
          style={{ marginBottom: 12, borderLeft: "3px solid var(--c-amber)", color: "var(--c-amber)", padding: "10px 14px" }}
        >
          {underfilled} container{underfilled > 1 ? "s" : ""} would ship under 95% full on every constraint.
        </div>
      )}

      <div className="split" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", display: "grid", gap: 10 }}>
        {perContainer.map((c) => (
          <div className="card" key={c.container}>
            <div className="card-head">
              <span className={`dot ${c.underfilled ? "amber" : "green"}`} />
              <span className="title mono">{c.container_number || `#${c.container}`}</span>
              <div className="right">
                {c.binding && (
                  <span
                    className="badge mono"
                    title="Binding constraint — the dimension that fills first"
                    style={{ fontSize: 10 }}
                  >
                    capped by: {DIM_LABEL[c.binding]}
                  </span>
                )}
              </div>
            </div>
            <div style={{ padding: "12px 14px" }}>
              {BAR_DIMS.map((d) => (
                <CapBar key={d} c={c} dim={d} />
              ))}

              <div className="row between" style={{ marginTop: 6, fontSize: 11 }}>
                <span className="muted">{c.assigned.length} pallet{c.assigned.length === 1 ? "" : "s"} assigned</span>
                {c.underfilled && <span className="mono" style={{ color: "var(--c-amber)" }}>underfilled</span>}
              </div>

              {c.assigned.length > 0 ? (
                <div className="mono muted" style={{ marginTop: 6, fontSize: 10, lineHeight: 1.6 }}>
                  {c.assigned.map((id) => (
                    <span key={id} style={{ marginRight: 6 }}>#{id}</span>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>No new pallets fit.</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {unassigned.length > 0 && (
        <>
          <div className="sec-title">
            <h2>Unassigned Pallets</h2>
            <span className="meta">No container has room — add capacity or another container</span>
          </div>
          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Design</th>
                  <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                  <th>Blocked by</th>
                </tr>
              </thead>
              <tbody>
                {unassigned.map((p) => (
                  <tr key={p.batch}>
                    <td className="mono muted">#{p.batch}</td>
                    <td><span className="design-name">{p.design || "—"}</span></td>
                    <td className="num mono">{fmt(p.boxes)}</td>
                    <td className="mono" style={{ color: "var(--c-red)" }}>{REASON_LABEL[p.reason] || p.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
