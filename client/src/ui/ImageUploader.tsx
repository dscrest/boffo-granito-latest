/* ============================================================
   ImageUploader (#12) — pick + upload up to `max` images to
   Catalyst File Store. Holds an array of file ids; previews via
   the public design-image URL. Used on Design create + edit.
   ============================================================ */
import { useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { designImageUrl, uploadDesignImage } from "@/lib/api";
import type { DesignImage } from "@/features/masters/designsApi";

export function ImageUploader({
  value,
  onChange,
  max = 5,
}: {
  value: DesignImage[];
  onChange: (next: DesignImage[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const remaining = max - value.length;

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, remaining);
    if (Array.from(files).length > remaining) {
      toast.info(`Only ${max} images allowed — extra files skipped.`);
    }
    setBusy(true);
    const added: DesignImage[] = [];
    for (const f of picked) {
      if (!f.type.startsWith("image/")) {
        toast.error(`${f.name} is not an image`);
        continue;
      }
      try {
        added.push(await uploadDesignImage(f));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Upload failed: ${f.name}`);
      }
    }
    setBusy(false);
    if (added.length) onChange([...value, ...added]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        {value.map((img, i) => (
          <div key={img.id + i} style={{ position: "relative" }}>
            <img
              src={designImageUrl(img.id)}
              alt={img.name || `design ${i + 1}`}
              style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
            />
            <button
              type="button"
              className="btn"
              title="Remove image"
              onClick={() => removeAt(i)}
              style={{ position: "absolute", top: -8, right: -8, width: 20, height: 20, padding: 0, borderRadius: "50%", lineHeight: "18px", background: "var(--panel)" }}
            >
              ✕
            </button>
          </div>
        ))}
        {value.length === 0 && !busy && <span className="dim" style={{ fontSize: "var(--t-sm)" }}>No images yet.</span>}
        {busy && <span className="dim" style={{ fontSize: "var(--t-sm)", alignSelf: "center" }}>Uploading…</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={busy || remaining <= 0}
        onChange={(e) => void onPick(e.target.files)}
      />
      <span className="dim" style={{ marginLeft: 8, fontSize: "var(--t-sm)" }}>
        {value.length}/{max} {remaining <= 0 ? "· limit reached" : ""}
      </span>
    </div>
  );
}
