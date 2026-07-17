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

/** Catalyst datetime or date-only string → LOCAL date "Jun 29, 2026" (no time).
    Matches the date portion of fmtLocalDateTime so date-only fields (e.g. a
    production_date) read uniformly next to full timestamps. */
export function fmtLocalDate(s?: string): string {
  if (!s) return "—";
  const t = parseDbTime(s);
  if (Number.isNaN(t)) return s.slice(0, 10);
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

/** Catalyst datetime string → epoch ms (NaN when unparseable). Same
    UTC-assumption as fmtLocalDateTime. */
export function parseDbTime(s?: string): number {
  if (!s) return NaN;
  const iso = s.trim().replace(" ", "T").replace(/:(\d{3})$/, ".$1");
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`).getTime();
}

/** Milliseconds → compact human duration ("3d 4h", "2h 15m", "40s"). */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60000);
  if (m < 1) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/* ------------------------------------------------------------------
   Activity-log humanisers — OperationLog stores an actor email and a
   raw JSON payload_summary. These turn both into something readable:
   "prashant@octfis.com" → "Prashant", {"status":"Inactive"} →
   "Status → Inactive".
   ------------------------------------------------------------------ */

/** Raw OperationLog operation → user-friendly label for the Activity feed. */
const OP_LABELS: Record<string, string> = {
  insert: "Created",
  update: "Updated",
  delete: "Deleted",
  "soft-delete": "Deleted",
  restore: "Restored",
  convert: "Converted",
  status: "Status Change",
  "close-pallet": "Pallet Closed",
  "load-container": "Container Loaded",
  dispatch: "Dispatched",
  "production-log": "Production Update",
};
export function opLabel(operation?: string): string {
  const op = (operation || "").trim();
  return OP_LABELS[op.toLowerCase()] || op.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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
  party_brand_name: "Customer Brand",
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

/** Keys that identify a record in an insert summary, in preference order. */
const NAME_KEYS = ["name", "design_name", "quote_no", "order_no", "code", "sku"];

/** Raw OperationLog (operation, payload_summary) → human-readable summary,
    e.g. "Status → Inactive, Size → 600x600". Inserts collapse to
    `Created "X"`; truncated JSON (the server caps payload_summary at
    480 chars) is salvaged pair-by-pair instead of shown raw. */
export function describeChange(operation?: string, payloadSummary?: string): string {
  const op = (operation || "").toLowerCase();
  const raw = payloadSummary || "";
  let payload: Record<string, unknown> | null = null;
  try {
    const p = raw ? JSON.parse(raw) : null;
    if (p && typeof p === "object") payload = p as Record<string, unknown>;
  } catch {
    // Truncated mid-value — recover every complete "key":value pair.
    const pairs: Record<string, unknown> = {};
    for (const m of raw.matchAll(/"([^"]+)"\s*:\s*("(?:[^"\\]|\\.)*"|-?[\d.]+|true|false|null)\s*[,}]/g)) {
      try {
        pairs[m[1]] = JSON.parse(m[2]);
      } catch {
        /* skip malformed pair */
      }
    }
    if (Object.keys(pairs).length > 0) payload = pairs;
  }
  if (op === "delete") return "Deleted";
  if (!payload) return op === "insert" ? "Created" : op === "update" ? "Updated" : raw || "—";
  if (op === "insert") {
    const name = NAME_KEYS.map((k) => payload![k]).find((v) => v != null && v !== "");
    return name != null ? `Created "${String(name)}"` : "Created";
  }
  const parts = Object.entries(payload)
    .filter(([k]) => !CHANGE_HIDDEN.has(k))
    .map(([k, v]) => `${changeLabel(k)} → ${changeValue(k, v)}`);
  return parts.length > 0 ? parts.join(", ") : "—";
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
