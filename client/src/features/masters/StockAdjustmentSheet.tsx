/* ============================================================
   New Stock Adjustment (CR-308) — /stock-adjustments/new. Box stock, the
   Zoho Books shape on the shared StockEntrySheet: one dated submission
   with a reason, N lines of Item · Batch · Add/Remove · Qty (boxes).
   Batch cell = that item's batches with on-hand / free (batch-tracked
   items); singular items have no batch. A removal may dip below what
   sales orders reserved (warning), never below physical on-hand (server
   409). Saves as signed entry_type="adjust" ProductionLog rows.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { cachedBatchStock, cachedWarehouseStock, listBatchStock, warehouseStockKey, type BatchStockRow } from "@/features/stages/batchStockApi";
import type { WhCell } from "@/lib/warehouseStock";
import { adjustStock } from "@/features/stages/productionApi";
import { StockEntrySheet, type StockEntrySpec } from "@/features/common/StockEntrySheet";

export function StockAdjustmentSheet() {
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [stock, setStock] = useState<BatchStockRow[]>(() => cachedBatchStock() ?? []);
  const [cells, setCells] = useState<WhCell[]>(() => cachedWarehouseStock());
  useEffect(() => {
    void listDesigns().then((r) => r.ok && setDesigns(r.designs));
    void listBatchStock().then((r) => { if (r.ok) { setStock(r.rows); setCells(r.byWarehouse); } });
  }, []);

  const spec = useMemo<StockEntrySpec>(() => {
    const byId = new Map(designs.map((d) => [d.id, d]));
    const batchesOf = new Map<string, BatchStockRow[]>();
    for (const r of stock) (batchesOf.get(r.designId) ?? batchesOf.set(r.designId, []).get(r.designId)!).push(r);
    const rowFor = (designId: string, batch: string) => batchesOf.get(designId)?.find((r) => r.batchNumber === batch);
    // CR-329: on-hand in the picked warehouse (falls back to the batch total while dormant).
    const atWh = (designId: string, batch: string, wh: string) =>
      wh ? cells.find((c) => c.key === warehouseStockKey(designId, batch) && c.warehouseId === wh)?.onHand ?? 0 : rowFor(designId, batch)?.current ?? 0;
    return {
      title: "New Stock Adjustment",
      kind: "adjustment",
      unit: "boxes",
      dateLabel: "Adjustment date",
      warehouse: "single",
      items: designs
        .filter((d) => d.status !== "Inactive" && d.status !== "Discontinued")
        .map((d) => ({ id: d.id, sku: d.sku, uniqueName: d.uniqueName, designName: d.designName, hint: [d.sizeLabel, d.finishLabel].filter(Boolean).join(" · ") || undefined })),
      second: {
        label: "Batch",
        required: false,
        placeholder: "Batch (blank = unbatched)",
        optionsFor: (designId, h) =>
          (batchesOf.get(designId) ?? [])
            .filter((r) => r.batchNumber)
            .map((r) => ({ value: r.batchNumber, label: r.batchNumber, hint: h.warehouse ? `${fmt(atWh(designId, r.batchNumber, h.warehouse))} here · ${fmt(r.free)} free` : `${fmt(r.current)} on hand · ${fmt(r.free)} free` })),
        // A batch nobody has produced yet (count found extra boxes) — the typed number is the value.
        onCreate: async (_designId, text) => text.trim() || undefined,
        disabledFor: (designId) => !byId.get(designId)?.isBatched,
      },
      warnFor: (l, h) => {
        if (l.qty >= 0) return undefined;
        const batch = byId.get(l.design)?.isBatched ? l.second : "";
        const r = rowFor(l.design, batch);
        const have = atWh(l.design, batch, h.warehouse);
        if (-l.qty > have) return `Only ${fmt(have)} boxes on hand${h.warehouse ? " in this warehouse" : ""} — this line will be refused`;
        const reserved = r ? r.current - r.free : 0;
        return r && -l.qty > r.free ? `${fmt(Math.min(reserved, -l.qty - r.free))} of these boxes are reserved by sales orders` : undefined;
      },
      onSave: async (h, lines) => {
        const res = await adjustStock({
          date: h.date,
          reason: h.reason,
          note: h.note || undefined,
          warehouse: h.warehouse || undefined,
          lines: lines.map((l) => ({ design: l.design, batch_number: l.second || undefined, qty_boxes: l.qty, note: l.note || undefined, warehouse: l.warehouse || undefined })),
        });
        return { ok: res.ok, error: res.error };
      },
      backTo: "/stock-adjustments",
      columnsKey: "stockAdjustSheetColumns",
    };
  }, [designs, stock, cells]);

  if (!can("items", "edit")) return <EmptyState title="No access" hint="You don't have permission for this" />;
  return <StockEntrySheet spec={spec} />;
}
