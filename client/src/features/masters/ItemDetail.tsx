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
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fmt } from "@/lib/format";
import { canDelete, canUpdate } from "@/lib/auth";
import { designImageUrl, uploadDesignImage } from "@/lib/api";
import { update } from "@/lib/dataOps";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { SkeletonRows, EmptyState } from "@/ui/States";
import { useOrders } from "@/features/orders/useOrders";
import { ActivityLog } from "@/features/common/RecordDetail";
import { fmtDateTime } from "@/lib/format";
import { cachedDesigns, deleteDesign, invalidateDesigns, listDesigns, type DesignRow } from "./designsApi";

const MAX_IMAGES = 5;

/* STUB: Zoho Books field mapping — blocked on the Books item reference.
   These render as placeholder rows until the mapping is confirmed. */
const ZOHO_STUB_FIELDS = ["HSN Code", "Unit", "Tax Preference", "Inventory Account", "Valuation Method"];

function DetailRow({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="muted" style={{ width: 160, flexShrink: 0, fontSize: "var(--t-sm)" }}>{label}</span>
      <span className={dim ? "dim" : ""} style={{ minWidth: 0, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

/** "More ▾" actions dropdown (Zoho-style) — reuses the .hdr-menu styles. */
function MoreMenu({ items }: { items: { label: string; danger?: boolean; onClick: () => void }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div className="hdr-pop" ref={ref}>
      <button className="hbtn" onClick={() => setOpen((v) => !v)} title="More actions">
        More <Icon name="more" size={13} />
      </button>
      {open && (
        <div className="hdr-menu" style={{ right: 0, width: 210, padding: 6 }}>
          {items.map((it) => (
            <button
              key={it.label}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                border: "none",
                background: "transparent",
                borderRadius: 6,
                cursor: "pointer",
                color: it.danger ? "var(--c-red)" : "inherit",
                font: "inherit",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-soft)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One image slot: preview + delete when filled, a passive placeholder when
    empty (uploads all go through the single "Add Image" button). */
function ImageSlot({
  label,
  imageId,
  busy,
  size = 110,
  onDelete,
}: {
  label: string;
  imageId?: string;
  busy: boolean;
  size?: number;
  onDelete?: () => void;
}) {
  return (
    <div>
      <div className="muted" style={{ fontSize: "var(--t-sm)", marginBottom: 6 }}>{label}</div>
      {imageId ? (
        <div style={{ position: "relative", width: size }}>
          <img
            src={designImageUrl(imageId)}
            alt={label}
            style={{ width: size, height: size, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
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

  /** Persist a new image list (positional: [front, rear, ...other]). */
  const saveImages = async (next: string[]) => {
    if (!design) return;
    setImgBusy(true);
    const res = await update("Design", design.id, {
      image_urls: JSON.stringify(next),
      image_url: next[0] || "",
    });
    if (!res.ok) toast.error(res.error || "Could not save images");
    invalidateDesigns();
    await refresh();
    setImgBusy(false);
  };

  const uploadTo = async (slot: number, f: File) => {
    if (!design) return;
    if (design.images.length >= MAX_IMAGES) {
      toast.info(`Only ${MAX_IMAGES} images allowed`);
      return;
    }
    setImgBusy(true);
    try {
      const fileId = await uploadDesignImage(f);
      const next = [...design.images];
      next.splice(Math.min(slot, next.length), 0, fileId);
      await saveImages(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
      setImgBusy(false);
    }
  };

  const deleteAt = async (idx: number) => {
    if (!design) return;
    if (!window.confirm("Delete this image?")) return;
    await saveImages(design.images.filter((_, i) => i !== idx));
  };

  const onDeleteItem = async () => {
    if (!design) return;
    if (!window.confirm(`Delete item "${design.uniqueName || design.designName}"? This cannot be undone.`)) return;
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
    invalidateDesigns();
    await refresh();
  };

  const moreItems = [
    ...(canUpdate() && design
      ? [{ label: design.status === "Inactive" || design.status === "Discontinued" ? "Mark as Active" : "Mark as Inactive", onClick: () => void onToggleStatus() }]
      : []),
    ...(canDelete() ? [{ label: "Delete", danger: true, onClick: () => void onDeleteItem() }] : []),
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
        <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
          <input
            type="text"
            placeholder="Search items…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        {/* overscrollBehavior contain: reaching the list's end must not
            hand the wheel over to the page. flex:1 fills the card bottom. */}
        <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
          {listed.map((d) => {
            const cur = d.id === id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => navigate(`/design/${d.id}`)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 12px",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  background: cur ? "var(--accent-soft)" : "transparent",
                  cursor: "pointer",
                  font: "inherit",
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
              </button>
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
                  style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={design.uniqueName || design.designName}
                >
                  {design.uniqueName || design.designName}
                </div>
                {canUpdate() && (
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
                <DetailRow label="Party Brand" value={design.partyBrandName || "—"} />
                <DetailRow label="Size" value={design.sizeLabel || "—"} />
                <DetailRow label="Finish" value={design.finishLabel || "—"} />
                <DetailRow label="Brand" value={design.brandLabel || "—"} />
                <DetailRow label="Category" value={design.categoryLabel || "—"} />
                <DetailRow label="Glaze" value={design.glazeLabel || "—"} />
                <DetailRow label="Grade" value={design.gradeLabel || "—"} />
                <DetailRow label="Status" value={design.status || "—"} />
                <DetailRow label="Rate / ft²" value={design.ratePerSqft ? fmt(design.ratePerSqft) : "—"} />
                <DetailRow label="Rate / m²" value={design.ratePerSqmt ? fmt(design.ratePerSqmt) : "—"} />
                <DetailRow
                  label="Coverage / box"
                  value={design.coverageSqm ? `${design.coverageSqm} m² · ${design.coverageSqft} ft²` : "—"}
                />
                <DetailRow label="Pcs / Box" value={design.pcsPerBox ? String(design.pcsPerBox) : "—"} />
                <DetailRow label="Created" value={fmtDateTime(design.createdTime)} />
                <DetailRow label="Modified" value={fmtDateTime(design.modifiedTime)} />
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
                    imageId={design.images[0]}
                    busy={imgBusy}
                    onDelete={() => void deleteAt(0)}
                  />
                  <ImageSlot
                    label="Rear View"
                    imageId={design.images[1]}
                    busy={imgBusy}
                    onDelete={() => void deleteAt(1)}
                  />
                </div>
                <div className="muted" style={{ fontSize: "var(--t-sm)", marginBottom: 6 }}>Other Images</div>
                {/* List rows (2026-07 request) — tiny inline preview + open/delete, not thumbnail tiles. */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {design.images.slice(2).map((imgId, i) => (
                    <div
                      key={imgId + i}
                      className="row"
                      style={{ gap: 8, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 8 }}
                    >
                      <img
                        src={designImageUrl(imgId)}
                        alt={`Image ${i + 3}`}
                        style={{ width: 26, height: 26, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)", flexShrink: 0 }}
                      />
                      <a
                        href={designImageUrl(imgId)}
                        target="_blank"
                        rel="noreferrer"
                        title="Open full image"
                        style={{ fontSize: "var(--t-sm)", color: "var(--fg-2)", textDecoration: "none" }}
                      >
                        Image {i + 3}
                      </a>
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
                        disabled={imgBusy}
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadTo(design.images.length, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
                <div className="dim" style={{ marginTop: 10, fontSize: "var(--t-sm)" }}>
                  {design.images.length}/{MAX_IMAGES}
                </div>
              </div>
              </div>
            </div>

            <div className="card">
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      {/* PO Number column hidden per request 2026-07 — restore when POs go live. */}
                      <th>Party</th>
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

            {/* Audit trail (#10.2): who created / changed this item, from OperationLog. */}
            <div className="form-section-title" style={{ margin: "16px 0 8px" }}>Activity</div>
            <ActivityLog table="Design" entityId={design.id} />
          </>
        )}
      </div>
    </div>
  );
}
