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
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fmt } from "@/lib/format";
import { can } from "@/lib/auth";
import { designImageUrl, uploadDesignImage } from "@/lib/api";
import { update } from "@/lib/dataOps";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { SkeletonRows, EmptyState } from "@/ui/States";
import { useOrders } from "@/features/orders/useOrders";
import { ActivityLog } from "@/features/common/RecordDetail";
import { DetailRow, MoreMenu } from "@/features/common/DetailBits";
import { fmtLocalDateTime } from "@/lib/format";
import { cachedDesigns, deleteDesign, listDesigns, patchDesignCache, type DesignImage, type DesignRow } from "./designsApi";

const MAX_IMAGES = 5;

/* Related-orders "Party" panel hidden per 2026-07 request — flip to true to
   restore the Party / Order Qty / Stage table + open-quantity line. */
const SHOW_PARTY_PANEL = false;

/* STUB: Zoho Books field mapping — blocked on the Books item reference.
   HSN Code / Tax Preference / Inventory Account / Valuation Method removed
   per 2026-07 request; only Unit remains as a placeholder row. */
const ZOHO_STUB_FIELDS = ["Unit"];

/** One image slot: preview + delete when filled, a passive placeholder when
    empty (uploads all go through the single "Add Image" button). */
/** One label/number row in the stock summary. */
function StockRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
      <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{label}</span>
      <span className="mono">{fmt(value)}</span>
    </div>
  );
}

function ImageSlot({
  label,
  imageId,
  name,
  busy,
  size = 110,
  onDelete,
  onOpen,
}: {
  label: string;
  imageId?: string;
  name?: string;
  busy: boolean;
  size?: number;
  onDelete?: () => void;
  onOpen?: () => void;
}) {
  return (
    <div style={{ maxWidth: size }}>
      <div className="muted" style={{ fontSize: "var(--t-sm)", marginBottom: 6 }}>{label}</div>
      {imageId ? (
        <div style={{ position: "relative", width: size }}>
          <img
            src={designImageUrl(imageId)}
            alt={label}
            onClick={onOpen}
            title={onOpen ? "Click to view" : undefined}
            style={{ width: size, height: size, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", cursor: onOpen ? "zoom-in" : "default" }}
          />
          {onDelete && (
            <button
              type="button"
              className="btn"
              title={`Delete ${label}`}
              onClick={onDelete}
              disabled={busy}
              style={{ position: "absolute", top: -8, right: -8, width: 20, height: 20, padding: 0, borderRadius: "50%", lineHeight: "18px", background: "var(--panel)" }}
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        <div
          className="dim"
          style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed var(--border)", borderRadius: 8, fontSize: "var(--t-sm)" }}
        >
          No image
        </div>
      )}
      {name && (
        <div
          className="dim"
          style={{ fontSize: "var(--t-sm)", marginTop: 4, maxWidth: size, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={name}
        >
          {name}
        </div>
      )}
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
  const [imgBusy, setImgBusy] = useState(false); // image upload/save only — keeps slots calm during status changes
  const [viewer, setViewer] = useState<number | null>(null); // lightbox: index into design.images
  const [uploads, setUploads] = useState<{ name: string; status: "pending" | "done" | "error" }[]>([]); // per-file upload progress
  const [stockEdit, setStockEdit] = useState(false); // inline Opening-stock edit
  const [stockVal, setStockVal] = useState("");
  const [stockBusy, setStockBusy] = useState(false);

  const refresh = () => listDesigns().then((res) => setDesigns(res.ok ? res.designs : (cachedDesigns() ?? [])));
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (designs === null) return <SkeletonRows rows={6} />;

  const design = designs.find((d) => d.id === id) ?? null;
  const needle = q.trim().toLowerCase();
  const listed = needle
    ? designs.filter((d) => `${d.uniqueName || d.designName} ${d.sku}`.toLowerCase().includes(needle))
    : designs;

  const orders = design ? allOrders.filter((o) => o.design === design.designName) : [];
  const openQty = orders.reduce((s, o) => s + (o.orderQty - o.loadedQty), 0);

  // Live stock summary (derived from order lines + the manual Opening stock).
  const openingStock = design?.accountingStock ?? 0;
  const producedTot = orders.reduce((s, o) => s + o.producedQty, 0);
  const loadedTot = orders.reduce((s, o) => s + o.loadedQty, 0);
  const inProduction = orders.reduce((s, o) => s + Math.max(0, o.orderQty - o.producedQty), 0);
  const inLoading = orders.reduce((s, o) => s + Math.max(0, o.palletizedQty - o.loadedQty), 0);
  const availableStock = openingStock + producedTot - loadedTot;

  const saveOpeningStock = async () => {
    if (!design) return;
    const next = Math.max(0, parseInt(stockVal, 10) || 0);
    setStockBusy(true);
    const res = await update("Design", design.id, { accounting_stock: next });
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
    if (!design) return;
    setImgBusy(true);
    const res = await update("Design", design.id, {
      image_urls: JSON.stringify(next),
      image_url: next[0]?.id || "",
    });
    if (!res.ok) {
      toast.error(res.error || "Could not save images");
      setImgBusy(false);
      return;
    }
    // Patch only the selected item — no full refetch (keeps the list + scroll put).
    const patch: Partial<DesignRow> = { images: next, imageUrl: next[0]?.id || "" };
    setDesigns((prev) => (prev ? prev.map((d) => (d.id === design.id ? { ...d, ...patch } : d)) : prev));
    patchDesignCache(design.id, patch);
    setImgBusy(false);
  };

  /** Multi-select upload (2026-07 request): pick many at once, fill the
      remaining slots in order, cap at MAX_IMAGES, skip non-images. */
  const uploadMany = async (files: FileList | null) => {
    if (!design || !files || files.length === 0) return;
    const room = MAX_IMAGES - design.images.length;
    if (room <= 0) {
      toast.info(`Only ${MAX_IMAGES} images allowed`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) toast.info(`Only ${MAX_IMAGES} images allowed — extra files skipped.`);
    setImgBusy(true);
    // Separate per-file progress (2026-07 request): each picked file shows
    // pending → done/error while the batch uploads.
    setUploads(picked.map((f) => ({ name: f.name, status: "pending" as const })));
    const added: DesignImage[] = [];
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i];
      if (!f.type.startsWith("image/")) {
        toast.error(`${f.name} is not an image`);
        setUploads((p) => p.map((u, j) => (j === i ? { ...u, status: "error" } : u)));
        continue;
      }
      try {
        added.push(await uploadDesignImage(f));
        setUploads((p) => p.map((u, j) => (j === i ? { ...u, status: "done" } : u)));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Upload failed: ${f.name}`);
        setUploads((p) => p.map((u, j) => (j === i ? { ...u, status: "error" } : u)));
      }
    }
    if (added.length) await saveImages([...design.images, ...added]);
    else setImgBusy(false);
    window.setTimeout(() => setUploads([]), 1500);
  };

  const deleteAt = async (idx: number) => {
    if (!design) return;
    if (!(await confirmDialog({ message: "Are you sure you want to delete this image?", danger: true }))) return;
    await saveImages(design.images.filter((_, i) => i !== idx));
  };

  const onDeleteItem = async () => {
    if (!design) return;
    if (!(await confirmDialog({ message: `Are you sure you want to delete item "${design.uniqueName || design.designName}"? This cannot be undone.`, danger: true }))) return;
    setBusy(true);
    const res = await deleteDesign(design.id);
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
                  style={{ flex: 1, minWidth: 0, fontSize: 26, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
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

              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 14 }}>
              <div style={{ flex: "1 1 340px", minWidth: 280 }}>
                <div className="form-section-title" style={{ marginBottom: 8 }}>Primary Details</div>
                <DetailRow label="Unique Item Name" value={design.uniqueName || "—"} />
                <DetailRow label="SKU" value={design.sku || "—"} />
                <DetailRow label="Short Code" value={design.seqCode || "—"} />
                <DetailRow label="Design Name" value={design.designName || "—"} />
                <DetailRow label="Customer Brand" value={design.partyBrandName || "—"} />
                <DetailRow label="Size" value={design.sizeLabel || "—"} />
                <DetailRow label="Finish" value={design.finishLabel || "—"} />
                <DetailRow label="Brand" value={design.brandLabel || "—"} />
                <DetailRow label="Category" value={design.categoryLabel || "—"} />
                <DetailRow label="Glaze" value={design.glazeLabel || "—"} />
                <DetailRow label="Grade" value={design.gradeLabel || "—"} />
                <DetailRow label="Status" value={design.status || "—"} />
                <DetailRow label="Rate / m²" value={design.ratePerSqmt ? fmt(design.ratePerSqmt) : "—"} />
                <DetailRow
                  label="Coverage / box"
                  value={design.coverageSqm ? `${design.coverageSqm} m² · ${design.coverageSqft} ft²` : "—"}
                />
                <DetailRow label="Pcs / Box" value={design.pcsPerBox ? String(design.pcsPerBox) : "—"} />
                <DetailRow label="Created" value={fmtLocalDateTime(design.createdTime)} />
                <DetailRow label="Modified" value={fmtLocalDateTime(design.modifiedTime)} />
                {/* STUB: Zoho Books mapping — blocked on reference. */}
                {ZOHO_STUB_FIELDS.map((f) => (
                  <DetailRow key={f} label={f} value="—" dim />
                ))}
              </div>

              {/* Inventory Image Upload (#12): positional slots over image_urls. */}
              <div
                style={{ flex: "0 1 340px", minWidth: 280, border: "1px solid var(--border)", borderRadius: 10, padding: 14, alignSelf: "flex-start" }}
              >
                {/* One "Add Image" button (2026-07 request) — fills slots in order. */}
                <div style={{ display: "flex", gap: 18, marginBottom: 14 }}>
                  <ImageSlot
                    label="Front View"
                    imageId={design.images[0]?.id}
                    name={design.images[0]?.name}
                    busy={imgBusy}
                    onDelete={() => void deleteAt(0)}
                    onOpen={design.images[0] ? () => setViewer(0) : undefined}
                  />
                  <ImageSlot
                    label="Rear View"
                    imageId={design.images[1]?.id}
                    name={design.images[1]?.name}
                    busy={imgBusy}
                    onDelete={() => void deleteAt(1)}
                    onOpen={design.images[1] ? () => setViewer(1) : undefined}
                  />
                </div>
                <div className="muted" style={{ fontSize: "var(--t-sm)", marginBottom: 6 }}>Other Images</div>
                {/* List rows (2026-07 request) — tiny inline preview + open/delete, not thumbnail tiles. */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {design.images.slice(2).map((img, i) => (
                    <div
                      key={img.id + i}
                      className="row"
                      style={{ gap: 8, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 8 }}
                    >
                      <img
                        src={designImageUrl(img.id)}
                        alt={img.name || `Image ${i + 3}`}
                        onClick={() => setViewer(i + 2)}
                        title="Click to view"
                        style={{ width: 26, height: 26, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)", flexShrink: 0, cursor: "zoom-in" }}
                      />
                      <button
                        type="button"
                        onClick={() => setViewer(i + 2)}
                        title={img.name || `Image ${i + 3}`}
                        style={{ fontSize: "var(--t-sm)", color: "var(--accent)", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}
                      >
                        {img.name || `Image ${i + 3}`}
                      </button>
                      <div style={{ flex: 1 }} />
                      <button
                        type="button"
                        className="btn x"
                        disabled={imgBusy}
                        onClick={() => void deleteAt(i + 2)}
                        title="Delete image"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {design.images.slice(2).length === 0 && (
                    <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "2px 0" }}>No other images</div>
                  )}
                  {design.images.length < MAX_IMAGES && (
                    <label
                      className="btn"
                      style={{ alignSelf: "flex-start", marginTop: 4, cursor: imgBusy ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                      <Icon name="plus" size={12} />
                      {imgBusy ? "Uploading…" : "Add Image"}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={imgBusy}
                        style={{ display: "none" }}
                        onChange={(e) => {
                          void uploadMany(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  {uploads.length > 0 && (
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                      <div className="muted" style={{ fontSize: "var(--t-sm)" }}>Uploading…</div>
                      {uploads.map((u, i) => (
                        <div key={i} style={{ fontSize: "var(--t-sm)", display: "flex", gap: 6, alignItems: "center" }}>
                          <span style={{ width: 12, textAlign: "center", color: u.status === "done" ? "var(--c-green)" : u.status === "error" ? "var(--c-red)" : "var(--dim)" }}>
                            {u.status === "done" ? "✓" : u.status === "error" ? "✗" : "…"}
                          </span>
                          <span className="dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="dim" style={{ marginTop: 10, fontSize: "var(--t-sm)" }}>
                  {design.images.length}/{MAX_IMAGES}
                </div>

                {/* Live stock summary — below the image (2026-07 request). */}
                <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                  <div className="form-section-title" style={{ marginBottom: 8 }}>Stock</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
                    <span className="dim" style={{ fontSize: "var(--t-sm)" }}>Opening stock</span>
                    {stockEdit ? (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="number"
                          min={0}
                          value={stockVal}
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
                        {can("items", "edit") && (
                          <button
                            className="btn x"
                            title="Edit opening stock"
                            onClick={() => {
                              setStockVal(String(openingStock));
                              setStockEdit(true);
                            }}
                          >
                            <Icon name="edit" size={11} />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  <StockRow label="In production" value={inProduction} />
                  <StockRow label="In loading" value={inLoading} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0 0", marginTop: 4, borderTop: "1px solid var(--border)" }}>
                    <span style={{ fontWeight: 600, fontSize: "var(--t-sm)" }}>Available stock</span>
                    <span className="mono" style={{ fontWeight: 700, color: availableStock < 0 ? "var(--c-red)" : "var(--c-green)" }}>{fmt(availableStock)}</span>
                  </div>
                  <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 6 }}>
                    Opening + produced ({fmt(producedTot)}) − loaded ({fmt(loadedTot)})
                  </div>
                </div>
              </div>
              </div>
            </div>

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

            {/* Image lightbox (2026-07 request): view + prev/next across all images. */}
            {viewer !== null && design.images[viewer] && (
              <div
                onClick={() => setViewer(null)}
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <button
                  className="btn x"
                  onClick={(e) => { e.stopPropagation(); setViewer(null); }}
                  title="Close"
                  style={{ position: "absolute", top: 16, right: 16 }}
                >
                  ✕
                </button>
                {design.images.length > 1 && (
                  <button
                    className="btn"
                    onClick={(e) => { e.stopPropagation(); setViewer((v) => (v === null ? 0 : (v - 1 + design.images.length) % design.images.length)); }}
                    title="Previous"
                    style={{ position: "absolute", left: 16, width: 40, height: 40, fontSize: 20, lineHeight: 1 }}
                  >
                    ‹
                  </button>
                )}
                <img
                  src={designImageUrl(design.images[viewer].id)}
                  alt={design.images[viewer].name || `Image ${viewer + 1}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ maxWidth: "88vw", maxHeight: "84vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}
                />
                {design.images.length > 1 && (
                  <button
                    className="btn"
                    onClick={(e) => { e.stopPropagation(); setViewer((v) => (v === null ? 0 : (v + 1) % design.images.length)); }}
                    title="Next"
                    style={{ position: "absolute", right: 16, bottom: "50%", width: 40, height: 40, fontSize: 20, lineHeight: 1 }}
                  >
                    ›
                  </button>
                )}
                <div style={{ position: "absolute", bottom: 16, color: "#fff", fontSize: "var(--t-sm)" }}>
                  {viewer + 1} / {design.images.length}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
