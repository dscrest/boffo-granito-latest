/* ============================================================
   Shared per-line stock strip for transaction forms (Sales Order / Quote /
   Production). Shows Qty · In production · Available · In loading with a
   green/yellow/red signal so the user can gauge production/delivery at a glance.
   One derivation basis (lib/stock.ts) across every form.
   ============================================================ */
import { useEffect, useState } from "react";
import { useOrders } from "@/features/orders/useOrders";
import { useMasters } from "@/features/masters/useMasters";
import { cachedProductionLogs, listProductionLogs, type ProductionEntry } from "@/features/stages/productionApi";
import { cachedOpeningByDesign, listBatchStock } from "@/features/stages/batchStockApi";
import { designStock, openingStockFor, type DesignStock } from "@/lib/stock";
import { fmt } from "@/lib/format";
import { InProductionModal } from "@/features/stages/InProductionModal";

/** Loads orders + production log once and returns a per-design stock lookup.
    Call once per form; pass the returned fn a design NAME (the stored key). */
export function useStockLookup(): (designName: string) => DesignStock {
  const { orders } = useOrders();
  const { designRows } = useMasters();
  const [prodLogs, setProdLogs] = useState<ProductionEntry[]>(() => cachedProductionLogs() ?? []);
  const [openingByDesign, setOpeningByDesign] = useState<Map<string, number>>(() => cachedOpeningByDesign());
  useEffect(() => {
    void listProductionLogs().then((r) => r.ok && setProdLogs(r.entries));
    void listBatchStock().then((r) => r.ok && setOpeningByDesign(r.openingByDesign));
  }, []);
  return (designName: string) => {
    const d = designRows.find((dr) => dr.designName === designName);
    const opening = openingStockFor(d, openingByDesign);
    return designStock(designName, { openingStock: opening, orders, prodLogs });
  };
}

/** green = enough available; yellow = needs production; red = needs a lot. */
export function signalColor(qty: number, s: DesignStock): string {
  if (qty <= s.available) return "var(--c-green)";
  if (qty <= s.available + s.inProduction) return "var(--c-amber)";
  return "var(--c-red)";
}

function Cell({ label, value, color, onClick }: { label: string; value: number; color?: string; onClick?: () => void }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.2 }}>
      <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{label}</span>
      {onClick ? (
        <button
          type="button"
          className="linkish mono"
          onClick={onClick}
          title="See which orders have this design in production"
          style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", color, textAlign: "left" }}
        >
          {fmt(value)}
        </button>
      ) : (
        <span className="mono" style={{ color }}>{fmt(value)}</span>
      )}
    </span>
  );
}

export function LineStock({ stock, qty, label }: { stock: DesignStock; qty: number; label?: string }) {
  const color = signalColor(qty, stock);
  const [ip, setIp] = useState(false);
  const canDrill = !!label && stock.inProduction > 0;
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginTop: 2 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} title="Stock signal" />
      <Cell label="Qty" value={qty} />
      <Cell label="In production" value={stock.inProduction} onClick={canDrill ? () => setIp(true) : undefined} />
      <Cell label="Available" value={stock.available} color={color} />
      <Cell label="In loading" value={stock.inLoading} />
      {ip && label && (
        <InProductionModal label={label} total={stock.inProduction} orders={stock.inProductionOrders} onClose={() => setIp(false)} />
      )}
    </div>
  );
}

/** Compact in-front variant: traffic-light dot only, so it doesn't break line
    alignment. Click the dot to reveal available + in-production in a small
    popup; it closes on mouse-leave. Color reflects line qty vs stock
    (green covered / amber needs production / red short). SO screen only. */
export function LineStockChip({ stock, qty, label }: { stock: DesignStock; qty: number; label?: string }) {
  const color = signalColor(qty, stock);
  const [open, setOpen] = useState(false);
  const [ip, setIp] = useState(false);
  const canDrill = !!label && stock.inProduction > 0;
  return (
    <span style={{ position: "relative", flexShrink: 0, display: "inline-flex" }} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Show available stock"
        style={{ padding: 4, background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
      >
        <span className="dot" style={{ width: 10, height: 10, background: color }} />
      </button>
      {open && (
        <span
          style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 70,
            background: "var(--panel)", border: "1px solid var(--border-2)", borderRadius: 6,
            padding: "6px 10px", boxShadow: "var(--shadow, 0 4px 12px rgba(0,0,0,0.15))",
            display: "flex", flexDirection: "column", gap: 2, whiteSpace: "nowrap",
          }}
        >
          <span style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span className="dim" style={{ fontSize: "var(--t-sm)" }}>Available</span>
            <span className="mono" style={{ color }}>{fmt(stock.available)}</span>
          </span>
          <span style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span className="dim" style={{ fontSize: "var(--t-sm)" }}>In production</span>
            {canDrill ? (
              <button
                type="button"
                className="linkish mono"
                onClick={() => { setIp(true); setOpen(false); }}
                title="See which orders have this design in production"
                style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
              >
                {fmt(stock.inProduction)}
              </button>
            ) : (
              <span className="mono">{fmt(stock.inProduction)}</span>
            )}
          </span>
        </span>
      )}
      {ip && label && (
        <InProductionModal label={label} total={stock.inProduction} orders={stock.inProductionOrders} onClose={() => setIp(false)} />
      )}
    </span>
  );
}
