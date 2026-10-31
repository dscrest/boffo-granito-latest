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
  // Loading events mirrored onto the owning order / palletization plan
  // (server logRelated) so they surface on those Activity tabs.
  "sent-to-loading": "Sent to Loading",
  loaded: "Loaded",
  unloaded: "Unloaded",
  dispatched: "Dispatched",
  "production-log": "Production Update",
  // Every other code the server writes (Audit Log filter + column).
  set: "Updated",
  cancel: "Cancelled",
  release: "Released",
  released: "Released",
  recount: "Recounted",
  disassociate: "Unlinked",
  topup: "Pallet Topped Up",
  allocate: "Allocated to Pallet",
  "box-allocate": "Box Allocated",
  "box-allocate-batch": "Batch Allocated to Box",
  "allocate-stock": "Stock Allocated",
  "stock-allocated": "Stock Allocated",
  "deallocate-stock": "Stock Released",
  "stock-deallocated": "Stock Released",
  "stock-adjust": "Stock Adjusted",
  "stock-transfer": "Stock Transferred",
  "opening-stock": "Opening Stock",
  "warehouse-primary": "Primary Warehouse Set",
  "entry-receipt": "Cut Stock Received",
  "entry-adjustment": "Cut Stock Adjusted",
  "entry-transfer": "Cut Stock Transferred",
  "cut-piece-save": "Cut Pieces Saved",
  checkpoint: "Checkpoint",
  "panel-order-load": "Panel Order Loaded",
  "sample-order-request": "Sample Order Requested",
  "sample-order-allocate": "Sample Stock Allocated", // CR-487
  "sample-supplied": "Sample Supplied",
  "send-to-loading": "Sent to Loading",
  "vehicle-assign": "Vehicle Assigned",
  "combine-leftovers": "Leftovers Combined",
  "production-request": "Production Requested",
  "production-record": "Production Recorded",
  "production-record-lines": "Production Recorded",
  "production-record-li": "Production Recorded", // operation column is varchar(20) — stored truncated
  "production-update": "Production Updated",
  "production-status": "Production Status Change",
  "production-stage": "Production Stage Change",
  "production-complete": "Production Completed",
  "production-delete": "Production Deleted",
  dedupe: "Customers Deduplicated",
  "dedupe:merge": "Customer Merged",
  "dedupe:recode": "Customer Recoded",
  "crm-sync:create": "Customer Synced (new)",
  "crm-sync:update": "Customer Synced (updated)",
  "crm-sync:recheck": "Customer Sync Check",
  "crm-sync:link": "Customer Linked to CRM",
  "crm-push:create": "Customer Pushed to CRM",
  "crm-push:update": "Customer Pushed to CRM",
  "renumber-loads": "Loads Renumbered",
  "reattribute-blank-lines": "Pallet Lines Re-attributed",
  "backfill-pallets": "Pallets Backfilled",
  "migrate-lines": "Lines Migrated",
  "migrate-sizes": "Sizes Migrated",
};
export function opLabel(operation?: string): string {
  const op = (operation || "").trim();
  return OP_LABELS[op.toLowerCase()] || op.replace(/[-_:]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** OperationLog table_name → the name the user sees in the sidebar / page titles. */
const TABLE_LABELS: Record<string, string> = {
  Design: "Item",
  ProductionLog: "Production",
  SalesOrder: "Sales Order",
  OrderItem: "Order Line",
  Quote: "Quote",
  Customer: "Customer",
  Brand: "Brand",
  Vehicle: "Vehicle",
  Warehouse: "Warehouse",
  ContainerFormat: "Container",
  Pallet: "Pallet",
  PalletizationPlan: "Palletization",
  PalletizationPlanLine: "Palletization Line",
  LoadBox: "Loading",
  Panel: "Panel",
  PanelLine: "Panel Line",
  PanelOrder: "Panel Order",
  PanelOrderLine: "Panel Order Line",
  PanelLoad: "Panel Loading",
  SampleOrder: "Sample Order",
  SampleOrderLine: "Sample Order Line",
  CutPieceSize: "Cut Size",
  CutPieceStock: "Cut Stock",
  CutStockEntry: "Cut Stock Entry",
  Mdf: "MDF",
};
export function tableLabel(table?: string): string {
  const t = (table || "").trim();
  return TABLE_LABELS[t] || t.replace(/([a-z])([A-Z])/g, "$1 $2");
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
  pcs_per_box: "Pcs / Packing",
  coverage_sqm: "Coverage m²",
  coverage_sqft: "Coverage ft²",
  base_design_name: "Base Design Name",
  collection_name: "Collection",
  // CR-392…394 Design Master fields
  design_owner: "Design Owner",
  design_buyer: "Custom Design Buyer",
  surface_application: "Surface Application",
  punch: "Punch Type",
  series: "Series",
  catalogue: "Catalogue",
  seq_code: "Short Code",
  sku: "SKU",
  hsn_code: "HSN Code",
};
/** Columns not worth surfacing in the activity feed. */
const CHANGE_HIDDEN = new Set(["image_url", "modified_time", "created_time", "deleted_at", "ROWID"]);

function changeLabel(k: string): string {
  return CHANGE_LABELS[k] || k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A bare Catalyst ROWID (15+ digit numeric string). These are system ids and
    must never surface in the UI — only user-friendly codes should. */
/** CR-429: names are stored Title Case ("Dhiraj Shah Of Abc Exports LLP") — mirror of
    functions/data-ops/lib/names.js. CR-503: ONLY legal suffixes are upper (LLP, LTD, PVT…,
    also "Pvt.Ltd."); every other word is Title Case, even if typed ALL-CAPS.
    ponytail: whitespace words only — "o'brien" → "O'brien"; split on '/- if a real name needs it. */
const UPPER_WORDS = new Set(["LLP", "LLC", "LTD", "PVT", "INC", "PLC", "FZE", "FZCO", "GMBH"]);
const legalWord = (w: string) => /[A-Z]/i.test(w) && w.toUpperCase().split(/[.,]+/).filter(Boolean).every((p) => UPPER_WORDS.has(p));
export function titleCase(s: unknown): string {
  return String(s ?? "").trim().split(/\s+/).filter(Boolean)
    .map((w) => (legalWord(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

export const isRowId = (s: unknown): boolean => /^\d{15,}$/.test(String(s ?? "").trim());

/** True when a payload value is a ROWID or a list of ROWIDs (e.g. an `ids`
    array stringifies to "6985…,6985…") — such FK values carry no meaning to a
    reader, so we drop the whole pair from the activity summary. */
function isRowIdValue(v: unknown): boolean {
  const s = String(v ?? "").trim();
  if (!s) return false;
  return s.split(",").every((t) => isRowId(t));
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
    .filter(([k, v]) => !CHANGE_HIDDEN.has(k) && !isRowIdValue(v))
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
