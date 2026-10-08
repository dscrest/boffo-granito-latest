/* ============================================================
   Cut Stock bulk sheets (CR-307/308) on the shared StockEntrySheet:
     /cut-stock/record  → Add Stock   (receipt: Item · Cut Piece Size · Qty)
     /cut-stock/adjust  → Adjust Stock (signed, reason mandatory)
   Items = the Panel Items (designs with at least one cut-piece row); the
   Cut Piece Size cell lists that item's cut pieces only — new pieces are
   defined on /panel-items first (CR-306).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { StockEntrySheet, type StockEntrySpec } from "@/features/common/StockEntrySheet";
import { cachedCutSizes, listPanels, type CutSizeOption } from "./panelsApi";
import { cachedCutStockRows, listCutStock, postCutStockEntry, type CutStockRow } from "./panelOrdersApi";

export function CutStockSheetPage({ kind }: { kind: "receipt" | "adjustment" }) {
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [stockRows, setStockRows] = useState<CutStockRow[]>(() => cachedCutStockRows() ?? []);

  useEffect(() => {
    void listDesigns().then((r) => r.ok && setDesigns(r.designs));
    void listPanels().then((r) => r.ok && setCutSizes(r.cutSizes));
    void listCutStock().then((r) => r.ok && setStockRows(r.rows));
  }, []);

  const spec = useMemo<StockEntrySpec>(() => {
    const cutName = new Map(cutSizes.map((c) => [c.id, c.label]));
    const piecesByDesign = new Map<string, CutStockRow[]>();
    for (const r of stockRows) (piecesByDesign.get(r.designId) ?? piecesByDesign.set(r.designId, []).get(r.designId)!).push(r);
    const items = designs
      .filter((d) => piecesByDesign.has(d.id))
      .map((d) => ({ id: d.id, sku: d.sku, uniqueName: d.uniqueName, designName: d.designName, hint: d.sizeLabel || undefined }));
    return {
      title: kind === "receipt" ? "Add Cut Stock" : "Adjust Cut Stock",
      kind,
      unit: "pcs",
      dateLabel: kind === "receipt" ? "Entry date" : "Adjustment date",
      items,
      second: {
        label: "Cut Piece Size",
        required: true,
        optionsFor: (designId) =>
          (piecesByDesign.get(designId) ?? []).map((r) => ({
            value: r.cutSizeId,
            label: cutName.get(r.cutSizeId) || "—",
            hint: `${r.qty} on hand`,
          })),
        byName: new Map(cutSizes.map((c) => [c.label.trim().toLowerCase(), c.id])),
      },
      warnFor: (l) => {
        if (l.qty >= 0) return undefined;
        const have = piecesByDesign.get(l.design)?.find((r) => r.cutSizeId === l.second)?.qty ?? 0;
        return -l.qty > have ? `Only ${have} pcs on hand — this line will be refused` : undefined;
      },
      onSave: async (h, lines) => {
        const res = await postCutStockEntry({
          entry_date: h.date,
          kind,
          reason: h.reason || undefined,
          note: h.note || undefined,
          lines: lines.map((l) => ({ design: l.design, cut_piece_size: l.second, qty: l.qty, note: l.note || undefined })),
        });
        return { ok: res.ok, error: res.error };
      },
      backTo: "/cut-stock",
      columnsKey: kind === "receipt" ? "cutStockRecordSheetColumns" : "cutStockAdjustSheetColumns",
    };
  }, [kind, designs, cutSizes, stockRows]);

  if (!can("panel_craft", "edit")) return <EmptyState title="No access" hint="You don't have permission for this" />;
  return <StockEntrySheet spec={spec} />;
}
