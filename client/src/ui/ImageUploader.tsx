/* ============================================================
   ImageUploader — ONE image (CR-181 Box Brand logo). Empty = dashed
   click/drop tile; filled = preview with Replace / Remove. Uploads to
   Catalyst File Store, holds the file id. Used by the masters form.
   ============================================================ */
import { useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { designImageUrl, uploadDesignImage } from "@/lib/api";
import type { DesignImage } from "@/features/masters/designsApi";

const SIZE = 120;

export function ImageUploader({
  value,
  onChange,
}: {
  value: DesignImage | null;
  onChange: (next: DesignImage | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const onPick = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error(`${f.name} is not an image`);
      return;
    }
    setBusy(true);
    try {
      onChange(await uploadDesignImage(f));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Upload failed: ${f.name}`);
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const tile: React.CSSProperties = {
    width: SIZE,
    height: SIZE,
    borderRadius: 10,
    border: `1px ${value ? "solid" : "dashed"} ${over ? "var(--accent)" : "var(--border-mid)"}`,
    background: over ? "var(--accent-soft)" : "var(--panel-2)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    overflow: "hidden",
    cursor: busy ? "wait" : "pointer",
    color: "var(--dim)",
    fontSize: "var(--t-sm)",
    flexShrink: 0,
  };

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 14 }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) void onPick(e.dataTransfer.files); }}
    >
      <div style={tile} title={value ? "Click to replace" : "Click or drop an image"} onClick={() => !busy && inputRef.current?.click()}>
        {value ? (
          <img src={designImageUrl(value.id)} alt={value.name || "image"} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <>
            <Icon name="upload" size={20} />
            <span>{busy ? "Uploading…" : "Upload image"}</span>
          </>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        {value ? (
          <>
            <span className="dim" style={{ fontSize: "var(--t-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }} title={value.name}>
              {busy ? "Uploading…" : value.name || "Image"}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn" disabled={busy} onClick={() => inputRef.current?.click()} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="refresh" size={12} /> Replace
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => onChange(null)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="trash" size={12} /> Remove
              </button>
            </div>
          </>
        ) : (
          <span className="dim" style={{ fontSize: "var(--t-sm)" }}>PNG or JPG. Drag &amp; drop or click.</span>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" disabled={busy} style={{ display: "none" }} onChange={(e) => void onPick(e.target.files)} />
    </div>
  );
}
