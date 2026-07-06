/* ============================================================
   Item (Design) detail — Zoho-Inventory-style split view (#13/#14).
   Left: resizable, searchable list of Unique Item Names (+ SKU).
   Right: header with Edit / More (Delete, Mark as Discontinued) / ✕,
   Primary Details, and the Inventory Image Upload manager (#12) —
   Front / Rear / Other slots, positional over image_urls
   (front = [0], rear = [1], other = rest).
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
import { cachedDesigns, deleteDesign, invalidateDesigns, listDesigns, type DesignRow } from "./designsApi";

const MAX_IMAGES = 5;

/* STUB: Zoho Books field mapping — blocked on the Books item reference.
   These render as placeholder rows until the mapping is confirmed. */
const ZOHO_STUB_FIELDS = ["HSN Code", "Unit", "Tax Preference", "Inventory Account", "Valuation Method"];

function DetailRow({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="dim" style={{ width: 160, flexShrink: 0, fontSize: "var(--t-sm)" }}>{label}</span>
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

/** One image slot: preview + delete when filled, an upload tile when empty. */
function ImageSlot({
  label,
  imageId,
  busy,
  size = 110,
  onUpload,
  onDelete,
}: {
  label: string;
  imageId?: string;
  busy: boolean;
  size?: number;
  onUpload?: (f: File) => void;
  onDelete?: () => void;
}) {
  return (
    <div>
      <div className="dim" style={{ fontSize: "var(--t-sm)", marginBottom: 6 }}>{label}</div>
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
      ) : onUpload ? (
        <label
          className="btn"
          style={{ width: size, height: size, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, borderStyle: "dashed", cursor: busy ? "wait" : "pointer" }}
        >
          <Icon name="plus" size={14} />
          <span style={{ fontSize: "var(--t-sm)" }}>{busy ? "Uploading…" : "Upload"}</span>
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
        </label>
      ) : null}
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
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    const res = await update("Design", design.id, {
      image_urls: JSON.stringify(next),
      image_url: next[0] || "",
    });
    if (!res.ok) toast.error(res.error || "Could not save images");
    invalidateDesigns();
    await refresh();
    setBusy(false);
  };

  const uploadTo = async (slot: number, f: File) => {
    if (!design) return;
    if (design.images.length >= MAX_IMAGES) {
      toast.info(`Only ${MAX_IMAGES} images allowed`);
      return;
    }
    setBusy(true);
    try {
      const fileId = await uploadDesignImage(f);
      const next = [...design.images];
      next.splice(Math.min(slot, next.length), 0, fileId);
      await saveImages(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
      setBusy(false);
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
    const next = design.status === "Discontinued" ? "Continue" : "Discontinued";
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
      ? [{ label: design.status === "Discontinued" ? "Mark as Continue" : "Mark as Discontinued", onClick: () => void onToggleStatus() }]
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
          height: "calc(100vh - 120px)",
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
                  <span className={design.status === "Discontinued" ? "dim" : ""} style={{ marginLeft: 10 }}>
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
                {/* STUB: Zoho Books mapping — blocked on reference. */}
                {ZOHO_STUB_FIELDS.map((f) => (
                  <DetailRow key={f} label={f} value="—" dim />
                ))}
              </div>

              {/* Inventory Image Upload (#12): positional slots over image_urls. */}
              <div
                style={{ flex: "0 1 340px", minWidth: 280, border: "1px solid var(--border)", borderRadius: 10, padding: 14, alignSelf: "flex-start" }}
              >
                <div style={{ display: "flex", gap: 18, marginBottom: 14 }}>
                  <ImageSlot
                    label="Front View"
                    imageId={design.images[0]}
                    busy={busy}
                    onUpload={(f) => void uploadTo(0, f)}
                    onDelete={() => void deleteAt(0)}
                  />
                  <ImageSlot
                    label="Rear View"
                    imageId={design.images[1]}
                    busy={busy}
                    onUpload={(f) => void uploadTo(1, f)}
                    onDelete={() => void deleteAt(1)}
                  />
                </div>
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginBottom: 6 }}>Other Images</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                  {design.images.slice(2).map((imgId, i) => (
                    <ImageSlot
                      key={imgId + i}
                      label=""
                      imageId={imgId}
                      busy={busy}
                      size={64}
                      onDelete={() => void deleteAt(i + 2)}
                    />
                  ))}
                  {design.images.length < MAX_IMAGES && (
                    <ImageSlot label="" busy={busy} size={64} onUpload={(f) => void uploadTo(design.images.length, f)} />
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
                      <th>PO Number</th>
                      <th>Party</th>
                      <th className="num" style={{ textAlign: "right" }}>Order Qty</th>
                      <th>Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td className="mono" style={{ color: "var(--fg)" }}>{o.poNumber}</td>
                        <td>{o.flag} {o.party}</td>
                        <td className="num mono">{fmt(o.orderQty)}</td>
                        <td>{o.stage}</td>
                      </tr>
                    ))}
                    {orders.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 18 }}>
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
      </div>
    </div>
  );
}
