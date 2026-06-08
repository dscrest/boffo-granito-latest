/* ============================================================
   Quality Control — one stage between Production and Pallet Packing,
   with two inspection passes per the Export Tracker reference:
     · Pre-Pallet QC  — line items produced, before palletizing
     · Post-Pallet QC — palletized pallets, before loading/dispatch
   Each line item runs a QC checklist template (pass/fail/pending);
   results held in local state (frontend-only). Reuses tbl/kpi CSS.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { KPI, StageBadge } from "@/ui/primitives";
import { finishClass } from "@/lib/format";
import { ORDERS, type Order } from "@/data";

/* QC checklist templates — the per-pass set of checks each line runs through. */
const PRE_CHECKS = ["Shade Match", "Size Calibration", "Surface Defects", "Thickness"];
const POST_CHECKS = ["Pallet Count", "Strapping", "Labeling", "Moisture Wrap"];

type Verdict = "pending" | "pass" | "fail";
const NEXT: Record<Verdict, Verdict> = { pending: "pass", pass: "fail", fail: "pending" };
const VERDICT_SYM: Record<Verdict, string> = { pending: "—", pass: "✓", fail: "✕" };

type ResultMap = Record<string, Record<string, Verdict>>; // orderId -> check -> verdict

function rowVerdict(checks: string[], r: Record<string, Verdict> | undefined): Verdict {
  if (!r) return "pending";
  const vals = checks.map((c) => r[c] || "pending");
  if (vals.some((v) => v === "fail")) return "fail";
  if (vals.every((v) => v === "pass")) return "pass";
  return "pending";
}

function QCSection({
  title,
  hint,
  items,
  checks,
  results,
  onCycle,
}: {
  title: string;
  hint: string;
  items: Order[];
  checks: string[];
  results: ResultMap;
  onCycle: (orderId: string, check: string) => void;
}) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-head">
        <Icon name="shield-check" size={13} className="ic" />
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span className="muted">· {items.length} line items · {hint}</span>
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Design</th>
              <th>Size</th>
              <th>Finish</th>
              <th>Party</th>
              <th>PO</th>
              {checks.map((c) => (
                <th key={c} style={{ textAlign: "center" }}>{c}</th>
              ))}
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => {
              const r = results[o.id];
              const verdict = rowVerdict(checks, r);
              return (
                <tr key={o.id}>
                  <td><span className="design-name">{o.design}</span></td>
                  <td>
                    <span className={`chip size ${o.size.startsWith("200") || o.size.startsWith("75") ? "b" : ""}`}>{o.size}</span>
                  </td>
                  <td><span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span></td>
                  <td>{o.flag} {o.party}</td>
                  <td className="mono">{o.poNumber}</td>
                  {checks.map((c) => {
                    const v = (r && r[c]) || "pending";
                    return (
                      <td key={c} style={{ textAlign: "center" }}>
                        <button className={`qc-cell ${v}`} onClick={() => onCycle(o.id, c)} title={`${c}: ${v}`}>
                          {VERDICT_SYM[v]}
                        </button>
                      </td>
                    );
                  })}
                  <td>
                    <span className={`chip qc-verdict ${verdict}`}>
                      {verdict === "pass" ? "Passed" : verdict === "fail" ? "Failed" : "Pending"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={5 + checks.length + 1} className="muted" style={{ textAlign: "center", padding: 16 }}>
                  No line items awaiting this check.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function QC() {
  const [results, setResults] = useState<ResultMap>({});
  const cycle = (orderId: string, check: string) =>
    setResults((p) => {
      const row = { ...(p[orderId] || {}) };
      row[check] = NEXT[row[check] || "pending"];
      return { ...p, [orderId]: row };
    });

  // Pre-pallet: produced, awaiting QC before packing. Post-pallet: palletized.
  const preItems = useMemo(() => ORDERS.filter((o) => o.stage === "qc"), []);
  const postItems = useMemo(() => ORDERS.filter((o) => o.stage === "packing").slice(0, 8), []);
  const allItems = [...preItems, ...postItems];

  const passed = allItems.filter(
    (o) =>
      rowVerdict(preItems.includes(o) ? PRE_CHECKS : POST_CHECKS, results[o.id]) === "pass",
  ).length;
  const failed = allItems.filter(
    (o) => rowVerdict(preItems.includes(o) ? PRE_CHECKS : POST_CHECKS, results[o.id]) === "fail",
  ).length;
  const pending = allItems.length - passed - failed;
  const passRate = allItems.length ? Math.round((passed / allItems.length) * 100) : 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Quality Control</div>
          <div className="sub">
            <StageBadge stage="qc" /> · pre &amp; post-pallet inspection · {allItems.length} line items in queue
          </div>
        </div>
        <div className="right">
          <button className="hbtn">
            <Icon name="download" size={13} />
            QC report
          </button>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KPI label="Pass Rate" value={String(passRate)} unit="%" delta={`${passed} cleared`} trend="up" spark={[6, 7, 8, 8, 9, 9, 10]} color="var(--c-green)" />
        <KPI label="Pending" value={String(pending)} delta="awaiting inspection" spark={[10, 9, 9, 8, 7, 7, 6]} color="var(--c-amber)" />
        <KPI label="Failed" value={String(failed)} delta="needs rework" spark={[1, 2, 1, 2, 1, 1, 2]} color="var(--c-red)" />
        <KPI label="In Queue" value={String(allItems.length)} delta="pre + post pallet" spark={[8, 9, 10, 9, 11, 10, 12]} color="var(--c-blue)" />
      </div>

      <div className="sec-title" style={{ marginTop: 14 }}>
        <h2>Inspection queue</h2>
        <span className="meta">Click a cell to cycle pending → pass → fail</span>
      </div>

      <QCSection
        title="Pre-Pallet QC"
        hint="produced, before palletizing"
        items={preItems}
        checks={PRE_CHECKS}
        results={results}
        onCycle={cycle}
      />
      <QCSection
        title="Post-Pallet QC"
        hint="palletized, before loading"
        items={postItems}
        checks={POST_CHECKS}
        results={results}
        onCycle={cycle}
      />
    </div>
  );
}
