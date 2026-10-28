/* ============================================================
   Cut Piece detail (CR-461) — /cut-stock/:designId/:cutSizeId, what a row of
   the Panel Craft Stock tree opens. Stays INSIDE Panel Craft (sidebar leaf
   Stock, Back = /cut-stock, rail = the same item · cut-piece list) — before
   this a click jumped to the Panel Items master under Settings ▸ Masters and
   the menu changed under the user. Everything here is about THIS piece:
   on hand · booked · free, its locations, the panels that use it, the open
   orders booking it, its dated ledger. Stock moves only through the sheets
   (Actions tab, opened prefilled with this piece); defining / removing cut
   pieces stays on the Panel Item page (Masters), linked from Actions.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { cachedSampleOrders, listSampleOrders, type SampleOrderRow } from "./sampleOrdersApi"; // CR-487
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { Chip } from "@/ui/Chip";
import { codeOf } from "@/ui/statusCode";
import { EmptyState, SkeletonRows } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { RecordDetail, type RecordField } from "@/features/common/RecordDetail";
import { DetailRail } from "@/features/common/DetailRail";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { useWarehouses } from "@/features/masters/useWarehouses";
import { cachedCutSizes, cachedPanels, listPanels, type CutSizeOption, type PanelRow } from "./panelsApi";
import {
  allocatedByKey,
  cachedCutStockRows,
  cachedPanelOrders,
  CUT_ENTRY_KIND_LABEL,
  cutWarehouseCells,
  listCutStock,
  listCutStockEntries,
  listPanelOrders,
  PANEL_ORDER_STATUS_LABEL,
  stockKey,
  type CutStockEntryRow,
  type CutStockRow,
  type PanelOrderRow,
} from "./panelOrdersApi";
import { ORDER_STATUS_TONE } from "./pcBits";

const kg2 = (n: number) => Math.round(n * 100) / 100;
const dash = <span className="dim">—</span>;

/** The Stock tree's name for a piece: the item alone for its full size, "Item · 600x600" for a special cut (CR-456/459). */
export function cutPieceName(d: DesignRow | undefined, cut: string): string {
  const item = d ? d.uniqueName || d.designName : "";
  return cut && cut !== d?.sizeLabel ? `${item} · ${cut}` : item;
}
export const cutPiecePath = (designId: string, cutSizeId: string) => `/cut-stock/${encodeURIComponent(designId)}/${encodeURIComponent(cutSizeId)}`;

export function CutPieceDetail() {
  const { designId = "", cutSizeId = "" } = useParams();
  const navigate = useNavigate();
  const [designs, setDesigns] = useState<DesignRow[] | null>(() => cachedDesigns());
  const [stock, setStock] = useState<CutStockRow[]>(() => cachedCutStockRows() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [orders, setOrders] = useState<PanelOrderRow[]>(() => cachedPanelOrders() ?? []);
  const [samples, setSamples] = useState<SampleOrderRow[]>(() => cachedSampleOrders() ?? []); // CR-487: sample bookings count
  const [entries, setEntries] = useState<CutStockEntryRow[]>([]);

  useEffect(() => {
    void listDesigns().then((r) => setDesigns(r.ok ? r.designs : (cachedDesigns() ?? [])));
    void listPanels().then((r) => {
      if (!r.ok) return;
      setCutSizes(r.cutSizes);
      setPanels(r.panels);
    });
    void listPanelOrders().then((r) => r.ok && setOrders(r.orders));
    void listSampleOrders().then((r) => r.ok && setSamples(r.orders));
    void listCutStock().then((r) => r.ok && setStock(r.rows));
    void listCutStockEntries().then((r) => r.ok && setEntries(r.rows));
  }, [designId, cutSizeId]);

  const key = stockKey(designId, cutSizeId);
  const byId = useMemo(() => new Map((designs ?? []).map((d) => [d.id, d])), [designs]);
  const cutName = useMemo(() => new Map(cutSizes.map((c) => [c.id, c.label])), [cutSizes]);
  const design = byId.get(designId);
  const row = stock.find((r) => r.designId === designId && r.cutSizeId === cutSizeId);
  const cut = cutName.get(cutSizeId) || "";
  const booked = useMemo(() => allocatedByKey(orders, samples).get(key) ?? 0, [orders, samples, key]);

  const railItems = useMemo(
    () =>
      stock
        .map((r) => ({ r, d: byId.get(r.designId) }))
        .filter(({ d }) => d)
        .map(({ r, d }) => ({
          id: stockKey(r.designId, r.cutSizeId),
          to: cutPiecePath(r.designId, r.cutSizeId),
          title: cutPieceName(d, cutName.get(r.cutSizeId) || ""),
          subtitle: [d!.sizeLabel, `${fmt(r.qty)} pcs`].filter(Boolean).join(" · "),
          searchText: d!.sku,
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [stock, byId, cutName],
  );
  const history = useMemo(
    () =>
      entries
        .filter((e) => e.designId === designId && e.cutSizeId === cutSizeId)
        .sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.createdTime.localeCompare(a.createdTime))
        .slice(0, 30),
    [entries, designId, cutSizeId],
  );
  const { warehouses, nodes: whNodes, nameOf: whName, enabled: whEnabled } = useWarehouses();
  const locations = useMemo(
    () => (whEnabled ? cutWarehouseCells(warehouses, entries, stock).filter((c) => c.key === key) : []),
    [whEnabled, warehouses, entries, stock, key],
  );
  const myPanels = useMemo(() => panels.filter((p) => p.lines.some((l) => l.designId === designId && l.cutSizeId === cutSizeId)), [panels, designId, cutSizeId]);
  const myOrders = useMemo(() => orders.filter((o) => (o.allocation[key] ?? 0) > 0), [orders, key]);

  if (designs === null) return <SkeletonRows rows={6} />;

  const free = row ? Math.max(0, row.qty - booked) : 0;
  const fields: RecordField[] = row
    ? [
        { key: "cut", label: "Cut Piece Size", value: cut || "Not set" },
        { key: "size", label: "Item Size", value: design?.sizeLabel || "Not set" },
        { key: "weight", label: "Weight / Piece", value: row.weightKg == null ? "Not weighed" : `${row.weightKg} kg` },
        { key: "onHand", label: "On Hand", value: `${fmt(row.qty)} pcs` },
        { key: "booked", label: "Booked", value: `${fmt(booked)} pcs` },
        { key: "free", label: "Free", value: `${fmt(free)} pcs` },
        { key: "stockKg", label: "Stock Weight", value: row.weightKg == null ? "—" : `${kg2(row.weightKg * row.qty)} kg` },
      ]
    : [];
  const canEdit = can("panel_craft", "edit");
  const q = `?design=${encodeURIComponent(designId)}&cut=${encodeURIComponent(cutSizeId)}`;
  const openOrder = (id: string) => navigate(`/panel-orders/${encodeURIComponent(id)}`);
  const openPanel = (id: string) => navigate(`/panels/${encodeURIComponent(id)}`);

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <DetailRail placeholder="Search item or cut size…" currentId={key} items={railItems} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {!design || !row ? (
          <div className="card" style={{ padding: 20 }}>
            <EmptyState title="No such cut piece" hint="Pick one from the list" action={<Link className="hbtn" to="/cut-stock">Stock</Link>} />
          </div>
        ) : (
          <RecordDetail
            backTo="/cut-stock"
            title={cutPieceName(design, cut)}
            subtitle={design.sizeLabel ? <span className="chip size">{design.sizeLabel}</span> : undefined}
            fields={fields}
            hiddenStorageKey="cutPieceDetailFields"
            hideFields
            activityTable="CutPieceStock"
            entityId={row.id}
            modified={row.modifiedTime}
            extraTabs={[
              {
                id: "actions",
                label: "Actions",
                content: (
                  <div className="card" style={{ padding: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {canEdit && (
                      <>
                        <Link className="hbtn primary" to={`/cut-stock/record${q}`}><Icon name="plus" size={13} /> Add Stock</Link>
                        <Link className="hbtn" to={`/cut-stock/adjust${q}`}><Icon name="edit" size={13} /> Adjust Stock</Link>
                        {whEnabled && <Link className="hbtn" to={`/cut-stock/transfer${q}`}><Icon name="truck" size={13} /> Transfer</Link>}
                      </>
                    )}
                    <Link className="hbtn" to={`/panel-items/${encodeURIComponent(designId)}`} title="Define or remove this item's cut pieces (Masters)"><Icon name="tile" size={13} /> Panel Item</Link>
                  </div>
                ),
              },
            ]}
          >
            {whEnabled && (
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="card-head">
                  <span style={{ fontWeight: 600 }}>Locations</span>
                  <span className="muted" style={{ fontSize: 14 }}>pieces per location</span>
                </div>
                <div style={{ overflow: "auto" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th className="num" style={{ textAlign: "right" }}>Pcs on hand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {whNodes
                        .map((w) => ({ w, c: locations.find((c) => c.warehouseId === w.id) }))
                        .filter(({ c }) => c)
                        .map(({ w, c }) => (
                          <tr key={w.id}>
                            <td style={{ fontWeight: 600 }}>{whName(w.id)}{w.isPrimary ? <span className="dim" title="Pieces recorded without a location count here"> ★</span> : null}</td>
                            <td className="num mono" style={{ fontWeight: 600, color: c!.over > 0 ? "var(--c-amber)" : undefined }} title={c!.over > 0 ? `${fmt(c!.over)} more left than this location ever held` : undefined}>{fmt(c!.onHand)}{c!.over > 0 ? " ⚠" : ""}</td>
                          </tr>
                        ))}
                      {!locations.length && (
                        <tr>
                          <td colSpan={2} className="dim" style={{ padding: "14px 10px" }}>No pieces at any location.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-head">
                <span style={{ fontWeight: 600 }}>Panels</span>
                <span className="muted" style={{ fontSize: 14 }}>using this cut piece</span>
              </div>
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Panel Code</th>
                      <th>Panel Size</th>
                      <th className="num" style={{ textAlign: "right" }}>Pcs / Panel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myPanels.map((p) => (
                      <tr key={p.id} tabIndex={0} style={{ cursor: "pointer" }} title="Open panel" onClick={() => openPanel(p.id)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) openPanel(p.id); }}>
                        <td className="mono">{p.panelCode}</td>
                        <td className="mono muted">{p.panelSize || "—"}</td>
                        <td className="num mono">{fmt(p.lines.find((l) => l.designId === designId && l.cutSizeId === cutSizeId)?.qty ?? 0)}</td>
                      </tr>
                    ))}
                    {myPanels.length === 0 && (
                      <tr>
                        <td colSpan={3} className="muted" style={{ textAlign: "center", padding: 18 }}>Not on any panel yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-head">
                <span style={{ fontWeight: 600 }}>Orders</span>
                <span className="muted" style={{ fontSize: 14 }}>booking this cut piece</span>
              </div>
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th className="num" style={{ textAlign: "right" }}>Booked (pcs)</th>
                      <th>Order Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myOrders.map((o) => (
                      <tr key={o.id} tabIndex={0} style={{ cursor: "pointer" }} title="Open panel order" onClick={() => openOrder(o.id)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) openOrder(o.id); }}>
                        <td className="mono">{o.orderNumber || "—"}</td>
                        <td>{o.customerName}</td>
                        <td className="num mono">{fmt(o.allocation[key] ?? 0)}</td>
                        <td className="mono muted">{o.orderDate || "—"}</td>
                        <td><Chip tone={ORDER_STATUS_TONE[o.status]} label={codeOf(PANEL_ORDER_STATUS_LABEL[o.status])} title={PANEL_ORDER_STATUS_LABEL[o.status]} /></td>
                      </tr>
                    ))}
                    {myOrders.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 18 }}>No order has booked this cut piece.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <span style={{ fontWeight: 600 }}>Stock History</span>
                <span className="muted" style={{ fontSize: 14 }}>latest {history.length}</span>
              </div>
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th className="num" style={{ textAlign: "right" }}>Pcs</th>
                      <th>Reason / Note</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((e) => (
                      <tr key={e.id}>
                        <td className="mono muted">{e.entryDate || "—"}</td>
                        <td>
                          {e.refTable === "PanelOrder" && e.refRowid ? (
                            <Link className="linkish" to={`/panel-orders/${encodeURIComponent(e.refRowid)}`}>{CUT_ENTRY_KIND_LABEL[e.kind] || e.kind}</Link>
                          ) : (
                            CUT_ENTRY_KIND_LABEL[e.kind] || e.kind
                          )}
                        </td>
                        <td className="num mono" style={{ color: e.qty < 0 ? "var(--c-red)" : "var(--c-green)", fontWeight: 600 }}>{e.qty > 0 ? "+" : ""}{fmt(e.qty)}</td>
                        <td className="muted">{[e.kind === "transfer" ? `${e.docNumber}${whEnabled && e.warehouseId ? ` · ${whName(e.warehouseId)}` : ""}` : "", e.reason, e.note].filter(Boolean).join(" — ") || dash}</td>
                        <td className="muted">{e.performedBy || "—"}</td>
                      </tr>
                    ))}
                    {history.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 18 }}>No stock movements yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </RecordDetail>
        )}
      </div>
    </div>
  );
}
