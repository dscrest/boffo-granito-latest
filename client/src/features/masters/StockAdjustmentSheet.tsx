/* ============================================================
   New Stock Adjustment (CR-308, CR-446, CR-457) — /stock-adjustments/new. Box
   stock on the shared StockAdjustForm (Zoho Books shape): header Mode · Date ·
   Reason · Description over an Item Table (Item · Batch · Location · Available
   · New on hand · signed Qty · Remark). Batch cell = that item's batches with
   on-hand / free (batch-tracked items); singular items have no batch. A removal
   may dip below what sales orders reserved (warning), never below physical
   on-hand (server 409). Quantity mode saves signed entry_type="adjust"
   ProductionLog rows (header date + reason on each); Location Transfer mode
   (CR-458) posts ONE Transfer Order From → To via /stock-transfer.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { cachedBatchStock, cachedWarehouseStock, listBatchStock, warehouseStockKey, type BatchStockRow } from "@/features/stages/batchStockApi";
import type { WhCell } from "@/lib/warehouseStock";
import { adjustStock, transferStock } from "@/features/stages/productionApi";
import { StockAdjustForm, type StockAdjustSpec } from "@/features/common/StockAdjustForm";

export function StockAdjustmentSheet() {
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [stock, setStock] = useState<BatchStockRow[]>(() => cachedBatchStock() ?? []);
  const [cells, setCells] = useState<WhCell[]>(() => cachedWarehouseStock());
  useEffect(() => {
    void listDesigns().then((r) => r.ok && setDesigns(r.designs));
    void listBatchStock().then((r) => { if (r.ok) { setStock(r.rows); setCells(r.byWarehouse); } });
  }, []);

  const spec = useMemo<StockAdjustSpec>(() => {
    const byId = new Map(designs.map((d) => [d.id, d]));
    const batchesOf = new Map<string, BatchStockRow[]>();
    for (const r of stock) (batchesOf.get(r.designId) ?? batchesOf.set(r.designId, []).get(r.designId)!).push(r);
    const rowFor = (designId: string, batch: string) => batchesOf.get(designId)?.find((r) => r.batchNumber === batch);
    // CR-329: on-hand in the picked warehouse (falls back to the batch total while dormant).
    const atWh = (designId: string, batch: string, wh: string) =>
      wh ? cells.find((c) => c.key === warehouseStockKey(designId, batch) && c.warehouseId === wh)?.onHand ?? 0 : rowFor(designId, batch)?.current ?? 0;
    const batchOf = (designId: string, second: string) => (byId.get(designId)?.isBatched ? second : "");
    return {
      title: "New Stock Adjustment",
      unit: "boxes",
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
      onHand: (designId, second, wh) => atWh(designId, batchOf(designId, second), wh),
      warnFor: (l, h) => {
        if (l.qty >= 0) return undefined;
        const batch = batchOf(l.design, l.second);
        const r = rowFor(l.design, batch);
        const have = atWh(l.design, batch, h.warehouse);
        if (-l.qty > have) return `Only ${fmt(have)} boxes on hand${h.warehouse ? " at this location" : ""} — this line will be refused`;
        const reserved = r ? r.current - r.free : 0;
        return r && -l.qty > r.free ? `${fmt(Math.min(reserved, -l.qty - r.free))} of these boxes are reserved by sales orders` : undefined;
      },
      onSave: async (lines) => {
        const res = await adjustStock({
          lines: lines.map((l) => ({ design: l.design, batch_number: l.second || undefined, qty_boxes: l.qty, note: l.note || undefined, warehouse: l.warehouse || undefined, date: l.date, reason: l.reason })),
        });
        return { ok: res.ok, error: res.error };
      },
      // CR-458: the same body the bulk Transfer sheet sends — one TRF document.
      onTransfer: async (h, lines) => {
        const res = await transferStock({
          date: h.date,
          from_warehouse: h.from,
          to_warehouse: h.to,
          reason: h.reason,
          note: h.note || undefined,
          lines: lines.map((l) => ({ design: l.design, batch_number: l.second || undefined, qty_boxes: l.qty, note: l.note || undefined })),
        });
        return { ok: res.ok, error: res.error };
      },
      backTo: "/stock-adjustments",
    };
  }, [designs, stock, cells]);

  if (!can("items", "edit")) return <EmptyState title="No access" hint="You don't have permission for this" />;
  return <StockAdjustForm spec={spec} />;
}
