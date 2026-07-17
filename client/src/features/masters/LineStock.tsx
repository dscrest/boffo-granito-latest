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
import { designStock, type DesignStock } from "@/lib/stock";
import { fmt } from "@/lib/format";

/** Loads orders + production log once and returns a per-design stock lookup.
    Call once per form; pass the returned fn a design NAME (the stored key). */
export function useStockLookup(): (designName: string) => DesignStock {
  const { orders } = useOrders();
  const { designRows } = useMasters();
  const [prodLogs, setProdLogs] = useState<ProductionEntry[]>(() => cachedProductionLogs() ?? []);
  useEffect(() => {
    void listProductionLogs().then((r) => r.ok && setProdLogs(r.entries));
  }, []);
  return (designName: string) => {
    const opening = designRows.find((d) => d.designName === designName)?.accountingStock ?? 0;
    return designStock(designName, { openingStock: opening, orders, prodLogs });
  };
}

/** green = enough available; yellow = needs production; red = needs a lot. */
function signalColor(qty: number, s: DesignStock): string {
  if (qty <= s.available) return "var(--c-green)";
  if (qty <= s.available + s.inProduction) return "var(--c-amber)";
  return "var(--c-red)";
}

function Cell({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.2 }}>
      <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{label}</span>
      <span className="mono" style={{ color }}>{fmt(value)}</span>
    </span>
  );
}

export function LineStock({ stock, qty }: { stock: DesignStock; qty: number }) {
  const color = signalColor(qty, stock);
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginTop: 2 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} title="Stock signal" />
      <Cell label="Qty" value={qty} />
      <Cell label="In production" value={stock.inProduction} />
      <Cell label="Available" value={stock.available} color={color} />
      <Cell label="In loading" value={stock.inLoading} />
    </div>
  );
}
