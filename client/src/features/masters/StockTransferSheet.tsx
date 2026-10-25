/* ============================================================
   New Transfer Order (CR-330) — /stock-transfers/new. Box stock, the Zoho
   Books shape on the shared StockEntrySheet: one dated document moving N
   lines of Item · Batch · Qty (boxes) from one warehouse to another, with a
   reason. Batch cell = that item's batches with the boxes sitting in the
   From warehouse; a line beyond that is refused (server 409). Saves as a
   pair of entry_type="transfer" ProductionLog rows per line under one
   TRF/FY/NNN code. Cut-piece transfers live on /cut-stock/transfer.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { cachedBatchStock, cachedWarehouseStock, listBatchStock, warehouseStockKey, type BatchStockRow } from "@/features/stages/batchStockApi";
import { transferStock } from "@/features/stages/productionApi";
import { StockEntrySheet, type StockEntrySpec } from "@/features/common/StockEntrySheet";
import type { WhCell } from "@/lib/warehouseStock";
import { useWarehouses } from "./useWarehouses";

export function StockTransferSheet() {
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [stock, setStock] = useState<BatchStockRow[]>(() => cachedBatchStock() ?? []);
  const [cells, setCells] = useState<WhCell[]>(() => cachedWarehouseStock());
  const { enabled } = useWarehouses();
  useEffect(() => {
    void listDesigns().then((r) => r.ok && setDesigns(r.designs));
    void listBatchStock().then((r) => { if (r.ok) { setStock(r.rows); setCells(r.byWarehouse); } });
  }, []);

  const spec = useMemo<StockEntrySpec>(() => {
    const byId = new Map(designs.map((d) => [d.id, d]));
    const batchesOf = new Map<string, BatchStockRow[]>();
    for (const r of stock) (batchesOf.get(r.designId) ?? batchesOf.set(r.designId, []).get(r.designId)!).push(r);
    const atWh = (designId: string, batch: string, wh: string) =>
      cells.find((c) => c.key === warehouseStockKey(designId, batch) && c.warehouseId === wh)?.onHand ?? 0;
    return {
      title: "New Transfer Order",
      kind: "transfer",
      unit: "boxes",
      dateLabel: "Transfer date",
      warehouse: "pair",
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
            .map((r) => ({ value: r.batchNumber, label: r.batchNumber, hint: h.from ? `${fmt(atWh(designId, r.batchNumber, h.from))} in From` : `${fmt(r.current)} on hand` })),
        disabledFor: (designId) => !byId.get(designId)?.isBatched,
      },
      warnFor: (l, h) => {
        if (!h.from) return undefined;
        const have = atWh(l.design, byId.get(l.design)?.isBatched ? l.second : "", h.from);
        return l.qty > have ? `Only ${fmt(have)} boxes at the From location — this line will be refused` : undefined;
      },
      onSave: async (h, lines) => {
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
      backTo: "/stock-transfers",
      columnsKey: "stockTransferSheetColumns",
    };
  }, [designs, stock, cells]);

  if (!can("items", "edit")) return <EmptyState title="No access" hint="You don't have permission for this" />;
  if (!enabled) return <EmptyState icon="package" title="No warehouses yet" hint="Add a warehouse and its locations under Settings ▸ Warehouses & Locations before transferring stock" />;
  return <StockEntrySheet spec={spec} />;
}
