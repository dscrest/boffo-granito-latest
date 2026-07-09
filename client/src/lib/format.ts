/* Formatting helpers, ported verbatim from prototype/ui.jsx. */

export const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n || 0));

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** Catalyst datetime ("2026-06-29 15:56:48:741") → "2026-06-29 15:56". */
export const fmtDateTime = (s?: string) => (s ? s.slice(0, 16) : "—");

/** Catalyst datetime ("2026-06-29 15:56:48:741", space-separated, millis
    after a colon, no timezone → treat as UTC) rendered in the viewer's
    LOCAL time. Used by activity logs. Falls back to the raw 16-char slice
    if the string can't be parsed. */
export function fmtLocalDateTime(s?: string): string {
  if (!s) return "—";
  // Normalise "YYYY-MM-DD HH:MM:SS:mmm" → ISO "YYYY-MM-DDTHH:MM:SS.mmmZ".
  const iso = s
    .trim()
    .replace(" ", "T")
    .replace(/:(\d{3})$/, ".$1");
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return s.slice(0, 16);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------
   Activity-log humanisers — OperationLog stores an actor email and a
   raw JSON payload_summary. These turn both into something readable:
   "prashant@octfis.com" → "Prashant", {"status":"Inactive"} →
   "Status → Inactive".
   ------------------------------------------------------------------ */

/** OperationLog actor (email / user_id / "system") → short display name. */
export function actorName(actor?: string): string {
  const a = (actor || "").trim();
  if (!a || a.toLowerCase() === "system") return "System";
  const local = a.includes("@") ? a.slice(0, a.indexOf("@")) : a;
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return name || "System";
}

/** Nicer labels for known DB columns; everything else is title-cased. */
const CHANGE_LABELS: Record<string, string> = {
  image_urls: "Images",
  image_url: "Image",
  unique_name: "Unique Name",
  design_name: "Design Name",
  party_brand_name: "Party Brand",
  rate_per_sqmt: "Rate / m²",
  pcs_per_box: "Pcs / Box",
  seq_code: "Short Code",
  sku: "SKU",
  hsn_code: "HSN Code",
};
/** Columns not worth surfacing in the activity feed. */
const CHANGE_HIDDEN = new Set(["image_url", "modified_time", "created_time", "deleted_at", "ROWID"]);

function changeLabel(k: string): string {
  return CHANGE_LABELS[k] || k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function changeValue(k: string, v: unknown): string {
  if (v == null || v === "") return "cleared";
  const s = String(v);
  // JSON blobs / very long values (image lists, etc.) aren't worth spelling out.
  if (/image/i.test(k) || s.length > 48 || /^[[{]/.test(s.trim())) return "updated";
  return s;
}

/** Raw OperationLog (operation, payload_summary) → human-readable summary,
    e.g. "Status → Inactive, Size → 600x600". Falls back to the raw text
    when the payload isn't parseable JSON (e.g. it was truncated). */
export function describeChange(operation?: string, payloadSummary?: string): string {
  const op = (operation || "").toLowerCase();
  let payload: unknown = null;
  try {
    payload = payloadSummary ? JSON.parse(payloadSummary) : null;
  } catch {
    return payloadSummary || "—";
  }
  if (!payload || typeof payload !== "object") {
    if (op === "delete") return "Deleted";
    return payloadSummary || "—";
  }
  const parts = Object.entries(payload as Record<string, unknown>)
    .filter(([k]) => !CHANGE_HIDDEN.has(k))
    .map(([k, v]) => `${changeLabel(k)} → ${changeValue(k, v)}`);
  if (parts.length === 0) return op === "delete" ? "Deleted" : op === "insert" ? "Created" : "—";
  return parts.join(", ");
}

export function finishClass(f: string): string {
  const m: Record<string, string> = {
    Glossy: "glossy",
    Matt: "matt",
    Carving: "carving",
    "High Glossy": "hgloss",
    "Hard Matt": "matt",
  };
  return m[f] || "";
}
