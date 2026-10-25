/* ============================================================
   Item (Design) detail — Zoho-Inventory-style split view (#13/#14).
   Left: resizable, searchable list of Unique Item Names (+ SKU).
   Right: header with Edit / More (Delete, Mark as Inactive) / ✕,
   Primary Details, and the Inventory Image Upload manager (#12) —
   Front / Rear / Other slots, positional over image_urls
   (front = [0], rear = [1], other = rest). One "Add Image" button
   fills slots in order; Front/Rear are preview + delete only.
   Renders instantly from the designs cache — no skeleton flash when
   navigating between items or returning to the tab.
   ============================================================ */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { newestFirst } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { can, isAdmin } from "@/lib/auth";
import { update } from "@/lib/dataOps";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDelete } from "@/ui/ConfirmDialog";
import { SkeletonRows, EmptyState } from "@/ui/States";
import { useModalA11y } from "@/ui/useModalA11y";
import { useOrders } from "@/features/orders/useOrders";
import { cachedAdjustEntries, cachedAllocByDesign, cachedProductionLogs, cachedOpeningEntries, listProductionLogs, type AdjustEntry, type ProductionEntry, type ProductionRecordRow } from "@/features/stages/productionApi";
import { cachedAdjustedByDesign, cachedOpeningByDesign, cachedWarehouseStock, listBatchStock, warehouseStockKey } from "@/features/stages/batchStockApi";
import { cachedPalPlans, listPalPlans, type PalPlan } from "@/features/stages/palPlansApi";
import type { WhCell } from "@/lib/warehouseStock";
import { useWarehouses } from "./useWarehouses";
import { designStock, openingStockFor } from "@/lib/stock";
import { OpeningStockForm } from "./OpeningStockForm";
import { InProductionModal } from "@/features/stages/InProductionModal";
import type { Order } from "@/data";
import { ActivityLog } from "@/features/common/RecordDetail";
import { DetailRow, MoreMenu } from "@/features/common/DetailBits";
import { ImageManager } from "@/features/common/ImageManager";
import { fmtLocalDateTime } from "@/lib/format";
import { cachedDesigns, deleteDesign, listDesigns, patchDesignCache, type DesignImage, type DesignRow } from "./designsApi";
import { useMasters } from "./useMasters";
import { NumberInput } from "../../ui/NumberInput";
import { computeWeights, rowToValues } from "./DesignForm";

/* Overview/Stock tab button style (mirrors RecordDetail.tabStyle). */
function tabStyle(active: boolean) {
  return {
    background: "none",
    border: 0,
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    color: active ? "var(--fg)" : "var(--muted)",
    fontWeight: active ? 600 : 400,
    padding: "8px 12px",
    cursor: "pointer",
    font: "inherit",
  } as const;
}

/* Related-orders "Party" panel hidden per 2026-07 request — flip to true to
   restore the Party / Order Qty / Stage table + open-quantity line. */
const SHOW_PARTY_PANEL = false;

/** One label/number row in the stock summary. When onClick is given and the
    number is non-zero it renders as a link that opens the drill-down. */
function StockRow({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
      <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{label}</span>
      {onClick && value > 0 ? (
        <button className="linkish mono" onClick={onClick} title={`See what makes up ${label.toLowerCase()}`}
          style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}>
          {fmt(value)}
        </button>
      ) : (
        <span className="mono">{fmt(value)}</span>
      )}
    </div>
  );
}

/** A stock number's drill-down: which order lines add up to it. Pure client —
    reuses the orders already loaded on the page; each row links to its SO. */
type StockBreakdown<T = Order> = {
  title: string;
  note: string;
  rows: T[];
  columns: { head: string; num?: boolean; val: (o: T) => string }[];
};

function StockBreakdownModal({ bd, onClose }: { bd: StockBreakdown<any>; onClose: () => void }) {
  const panelRef = useModalA11y(onClose);
  const total = bd.rows.length;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel card" ref={panelRef} role="dialog" aria-modal="true" aria-label={bd.title} style={{ maxWidth: 720 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <div style={{ fontWeight: 600, fontSize: 18 }}>{bd.title}</div>
          <span className="muted" style={{ fontSize: 14 }}>{total} order{total === 1 ? "" : "s"}</span>
          <button className="btn x" onClick={onClose} title="Close" style={{ marginLeft: "auto" }} tabIndex={-1}><Icon name="x" size={13} /></button>
        </div>
        <div className="modal-body" style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>{bd.columns.map((c, i) => <th key={i} className={c.num ? "num" : undefined} style={c.num ? { textAlign: "right" } : undefined}>{c.head}</th>)}</tr>
            </thead>
            <tbody>
              {bd.rows.map((o) => (
                <tr key={o.id}>
                  {bd.columns.map((c, i) => (
                    <td key={i} className={c.num ? "num mono" : undefined} style={c.num ? { textAlign: "right" } : undefined}>
                      {i === 0 ? <Link className="linkish" to={`/orders/${o.salesOrderId}`} onClick={onClose} title="Open Sales Order">{c.val(o)}</Link> : c.val(o)}
                    </td>
                  ))}
                </tr>
              ))}
              {total === 0 && <tr><td colSpan={bd.columns.length}><span className="dim" style={{ padding: 8, display: "inline-block" }}>Nothing contributing right now.</span></td></tr>}
            </tbody>
          </table>
        </div>
        {/* CR-352: notes sit UNDER the content they explain. */}
        <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 12 }}>{bd.note}</div>
      </div>
    </div>
  );
}

export function ItemDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { orders: allOrders } = useOrders();
  // Seed from cache so switching items / returning to the tab never flashes a skeleton.
  const [designs, setDesigns] = useState<DesignRow[] | null>(() => cachedDesigns());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false); // status toggle / delete
  const [stockEdit, setStockEdit] = useState(false); // inline Opening-stock edit
  const [stockVal, setStockVal] = useState("");
  const [stockReason, setStockReason] = useState(""); // required when a locked value is re-edited (admin)
  const [stockBusy, setStockBusy] = useState(false);
  const [breakdown, setBreakdown] = useState<StockBreakdown<any> | null>(null); // stock-number drill-down
  const [ipOpen, setIpOpen] = useState(false); // "In production" drill-down (shared per-SO popup)
  // Make-to-stock (independent) production has no SO line, so it never reaches
  // `allOrders` — pull the production log to fold its output into available stock.
  const [prodLogs, setProdLogs] = useState<ProductionEntry[]>(() => cachedProductionLogs() ?? []);
  const [openingByDesign, setOpeningByDesign] = useState<Map<string, number>>(() => cachedOpeningByDesign());
  const [adjustedByDesign, setAdjustedByDesign] = useState<Map<string, number>>(() => cachedAdjustedByDesign());
  const [openingEntries, setOpeningEntries] = useState<ProductionRecordRow[]>(() => cachedOpeningEntries());
  const [adjustEntries, setAdjustEntries] = useState<AdjustEntry[]>(() => cachedAdjustEntries()); // CR-308
  const [whCells, setWhCells] = useState<WhCell[]>(() => cachedWarehouseStock()); // CR-332: per-warehouse split
  const [palPlans, setPalPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []); // CR-412: pallets standing at a location
  const { warehouses, nodes: whNodes, nameOf: whName, enabled: whEnabled } = useWarehouses();
  // CR-392: owner / buyer are Customer ROWIDs — resolve names from the customer cache.
  const { customers } = useMasters();
  const customerName = (cid: string) => (cid ? customers.find((c) => c.id === cid)?.name ?? "" : "");
  const [openingOpen, setOpeningOpen] = useState(false); // batch-wise opening-stock editor
  // Overview (default) | Production | Locations (CR-332) — deep-linkable via ?tab=. Panels tab hidden (CR-296).
  const [sp, setSp] = useSearchParams();
  const spTab = sp.get("tab");
  const tab = spTab === "stock" ? "stock" : spTab === "locations" ? "locations" : "overview";
  const setTab = (t: "overview" | "stock" | "locations") => setSp(t === "overview" ? {} : { tab: t }, { replace: true });

  const refresh = () => listDesigns().then((res) => setDesigns(res.ok ? res.designs : (cachedDesigns() ?? [])));
  const reloadStock = () => {
    void listProductionLogs().then((res) => {
      if (res.ok) { setProdLogs(res.entries); setOpeningEntries(res.openingEntries); setAdjustEntries(res.adjustEntries); }
    });
    void listBatchStock().then((res) => {
      if (res.ok) { setOpeningByDesign(res.openingByDesign); setAdjustedByDesign(res.adjustedByDesign); setWhCells(res.byWarehouse); }
    });
    void listPalPlans().then((res) => res.ok && setPalPlans(res.plans));
  };
  useEffect(() => {
    void refresh();
    reloadStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const design = designs?.find((d) => d.id === id) ?? null;
  const isBatched = !!design?.isBatched;
  // Production tab: every production record + opening row for this item, newest
  // first — batch · qty · mfg date · remark. Shows batch-wise production.
  // These hooks MUST run before the `designs === null` early-return below,
  // else the hook count changes between renders (React error #310).
  const myProductionRows = useMemo(() => {
    if (!design) return [] as (ProductionRecordRow & { kind: "production" | "opening" | "adjust" })[];
    const recs = prodLogs
      .filter((e) => e.design === design.designName)
      .flatMap((e) => e.records)
      .map((r) => ({ ...r, kind: "production" as const }));
    const opens = openingEntries
      .filter((e) => e.design === design.designName)
      .map((r) => ({ ...r, kind: "opening" as const }));
    // CR-308: signed adjustments sit in the same list (breakage, count correction…).
    const adjusts = adjustEntries
      .filter((e) => e.design === design.designName)
      .map((a): ProductionRecordRow & { kind: "adjust" } => ({
        id: a.id, parentId: "", design: a.design, size: a.size, finish: a.finish, qtyBoxes: a.qtyBoxes, productionDate: a.adjDate, shift: "",
        performedBy: a.performedBy, note: [a.reason, a.note].filter(Boolean).join(" — "), batchNumber: a.batchNumber, boxBrandId: "", orderItemId: "", createdTime: a.createdTime, kind: "adjust",
      }));
    return [...opens, ...recs, ...adjusts].sort((a, b) => (a.createdTime < b.createdTime ? 1 : -1));
  }, [design, prodLogs, openingEntries, adjustEntries]);
  if (designs === null) return <SkeletonRows rows={6} />;

  const needle = q.trim().toLowerCase();
  const railRows = newestFirst(designs);
  const listed = needle
    ? railRows.filter((d) => `${d.uniqueName || d.designName} ${d.sku}`.toLowerCase().includes(needle))
    : railRows;

  // Order.design is the full unique label; the plain designName is the stock key
  // (same match as designStock — CR-298: the old `o.design ===` never matched).
  const orders = design ? allOrders.filter((o) => (o.designName || o.design) === design.designName) : [];
  const openQty = orders.reduce((s, o) => s + (o.orderQty - o.loadedQty), 0);

  // Live stock summary — single source of truth (lib/stock.ts), shared with the
  // transaction line-item rows and Reports. Batch-tracked items read opening from
  // their opening rows (openingByDesign); singular items from accounting_stock.
  const openingStock = openingStockFor(design, openingByDesign);
  const stock = designStock(design?.id ?? "", { openingStock, adjusted: adjustedByDesign.get(design?.id ?? ""), allocated: cachedAllocByDesign().get(design?.id ?? ""), orders: allOrders, prodLogs });
  const inProduction = stock.inProduction;
  const inLoading = stock.inLoading;
  const awaitingPal = stock.awaitingPalletization;
  const availableStock = stock.available;

  const productionTotal = myProductionRows.reduce((s, r) => s + r.qtyBoxes, 0);
  // CR-332 Locations: each node ("Warehouse ▸ Location") holding this item, its batches beneath. Committed = reserved by orders, spread like loading.
  // CR-409: a warehouse has 60–70 locations — only the ones where this item sits are listed.
  const locationRows = (() => {
    if (!design) return [] as { warehouseId: string; warehouse: string; batches: WhCell[]; onHand: number; committed: number }[];
    const mine = whCells.filter((c) => c.key.startsWith(`${design.id}|`));
    return whNodes
      .map((w) => {
        const batches = mine.filter((c) => c.warehouseId === w.id).sort((a, b) => a.key.localeCompare(b.key));
        return { warehouseId: w.id, warehouse: whName(w.id), batches, onHand: batches.reduce((s, c) => s + c.onHand, 0), committed: batches.reduce((s, c) => s + c.committed, 0) };
      })
      .filter((r) => r.batches.length > 0);
  })();
  // CR-412: this item's pallets standing at a location (palletized, not yet in a container), grouped by location.
  const palletRows = (() => {
    if (!design) return [] as { warehouseId: string; warehouse: string; lines: number; boxes: number }[];
    const by = new Map<string, { lines: number; boxes: number }>();
    for (const p of palPlans) for (const l of p.lines) {
      if (l.designId !== design.id || !l.warehouseId || l.loadBoxId || (l.status !== "Palletizing" && l.status !== "ReadyToLoad")) continue;
      const cur = by.get(l.warehouseId) || { lines: 0, boxes: 0 };
      by.set(l.warehouseId, { lines: cur.lines + 1, boxes: cur.boxes + l.boxes });
    }
    return whNodes.filter((w) => by.has(w.id)).map((w) => ({ warehouseId: w.id, warehouse: whName(w.id), ...by.get(w.id)! }));
  })();
  const locationTotals = locationRows.reduce((a, r) => ({ onHand: a.onHand + r.onHand, committed: a.committed + r.committed }), { onHand: 0, committed: 0 });
  const myOpeningCount = design ? openingEntries.filter((e) => e.design === design.designName).length : 0;

  // Drill-downs: what adds up to each stock number (this item, all SOs).
  const orderCol = { head: "Order", val: (o: Order) => o.orderNumber || o.poNumber || "—" };
  const custCol = { head: "Customer", val: (o: Order) => o.party || "—" };
  // In production uses the shared per-SO drill-down (designStock.inProductionOrders),
  // so the popup matches Order detail / Production form everywhere.
  const bdAwaitingPal: StockBreakdown<Order> = {
    title: "Awaiting palletization", note: "Boxes produced or allocated to an order that are not on a pallet yet — across every open order for this item.",
    rows: orders.filter((o) => o.producedQty - o.palletizedQty > 0),
    columns: [orderCol, custCol,
      { head: "Produced", num: true, val: (o) => fmt(o.producedQty) },
      { head: "Palletized", num: true, val: (o) => fmt(o.palletizedQty) },
      { head: "Awaiting", num: true, val: (o) => fmt(Math.max(0, o.producedQty - o.palletizedQty)) }],
  };
  const bdInLoading: StockBreakdown<Order> = {
    title: "In loading", note: "Palletized boxes waiting to be loaded — across every open order for this item.",
    rows: orders.filter((o) => o.palletizedQty - o.loadedQty > 0),
    columns: [orderCol, custCol,
      { head: "Palletized", num: true, val: (o) => fmt(o.palletizedQty) },
      { head: "Loaded", num: true, val: (o) => fmt(o.loadedQty) },
      { head: "In loading", num: true, val: (o) => fmt(Math.max(0, o.palletizedQty - o.loadedQty)) }],
  };

  // Opening stock locks once set: singular = a POSITIVE accounting_stock (0 stays
  // editable); batched = any opening batch row exists. Only an admin can then
  // re-edit, with a reason (kept in the OperationLog payload).
  const stockLocked = isBatched ? myOpeningCount > 0 : (design?.accountingStock ?? 0) > 0;
  const saveOpeningStock = async () => {
    if (!design) return;
    // Empty field = "leave unchanged" (the current value shows only as a placeholder).
    if (stockVal.trim() === "") {
      setStockEdit(false);
      return;
    }
    if (stockLocked && !stockReason.trim()) {
      toast.error("A reason is required to change a saved opening stock");
      return;
    }
    const next = Math.max(0, parseInt(stockVal, 10) || 0);
    setStockBusy(true);
    const res = await update("Design", design.id, {
      accounting_stock: next,
      ...(stockLocked ? { _reason: `Opening stock ${fmt(openingStock)} → ${fmt(next)}: ${stockReason.trim()}` } : {}),
    });
    setStockBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not update opening stock");
      return;
    }
    patchDesignCache(design.id, { accountingStock: next });
    setDesigns((ds) => (ds ? ds.map((d) => (d.id === design.id ? { ...d, accountingStock: next } : d)) : ds));
    setStockEdit(false);
    toast.success("Opening stock updated");
  };

  /** Persist a new image list (positional: [front, rear, ...other]). */
  const saveImages = async (next: DesignImage[]) => {
    if (!design) return false;
    const res = await update("Design", design.id, {
      image_urls: JSON.stringify(next),
      image_url: next[0]?.id || "",
    });
    if (!res.ok) {
      toast.error(res.error || "Could not save images");
      return false;
    }
    // Patch only the selected item — no full refetch (keeps the list + scroll put).
    const patch: Partial<DesignRow> = { images: next, imageUrl: next[0]?.id || "" };
    setDesigns((prev) => (prev ? prev.map((d) => (d.id === design.id ? { ...d, ...patch } : d)) : prev));
    patchDesignCache(design.id, patch);
    return true;
  };

  const onDeleteItem = async () => {
    if (!design) return;
    const reason = await confirmDelete({ message: `Are you sure you want to delete item "${design.uniqueName || design.designName}"? This cannot be undone.` });
    if (reason == null) return;
    setBusy(true);
    const res = await deleteDesign(design.id, reason);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Item deleted");
    navigate("/design");
  };

  const onToggleStatus = async () => {
    if (!design) return;
    // Active/Inactive (renamed from Continue/Discontinued 2026-07); tolerate legacy values.
    const inactive = design.status === "Inactive" || design.status === "Discontinued";
    const next = inactive ? "Active" : "Inactive";
    setBusy(true);
    const res = await update("Design", design.id, { status: next });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Status change failed");
      return;
    }
    toast.success(`Marked as ${next}`);
    // Patch only the selected item — no full refetch.
    const patch: Partial<DesignRow> = { status: next };
    setDesigns((prev) => (prev ? prev.map((d) => (d.id === design.id ? { ...d, ...patch } : d)) : prev));
    patchDesignCache(design.id, patch);
  };

  const moreItems = [
    ...(can("items", "create") && design ? [{ label: "Clone", onClick: () => navigate(`/design/${design.id}/clone`) }] : []),
    ...(can("items", "edit") && design
      ? [{ label: design.status === "Inactive" || design.status === "Discontinued" ? "Mark as Active" : "Mark as Inactive", onClick: () => void onToggleStatus() }]
      : []),
    ...(can("items", "delete") ? [{ label: "Delete", danger: true, onClick: () => void onDeleteItem() }] : []),
  ];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {breakdown && <StockBreakdownModal bd={breakdown} onClose={() => setBreakdown(null)} />}
      {openingOpen && design && (
        <OpeningStockForm
          designId={design.id}
          designName={design.designName}
          locked={stockLocked}
          onSaved={() => { setOpeningOpen(false); reloadStock(); }}
          onClose={() => setOpeningOpen(false)}
        />
      )}
      {ipOpen && design && (
        <InProductionModal label={design.designName} total={inProduction} orders={stock.inProductionOrders} onClose={() => setIpOpen(false)} />
      )}
      {/* Shrunk item list (#13.4) — fixed viewport height with its OWN scroll
          (the page never scrolls with it), sticky while the detail scrolls.
          Drag the bottom-right corner to resize the width. */}
      <div
        className="card"
        style={{
          width: 300,
          minWidth: 220,
          maxWidth: 420,
          flexShrink: 0,
          padding: 0,
          resize: "horizontal",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          /* header-h + 12px sticky top + 12px bottom gap = flush with viewport bottom */
          height: "calc(100vh - var(--header-h) - 24px)",
          position: "sticky",
          top: 12,
        }}
      >
        <div className="lp-search">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {/* overscrollBehavior contain: reaching the list's end must not
            hand the wheel over to the page. flex:1 fills the card bottom. */}
        <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
          {listed.map((d) => {
            const cur = d.id === id;
            return (
              <Link
                key={d.id}
                to={`/design/${d.id}`}
                style={{
                  display: "block",
                  padding: "9px 12px",
                  borderBottom: "1px solid var(--border)",
                  background: cur ? "var(--accent-soft)" : "transparent",
                  color: "inherit",
                  textDecoration: "none",
                }}
                title={d.uniqueName || d.designName}
              >
                <div
                  style={{
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {d.uniqueName || d.designName}
                </div>
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                  SKU: <span className="mono">{d.sku || "—"}</span>
                </div>
              </Link>
            );
          })}
          {listed.length === 0 && <div className="dim" style={{ padding: 12 }}>No matching items</div>}
        </div>
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!design ? (
          <div className="card" style={{ padding: 20 }}>
            <EmptyState title="Item not found" hint="Pick an item from the list" />
          </div>
        ) : (
          <>
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              {/* Header inside the card so it top-aligns with the item list (Zoho-style). */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  className="title"
                  style={{ flex: 1, minWidth: 0, fontSize: 28, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={design.uniqueName || design.designName}
                >
                  {design.uniqueName || design.designName}
                </div>
                {can("items", "edit") && (
                  <button className="hbtn" onClick={() => navigate(`/design/${design.id}/edit`)} title="Edit item">
                    <Icon name="edit" size={13} />
                    Edit
                  </button>
                )}
                <MoreMenu items={moreItems} />
                <button className="btn x" onClick={() => navigate("/design")} title="Close">
                  <Icon name="x" size={13} />
                </button>
              </div>
              <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                SKU: <span className="mono">{design.sku || "—"}</span>
                {design.status && (
                  <span className={design.status === "Inactive" || design.status === "Discontinued" ? "dim" : ""} style={{ marginLeft: 10 }}>
                    · {design.status}
                  </span>
                )}
              </div>

              {/* Overview | Production tabs (batch-wise production lives under Production). */}
              <div className="row" style={{ gap: 4, marginTop: 12, borderBottom: "1px solid var(--border)" }}>
                <button onClick={() => setTab("overview")} style={tabStyle(tab === "overview")}>Overview</button>
                <button onClick={() => setTab("stock")} style={tabStyle(tab === "stock")}>Production</button>
                {whEnabled && <button onClick={() => setTab("locations")} style={tabStyle(tab === "locations")}>Locations</button>}
              </div>

              {tab === "locations" && (
                <div style={{ marginTop: 14, overflow: "auto" }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th>Batch</th>
                        <th className="num" style={{ textAlign: "right" }}>Stock on hand</th>
                        <th className="num" style={{ textAlign: "right" }}>Committed</th>
                        <th className="num" style={{ textAlign: "right" }}>Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locationRows.length === 0 && (
                        <tr>
                          <td colSpan={5} className="dim" style={{ padding: "14px 10px" }}>This item is not in stock at any location.</td>
                        </tr>
                      )}
                      {locationRows.map((w) => (
                        <Fragment key={w.warehouseId}>
                          <tr>
                            <td style={{ fontWeight: 600 }}>{w.warehouse}{warehouses.find((x) => x.id === w.warehouseId)?.isPrimary ? <span className="dim" title="Stock recorded without a warehouse counts here"> ★</span> : null}</td>
                            <td className="dim">{w.batches.length ? `${w.batches.length} batch${w.batches.length === 1 ? "" : "es"}` : "—"}</td>
                            <td className="num mono" style={{ fontWeight: 600 }}>{fmt(w.onHand)}</td>
                            <td className="num mono">{w.committed ? fmt(w.committed) : <span className="dim">—</span>}</td>
                            <td className="num mono" style={{ color: "var(--c-green)" }}>{fmt(Math.max(0, w.onHand - w.committed))}</td>
                          </tr>
                          {w.batches.map((c) => (
                            <tr key={`${c.key} ${c.warehouseId}`}>
                              <td />
                              <td className="mono" style={{ paddingLeft: 24 }}>{c.key.slice(c.key.indexOf("|") + 1) || <span className="dim" title="Unbatched stock">—</span>}{c.over > 0 ? <span title={`${fmt(c.over)} more left than this warehouse ever held — check the transfers`} style={{ color: "var(--c-amber)" }}> ⚠</span> : null}</td>
                              <td className="num mono">{fmt(c.onHand)}</td>
                              <td className="num mono">{c.committed ? fmt(c.committed) : <span className="dim">—</span>}</td>
                              <td className="num mono">{fmt(Math.max(0, c.onHand - c.committed))}</td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                    {locationRows.length > 0 && (
                      <tfoot>
                        <tr>
                          <td style={{ fontWeight: 600 }}>Total</td>
                          <td />
                          <td className="num mono" style={{ fontWeight: 700 }}>{fmt(locationTotals.onHand)}</td>
                          <td className="num mono" style={{ fontWeight: 700 }}>{fmt(locationTotals.committed)}</td>
                          <td className="num mono" style={{ fontWeight: 700, color: "var(--c-green)" }}>{fmt(Math.max(0, locationTotals.onHand - locationTotals.committed))}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                  {palletRows.length > 0 && (
                    // CR-412: palletized boxes left the loose-stock figures above — this is where their pallets stand.
                    <table className="tbl" style={{ marginTop: 14 }}>
                      <thead>
                        <tr>
                          <th>On pallets at</th>
                          <th>Pallet lines</th>
                          <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {palletRows.map((r) => (
                          <tr key={r.warehouseId}>
                            <td style={{ fontWeight: 600 }}>{r.warehouse}</td>
                            <td className="dim">{r.lines}</td>
                            <td className="num mono" style={{ fontWeight: 600 }}>{fmt(r.boxes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>Move stock between locations with a Transfer Order (Inventory ▸ Transfer Orders). Only locations holding this item are listed.</div>
                </div>
              )}

              {tab === "stock" && (
                <div style={{ marginTop: 14 }}>
                  {/* Batch-tracked items carry opening stock as batches too. */}
                  {isBatched && can("items", "edit") && (!stockLocked || isAdmin()) && (
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                      <button className="btn" onClick={() => setOpeningOpen(true)} title={stockLocked ? "Add opening batch — admin (reason required)" : "Add opening stock batches"}>
                        <Icon name="plus" size={12} /> Opening stock
                      </button>
                    </div>
                  )}
                  <div style={{ overflow: "auto" }}>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Batch</th>
                          <th className="num" style={{ textAlign: "right" }}>Qty</th>
                          <th>Mfg date</th>
                          <th>Remark</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {myProductionRows.map((r) => (
                          <tr key={r.id}>
                            <td className="mono">{r.batchNumber || <span className="dim">—</span>}</td>
                            <td className="num mono" style={r.kind === "adjust" ? { color: r.qtyBoxes < 0 ? "var(--c-red)" : "var(--c-green)" } : undefined}>{r.kind === "adjust" && r.qtyBoxes > 0 ? "+" : ""}{fmt(r.qtyBoxes)}</td>
                            <td>{r.productionDate || <span className="dim">—</span>}</td>
                            <td>{r.note || <span className="dim">—</span>}</td>
                            <td>{r.kind === "opening" ? <span className="chip">Opening</span> : r.kind === "adjust" ? <span className="chip">Adjust</span> : ""}</td>
                          </tr>
                        ))}
                        {myProductionRows.length === 0 && (
                          <tr>
                            <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 18 }}>
                              No production yet — record production against a batch to see it here.
                            </td>
                          </tr>
                        )}
                      </tbody>
                      {myProductionRows.length > 0 && (
                        <tfoot>
                          <tr>
                            <td style={{ fontWeight: 600 }}>Total production</td>
                            <td className="num mono" style={{ fontWeight: 700 }}>{fmt(productionTotal)}</td>
                            <td colSpan={3} />
                          </tr>
                          <tr>
                            <td style={{ fontWeight: 600 }}>Total stock</td>
                            <td className="num mono" style={{ fontWeight: 700, color: availableStock < 0 ? "var(--c-red)" : "var(--c-green)" }}>{fmt(availableStock)}</td>
                            <td colSpan={3} />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              )}

              {tab === "overview" && (
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 14 }}>
              <div style={{ flex: "1 1 340px", minWidth: 280 }}>
                <div className="form-section-title" style={{ marginBottom: 8 }}>Primary Details</div>
                <DetailRow label="Unique Item Name" value={design.uniqueName || "—"} />
                <DetailRow label="SKU" value={design.sku || "—"} />
                <DetailRow label="Short Code" value={design.seqCode || "—"} />
                <DetailRow label="Design Name" value={design.designName || "—"} />
                <DetailRow label="Base Design Name" value={design.baseDesignName || design.designName} /> {/* CR-437: blank = the Design Name */}
                {/* CR-392/393: owner, buyer and the buyer's brand */}
                <DetailRow label="Design Owner" value={customerName(design.designOwnerId) || "—"} />
                <DetailRow label="Custom Design Buyer" value={customerName(design.designBuyerId) || "—"} />
                <DetailRow label="Buyer Brand" value={design.partyBrandName || "—"} />
                <DetailRow label="Size" value={design.sizeLabel || "—"} />
                <DetailRow label="Pcs Per Packing" value={design.pcsPerBox ? fmt(design.pcsPerBox) : "—"} />
                <DetailRow label="Finish" value={design.finishLabel || "—"} />
                <DetailRow label="Brand" value={design.brandLabel || "—"} />
                <DetailRow label="Category" value={design.categoryLabel || "—"} />
                <DetailRow label="Surface Application" value={design.surfaceApplicationLabel || "—"} />
                <DetailRow label="Punch Type" value={design.punchLabel || "—"} />
                <DetailRow label="Glaze" value={design.glazeLabel || "—"} />
                <DetailRow label="Grade" value={design.gradeLabel || "—"} />
                <DetailRow label="Random Faces" value={design.randomFaces ? fmt(design.randomFaces) : "—"} />
                {/* Marketing Data (CR-394) */}
                <DetailRow label="Collection" value={design.collectionName || "—"} />
                <DetailRow label="Series" value={design.seriesLabel || "—"} />
                <DetailRow label="Catalogue" value={design.catalogueLabel || "—"} />
                {/* Status omitted — shown in the header subtitle, not repeated here. */}
                <DetailRow label="Rate / m²" value={design.ratePerSqmt ? fmt(design.ratePerSqmt) : "—"} />
                <DetailRow
                  label="Coverage / box"
                  value={design.coverageSqm ? `${design.coverageSqm} m² · ${design.coverageSqft} ft²` : "—"}
                />
                {/* CR-190: box weight (Size default, per-item override) + derived per-piece / per-m². */}
                <DetailRow
                  label="Box weight"
                  value={(() => {
                    if (!design.boxWeightKg) return "—";
                    const w = computeWeights(rowToValues(design));
                    return [`${design.boxWeightKg} kg`, w.perPc && `${w.perPc} kg/pc`, w.perSqm && `${w.perSqm} kg/m²`].filter(Boolean).join(" · ");
                  })()}
                />
                <DetailRow label="Created" value={fmtLocalDateTime(design.createdTime)} />
                <DetailRow label="Modified" value={fmtLocalDateTime(design.modifiedTime)} />
              </div>

              {/* Inventory Image Upload (#12): positional slots over image_urls. */}
              <div
                style={{ flex: "0 1 340px", minWidth: 280, border: "1px solid var(--border)", borderRadius: 10, padding: 14, alignSelf: "flex-start" }}
              >
                <ImageManager images={design.images} canEdit={can("items", "edit")} onSave={saveImages} />

                {/* Live stock summary — below the image (2026-07 request). */}
                <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                  <div className="form-section-title" style={{ marginBottom: 8 }}>Stock</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
                    <span className="dim" style={{ fontSize: "var(--t-sm)" }}>Opening stock</span>
                    {isBatched ? (
                      // Batch-tracked: opening is entered as batches (Production tab).
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <span className="mono">{fmt(openingStock)}</span>
                        {can("items", "edit") && (!stockLocked || isAdmin()) && (
                          <button
                            className="btn x"
                            title={stockLocked ? "Locked after first entry — admin edit (reason required)" : "Add opening stock batches"}
                            onClick={() => setOpeningOpen(true)}
                          >
                            <Icon name={stockLocked ? "lock" : "edit"} size={11} />
                          </button>
                        )}
                      </span>
                    ) : stockEdit ? (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {stockLocked && (
                          <input
                            type="text"
                            value={stockReason}
                            placeholder="Reason for change *"
                            onChange={(e) => setStockReason(e.target.value)}
                            style={{ width: 150 }}
                          />
                        )}
                        <NumberInput
                          value={stockVal}
                          placeholder={String(openingStock)}
                          onChange={(e) => setStockVal(e.target.value)}
                          style={{ width: 90, textAlign: "right" }}
                          autoFocus
                        />
                        <button className="btn" disabled={stockBusy} onClick={() => void saveOpeningStock()} title="Save">
                          {stockBusy ? "…" : <Icon name="check" size={12} />}
                        </button>
                        <button className="btn x" onClick={() => setStockEdit(false)} title="Cancel">✕</button>
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <span className="mono">{fmt(openingStock)}</span>
                        {can("items", "edit") && (!stockLocked || isAdmin()) && (
                          <button
                            className="btn x"
                            title={stockLocked ? "Locked after first save — admin edit (reason required)" : "Edit opening stock"}
                            onClick={() => {
                              setStockVal("");
                              setStockReason("");
                              setStockEdit(true);
                            }}
                          >
                            <Icon name={stockLocked ? "lock" : "edit"} size={11} />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  <StockRow label="In production" value={inProduction} onClick={inProduction > 0 ? () => setIpOpen(true) : undefined} />
                  <StockRow label="Awaiting palletization" value={awaitingPal} onClick={() => setBreakdown(bdAwaitingPal)} />
                  <StockRow label="In loading" value={inLoading} onClick={() => setBreakdown(bdInLoading)} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0 0", marginTop: 4, borderTop: "1px solid var(--border)" }}>
                    <span style={{ fontWeight: 600, fontSize: "var(--t-sm)" }}>Available stock</span>
                    <span className="mono" style={{ fontWeight: 700, color: availableStock < 0 ? "var(--c-red)" : "var(--c-green)" }}>{fmt(availableStock)}</span>
                  </div>
                </div>
              </div>
              </div>
              )}
            </div>

            {tab === "overview" && (
            <>
            {SHOW_PARTY_PANEL && (
              <>
                <div className="card">
                  <div style={{ overflow: "auto" }}>
                    <table className="tbl">
                      <thead>
                        <tr>
                          {/* PO Number column hidden per request 2026-07 — restore when POs go live. */}
                          <th>Customer</th>
                          <th className="num" style={{ textAlign: "right" }}>Order Qty</th>
                          <th>Stage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o.id}>
                            <td>{o.flag} {o.party}</td>
                            <td className="num mono">{fmt(o.orderQty)}</td>
                            <td>{o.stage}</td>
                          </tr>
                        ))}
                        {orders.length === 0 && (
                          <tr>
                            <td colSpan={3} className="muted" style={{ textAlign: "center", padding: 18 }}>
                              No orders use this item.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {openQty > 0 && (
                  <div className="dim" style={{ marginTop: 8, fontSize: "var(--t-sm)" }}>
                    Open quantity across orders: {fmt(openQty)}
                  </div>
                )}
              </>
            )}

            {/* Audit trail (#10.2): who created / changed this item, from OperationLog. */}
            <div className="form-section-title" style={{ margin: "16px 0 8px" }}>Activity</div>
            <ActivityLog table="Design" entityId={design.id} />
            </>
            )}

          </>
        )}
      </div>
    </div>
  );
}
