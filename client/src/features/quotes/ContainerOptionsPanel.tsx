/* ============================================================
   Suitable Containers (CR-262) — per size on the quote: each Container
   Master format of the size (CR-273), the quoted boxes, and how many such
   containers they need.
   On the New/Edit Quote form and the Quote detail. Not yet on print / PDF /
   share (user decision 2026-10-03 — later CR).
   ============================================================ */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { fmt } from "@/lib/format";
import { useMasters } from "@/features/masters/useMasters";
import { useContainerFormats } from "@/features/masters/containerFormatsApi";
import { containerOptions } from "./containerOptions";

export function ContainerOptionsPanel({ lines }: { lines: { item: string; qty: number }[] }) {
  const { designRows } = useMasters();
  const formats = useContainerFormats();
  const rows = useMemo(() => containerOptions(lines, designRows, formats), [lines, designRows, formats]);
  const total = rows.reduce((s, r) => s + r.containers, 0);

  if (rows.length === 0) return <div className="dim" style={{ fontSize: "var(--t-sm)" }}>Add items to see the containers they need.</div>;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Size</th>
          <th>Container</th>
          <th className="num" style={{ textAlign: "right" }}>Boxes on quote</th>
          <th className="num" style={{ textAlign: "right" }}>Per container</th>
          <th className="num" style={{ textAlign: "right" }}>Containers</th>
          <th className="num" style={{ textAlign: "right" }}>Last fill</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.sizeId || r.sizeLabel}|${r.format?.id ?? ""}`}>
            <td className="nw">{r.sizeLabel || "—"}</td>
            <td>
              {r.format ? (
                <Link className="linkish" to={`/containers/${encodeURIComponent(r.format.id)}`} onClick={(e) => e.stopPropagation()}>{r.format.name}</Link>
              ) : (
                <span style={{ color: "var(--c-amber)" }}>
                  No container format for {r.sizeLabel || "this size"} — <Link className="linkish" to="/containers/new">add one</Link>
                </span>
              )}
            </td>
            <td className="num mono">{fmt(r.boxes)}</td>
            <td className="num mono">{r.format ? `${fmt(r.format.totalPallets)} pallets = ${fmt(r.format.totalBoxes)} boxes` : "—"}</td>
            <td className="num mono" style={{ fontWeight: 600 }}>{r.format ? fmt(r.containers) : "—"}</td>
            <td className="num mono">{r.format ? `${r.lastFillPct}%` : "—"}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4} style={{ fontWeight: 600 }}>Total</td>
          <td className="num mono" style={{ fontWeight: 600 }}>{fmt(total)}</td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}
