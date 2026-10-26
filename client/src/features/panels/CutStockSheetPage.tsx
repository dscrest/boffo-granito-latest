/* ============================================================
   Cut Stock bulk pages (CR-307/308/330):
     /cut-stock/record   → Add Stock       (receipt: Item · Cut Piece Size · Qty — the bulk StockEntrySheet)
     /cut-stock/adjust   → Adjust Stock    (CR-446: the Zoho-style StockAdjustForm — one line by default,
                                            Location · Current stock · Add/Remove · Qty · Date · Reason per line)
     /cut-stock/transfer → Transfer Stock  (CR-330: From / To location, reason; CR-409: leaf = Warehouse ▸ Location)
   CR-414: the RECEIPT sheet takes ANY active design from the Item master and
   ANY cut piece size (the item's pieces first, then the rest of the master,
   "Create …" for a new name; blank = full size) — saving defines the pair
   on the server with the ƒx weight (cutPieceWeight), i.e. it imports the
   design into Panel Craft and receives in one step. Adjust / transfer still
   offer only Panel Items and their defined pieces. `?design=<id>` prefills
   the first row (opened from /panel-items/:id) and Save returns there.
   CR-329: receipt / adjust carry a Location; hints show the pieces in the
   picked (From) location. CR-438: receipt rows may each pick their own
   Location (blank = the bar's); the server resolves the fallback.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState } from "@/ui/States";
import { toast } from "@/ui/Toast";
import { can } from "@/lib/auth";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { StockEntrySheet, type StockEntrySpec } from "@/features/common/StockEntrySheet";
import { StockAdjustForm, type StockAdjustSpec } from "@/features/common/StockAdjustForm";
import { useWarehouses } from "@/features/masters/useWarehouses";
import { cachedCutSizes, createCutSize, listPanels, type CutSizeOption } from "./panelsApi";
import { cachedCutStockRows, cutWarehouseCells, listCutStock, listCutStockEntries, postCutStockEntry, type CutStockEntryRow, type CutStockRow } from "./panelOrdersApi";
import { cutPieceWeight, weightPerPc } from "./cutPieceWeight";

export function CutStockSheetPage({ kind }: { kind: "receipt" | "adjustment" | "transfer" }) {
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [stockRows, setStockRows] = useState<CutStockRow[]>(() => cachedCutStockRows() ?? []);
  const [entries, setEntries] = useState<CutStockEntryRow[]>([]);
  const { warehouses } = useWarehouses();
  const [params] = useSearchParams();
  const fromDesign = params.get("design") || "";

  useEffect(() => {
    void listDesigns().then((r) => r.ok && setDesigns(r.designs));
    void listPanels().then((r) => r.ok && setCutSizes(r.cutSizes));
    void listCutStock().then((r) => r.ok && setStockRows(r.rows));
    void listCutStockEntries().then((r) => r.ok && setEntries(r.rows));
  }, []);

  const transferring = kind === "transfer";
  const receiving = kind === "receipt";
  const adjusting = kind === "adjustment";
  // The bits both the sheet (receipt / transfer) and the adjustment form share.
  const shared = useMemo(() => {
    const cutName = new Map(cutSizes.map((c) => [c.id, c.label]));
    const byId = new Map(designs.map((d) => [d.id, d]));
    const piecesByDesign = new Map<string, CutStockRow[]>();
    for (const r of stockRows) (piecesByDesign.get(r.designId) ?? piecesByDesign.set(r.designId, []).get(r.designId)!).push(r);
    const items = designs
      .filter((d) => (receiving ? d.status !== "Inactive" && d.status !== "Discontinued" : piecesByDesign.has(d.id)))
      .map((d) => ({
        id: d.id,
        sku: d.sku,
        uniqueName: d.uniqueName,
        designName: d.designName,
        hint: [d.sizeLabel, receiving && !piecesByDesign.has(d.id) ? "not in Panel Craft yet" : ""].filter(Boolean).join(" · ") || undefined,
      }));
    // CR-329: pieces per warehouse (dormant → the plain on-hand).
    const cells = warehouses.length ? cutWarehouseCells(warehouses, entries, stockRows) : [];
    const atWh = (designId: string, cutSizeId: string, wh: string) =>
      wh ? cells.find((c) => c.key === `${designId}|${cutSizeId}` && c.warehouseId === wh)?.onHand ?? 0 : piecesByDesign.get(designId)?.find((r) => r.cutSizeId === cutSizeId)?.qty ?? 0;
    const takeFrom = (h: { warehouse: string; from: string }) => (transferring ? h.from : h.warehouse);
    // CR-414: the ƒx weight the server stores when the line defines (or first weighs) the pair.
    const lineWeight = (designId: string, cutSizeId: string) => {
      const d = byId.get(designId);
      if (!d) return null;
      return cutSizeId ? cutPieceWeight(d, cutName.get(cutSizeId) || "") : weightPerPc(d);
    };
    const second: StockEntrySpec["second"] = {
      label: "Cut Piece Size",
      required: !receiving,
      placeholder: receiving ? "Full size" : undefined,
      optionsFor: (designId, h) => {
        const defined = (piecesByDesign.get(designId) ?? []).map((r) => ({
          value: r.cutSizeId,
          label: cutName.get(r.cutSizeId) || "—",
          hint: takeFrom(h) ? `${atWh(designId, r.cutSizeId, takeFrom(h))} here · ${r.qty} total` : `${r.qty} on hand`,
        }));
        if (!receiving) return defined;
        const used = new Set(defined.map((o) => o.value));
        return [...defined, ...cutSizes.filter((c) => !used.has(c.id)).map((c) => ({ value: c.id, label: c.label, hint: "new cut piece" }))];
      },
      byName: new Map(cutSizes.map((c) => [c.label.trim().toLowerCase(), c.id])),
      onCreate: receiving
        ? async (_designId, text) => {
            const res = await createCutSize(text);
            if (!res.ok || !res.rowid) {
              toast.error(res.error || "Could not add the cut piece size to the master");
              return undefined;
            }
            setCutSizes((prev) => [...prev, { id: res.rowid!, label: text.trim() }].sort((a, b) => a.label.localeCompare(b.label)));
            return res.rowid;
          }
        : undefined,
    };
    const warnFor: StockEntrySpec["warnFor"] = (l, h) => {
      const out = transferring ? l.qty : -l.qty;
      if (out <= 0) return undefined;
      const have = atWh(l.design, l.second, takeFrom(h));
      return out > have ? `Only ${have} pcs on hand${takeFrom(h) ? " at that location" : ""} — this line will be refused` : undefined;
    };
    const backTo = fromDesign ? `/panel-items/${encodeURIComponent(fromDesign)}` : transferring ? "/stock-transfers" : "/cut-stock";
    return { items, second, warnFor, backTo, atWh, lineWeight };
  }, [transferring, receiving, designs, cutSizes, stockRows, entries, warehouses, fromDesign]);

  const sheetSpec = useMemo<StockEntrySpec>(
    () => ({
      title: receiving ? "Add Stock" : "Transfer Stock",
      kind: receiving ? "receipt" : "transfer",
      unit: "pcs",
      dateLabel: receiving ? "Entry date" : "Transfer date",
      warehouse: transferring ? "pair" : "single",
      items: shared.items,
      second: shared.second,
      warnFor: shared.warnFor,
      onSave: async (h, lines) => {
        const res = await postCutStockEntry({
          entry_date: h.date,
          kind: receiving ? "receipt" : "transfer",
          reason: h.reason || undefined,
          note: h.note || undefined,
          warehouse: h.warehouse || undefined,
          from_warehouse: h.from || undefined,
          to_warehouse: h.to || undefined,
          lines: lines.map((l) => ({
            design: l.design,
            cut_piece_size: l.second,
            qty: l.qty,
            note: l.note || undefined,
            warehouse: l.warehouse || undefined,
            ...(receiving ? { weight_kg: shared.lineWeight(l.design, l.second) } : {}),
          })),
        });
        return { ok: res.ok, error: res.error };
      },
      backTo: shared.backTo,
      columnsKey: receiving ? "cutStockRecordSheetColumns" : "cutStockTransferSheetColumns",
      initialRows: fromDesign ? [{ design: fromDesign }] : undefined,
    }),
    [receiving, transferring, shared, fromDesign],
  );

  // CR-446: the adjustment is a line form — every line carries its own date · location · reason.
  const adjustSpec = useMemo<StockAdjustSpec>(
    () => ({
      title: "Adjust Stock",
      unit: "pcs",
      items: shared.items,
      second: shared.second,
      warnFor: shared.warnFor,
      onHand: (designId, cutSizeId, wh) => (cutSizeId ? shared.atWh(designId, cutSizeId, wh) : undefined),
      onSave: async (lines) => {
        const res = await postCutStockEntry({
          kind: "adjustment",
          lines: lines.map((l) => ({ design: l.design, cut_piece_size: l.second, qty: l.qty, note: l.note || undefined, warehouse: l.warehouse || undefined, entry_date: l.date, reason: l.reason })),
        });
        return { ok: res.ok, error: res.error };
      },
      backTo: shared.backTo,
      initialDesign: fromDesign || undefined,
    }),
    [shared, fromDesign],
  );

  if (!can("panel_craft", "edit")) return <EmptyState title="No access" hint="You don't have permission for this" />;
  return adjusting ? <StockAdjustForm spec={adjustSpec} /> : <StockEntrySheet spec={sheetSpec} />;
}
