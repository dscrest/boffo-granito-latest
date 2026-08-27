/* ============================================================
   Shared Inventory Image manager (#12) — extracted from ItemDetail
   so other detail pages (Panel Craft) reuse the exact same UI.
   Positional over the record's image list (front = [0], rear = [1],
   other = rest). One "Add Image" button fills slots in order;
   Front/Rear are preview + delete only. Includes the lightbox.
   The owner persists the list via onSave (table-specific).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { designImageUrl, uploadDesignImage } from "@/lib/api";
import type { DesignImage } from "@/features/masters/designsApi";

export const MAX_IMAGES = 5;

/** One image slot: preview + delete when filled, a passive placeholder when
    empty (uploads all go through the single "Add Image" button). */
function ImageSlot({
  label,
  imageId,
  name,
  busy,
  size = 110,
  onDelete,
  onOpen,
  onUpload,
}: {
  label: string;
  imageId?: string;
  name?: string;
  busy: boolean;
  size?: number;
  onDelete?: () => void;
  onOpen?: () => void;
  /** Empty slot becomes a click-to-upload target (bug #5). */
  onUpload?: (files: FileList) => void;
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
      ) : onUpload ? (
        <label
          className="dim"
          title={`Upload ${label}`}
          style={{ width: size, height: size, display: "flex", flexDirection: "column", gap: 4, alignItems: "center", justifyContent: "center", border: "1px dashed var(--border)", borderRadius: 8, fontSize: "var(--t-sm)", cursor: busy ? "wait" : "pointer" }}
        >
          <Icon name="plus" size={14} />
          {busy ? "Uploading…" : "Upload"}
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files?.length) onUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
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

export function ImageManager({
  images,
  canEdit,
  onSave,
}: {
  images: DesignImage[];
  canEdit: boolean;
  /** Persist the new list (positional: [front, rear, ...other]).
      Return false when the save failed — the old list stays on screen. */
  onSave: (next: DesignImage[]) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false); // upload/save only
  const [viewer, setViewer] = useState<number | null>(null); // lightbox: index into images
  const [uploads, setUploads] = useState<{ name: string; status: "pending" | "done" | "error" }[]>([]); // per-file upload progress

  const saveImages = async (next: DesignImage[]) => {
    setBusy(true);
    await onSave(next);
    setBusy(false);
  };

  /** Multi-select upload (2026-07 request): pick many at once, fill the
      remaining slots in order, cap at MAX_IMAGES, skip non-images. */
  const uploadMany = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      toast.info(`Only ${MAX_IMAGES} images allowed`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) toast.info(`Only ${MAX_IMAGES} images allowed — extra files skipped.`);
    setBusy(true);
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
    if (added.length) await saveImages([...images, ...added]);
    else setBusy(false);
    window.setTimeout(() => setUploads([]), 1500);
  };

  // Per-slot upload (bug #5): the empty Front/Rear dashed box takes a file
  // directly. Slots are positional over the images array, so a direct upload is
  // valid only when the slot is the next free position — which also makes
  // rear-before-front impossible (the array can't hold a gap).
  const uploadSlot = (idx: 0 | 1, files: FileList | null) => {
    if (!files?.length) return;
    if (images.length !== idx) {
      toast.info("Add the Front View image first");
      return;
    }
    void uploadMany(files);
  };

  const deleteAt = async (idx: number) => {
    if (!(await confirmDialog({ message: "Are you sure you want to delete this image?", danger: true }))) return;
    await saveImages(images.filter((_, i) => i !== idx));
  };

  return (
    <>
      {/* One "Add Image" button (2026-07 request) — fills slots in order. */}
      <div style={{ display: "flex", gap: 18, marginBottom: 14 }}>
        <ImageSlot
          label="Front View"
          imageId={images[0]?.id}
          name={images[0]?.name}
          busy={busy}
          onDelete={() => void deleteAt(0)}
          onOpen={images[0] ? () => setViewer(0) : undefined}
          onUpload={canEdit ? (files) => uploadSlot(0, files) : undefined}
        />
        <ImageSlot
          label="Rear View"
          imageId={images[1]?.id}
          name={images[1]?.name}
          busy={busy}
          onDelete={() => void deleteAt(1)}
          onOpen={images[1] ? () => setViewer(1) : undefined}
          onUpload={canEdit ? (files) => uploadSlot(1, files) : undefined}
        />
      </div>
      <div className="muted" style={{ fontSize: "var(--t-sm)", marginBottom: 6 }}>Other Images</div>
      {/* List rows (2026-07 request) — tiny inline preview + open/delete, not thumbnail tiles. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {images.slice(2).map((img, i) => (
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
              disabled={busy}
              onClick={() => void deleteAt(i + 2)}
              title="Delete image"
            >
              ✕
            </button>
          </div>
        ))}
        {images.slice(2).length === 0 && (
          <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "2px 0" }}>No other images</div>
        )}
        {images.length < MAX_IMAGES && canEdit && (
          <label
            className="btn"
            style={{ alignSelf: "flex-start", marginTop: 4, cursor: busy ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="plus" size={12} />
            {busy ? "Uploading…" : "Add Image"}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
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
        {images.length}/{MAX_IMAGES}
      </div>

      {/* Image lightbox (2026-07 request): view + prev/next across all images. */}
      {viewer !== null && images[viewer] && (
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
          {images.length > 1 && (
            <button
              className="btn"
              onClick={(e) => { e.stopPropagation(); setViewer((v) => (v === null ? 0 : (v - 1 + images.length) % images.length)); }}
              title="Previous"
              style={{ position: "absolute", left: 16, width: 40, height: 40, fontSize: 22, lineHeight: 1 }}
            >
              ‹
            </button>
          )}
          <img
            src={designImageUrl(images[viewer].id)}
            alt={images[viewer].name || `Image ${viewer + 1}`}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "88vw", maxHeight: "84vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}
          />
          {images.length > 1 && (
            <button
              className="btn"
              onClick={(e) => { e.stopPropagation(); setViewer((v) => (v === null ? 0 : (v + 1) % images.length)); }}
              title="Next"
              style={{ position: "absolute", right: 16, bottom: "50%", width: 40, height: 40, fontSize: 22, lineHeight: 1 }}
            >
              ›
            </button>
          )}
          <div style={{ position: "absolute", bottom: 16, color: "#fff", fontSize: "var(--t-sm)" }}>
            {viewer + 1} / {images.length}
          </div>
        </div>
      )}
    </>
  );
}
