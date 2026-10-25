/* ============================================================
   CR-404: per-order Readiness tab (Panel + Sample order detail) — the user's
   "Order Readiness Dashboard" design on the house glass skin: a hero ring
   "N/total ready to load" + headline + four tiles, one ring per stage, and a
   table with one row per line (stage cells Done / Next step / Pending · Qty ·
   status chip). Dumb: both pages pre-compute the rows (lineStages for panel
   orders; the one "Supplied" stage for sample orders). No status chip / order
   number here — the page header already carries them (CR-390 / CR-399).
   ============================================================ */
import type { ReactNode } from "react";
import { KPI } from "@/ui/primitives";
import { Chip } from "@/ui/Chip";
import { Note } from "@/ui/States";
import { fmt } from "@/lib/format";
import type { ReadinessStage } from "./panelOrderNeeds";

export interface ReadinessRow {
  key: string;
  code: string;
  qty: number;
  stages: ReadinessStage[];
}

const DONE = "var(--accent)";
const NEXT = "var(--c-amber)";
const TODO = "var(--border-2)"; // the .bar track — glass re-skins it

/** Ring: track + arc, children centred. */
function Ring({ frac, size, width, children }: { frac: number; size: number; width: number; children: ReactNode }) {
  const r = 50 - width / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden>
        <circle cx={50} cy={50} r={r} fill="none" stroke={TODO} strokeWidth={width} />
        <circle cx={50} cy={50} r={r} fill="none" stroke={DONE} strokeWidth={width} strokeLinecap="round" strokeDasharray={`${Math.max(0, Math.min(1, frac)) * circ} ${circ}`} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>{children}</div>
    </div>
  );
}

const Legend = ({ color, label }: { color: string; label: string }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: "inline-block" }} />
    {label}
  </span>
);

export function OrderReadinessTab({ rows, noun, loadStage = "" }: { rows: ReadinessRow[]; noun: "panels" | "items"; /** name of the loading stage (panel orders) — a row is "ready to load" once every stage before it is done; omitted = a row is done once every stage is (sample orders: Supplied) */ loadStage?: string }) {
  const names = rows[0]?.stages.map((s) => s.name) ?? [];
  const preLoad = names.filter((n) => n !== loadStage);
  const total = rows.length;
  const totalPcs = rows.reduce((s, r) => s + r.qty, 0);
  const isReady = (r: ReadinessRow) => r.stages.every((s) => s.done || s.name === loadStage);
  const isLoaded = (r: ReadinessRow) => r.stages.every((s) => s.done);
  const readyCount = rows.filter(isReady).length;
  const pendingCount = total - readyCount;
  const stageDone = (n: string) => rows.filter((r) => r.stages.find((s) => s.name === n)?.done).length;
  const next = preLoad.map((n) => ({ n, done: stageDone(n) })).filter((s) => s.done < total).sort((a, b) => a.done - b.done)[0];
  const one = total === 1;
  const doneWord = loadStage ? "ready to load" : "supplied";
  const singular = noun === "panels" ? "panel" : "item";
  const headline = !total
    ? `No ${noun} on this order`
    : readyCount === total
      ? `All ${noun} ${doneWord}`
      : `${pendingCount} of ${total} ${one ? singular : noun} pending${next && names.length > 1 ? ` · next up: ${next.n}` : ""}`;
  const firstMissing = (r: ReadinessRow) => r.stages.find((s) => !s.done)?.name ?? "";
  const unit = (n: number) => (n === 1 ? singular : noun);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="card">
        <div className="card-body" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 28, alignItems: "center" }}>
          <Ring frac={total ? readyCount / total : 0} size={168} width={10}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 36, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {readyCount}
              <span className="muted" style={{ fontSize: 18, fontWeight: 600 }}>/{total}</span>
            </span>
            <span className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em" }}>{noun} {loadStage ? "ready" : "supplied"}</span>
          </Ring>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>{headline}</div>
            <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
              <KPI label={noun === "panels" ? "Panels" : "Items"} value={fmt(total)} />
              <KPI label="Pieces" value={fmt(totalPcs)} unit="pcs" />
              <KPI label={loadStage ? "Ready to load" : "Supplied"} value={fmt(readyCount)} unit={unit(readyCount)} color={DONE} />
              <KPI label="Pending" value={fmt(pendingCount)} unit={unit(pendingCount)} color={NEXT} />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><span className="title">Stage progress</span></div>
        <div className="card-body">
          <div className="stage-strip" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(110px, 1fr))` }}>
            {names.map((n) => {
              const done = stageDone(n);
              const full = total > 0 && done === total;
              return (
                <div className="stage-tile" key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <Ring frac={total ? done / total : 0} size={76} width={12}>
                    <span style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                      {done}
                      <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>/{total}</span>
                    </span>
                  </Ring>
                  <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{n}</div>
                  <div className="sub" style={{ marginTop: 0, whiteSpace: "nowrap", fontWeight: 600, color: full ? DONE : done ? NEXT : undefined }}>{full ? "Complete" : `${total - done} pending`}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="title">{noun === "panels" ? "Panels" : "Items"}</span>
          <span className="right muted" style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: "var(--t-sm)", fontWeight: 600 }}>
            <Legend color={DONE} label="Done" />
            <Legend color={NEXT} label="Next step" />
            <Legend color={TODO} label="Pending" />
          </span>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>{noun === "panels" ? "Panel" : "Item"}</th>
                <th>{names.join(" · ")}</th>
                <th className="num">Qty</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const nextIdx = r.stages.findIndex((s) => !s.done);
                return (
                  <tr key={r.key}>
                    <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{r.code}</td>
                    <td style={{ minWidth: 220 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        {r.stages.map((s, i) => (
                          <div
                            key={s.name}
                            title={s.applicable ? `${s.name} — ${s.done ? "done" : i === nextIdx ? "next step" : "pending"}` : `${s.name} — not applicable`}
                            style={{ flex: 1, height: 14, borderRadius: 5, background: s.done ? DONE : i === nextIdx ? NEXT : TODO, opacity: s.applicable ? 1 : 0.35 }}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="num">{fmt(r.qty)}</td>
                    <td>{isLoaded(r) ? <Chip tone="green" label={loadStage ? "Loaded" : "Supplied"} /> : isReady(r) ? <Chip tone="green" label="Ready" /> : <Chip tone="amber" label={names.length > 1 ? `${firstMissing(r)} pending` : "Pending"} />}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 18 }}>No {noun} on this order.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
