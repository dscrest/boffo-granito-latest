/* ============================================================
   To Produce (CR-200, production-first) — what the factory should make.
   SO confirm no longer creates production jobs; this view derives the need
   instead: per item, the open orders' unallocated boxes against free stock
   and what is already in production (lib/needProduction demandByDesign).
   The waiting orders' Box Brand rides along, so the floor knows which
   carton to pack in. Tick rows → "Start New Production" prefills the job.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { EmptyState } from "@/ui/States";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { fmt } from "@/lib/format";
import { demandByDesign, type DemandRow } from "@/lib/needProduction";
import { useOrders } from "@/features/orders/useOrders";
import { useMasters } from "@/features/masters/useMasters";
import { useStockLookup } from "@/features/masters/LineStock";
import { useBoxBrands } from "@/features/masters/boxBrands";
import { TotalsRow } from "@/features/reports/ReportShell";

export function ToProduce({
  query,
  canEdit,
  onProduce,
}: {
  query: string;
  canEdit: boolean;
  onProduce: (lines: { design: string; qty: number }[]) => void;
}) {
  const { orders } = useOrders();
  const { designRows } = useMasters();
  const stockFor = useStockLookup();
  const { brands } = useBoxBrands();
  const [shortOnly, setShortOnly] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stockFor is a fresh closure over the same loaded lists each render
  const all = useMemo(() => demandByDesign(orders, stockFor), [orders, stockFor]);
  const designOf = (name: string) => designRows.find((d) => d.designName === name);
  // Name from the orders join first — this view's own Brand fetch can fail
  // (it has no retry), which used to read a branded order as "No brand".
  const brandsLabel = (r: DemandRow) =>
    r.brands
      .map((b) => `${b.label || brands.find((x) => x._id === b.boxBrandId)?.name || (b.boxBrandId ? "—" : "No brand")} ${fmt(b.need)}`)
      .join(" · ");

  const q = query.trim().toLowerCase();
  const rows = all.filter((r) => (!shortOnly || r.shortfall > 0) && (!q || r.designName.toLowerCase().includes(q)));
  const sort = useSortRows<DemandRow>(rows, (r, k) => (k === "item" ? r.designName : (r as unknown as Record<string, unknown>)[k]), "shortfall", -1);
  const pager = usePagination(sort.sorted.length, "production.demand.pageSize", `${q}|${shortOnly}`);
  const sum = (k: "openDemand" | "free" | "inProduction" | "shortfall") => rows.reduce((s, r) => s + r[k], 0);

  const selectable = rows.filter((r) => r.shortfall > 0 && designOf(r.designName));
  const chosen = selectable.filter((r) => picked.has(r.designName));
  const toggle = (name: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--t-sm)", cursor: "pointer" }}>
          <input type="checkbox" checked={shortOnly} onChange={(e) => setShortOnly(e.target.checked)} style={{ margin: 0 }} />
          Only items that need production
        </label>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <button
            className="hbtn primary"
            disabled={chosen.length === 0}
            onClick={() => onProduce(chosen.map((r) => ({ design: designOf(r.designName)!.id, qty: r.shortfall })))}
          >
            <Icon name="plus" size={13} /> Start New Production{chosen.length ? ` · ${chosen.length}` : ""}
          </button>
        )}
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={selectable.length > 0 && chosen.length === selectable.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(selectable.map((r) => r.designName)) : new Set())}
                  style={{ margin: 0 }}
                />
              </th>
              <SortTh id="item" label="Item" sort={sort} />
              <th>Size</th>
              <th>Box Brand wanted</th>
              <SortTh id="orders" label="Orders" sort={sort} className="num" style={{ textAlign: "right" }} />
              <SortTh id="openDemand" label="To allocate" sort={sort} className="num" style={{ textAlign: "right" }} />
              <SortTh id="free" label="Free stock" sort={sort} className="num" style={{ textAlign: "right" }} />
              <SortTh id="inProduction" label="In production" sort={sort} className="num" style={{ textAlign: "right" }} />
              <SortTh id="shortfall" label="Need production" sort={sort} className="num" style={{ textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {pager.slice(sort.sorted).map((r) => {
              const d = designOf(r.designName);
              return (
                <tr key={r.designName} onClick={() => r.shortfall > 0 && d && toggle(r.designName)} style={{ cursor: r.shortfall > 0 && d ? "pointer" : undefined }}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.designName}`}
                      checked={picked.has(r.designName)}
                      disabled={!(r.shortfall > 0 && d)}
                      onChange={() => toggle(r.designName)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ margin: 0 }}
                    />
                  </td>
                  <td className="nw"><span className="design-name">{d?.uniqueName || r.designName}</span></td>
                  <td className="nw dim">{d?.sizeLabel || "—"}</td>
                  <td className="nw"><span className="clip" title={brandsLabel(r)}>{brandsLabel(r) || "—"}</span></td>
                  <td className="num mono">{fmt(r.orders)}</td>
                  <td className="num mono">{fmt(r.openDemand)}</td>
                  <td className="num mono" style={{ color: r.free > 0 ? "var(--c-green)" : undefined }}>{fmt(r.free)}</td>
                  <td className="num mono" style={{ color: r.inProduction > 0 ? "var(--c-amber)" : undefined }}>{fmt(r.inProduction)}</td>
                  <td className="num mono" style={{ fontWeight: 600, color: r.shortfall > 0 ? "var(--c-red)" : "var(--c-green)" }}>{fmt(r.shortfall)}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <TotalsRow>
              <td />
              <td colSpan={4}>Total · {rows.length} item{rows.length === 1 ? "" : "s"}</td>
              <td className="num mono">{fmt(sum("openDemand"))}</td>
              <td className="num mono">{fmt(sum("free"))}</td>
              <td className="num mono">{fmt(sum("inProduction"))}</td>
              <td className="num mono">{fmt(sum("shortfall"))}</td>
            </TotalsRow>
          )}
        </table>
        {rows.length === 0 && (
          <EmptyState icon="factory" title={shortOnly ? "Nothing to produce" : "No open demand"} hint={shortOnly ? "Free stock and running production cover every open order." : "No confirmed order is waiting for stock."} />
        )}
      </div>
      <GridFooter {...pager} />
    </div>
  );
}
