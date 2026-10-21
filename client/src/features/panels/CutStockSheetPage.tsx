/* ============================================================
   Cut Stock bulk sheets (CR-307/308/330) on the shared StockEntrySheet:
     /cut-stock/record   → Add Cut Stock   (receipt: Item · Cut Piece Size · Qty)
     /cut-stock/adjust   → Adjust Cut Stock (signed, reason mandatory)
     /cut-stock/transfer → Transfer Cut Stock (CR-330: From / To warehouse, reason)
   Items = the Panel Items (designs with at least one cut-piece row); the
   Cut Piece Size cell lists that item's cut pieces only — new pieces are
   defined on /panel-items first (CR-306). CR-329: receipt / adjust carry a
   Warehouse picker; hints show the pieces in the picked (From) warehouse.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { StockEntrySheet, type StockEntrySpec } from "@/features/common/StockEntrySheet";
import { useWarehouses } from "@/features/masters/useWarehouses";
import { cachedCutSizes, listPanels, type CutSizeOption } from "./panelsApi";
import { cachedCutStockRows, cutWarehouseCells, listCutStock, listCutStockEntries, postCutStockEntry, type CutStockEntryRow, type CutStockRow } from "./panelOrdersApi";

export function CutStockSheetPage({ kind }: { kind: "receipt" | "adjustment" | "transfer" }) {
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [stockRows, setStockRows] = useState<CutStockRow[]>(() => cachedCutStockRows() ?? []);
  const [entries, setEntries] = useState<CutStockEntryRow[]>([]);
  const { warehouses } = useWarehouses();

  useEffect(() => {
    void listDesigns().then((r) => r.ok && setDesigns(r.designs));
    void listPanels().then((r) => r.ok && setCutSizes(r.cutSizes));
    void listCutStock().then((r) => r.ok && setStockRows(r.rows));
    void listCutStockEntries().then((r) => r.ok && setEntries(r.rows));
  }, []);

  const transferring = kind === "transfer";
  const spec = useMemo<StockEntrySpec>(() => {
    const cutName = new Map(cutSizes.map((c) => [c.id, c.label]));
    const piecesByDesign = new Map<string, CutStockRow[]>();
    for (const r of stockRows) (piecesByDesign.get(r.designId) ?? piecesByDesign.set(r.designId, []).get(r.designId)!).push(r);
    const items = designs
      .filter((d) => piecesByDesign.has(d.id))
      .map((d) => ({ id: d.id, sku: d.sku, uniqueName: d.uniqueName, designName: d.designName, hint: d.sizeLabel || undefined }));
    // CR-329: pieces per warehouse (dormant → the plain on-hand).
    const cells = warehouses.length ? cutWarehouseCells(warehouses, entries, stockRows) : [];
    const atWh = (designId: string, cutSizeId: string, wh: string) =>
      wh ? cells.find((c) => c.key === `${designId}|${cutSizeId}` && c.warehouseId === wh)?.onHand ?? 0 : piecesByDesign.get(designId)?.find((r) => r.cutSizeId === cutSizeId)?.qty ?? 0;
    const takeFrom = (h: { warehouse: string; from: string }) => (transferring ? h.from : h.warehouse);
    return {
      title: kind === "receipt" ? "Add Cut Piece" : kind === "adjustment" ? "Adjust Cut Piece" : "Transfer Cut Piece",
      kind,
      unit: "pcs",
      dateLabel: kind === "receipt" ? "Entry date" : kind === "adjustment" ? "Adjustment date" : "Transfer date",
      warehouse: transferring ? "pair" : "single",
      items,
      second: {
        label: "Cut Piece Size",
        required: true,
        optionsFor: (designId, h) =>
          (piecesByDesign.get(designId) ?? []).map((r) => ({
            value: r.cutSizeId,
            label: cutName.get(r.cutSizeId) || "—",
            hint: takeFrom(h) ? `${atWh(designId, r.cutSizeId, takeFrom(h))} here · ${r.qty} total` : `${r.qty} on hand`,
          })),
        byName: new Map(cutSizes.map((c) => [c.label.trim().toLowerCase(), c.id])),
      },
      warnFor: (l, h) => {
        const out = transferring ? l.qty : -l.qty;
        if (out <= 0) return undefined;
        const have = atWh(l.design, l.second, takeFrom(h));
        return out > have ? `Only ${have} pcs on hand${takeFrom(h) ? " in that warehouse" : ""} — this line will be refused` : undefined;
      },
      onSave: async (h, lines) => {
        const res = await postCutStockEntry({
          entry_date: h.date,
          kind,
          reason: h.reason || undefined,
          note: h.note || undefined,
          warehouse: h.warehouse || undefined,
          from_warehouse: h.from || undefined,
          to_warehouse: h.to || undefined,
          lines: lines.map((l) => ({ design: l.design, cut_piece_size: l.second, qty: l.qty, note: l.note || undefined })),
        });
        return { ok: res.ok, error: res.error };
      },
      backTo: transferring ? "/stock-transfers" : "/cut-stock",
      columnsKey: kind === "receipt" ? "cutStockRecordSheetColumns" : kind === "adjustment" ? "cutStockAdjustSheetColumns" : "cutStockTransferSheetColumns",
    };
  }, [kind, transferring, designs, cutSizes, stockRows, entries, warehouses]);

  if (!can("panel_craft", "edit")) return <EmptyState title="No access" hint="You don't have permission for this" />;
  return <StockEntrySheet spec={spec} />;
}
