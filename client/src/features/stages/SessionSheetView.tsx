/* ============================================================
   Loading Session · step 1 — Sheet view (trial, beside the customer-rail
   view; the user flips between them, SessionItemsStep owns the choice).
   Every open order of the customer in ONE grid: a band row per Sales
   Order, one row per batch, "Qty to load" the only typed cell, pallets +
   container share recalculating beside it, totals in the footer.
   Render-only — selection state and Save stay in SessionItemsStep.
   ============================================================ */
import type { KeyboardEvent, ReactNode } from "react";
import { fmt } from "@/lib/format";
import { openLines, type DesignRow, type SoBand } from "./newLoadingRows";
import type { PalPlanLine } from "./palPlansApi";

const palletsOf = (l: PalPlanLine, q: number) => (q > 0 && l.boxesPerPallet > 0 ? Math.ceil(q / l.boxesPerPallet) : 0);
const shareOf = (l: PalPlanLine, q: number) => (q > 0 && l.palletCapacity > 0 ? q / l.palletCapacity : 0);
const pct = (f: number) => (f > 0 ? `${Math.round(f * 100)}%` : "—");

// Enter / ↓ / ↑ walk the Qty column like a spreadsheet.
export const walk = (e: KeyboardEvent<HTMLTableSectionElement>) => {
  const step = e.key === "Enter" || e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  if (!step || !(e.target instanceof HTMLInputElement)) return;
  const cells = [...e.currentTarget.querySelectorAll<HTMLInputElement>("input:not(:disabled)")];
  const next = cells[cells.indexOf(e.target) + step];
  if (!next) return;
  e.preventDefault();
  next.focus();
  next.select();
};

export function SessionSheetView({
  bands,
  qty,
  brandName,
  hasPlan,
  onFillFromPlan,
  onSetDesign,
  qtyCell,
}: {
  bands: SoBand[];
  qty: Map<string, number>;
  brandName: (id: string) => string;
  hasPlan: (salesOrderId: string) => boolean;
  onFillFromPlan: (band: SoBand) => void;
  onSetDesign: (row: DesignRow, v: number) => void;
  qtyCell: (l: PalPlanLine, label: string) => ReactNode;
}) {
  const q = (l: PalPlanLine) => qty.get(l.id) || 0;
  const sum = (ls: PalPlanLine[]) => ({
    boxes: ls.reduce((s, l) => s + q(l), 0),
    pallets: ls.reduce((s, l) => s + palletsOf(l, q(l)), 0),
    share: ls.reduce((s, l) => s + shareOf(l, q(l)), 0),
  });
  const total = sum(bands.flatMap((b) => b.designs.flatMap(openLines)));
  let n = 0;

  return (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: 36 }}>#</th>
          <th>SO No.</th>
          <th>Design</th>
          <th>Box Brand</th>
          <th>Batch</th>
          <th>Pallet type</th>
          <th className="num" style={{ textAlign: "right" }}>Ready</th>
          <th className="num" style={{ textAlign: "right" }}>Qty to load</th>
          <th className="num" style={{ textAlign: "right" }}>Pallets</th>
          <th className="num" style={{ textAlign: "right" }}>Container %</th>
        </tr>
      </thead>
      <tbody onKeyDown={walk}>
        {bands.map((band) => {
          const sub = sum(band.designs.flatMap(openLines));
          const ready = band.designs.reduce((s, r) => s + r.ready, 0);
          return [
            <tr key={band.salesOrderId} style={{ background: "var(--accent-soft)", color: "var(--accent-ink)", fontWeight: 700 }}>
              <td />
              <td className="mono nw">{band.soNumber}</td>
              <td colSpan={4}>
                <span style={{ display: "inline-flex", gap: 6 }}>
                  {hasPlan(band.salesOrderId) && <button className="btn" onClick={() => onFillFromPlan(band)}>Fill from plan</button>}
                  {ready > 0 && <button className="btn" onClick={() => band.designs.forEach((r) => onSetDesign(r, r.ready))}>Load all ready</button>}
                </span>
              </td>
              <td className="num mono">{fmt(ready)}</td>
              <td className="num mono">{sub.boxes > 0 ? fmt(sub.boxes) : "—"}</td>
              <td className="num mono">{sub.pallets > 0 ? fmt(sub.pallets) : "—"}</td>
              <td className="num mono">{pct(sub.share)}</td>
            </tr>,
            ...band.designs.flatMap((row) =>
              row.lines.map(({ line: l, blocked }) => {
                n += 1;
                return (
                  <tr key={l.id} style={blocked ? { opacity: 0.55 } : q(l) > 0 ? { background: "var(--accent-soft)" } : undefined}>
                    <td className="mono dim">{n}</td>
                    <td className="mono dim nw">{band.soNumber}</td>
                    <td><span className="design-name">{row.designLabel}</span></td>
                    <td className="nw">{brandName(row.brandId) || "—"}</td>
                    <td className="mono nw">{l.batchNumber || "—"}</td>
                    <td className="nw">{l.palletName || "—"}</td>
                    {blocked ? (
                      <td colSpan={4} className="num dim nw">{fmt(blocked.done)}/{fmt(blocked.total)} palletized — not loadable yet</td>
                    ) : (
                      <>
                        <td className="num mono">{fmt(l.boxes)}</td>
                        <td className="num">{qtyCell(l, `Boxes to load, ${band.soNumber} ${row.designLabel} batch ${l.batchNumber || "—"}`)}</td>
                        <td className="num mono">{palletsOf(l, q(l)) || "—"}</td>
                        <td className="num mono">{pct(shareOf(l, q(l)))}</td>
                      </>
                    )}
                  </tr>
                );
              }),
            ),
          ];
        })}
      </tbody>
      <tfoot>
        <tr style={{ fontWeight: 600 }}>
          <td colSpan={7} style={{ textAlign: "right" }}>Total</td>
          <td className="num mono">{fmt(total.boxes)}</td>
          <td className="num mono">{fmt(total.pallets)}</td>
          <td className="num mono">{pct(total.share)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
