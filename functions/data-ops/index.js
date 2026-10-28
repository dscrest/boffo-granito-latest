"use strict";

/**
 * BOFFO — data-ops (Advanced I/O Function, Node.js + Express).
 *
 * Modular Data Store CRUD layer for the BOFFO Order OS app. Exposes a generic
 * insert / update / delete / list surface plus a few business operations
 * (quote-with-items, so-with-items, convert-quote). Every MUTATING op is wrapped
 * by withOpLog(), which records its outcome (success/failed + error + duration)
 * into the OperationLog table so operation status can be inspected from the UI.
 *
 * Reachable at: https://<project-domain>/server/data-ops/...
 *   GET    /:table            list (optional ?where= ?limit= ?order=)
 *   GET    /:table/:rowid     single row
 *   POST   /:table            insert (body = row object, or {rows:[...]})
 *   PATCH  /:table/:rowid      update
 *   DELETE /:table/:rowid      delete
 *   POST   /quote-with-items  insert Quote header + QuoteItem lines
 *   POST   /so-with-items     insert SalesOrder header + OrderItem lines
 *   POST   /convert-quote/:rowid  Quote -> SalesOrder (Full | Partial)
 */
const express = require("express");
const catalystSDK = require("zcatalyst-sdk-node");
const fs = require("fs");
const os = require("os");
const pathlib = require("path");
const crypto = require("crypto");

/* File Store folder for Design images (#12). Created 2026-06-23. */
/* File Store folder `design_images` in boffo-granito-export-tracker
   (project 69851000000043001, org OCTFIS 925638796) — the live project
   since 2026-07-04; boffo-latest-project was deleted. */
const DESIGN_IMAGES_FOLDER = "69851000000059622";
// CR-445: resolve the folder BY NAME once per instance (find or create), so the demo
// project — and any future clone — needs no console step; the live id is the fallback.
let designFolderIdP = null;
function designImagesFolder(catalyst) {
  if (!designFolderIdP) {
    designFolderIdP = (async () => {
      const fs_ = catalyst.filestore();
      const all = await fs_.getAllFolders();
      const hit = (all || []).map((f) => f.toJSON()).find((f) => String(f.folder_name) === "design_images");
      const id = hit ? String(hit.id) : String((await fs_.createFolder("design_images")).toJSON().id);
      return id;
    })().catch(() => { designFolderIdP = null; return DESIGN_IMAGES_FOLDER; }); // retry next request
  }
  return designFolderIdP.then((id) => catalyst.filestore().folder(id));
}

const app = express();
// 10mb so a base64-encoded photo (one per upload request) fits the body.
app.use(express.json({ limit: "10mb" }));

// CORS — prod is same-origin (no Origin header → these headers don't apply).
// For cross-origin browser calls we reflect an allowlisted origin and allow
// credentials so the httpOnly session cookie can ride the request; a wildcard
// "*" is incompatible with credentials and is dropped. Non-browser probes
// ignore CORS entirely, so tightening this never affects them.
// Override the allowlist with APP_CORS_ORIGINS (comma-separated) if needed.
const CORS_ORIGINS = new Set(
  (process.env.APP_CORS_ORIGINS ||
    "http://localhost:5173,https://boffo-granito-export-tracker-925638796.development.catalystserverless.com")
    .split(",").map((s) => s.trim()).filter(Boolean),
);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Credentials", "true");
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-App-Token");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Catalyst may deliver Advanced I/O requests with or without the
// /server/data-ops prefix. Normalize so route matching is stable either way.
app.use((req, _res, next) => {
  req.url = req.url.replace(/^\/server\/data-ops/, "") || "/";
  next();
});

/* ----------------------------------------------------------------
   Security: only these tables may be touched through this function.
   ---------------------------------------------------------------- */
const ALLOWED = new Set([
  "Quote",
  "QuoteItem",
  "SalesOrder",
  "OrderItem",
  "Customer",
  "Design",
  "PaymentTerm",
  "Size",
  "Finish",
  "Category",
  "Glaze",
  "Brand",
  "Grade",
  "PartyBrand",
  "Pallet",
  // Container Master (CR-261): one container format per Size — size FK + pallet lines as JSON.
  "ContainerFormat",
  "Vehicle",
  "DesignPallet",
  "PalletisedBatch",
  "PalletisedBatchLine",
  "PalletizationPlan",
  "PalletizationPlanLine",
  "LoadBox",
  "Container",
  "ContainerLoading",
  "OrderItemEvent",
  "ProductionLog",
  "Activity",
  "OperationLog",
  "Invoice",
  "TransactionSeries",
  "SalesPerson",
  "Currency",
  "StatusTransition",
  "Notification",
  "AppSetting",
  // Panel Craft (showcase panels + cut-piece cutting jobs) — added 2026-08-26.
  "Panel",
  "PanelLine",
  "PanelOrder",
  "PanelOrderLine", // CR-302: one row per panel on a panel order
  "CutPieceSize",
  "CutPieceStock",
  "CutStockEntry", // CR-307: cut-piece stock ledger (route-only writes)
  "Mdf", // CR-309/344: MDF master (Settings ▸ Masters), size-keyed: size · thickness · weight_kg; `panel` column dormant since CR-344
  "AdjustmentReason", // CR-308: inventory adjustment reasons (Settings ▸ Masters)
  "SampleOrder", // CR-315: customer sample requests (route-only writes)
  "SampleOrderLine",
  "PanelLoad", // CR-347: one vehicle trip per panel / sample order (route-only writes: /panel-load-save|-delete)
  "PanelLoadLine",
  "Warehouse", // CR-329: stock locations (Settings ▸ Warehouses)
  // CR-394: Design Master lookups — surface application, punch type (with image), series, catalogue.
  "SurfaceApplication",
  "Punch",
  "Series",
  "Catalogue",
]);

function assertTable(table) {
  if (!ALLOWED.has(table)) {
    const e = new Error(`Table not allowed: ${table}`);
    e.statusCode = 400;
    throw e;
  }
  return table;
}

/* ----------------------------------------------------------------
   Lookup name -> ROWID resolution, cached per cold start.
   ---------------------------------------------------------------- */
const _cache = {}; // { Design: Map<name,rowid>, Customer: Map<key,rowid>, ... }

async function buildMap(catalyst, sql, keyFields, valueField) {
  // CR-339: ZCQL caps one query at 300 rows — page, or the 301st design/customer is "not found".
  const rows = await zcqlAllRows(catalyst, sql);
  const map = new Map();
  for (const r of rows) {
    // zcqlAllRows already unwraps the per-table block; tolerate raw rows too.
    const rec = r[valueField] != null ? r : r[Object.keys(r)[0]];
    const id = rec[valueField];
    for (const kf of keyFields) {
      const k = rec[kf];
      if (k != null && k !== "") map.set(String(k).toLowerCase(), String(id));
    }
  }
  return map;
}

/* CR-339: the cache lives per warm instance and is cleared only by THIS instance's writes, so a
   design/customer created on another instance is missing here. `need` = the names this request
   must resolve; any miss rebuilds the map once before the caller gets to throw "not found". */
async function cachedMap(catalyst, key, sql, keyFields, need) {
  const stale = (m) => (need || []).some((n) => n != null && String(n).trim() !== "" && !m.has(String(n).toLowerCase()));
  if (!_cache[key] || stale(_cache[key])) _cache[key] = await buildMap(catalyst, sql, keyFields, "ROWID");
  return _cache[key];
}
async function designMap(catalyst, need) {
  return cachedMap(catalyst, "Design", "SELECT ROWID, design_name, unique_name FROM Design WHERE deleted_at is null", ["design_name", "unique_name"], need);
}
async function customerMap(catalyst, need) {
  return cachedMap(catalyst, "Customer", "SELECT ROWID, name, code FROM Customer WHERE deleted_at is null", ["name", "code"], need);
}
async function paymentTermMap(catalyst) {
  if (!_cache.PaymentTerm)
    _cache.PaymentTerm = await buildMap(
      catalyst,
      "SELECT ROWID, name FROM PaymentTerm WHERE deleted_at is null",
      ["name"],
      "ROWID",
    );
  return _cache.PaymentTerm;
}
async function salesPersonMap(catalyst) {
  if (!_cache.SalesPerson)
    _cache.SalesPerson = await buildMap(
      catalyst,
      "SELECT ROWID, name FROM SalesPerson WHERE deleted_at is null",
      ["name"],
      "ROWID",
    );
  return _cache.SalesPerson;
}

function resolve(map, name) {
  if (name == null || name === "") return null;
  return map.get(String(name).toLowerCase()) || null;
}

/* ----------------------------------------------------------------
   OperationLog wrapper — records every mutating op's outcome.
   ---------------------------------------------------------------- */
async function currentActor(catalyst) {
  // App session user first (email of whoever holds the X-App-Token).
  const appUser = catalyst.__req && catalyst.__req.appUser;
  if (appUser && (appUser.email || appUser.name)) return String(appUser.email || appUser.name);
  try {
    const u = await catalyst.userManagement().getCurrentUser();
    return u && (u.email_id || u.user_id) ? String(u.email_id || u.user_id) : "system";
  } catch {
    return "system";
  }
}

async function writeOpLog(catalyst, entry) {
  try {
    await catalyst.datastore().table("OperationLog").insertRow({
      // Catalyst datetime wants "yyyy-MM-dd HH:mm:ss", not ISO-8601 with T/Z.
      occurred_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      table_name: entry.table_name || "",
      operation: entry.operation || "",
      entity_rowid: entry.entity_rowid != null ? String(entry.entity_rowid) : "",
      status: entry.status,
      error_text: entry.error_text || "",
      duration_ms: entry.duration_ms || 0,
      actor: entry.actor || "system",
      payload_summary: entry.payload_summary || "",
    });
  } catch (e) {
    // Logging must never fail the primary operation.
    console.error("OperationLog write failed:", e && e.message);
  }
}

function summarize(payload) {
  try {
    const s = JSON.stringify(payload);
    return s.length > 480 ? s.slice(0, 480) + "…" : s;
  } catch {
    return "";
  }
}

/* Mirror one event onto RELATED records so their Activity tabs show it.
   The client's ActivityLog filters OperationLog by table_name + entity_rowid,
   so a loading event logged under PalletizationPlanLine is invisible on the
   Sales Order that owns the item — these extra rows are what make it visible.
   writeOpLog swallows its own errors, so this never fails the primary op. */
async function logRelated(catalyst, refs, operation, payload) {
  const seen = new Set();
  const actor = await currentActor(catalyst);
  for (const ref of refs) {
    const rowid = String((ref && ref.rowid) || "");
    if (!rowid || seen.has(`${ref.table}:${rowid}`)) continue;
    seen.add(`${ref.table}:${rowid}`);
    await writeOpLog(catalyst, {
      table_name: ref.table,
      operation,
      entity_rowid: rowid,
      status: "success",
      actor,
      payload_summary: summarize(payload),
    });
  }
}

/* ----------------------------------------------------------------
   StatusTransition — one row per status/stage flip on Quote /
   SalesOrder / OrderItem, so time-in-state can be reported (OperationLog
   only stores a truncated payload and can't answer aging queries).
   ---------------------------------------------------------------- */
async function logTransition(catalyst, t) {
  const from = String(t.from_status ?? "");
  const to = String(t.to_status ?? "");
  if (from === to) return;
  try {
    await catalyst.datastore().table("StatusTransition").insertRow({
      occurred_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      entity_type: t.entity_type,
      entity_rowid: String(t.entity_rowid),
      from_status: from,
      to_status: to,
      note: t.note || "",
      actor: await currentActor(catalyst),
    });
  } catch (e) {
    // Audit must never fail the primary operation.
    console.error("StatusTransition write failed:", e && e.message);
  }
}

/** In-app notification for one AppUser. Best-effort, never throws. */
async function notifyUser(catalyst, recipientAppUser, text, link) {
  if (!recipientAppUser) return;
  try {
    await catalyst.datastore().table("Notification").insertRow({
      occurred_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      recipient: String(recipientAppUser),
      text: String(text).slice(0, 240), // column is varchar(255)
      link: link || "",
    });
  } catch (e) {
    console.error("Notification write failed:", e && e.message);
  }
}

/**
 * Wrap a mutating handler so its outcome is timed and logged.
 * meta: { table_name, operation, payload }. fn returns { rowid?, data? }.
 */
async function withOpLog(catalyst, meta, fn) {
  const started = Date.now();
  const actor = await currentActor(catalyst);
  try {
    const result = await fn();
    await writeOpLog(catalyst, {
      table_name: meta.table_name,
      operation: meta.operation,
      entity_rowid: result && result.rowid,
      status: "success",
      duration_ms: Date.now() - started,
      actor,
      payload_summary: summarize(meta.payload),
    });
    return result;
  } catch (err) {
    await writeOpLog(catalyst, {
      table_name: meta.table_name,
      operation: meta.operation,
      status: "failed",
      error_text: (err && err.message) || String(err),
      duration_ms: Date.now() - started,
      actor,
      payload_summary: summarize(meta.payload),
    });
    throw err;
  }
}

/* ----------------------------------------------------------------
   Helpers
   ---------------------------------------------------------------- */
function init(req) {
  const c = catalystSDK.initialize(req);
  // Carry the request so currentActor() can read the app session user
  // (req.appUser, set by the appauth guard) — Catalyst's getCurrentUser()
  // only knows Zoho platform logins and reports "system" for app tokens.
  c.__req = req;
  return c;
}

function rowList(zcqlRows) {
  // Unwrap ZCQL's table-keyed rows into flat objects.
  return zcqlRows.map((r) => r[Object.keys(r)[0]]);
}

function sendErr(res, err) {
  const code = err && err.statusCode ? err.statusCode : 500;
  res.status(code).json({ ok: false, error: (err && err.message) || "error" });
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/* ----------------------------------------------------------------
   Validation helpers — fail fast with HTTP 400/409 BEFORE any write,
   instead of silently persisting bad data (null FKs, negatives, dup
   natural keys, inverted date ranges).
   ---------------------------------------------------------------- */
function badRequest(msg, code = 400) {
  const e = new Error(msg);
  e.statusCode = code;
  return e;
}

/* Delete reason (CR-270): every user-facing delete sends ?reason= (generic
   DELETE) or body.reason (the delete business ops). Mandatory unless the
   caller's role is Admin; it lands in the OperationLog payload either way. */
const REASON_EXEMPT_TABLES = new Set(["DesignPallet"]); // join rows reconciled on save, never a user delete
function deleteReason(req, table) {
  const reason = String((req.query && req.query.reason) || (req.body && req.body.reason) || "").trim();
  const role = String((req.appUser && req.appUser.role) || "").trim().toLowerCase();
  if (!reason && role !== "admin" && !REASON_EXEMPT_TABLES.has(table)) throw badRequest("A reason is required to delete");
  return reason;
}
/* CR-368…371: a cancel or a discard ALWAYS says why — every role, no Admin exemption
   (user decision 2026-10-22; the CR-270 exemption stays for plain deletes). */
function requireReason(req, what) {
  const reason = String((req.query && req.query.reason) || (req.body && req.body.reason) || "").trim();
  if (!reason) throw badRequest(`A reason is required ${what}`);
  return reason;
}

/* ---- Generic-route input guards (ZCQL-injection defense) ----
   The generic list/get/patch routes interpolate query params into ZCQL. The
   client only ever builds SINGLE-predicate filters, so validate against a
   strict grammar and reject anything else (fail-safe 400, never fail-open).
   `columns` is validated inline where it's used (identifier allowlist). */

// One predicate: `col = <int>` | `col = '<alnum/space/_/->'` | `col IN (<int,...>)`.
const WHERE_RE =
  /^[A-Za-z_][A-Za-z0-9_]*\s*(=\s*\d+|=\s*'[A-Za-z0-9 _-]*'|IN\s*\(\s*\d+(\s*,\s*\d+)*\s*\))$/;
// `col` optionally followed by asc/desc.
const ORDER_RE = /^[A-Za-z_][A-Za-z0-9_]*( (asc|desc))?$/i;

function assertWhere(where) {
  if (!WHERE_RE.test(String(where).trim())) throw badRequest("Invalid filter");
}
function assertOrder(order) {
  if (!ORDER_RE.test(String(order).trim())) throw badRequest("Invalid order");
}
/** Coerce a route :rowid param to digits only — ROWIDs are numeric. */
function rowidParam(v) {
  return String(v == null ? "" : v).replace(/[^0-9]/g, "");
}

/* Delete-guard map: table -> [childTable, fkColumn, humanLabel]. A row is
   undeletable while a non-soft-deleted DOWNSTREAM record references it. Own
   line items are deliberately excluded (see the delete handler). */
const BLOCK_DELETE = {
  Design: [
    ["QuoteItem", "design", "quotation line"],
    ["OrderItem", "design", "sales-order line"],
    ["ProductionLog", "design", "production entry"],
    ["PalletisedBatch", "design", "packed batch"],
  ],
  Customer: [
    ["Quote", "customer", "quotation"],
    ["SalesOrder", "customer", "sales order"],
    // CR-392/393: logical FKs (plain bigint on LIVE — no DB SET-NULL), so the guard is the only net.
    ["Design", "design_owner", "item (design owner)"],
    ["Design", "design_buyer", "item (design buyer)"],
    ["PartyBrand", "customer", "customer brand"],
  ],
  // CR-394: a lookup value picked on an item stays.
  SurfaceApplication: [["Design", "surface_application", "item"]],
  Punch: [["Design", "punch", "item"]],
  Series: [["Design", "series", "item"]],
  Catalogue: [["Design", "catalogue", "item"]],
  Quote: [["SalesOrder", "quote", "sales order"]], // downstream conversion; NOT QuoteItem (no line-delete UI yet)
  Mdf: [["PanelOrderLine", "mdf", "panel-order line"]], // CR-344: a thickness picked on an order stays
  SalesOrder: [
    ["OrderItem", "sales_order", "sales-order line"], // own lines — delete leaf-first, no cascade
    ["ProductionLog", "sales_order", "production entry"],
    ["PalletisedBatch", "sales_order", "packed batch"],
    ["Invoice", "sales_order", "invoice"],
  ],
  // A line item is the next rung down: it can't be removed while production
  // exists against it (which is itself blocked while palletised). Delete the
  // downstream transaction first, then channel backward.
  OrderItem: [["ProductionLog", "order_item", "production entry"]],
  // CR-329: a warehouse with stock history stays (transfer the stock away, then delete).
  // CR-409: a warehouse keeps its locations (delete them first); CR-410: a panel order placed there.
  Warehouse: [
    ["ProductionLog", "warehouse", "stock entry"],
    ["CutStockEntry", "warehouse", "cut stock entry"],
    ["Warehouse", "parent", "location"],
    ["PanelOrder", "warehouse", "panel order"],
    ["SalesOrder", "warehouse", "sales order"], // CR-453
    ["PalletizationPlanLine", "warehouse", "palletized line"], // CR-412
  ],
};

/** Resolve a REQUIRED FK name → ROWID; throw 400 if blank or unresolved. */
function resolveOrThrow(map, name, label) {
  if (name == null || String(name).trim() === "") throw badRequest(`${label} is required`);
  const id = map.get(String(name).toLowerCase());
  if (!id) throw badRequest(`${label} not found: "${name}"`);
  return id;
}

/** Resolve an OPTIONAL FK name → ROWID or null; throw 400 only if a non-blank name fails to resolve. */
function resolveOptional(map, name, label) {
  if (name == null || String(name).trim() === "") return null;
  const id = map.get(String(name).toLowerCase());
  if (!id) throw badRequest(`${label} not found: "${name}"`);
  return id;
}

/** Finite number ≥ 0. */
/* Box Brand captured at production (CR-197): blank → null, else must be a real
   Brand row. Callers spread it only when set, so rows stay insertable on a
   Data Store that predates the ProductionLog.box_brand column. */
async function brandOrNull(catalyst, v) {
  const id = String(v == null ? "" : v).trim();
  if (!id) return null;
  if (!/^\d+$/.test(id)) throw badRequest("Invalid box brand");
  const hit = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM Brand WHERE ROWID = ${id}`))[0];
  if (!hit) throw badRequest("Box brand not found");
  return id;
}

function nonNeg(n, label) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) throw badRequest(`${label} must be a number ≥ 0`);
  return v;
}

/** Percentage within [0, 100]. */
function pctRange(n, label) {
  const v = Number(n) || 0;
  if (v < 0 || v > 100) throw badRequest(`${label} must be between 0 and 100`);
  return v;
}

/** Validate + compute line items. Throws 400 on empty list or bad numbers. */
function computeLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw badRequest("At least one line item is required");
  let total = 0;
  const items = lines.map((l, i) => {
    const qty = nonNeg(l.qty, `Line ${i + 1} qty`);
    const rate = nonNeg(l.rate, `Line ${i + 1} rate`);
    const disc = pctRange(l.discount, `Line ${i + 1} discount %`);
    const gross = qty * rate;
    const sub = round2(gross - gross * (disc / 100));
    total += sub;
    return { line: l, sub };
  });
  return { items, total };
}

/** ISO yyyy-MM-dd lexical compare; throw 400 if `end` precedes `start`. */
function assertDateOrder(start, end, startLabel, endLabel) {
  if (start && end && String(end) < String(start)) {
    throw badRequest(`${endLabel} cannot be before ${startLabel}`);
  }
}

/** Throw 409 if `value` already exists in table.field (optionally excluding one ROWID). */
/* CR-453: Location = a live Warehouse node id (a warehouse, or a bay inside one).
   Required whenever at least one warehouse exists — before that the rule is
   dormant, mirroring the client's useWarehouses().enabled. One query either way. */
async function requireLocation(catalyst, raw) {
  const id = rowidParam(raw);
  const q = id
    ? `SELECT ROWID FROM Warehouse WHERE ROWID = ${id} AND deleted_at is null`
    : `SELECT ROWID FROM Warehouse WHERE deleted_at is null LIMIT 1`;
  const hit = rowList(await catalyst.zcql().executeZCQLQuery(q)).length > 0;
  if (id && !hit) throw badRequest("Location not found", 404);
  if (!id && hit) throw badRequest("Location is required");
  return id || null;
}

async function assertUnique(catalyst, table, field, value, excludeRowid, extraWhere = "") {
  if (value == null || String(value).trim() === "") return;
  const safe = String(value).replace(/'/g, "''"); // ZCQL string-literal escape
  // Ignore soft-deleted rows so a deleted name can be re-used (every table
  // here has deleted_at; assertUnique is never called on OperationLog).
  const rows = rowList(
    await catalyst
      .zcql()
      .executeZCQLQuery(`SELECT ROWID FROM ${table} WHERE ${field} = '${safe}' AND deleted_at is null${extraWhere}`),
  );
  if (rows.some((r) => String(r.ROWID) !== String(excludeRowid || ""))) {
    throw badRequest(`${table} ${field} "${value}" already exists`, 409);
  }
}
/** CR-409: a Warehouse name is unique among its SIBLINGS — "A1" may exist in every
    warehouse, but only once per warehouse; top-level warehouse names are unique among
    themselves. Returns the extra ZCQL clause for assertUnique. */
const warehouseSiblingScope = (parent) => (rowidParam(parent) ? ` AND parent = ${rowidParam(parent)}` : " AND parent is null");

/* Fields that are legitimately signed (deltas / doc adjustments) — exempt
   from the app-wide no-negative-numbers rule (persistent rule #5). */
const SIGNED_FIELDS = new Set(["adjustment", "qty_delta"]);

/** Throw 400 if any numeric value in the payload is negative (rule #5).
    Covers both real numbers and numeric strings; SIGNED_FIELDS exempt. */
/* CR-391: an item's coverage is its own width × length × pcs (pcs typed per item; the
   Size value is only the form's default). Stamped on every Design write that carries
   the three inputs so the stored value can never disagree with the form's ƒx field. */
/** CR-427: Design.box_weight_kg per ROWID — frozen onto quote / SO lines at creation so a later
    bulk weight edit on the Item master never moves an existing order's planning tonnes. */
async function designBoxWeights(catalyst, designIds) {
  const ids = [...new Set((designIds || []).map((d) => String(d)).filter((d) => /^\d+$/.test(d)))];
  if (!ids.length) return new Map();
  const rows = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, box_weight_kg FROM Design WHERE ROWID IN (${ids.join(",")})`));
  return new Map(rows.map((r) => [String(r.ROWID), Number(r.box_weight_kg) || 0]));
}

function stampDesignCoverage(r) {
  if (r.width_mm === undefined || r.length_mm === undefined || r.pcs_per_box === undefined) return;
  const sqm = ((Number(r.width_mm) || 0) / 1000) * ((Number(r.length_mm) || 0) / 1000) * (Number(r.pcs_per_box) || 0);
  r.coverage_sqm = Math.round(sqm * 1e4) / 1e4;
  r.coverage_sqft = Math.round(sqm * 10.763915 * 1e4) / 1e4;
}

/* CR-473: Design.item_code = ABBR-SIZE-NNN — the catalog code an executive orders by.
   ABBR = initials of the design name ("Leo Statuario Nex" → LSN; one word → first 3 letters),
   SIZE = the Size master's code, NNN = 3 random chars from an unambiguous alphabet, re-rolled
   until no Design row (deleted ones included) carries it — a code is NEVER reused. Stamped
   server-side on insert (and on the first PATCH of a row without one); never typed. A later
   rename / size change keeps the code: uniqueness beats mirroring. */
const ITEM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 chars → randomBytes % 32 is unbiased
function designAbbr(name) {
  const words = String(name || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  const abbr = words.length >= 2 ? words.map((w) => w[0]).join("") : (words[0] || "").slice(0, 3);
  return abbr.slice(0, 4) || "ITM";
}
function randomTail() {
  return [...crypto.randomBytes(3)].map((b) => ITEM_CODE_ALPHABET[b % 32]).join("");
}
async function nextItemCode(catalyst, designName, sizeId) {
  const sid = rowidParam(sizeId);
  const sz = sid ? rowList(await catalyst.zcql().executeZCQLQuery(`SELECT code FROM Size WHERE ROWID = ${sid}`))[0] : null;
  const prefix = `${designAbbr(designName)}-${String((sz && sz.code) || "NOSIZE").trim().replace(/\s+/g, "")}-`;
  for (let i = 0; i < 20; i++) {
    const code = prefix + randomTail();
    const hit = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM Design WHERE item_code = '${code.replace(/'/g, "''")}'`));
    if (!hit.length) return code;
  }
  throw badRequest("Could not mint a unique item code — try again", 500);
}

function assertNoNegatives(obj) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (SIGNED_FIELDS.has(k)) continue;
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (!Number.isNaN(n) && n < 0) throw badRequest(`${k} cannot be negative`);
  }
}

/** Natural (business) key per table — used to block duplicate inserts on the generic routes. */
const NATURAL_KEY = {
  Customer: "code",
  Design: "unique_name",
  Size: "name", // full spec (code-type-thickness-pcs); dims alone repeat legitimately
  Finish: "name",
  Brand: "name",
  Category: "name",
  Glaze: "name",
  Grade: "name",
  PartyBrand: "name",
  PaymentTerm: "name",
  Pallet: "name",
  Invoice: "invoice_number",
  SalesPerson: "name",
  Currency: "code",
  PalletizationPlan: "pal_number",
  AppSetting: "setting_key",
  Panel: "panel_code",
  CutPieceSize: "name",
  AdjustmentReason: "name",
  Warehouse: "name", // CR-329
  SurfaceApplication: "name", // CR-394
  Punch: "name",
  Series: "name",
  Catalogue: "name",
};

/**
 * Document-level charges (Books parity). Mirrors client docTotals() in data.ts.
 * Takes the summed line subtotal + the request body (discount / adjustment /
 * tax_type / tax_pct) and returns the persisted fields + net total.
 * TDS reduces the net (withheld); TCS increases it (collected).
 */
function docCompute(lineSubtotal, body) {
  const docDiscount = nonNeg(body.discount || 0, "Document discount");
  const adjustment = Number(body.adjustment) || 0; // signed: +/- allowed
  const taxable = round2((Number(lineSubtotal) || 0) - docDiscount + adjustment);
  const taxPct = pctRange(body.tax_pct || 0, "Tax %");
  const taxType = body.tax_type === "TDS" || body.tax_type === "TCS" ? body.tax_type : "None";
  const taxAmt = round2(taxable * (taxPct / 100));
  const signedTax = taxType === "TDS" ? -taxAmt : taxType === "TCS" ? taxAmt : 0;
  const net = round2(taxable + signedTax);
  return { discount: docDiscount, adjustment, tax_pct: taxPct, tax_type: taxType, tax_amount: taxAmt, total_amount: net };
}

/* ----------------------------------------------------------------
   Health / root
   ---------------------------------------------------------------- */
/* ----------------------------------------------------------------
   PUBLIC: serve a Design image by File Store id (#12). Registered
   BEFORE the auth guard so <img src> works without a token (images
   can't send the X-App-Token header). Read-only, streams bytes.
   ---------------------------------------------------------------- */
// svg stays ONLY so files stored before the upload allowlist still render; new
// uploads are raster-only (sniffImage) and every response below is sandboxed.
const EXT_MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
  svg: "image/svg+xml",
};

const { sniffImage } = require("./lib/sniffImage");
const { titleCase, normalizeNames } = require("./lib/names"); // CR-429
app.get("/public/design-image/:fileId", async (req, res) => {
  try {
    const catalyst = init(req);
    const folder = await designImagesFolder(catalyst);
    let mime = "image/jpeg";
    try {
      const details = await folder.getFileDetails(req.params.fileId);
      const ext = String(details.file_name || "").split(".").pop().toLowerCase();
      if (EXT_MIME[ext]) mime = EXT_MIME[ext];
    } catch {
      /* fall back to image/jpeg; browsers sniff anyway */
    }
    const stream = await folder.getFileStream(req.params.fileId);
    res.set("Content-Type", mime);
    res.set("Cache-Control", "public, max-age=86400");
    // This URL is same-origin with the app: opened as a page, the bytes must
    // never run script (a legacy SVG would). sandbox = opaque origin, no JS.
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    stream.pipe(res);
  } catch (err) {
    res.status(404).json({ ok: false, error: "Image not found" });
  }
});

/* CR-445 PUBLIC: Organization profile (logo id, company name, tax, contact,
   bank) — read by the login page, the shared batch/pallet pages and PDF
   builders, none of which hold a token. Explicit key allowlist; never the
   generic /AppSetting list (secret rows). */
const { ORG_KEYS, isOrgKey, profileFromRows } = require("./lib/orgProfile");
app.get("/public/org-profile", async (req, res) => {
  try {
    const catalyst = init(req);
    const keys = ORG_KEYS.map((k) => `'${k}'`).join(", ");
    const rows = rowList(await catalyst.zcql().executeZCQLQuery(
      `SELECT setting_key, setting_value, deleted_at FROM AppSetting WHERE setting_key IN (${keys}) LIMIT 50`,
    ));
    res.json({ ok: true, profile: profileFromRows(rows) });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   FX rates: refresh Currency.exchange_rate from frankfurter.dev
   (base INR; stored rate = INR per 1 unit). Rows with manual_override
   are left alone. Shared by the daily cron (key-gated, pre-auth) and
   the admin "Refresh rates now" button (authed route below).
   ---------------------------------------------------------------- */
async function refreshFxRates(catalyst) {
  const resp = await fetch("https://api.frankfurter.dev/v1/latest?base=INR");
  if (!resp.ok) throw new Error(`frankfurter.dev ${resp.status}`);
  const fx = await resp.json();
  const rows = rowList(
    await catalyst.zcql().executeZCQLQuery(
      "SELECT ROWID, code, manual_override FROM Currency WHERE deleted_at is null",
    ),
  );
  // Project convention: datetime columns hold IST "yyyy-MM-dd HH:mm:ss".
  const now = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const updated = [];
  const skipped = [];
  for (const r of rows) {
    const code = String(r.code || "").toUpperCase();
    const perInr = fx.rates && fx.rates[code];
    if (code === "INR" || String(r.manual_override) === "true" || !perInr) {
      skipped.push(code);
      continue;
    }
    // frankfurter returns CODE per 1 INR; we store INR per 1 CODE.
    const rate = Math.round((1 / Number(perInr)) * 10000) / 10000;
    await catalyst.datastore().table("Currency").updateRow({
      ROWID: r.ROWID,
      exchange_rate: rate,
      rate_updated_at: now,
    });
    updated.push(code);
  }
  return { ok: true, updated, skipped };
}

/* Cron entry points (URL-type Catalyst crons) — gated by FX_CRON_KEY (one secret for every
   URL cron), registered before the auth guard because the cron can't send app tokens. */
function cronKeyOk(req, res) {
  const key = process.env.FX_CRON_KEY;
  if (key && req.query.key === key) return true;
  res.status(403).json({ ok: false, error: "Forbidden" });
  return false;
}
app.get("/cron/fx-refresh", async (req, res) => {
  try {
    if (!cronKeyOk(req, res)) return;
    res.json(await refreshFxRates(init(req)));
  } catch (err) {
    sendErr(res, err);
  }
});
/* CR-356/358/359: pull the customers changed in Zoho since the last run. One route per provider
   (books | crm) — the webhook target (Catalyst Signals) and the URL cron both GET it. Only the
   ACTIVE provider's route does work; the other answers {disabled:true} so a leftover cron or
   webhook stays harmless. */
function cronSync(provider) {
  return async (req, res) => {
    try {
      if (!cronKeyOk(req, res)) return;
      const zoho = require("./lib/zoho");
      if (provider !== zoho.ACTIVE_PROVIDER) return res.json({ ok: true, disabled: true, provider, active: zoho.ACTIVE_PROVIDER });
      const adapter = require(provider === "crm" ? "./lib/crmSync" : "./lib/booksSync");
      res.json(await require("./lib/customerSync").sync({ catalyst: init(req), rowList, writeOpLog }, adapter, { full: false }));
    } catch (err) {
      sendErr(res, err);
    }
  };
}
app.get("/cron/books-sync", cronSync("books"));
app.get("/cron/crm-sync", cronSync("crm"));

/* ----------------------------------------------------------------
   PUBLIC: scannable pallet label. A QR sticker on a container encodes
   #/share/box/<share_token>; the scanner (any phone, no login) opens
   that page which reads this endpoint. Registered BEFORE the auth guard
   so it needs no token. Read-only; keyed by the box's unguessable
   share_token (minted by POST /load-box-share). Returns just the
   shipping essentials — items, destinations, container, vehicle,
   salesperson contact.
   ---------------------------------------------------------------- */
app.get("/public/pallet/:token", async (req, res) => {
  try {
    const token = String(req.params.token || "").replace(/[^A-Za-z0-9]/g, "");
    if (!token) return res.status(404).json({ ok: false, error: "Not found" });
    const catalyst = init(req);
    const zcql = (sql) => catalyst.zcql().executeZCQLQuery(sql).then(rowList);
    const inList = (ids) => (ids.length ? ids.join(",") : "0");

    const box = (await zcql(
      `SELECT ROWID, box_number, load_number, vehicle, container_number, status, dispatch_date FROM LoadBox WHERE share_token = '${token}' AND deleted_at is null`,
    ))[0];
    if (!box) return res.status(404).json({ ok: false, error: "This label is invalid or has been revoked." });

    const lines = await zcql(
      `SELECT ROWID, plan, sales_order, design, boxes, position, batch_number FROM PalletizationPlanLine WHERE load_box = ${box.ROWID} AND deleted_at is null`,
    );
    const soIds = [...new Set(lines.map((l) => String(l.sales_order)).filter(Boolean))];
    const designIds = [...new Set(lines.map((l) => String(l.design)).filter(Boolean))];
    const planIds = [...new Set(lines.map((l) => String(l.plan)).filter(Boolean))];
    const [sos, designs, plans, vehRows] = await Promise.all([
      zcql(`SELECT ROWID, order_number, po_number, customer FROM SalesOrder WHERE ROWID IN (${inList(soIds)})`),
      zcql(`SELECT ROWID, design_name, unique_name, size FROM Design WHERE ROWID IN (${inList(designIds)})`),
      zcql(`SELECT ROWID, sales_person FROM PalletizationPlan WHERE ROWID IN (${inList(planIds)})`),
      box.vehicle
        ? zcql(`SELECT ROWID, vehicle_number, driver_name, mobile_number FROM Vehicle WHERE ROWID = ${box.vehicle}`)
        : Promise.resolve([]),
    ]);
    const custIds = [...new Set(sos.map((s) => String(s.customer)).filter(Boolean))];
    const sizeIds = [...new Set(designs.map((d) => String(d.size)).filter(Boolean))];
    const repIds = [...new Set(plans.map((p) => String(p.sales_person)).filter(Boolean))];
    const [customers, sizes, reps] = await Promise.all([
      zcql(`SELECT ROWID, name, country_code FROM Customer WHERE ROWID IN (${inList(custIds)})`),
      zcql(`SELECT ROWID, code FROM Size WHERE ROWID IN (${inList(sizeIds)})`),
      zcql(`SELECT ROWID, name, phone, email FROM SalesPerson WHERE ROWID IN (${inList(repIds)})`),
    ]);
    const by = (rows) => new Map(rows.map((r) => [String(r.ROWID), r]));
    const soBy = by(sos), designBy = by(designs), planBy = by(plans), custBy = by(customers), sizeBy = by(sizes), repBy = by(reps);

    const items = lines
      .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
      .map((l) => {
        const so = soBy.get(String(l.sales_order));
        const d = designBy.get(String(l.design));
        const cust = so ? custBy.get(String(so.customer)) : null;
        const rep = repBy.get(String((planBy.get(String(l.plan)) || {}).sales_person));
        return {
          item: d ? String(d.unique_name || d.design_name || "") : "",
          size: d ? String((sizeBy.get(String(d.size)) || {}).code || "") : "",
          batch: String(l.batch_number || ""),
          boxes: Number(l.boxes) || 0,
          order: so ? String(so.order_number || so.po_number || "") : "",
          customer: cust ? String(cust.name || "") : "",
          country: cust ? String(cust.country_code || "") : "",
          salesperson: rep ? String(rep.name || "") : "",
          salespersonPhone: rep ? String(rep.phone || "") : "",
          salespersonEmail: rep ? String(rep.email || "") : "",
        };
      });
    const vehicle = vehRows[0]
      ? { number: String(vehRows[0].vehicle_number || ""), driver: String(vehRows[0].driver_name || ""), mobile: String(vehRows[0].mobile_number || "") }
      : null;
    const salespersons = [
      ...new Map(
        items.filter((i) => i.salesperson).map((i) => [i.salesperson, { name: i.salesperson, phone: i.salespersonPhone, email: i.salespersonEmail }]),
      ).values(),
    ];
    const destinations = [...new Set(items.map((i) => (i.country ? `${i.customer} (${i.country})` : i.customer)).filter(Boolean))];

    res.set("Cache-Control", "no-store");
    res.json({
      ok: true,
      box: {
        boxNumber: Number(box.box_number) || 0,
        loadNumber: String(box.load_number || ""),
        container: String(box.container_number || ""),
        status: String(box.status || ""),
        dispatchDate: String(box.dispatch_date || ""),
        vehicle,
        totalBoxes: items.reduce((s, i) => s + i.boxes, 0),
        items,
        destinations,
        salespersons,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Could not load label" });
  }
});

/* PUBLIC: the page behind a production-batch QR slip. Same pattern as
   /public/pallet — keyed by the record row's unguessable share_token
   (minted by POST /production-record-share). Read-only essentials. */
app.get("/public/batch/:token", async (req, res) => {
  try {
    const token = String(req.params.token || "").replace(/[^A-Za-z0-9]/g, "");
    if (!token) return res.status(404).json({ ok: false, error: "Not found" });
    const catalyst = init(req);
    const zcql = (sql) => catalyst.zcql().executeZCQLQuery(sql).then(rowList);

    const rec = (await zcql(
      `SELECT ROWID, batch_number, qty_boxes, production_date, performed_by, note, design, CREATEDTIME FROM ProductionLog WHERE share_token = '${token}' AND entry_type = 'record' AND deleted_at is null`,
    ))[0];
    if (!rec) return res.status(404).json({ ok: false, error: "This slip is invalid or has been revoked." });

    const design = rec.design
      ? (await zcql(`SELECT ROWID, design_name, unique_name, size FROM Design WHERE ROWID = ${String(rec.design)}`))[0]
      : null;
    const size = design && design.size
      ? (await zcql(`SELECT ROWID, code FROM Size WHERE ROWID = ${String(design.size)}`))[0]
      : null;

    res.set("Cache-Control", "no-store");
    res.json({
      ok: true,
      batch: {
        batchNumber: String(rec.batch_number || ""),
        item: design ? String(design.unique_name || design.design_name || "") : "",
        size: size ? String(size.code || "") : "",
        qtyBoxes: Number(rec.qty_boxes) || 0,
        mfgDate: String(rec.production_date || "") || String(rec.CREATEDTIME || "").slice(0, 10),
        loggedBy: String(rec.performed_by || ""),
        note: String(rec.note || ""),
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Could not load slip" });
  }
});

/* ----------------------------------------------------------------
   App auth: login/sessions/users + role guard for every route below.
   Auth tables (AppUser/Role/AuthSession) are NOT in ALLOWED, so they
   are reachable only through the /auth/* endpoints.
   ---------------------------------------------------------------- */
require("./lib/appauth").register(app, { init, rowList, sendErr, writeOpLog });

/* Authenticated variant of the FX refresh for the admin Currencies page. */
app.post("/fx-refresh", async (req, res) => {
  try {
    res.json(await refreshFxRates(init(req)));
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Authenticated: upload a Design image (#12). Body { name, data }
   where data is base64 (no data-URL prefix). Writes to /tmp, streams
   to File Store, returns { id }. Client caps at 5 images.
   ---------------------------------------------------------------- */
app.post("/upload/design-image", async (req, res) => {
  let tmpPath = null;
  try {
    const { name, data } = req.body || {};
    if (!data) throw badRequest("No image data");
    // Preserve the uploaded filename (req 2026-07-08): keep spaces, parens,
    // and unicode; strip only path separators and control chars for safety.
    let safeName =
      String(name || "image.jpg")
        .replace(/[\\/\x00-\x1f]/g, "")
        .trim() || "image.jpg";
    const buf = Buffer.from(String(data), "base64");
    if (!buf.length) throw badRequest("Empty image");
    if (buf.length > 8 * 1024 * 1024) throw badRequest("Image exceeds 8MB");
    // Raster images only, judged by content — an SVG/HTML payload served from
    // the public route would run script on the app origin.
    const kind = sniffImage(buf);
    if (!kind) throw badRequest("Only JPG, PNG, GIF, WebP, BMP or AVIF images can be uploaded");
    // The serve route types the response from the stored extension, so the
    // extension must tell the truth about the bytes.
    const ext = safeName.includes(".") ? safeName.split(".").pop().toLowerCase() : "";
    if (EXT_MIME[ext] !== EXT_MIME[kind]) safeName = `${safeName}.${kind}`;
    tmpPath = pathlib.join(os.tmpdir(), `${crypto.randomBytes(8).toString("hex")}-${safeName}`);
    fs.writeFileSync(tmpPath, buf);
    const catalyst = init(req);
    const uploaded = await (await designImagesFolder(catalyst))
      .uploadFile({ code: fs.createReadStream(tmpPath), name: safeName });
    res.json({ ok: true, id: String(uploaded.id), name: safeName });
  } catch (err) {
    sendErr(res, err);
  } finally {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
});

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "data-ops" });
});

/* ----------------------------------------------------------------
   Business: Quote header + line items
   body: { customer, quote_date, expiry_date, payment_term, port_of_discharge,
           status, currency, remarks, address, quote_number, salesperson,
           reference_no, customer_notes, terms,
           lines: [{ item, qty, rate, discount }] }
   ---------------------------------------------------------------- */
app.post("/quote-with-items", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const dMap = await designMap(catalyst, (Array.isArray(body.lines) ? body.lines : []).map((l) => l && l.item));
    const cMap = await customerMap(catalyst, [body.customer]);
    const pMap = await paymentTermMap(catalyst);
    const sMap = await salesPersonMap(catalyst);

    const result = await withOpLog(
      catalyst,
      { table_name: "Quote", operation: "insert", payload: body },
      async () => {
        // Validate everything up front — never write a header then fail on a line.
        await assertUnique(catalyst, "Quote", "quote_number", body.quote_number);
        assertDateOrder(body.quote_date, body.expiry_date, "quote date", "expiry date");
        const customer = resolveOrThrow(cMap, body.customer, "Customer");
        const paymentTerm = resolveOptional(pMap, body.payment_term, "Payment term");
        const salesPerson = resolveOptional(sMap, body.salesperson, "Sales person");
        const { items, total } = computeLines(body.lines);
        const designIds = items.map((it) => resolveOrThrow(dMap, it.line.item, "Design"));
        const bwMap = await designBoxWeights(catalyst, designIds); // CR-427

        const doc = docCompute(total, body);
        const bornStatus = canApprove(req, "Quote") ? "Approved" : "Draft";
        const quoteRow = await ds.table("Quote").insertRow({
          quote_number: body.quote_number || "",
          customer,
          quote_date: body.quote_date || undefined,
          // date column rejects "" → omit (undefined) when blank.
          expiry_date: body.expiry_date || undefined,
          payment_term: paymentTerm,
          port_of_discharge: body.port_of_discharge || "",
          // Born Draft — approval is mandatory before Sent, so a crafted
          // create can't mint a pre-approved quote. Exception (CR): a user who
          // can approve quotes (Admin or role approver) skips their own
          // approval loop — the quote is born Approved.
          status: bornStatus,
          currency: body.currency || "INR",
          exchange_rate: Number(body.exchange_rate) || 1,
          remarks: body.remarks || "",
          address: body.address || "",
          shipping_address: body.shipping_address || "",
          sales_person: salesPerson || undefined,
          // Box Brand master pick (Brand FK, CR-162) — null clears; "" is rejected by the FK column.
          box_brand: body.box_brand || null,
          reference_no: body.reference_no || "",
          customer_notes: body.customer_notes || "",
          terms: body.terms || "",
          conversion_flag: "None",
          discount: doc.discount,
          adjustment: doc.adjustment,
          tax_type: doc.tax_type,
          tax_pct: doc.tax_pct,
          tax_amount: doc.tax_amount,
          total_amount: doc.total_amount,
          // Container-plan snapshot (JSON, ≤10000 chars) — only when sent.
          ...(typeof body.container_plan === "string"
            ? { container_plan: body.container_plan.slice(0, 10000) }
            : {}),
        });
        const quoteId = quoteRow.ROWID;
        if (bornStatus === "Approved")
          await logTransition(catalyst, {
            entity_type: "Quote", entity_rowid: quoteId, from_status: "", to_status: "Approved",
            note: "Auto-approved — created by an approver",
          });

        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          await ds.table("QuoteItem").insertRow({
            quote: quoteId,
            design: designIds[i],
            box_weight_kg: bwMap.get(String(designIds[i])) || 0, // CR-427 snapshot
            quantity_boxes: Number(it.line.qty) || 0,
            rate: Number(it.line.rate) || 0,
            rate_basis: it.line.rate_basis || "box",
            discount_pct: Number(it.line.discount) || 0,
            description: it.line.description || "",
            sub_total: it.sub,
            final_total: it.sub,
          });
        }
        return { rowid: quoteId, data: { ROWID: quoteId, total_amount: doc.total_amount } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Business: update an existing Quote header + REPLACE its line items.
   Lines are replaced wholesale (delete old QuoteItem rows, re-insert) so
   the client can edit/add/remove freely. body shape == quote-with-items.
   ---------------------------------------------------------------- */
app.post("/update-quote-with-items/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const quoteId = req.params.rowid;
    const dMap = await designMap(catalyst, (Array.isArray(body.lines) ? body.lines : []).map((l) => l && l.item));
    const cMap = await customerMap(catalyst, [body.customer]);
    const pMap = await paymentTermMap(catalyst);
    const sMap = await salesPersonMap(catalyst);

    const result = await withOpLog(
      catalyst,
      { table_name: "Quote", operation: "update", payload: { ROWID: quoteId, ...body } },
      async () => {
        // Validate everything up front — never write a header then fail on a line.
        await assertUnique(catalyst, "Quote", "quote_number", body.quote_number, quoteId);
        assertDateOrder(body.quote_date, body.expiry_date, "quote date", "expiry date");
        const customer = resolveOrThrow(cMap, body.customer, "Customer");
        const paymentTerm = resolveOptional(pMap, body.payment_term, "Payment term");
        const salesPerson = resolveOptional(sMap, body.salesperson, "Sales person");
        const { items, total } = computeLines(body.lines);
        const designIds = items.map((it) => resolveOrThrow(dMap, it.line.item, "Design"));
        const bwMap = await designBoxWeights(catalyst, designIds); // CR-427

        const doc = docCompute(total, body);
        // Status is never editable here (use /quote-status). Editing content
        // invalidates a pending/granted approval → back to Draft — unless the
        // editor can approve quotes (CR): their edit lands straight on Approved.
        const cur = rowList(
          await catalyst.zcql().executeZCQLQuery(`SELECT status FROM Quote WHERE ROWID = ${quoteId}`),
        )[0];
        const curStatus = String((cur && cur.status) || "Draft");
        const nextStatus =
          curStatus === "PendingApproval" || curStatus === "Approved"
            ? canApprove(req, "Quote") ? "Approved" : "Draft"
            : curStatus;
        await ds.table("Quote").updateRow({
          ROWID: quoteId,
          quote_number: body.quote_number || "",
          customer,
          quote_date: body.quote_date || undefined,
          expiry_date: body.expiry_date || undefined,
          payment_term: paymentTerm,
          port_of_discharge: body.port_of_discharge || "",
          status: nextStatus,
          currency: body.currency || "INR",
          exchange_rate: Number(body.exchange_rate) || 1,
          remarks: body.remarks || "",
          address: body.address || "",
          shipping_address: body.shipping_address || "",
          sales_person: salesPerson || undefined,
          box_brand: body.box_brand || null,
          reference_no: body.reference_no || "",
          customer_notes: body.customer_notes || "",
          terms: body.terms || "",
          discount: doc.discount,
          adjustment: doc.adjustment,
          tax_type: doc.tax_type,
          tax_pct: doc.tax_pct,
          tax_amount: doc.tax_amount,
          total_amount: doc.total_amount,
          // Container-plan snapshot — only when sent, so plain quote edits
          // (QuoteForm doesn't send it) never wipe a saved plan.
          ...(typeof body.container_plan === "string"
            ? { container_plan: body.container_plan.slice(0, 10000) }
            : {}),
        });
        if (nextStatus !== curStatus)
          await logTransition(catalyst, {
            entity_type: "Quote", entity_rowid: quoteId,
            from_status: curStatus, to_status: nextStatus,
            note: nextStatus === "Approved" ? "edited by an approver — auto-approved" : "edited — approval reset",
          });

        // Replace lines: delete existing QuoteItem rows for this quote, re-insert.
        // converted_qty_boxes must survive the wholesale replace or a partially
        // converted quote's over-conversion cap would reset — carry it by design.
        const oldRows = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, design, converted_qty_boxes FROM QuoteItem WHERE quote = ${quoteId}`,
          ),
        );
        const convertedByDesign = new Map();
        for (const r of oldRows) {
          if (r.design)
            convertedByDesign.set(
              String(r.design),
              (convertedByDesign.get(String(r.design)) || 0) + (Number(r.converted_qty_boxes) || 0),
            );
        }
        for (const r of oldRows) await ds.table("QuoteItem").deleteRow(r.ROWID);

        const carried = new Set();
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          // ponytail: carried converted qty lands on the first line of a design.
          const carry = carried.has(designIds[i]) ? 0 : convertedByDesign.get(String(designIds[i])) || 0;
          carried.add(designIds[i]);
          await ds.table("QuoteItem").insertRow({
            quote: quoteId,
            design: designIds[i],
            box_weight_kg: bwMap.get(String(designIds[i])) || 0, // CR-427 snapshot
            quantity_boxes: Number(it.line.qty) || 0,
            rate: Number(it.line.rate) || 0,
            rate_basis: it.line.rate_basis || "box",
            discount_pct: Number(it.line.discount) || 0,
            description: it.line.description || "",
            sub_total: it.sub,
            final_total: it.sub,
            converted_qty_boxes: carry,
          });
        }
        return { rowid: quoteId, data: { ROWID: quoteId, total_amount: doc.total_amount } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Business: Quote status machine. ALL quote status changes go through
   here (the generic PATCH rejects Quote.status writes) so transitions
   are validated, logged, and notified in one place.
   body: { status, reason? }
   ---------------------------------------------------------------- */
const QUOTE_TRANSITIONS = {
  Draft: ["PendingApproval"],
  PendingApproval: ["Approved", "Rejected"], // approver only (approve / reject with reason)
  Approved: ["Sent"],
  Sent: ["Accepted", "Rejected"],
  Accepted: ["Rejected"], // customer can back out until conversion
  Rejected: ["PendingApproval"], // resubmit a rejected quote straight for approval
};

/* Approval verdicts need the role's approve list (Role.matrix) — or Admin. */
function canApprove(req, docType) {
  const u = req.appUser || {};
  if (String(u.role || "").trim().toLowerCase() === "admin") return true;
  return (((u.perms || {}).approve) || []).includes(docType);
}

app.post("/quote-status/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const quoteId = req.params.rowid;
    const to = String((req.body || {}).status || "");
    const reason = String((req.body || {}).reason || "").trim();

    const result = await withOpLog(
      catalyst,
      { table_name: "Quote", operation: "status", payload: { ROWID: quoteId, status: to, reason } },
      async () => {
        const rows = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, quote_number, status, conversion_flag, sales_person FROM Quote WHERE ROWID = ${quoteId}`,
          ),
        );
        if (!rows.length) throw badRequest(`Quote not found: ${quoteId}`, 404);
        const q = rows[0];
        if (q.conversion_flag && q.conversion_flag !== "None")
          throw badRequest("Quote is already (partially) converted — status can no longer change", 409);

        const from = String(q.status || "Draft");
        if (!(QUOTE_TRANSITIONS[from] || []).includes(to))
          throw badRequest(`Cannot move quote from ${from} to ${to}`, 409);
        if (from === "PendingApproval" && !canApprove(req, "Quote"))
          throw badRequest("Your role cannot approve or reject quotations", 403);
        if (to === "Rejected" && !reason)
          throw badRequest("A rejection reason is required");

        // Persist the reason on the record when rejecting so the status hover
        // can show it on grids (which don't load StatusTransition).
        await ds.table("Quote").updateRow(
          to === "Rejected" ? { ROWID: quoteId, status: to, reject_reason: reason } : { ROWID: quoteId, status: to },
        );
        await logTransition(catalyst, {
          entity_type: "Quote", entity_rowid: quoteId, from_status: from, to_status: to, note: reason,
        });

        // Approval verdicts ping the quote's salesperson in-app.
        if (from === "PendingApproval" && q.sales_person) {
          const sp = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT app_user FROM SalesPerson WHERE ROWID = ${q.sales_person}`,
            ),
          )[0];
          const verdict = to === "Approved" ? "approved" : `rejected: ${reason}`;
          await notifyUser(catalyst, sp && sp.app_user, `Quote ${q.quote_number} ${verdict}`, `#/quotes/${quoteId}`);
        }
        return { rowid: quoteId, data: { ROWID: quoteId, status: to } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Business: SalesOrder status machine — mirrors /quote-status. ALL SO
   status changes go through here (the generic PATCH rejects
   SalesOrder.status writes) so transitions are validated, logged, and
   notified in one place. body: { status, reason? }
   ---------------------------------------------------------------- */
/* Auto-enqueue a confirmed SO's items into the production waitlist as
   editable plan rows. Dedupe on order_item so a re-confirm (Cancelled →
   Confirmed) never double-inserts. Manual "Record New Production" still
   works alongside this. Called on the PendingApproval→Confirmed transition
   AND for SOs born Confirmed (approver bypass at create/convert). */
async function enqueueSoProduction(catalyst, ds, soId) {
  // ponytail: RETIRED by CR-198 (production-first) — the factory produces to
  // stock and stock is allocated to the SO (/allocate-stock), so confirming an
  // SO no longer creates production jobs. Body + call sites kept for rollback:
  // delete this return to restore. Existing open so-… jobs keep working.
  return;
  // eslint-disable-next-line no-unreachable
  const items = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, design, ordered_qty_boxes FROM OrderItem WHERE sales_order = ${soId} AND deleted_at is null`,
    ),
  );
  if (!items.length) return;
  const existing = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT order_item FROM ProductionLog WHERE entry_type = 'plan' AND sales_order = ${soId} AND deleted_at is null`,
    ),
  );
  const seen = new Set(existing.map((r) => String(r.order_item || "")));
  const group = `so-${soId}`;
  for (const it of items) {
    const oiId = String(it.ROWID);
    if (seen.has(oiId)) continue;
    const row = await ds.table("ProductionLog").insertRow({
      design: String(it.design || "") || null,
      sales_order: soId,
      order_item: oiId,
      qty_requested: Number(it.ordered_qty_boxes) || 0,
      qty_boxes: 0,
      status: "Approved",
      entry_type: "plan",
      stage: "New",
      request_group: group,
    });
    await logTransition(catalyst, {
      entity_type: "ProductionLog", entity_rowid: row.ROWID, from_status: "", to_status: "New",
    });
  }
}

const SO_TRANSITIONS = {
  Draft: ["PendingApproval"],
  PendingApproval: ["Confirmed", "Rejected"], // approver only (approve / reject with reason)
  Confirmed: ["InProgress", "Cancelled"],
  InProgress: ["Cancelled"],
  Cancelled: ["Confirmed"],
  Rejected: ["PendingApproval"], // resubmit a rejected order straight for approval
};
// Every SO status: the approval machine above + the auto roll-up ones (CR-230, lib/soStatus).
const SO_STATUSES = [...Object.keys(SO_TRANSITIONS), "PartiallyCompleted", "Completed"];

app.post("/so-status/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const soId = req.params.rowid;
    const to = String((req.body || {}).status || "");
    const reason = String((req.body || {}).reason || "").trim();
    const manual = !!(req.body || {}).manual;

    const result = await withOpLog(
      catalyst,
      { table_name: "SalesOrder", operation: "status", payload: { ROWID: soId, status: to, reason, manual } },
      async () => {
        const rows = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, order_number, status, sales_person FROM SalesOrder WHERE ROWID = ${soId}`,
          ),
        );
        if (!rows.length) throw badRequest(`Sales order not found: ${soId}`, 404);
        const so = rows[0];

        const from = String(so.status || "Draft");
        // CR-231: a manual change may jump to ANY status, but must say why.
        // Jumping an unapproved order past approval still needs an approver.
        if (manual) {
          if (!SO_STATUSES.includes(to)) throw badRequest(`Unknown sales order status: ${to}`);
          if (!reason) throw badRequest("A reason is required to change the status manually");
          const unapproved = (s) => ["Draft", "PendingApproval", "Rejected"].includes(s);
          if (unapproved(from) && !unapproved(to) && to !== "Cancelled" && !canApprove(req, "SalesOrder"))
            throw badRequest("Your role cannot approve sales orders", 403);
        } else if (!(SO_TRANSITIONS[from] || []).includes(to))
          throw badRequest(`Cannot move sales order from ${from} to ${to}`, 409);
        if (from === "PendingApproval" && !canApprove(req, "SalesOrder"))
          throw badRequest("Your role cannot approve or reject sales orders", 403);
        if (to === "Rejected" && !reason)
          throw badRequest("A rejection reason is required");
        if (to === "Cancelled" && !reason) throw badRequest("A reason is required to cancel the order"); // CR-371
        // CR-371: a cancelled order leaves nothing on the palletization board and hands every
        // allocation back — or refuses (409) BEFORE the status write when a box is already dispatched.
        if (to === "Cancelled" && from !== "Cancelled") await cancelSoPalletization(catalyst, ds, soId, reason);

        // Persist the reason on the record (see /quote-status) for the grid hover.
        await ds.table("SalesOrder").updateRow(
          to === "Rejected" ? { ROWID: soId, status: to, reject_reason: reason } : { ROWID: soId, status: to },
        );
        await logTransition(catalyst, {
          entity_type: "SalesOrder", entity_rowid: soId, from_status: from, to_status: to,
          note: manual ? `manual — ${reason}` : reason,
        });

        // Approval verdicts ping the order's salesperson in-app.
        if (from === "PendingApproval" && so.sales_person) {
          const sp = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT app_user FROM SalesPerson WHERE ROWID = ${so.sales_person}`,
            ),
          )[0];
          const verdict = to === "Confirmed" ? "approved" : `rejected: ${reason}`;
          await notifyUser(catalyst, sp && sp.app_user, `Order ${so.order_number} ${verdict}`, `#/orders/${soId}`);
        }

        // RETIRED no-op since CR-198 (production-first): confirming an SO no longer
        // creates production jobs — see enqueueSoProduction. Call kept for rollback.
        if (to === "Confirmed") await enqueueSoProduction(catalyst, ds, soId);
        return { rowid: soId, data: { ROWID: soId, status: to } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Business: SalesOrder header + line items
   body: { customer, po_number, order_date, shipment_date, payment_term,
           port_of_discharge, status, currency, remarks, address, shipping_address, order_number,
           quote_rowid?, salesperson, customer_notes, terms, box_branding?,
           lines: [{ item, qty, rate, discount?, stage?, priority?, due_date? }] }
   ---------------------------------------------------------------- */
app.post("/so-with-items", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const dMap = await designMap(catalyst, (Array.isArray(body.lines) ? body.lines : []).map((l) => l && l.item));
    const cMap = await customerMap(catalyst, [body.customer]);
    const pMap = await paymentTermMap(catalyst);
    const sMap = await salesPersonMap(catalyst);

    const bornStatus = canApprove(req, "SalesOrder") ? "Confirmed" : "Draft";
    const result = await withOpLog(
      catalyst,
      { table_name: "SalesOrder", operation: "insert", payload: body },
      async () => {
        const so = await createSalesOrder(ds, body, { dMap, cMap, pMap, sMap, catalyst, bornStatus });
        if (bornStatus === "Confirmed") {
          await logTransition(catalyst, {
            entity_type: "SalesOrder", entity_rowid: so.rowid, from_status: "", to_status: "Confirmed",
            note: "Auto-approved — created by an approver",
          });
          await enqueueSoProduction(catalyst, ds, so.rowid);
        }
        return so;
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Business: update an existing SalesOrder header + its line items IN
   PLACE (CR-232: lines[].id = existing OrderItem, no id = new line, a
   missing id = removed). order_number is never editable; status is never
   editable here (use /so-status).
   ---------------------------------------------------------------- */
app.post("/update-so-with-items/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const soId = req.params.rowid;
    const dMap = await designMap(catalyst, (Array.isArray(body.lines) ? body.lines : []).map((l) => l && l.item));
    const cMap = await customerMap(catalyst, [body.customer]);
    const pMap = await paymentTermMap(catalyst);
    const sMap = await salesPersonMap(catalyst);

    const result = await withOpLog(
      catalyst,
      { table_name: "SalesOrder", operation: "update", payload: { ROWID: soId, ...body } },
      async () => {
        const cur = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, status, order_number FROM SalesOrder WHERE ROWID = ${soId}`,
          ),
        )[0];
        if (!cur) throw badRequest(`Sales order not found: ${soId}`, 404);

        // CR-232: lines are edited IN PLACE (matched by lines[].id) so an order
        // with work recorded — pallets, loads, a partial dispatch — stays editable.
        const QTY_COLS = [
          "produced_qty_boxes", "purchased_qty_boxes", "palletized_qty_boxes",
          "loaded_qty_boxes", "dispatched_qty_boxes",
        ];
        const oldItems = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, design, ${QTY_COLS.join(", ")} FROM OrderItem WHERE sales_order = ${soId}`,
          ),
        );
        const hasWork = (it) => QTY_COLS.some((c) => (Number(it[c]) || 0) > 0);
        const workRecorded = oldItems.some(hasWork);

        // Validate everything up front — never write a header then fail on a line.
        assertDateOrder(body.order_date, body.shipment_date, "order date", "shipment date");
        const customer = resolveOrThrow(cMap, body.customer, "Customer");
        const paymentTerm = resolveOptional(pMap, body.payment_term, "Payment term");
        const salesPerson = resolveOptional(sMap, body.salesperson, "Sales person");
        const { items, total } = computeLines(body.lines);
        const designIds = items.map((it) => resolveOrThrow(dMap, it.line.item, "Design"));
        const bwMap = await designBoxWeights(catalyst, designIds); // CR-427
        const warehouse = rowidParam(body.warehouse) || null; // CR-468: optional (reverses CR-453)

        // Line rules, checked before any write: a line with work keeps its
        // design, can't drop below what is already palletised/loaded/dispatched,
        // and can't be removed (pallets and loads point at it).
        const oldById = new Map(oldItems.map((r) => [String(r.ROWID), r]));
        items.forEach((it, i) => {
          const id = String(it.line.id || "");
          if (!id) return;
          const old = oldById.get(id);
          if (!old) throw badRequest(`Line ${i + 1} no longer exists on this order — reload and retry`, 409);
          if (!hasWork(old)) return;
          if (String(old.design) !== String(designIds[i]))
            throw badRequest(`Line ${i + 1}: the item can't change once work is recorded`, 409);
          const floor = Math.max(
            Number(old.palletized_qty_boxes) || 0, Number(old.loaded_qty_boxes) || 0, Number(old.dispatched_qty_boxes) || 0,
          );
          if ((Number(it.line.qty) || 0) < floor)
            throw badRequest(`Line ${i + 1}: qty can't go below ${floor} boxes already palletised / loaded / dispatched`);
        });
        const keptIds = new Set(items.map((it) => String(it.line.id || "")).filter(Boolean));
        const removed = oldItems.filter((r) => !keptIds.has(String(r.ROWID)));
        if (removed.some(hasWork))
          throw badRequest("A line with work recorded can't be removed — reduce its qty instead", 409);
        if (removed.length) {
          const planned = rowList(await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID FROM PalletizationPlanLine WHERE order_item IN (${removed.map((r) => r.ROWID).join(",")}) AND deleted_at is null LIMIT 1`,
          ));
          if (planned.length) throw badRequest("A line that is on a palletization plan can't be removed", 409);
        }

        const doc = docCompute(total, body);
        // Editing content invalidates a pending/granted approval → back to
        // Draft ("Confirmed" is the approved state in SO_TRANSITIONS) —
        // unless the editor can approve SOs (CR): stays/lands Confirmed.
        const curStatus = String(cur.status || "Draft");
        // Never once work is recorded: a Draft order would drop off the floor.
        const nextStatus =
          !workRecorded && (curStatus === "PendingApproval" || curStatus === "Confirmed")
            ? canApprove(req, "SalesOrder") ? "Confirmed" : "Draft"
            : curStatus;
        await ds.table("SalesOrder").updateRow({
          ROWID: soId,
          customer,
          warehouse, // CR-453
          po_number: body.po_number || "",
          order_date: body.order_date || undefined,
          shipment_date: body.shipment_date || undefined,
          payment_term: paymentTerm,
          port_of_discharge: body.port_of_discharge || "",
          status: nextStatus,
          currency: body.currency || "INR",
          exchange_rate: Number(body.exchange_rate) || 1,
          remarks: body.remarks || "",
          // Billing + shipping address (CR-221: on the SO form). Omitted when
          // unsent so an older client can't blank what the order already carries.
          ...(typeof body.address === "string" ? { address: body.address } : {}),
          ...(typeof body.shipping_address === "string" ? { shipping_address: body.shipping_address } : {}),
          // Box Brand master pick (Brand FK, CR-162). The legacy free-text
          // box_branding column is left untouched (read-only history).
          box_brand: requireBoxBrand(body.box_brand),
          sales_person: salesPerson || undefined,
          customer_notes: body.customer_notes || "",
          terms: body.terms || "",
          discount: doc.discount,
          adjustment: doc.adjustment,
          tax_type: doc.tax_type,
          tax_pct: doc.tax_pct,
          tax_amount: doc.tax_amount,
          total_amount: doc.total_amount,
        });
        if (nextStatus !== curStatus)
          await logTransition(catalyst, {
            entity_type: "SalesOrder", entity_rowid: soId,
            from_status: curStatus, to_status: nextStatus,
            note: nextStatus === "Confirmed" ? "edited by an approver — auto-approved" : "edited — approval reset",
          });

        for (const r of removed) await ds.table("OrderItem").deleteRow(r.ROWID);
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const l = it.line;
          const fields = {
            design: designIds[i],
            pallet: l.pallet ? String(l.pallet) : null, // pallet spec chosen at SO creation
            ordered_qty_boxes: Number(l.qty) || 0,
            priority_level: l.priority || "normal",
            due_date: l.due_date || undefined,
            rate: Number(l.rate) || 0,
            discount_pct: Number(l.discount) || 0,
            description: l.description || "",
            sub_total: it.sub,
            final_total: it.sub,
          };
          if (l.id) {
            // CR-427: the frozen weight moves only when the line's ITEM changes — a qty/rate edit keeps it.
            const old = oldItems.find((r) => String(r.ROWID) === String(l.id));
            const swapped = !old || String(old.design || "") !== String(designIds[i]);
            await ds.table("OrderItem").updateRow({ ROWID: String(l.id), ...fields, ...(swapped ? { box_weight_kg: bwMap.get(String(designIds[i])) || 0 } : {}) });
          } else
            await ds.table("OrderItem").insertRow({
              sales_order: soId,
              ...fields,
              box_weight_kg: bwMap.get(String(designIds[i])) || 0, // CR-427 snapshot
              produced_qty_boxes: 0,
              purchased_qty_boxes: 0,
              qc_passed_qty_boxes: 0,
              palletized_qty_boxes: 0,
              loaded_qty_boxes: 0,
              dispatched_qty_boxes: 0,
              stage: l.stage || "po",
            });
        }
        // An edit is an explicit user act, so the status may step BACK too:
        // 1000→400 on a 400-dispatched order ⇒ Completed; back to 1000 ⇒ Partially Completed.
        if (workRecorded)
          await recountOrderItems(catalyst, ds, oldItems.map((r) => r.ROWID), { allowDemote: true });
        // Approver-edit landed a pending SO on Confirmed → run the same
        // side-effect the approve click would have (after lines are replaced).
        if (curStatus === "PendingApproval" && nextStatus === "Confirmed")
          await enqueueSoProduction(catalyst, ds, soId);
        return { rowid: soId, data: { ROWID: soId, order_number: cur.order_number, total_amount: doc.total_amount } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Server-assigned SO number: max numeric suffix for this fiscal year + 1.
   ponytail: MAX-scan over SalesOrder, not TransactionSeries — assertUnique
   below is the backstop if two inserts race; wire TransactionSeries when
   multi-user contention becomes real. */
// CR-302: also mints PNL/FY/NNN for PanelOrder — same FY prefix + max-scan, one function.
async function nextOrderNumber(catalyst, table = "SalesOrder", tag = "SO") {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Indian FY (Apr–Mar)
  const prefix = `${tag}/${y}-${String((y + 1) % 100).padStart(2, "0")}/`;
  const rows = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT order_number FROM ${table}`));
  let max = 0;
  for (const r of rows) {
    const n = String(r.order_number || "");
    if (n.startsWith(prefix)) max = Math.max(max, parseInt(n.slice(prefix.length), 10) || 0);
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

// CR-483: every Sales Order carries a Box Brand (the floor prints it on the
// boxes) — the form enforces it and so does every write path here.
function requireBoxBrand(v) {
  const id = String(v || "").trim();
  if (!/^\d+$/.test(id)) throw badRequest("Box Brand is required");
  return id;
}

async function createSalesOrder(ds, body, maps) {
  // Blank order_number → the server assigns the next number (clients no
  // longer generate SO numbers; hard-coded counters caused 409 collisions).
  const orderNumber =
    String(body.order_number || "").trim() ||
    (maps.catalyst ? await nextOrderNumber(maps.catalyst) : "");
  // Validate everything up front — never write a header then fail on a line.
  if (maps.catalyst) await assertUnique(maps.catalyst, "SalesOrder", "order_number", orderNumber);
  assertDateOrder(body.order_date, body.shipment_date, "order date", "shipment date");
  // Customer: convert-quote passes the source quote's customer ROWID directly
  // (customer_rowid); direct SO creation passes a name to resolve strictly.
  const customer = body.customer_rowid || resolveOrThrow(maps.cMap, body.customer, "Customer");
  const paymentTerm = resolveOptional(maps.pMap, body.payment_term, "Payment term");
  // Sales person: convert-quote passes the source FK directly (sales_person_rowid);
  // direct SO creation passes a name to resolve against the master.
  const salesPerson = resolveOptional(maps.sMap, body.salesperson, "Sales person") || body.sales_person_rowid || null;
  const { items, total } = computeLines(body.lines);
  const designIds = items.map((it) => resolveOrThrow(maps.dMap, it.line.item, "Design"));
  const bwMap = await designBoxWeights(maps.catalyst, designIds); // CR-427 (was a bare `catalyst` → ReferenceError on every SO create)
  // CR-468: Location is optional on an order (reverses CR-453) — stock carries its own bay.
  const warehouse = rowidParam(body.warehouse) || null;

  const doc = docCompute(total, body);
  const soRow = await ds.table("SalesOrder").insertRow({
    order_number: orderNumber,
    quote: body.quote_rowid || null,
    customer,
    po_number: body.po_number || "",
    order_date: body.order_date || undefined,
    // date column rejects "" → omit (undefined) when blank.
    shipment_date: body.shipment_date || undefined,
    payment_term: paymentTerm,
    port_of_discharge: body.port_of_discharge || "",
    // Born Draft — approval is mandatory (mirror of quotes), so a crafted
    // create can't mint a pre-approved order. Exception (CR): callers pass
    // bornStatus "Confirmed" when the creating user can approve sales orders
    // (Admin or role approver) — no approval loop for them.
    status: maps.bornStatus || "Draft",
    currency: body.currency || "INR",
    exchange_rate: Number(body.exchange_rate) || 1,
    remarks: body.remarks || "",
    address: body.address || "",
    shipping_address: body.shipping_address || "",
    warehouse, // CR-453
    manual_so_number: body.manual_so_number || "",
    // Box Brand master pick (Brand FK, CR-162) — replaces the free-text box_branding.
    box_brand: requireBoxBrand(body.box_brand),
    sales_person: salesPerson || undefined,
    customer_notes: body.customer_notes || "",
    terms: body.terms || "",
    discount: doc.discount,
    adjustment: doc.adjustment,
    tax_type: doc.tax_type,
    tax_pct: doc.tax_pct,
    tax_amount: doc.tax_amount,
    total_amount: doc.total_amount,
    ...(typeof body.container_plan === "string" && body.container_plan
      ? { container_plan: body.container_plan.slice(0, 10000) }
      : {}),
  });
  const soId = soRow.ROWID;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const l = it.line;
    await ds.table("OrderItem").insertRow({
      sales_order: soId,
      design: designIds[i],
      box_weight_kg: bwMap.get(String(designIds[i])) || 0, // CR-427 snapshot
      pallet: l.pallet ? String(l.pallet) : null, // pallet spec chosen at SO creation
      ordered_qty_boxes: Number(l.qty) || 0,
      produced_qty_boxes: 0,
      purchased_qty_boxes: 0,
      qc_passed_qty_boxes: 0,
      palletized_qty_boxes: 0,
      loaded_qty_boxes: 0,
      dispatched_qty_boxes: 0,
      stage: l.stage || "po",
      priority_level: l.priority || "normal",
      due_date: l.due_date || undefined,
      rate: Number(l.rate) || 0,
      discount_pct: Number(l.discount) || 0,
      description: l.description || "",
      sub_total: it.sub,
      final_total: it.sub,
    });
  }
  return { rowid: soId, data: { ROWID: soId, order_number: orderNumber, total_amount: doc.total_amount } };
}

/* ----------------------------------------------------------------
   Business: Convert Quote -> SalesOrder
   body: { mode: "Full" | "Partial",
           lines: [{ item, qty, rate }],  // the lines to convert
           order_number, po_number }
   ---------------------------------------------------------------- */
app.post("/convert-quote/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const quoteId = req.params.rowid;
    const dMap = await designMap(catalyst, (Array.isArray(body.lines) ? body.lines : []).map((l) => l && l.item));
    const cMap = await customerMap(catalyst, [body.customer]);
    const pMap = await paymentTermMap(catalyst);
    const sMap = await salesPersonMap(catalyst);

    const result = await withOpLog(
      catalyst,
      { table_name: "SalesOrder", operation: "convert", payload: { quoteId, ...body } },
      async () => {
        // Load the source quote for header copy.
        const rows = rowList(
          await catalyst.zcql().executeZCQLQuery(`SELECT * FROM Quote WHERE ROWID = ${quoteId}`),
        );
        if (!rows.length) {
          const e = new Error(`Quote not found: ${quoteId}`);
          e.statusCode = 404;
          throw e;
        }
        const q = rows[0];

        // Only Sent / Accepted / partially converted quotes can convert —
        // Draft/PendingApproval/Approved would bypass the approval gate.
        const effStatus = q.conversion_flag === "Partial" ? "PartiallyConverted" : String(q.status || "Draft");
        if (q.conversion_flag === "Full" || !["Sent", "Accepted", "PartiallyConverted"].includes(effStatus))
          throw badRequest(`Quote in status ${effStatus} cannot be converted`, 409);

        // Cumulative over-conversion guard: requested qty per design must fit
        // within quantity_boxes − converted_qty_boxes across the quote's lines.
        // ponytail: lines keyed by design; two lines with the same design share one cap.
        const qItems = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, design, quantity_boxes, converted_qty_boxes FROM QuoteItem WHERE quote = ${quoteId} AND deleted_at is null`,
          ),
        );
        const remainingOf = (it) =>
          Math.max(0, (Number(it.quantity_boxes) || 0) - (Number(it.converted_qty_boxes) || 0));
        const reqByDesign = new Map();
        for (const l of Array.isArray(body.lines) ? body.lines : []) {
          const dId = resolveOrThrow(dMap, l.item, "Design");
          reqByDesign.set(String(dId), (reqByDesign.get(String(dId)) || 0) + (Number(l.qty) || 0));
        }
        if (!reqByDesign.size) throw badRequest("At least one line is required");
        for (const [dId, want] of reqByDesign) {
          const lines = qItems.filter((it) => String(it.design) === dId);
          // Designs not on the quote are allowed (user-added lines during
          // conversion) — they land on the SO but never touch converted_qty.
          if (!lines.length) continue;
          const remaining = lines.reduce((s, it) => s + remainingOf(it), 0);
          if (want <= 0) throw badRequest("Convert qty must be > 0");
          if (want > remaining)
            throw badRequest(
              `Converting ${want} boxes exceeds the remaining ${remaining} on the quote line`,
              409,
            );
        }

        const so = await createSalesOrder(
          ds,
          {
            order_number: body.order_number || "",
            po_number: body.po_number || "",
            customer: body.customer, // name; resolved below
            customer_rowid: q.customer,
            order_date: body.order_date || "",
            shipment_date: body.shipment_date || "",
            payment_term: body.payment_term,
            port_of_discharge: q.port_of_discharge,
            warehouse: body.warehouse, // CR-453: the convert form asks for it
            currency: q.currency,
            exchange_rate: q.exchange_rate,
            remarks: body.remarks || `Converted from ${q.quote_number}${body.mode === "Partial" ? " (partial)" : ""}`,
            // CR-221: the convert form may edit the addresses; unsent = the quote's.
            address: typeof body.address === "string" ? body.address : q.address,
            shipping_address: typeof body.shipping_address === "string" ? body.shipping_address : q.shipping_address,
            // Carry the quote's Books-parity header fields onto the SO, allowing
            // the convert request to override per-field. Sales person carries by
            // FK (sales_person_rowid); a name override resolves in createSalesOrder.
            sales_person_rowid: q.sales_person || null,
            salesperson: body.salesperson || "",
            // Box Brand carries from the quote unless the convert form overrides it.
            box_brand: body.box_brand || q.box_brand || null,
            customer_notes: body.customer_notes || q.customer_notes || "",
            terms: body.terms || q.terms || "",
            // Doc-level charges: inherit from the source quote unless overridden.
            discount: body.discount != null ? body.discount : q.discount,
            adjustment: body.adjustment != null ? body.adjustment : q.adjustment,
            tax_type: body.tax_type || q.tax_type || "None",
            tax_pct: body.tax_pct != null ? body.tax_pct : q.tax_pct,
            quote_rowid: quoteId,
            // Snapshot the quote's container plan — the SO owns its copy from here.
            container_plan: q.container_plan || "",
            lines: Array.isArray(body.lines) ? body.lines : [],
          },
          // Converter who can approve SOs → the SO is born Confirmed (the
          // source quote already passed approval; no second loop for them).
          { dMap, cMap, pMap, sMap, catalyst, bornStatus: canApprove(req, "SalesOrder") ? "Confirmed" : "Draft" },
        );
        if (canApprove(req, "SalesOrder")) {
          await logTransition(catalyst, {
            entity_type: "SalesOrder", entity_rowid: so.rowid, from_status: "", to_status: "Confirmed",
            note: "Auto-approved — converted by an approver",
          });
          await enqueueSoProduction(catalyst, ds, so.rowid);
        }

        // Bump converted_qty_boxes (fill lines in order within a design), then
        // derive Full/Partial from what's actually left — never trust body.mode.
        for (const [dId, want] of reqByDesign) {
          let left = want;
          for (const it of qItems.filter((x) => String(x.design) === dId)) {
            if (left <= 0) break;
            const add = Math.min(remainingOf(it), left);
            if (add <= 0) continue;
            it.converted_qty_boxes = (Number(it.converted_qty_boxes) || 0) + add;
            await ds.table("QuoteItem").updateRow({ ROWID: it.ROWID, converted_qty_boxes: it.converted_qty_boxes });
            left -= add;
          }
        }
        // Lines whose design was deleted (SET-NULL) can never convert — ignore them.
        const allDone = qItems.filter((it) => it.design).every((it) => remainingOf(it) === 0);
        const flag = allDone ? "Full" : "Partial";
        const newStatus = allDone ? "Converted" : "PartiallyConverted";
        await ds.table("Quote").updateRow({ ROWID: quoteId, conversion_flag: flag, status: newStatus });
        await logTransition(catalyst, {
          entity_type: "Quote", entity_rowid: quoteId, from_status: effStatus, to_status: newStatus,
          note: `→ ${so.data.order_number}`,
        });
        return { rowid: so.rowid, data: { so_rowid: so.rowid, quote_rowid: quoteId, conversion_flag: flag, order_number: so.data.order_number } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ================================================================
   PHASE 4 — Palletisation, Container Loading, Dispatch (sagas)

   No DB transactions in Catalyst → each flow validates everything up
   front (so we never write a header then fail on a child), then writes
   in an ordered sequence. close-pallet compensates on mid-write failure.
   OrderItem's palletized/loaded/dispatched counters are a denormalised
   cache recomputed from ground truth by recountOrderItems() after every
   mutating op — idempotent, so a mid-write crash self-heals on the next
   op (or the admin /recount-order-items backfill).
   ================================================================ */

/** Load OrderItems by ROWID into a Map<id,row>. Returns empty Map for []. */
async function loadOrderItems(catalyst, ids, cols) {
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (!uniq.length) return new Map();
  const rows = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT ${cols} FROM OrderItem WHERE ROWID IN (${uniq.join(",")})`),
  );
  return new Map(rows.map((r) => [String(r.ROWID), r]));
}

/* ----------------------------------------------------------------
   recountOrderItems — the ONE writer of OrderItem's shipping counters.
   Recomputes palletized/loaded/dispatched_qty_boxes from ground truth
   (PalletisedBatch lines + PalletizationPlan lines/LoadBoxes) instead of
   incrementing, so the counters can't drift no matter which flow moved
   the boxes. Every mutating op in both flows calls this after its
   ground-truth writes. Stage is promote-only (packing→loading→final);
   the manual po/prod/qc chain and produced_qty_boxes are never touched.
   ---------------------------------------------------------------- */
const STAGE_RANK = { po: 0, prod: 1, qc: 2, packing: 3, loading: 4, final: 5 };
const { SO_RANK, nextSoStatus } = require("./lib/soStatus");

/* CR-230/233: dispatch closes the SalesOrder — Partially Completed / Completed
   (dispatched vs ordered over ALL the SO's lines). Palletization + loading
   progress are grid columns, not SO statuses. Runs at the tail of every recount. Promote-only unless
   allowDemote (an SO edit), so a manual status is never silently undone. */
async function rollupSoStatus(catalyst, ds, oiIds, allowDemote) {
  const zcql = catalyst.zcql();
  const soIds = [...new Set(
    rowList(await zcql.executeZCQLQuery(`SELECT sales_order FROM OrderItem WHERE ROWID IN (${oiIds.join(",")})`))
      .map((r) => String(r.sales_order || "")),
  )].filter(Boolean);
  for (const soId of soIds) {
    const so = rowList(await zcql.executeZCQLQuery(`SELECT ROWID, status FROM SalesOrder WHERE ROWID = ${soId}`))[0];
    const from = String((so && so.status) || "");
    if (!(from in SO_RANK)) continue;
    const items = await zcqlAllRows(
      catalyst,
      `SELECT ROWID, ordered_qty_boxes, dispatched_qty_boxes FROM OrderItem WHERE sales_order = ${soId} AND deleted_at is null`,
    );
    if (!items.length) continue;
    const t = { ordered: 0, dispatched: 0 };
    for (const it of items) {
      t.ordered += Number(it.ordered_qty_boxes) || 0;
      t.dispatched += Number(it.dispatched_qty_boxes) || 0;
    }
    const to = nextSoStatus(from, t, allowDemote);
    if (!to) continue;
    await ds.table("SalesOrder").updateRow({ ROWID: soId, status: to });
    await logTransition(catalyst, {
      entity_type: "SalesOrder", entity_rowid: soId, from_status: from, to_status: to,
      note: "auto — follows dispatch",
    });
  }
}

async function recountOrderItems(catalyst, ds, oiIds, opts) {
  const uniq = [...new Set((oiIds || []).map(String))].filter(Boolean);
  if (!uniq.length) return;
  const zcql = catalyst.zcql();
  const inList = uniq.join(",");

  // Legacy flow: batch lines + parent batch status (soft-deleted parents drop out).
  const batchLines = rowList(
    await zcql.executeZCQLQuery(
      `SELECT batch, order_item, boxes FROM PalletisedBatchLine WHERE order_item IN (${inList}) AND deleted_at is null`,
    ),
  );
  const batchIds = [...new Set(batchLines.map((l) => String(l.batch)))].filter(Boolean);
  const batchStatus = new Map();
  if (batchIds.length) {
    rowList(
      await zcql.executeZCQLQuery(
        `SELECT ROWID, status FROM PalletisedBatch WHERE ROWID IN (${batchIds.join(",")}) AND deleted_at is null`,
      ),
    ).forEach((b) => batchStatus.set(String(b.ROWID), String(b.status || "")));
  }

  // Live flow: plan lines (drop lines of soft-deleted plans) + LoadBox status.
  const planLines = rowList(
    await zcql.executeZCQLQuery(
      `SELECT plan, order_item, boxes, status, load_box FROM PalletizationPlanLine WHERE order_item IN (${inList}) AND deleted_at is null`,
    ),
  );
  const planIds = [...new Set(planLines.map((l) => String(l.plan)))].filter(Boolean);
  const livePlans = new Set();
  if (planIds.length) {
    rowList(
      await zcql.executeZCQLQuery(
        `SELECT ROWID FROM PalletizationPlan WHERE ROWID IN (${planIds.join(",")}) AND deleted_at is null`,
      ),
    ).forEach((p) => livePlans.add(String(p.ROWID)));
  }
  const boxIds = [...new Set(planLines.map((l) => String(l.load_box || "")))].filter(Boolean);
  const boxStatus = new Map();
  if (boxIds.length) {
    rowList(
      await zcql.executeZCQLQuery(
        `SELECT ROWID, status FROM LoadBox WHERE ROWID IN (${boxIds.join(",")}) AND deleted_at is null`,
      ),
    ).forEach((b) => boxStatus.set(String(b.ROWID), String(b.status || "")));
  }

  const totals = new Map(uniq.map((id) => [id, { palletized: 0, loaded: 0, dispatched: 0 }]));
  for (const l of batchLines) {
    const t = totals.get(String(l.order_item));
    const st = batchStatus.get(String(l.batch));
    if (!t || st == null) continue;
    const boxes = Number(l.boxes) || 0;
    t.palletized += boxes;
    if (st === "loaded" || st === "dispatched") t.loaded += boxes;
    if (st === "dispatched") t.dispatched += boxes;
  }
  for (const l of planLines) {
    const t = totals.get(String(l.order_item));
    if (!t || !livePlans.has(String(l.plan))) continue;
    const boxes = Number(l.boxes) || 0;
    const boxId = String(l.load_box || "");
    const inBox = boxId && boxStatus.has(boxId);
    if (String(l.status) === "ReadyToLoad" || inBox) t.palletized += boxes;
    if (inBox) {
      t.loaded += boxes;
      if (boxStatus.get(boxId) === "Dispatched") t.dispatched += boxes;
    }
  }

  const cur = await loadOrderItems(
    catalyst,
    uniq,
    "ROWID, ordered_qty_boxes, palletized_qty_boxes, loaded_qty_boxes, dispatched_qty_boxes, stage",
  );
  for (const [oiId, t] of totals) {
    const oi = cur.get(oiId);
    if (!oi) continue;
    const ordered = Number(oi.ordered_qty_boxes) || 0;
    const derived =
      t.dispatched >= ordered && ordered > 0 ? "final" : t.loaded > 0 ? "loading" : t.palletized > 0 ? "packing" : null;
    const curStage = String(oi.stage || "");
    const promote = derived && (STAGE_RANK[derived] ?? -1) > (STAGE_RANK[curStage] ?? -1);
    const changed =
      t.palletized !== (Number(oi.palletized_qty_boxes) || 0) ||
      t.loaded !== (Number(oi.loaded_qty_boxes) || 0) ||
      t.dispatched !== (Number(oi.dispatched_qty_boxes) || 0);
    if (!changed && !promote) continue;
    const patch = {
      ROWID: oiId,
      palletized_qty_boxes: t.palletized,
      loaded_qty_boxes: t.loaded,
      dispatched_qty_boxes: t.dispatched,
    };
    if (promote) patch.stage = derived;
    await ds.table("OrderItem").updateRow(patch);
    if (promote)
      await logTransition(catalyst, {
        entity_type: "OrderItem", entity_rowid: oiId, from_status: curStage, to_status: derived,
      });
  }
  await rollupSoStatus(catalyst, ds, uniq, !!(opts && opts.allowDemote));
}

/* 3b. Close a pallet — PalletisedBatch + lines + OrderItem.palletized + events. */
app.post("/close-pallet", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const result = await withOpLog(
      catalyst,
      { table_name: "PalletisedBatch", operation: "close-pallet", payload: body },
      async () => closePallet(catalyst, ds, body),
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

async function closePallet(catalyst, ds, body) {
  // --- validate up front ---
  if (!body.sales_order) throw badRequest("sales_order is required");
  if (!body.pallet) throw badRequest("pallet is required");
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) throw badRequest("At least one pallet line is required");
  const lines = rawLines.map((l, i) => {
    if (!l.order_item) throw badRequest(`Line ${i + 1}: order_item is required`);
    const boxes = nonNeg(l.boxes, `Line ${i + 1} boxes`);
    if (boxes <= 0) throw badRequest(`Line ${i + 1}: boxes must be > 0`);
    return {
      order_item: String(l.order_item),
      boxes,
      // Batch rides per line so a mixed pallet keeps each leftover's own.
      batch_number: String(l.batch_number || body.batch_number || "").trim(),
    };
  });
  const totalBoxes = lines.reduce((s, l) => s + l.boxes, 0);

  // Aggregate per order item. The old "palletized + new ≤ produced" guard was
  // intentionally REMOVED (user mandate 2026-07-20): "Need Palletization" is a
  // planning qty the operator sets independently of produced boxes, so more
  // boxes can be palletised than have been produced (to ship more box orders).
  // ponytail: relaxed invariant — re-add a cap here if palletising beyond
  // produced ever needs to be blocked again.
  const reqByOi = new Map();
  for (const l of lines) reqByOi.set(l.order_item, (reqByOi.get(l.order_item) || 0) + l.boxes);
  const oiMap = await loadOrderItems(catalyst, [...reqByOi.keys()], "ROWID");
  for (const oiId of reqByOi.keys()) {
    if (!oiMap.get(oiId)) throw badRequest(`OrderItem not found: ${oiId}`, 404);
  }

  // --- writes (compensate on failure) ---
  const batchRow = await ds.table("PalletisedBatch").insertRow({
    sales_order: body.sales_order,
    pallet: body.pallet,
    design: body.design || null,
    boxes_packed: totalBoxes,
    delivery_date: body.delivery_date || undefined, // date col rejects "" → omit
    status: "closed",
    // Denormalised header batch for a single-batch pallet's slip (blank on mixed).
    batch_number: String(body.batch_number || "").trim(),
    remarks: body.remarks || "",
  });
  const batchId = batchRow.ROWID;
  const insertedLines = [];
  try {
    for (const l of lines) {
      const lr = await ds.table("PalletisedBatchLine").insertRow({ batch: batchId, order_item: l.order_item, boxes: l.boxes, batch_number: l.batch_number });
      insertedLines.push(lr.ROWID);
    }
    for (const [oiId, reqBoxes] of reqByOi) {
      await ds.table("OrderItemEvent").insertRow({
        order_item: oiId,
        event_type: "packed",
        qty_delta: reqBoxes,
        performed_by: String(body.performed_by || ""),
        note: `Pallet batch #${batchId}`,
      });
    }
  } catch (e) {
    // Compensate: delete lines + batch. Best-effort; events left as audit.
    for (const id of insertedLines) {
      try { await ds.table("PalletisedBatchLine").deleteRow(id); } catch (_) {}
    }
    try { await ds.table("PalletisedBatch").deleteRow(batchId); } catch (_) {}
    throw e;
  }
  await recountOrderItems(catalyst, ds, [...reqByOi.keys()]);
  return { rowid: batchId, data: { ROWID: batchId, boxes_packed: totalBoxes, lines: lines.length } };
}

/* Combine leftover (sub-pallet) boxes from MULTIPLE items into ONE real mixed
   pallet (is_mixed=true, design=null). Each line keeps its own batch so a
   mixed pallet legitimately holds several. Mirrors closePallet's
   validate → insert → compensate shape. body: { sales_order, pallet,
   performed_by?, lines: [{ order_item, boxes, batch_number? }] } */
app.post("/combine-leftovers", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const result = await withOpLog(
      catalyst,
      { table_name: "PalletisedBatch", operation: "combine-leftovers", payload: body },
      async () => combineLeftovers(catalyst, ds, body),
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

async function combineLeftovers(catalyst, ds, body) {
  if (!body.sales_order) throw badRequest("sales_order is required");
  if (!body.pallet) throw badRequest("pallet is required");
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) throw badRequest("At least one leftover line is required");
  const lines = rawLines.map((l, i) => {
    if (!l.order_item) throw badRequest(`Line ${i + 1}: order_item is required`);
    const boxes = nonNeg(l.boxes, `Line ${i + 1} boxes`);
    if (boxes <= 0) throw badRequest(`Line ${i + 1}: boxes must be > 0`);
    return {
      order_item: String(l.order_item),
      boxes,
      batch_number: String(l.batch_number || "").trim(),
    };
  });
  const totalBoxes = lines.reduce((s, l) => s + l.boxes, 0);

  const reqByOi = new Map();
  for (const l of lines) reqByOi.set(l.order_item, (reqByOi.get(l.order_item) || 0) + l.boxes);
  const oiMap = await loadOrderItems(catalyst, [...reqByOi.keys()], "ROWID");
  for (const oiId of reqByOi.keys()) {
    if (!oiMap.get(oiId)) throw badRequest(`OrderItem not found: ${oiId}`, 404);
  }

  const batchRow = await ds.table("PalletisedBatch").insertRow({
    sales_order: body.sales_order,
    pallet: body.pallet,
    design: null, // mixed pallet spans designs
    is_mixed: true,
    boxes_packed: totalBoxes,
    status: "closed",
    remarks: body.remarks || "Mixed pallet (combined leftovers)",
  });
  const batchId = batchRow.ROWID;
  const insertedLines = [];
  try {
    for (const l of lines) {
      const lr = await ds.table("PalletisedBatchLine").insertRow({
        batch: batchId, order_item: l.order_item, boxes: l.boxes, batch_number: l.batch_number,
      });
      insertedLines.push(lr.ROWID);
    }
    for (const [oiId, reqBoxes] of reqByOi) {
      await ds.table("OrderItemEvent").insertRow({
        order_item: oiId,
        event_type: "packed",
        qty_delta: reqBoxes,
        performed_by: String(body.performed_by || ""),
        note: `Mixed pallet #${batchId}`,
      });
    }
  } catch (e) {
    for (const id of insertedLines) {
      try { await ds.table("PalletisedBatchLine").deleteRow(id); } catch (_) {}
    }
    try { await ds.table("PalletisedBatch").deleteRow(batchId); } catch (_) {}
    throw e;
  }
  await recountOrderItems(catalyst, ds, [...reqByOi.keys()]);
  return { rowid: batchId, data: { ROWID: batchId, boxes_packed: totalBoxes, lines: lines.length } };
}

/* ================================================================
   Palletization Plan (vehicle load) — a first-class, human-numbered
   record that groups order items from MULTIPLE Sales Orders onto a
   vehicle and runs a 4-stage lifecycle. Header + line tables mirror
   SalesOrder + OrderItem; the status machine mirrors /quote-status;
   the number mint mirrors nextOrderNumber. Lines key on OrderItem
   (planned before packing, when PalletisedBatches don't exist yet).
   ================================================================ */

/* Server-assigned PAL number: max numeric suffix for this fiscal year + 1.
   ponytail: MAX-scan over PalletizationPlan, not TransactionSeries — same
   rationale as nextOrderNumber; assertUnique is the race backstop. */
async function nextPalNumber(catalyst) {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Indian FY (Apr–Mar)
  const prefix = `PAL/${y}-${String((y + 1) % 100).padStart(2, "0")}/`;
  const rows = rowList(await catalyst.zcql().executeZCQLQuery("SELECT pal_number FROM PalletizationPlan"));
  let max = 0;
  for (const r of rows) {
    const n = String(r.pal_number || "");
    if (n.startsWith(prefix)) max = Math.max(max, parseInt(n.slice(prefix.length), 10) || 0);
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/* Batch-series settings (AppSetting; Settings → Series). Missing rows fall
   back to the defaults. Values are cleaned for ZCQL (quotes stripped, capped)
   because the minted prefix goes into a LIKE. */
async function batchSeriesSettings(catalyst) {
  const rows = rowList(
    await catalyst.zcql().executeZCQLQuery(
      "SELECT setting_key, setting_value FROM AppSetting WHERE setting_key IN ('batch_series_prefix','batch_series_separator','batch_series_start') AND deleted_at is null",
    ),
  );
  const get = (k) => String((rows.find((r) => String(r.setting_key) === k) || {}).setting_value || "");
  const clean = (s) => s.replace(/['%_*]/g, "").slice(0, 10);
  return {
    prefix: clean(get("batch_series_prefix")) || "B",
    sep: clean(get("batch_series_separator")) || "/",
    start: Math.max(1, parseInt(get("batch_series_start"), 10) || 1),
  };
}

/* Server-assigned production batch number: <prefix><sep>YYYY-MM<sep>NNN
   (defaults B/YYYY-MM/001), series per ITEM per calendar month (each item
   restarts every month at the configured start). Prefix/separator/start are
   admin-set in Settings → Series. Minted only when the client didn't supply
   one (operators may type an existing batch to append output to it).
   assertBatchesAllowed is the backstop for typed batches.
   ponytail: the design+month WHERE keeps the scan well under ZCQL's 300-row
   cap (the old unscoped scan silently truncated past 300 rows). Changing the
   prefix/separator starts a fresh series — old-format batches simply no
   longer match the LIKE. */
async function nextBatchNumber(catalyst, designId) {
  if (!designId) throw badRequest("Batch numbering needs the item");
  const { prefix: p, sep, start } = await batchSeriesSettings(catalyst);
  const now = new Date();
  const prefix = `${p}${sep}${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}${sep}`;
  // ROWIDs (~7e16) exceed Number.MAX_SAFE_INTEGER — Number() rounded the id, the
  // scan matched nothing and every mint came out …/001. Keep it a digit string.
  const id = String(designId);
  if (!/^\d+$/.test(id)) throw badRequest("Batch numbering needs a valid item");
  const rows = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT batch_number FROM ProductionLog WHERE design = ${id} AND batch_number LIKE '${prefix}*' AND deleted_at is null`,
    ),
  );
  let max = 0;
  for (const r of rows) {
    const n = String(r.batch_number || "");
    if (n.startsWith(prefix)) max = Math.max(max, parseInt(n.slice(prefix.length), 10) || 0);
  }
  return `${prefix}${String(Math.max(max + 1, start)).padStart(3, "0")}`;
}

/* Duplicate-batch guard. Two tiers:
   1. Same design + same batch number: never allowed (unconditional).
   2. Same batch on a DIFFERENT design: allowed unless AppSetting
      allow_duplicate_batches = "false" (missing row = allow).
   Blank entries (auto-minted) are exempt. */
async function assertBatchesAllowed(catalyst, batchNumbers, designId) {
  const supplied = (batchNumbers || []).map((b) => String(b || "").trim()).filter(Boolean);
  if (!supplied.length) return;
  if (new Set(supplied).size < supplied.length)
    throw badRequest("Duplicate batch numbers within one submission", 409);
  const s = rowList(
    await catalyst.zcql().executeZCQLQuery(
      "SELECT setting_value FROM AppSetting WHERE setting_key = 'allow_duplicate_batches' AND deleted_at is null",
    ),
  )[0];
  const allowCrossItem = String((s && s.setting_value) || "") !== "false";
  for (const b of supplied) {
    const safe = b.replace(/'/g, "''");
    if (designId) {
      const mine = rowList(
        await catalyst.zcql().executeZCQLQuery(
          `SELECT ROWID FROM ProductionLog WHERE batch_number = '${safe}' AND design = ${designId} AND deleted_at is null AND (entry_type = 'record' OR entry_type = 'opening') LIMIT 1`,
        ),
      );
      if (mine.length) throw badRequest(`Batch "${b}" is already used for this item`, 409);
    }
    if (allowCrossItem) continue;
    const hit = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT ROWID FROM ProductionLog WHERE batch_number = '${safe}' AND deleted_at is null AND (entry_type = 'record' OR entry_type = 'opening') LIMIT 1`,
      ),
    );
    if (hit.length)
      throw badRequest(`Batch "${b}" already exists — enable "Allow duplicate batch numbers" in Settings to reuse it`, 409);
  }
}

/** Validate + normalize the plan lines (shared by create + update). */
function normalizePlanLines(body) {
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) throw badRequest("At least one plan line is required");
  return rawLines.map((l, i) => {
    if (!l.order_item) throw badRequest(`Line ${i + 1}: order_item is required`);
    // Pallet is mandatory at palletisation (both UIs already enforce this;
    // reject crafted API calls too so no line is ever born pallet-less).
    if (!l.pallet) throw badRequest(`Line ${i + 1}: pallet is required`);
    const boxes = nonNeg(l.boxes, `Line ${i + 1} boxes`);
    if (boxes <= 0) throw badRequest(`Line ${i + 1}: boxes must be > 0`);
    return {
      sales_order: l.sales_order ? String(l.sales_order) : null,
      order_item: String(l.order_item),
      design: l.design ? String(l.design) : null,
      pallet: String(l.pallet),
      boxes,
      position: Number(l.position) || i,
      status: "Planning", // every line born Ready for Palletization; advances via /pal-line-status
      // Carried opaquely: /update-pal-plan replaces the Planning lines from
      // client input, so dropping this here would wipe batches on a plan edit.
      batch_number: l.batch_number ? String(l.batch_number) : "",
      // CR-340: carried when sent; /update-pal-plan also re-attaches them from the replaced lines.
      ...(l.box_brand && /^\d+$/.test(String(l.box_brand)) ? { box_brand: String(l.box_brand) } : {}),
      ...(l.pallet_group ? { pallet_group: String(l.pallet_group) } : {}),
      // User-authored line (create/edit form) — autoEnqueuePalletization never
      // tops up an item whose plan the user has pinned (CR 2026-09-10).
      manual_edit: "true",
    };
  });
}

/* CR 2026-09-10: the one hard cap on planning — total boxes across ALL plan
   lines for an order item (any status, dispatched included) must not exceed
   the SO's ordered qty. Splitting across lines/plans is free below that.
   `excludePlanId`: that plan's Planning lines are about to be replaced by
   `lines`, so they don't count as existing. */
async function assertPlanWithinOrdered(catalyst, lines, excludePlanId, movedByItem) {
  const byItem = new Map();
  for (const l of lines) {
    const oi = String(l.order_item || "");
    if (!/^\d+$/.test(oi)) continue;
    byItem.set(oi, (byItem.get(oi) || 0) + (Number(l.boxes) || 0));
  }
  const ids = [...byItem.keys()];
  if (!ids.length) return;
  const zcql = catalyst.zcql();
  const orderedOf = new Map(
    rowList(
      await zcql.executeZCQLQuery(`SELECT ROWID, ordered_qty_boxes FROM OrderItem WHERE ROWID IN (${ids.join(",")})`),
    ).map((r) => [String(r.ROWID), Number(r.ordered_qty_boxes) || 0]),
  );
  const existing = rowList(
    await zcql.executeZCQLQuery(
      `SELECT plan, order_item, boxes, status FROM PalletizationPlanLine WHERE order_item IN (${ids.join(",")}) AND deleted_at is null`,
    ),
  );
  const excl = String(excludePlanId || "");
  for (const [oi, qty] of byItem) {
    const others = existing
      .filter((l) => String(l.order_item) === oi && !(excl && String(l.plan) === excl && String(l.status) === "Planning"))
      .reduce((s, l) => s + (Number(l.boxes) || 0), 0) - ((movedByItem && movedByItem.get(oi)) || 0); // CR-249: claimed queue boxes move, they are not added
    const ordered = orderedOf.get(oi) || 0;
    if (ordered && qty + others > ordered)
      throw badRequest(
        `Planned boxes exceed the ordered quantity for a line (${qty + others} planned of ${ordered} ordered)`,
        409,
      );
  }
}

/* CR-249: the item's boxes already WAITING in the queue — batched, un-boxed
   Planning lines (the auto-enqueue's), oldest first. A hand-made plan takes its
   boxes from these instead of minting a blank-batch, brand-less duplicate.
   Pure over `rows` (no writes): `left` tracks each donor across calls. */
function claimQueuedBatches(rows, orderItemId, want, left) {
  const out = [];
  const donors = rows
    .filter(
      (r) =>
        String(r.order_item) === String(orderItemId) && String(r.status) === "Planning" &&
        !String(r.load_box || "") && String(r.batch_number || ""),
    )
    .sort((x, y) => String(x.CREATEDTIME).localeCompare(String(y.CREATEDTIME)) || Number(BigInt(x.ROWID) - BigInt(y.ROWID)));
  for (const d of donors) {
    if (want <= 0) break;
    const id = String(d.ROWID);
    const have = left.has(id) ? left.get(id).left : Number(d.boxes) || 0;
    const take = Math.min(want, have);
    if (take <= 0) continue;
    left.set(id, { was: Number(d.boxes) || 0, left: have - take });
    out.push({ donorId: id, batch: String(d.batch_number), brand: String(d.box_brand || ""), take });
    want -= take;
  }
  return out;
}

/** Apply the claims: shrink each donor line, soft-deleting one that reaches 0.
    A failure puts every donor back as it was before rethrowing — the caller is
    about to delete the lines that claimed them, and queue boxes must not vanish. */
async function shrinkDonors(ds, donors) {
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  const t = ds.table("PalletizationPlanLine");
  try {
    for (const [id, d] of donors)
      await t.updateRow(d.left > 0 ? { ROWID: id, boxes: d.left } : { ROWID: id, deleted_at: stamp });
  } catch (e) {
    for (const [id, d] of donors) {
      try { await t.updateRow({ ROWID: id, boxes: d.was, deleted_at: null }); } catch (_) {}
    }
    throw e;
  }
}

const QUEUE_COLS = "ROWID, order_item, batch_number, boxes, status, load_box, box_brand, CREATEDTIME";

/* CR-223: a hand-made plan line arrives batch-less (the form plans per design).
   Split it FIFO over the item's produced/allocated batches not yet on any plan
   line — the same `unqueuedBatches` the auto-enqueue uses — then (CR-249) over
   the boxes already waiting in the queue, which MOVE here (`donors` = what to
   shrink once the new lines are in). Boxes beyond what is produced stay one
   blank-batch line (planning ahead is allowed). Lines that name a batch pass through. */
async function attributeBatches(catalyst, lines) {
  const donors = new Map(); // donor line id → { was, left } boxes
  const moved = new Map(); // order item → boxes claimed from the queue
  const ids = [...new Set(lines.filter((l) => !l.batch_number && /^\d+$/.test(l.order_item)).map((l) => l.order_item))];
  if (!ids.length) return { lines, donors, moved };
  const live = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ${QUEUE_COLS} FROM PalletizationPlanLine WHERE order_item IN (${ids.join(",")}) AND deleted_at is null`,
    ),
  );
  const out = [];
  for (const l of lines) {
    if (l.batch_number || !ids.includes(l.order_item)) { out.push(l); continue; }
    let left = l.boxes;
    // `out` rides along so two blank lines for one item never claim the same boxes.
    for (const b of await unqueuedBatches(catalyst, l.order_item, [...live, ...out])) {
      if (left <= 0) break;
      const take = Math.min(left, b.available);
      out.push({ ...l, boxes: take, batch_number: b.batch, ...(b.brand ? { box_brand: b.brand } : {}) });
      left -= take;
    }
    for (const c of claimQueuedBatches(live, l.order_item, left, donors)) {
      out.push({ ...l, boxes: c.take, batch_number: c.batch, ...(c.brand ? { box_brand: c.brand } : {}) });
      moved.set(l.order_item, (moved.get(l.order_item) || 0) + c.take);
      left -= c.take;
    }
    if (left > 0) out.push({ ...l, boxes: left });
  }
  return { lines: out.map((l, i) => ({ ...l, position: i })), donors, moved };
}

/** Insert a PalletizationPlan header + its lines. Compensates on mid-write failure. */
async function createPalPlan(catalyst, ds, body, sMap) {
  // Blank pal_number → server assigns the next number (clients never mint it).
  const palNumber = String(body.pal_number || "").trim() || (await nextPalNumber(catalyst));
  await assertUnique(catalyst, "PalletizationPlan", "pal_number", palNumber);
  const { lines, donors, moved } = await attributeBatches(catalyst, normalizePlanLines(body));
  await assertPlanWithinOrdered(catalyst, lines, undefined, moved);
  const salesPerson = resolveOptional(sMap, body.salesperson, "Sales person");

  const planRow = await ds.table("PalletizationPlan").insertRow({
    pal_number: palNumber,
    // Every plan is born Planning — status only advances via /pal-status,
    // so a crafted create can't skip the lifecycle.
    status: "Planning",
    vehicle_number: body.vehicle_number || "",
    vehicle: body.vehicle ? String(body.vehicle) : undefined, // optional at planning; also assignable via /pal-vehicle
    planned_date: body.planned_date || undefined, // date col rejects "" → omit
    sales_person: salesPerson || undefined,
    remarks: body.remarks || "",
  });
  const planId = planRow.ROWID;
  const insertedLines = [];
  try {
    for (const l of lines) {
      const lr = await ds.table("PalletizationPlanLine").insertRow({ plan: planId, ...l });
      insertedLines.push(lr.ROWID);
    }
    // New lines are in — now take the claimed boxes off the queue (CR-249).
    await shrinkDonors(ds, donors);
  } catch (e) {
    for (const id of insertedLines) {
      try { await ds.table("PalletizationPlanLine").deleteRow(id); } catch (_) {}
    }
    try { await ds.table("PalletizationPlan").deleteRow(planId); } catch (_) {}
    throw e;
  }
  await recountOrderItems(catalyst, ds, lines.map((l) => l.order_item));
  return { rowid: planId, data: { ROWID: planId, pal_number: palNumber } };
}

app.post("/pal-plan", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const sMap = await salesPersonMap(catalyst);
    const result = await withOpLog(
      catalyst,
      { table_name: "PalletizationPlan", operation: "insert", payload: body },
      async () => createPalPlan(catalyst, ds, body, sMap),
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Auto-enqueue production output into palletization. Called after every
   OrderItem.produced_qty_boxes bump: tops the item's queued Planning boxes
   up to produced − palletized on ONE reused open plan per SO (created on
   first need). Idempotent from ground truth — never "add the delta blindly" —
   so re-records and complete-after-record converge. EXCEPTION (CR
   2026-09-10): an item with a user-authored Planning line (manual_edit) is
   pinned — no top-up; the remainder waits in the work list.
   Lines are always born "Planning" = the board's "Ready for
   Palletization" column. `palletOverride` is the pallet picked on the Record
   Output form — it wins over the SO line's own spec for the boxes this record
   queues (and corrects the card it merges into). Callers wrap in try/catch: a
   queue failure must never fail an already-committed production record. */
/* FIFO batch allocation for one order item: the boxes of each production batch
   that are NOT yet sitting on a live plan line. Returns [{ batch, available }],
   oldest batch first. Ground truth both sides — produced per batch (record
   children) minus already-enqueued per batch (ANY status, so boxes already
   palletized/dispatched for a batch never re-enqueue).
   Shared by autoEnqueuePalletization and /send-to-loading so both keep the batch
   trail; boxes with no batch attribution (legacy qty_boxes, /production-complete)
   are simply absent, and callers put the residue on a "" line. */
async function unqueuedBatches(catalyst, orderItemId, liveLines) {
  const oiId = String(orderItemId);
  // Records AND stock allocations (CR-199) are the item's boxes per batch.
  // box_brand rides along (CR-197); older Data Stores lack the column.
  const where = `FROM ProductionLog WHERE order_item = ${oiId} AND (entry_type = 'record' OR entry_type = 'alloc') AND deleted_at is null`;
  let recs;
  try {
    recs = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT batch_number, qty_boxes, box_brand, CREATEDTIME ${where}`));
  } catch (_) {
    recs = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT batch_number, qty_boxes, CREATEDTIME ${where}`));
  }
  const producedByBatch = new Map(); // batch → { qty, first, brand }
  for (const r of recs) {
    const b = String(r.batch_number || "");
    const cur = producedByBatch.get(b) || { qty: 0, first: String(r.CREATEDTIME || ""), brand: "" };
    cur.qty += Number(r.qty_boxes) || 0;
    if (!cur.brand && r.box_brand) cur.brand = String(r.box_brand);
    if (String(r.CREATEDTIME || "") < cur.first) cur.first = String(r.CREATEDTIME || "");
    producedByBatch.set(b, cur);
  }
  const enqueuedByBatch = new Map();
  for (const l of liveLines || []) {
    if (String(l.order_item) !== oiId) continue;
    const b = String(l.batch_number || "");
    enqueuedByBatch.set(b, (enqueuedByBatch.get(b) || 0) + (Number(l.boxes) || 0));
  }
  return [...producedByBatch.entries()]
    .filter(([b]) => b !== "")
    .sort((a, c) => (a[1].first < c[1].first ? -1 : 1)) // FIFO by first record
    .map(([batch, p]) => ({ batch, brand: p.brand, available: Math.max(0, p.qty - (enqueuedByBatch.get(batch) || 0)) }))
    .filter((x) => x.available > 0);
}

/* Default pallet for a design when the SO line never picked one: the Pallet
   whose size matches the design's size (lowest ROWID = deterministic).
   ponytail: exact-size match only; container-plan-aware resolution if a size
   ever grows competing pallet specs. */
async function defaultPalletForDesign(catalyst, designId) {
  const did = String(designId || "").replace(/[^0-9]/g, "");
  if (!did) return null;
  const d = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT size FROM Design WHERE ROWID = ${did}`),
  )[0];
  const sizeId = d && d.size ? String(d.size).replace(/[^0-9]/g, "") : "";
  if (!sizeId) return null;
  const p = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID FROM Pallet WHERE size = ${sizeId} AND deleted_at is null`,
    ),
  ).sort((a, b) => (BigInt(a.ROWID) < BigInt(b.ROWID) ? -1 : 1))[0];
  return p ? String(p.ROWID) : null;
}

async function autoEnqueuePalletization(catalyst, ds, orderItemId, palletOverride) {
  const oiId = String(orderItemId || "");
  if (!/^\d+$/.test(oiId)) return;
  const zcql = catalyst.zcql();
  const oi = rowList(
    await zcql.executeZCQLQuery(
      `SELECT ROWID, sales_order, design, pallet, ordered_qty_boxes, produced_qty_boxes, palletized_qty_boxes FROM OrderItem WHERE ROWID = ${oiId}`,
    ),
  )[0];
  const soId = oi ? String(oi.sales_order || "") : "";
  if (!soId) return;
  const pickedPallet = String(palletOverride || "").replace(/[^0-9]/g, "");
  const palletId =
    pickedPallet || (oi.pallet ? String(oi.pallet) : null) || (await defaultPalletForDesign(catalyst, oi.design));
  // Production may now exceed the order (CR) — the queue never should: cap
  // produced at ordered so total planned stays within the SO qty.
  const ordered = Number(oi.ordered_qty_boxes) || 0;
  const produced = Number(oi.produced_qty_boxes) || 0;
  const available = (ordered ? Math.min(produced, ordered) : produced) - (Number(oi.palletized_qty_boxes) || 0);
  if (available <= 0) return;

  // All live lines of the SO, restricted to live plans (soft-deleted plans
  // drop out — mirror of recountOrderItems).
  const soLines = rowList(
    await zcql.executeZCQLQuery(
      `SELECT ROWID, plan, order_item, boxes, status, batch_number, manual_edit FROM PalletizationPlanLine WHERE sales_order = ${soId} AND deleted_at is null`,
    ),
  );
  const planIds = [...new Set(soLines.map((l) => String(l.plan)))].filter(Boolean);
  const planStatus = new Map();
  if (planIds.length) {
    rowList(
      await zcql.executeZCQLQuery(
        `SELECT ROWID, status FROM PalletizationPlan WHERE ROWID IN (${planIds.join(",")}) AND deleted_at is null`,
      ),
    ).forEach((p) => planStatus.set(String(p.ROWID), String(p.status || "")));
  }
  const liveLines = soLines.filter((l) => planStatus.has(String(l.plan)));

  // Queued = the item's boxes still waiting in any pre-loading line (manual or
  // auto). Palletizing MUST count: recountOrderItems only counts palletized at
  // ReadyToLoad/in-box, so dropping Palletizing here would re-enqueue (duplicate)
  // boxes for lines dragged into the Palletization column.
  const queued = liveLines
    .filter((l) => String(l.order_item) === oiId && ["Planning", "Palletizing"].includes(String(l.status)))
    .reduce((s, l) => s + (Number(l.boxes) || 0), 0);
  const topUp = available - queued;
  if (topUp <= 0) return;

  // CR 2026-09-10: a user-authored/edited Planning line PINS the item's queue —
  // never top it back up (a manual reduction is a decision, not drift). The
  // un-queued remainder stays visible in the Ready-for-Palletization work list
  // for the user to queue as a separate line when they choose.
  const pinned = liveLines.some(
    (l) => String(l.order_item) === oiId && String(l.status) === "Planning" && String(l.manual_edit || "") === "true",
  );
  if (pinned) return;

  // Reuse the SO's open plan; mint one when the SO has none in Planning.
  let planId = planIds.find((id) => planStatus.get(id) === "Planning") || "";
  if (!planId) {
    const planRow = await ds.table("PalletizationPlan").insertRow({
      pal_number: await nextPalNumber(catalyst),
      status: "Planning",
      vehicle_number: "",
      remarks: "Auto — production",
    });
    planId = String(planRow.ROWID);
    await logTransition(catalyst, {
      entity_type: "PalletizationPlan", entity_rowid: planId, from_status: "", to_status: "Planning",
      note: "auto-created from production",
    });
  }

  // Distribute the top-up per batch so each queue card is ONE batch of the
  // item (uniform tile texture per customer). Residue with no batch attribution
  // lands on the "" line — exactly the old aggregate behavior.
  const batches = await unqueuedBatches(catalyst, oiId, liveLines);

  // Every new card is born "Planning" — the Ready for Palletization column.
  const upsert = async (batch, alloc, brand) => {
    const mine = liveLines.find(
      (l) =>
        String(l.plan) === planId &&
        String(l.order_item) === oiId &&
        String(l.status) === "Planning" &&
        String(l.batch_number || "") === batch,
    );
    if (mine) {
      // An explicit pick also re-pallets the card it merges into; without one
      // the existing pallet stands.
      await ds.table("PalletizationPlanLine").updateRow({
        ROWID: mine.ROWID,
        boxes: (Number(mine.boxes) || 0) + alloc,
        ...(pickedPallet ? { pallet: pickedPallet } : {}),
      });
      mine.boxes = (Number(mine.boxes) || 0) + alloc;
    } else {
      const lr = await ds.table("PalletizationPlanLine").insertRow({
        plan: planId,
        sales_order: soId,
        order_item: oiId,
        design: oi.design ? String(oi.design) : null,
        pallet: palletId,
        boxes: alloc,
        position: liveLines.filter((l) => String(l.plan) === planId).length,
        status: "Planning",
        batch_number: batch,
        // The carton the batch was produced in wins the line → SO → customer chain.
        ...(brand ? { box_brand: brand } : {}),
      });
      liveLines.push({ ROWID: lr.ROWID, plan: planId, order_item: oiId, boxes: alloc, status: "Planning", batch_number: batch });
    }
  };

  let remaining = topUp;
  for (const { batch, available, brand } of batches) {
    if (remaining <= 0) break;
    const alloc = Math.min(available, remaining);
    if (alloc <= 0) continue;
    await upsert(batch, alloc, brand);
    remaining -= alloc;
  }
  if (remaining > 0) await upsert("", remaining);
  await recountOrderItems(catalyst, ds, [oiId]);
}

/* Update a plan header + REPLACE its lines (mirror of /update-so-with-items).
   pal_number and status are never editable here (status → /pal-status). */
app.post("/update-pal-plan/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const planId = req.params.rowid;
    const sMap = await salesPersonMap(catalyst);
    const result = await withOpLog(
      catalyst,
      { table_name: "PalletizationPlan", operation: "update", payload: { ROWID: planId, ...body } },
      async () => {
        const cur = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, pal_number, status FROM PalletizationPlan WHERE ROWID = ${planId} AND deleted_at is null`,
          ),
        )[0];
        if (!cur) throw badRequest(`Palletization plan not found: ${planId}`, 404);
        // CR-340: the form refuses this too; a crafted call must not rewrite a dispatched plan.
        if (String(cur.status) === "Completed") throw badRequest("Completed plans can't be edited", 409);
        // Empty lines is legal here when advanced (non-Planning) lines remain —
        // the edit then only rewrites the header / clears the Planning queue.
        const sent = Array.isArray(body.lines) && body.lines.length ? normalizePlanLines(body) : [];
        const salesPerson = resolveOptional(sMap, body.salesperson, "Sales person");

        // Header (pal_number + status untouched).
        await ds.table("PalletizationPlan").updateRow({
          ROWID: planId,
          vehicle_number: body.vehicle_number || "",
          vehicle: body.vehicle ? String(body.vehicle) : null,
          planned_date: body.planned_date || undefined,
          sales_person: salesPerson || null,
          remarks: body.remarks || "",
        });
        // Replace ONLY the Planning-stage lines (the form edits those alone).
        // Lines already advanced (Palletizing / ReadyToLoad / in a load box)
        // survive untouched — an edit used to reset their status and strip
        // load_box/pallet_group (CR 2026-09-10).
        const old = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, order_item, status, batch_number, box_brand, pallet_group FROM PalletizationPlanLine WHERE plan = ${planId} AND deleted_at is null`,
          ),
        );
        const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
        const oldPlanning = old.filter((r) => String(r.status || "Planning") === "Planning");
        if (!sent.length && oldPlanning.length === old.length)
          throw badRequest("At least one plan line is required");
        // CR-340: the form knows nothing of box_brand / pallet_group — a replaced Planning line's values
        // follow the re-sent line of the same item (and batch, when the input names one). Was: every
        // edit minted brand-less lines (CR-249 "known open").
        const carried = sent.map((l) => {
          const hit = oldPlanning.find(
            (r) => String(r.order_item) === l.order_item && (!l.batch_number || String(r.batch_number || "") === l.batch_number),
          );
          if (!hit) return l;
          return {
            ...l,
            ...(!l.batch_number && hit.batch_number ? { batch_number: String(hit.batch_number) } : {}),
            ...(!l.box_brand && hit.box_brand ? { box_brand: String(hit.box_brand) } : {}),
            ...(!l.pallet_group && hit.pallet_group ? { pallet_group: String(hit.pallet_group) } : {}),
          };
        });
        // Old Planning lines go first so the queue they held is free again, then batch-less lines are
        // attributed exactly like create (CR-223/249): produced batches, then the waiting queue.
        const tbl = ds.table("PalletizationPlanLine");
        for (const r of oldPlanning) await tbl.updateRow({ ROWID: r.ROWID, deleted_at: stamp });
        const inserted = [];
        let donors = new Map();
        try {
          const attributed = await attributeBatches(catalyst, carried);
          donors = attributed.donors;
          await assertPlanWithinOrdered(catalyst, attributed.lines, planId, attributed.moved);
          for (const l of attributed.lines) inserted.push((await tbl.insertRow({ plan: planId, ...l })).ROWID);
          await shrinkDonors(ds, donors);
          await recountOrderItems(catalyst, ds, [...oldPlanning.map((r) => r.order_item), ...attributed.lines.map((l) => l.order_item)]);
        } catch (e) {
          for (const id of inserted) { try { await tbl.deleteRow(id); } catch (_) {} }
          for (const r of oldPlanning) { try { await tbl.updateRow({ ROWID: r.ROWID, deleted_at: null }); } catch (_) {} }
          throw e;
        }
        return { rowid: planId, data: { ROWID: planId, pal_number: cur.pal_number } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Palletization plan status machine — mirror of /quote-status. All status
   changes route here (generic PATCH rejects PalletizationPlan.status). */
// Two-level lifecycle. Palletising is PER LINE (PalletizationPlanLine.status:
// Planning=Ready for Palletization → ReadyToLoad=Ready for Loading). Loading/dispatch is
// PER VEHICLE (PalletizationPlan.status): Planning → Loading (In Loading) →
// Completed (Dispatched). The retired "Palletized"/plan-level "ReadyToLoad" states
// are folded into Planning by the one-off migration.
const PAL_TRANSITIONS = {
  Planning: ["Loading"], // → Loading captures the vehicle (via /pal-vehicle)
  Loading: ["Completed", "Planning"], // Completed = dispatched; back = unload
  Completed: [], // terminal (dispatched)
};
// Per-line palletising stage — full mesh over the pre-loading statuses.
const PAL_LINE_TRANSITIONS = {
  Planning: ["Palletizing", "ReadyToLoad"],
  Palletizing: ["ReadyToLoad", "Planning"],
  ReadyToLoad: ["Planning", "Palletizing"],
};

app.post("/pal-status/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const planId = req.params.rowid;
    const to = String((req.body || {}).status || "");

    const result = await withOpLog(
      catalyst,
      { table_name: "PalletizationPlan", operation: "status", payload: { ROWID: planId, status: to } },
      async () => {
        const rows = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, pal_number, status, vehicle FROM PalletizationPlan WHERE ROWID = ${planId}`,
          ),
        );
        if (!rows.length) throw badRequest(`Palletization plan not found: ${planId}`, 404);
        const from = String(rows[0].status || "Planning");
        if (!(PAL_TRANSITIONS[from] || []).includes(to))
          throw badRequest(`Cannot move palletization plan from ${from} to ${to}`, 409);

        const patch = { ROWID: planId, status: to };
        // Entering "In Loading" no longer gates on a vehicle — the vehicle is
        // assigned at that step via /pal-vehicle. Dispatch requires it, though:
        // Completed = dispatched → a vehicle must already be assigned, then stamp
        // the dispatch date (IST).
        if (to === "Completed") {
          if (!String(rows[0].vehicle || "")) throw badRequest("Assign a vehicle before dispatch", 400);
          patch.dispatch_date = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
        }
        await ds.table("PalletizationPlan").updateRow(patch);
        await logTransition(catalyst, {
          entity_type: "PalletizationPlan", entity_rowid: planId, from_status: from, to_status: to,
        });
        return { rowid: planId, data: { ROWID: planId, status: to } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Per-line palletising toggle (Ready for Palletization ↔ Ready for Loading). This is the
   item-wise move on the kanban — advancing one line never touches its plan or siblings.
   Optional body.boxes < line.boxes = PARTIAL move (CR): only that many boxes
   transition (split off as a new line); the remainder keeps the old status, so a
   partial palletise never flips the whole line to Ready for Loading. One
   exception (CR-281): a partial COMPLETE (Palletizing → ReadyToLoad) sends the
   remainder back to Planning — those boxes are not on a pallet, so they re-queue
   under Ready for Palletization where Start applies to them again. */
app.post("/pal-line-status/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const lineId = req.params.rowid;
    const to = String((req.body || {}).status || "");
    const pallet = String((req.body || {}).pallet || "");
    const reqBoxes = Number((req.body || {}).boxes);
    // CR-412: where the pallet stands (a Warehouse node id) — stamped on the moved line / slice.
    const warehouse = String((req.body || {}).warehouse || "").replace(/[^0-9]/g, "");

    const result = await withOpLog(
      catalyst,
      { table_name: "PalletizationPlanLine", operation: "status", payload: { ROWID: lineId, status: to, ...(pallet ? { pallet } : {}), ...(reqBoxes ? { boxes: reqBoxes } : {}), ...(warehouse ? { warehouse } : {}) } },
      async () => {
        const rows = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, status, order_item, plan, sales_order, design, pallet, boxes, position, batch_number, pallet_group, manual_edit, box_brand, warehouse FROM PalletizationPlanLine WHERE ROWID = ${lineId} AND deleted_at is null`,
          ),
        );
        if (!rows.length) throw badRequest(`Palletization line not found: ${lineId}`, 404);
        const line = rows[0];
        const from = String(line.status || "Planning");
        // Same-status call = pallet (re)assignment only — e.g. a 2nd-stage line
        // that landed in Palletizing without one; logTransition no-ops on it.
        if (from !== to && !(PAL_LINE_TRANSITIONS[from] || []).includes(to))
          throw badRequest(`Cannot move palletization line from ${from} to ${to}`, 409);

        const lineBoxes = Number(line.boxes) || 0;
        const partial = Number.isInteger(reqBoxes) && reqBoxes > 0 && reqBoxes < lineBoxes && from !== to;
        if (partial) {
          // Split: insert the moved slice first, then shrink the original — a
          // mid-write failure deletes the slice (same pattern as /pal-topup).
          const slice = await ds.table("PalletizationPlanLine").insertRow({
            plan: line.plan ? String(line.plan) : undefined,
            sales_order: line.sales_order ? String(line.sales_order) : undefined,
            order_item: line.order_item ? String(line.order_item) : undefined,
            design: line.design ? String(line.design) : undefined,
            pallet: /^\d+$/.test(pallet) ? pallet : line.pallet ? String(line.pallet) : undefined,
            boxes: reqBoxes,
            position: Number(line.position) || 0,
            status: to,
            batch_number: line.batch_number ? String(line.batch_number) : "",
            ...(line.box_brand ? { box_brand: String(line.box_brand) } : {}),
            ...(line.pallet_group ? { pallet_group: String(line.pallet_group) } : {}),
            ...(String(line.manual_edit || "") === "true" ? { manual_edit: "true" } : {}),
            // CR-412: the moving slice takes the new location, else keeps the line's.
            ...(warehouse ? { warehouse } : line.warehouse ? { warehouse: String(line.warehouse) } : {}),
          });
          // CR-281: the un-palletized remainder of a partial Complete re-queues.
          const remainderStatus = from === "Palletizing" && to === "ReadyToLoad" ? "Planning" : from;
          try {
            await ds.table("PalletizationPlanLine").updateRow({
              ROWID: lineId, boxes: lineBoxes - reqBoxes, ...(remainderStatus !== from ? { status: remainderStatus } : {}),
            });
          } catch (e) {
            try { await ds.table("PalletizationPlanLine").deleteRow(slice.ROWID); } catch (_) {}
            throw e;
          }
          await logTransition(catalyst, {
            entity_type: "PalletizationPlanLine", entity_rowid: String(slice.ROWID), from_status: from, to_status: to,
            note: `partial — ${reqBoxes} of ${lineBoxes} boxes`,
          });
          if (remainderStatus !== from) {
            await logTransition(catalyst, {
              entity_type: "PalletizationPlanLine", entity_rowid: lineId, from_status: from, to_status: remainderStatus,
              note: `remainder — ${lineBoxes - reqBoxes} boxes back to Ready for Palletization`,
            });
          }
          await recountOrderItems(catalyst, ds, [line.order_item]);
          return { rowid: String(slice.ROWID), data: { ROWID: String(slice.ROWID), status: to, boxes: reqBoxes } };
        }

        await ds.table("PalletizationPlanLine").updateRow({
          ROWID: lineId, status: to, ...(/^\d+$/.test(pallet) ? { pallet } : {}), ...(warehouse ? { warehouse } : {}),
        });
        await logTransition(catalyst, {
          entity_type: "PalletizationPlanLine", entity_rowid: lineId, from_status: from, to_status: to,
        });
        await recountOrderItems(catalyst, ds, [line.order_item]);
        return { rowid: lineId, data: { ROWID: lineId, status: to } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Panel Craft — showcase-panel orders + cut-piece stock (2026-08-26).
   CR-302: a PanelOrder is a HEADER (customer, PNL/FY/NNN number, status)
   with PanelOrderLine rows (panel × qty) — SO-style. Stock is an on-hand
   row per (design, cut_piece_size); the cutting-job lifecycle mutates it:
   Ready adds Σ over every line's PanelLine pieces × line qty, Dispatched
   deducts the same (including direct Received→Dispatched when stock
   already covers). Forward-only transitions — going back would double-add.
   ---------------------------------------------------------------- */
const PANEL_ORDER_TRANSITIONS = {
  NewRequest: ["Received"], // CR-286: a request raised from a Quote / SO, accepted by Panel Craft
  Received: ["InCutting"],
  InCutting: ["Ready"],
  Ready: [], // CR-347: Dispatched is DERIVED — the last load (/panel-load-save) flips it, never a button
  Dispatched: [],
};

/* Upsert the on-hand row for (design, cut size) by delta. Composite key —
   NATURAL_KEY can't cover it, so uniqueness lives here. Throws 409 when a
   deduction would go negative. */
async function adjustCutStock(catalyst, ds, designId, cutSizeId, delta, entry) {
  const d = rowidParam(designId);
  const c = rowidParam(cutSizeId);
  if (!d || !c) throw badRequest("design and cut_piece_size are required");
  const row = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, qty, weight_kg FROM CutPieceStock WHERE design = ${d} AND cut_piece_size = ${c} AND deleted_at is null`,
    ),
  )[0];
  const next = (row ? Number(row.qty) || 0 : 0) + delta;
  if (next < 0) throw badRequest("Insufficient cut-piece stock", 409);
  // CR-414: a receipt may carry the piece's weight — set on a fresh row, or back-filled on an unweighed one.
  const w = entry && entry.weight_kg != null ? Number(entry.weight_kg) : null;
  const weight = w != null && (!row || row.weight_kg == null) ? { weight_kg: w } : {};
  if (row) await ds.table("CutPieceStock").updateRow({ ROWID: row.ROWID, qty: next, ...weight });
  else await ds.table("CutPieceStock").insertRow({ design: d, cut_piece_size: c, qty: next, ...weight });
  // CR-307: every movement leaves a dated ledger row (receipt / adjustment / order_ready / order_dispatch / sample — CR-316).
  if (entry)
    await ds.table("CutStockEntry").insertRow({
      design: d, cut_piece_size: c, qty: delta,
      entry_date: entry.entry_date || new Date().toISOString().slice(0, 10),
      kind: String(entry.kind || ""), reason: String(entry.reason || ""), note: String(entry.note || ""),
      ref_table: String(entry.ref_table || ""), ...(entry.ref_rowid ? { ref_rowid: String(entry.ref_rowid) } : {}),
      performed_by: String(entry.performed_by || ""),
      ...whField(entry.warehouse), // CR-329: null = primary
      ...(entry.doc_number ? { doc_number: String(entry.doc_number) } : {}), // CR-330: TRF code
    });
  return next;
}

/* Live PanelOrderLine rows of one order. CR-346: a line is a PANEL (panel [+ mdf])
   or a loose CUT PIECE (design + cut_piece_size) — never both. */
async function panelOrderLines(catalyst, orderId) {
  return rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, panel, qty, mdf, design, cut_piece_size FROM PanelOrderLine WHERE panel_order = ${orderId} AND deleted_at is null`,
    ),
  );
}

/* CR-312: need per design|cutSize for one order — or for `lines` ({panel, qty})
   about to be saved, so /panel-order-save can clamp a booking before the rows
   exist. Lifted verbatim from /panel-order-status. */
async function panelOrderNeeds(catalyst, orderId, lines) {
  const needs = new Map();
  // CR-347: without explicit lines the need is what is still PENDING to load —
  // pieces already on a vehicle left stock with their load.
  const src = lines || (await panelPending(catalyst, orderId)).filter((r) => r.material === "Item").map((r) => ({ design: r.design, cut_piece_size: r.cut_piece_size, qty: r.pending }));
  const add = (design, cut, need) => {
    if (need <= 0) return;
    const key = `${design}|${cut}`;
    const cur = needs.get(key) || { design, cut_piece_size: cut, need: 0 };
    cur.need += need;
    needs.set(key, cur);
  };
  for (const ol of src) {
    const lineQty = Number(ol.qty) || 0;
    // CR-346: a loose cut-piece line needs its own pieces, one per unit; CR-405: so does a load pick /
    // load line that names ONE piece kind of a panel ({design, cut_piece_size, qty} — pieces, not panels).
    if (rowidParam(ol.design) && rowidParam(ol.cut_piece_size)) {
      add(rowidParam(ol.design), rowidParam(ol.cut_piece_size), lineQty);
      continue;
    }
    if (!rowidParam(ol.panel)) continue;
    const pieces = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT design, cut_piece_size, cut_piece_qty FROM PanelLine WHERE panel = ${rowidParam(ol.panel)} AND deleted_at is null`,
      ),
    );
    for (const p of pieces) add(p.design, p.cut_piece_size, (Number(p.cut_piece_qty) || 0) * lineQty);
  }
  return needs;
}

/* ----------------------------------------------------------------
   CR-347: LOADING ENTRIES — a panel / sample order ships in parts, on
   several vehicles: pieces first, the MDF board later, loose cut pieces
   and samples whenever. One PanelLoad row per order per trip (a multi-
   order trip shares one LD/FY/NNN) + PanelLoadLine rows {order_line,
   material Item|Mdf, design + cut_piece_size on an Item line (CR-405),
   qty, weight_kg stamped at load}.
   CR-405: a load row is ONE CUT PIECE KIND of a line — a panel line has
   one Item row per piece kind on the panel (pcs × qty) plus its Mdf row
   (CR-406: ALWAYS, thickness picked or not); a loose cut-piece line one
   Item row. Legacy rows with material "Panel" (whole panels) are READ as
   qty × pcs under every piece key of that panel; nothing new writes them.
   A load MOVES the stock it carries (Item pieces, booking-gated); MDF
   boards are not stock. "Dispatched" is DERIVED: the last load that
   leaves nothing pending flips the panel order; a sample load is the old
   /panel-load-save (supplied_qty per line, status derived).
   ---------------------------------------------------------------- */
const LOAD_MATERIALS = new Set(["Mdf", "Item"]); // CR-405: "Panel" is legacy, read-only
const PANEL_LOAD_COLS = "ROWID, order_number, order_type, panel_order, sample_order, load_date, vehicle_number, driver_name, driver_mobile, note, photos, performed_by"; // CR-351: driver on the load
async function panelLoadsOf(catalyst, col, orderId) {
  const loads = await zcqlAllRows(catalyst, `SELECT ${PANEL_LOAD_COLS} FROM PanelLoad WHERE ${col} = ${rowidParam(orderId)} AND deleted_at is null`);
  if (!loads.length) return { loads: [], lines: [] };
  const lines = await zcqlAllRows(
    catalyst,
    `SELECT ROWID, panel_load, order_line, material, qty, weight_kg, design, cut_piece_size FROM PanelLoadLine WHERE panel_load IN (${loads.map((l) => rowidParam(l.ROWID)).join(",")}) AND deleted_at is null`,
  );
  return { loads, lines };
}
/** The cut pieces on a panel (PanelLine rows), read once per panel per request. */
async function panelPiecesOf(catalyst, panelId, cache) {
  const key = rowidParam(panelId);
  if (!key) return [];
  if (cache.has(key)) return cache.get(key);
  const rows = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT design, cut_piece_size, cut_piece_qty FROM PanelLine WHERE panel = ${key} AND deleted_at is null`),
  );
  cache.set(key, rows);
  return rows;
}
/** CR-405: identity of a load row — line × material × piece kind (blank kind on a board). */
const loadRowKey = (lineId, material, design, cut) => `${rowidParam(lineId)}|${material}|${material === "Mdf" ? "" : rowidParam(design)}|${material === "Mdf" ? "" : rowidParam(cut)}`;
/** Σ loaded per load-row key. A legacy "Panel" line spreads qty × pcs over the panel's piece keys;
    a pre-CR-405 Item line (no design column) takes its loose order line's piece kind. */
async function loadedByLine(catalyst, loadLines, linesById, cache) {
  const m = new Map();
  const add = (k, q) => m.set(k, (m.get(k) || 0) + q);
  for (const l of loadLines) {
    const q = Number(l.qty) || 0;
    const line = linesById.get(String(l.order_line)) || {};
    const material = String(l.material);
    if (material === "Panel") {
      for (const p of await panelPiecesOf(catalyst, line.panel, cache)) add(loadRowKey(l.order_line, "Item", p.design, p.cut_piece_size), q * (Number(p.cut_piece_qty) || 0));
      continue;
    }
    const design = rowidParam(l.design) || rowidParam(line.design);
    const cut = rowidParam(l.cut_piece_size) || rowidParam(line.cut_piece_size);
    add(loadRowKey(l.order_line, material, design, cut), q);
  }
  return m;
}
/** CR-405: the load rows a PANEL-order line ships, nothing loaded yet — mirrors client lineLoadRows.
    Panel line → one Item row per piece kind on the panel (pcs × qty) + ONE Mdf row (CR-406, always);
    loose cut-piece line → one Item row. */
async function panelLineRows(catalyst, line, cache) {
  const qty = Number(line.qty) || 0;
  if (rowidParam(line.panel)) {
    const pieces = await panelPiecesOf(catalyst, line.panel, cache);
    return [
      ...pieces.map((p) => ({ line, material: "Item", design: rowidParam(p.design), cut_piece_size: rowidParam(p.cut_piece_size), ordered: (Number(p.cut_piece_qty) || 0) * qty })),
      { line, material: "Mdf", design: "", cut_piece_size: "", ordered: qty },
    ];
  }
  return [{ line, material: "Item", design: rowidParam(line.design), cut_piece_size: rowidParam(line.cut_piece_size), ordered: qty }];
}
/** Pending rows {line, material, design, cut_piece_size, ordered, loaded, pending} of one panel order. */
async function panelPending(catalyst, orderId) {
  const lines = await panelOrderLines(catalyst, orderId);
  const { lines: ll } = await panelLoadsOf(catalyst, "panel_order", orderId);
  const cache = new Map();
  const loaded = await loadedByLine(catalyst, ll, new Map(lines.map((l) => [String(l.ROWID), l])), cache);
  const rows = [];
  for (const line of lines)
    for (const r of await panelLineRows(catalyst, line, cache)) {
      const got = loaded.get(loadRowKey(line.ROWID, r.material, r.design, r.cut_piece_size)) || 0;
      rows.push({ ...r, loaded: got, pending: Math.max(0, r.ordered - got) });
    }
  return rows;
}
/** CR-349/405: kg of ONE unit of a load row — a piece of that kind, or the line's board; null = unweighed / no thickness picked. */
async function unitWeightOf(catalyst, row) {
  if (row.material === "Mdf") {
    if (!rowidParam(row.line.mdf)) return null;
    const m = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT weight_kg FROM Mdf WHERE ROWID = ${rowidParam(row.line.mdf)}`))[0];
    const v = m && m.weight_kg != null && m.weight_kg !== "" ? Number(m.weight_kg) : NaN;
    return isFinite(v) ? v : null;
  }
  if (!rowidParam(row.design) || !rowidParam(row.cut_piece_size)) return null;
  const r = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT weight_kg FROM CutPieceStock WHERE design = ${rowidParam(row.design)} AND cut_piece_size = ${rowidParam(row.cut_piece_size)} AND deleted_at is null`,
    ),
  )[0];
  const v = r && r.weight_kg != null && r.weight_kg !== "" ? Number(r.weight_kg) : NaN;
  return isFinite(v) ? v : null;
}

const parseJsonCol = (raw) => {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

/* CR-312: a booking (PanelOrder.allocation JSON) is a CLAIM on on-hand, never a
   movement. Open = Received | InCutting | Ready — Dispatched rows keep their
   JSON for audit but drop out of every sum. Σ bookings ≤ on-hand is the
   invariant: guarded at allocate, negative adjustment and save-clamp; Ready
   adds its output and books it, so it cannot break it. */
// CR-400: an order is workable from birth — marks, booking and loads need no Accept any more.
const PANEL_ORDER_OPEN = new Set(["NewRequest", "Received", "InCutting", "Ready"]);
// CR-487: a sample order books cut pieces too (SampleOrder.allocation, same JSON shape) while open.
const SAMPLE_ORDER_OPEN = new Set(["New", "PartiallySupplied"]);
async function otherAllocations(catalyst, excludeOrderId) {
  // Catalyst ROWIDs are unique project-wide, so one exclude id serves both tables.
  const rows = [
    ...(await zcqlAllRows(
      catalyst,
      `SELECT ROWID, allocation FROM PanelOrder WHERE (status = 'NewRequest' OR status = 'Received' OR status = 'InCutting' OR status = 'Ready') AND deleted_at is null`,
    )),
    ...(await zcqlAllRows(catalyst, `SELECT ROWID, allocation FROM SampleOrder WHERE (status = 'New' OR status = 'PartiallySupplied') AND deleted_at is null`)),
  ];
  const sum = new Map();
  for (const r of rows) {
    if (excludeOrderId && String(r.ROWID) === String(excludeOrderId)) continue;
    for (const [k, q] of Object.entries(parseJsonCol(r.allocation))) sum.set(k, (sum.get(k) || 0) + (Number(q) || 0));
  }
  return sum;
}
async function cutOnHand(catalyst, designId, cutSizeId) {
  const row = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT qty FROM CutPieceStock WHERE design = ${rowidParam(designId)} AND cut_piece_size = ${rowidParam(cutSizeId)} AND deleted_at is null`,
    ),
  )[0];
  return row ? Number(row.qty) || 0 : 0;
}
/** CR-381: "PANEL-004" for an error message (the id when the panel is gone). */
async function panelCodeOf(catalyst, panelId) {
  const p = rowidParam(panelId) && rowList(await catalyst.zcql().executeZCQLQuery(`SELECT panel_code FROM Panel WHERE ROWID = ${rowidParam(panelId)}`))[0];
  return (p && p.panel_code) || String(panelId || "Panel");
}
async function cutPieceLabel(catalyst, designId, cutSizeId) {
  const c = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT name FROM CutPieceSize WHERE ROWID = ${rowidParam(cutSizeId)}`))[0];
  return `${await designLabel(catalyst, designId)} · ${c && c.name ? String(c.name) : "cut piece"}`;
}

/* Panel-order stage flip. On Ready: + Σ panelLine.cut_piece_qty × line.qty
   over every line (the cutting job's output, aggregated per design × cut
   size). On Dispatched: − the same (409 if short — also guards direct
   Received→Dispatched against missing stock). */
app.post("/panel-order-status/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const orderId = rowidParam(req.params.rowid);
    const to = String((req.body || {}).status || "");
    const result = await withOpLog(
      catalyst,
      { table_name: "PanelOrder", operation: "status", payload: { ROWID: orderId, status: to } },
      async () => {
        const order = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, status, sales_order, quote, allocation FROM PanelOrder WHERE ROWID = ${orderId} AND deleted_at is null`,
          ),
        )[0];
        if (!order) throw badRequest(`Panel order not found: ${orderId}`, 404);
        const from = String(order.status || "Received");
        if (!(PANEL_ORDER_TRANSITIONS[from] || []).includes(to))
          throw badRequest(`Cannot move panel order from ${from} to ${to}`, 409);

        // CR-302: the need per (design, cut size) across all lines (CR-312: shared helper;
        // CR-347: PENDING pieces only — anything already loaded left stock with its load).
        // Dispatch is no longer a transition here: the last /panel-load-save flips it.
        const needs = to === "Ready" ? await panelOrderNeeds(catalyst, orderId) : new Map();
        if (to === "Ready") {
          const actor = await currentActor(catalyst);
          for (const n of needs.values()) {
            await adjustCutStock(catalyst, ds, n.design, n.cut_piece_size, n.need, {
              kind: "order_ready", ref_table: "PanelOrder", ref_rowid: orderId, performed_by: actor,
            });
          }
        }

        // CR-312: Ready books its own cutting output to this order (the pieces were cut FOR it),
        // so Received → In Cutting → Ready → Dispatch needs no separate Allocate click.
        const booking = to === "Ready" ? { allocation: JSON.stringify(Object.fromEntries([...needs].map(([k, n]) => [k, n.need]))) } : {};
        await ds.table("PanelOrder").updateRow({ ROWID: orderId, status: to, ...booking });
        await logTransition(catalyst, {
          entity_type: "PanelOrder", entity_rowid: orderId, from_status: from, to_status: to,
        });
        // CR-286: mirror the flip onto the source Quote / SO Activity tab (blank refs are skipped).
        await logRelated(
          catalyst,
          [{ table: "SalesOrder", rowid: order.sales_order }, { table: "Quote", rowid: order.quote }],
          "panel-order-status",
          { ROWID: orderId, status: to },
        );
        return { rowid: orderId, data: { ROWID: orderId, status: to } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-313: production checkpoints — MDF · Vinyl Printing · Cut Pieces: readiness
   marks per order that never gate the lifecycle. Any direction; each save stamps
   who / when. Overall progress is derived on the client, never stored.
   CR-381: the marks DO gate LOADING per line × material (/panel-load-save,
   `materialBlockers` — mirrors client materialReadiness). CR-403 (reverses the
   CR-380/383 pieces gate): ONLY the MDF board waits for Pasted Ready; a panel's
   pieces and loose cut pieces = the booking gate alone, so pieces, boards or
   both can go on any trip. The order-level `cut` mark is dormant (CR-400).
   CR-366: Vinyl Pasted on MDF can only be Ready once MDF and Vinyl Printing
   are (mirrored in client pastedAllowed). CR-431 dropped the CR-401 vinyl-after-MDF
   gate: MDF and Vinyl are marked independently.
   CR-376: mdf / vinyl / pasted are marked PER PANEL — `checkpoints.panels[panelId][key]`
   (a panel sits on one line per order, and the panel id survives a line rewrite);
   `cut` stays order-level. The old order-level mdf/vinyl/pasted marks are the
   fallback for a panel without its own (no migration). */
const CHECKPOINTS = {
  mdf: ["Pending", "Ordered", "Received", "Ready"],
  vinyl: ["Pending", "Printing", "Ready"],
  cut: ["Pending", "Ready"],
  pasted: ["Pending", "Ready"], // CR-323: printed vinyl pasted on the MDF
};
const lineCp = (cp, panelId, key) => (cp.panels && cp.panels[panelId] && cp.panels[panelId][key]) || cp[key] || null;
const pastedAllowed = (cp, panelId) => (lineCp(cp, panelId, "mdf") || {}).status === "Ready" && (lineCp(cp, panelId, "vinyl") || {}).status === "Ready";
/** CR-381/403: what still blocks loading one material of a panel line — same words as the client. */
const materialBlockers = (cp, panelId, material) => {
  if (material !== "Mdf") return [];
  return (lineCp(cp, panelId, "pasted") || {}).status === "Ready" ? [] : ["Not pasted on MDF"];
};
const openOrderOr409 = (order) => {
  const st = String(order.status);
  if (!PANEL_ORDER_OPEN.has(st)) throw badRequest(st === "Cancelled" ? "Order cancelled" : "Order already dispatched", 409);
};
app.post("/panel-order-checkpoint/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const orderId = rowidParam(req.params.rowid);
    const key = String((req.body || {}).key || "");
    const status = String((req.body || {}).status || "");
    const panel = rowidParam((req.body || {}).panel); // CR-376: required for mdf / vinyl / pasted
    const result = await withOpLog(
      catalyst,
      { table_name: "PanelOrder", operation: "checkpoint", payload: { ROWID: orderId, key, status, ...(panel ? { panel } : {}) } },
      async () => {
        if (!CHECKPOINTS[key]) throw badRequest("key must be mdf, vinyl, cut or pasted");
        if (!CHECKPOINTS[key].includes(status)) throw badRequest(`${key} status must be one of ${CHECKPOINTS[key].join(", ")}`);
        if (key !== "cut" && !panel) throw badRequest(`${key} is marked per panel — send the panel`);
        const order = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, status, sales_order, quote, checkpoints FROM PanelOrder WHERE ROWID = ${orderId} AND deleted_at is null`,
          ),
        )[0];
        if (!order) throw badRequest(`Panel order not found: ${orderId}`, 404);
        openOrderOr409(order);
        if (key !== "cut" && !(await panelOrderLines(catalyst, orderId)).some((l) => String(l.panel || "") === panel)) throw badRequest("That panel is not on this order");
        const next = parseJsonCol(order.checkpoints);
        if (key === "pasted" && status === "Ready" && !pastedAllowed(next, panel)) throw badRequest("Mark MDF and Vinyl Printing Ready first", 409); // CR-366
        const mark = { status, by: await currentActor(catalyst), at: stampNow() };
        if (key === "cut") next.cut = mark;
        else {
          next.panels = next.panels || {};
          next.panels[panel] = { ...(next.panels[panel] || {}), [key]: mark };
        }
        await ds.table("PanelOrder").updateRow({ ROWID: orderId, checkpoints: JSON.stringify(next) });
        await logRelated(
          catalyst,
          [{ table: "SalesOrder", rowid: order.sales_order }, { table: "Quote", rowid: order.quote }],
          "panel-order-checkpoint",
          { ROWID: orderId, key, status, ...(panel ? { panel } : {}) },
        );
        return { rowid: orderId, data: { ROWID: orderId, checkpoints: next } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-312: book cut pieces to an order — ABSOLUTE per design|cutSize figure
   (lower = release, 0 / missing = none; unknown keys ignored). Each figure
   must fit the need AND on-hand − what OTHER open orders have booked. Every
   key is verified before the single write. */
app.post("/panel-order-allocate/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const orderId = rowidParam(req.params.rowid);
    const wanted = (req.body || {}).allocation;
    const result = await withOpLog(
      catalyst,
      { table_name: "PanelOrder", operation: "allocate", payload: { ROWID: orderId, allocation: wanted } },
      async () => {
        if (!wanted || typeof wanted !== "object" || Array.isArray(wanted)) throw badRequest("allocation must be an object of design|cutSize → pcs");
        const order = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, status, sales_order, quote FROM PanelOrder WHERE ROWID = ${orderId} AND deleted_at is null`,
          ),
        )[0];
        if (!order) throw badRequest(`Panel order not found: ${orderId}`, 404);
        openOrderOr409(order);
        const needs = await panelOrderNeeds(catalyst, orderId);
        const others = await otherAllocations(catalyst, orderId);
        const next = {};
        for (const [k, n] of needs) {
          const q = Number(wanted[k] == null || wanted[k] === "" ? 0 : wanted[k]);
          if (!Number.isInteger(q) || q < 0) throw badRequest("Booked pcs must be a whole number ≥ 0");
          if (q === 0) continue;
          if (q > n.need) throw badRequest(`Only ${n.need} pcs of ${await cutPieceLabel(catalyst, n.design, n.cut_piece_size)} are needed`);
          const free = (await cutOnHand(catalyst, n.design, n.cut_piece_size)) - (others.get(k) || 0);
          if (q > free)
            throw badRequest(`Only ${Math.max(0, free)} pcs free of ${await cutPieceLabel(catalyst, n.design, n.cut_piece_size)} — the rest are booked by other orders`, 409);
          next[k] = q;
        }
        // ponytail: read-check-write, single-writer app — the /panel-order-status ceiling.
        await ds.table("PanelOrder").updateRow({ ROWID: orderId, allocation: JSON.stringify(next) });
        await logRelated(
          catalyst,
          [{ table: "SalesOrder", rowid: order.sales_order }, { table: "Quote", rowid: order.quote }],
          "panel-order-allocate",
          { ROWID: orderId, allocation: next },
        );
        return { rowid: orderId, data: { ROWID: orderId, allocation: next } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-302: create / update a panel order = header + PanelOrderLine rows in
   ONE call (the /panel-save shape). Create mints PNL/FY/NNN and is born
   NewRequest; update is allowed only while New / Received (stock untouched)
   and replaces the lines wholesale. status / order_number / source never
   change here (status machine = /panel-order-status). */
const PANEL_ORDER_EDITABLE = new Set(["NewRequest", "Received"]);
const stampNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

app.post("/panel-order-save", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const rowid = body.rowid ? rowidParam(body.rowid) : null;
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const header = {
      customer: rowidParam(body.customer),
      salesperson: String(body.salesperson || "").trim(),
    };
    if (String(body.order_date || "").trim()) header.order_date = String(body.order_date).trim(); // date cols reject ""
    const result = await withOpLog(
      catalyst,
      { table_name: "PanelOrder", operation: rowid ? "update" : "insert", payload: body },
      async () => {
        // Validate everything up front — never write a header then fail on a line.
        if (!header.customer) throw badRequest("Customer is required");
        if (!lines.length) throw badRequest("Add at least one panel or cut piece");
        // CR-413 → CR-453: where the panels will sit (a Warehouse node id) — mandatory on create and edit.
        header.warehouse = await requireLocation(catalyst, body.warehouse);
        const seen = new Set();
        const seenCut = new Set();
        for (const l of lines) {
          const p = rowidParam(l.panel);
          const q = Number(l.qty);
          if (!Number.isInteger(q) || q <= 0) throw badRequest("qty must be a positive integer");
          if (p) {
            if (seen.has(p)) throw badRequest("A panel is listed twice — change its quantity instead");
            seen.add(p);
            continue;
          }
          // CR-346: a loose cut-piece line = design + cut size (+ qty), no panel, no MDF.
          const d = rowidParam(l.design);
          if (!d) throw badRequest("Every line needs a panel, or a design");
          // CR-357: blank cut size = the design's full size (same CR-289 rule as the Panel form).
          if (!rowidParam(l.cut_piece_size)) l.cut_piece_size = await fullSizeCutPiece(catalyst, ds, d);
          const c = rowidParam(l.cut_piece_size);
          if (rowidParam(l.mdf)) throw badRequest("A cut-piece line has no MDF");
          if (seenCut.has(`${d}|${c}`)) throw badRequest("A cut piece is listed twice — change its quantity instead");
          seenCut.add(`${d}|${c}`);
        }
        const found = seen.size
          ? rowList(
              await catalyst.zcql().executeZCQLQuery(
                `SELECT ROWID, panel_code, mdf_size FROM Panel WHERE ROWID IN (${[...seen].join(",")}) AND deleted_at is null`,
              ),
            )
          : [];
        if (found.length !== seen.size) throw badRequest("A picked panel no longer exists", 404);
        // CR-344: the MDF master is size-keyed — a line's thickness must be a row of the
        // panel's MDF size, and a panel whose size has rows needs one picked.
        const normSize = (v) => String(v || "").trim().toLowerCase();
        const mdfRows = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, size FROM Mdf WHERE deleted_at is null`));
        const sizeOfMdf = new Map(mdfRows.map((m) => [String(m.ROWID), normSize(m.size)]));
        const sizesWithRows = new Set(mdfRows.map((m) => normSize(m.size)).filter(Boolean));
        for (const l of lines) {
          const p = rowidParam(l.panel);
          if (!p) continue;
          const m = rowidParam(l.mdf);
          const panel = found.find((f) => String(f.ROWID) === p) || {};
          const size = normSize(panel.mdf_size);
          if (m && !sizeOfMdf.has(m)) throw badRequest("The picked MDF thickness no longer exists", 404);
          if (m && size && sizeOfMdf.get(m) !== size) throw badRequest("MDF size does not match the panel's MDF size", 400);
          if (!m && size && sizesWithRows.has(size)) throw badRequest(`Pick the MDF thickness for ${panel.panel_code || p}`);
        }

        let id = rowid;
        let orderNumber = "";
        if (id) {
          const cur = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ROWID, status, order_number, allocation FROM PanelOrder WHERE ROWID = ${id} AND deleted_at is null`,
            ),
          )[0];
          if (!cur) throw badRequest(`Panel order not found: ${id}`, 404);
          if (!PANEL_ORDER_EDITABLE.has(String(cur.status)))
            throw badRequest("Cutting has started — panels and quantities are locked", 409);
          // CR-347: lines are replaced wholesale — a load line would dangle.
          if ((await panelLoadsOf(catalyst, "panel_order", id)).loads.length) throw badRequest("Pieces have been loaded — panels and quantities are locked", 409);
          orderNumber = String(cur.order_number || "");
          const old = await panelOrderLines(catalyst, id);
          const stamp = stampNow();
          for (const l of old) await ds.table("PanelOrderLine").updateRow({ ROWID: l.ROWID, deleted_at: stamp });
          // CR-312: lines may change while pieces are booked (Received) — clamp the booking to the new need.
          const needs = await panelOrderNeeds(catalyst, id, lines);
          const oldAlloc = parseJsonCol(cur.allocation);
          const kept = {};
          for (const [k, n] of needs) if ((Number(oldAlloc[k]) || 0) > 0) kept[k] = Math.min(Number(oldAlloc[k]) || 0, n.need);
          await ds.table("PanelOrder").updateRow({ ROWID: id, ...header, allocation: JSON.stringify(kept) });
        } else {
          orderNumber = await nextOrderNumber(catalyst, "PanelOrder", "PNL");
          await assertUnique(catalyst, "PanelOrder", "order_number", orderNumber);
          const row = { ...header, order_number: orderNumber, status: "NewRequest" };
          // Source sale (CR-286) rides on the header; bigint cols reject "".
          if (rowidParam(body.sales_order)) row.sales_order = rowidParam(body.sales_order);
          if (rowidParam(body.quote)) row.quote = rowidParam(body.quote);
          id = String((await ds.table("PanelOrder").insertRow(row)).ROWID);
          // The request shows on the source Quote / SO Activity tab (blank refs are skipped).
          await logRelated(
            catalyst,
            [{ table: "SalesOrder", rowid: row.sales_order }, { table: "Quote", rowid: row.quote }],
            "panel-order-request",
            { panel_orders: [id] },
          );
        }
        // CR-346: a cut-piece line names a cut-piece ITEM — make sure its stock row exists (qty 0).
        for (const l of lines) if (!rowidParam(l.panel)) await ensureCutPiece(catalyst, ds, l.design, l.cut_piece_size);
        await ds.table("PanelOrderLine").insertRows(
          lines.map((l) => ({
            panel_order: id, qty: Number(l.qty),
            ...(rowidParam(l.panel) ? { panel: rowidParam(l.panel) } : { design: rowidParam(l.design), cut_piece_size: rowidParam(l.cut_piece_size) }),
            ...(rowidParam(l.mdf) ? { mdf: rowidParam(l.mdf) } : {}), // bigint cols reject ""
          })),
        );
        return { rowid: id, data: { ROWID: id, order_number: orderNumber } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-302: soft-delete a panel order + its lines — only while New / Received
   (later stages have moved stock). Reason mandatory (CR-270). */
app.post("/panel-order-delete/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rid = rowidParam(req.params.rowid);
    const reason = deleteReason(req, "PanelOrder");
    const result = await withOpLog(
      catalyst,
      { table_name: "PanelOrder", operation: "soft-delete", payload: { rowid: rid, reason } },
      async () => {
        const order = rowList(
          await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, order_number, status, sales_order, quote, customer FROM PanelOrder WHERE ROWID = ${rid} AND deleted_at is null`),
        )[0];
        if (!order) throw badRequest(`Panel order not found: ${rid}`, 404);
        if (!PANEL_ORDER_EDITABLE.has(String(order.status)))
          throw badRequest("Only a New or Received order can be deleted", 409);
        if ((await panelLoadsOf(catalyst, "panel_order", rid)).loads.length) throw badRequest("Pieces have been loaded — remove the loads first", 409); // CR-347
        const stamp = stampNow();
        for (const l of await panelOrderLines(catalyst, rid)) await ds.table("PanelOrderLine").updateRow({ ROWID: l.ROWID, deleted_at: stamp });
        await ds.table("PanelOrder").updateRow({ ROWID: rid, deleted_at: stamp });
        // CR-475: the source SO / Quote / Customer Activity sees the delete, as it sees a cancel.
        await logRelated(
          catalyst,
          [{ table: "SalesOrder", rowid: order.sales_order }, { table: "Quote", rowid: order.quote }, { table: "Customer", rowid: order.customer }],
          "panel-order-delete",
          { ROWID: rid, order_number: order.order_number, reason },
        );
        return { rowid: rid, data: { ROWID: rid } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-368: Cancel — any order that has not shipped anything (New … Ready, no loads).
   Reason mandatory for every role. The booking JSON is cleared so the pieces are
   free stock again (otherAllocations ignores the status anyway); pieces a Ready
   order added stay on hand. An order with loads is not cancellable — delete the
   loads first (each returns its pieces + booking). Status Cancelled is terminal:
   no transition, save, allocate, checkpoint or load accepts it. */
const PANEL_ORDER_CANCELLABLE = new Set(["NewRequest", "Received", "InCutting", "Ready"]);
app.post("/panel-order-cancel/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rid = rowidParam(req.params.rowid);
    const reason = requireReason(req, "to cancel the order");
    const result = await withOpLog(
      catalyst,
      { table_name: "PanelOrder", operation: "cancel", payload: { ROWID: rid, reason } },
      async () => {
        const order = rowList(
          await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, order_number, status, sales_order, quote, customer FROM PanelOrder WHERE ROWID = ${rid} AND deleted_at is null`),
        )[0];
        if (!order) throw badRequest(`Panel order not found: ${rid}`, 404);
        const from = String(order.status);
        if (!PANEL_ORDER_CANCELLABLE.has(from)) throw badRequest(from === "Cancelled" ? "Order already cancelled" : "Order already dispatched", 409);
        const n = (await panelLoadsOf(catalyst, "panel_order", rid)).loads.length;
        if (n) throw badRequest(`Delete the ${n} load${n === 1 ? "" : "s"} in the Dispatch tab first`, 409);
        await ds.table("PanelOrder").updateRow({ ROWID: rid, status: "Cancelled", allocation: "{}" });
        await logTransition(catalyst, { entity_type: "PanelOrder", entity_rowid: rid, from_status: from, to_status: "Cancelled", note: reason });
        await logRelated(
          catalyst,
          [{ table: "SalesOrder", rowid: order.sales_order }, { table: "Quote", rowid: order.quote }, { table: "Customer", rowid: order.customer }],
          "panel-order-cancel",
          { ROWID: rid, order_number: order.order_number, reason },
        );
        return { rowid: rid, data: { ROWID: rid, status: "Cancelled" } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Sample Orders (CR-315/316) — a customer's request for item SAMPLES:
   full tiles or cut pieces of any Item-master design, kept APART from
   Panel Orders (separate order type, same Customer). Header + SampleOrderLine
   rows save in one call (SMP/FY/NNN); status New → PartiallySupplied →
   Supplied is DERIVED from the lines by /panel-load-save (CR-347; per-line
   qty + date, partial allowed). EVERY line deducts the Panel Craft sample
   stock (CutStockEntry, ledger kind "sample"): a Cut line its cut piece, a
   Full tile the item's FULL-SIZE piece (CR-489 — `fullSizeCutPiece`, the row
   that IS the item on Cut Stock; export box stock / batches are never touched,
   reversing CR-488). Edit / delete only while New.
   ---------------------------------------------------------------- */
const SAMPLE_PIECE_KINDS = new Set(["Full", "Cut"]);
async function sampleOrderLines(catalyst, orderId) {
  const lines = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, design, piece_kind, cut_piece_size, qty, supplied_qty, supplied_on FROM SampleOrderLine WHERE sample_order = ${orderId} AND deleted_at is null`,
    ),
  );
  // CR-489: a Full line is keyed on the item's full-size piece. Rows saved before CR-489 carry no
  // cut_piece_size — resolve once and stamp it, so every reader sees one shape.
  for (const l of lines) {
    if (rowidParam(l.cut_piece_size) || String(l.piece_kind) === "Cut") continue;
    l.cut_piece_size = await fullSizeCutPiece(catalyst, catalyst.datastore(), l.design);
    await catalyst.datastore().table("SampleOrderLine").updateRow({ ROWID: l.ROWID, cut_piece_size: l.cut_piece_size });
  }
  return lines;
}
/* The one status rule (mirrored in client sampleOrderStatus.ts): every line
   fully supplied → Supplied; any piece supplied → PartiallySupplied; else New. */
function sampleStatus(lines) {
  let any = false;
  let all = lines.length > 0;
  for (const l of lines) {
    const s = Number(l.supplied_qty) || 0;
    if (s > 0) any = true;
    if (s < (Number(l.qty) || 0)) all = false;
  }
  return all ? "Supplied" : any ? "PartiallySupplied" : "New";
}

/* CR-487: a sample order's piece need per design|cutSize — every line (CR-489: a Full tile
   keys on the item's full-size piece), the PENDING qty (qty − supplied)
   unless explicit picks [{line, qty}] are given (a load, or its reversal). */
async function sampleOrderNeeds(catalyst, orderId, picks) {
  const needs = new Map();
  const src = picks || (await sampleOrderLines(catalyst, orderId)).map((l) => ({ line: l, qty: (Number(l.qty) || 0) - (Number(l.supplied_qty) || 0) }));
  for (const p of src) {
    const l = p.line || {};
    if (!rowidParam(l.cut_piece_size) || !(p.qty > 0)) continue;
    const k = `${l.design}|${l.cut_piece_size}`;
    const cur = needs.get(k) || { design: String(l.design), cut_piece_size: String(l.cut_piece_size), need: 0 };
    cur.need += p.qty;
    needs.set(k, cur);
  }
  return needs;
}

app.post("/sample-order-save", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const rowid = body.rowid ? rowidParam(body.rowid) : null;
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const header = {
      customer: rowidParam(body.customer),
      salesperson: String(body.salesperson || "").trim(),
      note: String(body.note || "").trim(),
    };
    if (String(body.order_date || "").trim()) header.order_date = String(body.order_date).trim(); // date cols reject ""
    const result = await withOpLog(
      catalyst,
      { table_name: "SampleOrder", operation: rowid ? "update" : "insert", payload: body },
      async () => {
        // Validate everything up front — never write a header then fail on a line.
        if (!header.customer) throw badRequest("Customer is required");
        if (!lines.length) throw badRequest("Add at least one item");
        const seen = new Set();
        const designIds = new Set();
        const cutIds = new Set();
        const clean = [];
        for (const l of lines) {
          const d = rowidParam(l.design);
          if (!d) throw badRequest("Every line needs an item");
          const kind = String(l.piece_kind || "Full").trim();
          if (!SAMPLE_PIECE_KINDS.has(kind)) throw badRequest("piece_kind must be Full or Cut");
          // CR-489: a Full tile IS the item's full-size piece on Cut Stock — stamp its CutPieceSize so stock,
          // booking and the load all key on that one row (minted on first use, like a panel line).
          const c = kind === "Cut" ? rowidParam(l.cut_piece_size) : await fullSizeCutPiece(catalyst, ds, d);
          if (kind === "Cut" && !c) throw badRequest("A cut-piece sample needs a cut piece size");
          const q = Number(l.qty);
          if (!Number.isInteger(q) || q <= 0) throw badRequest("qty must be a positive whole number");
          const key = `${d}|${kind}|${c}`;
          if (seen.has(key)) throw badRequest("An item is listed twice with the same piece — change its quantity instead");
          seen.add(key);
          designIds.add(d);
          if (c) cutIds.add(c);
          clean.push({ design: d, piece_kind: kind, cut_piece_size: c, qty: q, note: String(l.note || "").trim() });
        }
        const found = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM Design WHERE ROWID IN (${[...designIds].join(",")})`));
        if (found.length !== designIds.size) throw badRequest("A picked item no longer exists", 404);
        if (cutIds.size) {
          const cs = rowList(
            await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM CutPieceSize WHERE ROWID IN (${[...cutIds].join(",")}) AND deleted_at is null`),
          );
          if (cs.length !== cutIds.size) throw badRequest("A picked cut piece size no longer exists", 404);
        }

        let id = rowid;
        let orderNumber = "";
        if (id) {
          const cur = rowList(
            await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, status, order_number, allocation FROM SampleOrder WHERE ROWID = ${id} AND deleted_at is null`),
          )[0];
          if (!cur) throw badRequest(`Sample order not found: ${id}`, 404);
          if (String(cur.status) !== "New") throw badRequest("Samples have already been supplied — items and quantities are locked", 409);
          orderNumber = String(cur.order_number || "");
          const stamp = stampNow();
          for (const l of await sampleOrderLines(catalyst, id)) await ds.table("SampleOrderLine").updateRow({ ROWID: l.ROWID, deleted_at: stamp });
          // CR-487: the booking survives an edit only for keys still on the order, clamped to the new qty
          // (New = nothing supplied, so the need IS the qty) — the /panel-order-save clamp.
          const oldAlloc = parseJsonCol(cur.allocation);
          const kept = {};
          for (const l of clean) {
            const q = Math.min(Number(oldAlloc[`${l.design}|${l.cut_piece_size}`]) || 0, l.qty);
            if (q > 0) kept[`${l.design}|${l.cut_piece_size}`] = q;
          }
          await ds.table("SampleOrder").updateRow({ ROWID: id, ...header, allocation: JSON.stringify(kept) });
        } else {
          orderNumber = await nextOrderNumber(catalyst, "SampleOrder", "SMP");
          await assertUnique(catalyst, "SampleOrder", "order_number", orderNumber);
          const row = { ...header, order_number: orderNumber, status: "New" };
          if (rowidParam(body.sales_order)) row.sales_order = rowidParam(body.sales_order); // bigint cols reject ""
          if (rowidParam(body.quote)) row.quote = rowidParam(body.quote);
          id = String((await ds.table("SampleOrder").insertRow(row)).ROWID);
          // The request shows on the source Quote / SO and the Customer's Activity.
          await logRelated(
            catalyst,
            [{ table: "SalesOrder", rowid: row.sales_order }, { table: "Quote", rowid: row.quote }, { table: "Customer", rowid: header.customer }],
            "sample-order-request",
            { sample_order: orderNumber, lines: clean.length },
          );
        }
        await ds.table("SampleOrderLine").insertRows(
          clean.map((l) => ({
            sample_order: id, design: l.design, piece_kind: l.piece_kind, qty: l.qty, supplied_qty: 0, note: l.note,
            ...(l.cut_piece_size ? { cut_piece_size: l.cut_piece_size } : {}), // bigint cols reject ""
          })),
        );
        return { rowid: id, data: { ROWID: id, order_number: orderNumber } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Soft-delete a sample order + its lines — only while New (nothing supplied). Reason mandatory (CR-270). */
app.post("/sample-order-delete/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rid = rowidParam(req.params.rowid);
    const reason = deleteReason(req, "SampleOrder");
    const result = await withOpLog(
      catalyst,
      { table_name: "SampleOrder", operation: "soft-delete", payload: { rowid: rid, reason } },
      async () => {
        const order = rowList(
          await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, status FROM SampleOrder WHERE ROWID = ${rid} AND deleted_at is null`),
        )[0];
        if (!order) throw badRequest(`Sample order not found: ${rid}`, 404);
        if (String(order.status) !== "New") throw badRequest("Only a New sample order can be deleted — samples have been supplied", 409);
        const stamp = stampNow();
        for (const l of await sampleOrderLines(catalyst, rid)) await ds.table("SampleOrderLine").updateRow({ ROWID: l.ROWID, deleted_at: stamp });
        await ds.table("SampleOrder").updateRow({ ROWID: rid, deleted_at: stamp });
        return { rowid: rid, data: { ROWID: rid } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-368: Cancel a sample order — only while nothing has gone out (no supply, no
   load); reason mandatory for every role. Cancelled is the one STORED status on a
   sample order (the rest derive from the lines) and it is terminal. */
app.post("/sample-order-cancel/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rid = rowidParam(req.params.rowid);
    const reason = requireReason(req, "to cancel the order");
    const result = await withOpLog(
      catalyst,
      { table_name: "SampleOrder", operation: "cancel", payload: { ROWID: rid, reason } },
      async () => {
        const order = rowList(
          await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, order_number, status, sales_order, quote, customer FROM SampleOrder WHERE ROWID = ${rid} AND deleted_at is null`),
        )[0];
        if (!order) throw badRequest(`Sample order not found: ${rid}`, 404);
        const from = String(order.status);
        if (from === "Cancelled") throw badRequest("Order already cancelled", 409);
        const lines = await sampleOrderLines(catalyst, rid);
        if (from === "Supplied" || lines.some((l) => (Number(l.supplied_qty) || 0) > 0)) throw badRequest("Samples have been supplied — this order cannot be cancelled", 409);
        const n = (await panelLoadsOf(catalyst, "sample_order", rid)).loads.length;
        if (n) throw badRequest(`Delete the ${n} load${n === 1 ? "" : "s"} in the Dispatch tab first`, 409);
        await ds.table("SampleOrder").updateRow({ ROWID: rid, status: "Cancelled", allocation: "{}" }); // CR-487: a cancelled order books nothing
        await logTransition(catalyst, { entity_type: "SampleOrder", entity_rowid: rid, from_status: from, to_status: "Cancelled", note: reason });
        await logRelated(
          catalyst,
          [{ table: "SalesOrder", rowid: order.sales_order }, { table: "Quote", rowid: order.quote }, { table: "Customer", rowid: order.customer }],
          "sample-order-cancel",
          { ROWID: rid, order_number: order.order_number, reason },
        );
        return { rowid: rid, data: { ROWID: rid, status: "Cancelled" } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-487: book cut pieces to a sample order — the /panel-order-allocate rule verbatim:
   ABSOLUTE per design|cutSize figure (lower = release, 0 / missing = none, unknown keys
   ignored), 0 ≤ q ≤ pending need AND ≤ on hand − what OTHER open orders (panel + sample)
   have booked; every key verified before the single write. Full-tile lines never book. */
app.post("/sample-order-allocate/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rid = rowidParam(req.params.rowid);
    const wanted = (req.body || {}).allocation;
    const result = await withOpLog(
      catalyst,
      { table_name: "SampleOrder", operation: "allocate", payload: { ROWID: rid, allocation: wanted } },
      async () => {
        if (!wanted || typeof wanted !== "object" || Array.isArray(wanted)) throw badRequest("allocation must be an object of design|cutSize → pcs");
        const order = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, order_number, status, sales_order, quote, customer FROM SampleOrder WHERE ROWID = ${rid} AND deleted_at is null`,
          ),
        )[0];
        if (!order) throw badRequest(`Sample order not found: ${rid}`, 404);
        if (!SAMPLE_ORDER_OPEN.has(String(order.status)))
          throw badRequest(String(order.status) === "Cancelled" ? `${order.order_number} is cancelled` : `${order.order_number} is fully supplied`, 409);
        const needs = await sampleOrderNeeds(catalyst, rid);
        const others = await otherAllocations(catalyst, rid);
        const next = {};
        for (const [k, n] of needs) {
          const q = Number(wanted[k] == null || wanted[k] === "" ? 0 : wanted[k]);
          if (!Number.isInteger(q) || q < 0) throw badRequest("Booked pcs must be a whole number ≥ 0");
          if (q === 0) continue;
          if (q > n.need) throw badRequest(`Only ${n.need} pcs of ${await cutPieceLabel(catalyst, n.design, n.cut_piece_size)} are needed`);
          const free = (await cutOnHand(catalyst, n.design, n.cut_piece_size)) - (others.get(k) || 0);
          if (q > free)
            throw badRequest(`Only ${Math.max(0, free)} pcs free of ${await cutPieceLabel(catalyst, n.design, n.cut_piece_size)} — the rest are booked by other orders`, 409);
          next[k] = q;
        }
        // ponytail: read-check-write, single-writer app — the /panel-order-allocate ceiling.
        await ds.table("SampleOrder").updateRow({ ROWID: rid, allocation: JSON.stringify(next) });
        await logRelated(
          catalyst,
          [{ table: "SampleOrder", rowid: rid }, { table: "SalesOrder", rowid: order.sales_order }, { table: "Quote", rowid: order.quote }, { table: "Customer", rowid: order.customer }],
          "sample-order-allocate",
          { ROWID: rid, order_number: order.order_number, allocation: next },
        );
        return { rowid: rid, data: { ROWID: rid, allocation: next } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-316: record what went out — {date, note?, lines:[{line, qty}]}. Every
   quantity is verified (≤ remaining; CR-487: Cut lines must be BOOKED to the
   order and on hand — the panel-order load gate) BEFORE any
   write. Every pick → adjustCutStock(−qty, kind "sample") on its piece (CR-489: a Full
   tile on the item's full-size piece).
   Header status is re-derived from the lines; the supply mirrors onto the
   source SO / Quote and the Customer's Activity. */
/* CR-316 supply rules, lifted verbatim from the old /sample-order-supply (deleted by
   CR-347 — a sample supply IS a load now). verify → picks + the live lines;
   apply → stock, supplied_qty/on, derived status, audit. */
async function verifySampleSupply(catalyst, order, picksIn) {
  const rid = String(order.ROWID);
  if (String(order.status) === "Cancelled") throw badRequest(`${order.order_number} is cancelled`, 409); // CR-368
  if (String(order.status) === "Supplied") throw badRequest(`Every line of ${order.order_number} is already supplied`, 409);
  const lines = await sampleOrderLines(catalyst, rid);
  const byId = new Map(lines.map((l) => [String(l.ROWID), l]));
  const picks = [];
  const seen = new Set();
  for (const p of picksIn) {
    const lid = rowidParam(p && p.line);
    const line = byId.get(lid);
    if (!line) throw badRequest("A line is not on this order", 404);
    if (p.material && String(p.material) !== "Item") throw badRequest("A sample line ships as Item");
    if (seen.has(lid)) throw badRequest("A line is listed twice");
    seen.add(lid);
    const q = Number(p.qty);
    if (!Number.isInteger(q) || q < 0) throw badRequest("qty must be a whole number");
    if (q === 0) continue; // 0 = skip this line
    const remaining = (Number(line.qty) || 0) - (Number(line.supplied_qty) || 0);
    if (q > remaining) throw badRequest(`Only ${remaining} pcs remain to supply of ${await designLabel(catalyst, line.design)}`);
    picks.push({ line, qty: q });
  }
  if (!picks.length) throw badRequest(`Enter a quantity on at least one line of ${order.order_number}`);
  // CR-487: the pieces leave with the load — they must be BOOKED to this order (the CR-312/347
  // panel-order gate; Σ open bookings ≤ on hand makes the free check redundant) and on hand.
  const needs = await sampleOrderNeeds(catalyst, rid, picks);
  const booked = parseJsonCol(order.allocation);
  for (const [k, n] of needs) {
    const have = Number(booked[k]) || 0;
    if (have < n.need)
      throw badRequest(`Book ${n.need - have} more pcs of ${await cutPieceLabel(catalyst, n.design, n.cut_piece_size)} before loading ${order.order_number}`, 409);
    if ((await cutOnHand(catalyst, n.design, n.cut_piece_size)) < n.need) throw badRequest(`Insufficient cut-piece stock for ${order.order_number}`, 409);
  }
  return { picks, lines, needs };
}
async function applySampleSupply(catalyst, ds, order, { picks, lines, needs }, { date, note, actor, load, vehicle }) {
  const rid = String(order.ROWID);
  for (const p of picks) {
    await adjustCutStock(catalyst, ds, p.line.design, p.line.cut_piece_size, -p.qty, {
      kind: "sample", entry_date: date, note, ref_table: "SampleOrder", ref_rowid: rid, performed_by: actor,
    });
    p.line.supplied_qty = (Number(p.line.supplied_qty) || 0) + p.qty;
    await ds.table("SampleOrderLine").updateRow({ ROWID: p.line.ROWID, supplied_qty: p.line.supplied_qty, supplied_on: date });
  }
  // CR-487: the booking shrinks with the stock — Σ open bookings ≤ on hand still holds.
  const alloc = parseJsonCol(order.allocation);
  for (const [k, n] of needs || []) {
    const left = (Number(alloc[k]) || 0) - n.need;
    if (left > 0) alloc[k] = left;
    else delete alloc[k];
  }
  const status = sampleStatus(lines);
  await ds.table("SampleOrder").updateRow({ ROWID: rid, allocation: JSON.stringify(alloc), ...(status !== String(order.status) ? { status } : {}) });
  if (status !== String(order.status)) {
    await logTransition(catalyst, { entity_type: "SampleOrder", entity_rowid: rid, from_status: order.status, to_status: status, note: load || "" });
  }
  await logRelated(
    catalyst,
    [{ table: "SampleOrder", rowid: rid }, { table: "SalesOrder", rowid: order.sales_order }, { table: "Quote", rowid: order.quote }, { table: "Customer", rowid: order.customer }],
    "sample-supplied",
    { sample_order: order.order_number, date, load, vehicle, lines: picks.map((p) => ({ design: p.line.design, piece_kind: p.line.piece_kind, qty: p.qty })) },
  );
  return status;
}

/* CR-347: record ONE vehicle trip for one or several orders. Body
   {load_date, vehicle_number, driver_name?, driver_mobile?, note?, photos?: [{id,name}], orders: [{order_type Panel|Sample,
   order, lines: [{line, material Item|Mdf, qty, design?, cut_piece_size?}]}]} — CR-405: an Item pick of a
   panel line names its piece kind. Verify-all-then-write: every order's picks are checked
   (pending, marks, booking, stock) before the first row lands. */
app.post("/panel-load-save", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const date = String(body.load_date || "").trim() || todayDate();
    const vehicle = String(body.vehicle_number || "").trim();
    const driverName = titleCase(body.driver_name); // CR-351 · CR-429 Title Case
    const driverMobile = String(body.driver_mobile || "").trim();
    const note = String(body.note || "").trim();
    const photos = (Array.isArray(body.photos) ? body.photos : []).filter((p) => p && rowidParam(p.id)).map((p) => ({ id: String(p.id), name: String(p.name || "") }));
    const orders = Array.isArray(body.orders) ? body.orders : [];
    const result = await withOpLog(
      catalyst,
      { table_name: "PanelLoad", operation: "insert", payload: body },
      async () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("load_date must be yyyy-mm-dd");
        if (!vehicle) throw badRequest("Vehicle number is required");
        if (!orders.length) throw badRequest("Pick at least one order");
        const actor = await currentActor(catalyst);
        const jobs = [];
        const seenOrders = new Set();
        for (const o of orders) {
          const type = String(o.order_type || "") === "Sample" ? "Sample" : "Panel";
          const oid = rowidParam(o.order);
          if (!oid) throw badRequest("Every entry needs an order");
          if (seenOrders.has(`${type}|${oid}`)) throw badRequest("An order is listed twice");
          seenOrders.add(`${type}|${oid}`);
          const picksIn = Array.isArray(o.lines) ? o.lines : [];
          if (type === "Sample") {
            const order = rowList(
              await catalyst.zcql().executeZCQLQuery(
                `SELECT ROWID, status, order_number, customer, sales_order, quote, allocation FROM SampleOrder WHERE ROWID = ${oid} AND deleted_at is null`,
              ),
            )[0];
            if (!order) throw badRequest(`Sample order not found: ${oid}`, 404);
            jobs.push({ type, order, supply: await verifySampleSupply(catalyst, order, picksIn) });
            continue;
          }
          const order = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ROWID, status, order_number, customer, sales_order, quote, allocation, checkpoints FROM PanelOrder WHERE ROWID = ${oid} AND deleted_at is null`,
            ),
          )[0];
          if (!order) throw badRequest(`Panel order not found: ${oid}`, 404);
          const st = String(order.status || "");
          if (!PANEL_ORDER_OPEN.has(st))
            throw badRequest(st === "Cancelled" ? `${order.order_number} is cancelled` : `${order.order_number} is already dispatched`, 409);
          const cp = parseJsonCol(order.checkpoints); // CR-381
          const pending = await panelPending(catalyst, oid);
          const picks = [];
          const seen = new Set();
          for (const p of picksIn) {
            const lid = rowidParam(p && p.line);
            const material = String((p && p.material) || "");
            const q = Number(p && p.qty);
            if (!LOAD_MATERIALS.has(material))
              throw badRequest(material === "Panel" ? "Load a panel's pieces per cut piece — material Item with design + cut_piece_size" : "material must be Item or Mdf");
            if (!Number.isInteger(q) || q < 0) throw badRequest("qty must be a whole number");
            if (q === 0) continue;
            // CR-405: an Item pick names its piece kind; a loose line's single Item row may be picked without it.
            const design = rowidParam(p && p.design);
            const cut = rowidParam(p && p.cut_piece_size);
            const row = pending.find(
              (r) => String(r.line.ROWID) === lid && r.material === material && (material === "Mdf" || (design ? r.design === design && r.cut_piece_size === cut : !rowidParam(r.line.panel))),
            );
            if (!row) throw badRequest("A line / material / cut piece is not on this order", 404);
            const k = loadRowKey(lid, material, row.design, row.cut_piece_size);
            if (seen.has(k)) throw badRequest("A line is listed twice");
            seen.add(k);
            if (q > row.pending) throw badRequest(`Only ${row.pending} ${material === "Mdf" ? "MDF boards" : "pcs"} remain to load on ${order.order_number}`);
            // CR-381/403: the board leaves only once pasted; pieces are gated by the booking below.
            const miss = materialBlockers(cp, String(row.line.panel || ""), material);
            if (miss.length) throw badRequest(`${await panelCodeOf(catalyst, row.line.panel)} ${material === "Mdf" ? "MDF" : "panel"} on ${order.order_number}: ${miss.join(" · ")}`, 409);
            picks.push({ row, qty: q });
          }
          if (!picks.length) throw badRequest(`Enter a quantity on at least one line of ${order.order_number}`);
          // The pieces leave with the Item rows — they must be BOOKED to this order (CR-312) and on hand.
          const needs = await panelOrderNeeds(
            catalyst,
            oid,
            picks.filter((p) => p.row.material === "Item").map((p) => ({ design: p.row.design, cut_piece_size: p.row.cut_piece_size, qty: p.qty })),
          );
          const booked = parseJsonCol(order.allocation);
          for (const [k, n] of needs) {
            const have = Number(booked[k]) || 0;
            if (have < n.need)
              throw badRequest(`Book ${n.need - have} more pcs of ${await cutPieceLabel(catalyst, n.design, n.cut_piece_size)} before loading ${order.order_number}`, 409);
            if ((await cutOnHand(catalyst, n.design, n.cut_piece_size)) < n.need) throw badRequest(`Insufficient cut-piece stock for ${order.order_number}`, 409);
          }
          jobs.push({ type, order, picks, needs });
        }
        // ---- write (verified above; row-by-row like every other mutation here) ----
        const orderNumber = await nextOrderNumber(catalyst, "PanelLoad", "LD");
        const out = [];
        for (const j of jobs) {
          const oid = String(j.order.ROWID);
          const head = { order_number: orderNumber, order_type: j.type, load_date: date, vehicle_number: vehicle, driver_name: driverName, driver_mobile: driverMobile, note, photos: JSON.stringify(photos), performed_by: actor };
          head[j.type === "Panel" ? "panel_order" : "sample_order"] = oid;
          const loadId = String((await ds.table("PanelLoad").insertRow(head)).ROWID);
          if (j.type === "Sample") {
            await ds.table("PanelLoadLine").insertRows(j.supply.picks.map((p) => ({ panel_load: loadId, order_line: String(p.line.ROWID), material: "Item", qty: p.qty })));
            const status = await applySampleSupply(catalyst, ds, j.order, j.supply, { date, note: `${orderNumber} · ${vehicle}${note ? ` · ${note}` : ""}`, actor, load: orderNumber, vehicle });
            out.push({ ROWID: loadId, order: oid, order_type: j.type, status });
            continue;
          }
          const rows = [];
          for (const p of j.picks) {
            // CR-349: the weight is STAMPED here — a later master edit never rewrites what shipped.
            const unit = await unitWeightOf(catalyst, p.row);
            rows.push({
              panel_load: loadId, order_line: String(p.row.line.ROWID), material: p.row.material, qty: p.qty,
              ...(p.row.material === "Item" && p.row.design ? { design: p.row.design, cut_piece_size: p.row.cut_piece_size } : {}), // CR-405
              ...(unit == null ? {} : { weight_kg: Math.round(unit * p.qty * 1000) / 1000 }),
            });
          }
          await ds.table("PanelLoadLine").insertRows(rows);
          const alloc = parseJsonCol(j.order.allocation);
          for (const [k, n] of j.needs) {
            await adjustCutStock(catalyst, ds, n.design, n.cut_piece_size, -n.need, {
              kind: "order_load", entry_date: date, note: `${orderNumber} · ${vehicle}`, ref_table: "PanelLoad", ref_rowid: loadId, performed_by: actor,
            });
            // The booking shrinks with the stock — Σ open bookings ≤ on hand still holds.
            const left = (Number(alloc[k]) || 0) - n.need;
            if (left > 0) alloc[k] = left;
            else delete alloc[k];
          }
          const done = (await panelPending(catalyst, oid)).every((r) => r.pending === 0);
          await ds.table("PanelOrder").updateRow({ ROWID: oid, allocation: JSON.stringify(alloc), ...(done ? { status: "Dispatched" } : {}) });
          if (done) await logTransition(catalyst, { entity_type: "PanelOrder", entity_rowid: oid, from_status: j.order.status, to_status: "Dispatched", note: orderNumber });
          await logRelated(
            catalyst,
            [{ table: "PanelOrder", rowid: oid }, { table: "SalesOrder", rowid: j.order.sales_order }, { table: "Quote", rowid: j.order.quote }, { table: "Customer", rowid: j.order.customer }],
            "panel-order-load",
            { load: orderNumber, vehicle, date, lines: j.picks.map((p) => ({ line: String(p.row.line.ROWID), material: p.row.material, qty: p.qty, ...(p.row.design ? { design: p.row.design, cut_piece_size: p.row.cut_piece_size } : {}) })), ...(done ? { status: "Dispatched" } : {}) },
          );
          out.push({ ROWID: loadId, order: oid, order_type: j.type, status: done ? "Dispatched" : String(j.order.status) });
        }
        return { rowid: null, data: { order_number: orderNumber, loads: out } };
      },
    );
    res.json({ ok: true, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-347: remove one load (one order's row of a trip) while its order is still
   open — stock and booking come back, supplied_qty unwinds. A load that
   completed an order cannot be removed (ponytail ceiling: Admin corrects
   via a stock adjustment; a reopen route is the upgrade path). */
app.post("/panel-load-delete/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rid = rowidParam(req.params.rowid);
    const reason = deleteReason(req, "PanelLoad");
    const result = await withOpLog(
      catalyst,
      { table_name: "PanelLoad", operation: "soft-delete", payload: { rowid: rid, reason } },
      async () => {
        const load = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT ${PANEL_LOAD_COLS} FROM PanelLoad WHERE ROWID = ${rid} AND deleted_at is null`))[0];
        if (!load) throw badRequest(`Load not found: ${rid}`, 404);
        const lines = rowList(
          await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, order_line, material, qty, design, cut_piece_size FROM PanelLoadLine WHERE panel_load = ${rid} AND deleted_at is null`),
        );
        const actor = await currentActor(catalyst);
        const stamp = stampNow();
        if (String(load.order_type) === "Sample") {
          const oid = rowidParam(load.sample_order);
          const order = rowList(
            await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, status, order_number, customer, sales_order, quote, allocation FROM SampleOrder WHERE ROWID = ${oid} AND deleted_at is null`),
          )[0];
          if (!order) throw badRequest("Sample order not found", 404);
          if (String(order.status) === "Supplied") throw badRequest(`${order.order_number} is fully supplied — a final load cannot be removed`, 409);
          const olines = await sampleOrderLines(catalyst, oid);
          const byId = new Map(olines.map((l) => [String(l.ROWID), l]));
          const alloc = parseJsonCol(order.allocation);
          for (const l of lines) {
            const line = byId.get(String(l.order_line));
            if (!line) continue;
            const q = Number(l.qty) || 0;
            if (String(line.piece_kind) === "Cut") {
              await adjustCutStock(catalyst, ds, line.design, line.cut_piece_size, q, {
                kind: "sample", entry_date: todayDate(), note: `Reversed ${load.order_number} (${reason})`, ref_table: "SampleOrder", ref_rowid: oid, performed_by: actor,
              });
              // CR-487: stock and booking come back together (the /panel-load-delete rule).
              const k = `${line.design}|${line.cut_piece_size}`;
              alloc[k] = (Number(alloc[k]) || 0) + q;
            }
            line.supplied_qty = Math.max(0, (Number(line.supplied_qty) || 0) - q);
            await ds.table("SampleOrderLine").updateRow({ ROWID: line.ROWID, supplied_qty: line.supplied_qty });
          }
          const status = sampleStatus(olines);
          await ds.table("SampleOrder").updateRow({ ROWID: oid, allocation: JSON.stringify(alloc), ...(status !== String(order.status) ? { status } : {}) });
          if (status !== String(order.status)) {
            await logTransition(catalyst, { entity_type: "SampleOrder", entity_rowid: oid, from_status: order.status, to_status: status, note: `Load ${load.order_number} removed` });
          }
          await logRelated(catalyst, [{ table: "SampleOrder", rowid: oid }, { table: "Customer", rowid: order.customer }], "sample-load-removed", { load: load.order_number, reason });
        } else {
          const oid = rowidParam(load.panel_order);
          const order = rowList(
            await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, status, order_number, customer, sales_order, quote, allocation FROM PanelOrder WHERE ROWID = ${oid} AND deleted_at is null`),
          )[0];
          if (!order) throw badRequest("Panel order not found", 404);
          if (!PANEL_ORDER_OPEN.has(String(order.status))) throw badRequest(`${order.order_number} is already dispatched — a final load cannot be removed`, 409);
          const byId = new Map((await panelOrderLines(catalyst, oid)).map((l) => [String(l.ROWID), l]));
          // CR-405: an Item line names its piece kind (older loose-line rows and legacy whole-panel rows fall back to the order line).
          const needs = await panelOrderNeeds(
            catalyst,
            oid,
            lines
              .filter((l) => String(l.material) !== "Mdf")
              .map((l) => (rowidParam(l.design) ? { design: l.design, cut_piece_size: l.cut_piece_size, qty: Number(l.qty) || 0 } : { ...(byId.get(String(l.order_line)) || {}), qty: Number(l.qty) || 0 })),
          );
          const alloc = parseJsonCol(order.allocation);
          for (const [k, n] of needs) {
            await adjustCutStock(catalyst, ds, n.design, n.cut_piece_size, n.need, {
              kind: "order_load", entry_date: todayDate(), note: `Reversed ${load.order_number} (${reason})`, ref_table: "PanelLoad", ref_rowid: rid, performed_by: actor,
            });
            alloc[k] = (Number(alloc[k]) || 0) + n.need;
          }
          await ds.table("PanelOrder").updateRow({ ROWID: oid, allocation: JSON.stringify(alloc) });
          await logRelated(
            catalyst,
            [{ table: "PanelOrder", rowid: oid }, { table: "SalesOrder", rowid: order.sales_order }, { table: "Quote", rowid: order.quote }, { table: "Customer", rowid: order.customer }],
            "panel-order-load-removed",
            { load: load.order_number, reason },
          );
        }
        for (const l of lines) await ds.table("PanelLoadLine").updateRow({ ROWID: l.ROWID, deleted_at: stamp });
        await ds.table("PanelLoad").updateRow({ ROWID: rid, deleted_at: stamp });
        return { rowid: rid, data: { ROWID: rid } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-302 one-off: legacy one-panel rows (panel / qty on the header) become
   header + one PanelOrderLine, and blank order_numbers get PNL/FY/NNN.
   Idempotent — re-running is a no-op. Admin only. */
app.post("/migrate-panel-orders", async (req, res) => {
  try {
    const catalyst = init(req);
    const u = req.appUser || {};
    if (String(u.role || "").trim().toLowerCase() !== "admin") throw badRequest("Admin only", 403);
    const ds = catalyst.datastore();
    const result = await withOpLog(
      catalyst,
      { table_name: "PanelOrder", operation: "migrate-lines", payload: {} },
      async () => {
        // ponytail: a handful of rows on LIVE — one page, no paging.
        const orders = rowList(
          await catalyst.zcql().executeZCQLQuery("SELECT ROWID, panel, qty, order_number, status, allocation FROM PanelOrder WHERE deleted_at is null"),
        );
        let migrated = 0;
        let numbered = 0;
        let booked = 0;
        for (const o of orders) {
          const id = String(o.ROWID);
          if (rowidParam(o.panel) && (await panelOrderLines(catalyst, id)).length === 0) {
            await ds.table("PanelOrderLine").insertRow({ panel_order: id, panel: rowidParam(o.panel), qty: Number(o.qty) || 1 });
            migrated++;
          }
          if (!String(o.order_number || "").trim()) {
            // Sequential on purpose — each max-scan must see the previous assignment.
            await ds.table("PanelOrder").updateRow({ ROWID: id, order_number: await nextOrderNumber(catalyst, "PanelOrder", "PNL") });
            numbered++;
          }
          // CR-312: an order already Ready before booking existed holds its own cutting output.
          if (String(o.status) === "Ready" && !String(o.allocation || "").trim()) {
            const needs = await panelOrderNeeds(catalyst, id);
            await ds.table("PanelOrder").updateRow({ ROWID: id, allocation: JSON.stringify(Object.fromEntries([...needs].map(([k, n]) => [k, n.need]))) });
            booked++;
          }
        }
        return { rowid: null, data: { migrated, numbered, booked } };
      },
    );
    res.json({ ok: true, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-373: duplicate customers. The 2026-10-21 CRM imports minted twins (same crm_account_id — 822 rows
   for ≈530 accounts) and reused CUS- codes: the sync read "existing" customers with an unbounded ZCQL,
   capped at 300 rows (fixed by CR-372 in lib/customerSync.js). Dry run (default) returns the plan from
   lib/customerDedupe.js plus, per group, the transactions that would move; {apply:true} repoints
   Quote / SalesOrder / PanelOrder / SampleOrder at the keeper, copies the Books link onto it, soft-deletes
   the twins and re-codes survivors that share a code. Same-name customers on DIFFERENT CRM accounts are
   reported only (CRM is the source — merge them there). Idempotent: a second run plans nothing. */
/* [table, column] pairs that point at a Customer. CR-392/393 added the item owner / buyer
   links and the per-customer brand, so a merged twin leaves no dangling reference. */
const CUSTOMER_FK_COLS = [
  ["Quote", "customer"], ["SalesOrder", "customer"], ["PanelOrder", "customer"], ["SampleOrder", "customer"],
  ["PartyBrand", "customer"], ["Design", "design_owner"], ["Design", "design_buyer"],
];
app.post("/customer-dedupe", async (req, res) => {
  try {
    const catalyst = init(req);
    const u = req.appUser || {};
    if (String(u.role || "").trim().toLowerCase() !== "admin") throw badRequest("Admin only", 403);
    const apply = !!(req.body && req.body.apply);
    const ds = catalyst.datastore();
    const rows = await zcqlAllRows(catalyst, "SELECT ROWID, code, name, crm_account_id, books_contact_id, CREATEDTIME FROM Customer WHERE deleted_at is null");
    const plan = require("./lib/customerDedupe").planDedupe(rows);
    // Live transactions pointing at the rows to drop: table → Map<customer rowid, [rowid]>.
    const refs = {};
    const dropIds = plan.groups.flatMap((g) => g.drop.map((d) => d.rowid));
    for (const [t, c] of CUSTOMER_FK_COLS) {
      const k = `${t}.${c}`;
      refs[k] = new Map();
      for (let i = 0; i < dropIds.length; i += 300) {
        const hits = await zcqlAllRows(catalyst, `SELECT ROWID, ${c} FROM ${t} WHERE ${c} IN (${dropIds.slice(i, i + 300).join(",")}) AND deleted_at is null`);
        for (const h of hits) refs[k].set(String(h[c]), [...(refs[k].get(String(h[c])) || []), String(h.ROWID)]);
      }
    }
    for (const g of plan.groups) {
      g.moves = {};
      for (const [t, c] of CUSTOMER_FK_COLS) g.moves[`${t}.${c}`] = g.drop.reduce((n, d) => n + (refs[`${t}.${c}`].get(d.rowid) || []).length, 0);
    }
    if (!apply) return res.json({ ok: true, applied: false, ...plan });

    const actor = await currentActor(catalyst);
    const result = await withOpLog(
      catalyst,
      { table_name: "Customer", operation: "dedupe", payload: { groups: plan.groups.length, recodes: plan.recodes.length } },
      async () => {
        const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
        let merged = 0;
        let repointed = 0;
        let recoded = 0;
        for (const g of plan.groups) {
          for (const d of g.drop) {
            for (const [t, c] of CUSTOMER_FK_COLS) {
              for (const id of refs[`${t}.${c}`].get(d.rowid) || []) {
                await ds.table(t).updateRow({ ROWID: id, [c]: g.keep.rowid });
                repointed++;
              }
            }
            await ds.table("Customer").updateRow({ ROWID: d.rowid, deleted_at: stamp });
            await writeOpLog(catalyst, {
              table_name: "Customer",
              operation: "dedupe:merge",
              entity_rowid: d.rowid,
              status: "success",
              actor,
              payload_summary: `${d.code} → ${g.keep.code} (Zoho CRM ${g.crm_account_id})`,
            });
            merged++;
          }
          if (g.inherit_books) await ds.table("Customer").updateRow({ ROWID: g.keep.rowid, books_contact_id: g.inherit_books });
        }
        for (const r of plan.recodes) {
          await ds.table("Customer").updateRow({ ROWID: r.rowid, code: r.to });
          await writeOpLog(catalyst, { table_name: "Customer", operation: "dedupe:recode", entity_rowid: r.rowid, status: "success", actor, payload_summary: `${r.name}: ${r.from} → ${r.to}` });
          recoded++;
        }
        _cache.Customer = null; // name → ROWID lookups must not resolve to a merged row
        return { rowid: null, data: { merged, repointed, recoded } };
      },
    );
    res.json({ ok: true, applied: true, ...plan, ...result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-344: MDF went back to a SIZE-keyed master. CR-342 had parented rows per panel,
   so the same size × thickness may exist several times. Keep the first row per
   key, repoint PanelOrderLine.mdf at it, soft-delete the rest. The `panel` column
   is left alone (dormant). Idempotent — a second run merges 0. */
app.post("/migrate-mdf-sizes", async (req, res) => {
  try {
    const catalyst = init(req);
    const u = req.appUser || {};
    if (String(u.role || "").trim().toLowerCase() !== "admin") throw badRequest("Admin only", 403);
    const ds = catalyst.datastore();
    const result = await withOpLog(
      catalyst,
      { table_name: "Mdf", operation: "migrate-sizes", payload: {} },
      async () => {
        // ponytail: one page, no paging — tens of rows on LIVE.
        const rows = rowList(await catalyst.zcql().executeZCQLQuery("SELECT ROWID, size, thickness FROM Mdf WHERE deleted_at is null ORDER BY ROWID"));
        const keeper = new Map();
        let kept = 0;
        let merged = 0;
        let repointed = 0;
        const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
        for (const r of rows) {
          const key = `${String(r.size || "").trim().toLowerCase()}|${String(r.thickness || "").trim().toLowerCase()}`;
          if (!keeper.has(key)) {
            keeper.set(key, String(r.ROWID));
            kept++;
            continue;
          }
          const to = keeper.get(key);
          const lines = rowList(
            await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM PanelOrderLine WHERE mdf = ${rowidParam(r.ROWID)} AND deleted_at is null`),
          );
          for (const l of lines) {
            await ds.table("PanelOrderLine").updateRow({ ROWID: l.ROWID, mdf: to });
            repointed++;
          }
          await ds.table("Mdf").updateRow({ ROWID: r.ROWID, deleted_at: stamp });
          merged++;
        }
        return { rowid: null, data: { kept, merged, repointed } };
      },
    );
    res.json({ ok: true, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Cut-piece stock ledger (CR-306…308). CutPieceStock.qty stays the cached
   on-hand per (design, cut size) and the row IS the cut-piece ITEM (CR-306:
   weight_kg; qty 0 = defined, nothing on hand — "in the Panel module" means
   the design has at least one such row). Every movement also writes a dated
   CutStockEntry row: receipt (bulk Add Stock), adjustment (signed, reason
   mandatory), order_ready / order_dispatch (panel-order lifecycle). Generic
   writes to both tables are refused (closes DF-02).
   ---------------------------------------------------------------- */
const CUT_ENTRY_KINDS = new Set(["receipt", "adjustment", "transfer"]); // transfer = CR-330
const todayDate = () => new Date().toISOString().slice(0, 10);

/* The cut-piece item row for (design, cut size); created at qty 0 when missing. */
async function ensureCutPiece(catalyst, ds, designId, cutSizeId, extra = {}) {
  const d = rowidParam(designId);
  const c = rowidParam(cutSizeId);
  if (!d || !c) throw badRequest("design and cut_piece_size are required");
  const row = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, qty, weight_kg FROM CutPieceStock WHERE design = ${d} AND cut_piece_size = ${c} AND deleted_at is null`,
    ),
  )[0];
  if (row) return row;
  const ins = await ds.table("CutPieceStock").insertRow({ design: d, cut_piece_size: c, qty: 0, ...extra });
  return { ROWID: String(ins.ROWID), qty: 0, weight_kg: extra.weight_kg == null ? null : extra.weight_kg, fresh: true };
}

async function designLabel(catalyst, designId) {
  const d = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT design_name, unique_name FROM Design WHERE ROWID = ${rowidParam(designId)}`),
  )[0];
  return d ? String(d.unique_name || d.design_name || designId) : String(designId);
}

/* Bulk stock movement (CR-307 receipt / CR-308 adjustment): one dated
   submission, N (design, cut size, qty) lines. Every deduction is verified
   before any write — all-or-nothing, the /panel-order-status rule.
   CR-414: a RECEIPT for a (design, cut size) pair that is not defined yet
   defines it (= imports the design into Panel Craft) with the line's
   optional weight_kg; a blank cut_piece_size on a receipt = the full size. */
app.post("/cut-stock-entry", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const kind = String(body.kind || "receipt");
    const result = await withOpLog(
      catalyst,
      { table_name: "CutPieceStock", operation: `entry-${kind}`, payload: body },
      async () => {
        if (!CUT_ENTRY_KINDS.has(kind)) throw badRequest("kind must be receipt, adjustment or transfer");
        // CR-446: entry_date / reason are PER LINE (the adjustment form); the body's are the fallbacks (receipts, transfers, older callers).
        const date0 = String(body.entry_date || "").trim() || todayDate();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date0)) throw badRequest("entry_date must be yyyy-mm-dd");
        const reason0 = String(body.reason || "").trim();
        const note = String(body.note || "").trim();
        // CR-329/330: warehouse of the count (null = primary), or the From / To pair of a transfer.
        const meta = await warehouseMeta(catalyst);
        const transferring = kind === "transfer";
        const pair = transferring ? transferPair(meta, body) : null;
        const validWh = (v) => (rowidParam(v) && meta.byId.has(rowidParam(v)) ? rowidParam(v) : null);
        const warehouse = !transferring ? validWh(body.warehouse) : null;
        // CR-438: a line may name its own location; the body's is the fallback (null = primary). Transfers keep the pair.
        const merged = new Map(); // design|cut|warehouse|date|reason → line (duplicates summed)
        const receiving = kind === "receipt";
        for (const l of Array.isArray(body.lines) ? body.lines : []) {
          const d = rowidParam(l && l.design);
          if (!d) throw badRequest("Every line needs an item");
          const c = rowidParam(l && l.cut_piece_size) || (receiving ? await fullSizeCutPiece(catalyst, ds, d) : null);
          if (!c) throw badRequest("Every line needs an item and a cut piece size");
          const wh = transferring ? null : validWh(l && l.warehouse) || warehouse;
          const date = String((l && l.entry_date) || "").trim() || date0;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("entry_date must be yyyy-mm-dd");
          const reason = String((l && l.reason) || "").trim() || reason0;
          if (!receiving && !reason) throw badRequest(transferring ? "A reason is required" : "Every line needs a reason");
          const q = Number(l.qty);
          if (!Number.isInteger(q) || q === 0 || (kind !== "adjustment" && q < 0))
            throw badRequest(kind !== "adjustment" ? "qty must be a positive whole number" : "qty must be a non-zero whole number");
          const w = !receiving || l.weight_kg === "" || l.weight_kg == null ? null : Number(l.weight_kg);
          if (w != null && (!isFinite(w) || w < 0)) throw badRequest("weight_kg must be 0 or more");
          const k = `${d}|${c}|${wh || ""}|${date}|${reason}`;
          const cur = merged.get(k) || { d, c, wh, date, reason, qty: 0, note: "", weight: null };
          cur.qty += q;
          if (l.note) cur.note = String(l.note).trim();
          if (w != null) cur.weight = w;
          merged.set(k, cur);
        }
        if (!merged.size) throw badRequest("Add at least one line");
        // CR-312/487: a removal may never dip below what open panel + sample orders have booked — booking is the dispatch gate.
        const booked = [...merged.values()].some((m) => m.qty < 0) ? await otherAllocations(catalyst, null) : new Map();
        // The booking gate is location-agnostic: sum every line of a pair across locations (CR-438).
        const byPair = new Map();
        for (const m of merged.values()) {
          const k = `${m.d}|${m.c}`;
          const cur = byPair.get(k) || { d: m.d, c: m.c, qty: 0 };
          cur.qty += m.qty;
          byPair.set(k, cur);
        }
        for (const m of byPair.values()) {
          if (m.qty >= 0) continue;
          const row = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT qty FROM CutPieceStock WHERE design = ${m.d} AND cut_piece_size = ${m.c} AND deleted_at is null`,
            ),
          )[0];
          const have = row ? Number(row.qty) || 0 : 0;
          if (have + m.qty < 0) throw badRequest(`Only ${have} pcs on hand of ${await designLabel(catalyst, m.d)} for that cut size`, 409);
          const b = booked.get(`${m.d}|${m.c}`) || 0;
          if (have + m.qty < b)
            throw badRequest(`Only ${have - b} pcs free of ${await designLabel(catalyst, m.d)} for that cut size — ${b} are booked by open orders`, 409);
        }
        // CR-329/330: a removal or a transfer may not exceed what THAT warehouse holds.
        // CR-446: netted PER BAY across the finer (date · reason) lines.
        const bays = new Map();
        for (const m of merged.values()) {
          const k = `${m.d}|${m.c}|${m.wh || ""}`;
          const cur = bays.get(k) || { d: m.d, c: m.c, wh: m.wh, qty: 0 };
          cur.qty += m.qty;
          bays.set(k, cur);
        }
        if (meta.list.length)
          for (const m of bays.values()) {
            const out = transferring ? m.qty : -m.qty;
            if (out <= 0) continue;
            const takeFrom = transferring ? pair.from : m.wh || meta.primary;
            const haveAt = Math.max(0, (await serverCutWarehouseOnHand(catalyst, m.d, m.c)).cells.get(`|${takeFrom}`) || 0);
            if (out > haveAt) throw badRequest(`Only ${haveAt} pcs of ${await designLabel(catalyst, m.d)} for that cut size${atWarehouse(meta, takeFrom)}`, 409);
          }
        const actor = await currentActor(catalyst);
        const code = transferring ? await nextTransferNumber(catalyst) : "";
        let n = 0;
        for (const m of merged.values()) {
          const base = { kind, entry_date: m.date, reason: m.reason, note: m.note || note, performed_by: actor, weight_kg: m.weight };
          if (transferring) {
            // A pair of ledger rows (−from / +to) sharing the TRF code; CutPieceStock.qty nets to zero.
            await adjustCutStock(catalyst, ds, m.d, m.c, -m.qty, { ...base, warehouse: pair.from, doc_number: code });
            await adjustCutStock(catalyst, ds, m.d, m.c, m.qty, { ...base, warehouse: pair.to, doc_number: code });
          } else {
            await adjustCutStock(catalyst, ds, m.d, m.c, m.qty, { ...base, warehouse: m.wh });
          }
          n++;
        }
        return { rowid: null, data: { lines: n, ...(code ? { code } : {}) } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-306: the cut-piece ITEM — upsert its weight for (design, cut size).
   A blank cut_piece_size = the design's full size (CR-289 rule). qty is
   never touched here; stock moves only via /cut-stock-entry and orders
   (CR-414: a receipt defines a missing pair itself, so this is the
   "define at 0 pcs" path only). */
app.post("/cut-piece-save", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const result = await withOpLog(
      catalyst,
      { table_name: "CutPieceStock", operation: "cut-piece-save", payload: body },
      async () => {
        const d = rowidParam(body.design);
        if (!d) throw badRequest("design is required");
        const c = rowidParam(body.cut_piece_size) || (await fullSizeCutPiece(catalyst, ds, d));
        const weight = body.weight_kg === "" || body.weight_kg == null ? null : Number(body.weight_kg);
        if (weight != null && (!isFinite(weight) || weight < 0)) throw badRequest("weight_kg must be 0 or more");
        const row = await ensureCutPiece(catalyst, ds, d, c, weight != null ? { weight_kg: weight } : {});
        if (weight != null && !row.fresh) await ds.table("CutPieceStock").updateRow({ ROWID: row.ROWID, weight_kg: weight });
        return { rowid: String(row.ROWID), data: { ROWID: String(row.ROWID), cut_piece_size: c } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-306: remove a cut-piece item — only when nothing is on hand and no
   panel line uses the pair. Reason mandatory (delete-reason standard). */
app.post("/cut-piece-delete", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const reason = deleteReason(req, "CutPieceStock");
    const result = await withOpLog(
      catalyst,
      { table_name: "CutPieceStock", operation: "soft-delete", payload: { ...body, reason } },
      async () => {
        const d = rowidParam(body.design);
        const c = rowidParam(body.cut_piece_size);
        if (!d || !c) throw badRequest("design and cut_piece_size are required");
        const row = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, qty FROM CutPieceStock WHERE design = ${d} AND cut_piece_size = ${c} AND deleted_at is null`,
          ),
        )[0];
        if (!row) throw badRequest("Cut piece not found", 404);
        if ((Number(row.qty) || 0) > 0) throw badRequest(`Still ${row.qty} pcs on hand — adjust the stock to 0 first`, 409);
        const used = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID FROM PanelLine WHERE design = ${d} AND cut_piece_size = ${c} AND deleted_at is null LIMIT 1`,
          ),
        );
        if (used.length) throw badRequest("Cannot remove — a showcase panel uses this cut piece. Edit that panel first.", 409);
        await ds.table("CutPieceStock").updateRow({ ROWID: row.ROWID, deleted_at: stampNow() });
        return { rowid: String(row.ROWID), data: { ROWID: String(row.ROWID) } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Panel save / delete (2026-08-27): a Panel is pure master data — a
   spec of the cut pieces it needs, never a stock movement. CutPieceStock
   moves only via /panel-order-status (Ready +, Dispatched −) and the
   /cut-stock-entry ledger (CR-307). Generic writes to PanelLine (and soft Panel
   deletes) are still rejected so lines only change through here.
   ---------------------------------------------------------------- */
/* Panel numbers PANEL-001… (CR-280) — max numeric suffix + 1 over every Panel
   row (soft-deleted included, so a number is never reused). ponytail: MAX-scan
   like nextOrderNumber; assertUnique below is the race backstop. */
async function nextPanelCode(catalyst) {
  const rows = rowList(await catalyst.zcql().executeZCQLQuery("SELECT panel_code FROM Panel"));
  let max = 0;
  for (const r of rows) {
    const m = /^PANEL-(\d+)$/.exec(String(r.panel_code || ""));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `PANEL-${String(max + 1).padStart(3, "0")}`;
}

/* CR-289: a line with NO cut piece size means a full-size piece — the design's
   own Size. Resolve it to the CutPieceSize row whose name is the Size code
   (created on first use), so stock and orders key on one row per size. */
async function fullSizeCutPiece(catalyst, ds, designId) {
  const d = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT size FROM Design WHERE ROWID = ${rowidParam(designId)}`),
  )[0];
  const sz = d && d.size
    ? rowList(await catalyst.zcql().executeZCQLQuery(`SELECT code FROM Size WHERE ROWID = ${rowidParam(d.size)}`))[0]
    : null;
  const code = String((sz && sz.code) || "").trim();
  if (!code) throw badRequest("Pick a cut piece size — this design has no size to default to");
  const hit = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID FROM CutPieceSize WHERE name = '${code.replace(/'/g, "''")}' AND deleted_at is null`,
    ),
  )[0];
  if (hit) return String(hit.ROWID);
  return String((await ds.table("CutPieceSize").insertRow({ name: code })).ROWID);
}

app.post("/panel-save", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const rowid = body.rowid ? rowidParam(body.rowid) : null;
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const header = {
      panel_code: String(body.panel_code || "").trim(),
      panel_size: String(body.panel_size || "").trim(),
      vinyl_size: String(body.vinyl_size || "").trim(),
      mdf_size: String(body.mdf_size || "").trim(), // CR-344: the panel's MDF size — matches Mdf.size on the size-keyed master
      remarks: String(body.remarks || "").trim(), // CR-425: free text, e.g. the old reference ID
    };
    const result = await withOpLog(
      catalyst,
      { table_name: "Panel", operation: rowid ? "update" : "insert", payload: body },
      async () => {
        // Create / clone send a blank code → the server assigns the next PANEL-NNN.
        if (!rowid && !header.panel_code) header.panel_code = await nextPanelCode(catalyst);
        if (!header.panel_code) throw badRequest("panel_code is required");
        for (const l of lines) {
          if (!rowidParam(l.design)) throw badRequest("Every line needs a design");
          const q = Number(l.cut_piece_qty);
          if (!Number.isInteger(q) || q <= 0) throw badRequest("cut_piece_qty must be a positive integer");
          // CR-289: blank cut size → the design's full size.
          if (!rowidParam(l.cut_piece_size)) l.cut_piece_size = await fullSizeCutPiece(catalyst, ds, l.design);
        }
        await assertUnique(catalyst, "Panel", "panel_code", header.panel_code, rowid);
        if (rowid) {
          const panel = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ROWID FROM Panel WHERE ROWID = ${rowid} AND deleted_at is null`,
            ),
          )[0];
          if (!panel) throw badRequest(`Panel not found: ${rowid}`, 404);
        }
        const old = rowid
          ? rowList(
              await catalyst.zcql().executeZCQLQuery(
                `SELECT ROWID, design, cut_piece_size, cut_piece_qty FROM PanelLine WHERE panel = ${rowid} AND deleted_at is null`,
              ),
            )
          : [];
        let id = rowid;
        if (id) await ds.table("Panel").updateRow({ ROWID: id, ...header });
        else id = String((await ds.table("Panel").insertRow(header)).ROWID);
        const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
        for (const l of old) await ds.table("PanelLine").updateRow({ ROWID: l.ROWID, deleted_at: stamp });
        if (lines.length)
          await ds.table("PanelLine").insertRows(
            lines.map((l) => ({
              panel: id,
              design: rowidParam(l.design),
              cut_piece_size: rowidParam(l.cut_piece_size),
              cut_piece_qty: Number(l.cut_piece_qty) || 0,
            })),
          );
        // CR-306: a pair used on a panel is a cut-piece item — make sure it shows under the item (qty 0).
        for (const l of lines) await ensureCutPiece(catalyst, ds, l.design, l.cut_piece_size);
        return { rowid: id, data: { ROWID: id } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Soft-delete a panel + its lines. No stock movement — panels are master data. */
app.post("/panel-delete/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rid = rowidParam(req.params.rowid);
    const reason = deleteReason(req, "Panel");
    const result = await withOpLog(
      catalyst,
      { table_name: "Panel", operation: "soft-delete", payload: { rowid: rid, reason } },
      async () => {
        const panel = rowList(
          await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM Panel WHERE ROWID = ${rid} AND deleted_at is null`),
        )[0];
        if (!panel) throw badRequest(`Panel not found: ${rid}`, 404);
        // CR-302: orders reference panels through their lines.
        const orders = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID FROM PanelOrderLine WHERE panel = ${rid} AND deleted_at is null LIMIT 1`,
          ),
        );
        if (orders.length)
          throw badRequest("Cannot delete — still used by panel order. Remove or reassign those first.", 409);
        const lines = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID FROM PanelLine WHERE panel = ${rid} AND deleted_at is null`,
          ),
        );
        const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
        for (const l of lines) await ds.table("PanelLine").updateRow({ ROWID: l.ROWID, deleted_at: stamp });
        await ds.table("Panel").updateRow({ ROWID: rid, deleted_at: stamp });
        return { rowid: rid, data: { ROWID: rid } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Top up a partially-filled physical pallet: move body.boxes from a Planning
   donor line onto the target line's pallet. The moved slice enters Palletizing
   on the target's pallet and BOTH lines get pallet_group = target ROWID — the
   board's "Mix Batch" marker (any same-size item/batch may share the pallet). */
app.post("/pal-topup/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const targetId = String(req.params.rowid).replace(/[^0-9]/g, "");
    const donorId = String((req.body || {}).donor_line || "").replace(/[^0-9]/g, "");
    const n = Number((req.body || {}).boxes);
    const result = await withOpLog(
      catalyst,
      { table_name: "PalletizationPlanLine", operation: "topup", payload: { ROWID: targetId, donor_line: donorId, boxes: n } },
      async () => {
        if (!donorId) throw badRequest("donor_line is required", 400);
        if (donorId === targetId) throw badRequest("A line cannot top up itself", 400);
        if (!Number.isInteger(n) || n <= 0) throw badRequest("boxes must be a positive integer");
        const pick = async (id) =>
          rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ROWID, status, plan, sales_order, order_item, design, pallet, boxes, position, batch_number, manual_edit, box_brand, warehouse FROM PalletizationPlanLine WHERE ROWID = ${id} AND deleted_at is null`,
            ),
          )[0];
        const target = await pick(targetId);
        if (!target) throw badRequest(`Palletization line not found: ${targetId}`, 404);
        if (String(target.status) !== "Palletizing")
          throw badRequest("The top-up target must be in Palletization", 409);
        if (!String(target.pallet || "")) throw badRequest("The top-up target has no pallet", 409);
        const donor = await pick(donorId);
        if (!donor) throw badRequest(`Palletization line not found: ${donorId}`, 404);
        if (String(donor.status) !== "Planning")
          throw badRequest("Only a Ready-for-Palletization item can top up a pallet", 409);
        const donorBoxes = Number(donor.boxes) || 0;
        if (n > donorBoxes) throw badRequest("Cannot move more boxes than the donor line has");

        const group = String(target.ROWID);
        if (n === donorBoxes) {
          // Whole line rides along — no split needed.
          await ds.table("PalletizationPlanLine").updateRow({
            ROWID: donorId, status: "Palletizing", pallet: String(target.pallet), pallet_group: group,
            // CR-412: the boxes join the target's physical pallet, so they stand where it stands.
            ...(target.warehouse ? { warehouse: String(target.warehouse) } : {}),
          });
          await logTransition(catalyst, {
            entity_type: "PalletizationPlanLine", entity_rowid: donorId, from_status: "Planning", to_status: "Palletizing",
          });
        } else {
          // Split: insert the moved slice first, then shrink the donor — a
          // mid-write failure deletes the slice (same pattern as /pal-line-box).
          const slice = await ds.table("PalletizationPlanLine").insertRow({
            plan: donor.plan ? String(donor.plan) : undefined,
            sales_order: donor.sales_order ? String(donor.sales_order) : undefined,
            order_item: donor.order_item ? String(donor.order_item) : undefined,
            design: donor.design ? String(donor.design) : undefined,
            pallet: String(target.pallet),
            boxes: n,
            position: Number(donor.position) || 0,
            status: "Palletizing",
            batch_number: donor.batch_number ? String(donor.batch_number) : "",
            ...(donor.box_brand ? { box_brand: String(donor.box_brand) } : {}),
            pallet_group: group,
            ...(String(donor.manual_edit || "") === "true" ? { manual_edit: "true" } : {}),
            ...(target.warehouse ? { warehouse: String(target.warehouse) } : {}), // CR-412
          });
          try {
            await ds.table("PalletizationPlanLine").updateRow({ ROWID: donorId, boxes: donorBoxes - n });
          } catch (e) {
            try { await ds.table("PalletizationPlanLine").deleteRow(slice.ROWID); } catch (_) {}
            throw e;
          }
          await logTransition(catalyst, {
            entity_type: "PalletizationPlanLine", entity_rowid: String(slice.ROWID), from_status: "Planning", to_status: "Palletizing",
          });
        }
        // The target carries the marker too, so both ends of the shared pallet show it.
        await ds.table("PalletizationPlanLine").updateRow({ ROWID: targetId, pallet_group: group });
        await recountOrderItems(catalyst, ds, [donor.order_item]);
        return { rowid: targetId, data: { ROWID: targetId, pallet_group: group } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Assign (or reassign) a vehicle to a plan at the "In Loading" step. Split out of
   /pal-status so entering In Loading no longer gates on a vehicle — the vehicle is
   captured here, and /pal-status requires it before dispatch (Completed). */
app.post("/pal-vehicle/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const planId = req.params.rowid;
    const vehicle = (req.body || {}).vehicle ? String((req.body || {}).vehicle) : "";
    const result = await withOpLog(
      catalyst,
      { table_name: "PalletizationPlan", operation: "vehicle-assign", payload: { ROWID: planId, vehicle } },
      async () => {
        if (!vehicle) throw badRequest("A vehicle is required", 400);
        const rows = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, status FROM PalletizationPlan WHERE ROWID = ${planId}`,
          ),
        );
        if (!rows.length) throw badRequest(`Palletization plan not found: ${planId}`, 404);
        if (String(rows[0].status || "") !== "Loading")
          throw badRequest("A vehicle can only be assigned while the plan is In Loading", 409);
        await ds.table("PalletizationPlan").updateRow({ ROWID: planId, vehicle });
        return { rowid: planId, data: { ROWID: planId, vehicle } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ================================================================
   Load boxes — cross-plan vehicle slots ("boxes") that Ready-for-Loading
   lines are dragged into on the board. A box is created empty (Open),
   lines allocate via /pal-line-box, a vehicle attaches any time while
   Open, and the box dispatches as one unit. Plan status follows the
   boxes: first allocated line moves its plan Planning → Loading; a box
   dispatch completes every plan whose lines all sit in dispatched boxes.
   ================================================================ */

const boxIdParam = (v) => String(v).replace(/[^0-9]/g, "");

/** Next display number — MAX-scan like nextPalNumber (boxes are few). */
async function nextBoxNumber(catalyst) {
  const rows = rowList(await catalyst.zcql().executeZCQLQuery("SELECT box_number FROM LoadBox"));
  let max = 0;
  for (const r of rows) max = Math.max(max, Number(r.box_number) || 0);
  return max + 1;
}

/* Loading series LOAD/FY/NNN — the loading's own identity (boxes predating
   this column stay numberless; the client label falls back). The LIKE scope
   keeps the scan under ZCQL's 300-row cap. ZCQL's LIKE wildcard is `*`, not
   `%` (CR-209: `%` matched nothing, so every loading minted 001). */
async function nextLoadNumber(catalyst) {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Indian FY (Apr–Mar)
  const prefix = `LOAD/${y}-${String((y + 1) % 100).padStart(2, "0")}/`;
  const rows = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT load_number FROM LoadBox WHERE load_number LIKE '${prefix}*'`),
  );
  let max = 0;
  for (const r of rows) {
    const n = String(r.load_number || "");
    if (n.startsWith(prefix)) max = Math.max(max, parseInt(n.slice(prefix.length), 10) || 0);
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

async function getBox(catalyst, boxId) {
  const rows = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, box_number, load_number, status, vehicle, capacity, dispatch_date, container_number FROM LoadBox WHERE ROWID = ${boxId} AND deleted_at is null`,
    ),
  );
  if (!rows.length) throw badRequest(`Container not found: ${boxId}`, 404);
  return rows[0];
}

/** Non-deleted lines allocated to a box. */
async function boxLines(catalyst, boxId) {
  return rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, plan, sales_order, order_item, boxes FROM PalletizationPlanLine WHERE load_box = ${boxId} AND deleted_at is null`,
    ),
  );
}

/* Loading-capture fields entered at the box (container identity + seals +
   transport paperwork). Copies any present field from the request body onto a
   LoadBox patch. Shared by /load-box (container-first create), /load-box-update
   (advance entry) and /load-box-dispatch (last-minute) so data entered at any
   point is persisted. */
const LOAD_BOX_FIELDS = [
  "name", // CR-333: free container name the floor gives a loading
  "container_number", "line_seal", "electronic_seal", "loading_supervisor",
  "container_size", "transporter", "lr_number", "destination",
];
function applyLoadBoxFields(patch, body) {
  for (const f of LOAD_BOX_FIELDS) {
    if (body[f] === undefined) continue;
    // CR-429: people's names are stored Title Case; container / seal / LR numbers stay as typed.
    patch[f] = f === "loading_supervisor" || f === "transporter" ? titleCase(body[f]) : String(body[f] || "").trim();
  }
  // CR-273: the Container Master format this loading uses (FK → ContainerFormat; "" clears).
  if (body.container_format !== undefined) patch.container_format = String(body.container_format || "").trim() || null;
  return patch;
}

/** Flip a plan's status directly (box flow owns the lifecycle) + audit. */
async function setPlanStatus(catalyst, ds, planId, from, to, extra) {
  await ds.table("PalletizationPlan").updateRow({ ROWID: planId, status: to, ...(extra || {}) });
  await logTransition(catalyst, {
    entity_type: "PalletizationPlan", entity_rowid: String(planId), from_status: from, to_status: to,
  });
}

app.post("/load-box", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    // Advisory only — fill % is measured against the lines' pallet capacity client-side.
    const capacity = Number(body.capacity) || 0;
    const result = await withOpLog(
      catalyst,
      { table_name: "LoadBox", operation: "insert", payload: body },
      async () => {
        const boxNumber = await nextBoxNumber(catalyst);
        const loadNumber = await nextLoadNumber(catalyst);
        // Container-first create: the load modal captures the vehicle, container
        // identity and paperwork up front, so the box lands complete in one call.
        const row = { box_number: boxNumber, load_number: loadNumber, status: "Open", capacity };
        if (String(body.vehicle || "")) row.vehicle = String(body.vehicle);
        if (String(body.dispatch_date || "")) row.dispatch_date = String(body.dispatch_date).slice(0, 10);
        // Loading-plan JSON (advisory, like Quote/SO container_plan) — capped to the column.
        if (typeof body.load_plan === "string") row.load_plan = body.load_plan.slice(0, 10000);
        applyLoadBoxFields(row, body);
        const inserted = await ds.table("LoadBox").insertRow(row);
        return { rowid: inserted.ROWID, data: { ROWID: inserted.ROWID, box_number: boxNumber, load_number: loadNumber } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Mint (or return the existing) share token for a box's public QR label.
   Idempotent, works for Open or Dispatched boxes. The token keys the
   unauthenticated GET /public/pallet/:token read above. */
app.post("/load-box-share/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const boxId = boxIdParam(req.params.rowid);
    const box = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT ROWID, share_token FROM LoadBox WHERE ROWID = ${boxId} AND deleted_at is null`,
      ),
    )[0];
    if (!box) throw badRequest(`Container not found: ${boxId}`, 404);
    let token = String(box.share_token || "");
    if (!token) {
      token = crypto.randomBytes(16).toString("hex");
      await ds.table("LoadBox").updateRow({ ROWID: boxId, share_token: token });
    }
    res.json({ ok: true, data: token });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Mint (or return the existing) share token for a production batch record's
   public QR slip. Idempotent; record rows only. Keys GET /public/batch/:token. */
app.post("/production-record-share/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const recId = rowidParam(req.params.rowid);
    const rec = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT ROWID, share_token, entry_type FROM ProductionLog WHERE ROWID = ${recId} AND deleted_at is null`,
      ),
    )[0];
    if (!rec) throw badRequest(`Production record not found: ${recId}`, 404);
    if (String(rec.entry_type) !== "record") throw badRequest("Only a batch record can have a QR slip", 409);
    let token = String(rec.share_token || "");
    if (!token) {
      token = crypto.randomBytes(16).toString("hex");
      await ds.table("ProductionLog").updateRow({ ROWID: recId, share_token: token });
    }
    res.json({ ok: true, data: token });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Assign/reassign the vehicle or adjust capacity — only while the box is Open. */
app.post("/load-box-update/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const boxId = boxIdParam(req.params.rowid);
    const body = req.body || {};
    const result = await withOpLog(
      catalyst,
      { table_name: "LoadBox", operation: "update", payload: { ROWID: boxId, ...body } },
      async () => {
        // Details stay editable after dispatch (late LR numbers, corrections);
        // getBox still 404s deleted boxes.
        await getBox(catalyst, boxId);
        const patch = { ROWID: boxId };
        if (body.vehicle !== undefined) {
          if (!String(body.vehicle || "")) throw badRequest("A vehicle is required", 400);
          patch.vehicle = String(body.vehicle);
        }
        if (body.capacity !== undefined) {
          const cap = Number(body.capacity) || 0;
          if (cap <= 0) throw badRequest("Capacity must be > 0", 400);
          patch.capacity = cap;
        }
        // Planned dispatch date, editable while Open ("" clears it back to
        // auto-stamp-on-dispatch).
        if (body.dispatch_date !== undefined) patch.dispatch_date = String(body.dispatch_date || "").slice(0, 10) || null;
        // Loading-plan JSON (advisory) — capped to the column; "" clears it.
        if (typeof body.load_plan === "string") patch.load_plan = body.load_plan.slice(0, 10000);
        applyLoadBoxFields(patch, body);
        await ds.table("LoadBox").updateRow(patch);
        return { rowid: boxId, data: { ROWID: boxId } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Remove an Open box — its lines fall back to Ready for Loading (unallocated). */
app.post("/load-box-delete/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const boxId = boxIdParam(req.params.rowid);
    const reason = deleteReason(req, "LoadBox");
    const result = await withOpLog(
      catalyst,
      { table_name: "LoadBox", operation: "delete", payload: { ROWID: boxId, reason } },
      async () => {
        const box = await getBox(catalyst, boxId);
        if (String(box.status) !== "Open") throw badRequest("A dispatched container cannot be removed", 409);
        const lines = await boxLines(catalyst, boxId);
        for (const l of lines) await ds.table("PalletizationPlanLine").updateRow({ ROWID: l.ROWID, load_box: null });
        // Plans left with no allocated lines drop back from Loading to Planning.
        await demoteEmptyPlans(catalyst, ds, [...new Set(lines.map((l) => String(l.plan)))]);
        const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
        await ds.table("LoadBox").updateRow({ ROWID: boxId, deleted_at: stamp });
        await recountOrderItems(catalyst, ds, lines.map((l) => l.order_item));
        return { rowid: boxId, data: { ROWID: boxId } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/** Plans in `planIds` that are Loading but have no allocated lines → Planning. */
async function demoteEmptyPlans(catalyst, ds, planIds) {
  for (const planId of planIds.filter(Boolean)) {
    const plan = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT ROWID, status FROM PalletizationPlan WHERE ROWID = ${planId}`,
      ),
    )[0];
    if (!plan || String(plan.status) !== "Loading") continue;
    const left = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT ROWID FROM PalletizationPlanLine WHERE plan = ${planId} AND load_box is not null AND deleted_at is null`,
      ),
    );
    if (!left.length) await setPlanStatus(catalyst, ds, planId, "Loading", "Planning");
  }
}

/* Dispatch a box — needs a vehicle and at least one line. Completes every plan
   whose non-deleted lines now all sit in dispatched boxes. */
app.post("/load-box-dispatch/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const boxId = boxIdParam(req.params.rowid);
    const result = await withOpLog(
      catalyst,
      { table_name: "LoadBox", operation: "dispatch", payload: { ROWID: boxId } },
      async () => {
        const box = await getBox(catalyst, boxId);
        if (String(box.status) !== "Open") throw badRequest("Container is already dispatched", 409);
        if (!String(box.vehicle || "")) throw badRequest("Assign a vehicle before dispatch", 400);
        const lines = await boxLines(catalyst, boxId);
        if (!lines.length) throw badRequest("An empty container cannot be dispatched", 400);
        // A date entered on the container (load form / Confirm Load) wins; only
        // an unset one falls back to today (IST).
        const dispatchDate =
          String(box.dispatch_date || "").slice(0, 10) ||
          new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
        // Persist any last-minute loading-capture fields entered at dispatch.
        const dispatchPatch = applyLoadBoxFields({ ROWID: boxId, status: "Dispatched", dispatch_date: dispatchDate }, req.body || {});
        await ds.table("LoadBox").updateRow(dispatchPatch);
        await logTransition(catalyst, {
          entity_type: "LoadBox", entity_rowid: boxId, from_status: "Open", to_status: "Dispatched",
        });
        // Cascade to the SALES ORDER items: audit events, then recount from
        // ground truth (box is already Dispatched, so counts land correctly).
        const addByOi = new Map();
        for (const l of lines) {
          const oiId = String(l.order_item || "");
          if (oiId) addByOi.set(oiId, (addByOi.get(oiId) || 0) + (Number(l.boxes) || 0));
        }
        for (const [oiId, addQty] of addByOi) {
          await ds.table("OrderItemEvent").insertRow({
            order_item: oiId,
            event_type: "dispatched",
            qty_delta: addQty,
            performed_by: "",
            note: `${String(box.load_number || "") || `Container ${box.box_number}`} dispatched`,
          });
        }
        await recountOrderItems(catalyst, ds, [...addByOi.keys()]);
        // Complete plans whose lines are now all in dispatched boxes.
        const openBoxIds = new Set(
          rowList(
            await catalyst.zcql().executeZCQLQuery(
              "SELECT ROWID FROM LoadBox WHERE status = 'Open' AND deleted_at is null",
            ),
          ).map((b) => String(b.ROWID)),
        );
        for (const planId of [...new Set(lines.map((l) => String(l.plan)))].filter(Boolean)) {
          const planLines = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ROWID, load_box FROM PalletizationPlanLine WHERE plan = ${planId} AND deleted_at is null`,
            ),
          );
          const allDispatched =
            planLines.length > 0 &&
            planLines.every((l) => String(l.load_box || "") && !openBoxIds.has(String(l.load_box)));
          if (!allDispatched) continue;
          const plan = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ROWID, status FROM PalletizationPlan WHERE ROWID = ${planId}`,
            ),
          )[0];
          if (plan && String(plan.status) !== "Completed")
            await setPlanStatus(catalyst, ds, planId, String(plan.status || "Loading"), "Completed", { dispatch_date: dispatchDate });
        }
        // Surface the dispatch on every order and plan that had boxes on it.
        await logRelated(
          catalyst,
          [
            ...lines.map((l) => ({ table: "SalesOrder", rowid: l.sales_order })),
            ...lines.map((l) => ({ table: "PalletizationPlan", rowid: l.plan })),
          ],
          "dispatched",
          {
            boxes: lines.reduce((s, l) => s + (Number(l.boxes) || 0), 0),
            container: String(dispatchPatch.container_number || box.container_number || "") || String(box.load_number || "") || `Container ${box.box_number}`,
            dispatch_date: dispatchDate,
          },
        );
        return { rowid: boxId, data: { ROWID: boxId, status: "Dispatched", dispatch_date: dispatchDate } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Write one validated line into an Open box. n < the line's boxes = PARTIAL
   load: split — remainder first (stays Ready, unloaded) so a mid-write failure
   leaves state recoverable; then shrink + load the original. */
async function writeLineIntoBox(ds, line, boxRowid, n) {
  const lineId = String(line.ROWID);
  const lineBoxes = Number(line.boxes) || 0;
  if (n !== undefined && n < lineBoxes) {
    const rem = await ds.table("PalletizationPlanLine").insertRow({
      plan: String(line.plan || "") || undefined,
      sales_order: line.sales_order ? String(line.sales_order) : undefined,
      order_item: line.order_item ? String(line.order_item) : undefined,
      design: line.design ? String(line.design) : undefined,
      pallet: line.pallet ? String(line.pallet) : undefined,
      boxes: lineBoxes - n,
      position: Number(line.position) || 0,
      status: "ReadyToLoad",
      batch_number: line.batch_number ? String(line.batch_number) : "",
      // The production carton (CR-197) stays with both halves of a split;
      // pallet_no is deliberately NOT copied — a typed range belongs to one line.
      ...(line.box_brand ? { box_brand: String(line.box_brand) } : {}),
      ...(String(line.manual_edit || "") === "true" ? { manual_edit: "true" } : {}),
      // CR-412: the un-loaded remainder still stands where the pallet stood.
      ...(line.warehouse ? { warehouse: String(line.warehouse) } : {}),
    });
    try {
      await ds.table("PalletizationPlanLine").updateRow({ ROWID: lineId, boxes: n, load_box: boxRowid });
    } catch (e) {
      try { await ds.table("PalletizationPlanLine").deleteRow(rem.ROWID); } catch (_) {}
      throw e;
    }
    // CR-301: the caller (a multi-container save) needs the remainder's id to load the rest elsewhere.
    return String(rem.ROWID);
  }
  await ds.table("PalletizationPlanLine").updateRow({ ROWID: lineId, load_box: boxRowid });
  return null;
}

/* First allocation pulls a Planning plan into Loading. */
async function promotePlansToLoading(catalyst, ds, planIds) {
  for (const planId of planIds) {
    if (!planId) continue;
    const plan = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT ROWID, status FROM PalletizationPlan WHERE ROWID = ${planId}`,
      ),
    )[0];
    if (plan && String(plan.status) === "Planning")
      await setPlanStatus(catalyst, ds, planId, "Planning", "Loading");
  }
}

/* Batch allocate: several Ready lines into ONE Open box in one call.
   body: { box, lines: [{ id, boxes? }] }. Validates the box and EVERY line
   before any write — one bad line rejects the whole batch. */
app.post("/pal-lines-box", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const toBox = boxIdParam(String((req.body || {}).box || ""));
    const entries = Array.isArray((req.body || {}).lines) ? (req.body || {}).lines : [];
    if (!entries.length) throw badRequest("lines is required");
    const result = await withOpLog(
      catalyst,
      { table_name: "PalletizationPlanLine", operation: "box-allocate-batch", payload: { box: toBox, lines: entries } },
      async () => {
        const box = await getBox(catalyst, toBox);
        if (String(box.status) !== "Open") throw badRequest("That container is already dispatched", 409);
        const ids = entries.map((e) => boxIdParam(String((e || {}).id || "")));
        const byId = new Map(
          rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ROWID, status, plan, load_box, sales_order, order_item, design, pallet, boxes, position, batch_number, manual_edit, box_brand, warehouse FROM PalletizationPlanLine WHERE ROWID IN (${ids.join(",")}) AND deleted_at is null`,
            ),
          ).map((r) => [String(r.ROWID), r]),
        );
        // All-or-nothing gate: every line checked before the first write.
        const jobs = entries.map((e, i) => {
          const line = byId.get(ids[i]);
          if (!line) throw badRequest(`Palletization line not found: ${ids[i]}`, 404);
          if (String(line.load_box || "")) throw badRequest("An item is already loaded into a container", 409);
          if (String(line.status) !== "ReadyToLoad")
            throw badRequest("Only a Ready-for-Loading item can be loaded into a container", 409);
          let n;
          if (e.boxes !== undefined) {
            n = Number(e.boxes);
            if (!Number.isInteger(n) || n <= 0) throw badRequest("boxes must be a positive integer");
            if (n > (Number(line.boxes) || 0)) throw badRequest("Cannot load more boxes than the line has");
          }
          return { line, n };
        });
        // CR-301: per entry (same order) the Ready remainder a partial load split off, null when whole.
        const remainders = [];
        for (const { line, n } of jobs) remainders.push({ id: String(line.ROWID), remainder: await writeLineIntoBox(ds, line, String(box.ROWID), n) });
        await promotePlansToLoading(catalyst, ds, [...new Set(jobs.map(({ line }) => String(line.plan || "")))]);
        await recountOrderItems(catalyst, ds, [...new Set(jobs.map(({ line }) => line.order_item))]);
        // One "loaded" event per owning order + plan (deduped).
        const targets = new Map();
        for (const { line } of jobs) {
          if (line.sales_order) targets.set(`SO${line.sales_order}`, { table: "SalesOrder", rowid: line.sales_order });
          if (line.plan) targets.set(`PP${line.plan}`, { table: "PalletizationPlan", rowid: String(line.plan) });
        }
        await logRelated(catalyst, [...targets.values()], "loaded", {
          boxes: jobs.reduce((s, { line, n }) => s + (n !== undefined ? n : Number(line.boxes) || 0), 0),
          box: String(box.ROWID),
        });
        return { rowid: String(box.ROWID), data: { ROWID: String(box.ROWID), lines: jobs.length, remainders } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Allocate a Ready line into an Open box (body.box), or pull it back out
   (body.box = ""). Optional body.boxes < the line's boxes = PARTIAL load: the
   line is split — the requested count loads, a remainder line stays Ready.
   Keeps the owning plan's status in step. */
app.post("/pal-line-box/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const lineId = boxIdParam(req.params.rowid);
    const toBox = String((req.body || {}).box || "");
    const reqBoxes = (req.body || {}).boxes;
    const result = await withOpLog(
      catalyst,
      // CR-334: an unload from the Loading Workspace carries the user's removal reason — audited like a delete.
      { table_name: "PalletizationPlanLine", operation: "box-allocate", payload: { ROWID: lineId, box: toBox, boxes: reqBoxes, reason: String((req.body || {}).reason || "") } },
      async () => {
        const line = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, status, plan, load_box, sales_order, order_item, design, pallet, boxes, position, batch_number, manual_edit, box_brand, warehouse FROM PalletizationPlanLine WHERE ROWID = ${lineId} AND deleted_at is null`,
          ),
        )[0];
        if (!line) throw badRequest(`Palletization line not found: ${lineId}`, 404);
        const planId = String(line.plan || "");
        // A line already in a dispatched box is immutable.
        if (String(line.load_box || "")) {
          const cur = await getBox(catalyst, String(line.load_box));
          if (String(cur.status) !== "Open") throw badRequest("This item is already dispatched", 409);
        }
        if (toBox) {
          if (String(line.status) !== "ReadyToLoad")
            throw badRequest("Only a Ready-for-Loading item can be loaded into a container", 409);
          const box = await getBox(catalyst, boxIdParam(toBox));
          if (String(box.status) !== "Open") throw badRequest("That container is already dispatched", 409);
          const lineBoxes = Number(line.boxes) || 0;
          let n;
          if (reqBoxes !== undefined) {
            n = Number(reqBoxes);
            if (!Number.isInteger(n) || n <= 0) throw badRequest("boxes must be a positive integer");
            if (n > lineBoxes) throw badRequest("Cannot load more boxes than the line has");
          }
          await writeLineIntoBox(ds, line, String(box.ROWID), n);
          await promotePlansToLoading(catalyst, ds, [planId]);
        } else {
          await ds.table("PalletizationPlanLine").updateRow({ ROWID: lineId, load_box: null });
          if (planId) await demoteEmptyPlans(catalyst, ds, [planId]);
        }
        await recountOrderItems(catalyst, ds, [line.order_item]);
        // Show the load/unload on the owning order and palletization plan.
        await logRelated(
          catalyst,
          [{ table: "SalesOrder", rowid: line.sales_order }, { table: "PalletizationPlan", rowid: planId }],
          toBox ? "loaded" : "unloaded",
          { boxes: reqBoxes !== undefined ? Number(reqBoxes) : Number(line.boxes) || 0, box: toBox || "" },
        );
        return { rowid: lineId, data: { ROWID: lineId, load_box: toBox || null } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* CR-361 — Release palletized boxes (body: { boxes?, reason }). ONE route,
   two directions decided by the line itself:
     · line in an OPEN box  → the boxes leave the container and return to
       Ready for Loading (partial = the existing load split, remainder un-boxed);
     · un-boxed ReadyToLoad → the boxes leave the palletization altogether and
       return to FREE STOCK: the line shrinks / soft-deletes and the order's
       allocation is returned through deallocateCore (user decision 2026-10-21).
   A dispatched box is immutable; Planning / Palletizing lines keep their own
   paths (drag back, partial Complete). Reason mandatory unless Admin (CR-270). */
/* CR-369: the "→ free stock" half of a release, shared by /pal-line-release (any stage),
   palletization delete (CR-370) and SO cancel (CR-371). line = a live PalletizationPlanLine
   row with PAL_LINE_RELEASE_COLS; n = boxes to return (≤ line.boxes). Verifies the order
   item's allocation covers n BEFORE writing; shrinks / soft-deletes the line, recounts (so
   palletized_qty drops first), then deallocates same-batch-first. A line with no order item
   holds no allocation — it is simply dropped. */
const PAL_LINE_RELEASE_COLS = "ROWID, status, plan, load_box, sales_order, order_item, design, pallet, boxes, position, batch_number, manual_edit, box_brand, pallet_group";
async function releaseLineToStock(catalyst, ds, line, n, reason) {
  const lineId = String(line.ROWID);
  const lineBoxes = Number(line.boxes) || 0;
  const oiId = String(line.order_item || "");
  const planId = String(line.plan || "");
  const refs = [{ table: "SalesOrder", rowid: line.sales_order }, { table: "PalletizationPlan", rowid: planId }];
  const deletedAt = stampNow();
  const shrink = () => ds.table("PalletizationPlanLine").updateRow(n >= lineBoxes ? { ROWID: lineId, deleted_at: deletedAt } : { ROWID: lineId, boxes: lineBoxes - n });
  if (!oiId || n <= 0) { await shrink(); return { to: "stock", boxes: n }; }
  const batch = String(line.batch_number || "");
  const allocs = (await zcqlAllRows(
    catalyst,
    `SELECT ROWID, batch_number, qty_boxes FROM ProductionLog WHERE order_item = ${oiId} AND entry_type = 'alloc' AND deleted_at is null`,
  ))
    .map((a) => ({ id: String(a.ROWID), batch: String(a.batch_number || ""), qty: Number(a.qty_boxes) || 0 }))
    .filter((a) => a.qty > 0)
    // same batch first, then the rest; newest (highest ROWID) first within each group
    .sort((a, b) => (a.batch === batch ? 0 : 1) - (b.batch === batch ? 0 : 1) || (a.id < b.id ? 1 : -1));
  const allocated = allocs.reduce((s, a) => s + a.qty, 0);
  if (allocated < n) throw badRequest(`Only ${allocated} boxes of this item are allocated — nothing to return to stock`, 409);

  await shrink();
  await recountOrderItems(catalyst, ds, [oiId]); // palletized_qty drops before the dealloc check
  let remaining = n;
  for (const a of allocs) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, a.qty);
    await deallocateCore(catalyst, ds, a.id, take); // trims auto Planning cards, lowers produced, recounts, logs
    remaining -= take;
  }
  await logTransition(catalyst, { entity_type: "PalletizationPlanLine", entity_rowid: lineId, from_status: String(line.status), to_status: "Released", note: `released — ${n} boxes to free stock` });
  await logRelated(catalyst, refs, "released", { boxes: n, to: "stock", reason });
  return { to: "stock", boxes: n };
}

/** CR-370: deleting a palletization returns every line's boxes to free stock first —
    refused while any line still sits in a container (release those first). */
async function discardPlanLines(catalyst, ds, planId, reason) {
  const lines = await zcqlAllRows(catalyst, `SELECT ${PAL_LINE_RELEASE_COLS} FROM PalletizationPlanLine WHERE plan = ${planId} AND deleted_at is null`);
  const boxed = lines.filter((l) => l.load_box).reduce((s, l) => s + (Number(l.boxes) || 0), 0);
  if (boxed) throw badRequest(`${boxed} boxes of this palletization are in a container — release them first`, 409);
  for (const l of lines) await releaseLineToStock(catalyst, ds, l, Number(l.boxes) || 0, reason);
}

/** CR-371: a cancelled sales order leaves nothing on the palletization board — boxes in
    open containers are taken out, every line returns to free stock, every remaining
    allocation is handed back. Refused (409, before any write) while a box is already dispatched. */
async function cancelSoPalletization(catalyst, ds, soId, reason) {
  const lines = await zcqlAllRows(catalyst, `SELECT ${PAL_LINE_RELEASE_COLS} FROM PalletizationPlanLine WHERE sales_order = ${soId} AND deleted_at is null`);
  const boxes = new Map();
  for (const id of new Set(lines.filter((l) => l.load_box).map((l) => String(l.load_box)))) boxes.set(id, await getBox(catalyst, id));
  const shipped = lines.filter((l) => l.load_box && String(boxes.get(String(l.load_box)).status) !== "Open");
  if (shipped.length) {
    const n = shipped.reduce((s, l) => s + (Number(l.boxes) || 0), 0);
    const codes = [...new Set(shipped.map((l) => boxes.get(String(l.load_box)).load_number || boxes.get(String(l.load_box)).box_number))].filter(Boolean);
    throw badRequest(`${n} boxes already dispatched${codes.length ? ` in ${codes.join(", ")}` : ""} — cannot cancel`, 409);
  }
  const planIds = new Set();
  for (const l of lines) {
    if (!l.load_box) continue;
    await ds.table("PalletizationPlanLine").updateRow({ ROWID: l.ROWID, load_box: null });
    planIds.add(String(l.plan || ""));
  }
  if (planIds.size) await demoteEmptyPlans(catalyst, ds, [...planIds]);
  for (const l of lines) await releaseLineToStock(catalyst, ds, l, Number(l.boxes) || 0, reason);
  // Allocated but never planned (or left behind by a trimmed auto card) — hand it back too.
  const allocs = await zcqlAllRows(catalyst, `SELECT ROWID FROM ProductionLog WHERE sales_order = ${soId} AND entry_type = 'alloc' AND deleted_at is null`);
  for (const a of allocs) await deallocateCore(catalyst, ds, String(a.ROWID));
}

app.post("/pal-line-release/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const lineId = boxIdParam(req.params.rowid);
    const reason = requireReason(req, "to release or discard"); // CR-369: every role
    const reqBoxes = (req.body || {}).boxes;
    const result = await withOpLog(
      catalyst,
      { table_name: "PalletizationPlanLine", operation: "release", payload: { ROWID: lineId, boxes: reqBoxes, reason } },
      async () => {
        const line = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ${PAL_LINE_RELEASE_COLS} FROM PalletizationPlanLine WHERE ROWID = ${lineId} AND deleted_at is null`,
          ),
        )[0];
        if (!line) throw badRequest(`Palletization line not found: ${lineId}`, 404);
        const lineBoxes = Number(line.boxes) || 0;
        const n = reqBoxes === undefined || reqBoxes === null || reqBoxes === "" ? lineBoxes : Number(reqBoxes);
        if (!Number.isInteger(n) || n <= 0 || n > lineBoxes) throw badRequest(`Can release 1 to ${lineBoxes} boxes of this line`);
        const planId = String(line.plan || "");
        const oiId = String(line.order_item || "");
        const boxId = String(line.load_box || "");
        const refs = [{ table: "SalesOrder", rowid: line.sales_order }, { table: "PalletizationPlan", rowid: planId }];

        if (boxId) {
          // Loaded → back to Ready for Loading.
          const box = await getBox(catalyst, boxId);
          if (String(box.status) !== "Open") throw badRequest("This item is already dispatched", 409);
          if (n < lineBoxes) await writeLineIntoBox(ds, line, boxId, lineBoxes - n); // remainder = the released, un-boxed part
          else await ds.table("PalletizationPlanLine").updateRow({ ROWID: lineId, load_box: null });
          if (planId) await demoteEmptyPlans(catalyst, ds, [planId]);
          if (oiId) await recountOrderItems(catalyst, ds, [oiId]);
          await logRelated(catalyst, [...refs, { table: "LoadBox", rowid: boxId }], "released", { boxes: n, box: boxId, to: "ReadyToLoad", reason });
          return { rowid: lineId, data: { to: "ReadyToLoad", boxes: n } };
        }

        // Palletized (CR-361) or still planned / in palletization (CR-369 Discard) → free stock.
        if (!oiId) throw badRequest("This line is not tied to an order item — nothing to return to stock", 409);
        return { rowid: lineId, data: await releaseLineToStock(catalyst, ds, line, n, reason) };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/** The SO's open (Planning) plan, minted on first need — mirror of the
    autoEnqueuePalletization block, self-contained for direct-loading. */
async function ensureOpenPlan(catalyst, ds, soId, remark) {
  const zcql = catalyst.zcql();
  const soLines = rowList(
    await zcql.executeZCQLQuery(
      `SELECT plan FROM PalletizationPlanLine WHERE sales_order = ${soId} AND deleted_at is null`,
    ),
  );
  const planIds = [...new Set(soLines.map((l) => String(l.plan)))].filter(Boolean);
  if (planIds.length) {
    const open = rowList(
      await zcql.executeZCQLQuery(
        `SELECT ROWID FROM PalletizationPlan WHERE ROWID IN (${planIds.join(",")}) AND status = 'Planning' AND deleted_at is null`,
      ),
    );
    if (open.length) return String(open[0].ROWID);
  }
  const planRow = await ds.table("PalletizationPlan").insertRow({
    pal_number: await nextPalNumber(catalyst),
    status: "Planning",
    vehicle_number: "",
    remarks: remark,
  });
  const planId = String(planRow.ROWID);
  await logTransition(catalyst, {
    entity_type: "PalletizationPlan", entity_rowid: planId, from_status: "", to_status: "Planning",
    note: remark,
  });
  return planId;
}

/* Send order items straight to loading, skipping palletization: mints lines
   born ReadyToLoad on the SO's open plan (created on first need) so the
   /loading board, recount and dispatch machinery work unchanged. Optional
   body.box allocates the new lines into an Open load box immediately (the
   "Add Items" flow on a loading). Per item, sends are capped at
   ordered − palletized: recount counts ReadyToLoad as palletized, so
   re-sending the same items cannot double-queue. */
app.post("/send-to-loading", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const soId = String(body.sales_order || "").replace(/[^0-9]/g, "");
    const reqLines = Array.isArray(body.lines) ? body.lines : [];
    const result = await withOpLog(
      catalyst,
      { table_name: "PalletizationPlanLine", operation: "send-to-loading", payload: body },
      async () => {
        if (!soId) throw badRequest("sales_order is required", 400);
        if (!reqLines.length) throw badRequest("At least one item is required", 400);
        const zcql = catalyst.zcql();
        const so = rowList(
          await zcql.executeZCQLQuery(
            `SELECT ROWID FROM SalesOrder WHERE ROWID = ${soId} AND deleted_at is null`,
          ),
        )[0];
        if (!so) throw badRequest(`Sales order not found: ${soId}`, 404);
        const box = body.box ? await getBox(catalyst, boxIdParam(body.box)) : null;
        if (box && String(box.status) !== "Open")
          throw badRequest("Items can only be added to an open loading", 409);
        const items = rowList(
          await zcql.executeZCQLQuery(
            `SELECT ROWID, design, pallet, ordered_qty_boxes, produced_qty_boxes, palletized_qty_boxes FROM OrderItem WHERE sales_order = ${soId} AND deleted_at is null`,
          ),
        );
        const byId = new Map(items.map((i) => [String(i.ROWID), i]));

        // Validate every line before inserting any (no partial sends).
        const wanted = new Map(); // oiId → boxes requested this call
        for (const l of reqLines) {
          const oiId = String(l.order_item || "").replace(/[^0-9]/g, "");
          const oi = byId.get(oiId);
          if (!oi) throw badRequest(`Order item does not belong to this sales order: ${l.order_item}`, 400);
          const n = Number(l.boxes);
          if (!Number.isInteger(n) || n <= 0) throw badRequest("boxes must be a positive integer");
          wanted.set(oiId, (wanted.get(oiId) || 0) + n);
        }
        for (const [oiId, n] of wanted) {
          const oi = byId.get(oiId);
          // CR-199: only boxes the order OWNS (produced/allocated) may ship —
          // unallocated stock would starve another order's reservation.
          const owned = Math.min(Number(oi.ordered_qty_boxes) || 0, Number(oi.produced_qty_boxes) || 0);
          const cap = owned - (Number(oi.palletized_qty_boxes) || 0);
          if (n > cap) throw badRequest(`Only ${Math.max(cap, 0)} allocated boxes remain to send for an item — allocate stock first`, 409);
        }

        const planId = await ensureOpenPlan(catalyst, ds, soId, "Auto — direct loading");
        let pos = rowList(
          await zcql.executeZCQLQuery(
            `SELECT ROWID FROM PalletizationPlanLine WHERE plan = ${planId} AND deleted_at is null`,
          ),
        ).length;
        // Batch trail: split each item's boxes across its unqueued production
        // batches (FIFO), one line per batch — same rule as the auto-enqueue, so
        // skipping palletization doesn't lose the batch. The cap above is
        // min(ordered, produced)−palletized (CR-199); whatever the unqueued
        // batches don't cover falls through to one unattributed "" line.
        // KNOWN GAP (review 2026-09-19 #1): boxes already on a Planning/Palletizing
        // line are not subtracted, so they can be sent again — fix pending a decision.
        // Soft-deleting a plan leaves its lines live, so restrict to live plans
        // (mirror of recountOrderItems / autoEnqueuePalletization).
        const allSoLines = rowList(
          await zcql.executeZCQLQuery(
            `SELECT plan, order_item, boxes, batch_number FROM PalletizationPlanLine WHERE sales_order = ${soId} AND deleted_at is null`,
          ),
        );
        const soPlanIds = [...new Set(allSoLines.map((l) => String(l.plan)))].filter(Boolean);
        const liveSoPlans = new Set();
        if (soPlanIds.length) {
          rowList(
            await zcql.executeZCQLQuery(
              `SELECT ROWID FROM PalletizationPlan WHERE ROWID IN (${soPlanIds.join(",")}) AND deleted_at is null`,
            ),
          ).forEach((p) => liveSoPlans.add(String(p.ROWID)));
        }
        const soLines = allSoLines.filter((l) => liveSoPlans.has(String(l.plan)));
        // Lines must always carry a pallet: SO-line pick, else the size default.
        const palletByDesign = new Map();
        const palletFor = async (oi) => {
          if (oi.pallet) return String(oi.pallet);
          const did = String(oi.design || "");
          if (!palletByDesign.has(did)) palletByDesign.set(did, await defaultPalletForDesign(catalyst, did));
          return palletByDesign.get(did);
        };
        for (const [oiId, n] of wanted) {
          const oi = byId.get(oiId);
          const chunks = [];
          let left = n;
          for (const { batch, brand, available } of await unqueuedBatches(catalyst, oiId, soLines)) {
            if (left <= 0) break;
            const alloc = Math.min(available, left);
            if (alloc <= 0) continue;
            chunks.push({ batch, brand, boxes: alloc });
            left -= alloc;
          }
          if (left > 0) chunks.push({ batch: "", boxes: left });
          for (const c of chunks) {
            const lr = await ds.table("PalletizationPlanLine").insertRow({
              plan: planId,
              sales_order: soId,
              order_item: oiId,
              design: oi.design ? String(oi.design) : null,
              pallet: await palletFor(oi),
              boxes: c.boxes,
              position: pos++,
              status: "ReadyToLoad",
              batch_number: c.batch,
              // Same carton rule as the auto-enqueue (CR-197): the production brand wins.
              ...(c.brand ? { box_brand: c.brand } : {}),
              ...(box ? { load_box: String(box.ROWID) } : {}),
            });
            soLines.push({ order_item: oiId, boxes: c.boxes, batch_number: c.batch });
            await logTransition(catalyst, {
              entity_type: "PalletizationPlanLine", entity_rowid: String(lr.ROWID),
              from_status: "", to_status: "ReadyToLoad", note: "sent to loading",
            });
          }
        }
        // Allocated straight into a box → plan follows, same as /pal-line-box.
        if (box) {
          const plan = rowList(
            await zcql.executeZCQLQuery(
              `SELECT ROWID, status FROM PalletizationPlan WHERE ROWID = ${planId}`,
            ),
          )[0];
          if (plan && String(plan.status) === "Planning")
            await setPlanStatus(catalyst, ds, planId, "Planning", "Loading");
        }
        await recountOrderItems(catalyst, ds, [...wanted.keys()]);
        // Show the send on the order and the plan that received the lines.
        await logRelated(
          catalyst,
          [{ table: "SalesOrder", rowid: soId }, { table: "PalletizationPlan", rowid: planId }],
          "sent-to-loading",
          {
            boxes: [...wanted.values()].reduce((s, n) => s + n, 0),
            items: wanted.size,
            ...(box ? { container: String(box.container_number || "") || String(box.load_number || "") || `Container ${box.box_number}` } : {}),
          },
        );
        return { rowid: planId, data: { ROWID: planId, lines: wanted.size } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* 3a2. Production requests + lifecycle (approval retired 2026-07).
   A "plan" ProductionLog row is request-first: created with `qty_requested`, no
   counter touched, in the "New" Kanban stage. Recording output inserts a
   separate "record" child row (entry_type=record, parent_log=plan) carrying the
   actual `qty_boxes` + date/shift; that bumps OrderItem.produced (order-linked,
   capped at ordered) and steps stage po→prod. The plan line stays recordable
   until its records cover qty_requested. Kanban stage auto-steps on recording
   (first record: New → InProduction; records covering qty_requested: →
   Completed); manual drag still works and QC is only ever entered/left by hand.

   POST /production-log          — create a request (one plan row per line, shared request_group)
   POST /production-record/:id   — record actual output → inserts a record child
   POST /production-stage        — move a production to a Kanban stage (manual)
   POST /production-update/:id    — edit a plan line (qty_requested / note)
   POST /production-status/:g    — [retired] approve/reject; kept for rollback */
// ponytail: approval retired — kept for rollback, no longer driven by the UI.
const PRODUCTION_TRANSITIONS = {
  PendingApproval: ["Approved", "Rejected"], // approver only
  Approved: ["Produced"], // record actual output
  Rejected: ["PendingApproval"], // resubmit
};

/* Create a production request. Each line becomes a PendingApproval ProductionLog
   row sharing one request_group so approval acts on the whole batch.
   body: { lines: [{ order_item?, design?, qty_requested }], production_date?, shift?, performed_by?, note? } */
app.post("/production-log", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "production-request", payload: body },
      async () => {
        const lines = (Array.isArray(body.lines) ? body.lines : [])
          .map((l) => ({
            order_item: l.order_item ? String(l.order_item) : "",
            design: l.design ? String(l.design) : "",
            qty_requested: nonNeg(l.qty_requested, "qty_requested"),
          }))
          .filter((l) => l.qty_requested > 0 && (l.order_item || l.design));
        if (!lines.length) throw badRequest("At least one line with qty_requested > 0 is required");

        // Derive design / sales_order for order-item lines from the line record.
        const orderItemIds = lines.map((l) => l.order_item).filter(Boolean);
        const oiMap = await loadOrderItems(
          catalyst, orderItemIds, "ROWID, design, sales_order, ordered_qty_boxes, produced_qty_boxes",
        );
        // A manual request SUPERSEDES the SO-confirm auto-queued job for the same
        // line, when that job is untouched (still New, nothing recorded): soft-delete
        // it so the sheet shows one right-sized job and the cap below frees its budget.
        // The auto group is exactly `so-{salesOrder}` (ZCQL LIKE doesn't match here,
        // so build the exact values from the lines' own sales orders).
        if (orderItemIds.length) {
          const uniq = [...new Set(orderItemIds.map(String))];
          const groups = [...new Set(
            uniq.map((id) => String(oiMap.get(id)?.sales_order || "")).filter(Boolean).map((so) => `'so-${so}'`),
          )];
          const autos = groups.length
            ? rowList(
                await catalyst.zcql().executeZCQLQuery(
                  `SELECT ROWID, qty_boxes FROM ProductionLog WHERE entry_type = 'plan' AND request_group IN (${groups.join(",")}) AND stage = 'New' AND deleted_at is null AND order_item IN (${uniq.join(",")})`,
                ),
              ).filter((r) => !(Number(r.qty_boxes) || 0))
            : [];
          if (autos.length) {
            const ids = autos.map((r) => String(r.ROWID));
            const touched = new Set(
              rowList(
                await catalyst.zcql().executeZCQLQuery(
                  `SELECT parent_log FROM ProductionLog WHERE parent_log IN (${ids.join(",")}) AND deleted_at is null`,
                ),
              ).map((r) => String(r.parent_log)),
            );
            const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
            for (const id of ids.filter((i) => !touched.has(i)))
              await ds.table("ProductionLog").updateRow({ ROWID: id, deleted_at: stamp });
          }
        }
        // CR-234: "Start New Production" lands the job straight in In Production.
        // Literal pair, not PRODUCTION_STAGES — a forged body must not create a
        // job that is already Completed.
        const stage = body.stage == null ? "New" : String(body.stage);
        if (!["New", "InProduction"].includes(stage)) throw badRequest(`Unsupported stage: ${stage}`);
        const group = `PR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const created = [];
        for (const l of lines) {
          let design = l.design;
          let salesOrder = "";
          if (l.order_item) {
            const oi = oiMap.get(l.order_item);
            if (!oi) throw badRequest(`OrderItem not found: ${l.order_item}`, 404);
            // No cap vs ordered (CR): production may be requested beyond the
            // order's remaining — the client hints, the operator decides.
            design = design || String(oi.design || "");
            salesOrder = String(oi.sales_order || "");
          } else if (!design) {
            throw badRequest("design is required for an independent line");
          }
          // ponytail: approval retired 2026-07 — plan lines are created ready to
          // record (status "Approved" is vestigial), and land in the "New" Kanban stage.
          const row = await ds.table("ProductionLog").insertRow({
            design: design || null,
            sales_order: salesOrder || null,
            order_item: l.order_item || null,
            qty_requested: l.qty_requested,
            qty_boxes: 0,
            status: "Approved",
            entry_type: "plan",
            stage,
            request_group: group,
            production_date: String(body.production_date || ""),
            shift: String(body.shift || ""),
            performed_by: String(body.performed_by || ""),
            note: String(body.note || ""),
          });
          await logTransition(catalyst, {
            entity_type: "ProductionLog", entity_rowid: row.ROWID, from_status: "", to_status: stage,
          });
          created.push(String(row.ROWID));
        }
        return { rowid: group, data: { request_group: group, lines: created.length, ids: created } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Delete a production line, cascading its effect: soft-deletes the plan line and
   all its record children, giving back the summed OrderItem.produced bump (and
   steps stage prod→po if it hits zero). Blocked when those boxes are already
   palletised downstream. A line with no recorded output never moved a counter. */
app.post("/production-delete/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rowid = req.params.rowid;
    const reason = deleteReason(req, "ProductionLog");
    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "production-delete", payload: { ROWID: rowid, reason } },
      async () => {
        const pl = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, order_item, design, qty_boxes, entry_type FROM ProductionLog WHERE ROWID = ${rowid} AND deleted_at is null`,
          ),
        )[0];
        if (!pl) throw badRequest(`Production entry not found: ${rowid}`, 404);
        // CR-330: a transfer leg / allocation is never deleted here — reverse it with its own flow.
        if (["transfer", "alloc"].includes(String(pl.entry_type || "")))
          throw badRequest("Only production entries can be deleted here — reverse a transfer with the opposite transfer", 409);

        // Record children hold the recorded boxes to reverse (+ any legacy qty_boxes
        // on the plan line itself, from before the split-row model).
        const children = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, qty_boxes, batch_number FROM ProductionLog WHERE parent_log = ${rowid} AND deleted_at is null`,
          ),
        );
        // Stock output already allocated to orders (CR-199) must be released first.
        if (!pl.order_item && pl.design) {
          const free = await serverFreeStock(catalyst, String(pl.design));
          const going = new Map();
          if (Number(pl.qty_boxes) > 0) going.set("", Number(pl.qty_boxes));
          for (const c of children) {
            const b = String(c.batch_number || "");
            going.set(b, (going.get(b) || 0) + (Number(c.qty_boxes) || 0));
          }
          for (const [b, n] of going) {
            const short = n - Math.max(0, free.get(b) || 0);
            if (short > 0)
              throw badRequest(`${short} boxes of ${b ? `batch ${b}` : "this output"} are allocated to orders or already shipped — de-allocate first`, 409);
          }
        }
        const reverseQty =
          (Number(pl.qty_boxes) || 0) + children.reduce((s, r) => s + (Number(r.qty_boxes) || 0), 0);

        const orderItemId = String(pl.order_item || "");
        if (reverseQty > 0 && orderItemId) {
          const oi = (await loadOrderItems(
            catalyst, [orderItemId], "ROWID, produced_qty_boxes, palletized_qty_boxes, stage",
          )).get(orderItemId);
          if (oi) {
            const produced = Number(oi.produced_qty_boxes) || 0;
            const palletized = Number(oi.palletized_qty_boxes) || 0;
            const newProduced = produced - reverseQty;
            if (newProduced < palletized)
              throw badRequest(
                `Cannot delete: ${palletized} of these boxes are already palletised — unpack them first`,
                409,
              );
            const patch = { ROWID: orderItemId, produced_qty_boxes: Math.max(0, newProduced) };
            const stage = String(oi.stage || "");
            if (newProduced <= 0 && stage === "prod") patch.stage = "po";
            await ds.table("OrderItem").updateRow(patch);
            if (patch.stage)
              await logTransition(catalyst, {
                entity_type: "OrderItem", entity_rowid: orderItemId, from_status: stage, to_status: patch.stage,
              });
          }
        }

        const deletedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
        for (const c of children) await ds.table("ProductionLog").updateRow({ ROWID: c.ROWID, deleted_at: deletedAt });
        await ds.table("ProductionLog").updateRow({ ROWID: rowid, deleted_at: deletedAt });
        return { rowid };
      },
    );
    res.json({ ok: true, rowid: result.rowid });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ================================================================
   Stock allocation (CR-199, production-first). The factory produces to
   STOCK; an SO line then CLAIMS boxes of a batch via an entry_type="alloc"
   ProductionLog row. An alloc row is a claim only — never supply — so
   on-hand is unchanged; it bumps OrderItem.produced_qty_boxes and feeds the
   Ready-for-Palletization queue exactly like an order-linked record did.
   ================================================================ */
async function zcqlAllRows(catalyst, sqlNoLimit) {
  const out = [];
  for (let off = 0; ; off += 300) {
    const page = rowList(await catalyst.zcql().executeZCQLQuery(`${sqlNoLimit}${/order by/i.test(sqlNoLimit) ? "" : " ORDER BY ROWID"} LIMIT ${off}, 300`));
    out.push(...page);
    if (page.length < 300) return out;
  }
}

/* Free boxes per batch of one design = supply − loaded − Σ per order item
   max(0, claim − its loaded). Mirrors the client's reservedByBatch/freeOf.
   ponytail: race/double-submit backstop only — it skips the client reducer's
   FIFO spill of blank-batch loads and the legacy PalletisedBatch consumption,
   so it can read slightly HIGH (permissive), never low; the picker shows the
   exact figure. Port the reducer here if that gap ever bites. */
async function serverFreeStock(catalyst, designId, opts = {}) {
  const logs = await zcqlAllRows(
    catalyst,
    `SELECT entry_type, batch_number, qty_boxes, order_item FROM ProductionLog WHERE design = ${designId} AND deleted_at is null`,
  );
  const lines = await zcqlAllRows(
    catalyst,
    `SELECT order_item, batch_number, boxes FROM PalletizationPlanLine WHERE design = ${designId} AND load_box is not null AND deleted_at is null`,
  );
  const d = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT is_batched, accounting_stock FROM Design WHERE ROWID = ${designId}`),
  )[0] || {};
  const free = new Map(); // batch → boxes
  const add = (b, n) => free.set(b, (free.get(b) || 0) + n);
  const claim = new Map(); // `${oi}|${batch}` → outstanding boxes
  if (!(d.is_batched === true || String(d.is_batched) === "true")) add("", Number(d.accounting_stock) || 0);
  for (const r of logs) {
    const type = String(r.entry_type || "");
    const qty = Number(r.qty_boxes) || 0;
    // CR-308: adjustments are SIGNED supply — handled before the qty guard.
    if (type === "adjust") {
      if (qty) add(String(r.batch_number || ""), qty);
      continue;
    }
    if (type === "transfer") continue; // CR-330: net zero per batch — only the per-warehouse view reads it
    if (qty <= 0) continue;
    const batch = type === "plan" ? "" : String(r.batch_number || "");
    if (type === "record" || type === "opening" || type === "plan") add(batch, qty);
    const oi = String(r.order_item || "");
    if (oi && (type === "record" || type === "alloc" || type === "plan"))
      claim.set(`${oi}|${batch}`, (claim.get(`${oi}|${batch}`) || 0) + qty);
  }
  for (const l of lines) {
    const n = Number(l.boxes) || 0;
    const batch = String(l.batch_number || "");
    add(batch, -n);
    const k = `${String(l.order_item || "")}|${batch}`;
    if (claim.has(k)) claim.set(k, claim.get(k) - n);
  }
  // { onHand: true } = physical on-hand only (no claim netting) — /stock-adjust's floor.
  if (!opts.onHand) for (const [k, left] of claim) if (left > 0) add(k.slice(k.indexOf("|") + 1), -left);
  return free;
}


/* ================================================================
   Warehouses (CR-329) — stock rows may name a warehouse; null = the primary.
   serverWarehouseOnHand / serverCutWarehouseOnHand mirror the client reducer
   (client/src/lib/warehouseStock.ts) so the transfer / adjustment floors
   agree with what the Locations panel shows.
   // ponytail: warehouseReduce is the JS twin of deriveWarehouseStock — change both.
   ================================================================ */
async function warehouseMeta(catalyst) {
  const rows = await zcqlAllRows(catalyst, `SELECT ROWID, name, is_primary, purposes, parent FROM Warehouse WHERE deleted_at is null ORDER BY ROWID`);
  // CR-409: a row with `parent` is a LOCATION inside that warehouse — it inherits the
  // warehouse's purposes and is never primary. Stock rows point at the leaf node.
  const pid = (v) => (v == null || v === "" ? "" : String(v));
  const top = new Map(rows.filter((r) => !pid(r.parent)).map((r) => [String(r.ROWID), r]));
  const bayOf = (r) => String(r.purposes || "").split(",").map((s) => s.trim()).includes("Loading Bay");
  const list = rows.map((r) => {
    const p = pid(r.parent) ? top.get(pid(r.parent)) : null;
    return {
      id: String(r.ROWID),
      name: String(r.name || ""),
      parent: pid(r.parent),
      isPrimary: !pid(r.parent) && (r.is_primary === true || String(r.is_primary) === "true"),
      bay: bayOf(p || r),
    };
  });
  const primary = (list.find((w) => w.isPrimary) || list.find((w) => !w.parent) || { id: "" }).id;
  const byId = new Map(list.map((w) => [w.id, w]));
  /** "Main Godown ▸ A1" · "Main Godown" · "Main Godown ▸ Unassigned" (a warehouse that has locations). */
  const label = (id) => {
    const w = byId.get(String(id));
    if (!w) return "";
    if (w.parent) return `${(byId.get(w.parent) || { name: "—" }).name} ▸ ${w.name}`;
    return list.some((x) => x.parent === w.id) ? `${w.name} ▸ Unassigned` : w.name;
  };
  return { list, primary, byId, label };
}
/** Helper for inserts: carry a stated warehouse, else nothing (null = primary). */
const whField = (v) => (rowidParam(v) ? { warehouse: rowidParam(v) } : {});
/** moves [{key, warehouse|null, qty signed}] → Map "key|warehouseId" → on hand. */
function warehouseReduce(meta, moves) {
  const resolve = (w) => (w && meta.byId.has(String(w)) ? String(w) : meta.primary);
  const cells = new Map(); // key → Map(wh → onHand)
  const bucket = (key) => cells.get(key) || cells.set(key, new Map()).get(key);
  const rank = (m) => (m.qty >= 0 ? 0 : m.warehouse && meta.byId.has(String(m.warehouse)) ? 1 : 2);
  for (const m of moves.filter((x) => x.qty).sort((a, b) => rank(a) - rank(b))) {
    const c = bucket(m.key);
    if (m.qty > 0) {
      const wh = resolve(m.warehouse);
      c.set(wh, (c.get(wh) || 0) + m.qty);
    } else if (rank(m) === 1) {
      const wh = String(m.warehouse);
      c.set(wh, Math.max(0, (c.get(wh) || 0) + m.qty));
    } else {
      // Loading Bay first, then the largest balance, ties by id — never below zero.
      let left = -m.qty;
      const bay = (id) => !!(meta.byId.get(id) || {}).bay;
      const order = [...c.entries()].filter(([, n]) => n > 0).sort(([ia, na], [ib, nb]) => Number(bay(ib)) - Number(bay(ia)) || nb - na || (ia < ib ? -1 : 1));
      for (const [id, n] of order) {
        if (left <= 0) break;
        const t = Math.min(left, n);
        c.set(id, n - t);
        left -= t;
      }
    }
  }
  const out = new Map();
  for (const [key, m] of cells) for (const [wh, n] of m) out.set(`${key}|${wh}`, n);
  return out;
}
/* Box stock of one design per (batch, warehouse): record/opening/adjust/transfer
   rows carry their warehouse; plan-row output and accounting stock are null;
   loaded plan lines are null removals (spread). Same permissive simplifications
   as serverFreeStock (no FIFO spill of blank-batch loads, no legacy pallets). */
async function serverWarehouseOnHand(catalyst, designId) {
  const meta = await warehouseMeta(catalyst);
  const logs = await zcqlAllRows(
    catalyst,
    `SELECT entry_type, batch_number, qty_boxes, warehouse FROM ProductionLog WHERE design = ${designId} AND deleted_at is null`,
  );
  const lines = await zcqlAllRows(
    catalyst,
    `SELECT batch_number, boxes FROM PalletizationPlanLine WHERE design = ${designId} AND load_box is not null AND deleted_at is null`,
  );
  const d = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT is_batched, accounting_stock FROM Design WHERE ROWID = ${designId}`),
  )[0] || {};
  const moves = [];
  if (!(d.is_batched === true || String(d.is_batched) === "true")) moves.push({ key: "", warehouse: null, qty: Number(d.accounting_stock) || 0 });
  for (const r of logs) {
    const type = String(r.entry_type || "");
    const qty = Number(r.qty_boxes) || 0;
    const wh = r.warehouse == null || r.warehouse === "" ? null : String(r.warehouse);
    if (type === "adjust" || type === "transfer") moves.push({ key: String(r.batch_number || ""), warehouse: wh, qty });
    else if (qty > 0 && (type === "record" || type === "opening")) moves.push({ key: String(r.batch_number || ""), warehouse: wh, qty });
    else if (qty > 0 && type === "plan") moves.push({ key: "", warehouse: null, qty });
  }
  for (const l of lines) moves.push({ key: String(l.batch_number || ""), warehouse: null, qty: -(Number(l.boxes) || 0) });
  return { meta, cells: warehouseReduce(meta, moves) };
}
/* Cut-piece stock of one (design, cut size) per warehouse: the ledger rows carry
   it; whatever CutPieceStock.qty holds beyond the ledger (pre-CR-307 stock) is
   null supply. Keys are "" so cells read "|<warehouseId>". */
async function serverCutWarehouseOnHand(catalyst, designId, cutSizeId) {
  const meta = await warehouseMeta(catalyst);
  const entries = await zcqlAllRows(
    catalyst,
    `SELECT qty, warehouse FROM CutStockEntry WHERE design = ${designId} AND cut_piece_size = ${cutSizeId} AND deleted_at is null`,
  );
  const stock = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT qty FROM CutPieceStock WHERE design = ${designId} AND cut_piece_size = ${cutSizeId} AND deleted_at is null`,
    ),
  )[0];
  const moves = entries.map((e) => ({ key: "", warehouse: e.warehouse == null || e.warehouse === "" ? null : String(e.warehouse), qty: Number(e.qty) || 0 }));
  const residual = (stock ? Number(stock.qty) || 0 : 0) - moves.reduce((s, m) => s + m.qty, 0);
  if (residual) moves.push({ key: "", warehouse: null, qty: residual });
  return { meta, cells: warehouseReduce(meta, moves) };
}
/* Transfer series TRF/FY/NNN (CR-330) — one series across both ledgers
   (ProductionLog.request_group and CutStockEntry.doc_number). LIKE-scoped,
   `*` wildcard (CR-209). */
async function nextTransferNumber(catalyst) {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Indian FY (Apr–Mar)
  const prefix = `TRF/${y}-${String((y + 1) % 100).padStart(2, "0")}/`;
  let max = 0;
  for (const [table, col] of [["ProductionLog", "request_group"], ["CutStockEntry", "doc_number"]]) {
    const rows = await zcqlAllRows(catalyst, `SELECT ${col} FROM ${table} WHERE ${col} LIKE '${prefix}*'`);
    for (const r of rows) {
      const n = String(r[col] || "");
      if (n.startsWith(prefix)) max = Math.max(max, parseInt(n.slice(prefix.length), 10) || 0);
    }
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}
/** From / To of a transfer: both stated, both live, different. */
function transferPair(meta, body) {
  const from = rowidParam(body.from_warehouse);
  const to = rowidParam(body.to_warehouse);
  if (!from || !to) throw badRequest("Pick the location to transfer from and the one to transfer to");
  if (!meta.byId.has(from) || !meta.byId.has(to)) throw badRequest("Location not found", 404);
  if (from === to) throw badRequest("From and To must be different locations");
  return { from, to };
}
/** "at <Warehouse ▸ Location>" when warehouses exist — for 409 wording (CR-409: the full path). */
const atWarehouse = (meta, id) => (meta.byId.get(id) ? ` at ${meta.label(id)}` : "");

/* Mark one warehouse primary (CR-329). The rule "null warehouse = the primary"
   is only stable if history is pinned first: every null-warehouse stock row is
   stamped with the OLD primary, then the flag moves. Generic PATCH on
   is_primary is refused (STATE_COLUMNS). */
app.post("/warehouse-primary/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rid = rowidParam(req.params.rowid);
    const result = await withOpLog(
      catalyst,
      { table_name: "Warehouse", operation: "warehouse-primary", payload: { ROWID: rid } },
      async () => {
        const meta = await warehouseMeta(catalyst);
        if (!rid || !meta.byId.has(rid)) throw badRequest("Warehouse not found", 404);
        if (meta.byId.get(rid).parent) throw badRequest("A location can't be the primary — mark its warehouse instead", 409); // CR-409
        const old = meta.list.find((w) => w.isPrimary);
        if (old && old.id === rid) return { rowid: rid, data: { stamped: 0 } };
        let stamped = 0;
        if (old) {
          const scans = [
            ["ProductionLog", "(entry_type = 'record' OR entry_type = 'opening' OR entry_type = 'adjust' OR entry_type = 'transfer') AND"],
            ["CutStockEntry", ""],
          ];
          for (const [table, extra] of scans) {
            const rows = await zcqlAllRows(catalyst, `SELECT ROWID FROM ${table} WHERE warehouse is null AND ${extra} deleted_at is null ORDER BY ROWID`);
            for (const r of rows) {
              await ds.table(table).updateRow({ ROWID: r.ROWID, warehouse: old.id });
              stamped++;
            }
          }
          await ds.table("Warehouse").updateRow({ ROWID: old.id, is_primary: false });
        }
        await ds.table("Warehouse").updateRow({ ROWID: rid, is_primary: true });
        return { rowid: rid, data: { stamped } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ================================================================
   Transfer Order for BOX stock (CR-330, Zoho Books shape): one dated
   document TRF/FY/NNN moving N (item, batch, boxes) lines from one warehouse
   to another, with a free-text reason. Stored as a PAIR of signed
   entry_type="transfer" ProductionLog rows per line (−from / +to) sharing
   request_group = the document code — net zero per batch, so global stock
   readers ignore the type and only the per-warehouse view uses it. A line
   may not exceed the from-warehouse's on-hand (409). All-or-nothing like
   /stock-adjust; no edit / delete — reverse with the opposite transfer.
   ================================================================ */
app.post("/stock-transfer", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "stock-transfer", payload: body },
      async () => {
        const date = String(body.date || "").trim() || new Date().toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("date must be yyyy-mm-dd");
        const reason = String(body.reason || "").trim();
        if (!reason) throw badRequest("A reason is required");
        const note = String(body.note || "").trim();
        const meta = await warehouseMeta(catalyst);
        const { from, to } = transferPair(meta, body);
        const merged = new Map(); // design|batch → line (duplicates summed)
        for (const l of Array.isArray(body.lines) ? body.lines : []) {
          const d = rowidParam(l && l.design);
          if (!d) throw badRequest("Every line needs an item");
          const q = Number(l.qty_boxes);
          if (!Number.isInteger(q) || q <= 0) throw badRequest("qty_boxes must be a positive whole number");
          const batch = String((l && l.batch_number) || "").trim();
          const k = `${d}|${batch}`;
          const cur = merged.get(k) || { d, batch, qty: 0, note: "" };
          cur.qty += q;
          if (l.note) cur.note = String(l.note).trim();
          merged.set(k, cur);
        }
        if (!merged.size) throw badRequest("Add at least one line");
        const designs = new Map();
        for (const m of merged.values()) {
          if (designs.has(m.d)) continue;
          const d = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT is_batched, design_name, unique_name FROM Design WHERE ROWID = ${m.d} AND deleted_at is null`,
            ),
          )[0];
          if (!d) throw badRequest(`Item not found: ${m.d}`, 404);
          designs.set(m.d, { batched: d.is_batched === true || String(d.is_batched) === "true", name: String(d.unique_name || d.design_name || m.d) });
        }
        const lines = new Map();
        for (const m of merged.values()) {
          const batch = designs.get(m.d).batched ? m.batch : "";
          const k = `${m.d}|${batch}`;
          const cur = lines.get(k) || { ...m, batch, qty: 0 };
          cur.qty += m.qty;
          lines.set(k, cur);
        }
        const onHandOf = new Map();
        for (const m of lines.values()) {
          if (!onHandOf.has(m.d)) onHandOf.set(m.d, (await serverWarehouseOnHand(catalyst, m.d)).cells);
          const have = Math.max(0, onHandOf.get(m.d).get(`${m.batch}|${from}`) || 0);
          if (m.qty > have)
            throw badRequest(`Only ${have} boxes of ${designs.get(m.d).name}${m.batch ? ` batch ${m.batch}` : ""}${atWarehouse(meta, from)}`, 409);
        }
        const actor = await currentActor(catalyst);
        const code = await nextTransferNumber(catalyst);
        const inserted = [];
        try {
          for (const m of lines.values()) {
            for (const [wh, qty] of [[from, -m.qty], [to, m.qty]]) {
              const row = await ds.table("ProductionLog").insertRow({
                entry_type: "transfer",
                design: m.d,
                batch_number: m.batch,
                qty_boxes: qty,
                qty_requested: 0,
                status: "",
                stage: "Completed",
                request_group: code,
                production_date: date,
                performed_by: String(actor || ""),
                reason,
                note: m.note || note,
                warehouse: wh,
              });
              inserted.push(String(row.ROWID));
            }
          }
        } catch (e) {
          for (const id of inserted) { try { await ds.table("ProductionLog").deleteRow(id); } catch (_) {} }
          throw e;
        }
        return { rowid: inserted[0] || null, data: { code, lines: lines.size } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ================================================================
   Inventory adjustment for BOX stock (CR-308, Zoho Books shape): one dated
   submission with a reason and N (item, batch, ± boxes) lines, stored as
   SIGNED entry_type="adjust" ProductionLog rows sharing request_group
   "adj-<stamp>". A negative line may not exceed that batch's physical
   on-hand (it MAY dip below what sales orders have reserved — breakage is
   reality; `free` then clamps at 0). All-or-nothing: every line is checked
   before the first insert; a failed insert rolls the earlier ones back.
   No document number, no edit / delete — reverse with the opposite entry.
   ================================================================ */
app.post("/stock-adjust", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "stock-adjust", payload: body },
      async () => {
        // CR-446: date / reason are PER LINE (the form); the body's are the fallbacks for older callers.
        const date0 = String(body.date || "").trim() || new Date().toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date0)) throw badRequest("date must be yyyy-mm-dd");
        const reason0 = String(body.reason || "").trim();
        const note = String(body.note || "").trim();
        // CR-329: the warehouse the count was taken in (null = primary).
        const meta = await warehouseMeta(catalyst);
        const validWh = (v) => (rowidParam(v) && meta.byId.has(rowidParam(v)) ? rowidParam(v) : null);
        const warehouse = validWh(body.warehouse);
        // CR-438: a line may name its own location; the body's is the fallback (null = primary).
        const merged = new Map(); // design|batch|warehouse|date|reason → line (duplicates summed)
        for (const l of Array.isArray(body.lines) ? body.lines : []) {
          const d = rowidParam(l && l.design);
          if (!d) throw badRequest("Every line needs an item");
          const q = Number(l.qty_boxes);
          if (!Number.isInteger(q) || q === 0) throw badRequest("qty_boxes must be a non-zero whole number");
          const batch = String((l && l.batch_number) || "").trim();
          const wh = validWh(l && l.warehouse) || warehouse;
          const date = String((l && l.date) || "").trim() || date0;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("date must be yyyy-mm-dd");
          const reason = String((l && l.reason) || "").trim() || reason0;
          if (!reason) throw badRequest("Every line needs a reason");
          const k = `${d}|${batch}|${wh || ""}|${date}|${reason}`;
          const cur = merged.get(k) || { d, batch, wh, date, reason, qty: 0, note: "" };
          cur.qty += q;
          if (l.note) cur.note = String(l.note).trim();
          merged.set(k, cur);
        }
        if (!merged.size) throw badRequest("Add at least one line");
        // Item facts once per design; a singular item has no batches → "" bucket.
        const designs = new Map();
        for (const m of merged.values()) {
          if (designs.has(m.d)) continue;
          const d = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT is_batched, design_name, unique_name FROM Design WHERE ROWID = ${m.d} AND deleted_at is null`,
            ),
          )[0];
          if (!d) throw badRequest(`Item not found: ${m.d}`, 404);
          designs.set(m.d, { batched: d.is_batched === true || String(d.is_batched) === "true", name: String(d.unique_name || d.design_name || m.d) });
        }
        const lines = new Map();
        for (const m of merged.values()) {
          const batch = designs.get(m.d).batched ? m.batch : "";
          const k = `${m.d}|${batch}|${m.wh || ""}|${m.date}|${m.reason}`;
          const cur = lines.get(k) || { ...m, batch, qty: 0 };
          cur.qty += m.qty;
          lines.set(k, cur);
        }
        // CR-446: the floor nets PER BAY across the finer (date · reason) lines — two removals at one bay may not
        // each pass on their own.
        const bays = new Map();
        for (const m of lines.values()) {
          const k = `${m.d}|${m.batch}|${m.wh || ""}`;
          const cur = bays.get(k) || { d: m.d, batch: m.batch, wh: m.wh, qty: 0 };
          cur.qty += m.qty;
          bays.set(k, cur);
        }
        const onHandOf = new Map();
        for (const m of bays.values()) {
          if (m.qty >= 0) continue;
          if (!onHandOf.has(m.d)) onHandOf.set(m.d, (await serverWarehouseOnHand(catalyst, m.d)).cells);
          const whKey = m.wh || meta.primary;
          const have = Math.max(0, onHandOf.get(m.d).get(`${m.batch}|${whKey}`) || 0);
          if (-m.qty > have)
            throw badRequest(`Only ${have} boxes on hand in ${m.batch ? `batch ${m.batch}` : "unbatched stock"} of ${designs.get(m.d).name}${atWarehouse(meta, whKey)}`, 409);
        }
        const actor = await currentActor(catalyst);
        const group = `adj-${Date.now()}`;
        const inserted = [];
        try {
          for (const m of lines.values()) {
            if (m.qty === 0) continue; // a +5 and −5 on the same batch cancel out
            const row = await ds.table("ProductionLog").insertRow({
              entry_type: "adjust",
              design: m.d,
              batch_number: m.batch,
              qty_boxes: m.qty,
              qty_requested: 0,
              status: "Adjusted",
              stage: "Completed",
              request_group: group,
              production_date: m.date,
              performed_by: String(actor || ""),
              reason: m.reason,
              note: m.note || note,
              ...whField(m.wh),
            });
            inserted.push(String(row.ROWID));
          }
        } catch (e) {
          for (const id of inserted) { try { await ds.table("ProductionLog").deleteRow(id); } catch (_) {} }
          throw e;
        }
        return { rowid: inserted[0] || null, data: { request_group: group, lines: inserted.length } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

app.post("/allocate-stock", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const oiId = String(body.order_item || "").replace(/[^0-9]/g, "");
    const result = await withOpLog(
      catalyst,
      { table_name: "OrderItem", operation: "allocate-stock", payload: { order_item: oiId, rows: body.rows } },
      async () => {
        if (!oiId) throw badRequest("order_item is required");
        const want = new Map(); // batch → boxes (duplicates merged)
        for (const r of Array.isArray(body.rows) ? body.rows : []) {
          const n = Number(r && r.qty_boxes);
          if (!Number.isInteger(n) || n <= 0) throw badRequest("qty_boxes must be a positive whole number");
          const b = String((r && r.batch_number) || "").trim();
          want.set(b, (want.get(b) || 0) + n);
        }
        if (!want.size) throw badRequest("Pick at least one batch to allocate");
        const total = [...want.values()].reduce((s, n) => s + n, 0);

        const oi = (await loadOrderItems(
          catalyst, [oiId], "ROWID, sales_order, design, ordered_qty_boxes, produced_qty_boxes, stage",
        )).get(oiId);
        if (!oi || !oi.sales_order || !oi.design) throw badRequest(`Order item not found: ${oiId}`, 404);
        const soId = String(oi.sales_order);
        const so = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT status FROM SalesOrder WHERE ROWID = ${soId}`))[0];
        if (!so || ["Draft", "PendingApproval", "Cancelled", "Rejected"].includes(String(so.status || "")))
          throw badRequest("Stock can only be allocated to a confirmed sales order", 409);
        const produced = Number(oi.produced_qty_boxes) || 0;
        const room = (Number(oi.ordered_qty_boxes) || 0) - produced;
        if (total > room) throw badRequest(`Only ${Math.max(room, 0)} boxes of this item are still unallocated`, 409);

        const free = await serverFreeStock(catalyst, String(oi.design));
        for (const [b, n] of want) {
          const f = Math.max(0, free.get(b) || 0);
          if (n > f) throw badRequest(`Only ${f} free boxes left in ${b ? `batch ${b}` : "unbatched stock"}`, 409);
        }

        const actor = await currentActor(catalyst);
        const stage = String(oi.stage || "");
        const patch = { ROWID: oiId, produced_qty_boxes: produced + total, ...(stage === "po" ? { stage: "prod" } : {}) };
        await ds.table("OrderItem").updateRow(patch);
        const inserted = [];
        try {
          for (const [b, n] of want) {
            // The carton the batch was packed in travels with the claim (CR-197);
            // tolerate a Data Store that predates ProductionLog.box_brand.
            let brand = null;
            if (b) {
              try {
                const hit = rowList(
                  await catalyst.zcql().executeZCQLQuery(
                    `SELECT box_brand FROM ProductionLog WHERE design = ${oi.design} AND batch_number = '${b.replace(/'/g, "''")}' AND box_brand is not null AND deleted_at is null LIMIT 1`,
                  ),
                )[0];
                brand = hit && hit.box_brand ? String(hit.box_brand) : null;
              } catch (_) { /* column not created yet */ }
            }
            const row = await ds.table("ProductionLog").insertRow({
              entry_type: "alloc",
              design: String(oi.design),
              sales_order: soId,
              order_item: oiId,
              batch_number: b,
              qty_boxes: n,
              qty_requested: 0,
              status: "Allocated",
              stage: "Completed",
              production_date: new Date().toISOString().slice(0, 10),
              performed_by: String(actor || ""),
              ...(brand ? { box_brand: brand } : {}),
            });
            inserted.push(String(row.ROWID));
          }
        } catch (e) {
          for (const id of inserted) { try { await ds.table("ProductionLog").deleteRow(id); } catch (_) {} }
          try { await ds.table("OrderItem").updateRow({ ROWID: oiId, produced_qty_boxes: produced, stage }); } catch (_) {}
          throw e;
        }
        if (patch.stage)
          await logTransition(catalyst, { entity_type: "OrderItem", entity_rowid: oiId, from_status: stage, to_status: "prod" });
        // Allocated boxes flow straight to the palletization queue; a queue
        // failure never fails the already-committed allocation.
        try { await autoEnqueuePalletization(catalyst, ds, oiId, body.pallet); } catch (e) { console.error("alloc enqueue", e); }
        await logRelated(catalyst, [{ table: "SalesOrder", rowid: soId }], "stock-allocated", { order_item: oiId, boxes: total });
        return { rowid: oiId, data: { allocated: total, rows: inserted.length } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Undo ONE alloc row — all of it, or `boxes` of it (CR-297: a partial return
   trims the row's qty_boxes; a full return soft-deletes it). Refused once the
   boxes have moved past the Planning queue (palletising/ready/loaded) — unpack
   first, same rule as /production-delete. Auto Planning cards of that batch
   shrink with it; a user-pinned (manual_edit) card is the user's decision, so
   it blocks instead of being trimmed. */
async function deallocateCore(catalyst, ds, rowid, boxes) {
  const a = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, order_item, sales_order, batch_number, qty_boxes FROM ProductionLog WHERE ROWID = ${rowid} AND entry_type = 'alloc' AND deleted_at is null`,
    ),
  )[0];
  if (!a) throw badRequest(`Allocation not found: ${rowid}`, 404);
  const oiId = String(a.order_item);
  const batch = String(a.batch_number || "");
  const rowQty = Number(a.qty_boxes) || 0;
  const qty = boxes == null ? rowQty : boxes;
  if (!Number.isInteger(qty) || qty <= 0 || qty > rowQty) throw badRequest(`Can return 1 to ${rowQty} boxes of this allocation`);
  const oi = (await loadOrderItems(catalyst, [oiId], "ROWID, produced_qty_boxes, palletized_qty_boxes, stage")).get(oiId);
  if (!oi) throw badRequest(`Order item not found: ${oiId}`, 404);
  const produced = Number(oi.produced_qty_boxes) || 0;
  if (produced - qty < (Number(oi.palletized_qty_boxes) || 0))
    throw badRequest("These boxes are already palletised — unpack them first", 409);

  const safe = batch.replace(/'/g, "''");
  const claims = await zcqlAllRows(
    catalyst,
    `SELECT qty_boxes FROM ProductionLog WHERE order_item = ${oiId} AND batch_number = '${safe}' AND (entry_type = 'record' OR entry_type = 'alloc') AND deleted_at is null`,
  );
  const claimAfter = claims.reduce((s, r) => s + (Number(r.qty_boxes) || 0), 0) - qty;
  const lines = (await zcqlAllRows(
    catalyst,
    `SELECT ROWID, boxes, status, manual_edit, batch_number FROM PalletizationPlanLine WHERE order_item = ${oiId} AND deleted_at is null`,
  )).filter((l) => String(l.batch_number || "") === batch);
  const boxesOf = (ls) => ls.reduce((s, l) => s + (Number(l.boxes) || 0), 0);
  const moved = boxesOf(lines.filter((l) => String(l.status) !== "Planning"));
  if (claimAfter < moved) throw badRequest("These boxes are already in palletization — unpack them first", 409);
  const auto = lines.filter((l) => String(l.status) === "Planning" && String(l.manual_edit || "") !== "true");
  let excess = boxesOf(lines) - claimAfter;
  if (excess > boxesOf(auto))
    throw badRequest("A manually planned palletization line still holds these boxes — reduce it first", 409);

  const deletedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const l of auto) {
    if (excess <= 0) break;
    const cut = Math.min(excess, Number(l.boxes) || 0);
    const left = (Number(l.boxes) || 0) - cut;
    await ds.table("PalletizationPlanLine").updateRow(left > 0 ? { ROWID: l.ROWID, boxes: left } : { ROWID: l.ROWID, deleted_at: deletedAt });
    excess -= cut;
  }
  const stage = String(oi.stage || "");
  const newProduced = Math.max(0, produced - qty);
  const toPo = newProduced <= 0 && stage === "prod";
  await ds.table("OrderItem").updateRow({ ROWID: oiId, produced_qty_boxes: newProduced, ...(toPo ? { stage: "po" } : {}) });
  if (toPo) await logTransition(catalyst, { entity_type: "OrderItem", entity_rowid: oiId, from_status: stage, to_status: "po" });
  await ds.table("ProductionLog").updateRow(qty < rowQty ? { ROWID: a.ROWID, qty_boxes: rowQty - qty } : { ROWID: a.ROWID, deleted_at: deletedAt });
  await recountOrderItems(catalyst, ds, [oiId]);
  await logRelated(catalyst, [{ table: "SalesOrder", rowid: String(a.sales_order || "") }], "stock-deallocated", { order_item: oiId, boxes: qty });
  return qty;
}

app.post("/deallocate-stock/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rowid = String(req.params.rowid || "").replace(/[^0-9]/g, "");
    // CR-297: optional `boxes` = return part of the row; absent = the whole row.
    const boxes = req.body?.boxes == null || req.body.boxes === "" ? undefined : Number(req.body.boxes);
    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "deallocate-stock", payload: { ROWID: rowid, boxes } },
      async () => {
        if (!rowid) throw badRequest("Allocation id is required");
        const qty = await deallocateCore(catalyst, ds, rowid, boxes);
        return { rowid, data: { deallocated: qty } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Approve / reject a whole production request (every PendingApproval line sharing
   the request_group). body: { status: "Approved"|"Rejected", reason? } */
app.post("/production-status/:group", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const group = String(req.params.group || "").replace(/'/g, "");
    const to = String((req.body || {}).status || "");
    const reason = String((req.body || {}).reason || "").trim();

    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "production-status", payload: { request_group: group, status: to, reason } },
      async () => {
        if (!(PRODUCTION_TRANSITIONS.PendingApproval || []).includes(to))
          throw badRequest(`Unsupported production status: ${to}`);
        if (to === "Rejected" && !reason) throw badRequest("A rejection reason is required");
        if (!canApprove(req, "Production"))
          throw badRequest("Your role cannot approve or reject production requests", 403);

        const rows = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, status, performed_by FROM ProductionLog WHERE request_group = '${group}' AND status = 'PendingApproval'`,
          ),
        );
        if (!rows.length) throw badRequest(`No pending production request: ${group}`, 404);

        for (const r of rows) {
          await ds.table("ProductionLog").updateRow(
            to === "Rejected" ? { ROWID: r.ROWID, status: to, note: reason } : { ROWID: r.ROWID, status: to },
          );
          await logTransition(catalyst, {
            entity_type: "ProductionLog", entity_rowid: r.ROWID,
            from_status: "PendingApproval", to_status: to, note: reason,
          });
        }
        // Best-effort in-app ping to the requester (matched by SalesPerson name).
        const requester = String(rows[0].performed_by || "").replace(/'/g, "");
        if (requester) {
          const sp = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT app_user FROM SalesPerson WHERE name = '${requester}'`,
            ),
          )[0];
          const verdict = to === "Approved" ? "approved" : `rejected: ${reason}`;
          await notifyUser(catalyst, sp && sp.app_user, `Production request ${verdict}`, `#/prod`);
        }
        return { rowid: group, data: { request_group: group, status: to, lines: rows.length } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Auto-step a plan line's Kanban stage on recorded output. First record moves
   New → InProduction; when records cover qty_requested the line moves to
   Completed (only from New/InProduction — QC sign-off and any manual stage stay
   hand-driven, and nothing is ever demoted). Best-effort: a failure here never
   fails the already-committed record. */
async function autoStepProductionStage(catalyst, ds, pl, producedAfterLine) {
  try {
    const cur = String(pl.stage || "New");
    const requested = Number(pl.qty_requested) || 0;
    let next = "";
    if (requested > 0 && producedAfterLine >= requested && (cur === "New" || cur === "InProduction")) next = "Completed";
    else if (cur === "New") next = "InProduction";
    if (!next || next === cur) return;
    await ds.table("ProductionLog").updateRow({ ROWID: String(pl.ROWID), stage: next });
    await logTransition(catalyst, {
      entity_type: "ProductionLog", entity_rowid: String(pl.ROWID), from_status: "", to_status: `Stage: ${next}`,
      note: "Auto on recorded output",
    });
  } catch (e) {
    console.error("auto-step production stage failed", e);
  }
}

/* Record actual output against a plan line. Inserts a SEPARATE dated "record"
   child row (entry_type=record, parent_log=plan) — the plan line is untouched, so
   partial records accumulate and the line stays recordable until its records
   cover qty_requested. Bumps OrderItem.produced (order-linked, capped at ordered)
   and steps stage po→prod. Kanban stage auto-steps (autoStepProductionStage).
   body: { qty_boxes, production_date?, shift?, performed_by?, note? } */
app.post("/production-record/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rowid = req.params.rowid;
    const body = req.body || {};
    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "production-record", payload: { ROWID: rowid, qty_boxes: body.qty_boxes } },
      async () => {
        const qty = nonNeg(body.qty_boxes, "qty_boxes");
        if (qty <= 0) throw badRequest("qty_boxes must be > 0");
        const pl = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, order_item, design, sales_order, request_group, qty_requested, qty_boxes, stage FROM ProductionLog WHERE ROWID = ${rowid} AND deleted_at is null`,
          ),
        )[0];
        if (!pl) throw badRequest(`Production entry not found: ${rowid}`, 404);
        const boxBrand = await brandOrNull(catalyst, body.box_brand);

        // Produced so far on THIS plan line = its (legacy) qty_boxes + every record child.
        const recs = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT qty_boxes FROM ProductionLog WHERE parent_log = ${rowid} AND entry_type = 'record' AND deleted_at is null`,
          ),
        );
        const requested = Number(pl.qty_requested) || 0;
        const producedSoFar = (Number(pl.qty_boxes) || 0) + recs.reduce((s, r) => s + (Number(r.qty_boxes) || 0), 0);
        const remaining = Math.max(0, requested - producedSoFar);
        if (qty > remaining)
          throw badRequest(`Recording ${qty} exceeds the ${remaining} still to produce on this line`, 409);

        let producedAfter; // returned only for the order-linked path
        const orderItemId = String(pl.order_item || "");
        if (orderItemId) {
          const oiMap = await loadOrderItems(
            catalyst, [orderItemId], "ROWID, ordered_qty_boxes, produced_qty_boxes, stage",
          );
          const oi = oiMap.get(orderItemId);
          if (!oi) throw badRequest(`OrderItem not found: ${orderItemId}`, 404);
          const ordered = Number(oi.ordered_qty_boxes) || 0;
          const produced = Number(oi.produced_qty_boxes) || 0;
          if (produced + qty > ordered)
            throw badRequest(`Producing ${qty} exceeds ordered (${produced}+${qty} > ${ordered})`, 409);
          producedAfter = produced + qty;
          const patch = { ROWID: orderItemId, produced_qty_boxes: producedAfter };
          const oiStage = String(oi.stage || "po");
          if (oiStage === "po") patch.stage = "prod";
          await ds.table("OrderItem").updateRow(patch);
          if (patch.stage)
            await logTransition(catalyst, {
              entity_type: "OrderItem", entity_rowid: orderItemId,
              from_status: oiStage, to_status: patch.stage,
            });
        }

        // Blank batch → auto-mint B/YYYY-MM/NNN (per item per month); a
        // supplied batch must pass the duplicate guard (setting-controlled).
        const suppliedBatch = String(body.batch_number || "").trim();
        await assertBatchesAllowed(catalyst, [suppliedBatch], pl.design);
        const batchNumber = suppliedBatch || (await nextBatchNumber(catalyst, pl.design));

        const rec = await ds.table("ProductionLog").insertRow({
          parent_log: rowid,
          entry_type: "record",
          design: pl.design || null,
          sales_order: pl.sales_order || null,
          order_item: pl.order_item || null,
          request_group: pl.request_group || null,
          qty_requested: 0,
          qty_boxes: qty,
          status: "Produced",
          stage: String(pl.stage || "New"),
          batch_number: batchNumber,
          ...whField(body.warehouse), // CR-329
          ...(boxBrand ? { box_brand: boxBrand } : {}),
          production_date: body.production_date != null ? String(body.production_date) : "",
          shift: body.shift != null ? String(body.shift) : "",
          performed_by: body.performed_by != null ? String(body.performed_by) : "",
          note: body.note != null ? String(body.note) : "",
        });
        await logTransition(catalyst, {
          entity_type: "ProductionLog", entity_rowid: rowid, from_status: "", to_status: `Recorded +${qty}`,
        });
        await autoStepProductionStage(catalyst, ds, pl, producedSoFar + qty);
        // Produced boxes flow straight to the palletization queue; a queue
        // failure never fails the already-committed record.
        if (orderItemId) {
          try { await autoEnqueuePalletization(catalyst, ds, orderItemId, body.pallet); }
          catch (e) { console.error("auto-enqueue palletization failed", e); }
        }
        return { rowid: String(rec.ROWID), data: { produced_qty_boxes: producedAfter, recorded: qty, batch_number: batchNumber } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Record several batches at once against a plan line (batch-tracked items).
   Atomic: validates Σ qty ≤ remaining (and ≤ order remaining) ONCE, bumps
   OrderItem.produced by the sum + steps po→prod, then inserts one dated `record`
   child per batch (blank batch auto-minted per row).
   On any insert failure it deletes the rows it added and reverts the OrderItem
   bump, so a partial record never sticks.
   body: { rows: [{ qty_boxes, batch_number?, mfg_date?, note? }], shift?, performed_by?, pallet? } */
app.post("/production-record-lines/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rowid = rowidParam(req.params.rowid);
    const body = req.body || {};
    const rowsIn = Array.isArray(body.rows) ? body.rows : [];
    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "production-record-lines", payload: { ROWID: rowid, rows: rowsIn.length } },
      async () => {
        if (!rowsIn.length) throw badRequest("At least one batch row is required");
        const lines = rowsIn.map((r, i) => {
          const qty = nonNeg(r.qty_boxes, `Row ${i + 1} qty_boxes`);
          if (qty <= 0) throw badRequest(`Row ${i + 1}: qty_boxes must be > 0`);
          return {
            qty,
            batch_number: String(r.batch_number || "").trim(),
            mfg_date: r.mfg_date != null ? String(r.mfg_date) : "",
            note: r.note != null ? String(r.note) : "",
            box_brand: r.box_brand,
            warehouse: r.warehouse, // CR-438: a row may name its own location; body.warehouse is the fallback
          };
        });
        const sum = lines.reduce((s, l) => s + l.qty, 0);

        const pl = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, order_item, design, sales_order, request_group, qty_requested, qty_boxes, stage FROM ProductionLog WHERE ROWID = ${rowid} AND deleted_at is null`,
          ),
        )[0];
        if (!pl) throw badRequest(`Production entry not found: ${rowid}`, 404);
        // Box Brand per row (CR-257); body.box_brand is the pre-CR-257 fallback.
        const brands = await Promise.all(lines.map((l) => brandOrNull(catalyst, l.box_brand || body.box_brand)));
        await assertBatchesAllowed(catalyst, lines.map((l) => l.batch_number), pl.design);

        const recs = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT qty_boxes FROM ProductionLog WHERE parent_log = ${rowid} AND entry_type = 'record' AND deleted_at is null`,
          ),
        );
        const requested = Number(pl.qty_requested) || 0;
        const producedSoFar = (Number(pl.qty_boxes) || 0) + recs.reduce((s, r) => s + (Number(r.qty_boxes) || 0), 0);
        const remaining = Math.max(0, requested - producedSoFar);
        if (sum > remaining)
          throw badRequest(`Recording ${sum} exceeds the ${remaining} still to produce on this line`, 409);

        // Bump the order line once for the whole batch (capped at ordered).
        const orderItemId = String(pl.order_item || "");
        let oiRevert = null;
        if (orderItemId) {
          const oiMap = await loadOrderItems(
            catalyst, [orderItemId], "ROWID, ordered_qty_boxes, produced_qty_boxes, stage",
          );
          const oi = oiMap.get(orderItemId);
          if (!oi) throw badRequest(`OrderItem not found: ${orderItemId}`, 404);
          const ordered = Number(oi.ordered_qty_boxes) || 0;
          const produced = Number(oi.produced_qty_boxes) || 0;
          if (produced + sum > ordered)
            throw badRequest(`Producing ${sum} exceeds ordered (${produced}+${sum} > ${ordered})`, 409);
          const patch = { ROWID: orderItemId, produced_qty_boxes: produced + sum };
          const oiStage = String(oi.stage || "po");
          if (oiStage === "po") patch.stage = "prod";
          await ds.table("OrderItem").updateRow(patch);
          oiRevert = { ROWID: orderItemId, produced_qty_boxes: produced, ...(patch.stage ? { stage: oiStage } : {}) };
          if (patch.stage)
            await logTransition(catalyst, {
              entity_type: "OrderItem", entity_rowid: orderItemId, from_status: oiStage, to_status: patch.stage,
            });
        }

        const inserted = [];
        const batchNumbers = [];
        try {
          for (const [i, l] of lines.entries()) {
            // Mint per row; the prior insert is committed so the next scan bumps.
            const batchNumber = l.batch_number || (await nextBatchNumber(catalyst, pl.design));
            const boxBrand = brands[i];
            const rec = await ds.table("ProductionLog").insertRow({
              parent_log: rowid,
              entry_type: "record",
              design: pl.design || null,
              sales_order: pl.sales_order || null,
              order_item: pl.order_item || null,
              request_group: pl.request_group || null,
              qty_requested: 0,
              qty_boxes: l.qty,
              status: "Produced",
              stage: String(pl.stage || "New"),
              batch_number: batchNumber,
              ...(boxBrand ? { box_brand: boxBrand } : {}),
              ...whField(l.warehouse || body.warehouse), // CR-329
              production_date: l.mfg_date,
              shift: body.shift != null ? String(body.shift) : "",
              performed_by: body.performed_by != null ? String(body.performed_by) : "",
              note: l.note,
            });
            inserted.push(String(rec.ROWID));
            batchNumbers.push(batchNumber);
          }
        } catch (e) {
          for (const id of inserted) { try { await ds.table("ProductionLog").deleteRow(id); } catch (_) {} }
          if (oiRevert) { try { await ds.table("OrderItem").updateRow(oiRevert); } catch (_) {} }
          throw e;
        }
        await logTransition(catalyst, {
          entity_type: "ProductionLog", entity_rowid: rowid, from_status: "", to_status: `Recorded +${sum} (${lines.length} batches)`,
        });
        await autoStepProductionStage(catalyst, ds, pl, producedSoFar + sum);
        // After the insert loop committed (not before — the compensation path
        // above would otherwise leave a stray queue line).
        if (orderItemId) {
          try { await autoEnqueuePalletization(catalyst, ds, orderItemId, body.pallet); }
          catch (e) { console.error("auto-enqueue palletization failed", e); }
        }
        return { rowid: inserted[0], data: { recorded: sum, rows: lines.length, batch_numbers: batchNumbers } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Set a batch-tracked item's opening stock as batch rows — stored as
   entry_type="opening" ProductionLog rows (no plan, no order link). Derived
   stock counts these as on-hand (batchStockApi) but never as produced/plan.
   Lock: the first submission is open to items.edit; once any opening row exists,
   further additions require an Admin role + a _reason (audit-only, kept in the
   OperationLog payload). Mirrors the single-number opening-stock lock.
   body: { rows: [{ qty_boxes, batch_number?, mfg_date?, note? }], _reason? } */
app.post("/opening-stock/:designId", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const designId = rowidParam(req.params.designId);
    const body = req.body || {};
    const reason = String(body._reason || "").trim();
    const rowsIn = Array.isArray(body.rows) ? body.rows : [];
    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "opening-stock", payload: { design: designId, rows: rowsIn.length, _reason: reason } },
      async () => {
        if (!rowsIn.length) throw badRequest("At least one opening batch row is required");
        const lines = rowsIn.map((r, i) => {
          const qty = nonNeg(r.qty_boxes, `Row ${i + 1} qty_boxes`);
          if (qty <= 0) throw badRequest(`Row ${i + 1}: qty_boxes must be > 0`);
          return {
            qty,
            batch_number: String(r.batch_number || "").trim(),
            mfg_date: r.mfg_date != null ? String(r.mfg_date) : "",
            note: r.note != null ? String(r.note) : "",
          };
        });
        await assertBatchesAllowed(catalyst, lines.map((l) => l.batch_number), designId);

        // Lock once any opening row exists for this design.
        const existing = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID FROM ProductionLog WHERE design = ${designId} AND entry_type = 'opening' AND deleted_at is null LIMIT 1`,
          ),
        );
        if (existing.length) {
          const u = req.appUser || {};
          if (String(u.role || "").trim().toLowerCase() !== "admin")
            throw badRequest("Opening stock is locked after the first entry — admin only", 403);
          if (!reason) throw badRequest("A reason is required to change opening stock", 400);
        }

        const inserted = [];
        for (const l of lines) {
          const batchNumber = l.batch_number || (await nextBatchNumber(catalyst, designId));
          const rec = await ds.table("ProductionLog").insertRow({
            entry_type: "opening",
            design: designId,
            qty_requested: 0,
            qty_boxes: l.qty,
            status: "",
            stage: "",
            batch_number: batchNumber,
            production_date: l.mfg_date,
            note: l.note,
            ...whField(body.warehouse), // CR-329
          });
          inserted.push(String(rec.ROWID));
        }
        return { rowid: inserted[0], data: { inserted: inserted.length } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Move a production to a Kanban stage — manual drag (recording output ALSO
   auto-steps, see autoStepProductionStage). Sets `stage` on the given plan-line
   ROWIDs (the whole group).
   Optional per-line `notes` map (e.g. item-wise QC remarks) + an overall `note`
   ride along on the stage transition so they show in the Activity feed.
   body: { stage, ids: [plan-line ROWIDs], notes?: {id:remark}, note? } */
const PRODUCTION_STAGES = ["New", "InProduction", "QC", "Completed"];
app.post("/production-stage", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const stage = String(body.stage || "");
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((x) => /^\d+$/.test(x));
    const notes = body.notes && typeof body.notes === "object" ? body.notes : {};
    const overall = String(body.note || "");
    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "production-stage", payload: { stage, ids } },
      async () => {
        if (!PRODUCTION_STAGES.includes(stage)) throw badRequest(`Unsupported stage: ${stage}`);
        if (!ids.length) throw badRequest("At least one production line id is required");
        for (const id of ids) {
          await ds.table("ProductionLog").updateRow({ ROWID: id, stage });
          await logTransition(catalyst, {
            entity_type: "ProductionLog", entity_rowid: id, from_status: "", to_status: `Stage: ${stage}`,
            note: String(notes[id] || overall || ""),
          });
        }
        return { rowid: ids[0], data: { stage, lines: ids.length } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Final completion — the ONE place available stock moves. For each plan line
   records the ACTUAL total boxes produced (over- OR under-production allowed,
   unlike /production-record which caps at remaining), bumps OrderItem.produced by
   the delta over what's already recorded, inserts a dated `record` child so derived
   stock updates, and flips every line to stage=Completed.
   body: { lines: [{ id, qty_boxes, batch_number?, production_date?, box_brand?, note? }],
           production_date?, performed_by?, note? } — per-line date / note win over
   the call-level ones (CR-244).
   ponytail: a down-correction below what's already been recorded (delta < 0) only
   completes the stage — it doesn't claw back stock. Prior records are rare now that
   In-Production no longer captures output; upgrade to a negative reconciling record
   if that path becomes real. */
app.post("/production-complete", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const productionDate = body.production_date != null ? String(body.production_date) : "";
    const performedBy = body.performed_by != null ? String(body.performed_by) : "";
    const note = body.note != null ? String(body.note) : "";
    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "production-complete", payload: { lines: lines.length } },
      async () => {
        const ids = lines.map((l) => String((l && l.id) || "")).filter((x) => /^\d+$/.test(x));
        if (!ids.length) throw badRequest("At least one production line is required");
        let completed = 0;
        const touchedOrderItems = new Set();
        for (const l of lines) {
          const id = String((l && l.id) || "");
          if (!/^\d+$/.test(id)) continue;
          const qty = Math.max(0, Number(l.qty_boxes) || 0);
          const pl = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ROWID, order_item, design, sales_order, request_group, qty_requested, qty_boxes, stage FROM ProductionLog WHERE ROWID = ${id} AND deleted_at is null`,
            ),
          )[0];
          if (!pl) throw badRequest(`Production entry not found: ${id}`, 404);

          // Final produced minus what's already recorded on this line.
          const recs = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT qty_boxes FROM ProductionLog WHERE parent_log = ${id} AND entry_type = 'record' AND deleted_at is null`,
            ),
          );
          const producedSoFar = (Number(pl.qty_boxes) || 0) + recs.reduce((s, r) => s + (Number(r.qty_boxes) || 0), 0);
          const delta = qty - producedSoFar;

          if (delta > 0) {
            const orderItemId = String(pl.order_item || "");
            if (orderItemId) {
              const oiMap = await loadOrderItems(catalyst, [orderItemId], "ROWID, ordered_qty_boxes, produced_qty_boxes, stage");
              const oi = oiMap.get(orderItemId);
              if (oi) {
                const produced = Number(oi.produced_qty_boxes) || 0;
                const patch = { ROWID: orderItemId, produced_qty_boxes: produced + delta };
                const oiStage = String(oi.stage || "po");
                if (oiStage === "po") patch.stage = "prod";
                await ds.table("OrderItem").updateRow(patch);
                if (patch.stage)
                  await logTransition(catalyst, { entity_type: "OrderItem", entity_rowid: orderItemId, from_status: oiStage, to_status: patch.stage });
                touchedOrderItems.add(orderItemId);
              }
            }
            // Batch per line (each completed line is one design's run);
            // blank batch → auto-mint.
            const typedBatch = String((l && l.batch_number) || "").trim();
            // CR-237: the completion form now takes a typed batch — same duplicate
            // guard as /production-record.
            if (typedBatch) await assertBatchesAllowed(catalyst, [typedBatch], pl.design);
            const batchNumber = typedBatch || (await nextBatchNumber(catalyst, pl.design));
            const boxBrand = await brandOrNull(catalyst, l.box_brand);
            await ds.table("ProductionLog").insertRow({
              parent_log: id, entry_type: "record",
              design: pl.design || null, sales_order: pl.sales_order || null,
              order_item: pl.order_item || null, request_group: pl.request_group || null,
              qty_requested: 0, qty_boxes: delta, status: "Produced", stage: "Completed",
              batch_number: batchNumber,
              ...(boxBrand ? { box_brand: boxBrand } : {}),
              ...whField(l.warehouse || body.warehouse), // CR-329
              // CR-244: the Record Production sheet dates / notes each row itself.
              production_date: l.production_date ? String(l.production_date) : productionDate,
              shift: "", performed_by: performedBy,
              note: l.note != null ? String(l.note) : note,
            });
          }

          await ds.table("ProductionLog").updateRow({ ROWID: id, stage: "Completed" });
          await logTransition(catalyst, {
            entity_type: "ProductionLog", entity_rowid: id, from_status: "", to_status: "Stage: Completed", note,
          });
          completed += 1;
        }
        // Completed output flows to the palletization queue; a queue failure
        // never fails the completion itself.
        for (const oiId of touchedOrderItems) {
          try { await autoEnqueuePalletization(catalyst, ds, oiId); }
          catch (e) { console.error("auto-enqueue palletization failed", e); }
        }
        return { rowid: ids[0], data: { lines: completed } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Edit a production plan line — qty_requested / note. qty_requested can only
   change while nothing has been recorded against the line (no record children,
   no legacy qty_boxes) and must stay within the order line's remaining.
   body: { qty_requested?, note? } */
app.post("/production-update/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const rowid = req.params.rowid;
    const body = req.body || {};
    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "production-update", payload: { ROWID: rowid } },
      async () => {
        const pl = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, order_item, qty_boxes, entry_type FROM ProductionLog WHERE ROWID = ${rowid} AND deleted_at is null`,
          ),
        )[0];
        if (!pl) throw badRequest(`Production entry not found: ${rowid}`, 404);
        if (String(pl.entry_type || "plan") !== "plan") throw badRequest("Only plan lines can be edited");
        const patch = { ROWID: rowid };
        if (body.note != null) patch.note = String(body.note);
        if (body.qty_requested != null) {
          const next = nonNeg(body.qty_requested, "qty_requested");
          if (next <= 0) throw badRequest("qty_requested must be > 0");
          const recs = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ROWID FROM ProductionLog WHERE parent_log = ${rowid} AND entry_type = 'record' AND deleted_at is null`,
            ),
          );
          if (recs.length || (Number(pl.qty_boxes) || 0) > 0)
            throw badRequest("Cannot change quantity after output has been recorded", 409);
          const orderItemId = String(pl.order_item || "");
          if (orderItemId) {
            const oi = (await loadOrderItems(catalyst, [orderItemId], "ROWID, ordered_qty_boxes")).get(orderItemId);
            const ordered = oi ? Number(oi.ordered_qty_boxes) || 0 : 0;
            const others = rowList(
              await catalyst.zcql().executeZCQLQuery(
                `SELECT ROWID, qty_requested FROM ProductionLog WHERE entry_type = 'plan' AND deleted_at is null AND order_item = ${orderItemId}`,
              ),
            )
              .filter((r) => String(r.ROWID) !== String(rowid))
              .reduce((s, r) => s + (Number(r.qty_requested) || 0), 0);
            if (others + next > ordered)
              throw badRequest(`${next} exceeds the order's remaining (${others} already requested of ${ordered})`, 409);
          }
          patch.qty_requested = next;
        }
        await ds.table("ProductionLog").updateRow(patch);
        return { rowid };
      },
    );
    res.json({ ok: true, rowid: result.rowid });
  } catch (err) {
    sendErr(res, err);
  }
});

/* 3c. Load container — ContainerLoading + batch status + OrderItem.loaded + events.
   body: { container, batches: [batchId | {batch, position}], loaded_by? } */
app.post("/load-container", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const result = await withOpLog(
      catalyst,
      { table_name: "ContainerLoading", operation: "load-container", payload: body },
      async () => loadContainer(catalyst, ds, body),
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

async function loadContainer(catalyst, ds, body) {
  const containerId = body.container;
  if (!containerId) throw badRequest("container is required");
  const raw = Array.isArray(body.batches) ? body.batches : [];
  const batchIds = raw.map((b) => (b && typeof b === "object" ? b.batch : b)).map(String).filter(Boolean);
  if (!batchIds.length) throw badRequest("At least one batch is required");

  // Container + capacity (boxes/pallets legacy; area_sqm/max_weight nullable — Q1).
  const cRows = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, capacity_boxes, capacity_pallets, capacity_area_sqm, max_weight_kg, status FROM Container WHERE ROWID = ${containerId}`,
    ),
  );
  if (!cRows.length) throw badRequest(`Container not found: ${containerId}`, 404);
  const container = cRows[0];
  const capBoxes = Number(container.capacity_boxes) || 0;
  const capPallets = Number(container.capacity_pallets) || 0;
  const capArea = Number(container.capacity_area_sqm) || 0; // 0 = unconstrained
  const maxWeight = Number(container.max_weight_kg) || 0; // 0 = unconstrained

  // Per-batch area/weight derivation — same contract as fit.js/fitSuggest:
  // area = boxes × design.coverage_sqm; weight = boxes × design.box_weight_kg
  // + pallet.empty_pallet_weight_kg, or null when per-box weight uncalibrated.
  // CR-397: paged — the bare SELECT stopped at ZCQL's 300-row cap (items past it read 0 m²).
  const designs = await zcqlAllRows(catalyst, `SELECT ROWID, coverage_sqm, box_weight_kg FROM Design`);
  const dMap = new Map(designs.map((d) => [String(d.ROWID), { cov: Number(d.coverage_sqm) || 0, bw: Number(d.box_weight_kg) || 0 }]));
  const pals = await zcqlAllRows(catalyst, `SELECT ROWID, empty_pallet_weight_kg FROM Pallet`);
  const pMap = new Map(pals.map((p) => [String(p.ROWID), Number(p.empty_pallet_weight_kg) || 0]));
  const derive = (b) => {
    const d = dMap.get(String(b.design)) || { cov: 0, bw: 0 };
    const emptyW = pMap.get(String(b.pallet)) || 0;
    const boxes = Number(b.boxes_packed) || 0;
    return { boxes, areaSqm: boxes * d.cov, weightKg: d.bw > 0 ? boxes * d.bw + emptyW : null };
  };

  // Existing loadings on this container (count + boxes/area/weight already loaded).
  const existing = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT batch FROM ContainerLoading WHERE container = ${containerId} AND deleted_at is null`),
  );
  const existingSet = new Set(existing.map((r) => String(r.batch)));
  let loadedBoxes = 0;
  let loadedArea = 0;
  let loadedWeight = 0; // uncalibrated batches contribute nothing (null-skip)
  if (existing.length) {
    const exBatches = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT design, pallet, boxes_packed FROM PalletisedBatch WHERE ROWID IN (${existing.map((r) => String(r.batch)).join(",")})`,
      ),
    );
    for (const b of exBatches) {
      const der = derive(b);
      loadedBoxes += der.boxes;
      loadedArea += der.areaSqm;
      if (der.weightKg != null) loadedWeight += der.weightKg;
    }
  }
  const palletCount = existing.length;

  // New batches: exist, not already loaded.
  const nb = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, design, pallet, boxes_packed, status FROM PalletisedBatch WHERE ROWID IN (${batchIds.join(",")})`,
    ),
  );
  const nbMap = new Map(nb.map((b) => [String(b.ROWID), b]));
  let addBoxes = 0;
  let addArea = 0;
  let addWeight = 0;
  for (const bid of batchIds) {
    const b = nbMap.get(bid);
    if (!b) throw badRequest(`Batch not found: ${bid}`, 404);
    if (existingSet.has(bid) || String(b.status) === "loaded") throw badRequest(`Batch ${bid} already loaded`, 409);
    const der = derive(b);
    addBoxes += der.boxes;
    addArea += der.areaSqm;
    if (der.weightKg != null) addWeight += der.weightKg;
  }
  if (capBoxes && loadedBoxes + addBoxes > capBoxes) {
    throw badRequest(`Capacity exceeded: ${loadedBoxes}+${addBoxes} > ${capBoxes} boxes`, 409);
  }
  if (capPallets && palletCount + batchIds.length > capPallets) {
    throw badRequest(`Pallet capacity exceeded: ${palletCount}+${batchIds.length} > ${capPallets}`, 409);
  }
  if (capArea && loadedArea + addArea > capArea + 1e-9) {
    throw badRequest(`Area capacity exceeded: ${round2(loadedArea)}+${round2(addArea)} > ${capArea} m²`, 409);
  }
  if (maxWeight && loadedWeight + addWeight > maxWeight + 1e-9) {
    throw badRequest(`Weight capacity exceeded: ${round2(loadedWeight)}+${round2(addWeight)} > ${maxWeight} kg`, 409);
  }

  // --- writes (idempotency-guarded; double-load already rejected above) ---
  const loadingIds = [];
  const oiSet = new Set();
  for (let i = 0; i < batchIds.length; i++) {
    const bid = batchIds[i];
    const posSpec = raw[i] && typeof raw[i] === "object" && raw[i].position != null ? Number(raw[i].position) : palletCount + i + 1;
    const lr = await ds.table("ContainerLoading").insertRow({ container: containerId, batch: bid, position: posSpec });
    loadingIds.push(lr.ROWID);
    await ds.table("PalletisedBatch").updateRow({ ROWID: bid, status: "loaded" });
    const lineRows = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT order_item, boxes FROM PalletisedBatchLine WHERE batch = ${bid} AND deleted_at is null`,
      ),
    );
    for (const ln of lineRows) {
      oiSet.add(String(ln.order_item));
      await ds.table("OrderItemEvent").insertRow({
        order_item: ln.order_item,
        event_type: "loaded",
        qty_delta: Number(ln.boxes) || 0,
        performed_by: String(body.loaded_by || ""),
        note: `Container #${containerId}`,
      });
    }
  }
  await recountOrderItems(catalyst, ds, [...oiSet]);
  if (!container.status || String(container.status) === "planned") {
    await ds.table("Container").updateRow({ ROWID: containerId, status: "loading" });
  }
  return { rowid: containerId, data: { container: containerId, loaded_batches: batchIds.length, loading_ids: loadingIds } };
}

/* Dispatch a container — cascade dispatched_qty_boxes + close out the container. */
app.post("/dispatch/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const containerId = req.params.rowid;
    const result = await withOpLog(
      catalyst,
      { table_name: "Container", operation: "dispatch", payload: { containerId, ...body } },
      async () => dispatchContainer(catalyst, ds, containerId, body),
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

async function dispatchContainer(catalyst, ds, containerId, body) {
  const cRows = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, status FROM Container WHERE ROWID = ${containerId}`),
  );
  if (!cRows.length) throw badRequest(`Container not found: ${containerId}`, 404);
  if (String(cRows[0].status) === "dispatched") throw badRequest("Container already dispatched", 409); // idempotent
  const loadings = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT batch FROM ContainerLoading WHERE container = ${containerId} AND deleted_at is null`),
  );
  if (!loadings.length) throw badRequest("Container has no loaded pallets", 409);

  const oiSet = new Set();
  for (const ld of loadings) {
    const lineRows = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT order_item, boxes FROM PalletisedBatchLine WHERE batch = ${ld.batch} AND deleted_at is null`,
      ),
    );
    for (const ln of lineRows) {
      oiSet.add(String(ln.order_item));
      await ds.table("OrderItemEvent").insertRow({
        order_item: ln.order_item,
        event_type: "dispatched",
        qty_delta: Number(ln.boxes) || 0,
        performed_by: String(body.performed_by || ""),
        note: `Container #${containerId} dispatched`,
      });
    }
    await ds.table("PalletisedBatch").updateRow({ ROWID: ld.batch, status: "dispatched" });
  }
  // Recount AFTER every batch is flipped to dispatched — the recount reads batch status.
  await recountOrderItems(catalyst, ds, [...oiSet]);
  await ds.table("Container").updateRow({ ROWID: containerId, status: "dispatched" });
  return { rowid: containerId, data: { container: containerId, batches: loadings.length } };
}

/* Admin backfill: recount EVERY order item's shipping counters from ground
   truth. One-shot after deploying the recount migration; safe to re-run
   (idempotent). Chunks of 100 keep each recount's IN(...) line queries
   under ZCQL's 300-row cap. */
app.post("/recount-order-items", async (req, res) => {
  try {
    const catalyst = init(req);
    const u = req.appUser || {};
    if (String(u.role || "").trim().toLowerCase() !== "admin") throw badRequest("Admin only", 403);
    const ds = catalyst.datastore();
    const result = await withOpLog(
      catalyst,
      { table_name: "OrderItem", operation: "recount", payload: {} },
      async () => {
        let offset = 0;
        let scanned = 0;
        for (;;) {
          const rows = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ROWID FROM OrderItem WHERE deleted_at is null LIMIT ${offset}, 100`,
            ),
          );
          if (!rows.length) break;
          await recountOrderItems(catalyst, ds, rows.map((r) => r.ROWID));
          scanned += rows.length;
          offset += 100;
          if (rows.length < 100) break;
        }
        return { rowid: "", data: { scanned } };
      },
    );
    res.json({ ok: true, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* One-off (CR-209): the `%` wildcard bug minted LOAD/FY/001 for every loading.
   Renumber each LOAD/FY/ series that holds duplicates by CREATEDTIME (oldest =
   001). Idempotent — a series with no duplicates is left alone. Soft-deleted
   rows keep their place so a number is never reused. */
app.post("/renumber-loads", async (req, res) => {
  try {
    const catalyst = init(req);
    const u = req.appUser || {};
    if (String(u.role || "").trim().toLowerCase() !== "admin") throw badRequest("Admin only", 403);
    const ds = catalyst.datastore();
    const result = await withOpLog(
      catalyst,
      { table_name: "LoadBox", operation: "renumber-loads", payload: {} },
      async () => {
        const zcql = catalyst.zcql();
        const boxes = [];
        let offset = 0;
        for (;;) {
          const rows = rowList(
            await zcql.executeZCQLQuery(`SELECT ROWID, load_number, CREATEDTIME FROM LoadBox LIMIT ${offset}, 100`),
          );
          boxes.push(...rows);
          if (rows.length < 100) break;
          offset += 100;
        }
        const series = new Map(); // "LOAD/2026-27/" → rows
        for (const b of boxes) {
          const m = String(b.load_number || "").match(/^(LOAD\/\d{4}-\d{2}\/)\d+$/);
          if (m) (series.get(m[1]) ?? series.set(m[1], []).get(m[1])).push(b);
        }
        let updated = 0;
        for (const [prefix, rows] of series) {
          if (new Set(rows.map((r) => r.load_number)).size === rows.length) continue;
          rows.sort(
            (a, b) => String(a.CREATEDTIME).localeCompare(String(b.CREATEDTIME)) || Number(a.ROWID) - Number(b.ROWID),
          );
          for (let i = 0; i < rows.length; i++) {
            const load_number = `${prefix}${String(i + 1).padStart(3, "0")}`;
            if (rows[i].load_number === load_number) continue;
            await ds.table("LoadBox").updateRow({ ROWID: rows[i].ROWID, load_number });
            updated++;
          }
        }
        return { rowid: "", data: { scanned: boxes.length, updated } };
      },
    );
    res.json({ ok: true, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Repair (CR-249): un-boxed blank-batch plan lines whose item still has batched
   boxes waiting in the queue were minted by a hand-made plan BEFORE it learned to
   claim the queue — the item sits queued twice. Give each such line its batch +
   Box Brand from the queue (oldest first, splitting the line when it spans two
   batches) and shrink the queue by the same boxes. Idempotent: a line with
   nothing left to claim is skipped. body: { order_item? } narrows to one item. */
app.post("/reattribute-blank-lines", async (req, res) => {
  try {
    const catalyst = init(req);
    const u = req.appUser || {};
    if (String(u.role || "").trim().toLowerCase() !== "admin") throw badRequest("Admin only", 403);
    const ds = catalyst.datastore();
    const only = String((req.body || {}).order_item || "").replace(/[^0-9]/g, "");
    const result = await withOpLog(
      catalyst,
      { table_name: "PalletizationPlanLine", operation: "reattribute-blank-lines", payload: { order_item: only } },
      async () => {
        const zcql = catalyst.zcql();
        const t = ds.table("PalletizationPlanLine");
        const COLS = "ROWID, plan, sales_order, order_item, design, pallet, boxes, position, status, load_box, batch_number, box_brand, manual_edit, CREATEDTIME";
        // ponytail: one page of 300 — a repair for a handful of lines, page it if it ever outgrows that.
        const blanks = rowList(
          await zcql.executeZCQLQuery(
            `SELECT ${COLS} FROM PalletizationPlanLine WHERE load_box is null AND deleted_at is null${only ? ` AND order_item = ${only}` : ""} LIMIT 0, 300`,
          ),
        )
          .filter((l) => !String(l.batch_number || "") && /^\d+$/.test(String(l.order_item || "")))
          .sort((a, b) => String(a.CREATEDTIME).localeCompare(String(b.CREATEDTIME)));
        const report = [];
        const touched = new Set();
        for (const oi of [...new Set(blanks.map((l) => String(l.order_item)))]) {
          const live = rowList(
            await zcql.executeZCQLQuery(`SELECT ${QUEUE_COLS} FROM PalletizationPlanLine WHERE order_item = ${oi} AND deleted_at is null`),
          );
          const donors = new Map();
          for (const l of blanks.filter((x) => String(x.order_item) === oi)) {
            const claims = claimQueuedBatches(live, oi, Number(l.boxes) || 0, donors);
            if (!claims.length) continue;
            const rest = (Number(l.boxes) || 0) - claims.reduce((n, c) => n + c.take, 0);
            const stamp = (c) => ({ batch_number: c.batch, ...(c.brand ? { box_brand: c.brand } : {}), boxes: c.take });
            // First claim rewrites the line in place; further batches (and any unclaimed rest) become sibling slices.
            await t.updateRow({ ROWID: l.ROWID, ...stamp(claims[0]) });
            const copy = {
              plan: l.plan ? String(l.plan) : undefined,
              sales_order: l.sales_order ? String(l.sales_order) : undefined,
              order_item: oi,
              design: l.design ? String(l.design) : undefined,
              pallet: l.pallet ? String(l.pallet) : undefined,
              position: Number(l.position) || 0,
              status: String(l.status),
              ...(String(l.manual_edit || "") === "true" ? { manual_edit: "true" } : {}),
            };
            for (const c of claims.slice(1)) await t.insertRow({ ...copy, ...stamp(c) });
            if (rest > 0) await t.insertRow({ ...copy, batch_number: "", boxes: rest });
            report.push({ line: String(l.ROWID), status: String(l.status), batches: claims.map((c) => `${c.batch}:${c.take}`), unbatched: rest });
            touched.add(oi);
          }
          await shrinkDonors(ds, donors);
        }
        if (touched.size) await recountOrderItems(catalyst, ds, [...touched]);
        return { rowid: "", data: { scanned: blanks.length, repaired: report.length, report } };
      },
    );
    res.json({ ok: true, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Backfill: fill pallet on existing pallet-less plan lines — OrderItem.pallet
   first, else the design's size-default pallet (defaultPalletForDesign).
   Idempotent; unresolved = sizes with no Pallet master row (add one, re-run). */
app.post("/backfill-line-pallets", async (req, res) => {
  try {
    const catalyst = init(req);
    const u = req.appUser || {};
    if (String(u.role || "").trim().toLowerCase() !== "admin") throw badRequest("Admin only", 403);
    const ds = catalyst.datastore();
    const result = await withOpLog(
      catalyst,
      { table_name: "PalletizationPlanLine", operation: "backfill-pallets", payload: {} },
      async () => {
        const zcql = catalyst.zcql();
        // Collect the full pallet-less set BEFORE updating (offset paging over
        // a shrinking predicate would skip rows).
        const lines = [];
        let offset = 0;
        for (;;) {
          const rows = rowList(
            await zcql.executeZCQLQuery(
              `SELECT ROWID, order_item, design FROM PalletizationPlanLine WHERE pallet is null AND deleted_at is null LIMIT ${offset}, 100`,
            ),
          );
          lines.push(...rows);
          if (rows.length < 100) break;
          offset += 100;
        }
        const oiIds = [...new Set(lines.map((l) => String(l.order_item || "")).filter((x) => /^\d+$/.test(x)))];
        const oiPallet = new Map();
        for (let i = 0; i < oiIds.length; i += 50) {
          rowList(
            await zcql.executeZCQLQuery(
              `SELECT ROWID, pallet FROM OrderItem WHERE ROWID IN (${oiIds.slice(i, i + 50).join(",")})`,
            ),
          ).forEach((r) => oiPallet.set(String(r.ROWID), r.pallet ? String(r.pallet) : null));
        }
        const byDesign = new Map();
        let updated = 0;
        let unresolved = 0;
        for (const l of lines) {
          let pallet = oiPallet.get(String(l.order_item || "")) || null;
          if (!pallet) {
            const did = String(l.design || "");
            if (!byDesign.has(did)) byDesign.set(did, await defaultPalletForDesign(catalyst, did));
            pallet = byDesign.get(did);
          }
          if (!pallet) {
            unresolved++;
            continue;
          }
          await ds.table("PalletizationPlanLine").updateRow({ ROWID: l.ROWID, pallet });
          updated++;
        }
        return { rowid: "", data: { scanned: lines.length, updated, unresolved } };
      },
    );
    res.json({ ok: true, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ============================================================
   PHASE 5 — Invoicing
   ============================================================ */

/** Indian FY token for a date: Apr–Mar → "2026-27". */
function fyToken(d) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** "yyyy-MM-dd" for Catalyst date columns. */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Next document number from TransactionSeries (creates the series row on
 * first use). Format: `${prefix}${NN}/${fy_token}` e.g. "EX-14/2026-27".
 * Resets the counter when the financial year rolls over.
 */
async function nextSeriesNumber(catalyst, ds, docType, defaultPrefix) {
  const fy = fyToken(new Date());
  const rows = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, prefix, current_number, fy_token FROM TransactionSeries WHERE doc_type = '${docType}'`,
    ),
  );
  if (!rows.length) {
    const ins = await ds.table("TransactionSeries").insertRow({
      doc_type: docType,
      prefix: defaultPrefix,
      current_number: 1,
      fy_token: fy,
    });
    return { number: `${defaultPrefix}01/${fy}`, seriesRowid: String(ins.ROWID) };
  }
  const s = rows[0];
  const rolled = String(s.fy_token) !== fy;
  const n = rolled ? 1 : (Number(s.current_number) || 0) + 1;
  await ds.table("TransactionSeries").updateRow({ ROWID: s.ROWID, current_number: n, fy_token: fy });
  const prefix = String(s.prefix || defaultPrefix);
  return { number: `${prefix}${String(n).padStart(2, "0")}/${fy}`, seriesRowid: String(s.ROWID) };
}

/* Generate the export invoice for a loaded container (one per container).
   Total = Σ over every loaded batch line: boxes × OrderItem rate less the
   line's discount_pct. sales_order FK is set only when the whole container
   belongs to a single order; currency comes from that order (first found). */
app.post("/invoice-for-container/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const containerId = req.params.rowid;
    const result = await withOpLog(
      catalyst,
      { table_name: "Invoice", operation: "INSERT", payload: { containerId, ...body } },
      async () => invoiceForContainer(catalyst, ds, containerId, body),
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

async function invoiceForContainer(catalyst, ds, containerId, body) {
  const cRows = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, container_number, status FROM Container WHERE ROWID = ${containerId}`,
    ),
  );
  if (!cRows.length) throw badRequest(`Container not found: ${containerId}`, 404);

  // One invoice per container (idempotent).
  const existing = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, invoice_number FROM Invoice WHERE container = ${containerId} AND deleted_at is null`,
    ),
  );
  if (existing.length) {
    throw badRequest(`Container already invoiced (${existing[0].invoice_number})`, 409);
  }

  const loadings = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT batch FROM ContainerLoading WHERE container = ${containerId} AND deleted_at is null`),
  );
  if (!loadings.length) throw badRequest("Container has no loaded pallets", 409);

  // Sum value across every loaded batch line: boxes × line rate less discount.
  let total = 0;
  const soIds = new Set();
  for (const ld of loadings) {
    const lineRows = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT order_item, boxes FROM PalletisedBatchLine WHERE batch = ${ld.batch}`,
      ),
    );
    for (const ln of lineRows) {
      const oiRows = rowList(
        await catalyst.zcql().executeZCQLQuery(
          `SELECT ROWID, rate, discount_pct, sales_order FROM OrderItem WHERE ROWID = ${ln.order_item}`,
        ),
      );
      if (!oiRows.length) continue;
      const oi = oiRows[0];
      const boxes = Number(ln.boxes) || 0;
      const rate = Number(oi.rate) || 0;
      const disc = Number(oi.discount_pct) || 0;
      total += boxes * rate * (1 - disc / 100);
      if (oi.sales_order) soIds.add(String(oi.sales_order));
    }
  }
  total = round2(total);

  // Currency from the (first) order on board; FK only for single-order containers.
  let currency = "";
  const soList = [...soIds];
  if (soList.length) {
    const soRows = rowList(
      await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, currency FROM SalesOrder WHERE ROWID = ${soList[0]}`),
    );
    if (soRows.length) currency = String(soRows[0].currency || "");
  }

  const { number } = await nextSeriesNumber(catalyst, ds, "Invoice", "EX-");
  const payload = {
    invoice_number: number,
    invoice_date: String(body.invoice_date || "") || isoDate(new Date()),
    total_amount: total,
    currency,
    status: "issued",
    container: containerId,
  };
  if (soList.length === 1) payload.sales_order = soList[0];
  const ins = await ds.table("Invoice").insertRow(payload);

  return {
    rowid: String(ins.ROWID),
    data: {
      invoice_number: number,
      container: containerId,
      container_number: String(cRows[0].container_number || ""),
      total_amount: total,
      currency,
      orders_on_board: soList.length,
    },
  };
}

const { computeFit } = require("./lib/fit");

/* Container-fit suggester (greedy v2, read-only). "Containers shall not go
   empty": pack pending pallets into earliest-ETD containers under all active
   caps (slots / area / weight / boxes) simultaneously. Per-batch area+weight
   are derived from the batch's design+pallet, so mixed pallet types pack
   naturally. body: {} (no input needed). Returns { perContainer, unassigned }. */
app.post("/fit-suggest", async (req, res) => {
  try {
    const catalyst = init(req);
    const data = await fitSuggest(catalyst);
    res.json({ ok: true, data });
  } catch (err) {
    sendErr(res, err);
  }
});

async function fitSuggest(catalyst) {
  const zcql = catalyst.zcql();

  // Per-batch derivation lookups: design coverage + per-box weight; pallet empty weight.
  // CR-397: paged past ZCQL's 300-row cap (same fix as loadContainer).
  const designs = await zcqlAllRows(catalyst, `SELECT ROWID, coverage_sqm, box_weight_kg FROM Design`);
  const dMap = new Map(designs.map((d) => [String(d.ROWID), { cov: Number(d.coverage_sqm) || 0, bw: Number(d.box_weight_kg) || 0 }]));
  const pals = await zcqlAllRows(catalyst, `SELECT ROWID, empty_pallet_weight_kg FROM Pallet`);
  const pMap = new Map(pals.map((p) => [String(p.ROWID), Number(p.empty_pallet_weight_kg) || 0]));

  // areaSqm = boxes × coverage. weightKg null when per-box weight uncalibrated (Q1 deferred).
  const derive = (b) => {
    const d = dMap.get(String(b.design)) || { cov: 0, bw: 0 };
    const emptyW = pMap.get(String(b.pallet)) || 0;
    const boxes = Number(b.boxes_packed) || 0;
    return { boxes, areaSqm: boxes * d.cov, weightKg: d.bw > 0 ? boxes * d.bw + emptyW : null };
  };

  // Pending = closed batches not yet loaded into any container.
  const closed = rowList(await zcql.executeZCQLQuery(`SELECT ROWID, design, pallet, boxes_packed, is_demo, sales_order FROM PalletisedBatch WHERE status = 'closed' AND deleted_at is null`));
  const allLoadings = rowList(await zcql.executeZCQLQuery(`SELECT container, batch FROM ContainerLoading WHERE deleted_at is null`));
  const loadedSet = new Set(allLoadings.map((r) => String(r.batch)));

  // Cross-order tiers (§7.5, #10/#11): join batch → SalesOrder for customer + status.
  // A confirmed order ships first (tier 0); any non-confirmed order (draft/estimate)
  // only fills leftover space (tier 2); demo pallets are last (tier 3). A batch with
  // no linked order keeps legacy tier 0. NOTE: tier 1 ("same-customer secondary
  // confirmed" relative to a chosen focus order) needs focus-order mode — globally
  // every confirmed order is tier 0; tier 1 stays for the focus-order slice.
  const soIds = [...new Set(closed.map((b) => String(b.sales_order || "")).filter(Boolean))];
  const soMap = new Map();
  if (soIds.length) {
    const sos = rowList(await zcql.executeZCQLQuery(`SELECT ROWID, customer, status FROM SalesOrder WHERE ROWID IN (${soIds.join(",")})`));
    for (const s of sos) soMap.set(String(s.ROWID), { customer: String(s.customer || ""), status: String(s.status || "") });
  }
  const tierFor = (demo, soStatus) => {
    if (demo) return 3;
    if (!soStatus) return 0; // unlinked / legacy → current
    return soStatus.toLowerCase() === "confirmed" ? 0 : 2;
  };

  const batches = closed
    .filter((b) => !loadedSet.has(String(b.ROWID)))
    .map((b) => {
      const der = derive(b);
      const demo = b.is_demo === true || String(b.is_demo) === "true";
      const so = soMap.get(String(b.sales_order || "")) || { customer: "", status: "" };
      return {
        batch: String(b.ROWID),
        design: String(b.design || ""),
        customer: so.customer, // for §7.5 grouping / display
        boxes: der.boxes,
        areaSqm: der.areaSqm,
        weightKg: der.weightKg,
        tier: tierFor(demo, so.status),
      };
    });

  // Available containers: loading + planned. capacity_area_sqm / max_weight_kg are nullable.
  const cRows = rowList(
    await zcql.executeZCQLQuery(
      `SELECT ROWID, container_number, capacity_boxes, capacity_pallets, capacity_area_sqm, max_weight_kg, status, etd FROM Container WHERE (status = 'loading' OR status = 'planned') AND deleted_at is null`,
    ),
  );

  // Seed: load already committed to each container (derive area/weight from those batches too).
  const seedByC = new Map();
  if (loadedSet.size) {
    const loaded = rowList(
      await zcql.executeZCQLQuery(`SELECT ROWID, design, pallet, boxes_packed FROM PalletisedBatch WHERE ROWID IN (${[...loadedSet].join(",")})`),
    );
    const lbMap = new Map(loaded.map((b) => [String(b.ROWID), b]));
    for (const l of allLoadings) {
      const lb = lbMap.get(String(l.batch));
      if (!lb) continue;
      const der = derive(lb);
      const cid = String(l.container);
      const u = seedByC.get(cid) || { slots: 0, area: 0, weight: 0, boxes: 0 };
      u.slots += 1;
      u.area += der.areaSqm;
      u.weight += der.weightKg || 0;
      u.boxes += der.boxes;
      seedByC.set(cid, u);
    }
  }

  const containers = cRows.map((c) => {
    const cid = String(c.ROWID);
    return {
      container: cid,
      container_number: c.container_number || "",
      capPallets: Number(c.capacity_pallets) || 0,
      capAreaSqm: Number(c.capacity_area_sqm) || 0,
      maxWeightKg: Number(c.max_weight_kg) || 0,
      capBoxes: Number(c.capacity_boxes) || 0,
      status: String(c.status || ""),
      etd: String(c.etd || ""),
      seed: seedByC.get(cid),
    };
  });

  return computeFit(batches, containers);
}

/* ----------------------------------------------------------------
   Generic: list
   ---------------------------------------------------------------- */
app.get("/:table", async (req, res) => {
  try {
    const catalyst = init(req);
    const table = assertTable(req.params.table);
    // ZCQL hard-caps LIMIT at 300 rows per query; paginate via "LIMIT offset, count".
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 300);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    // Soft-deleted rows are hidden unless ?include_deleted=1 (OperationLog
    // has no deleted_at column, so it is never filtered).
    const clauses = [];
    if (req.query.where) {
      assertWhere(req.query.where);
      clauses.push(`(${req.query.where})`);
    }
    if (req.query.include_deleted !== "1" && table !== "OperationLog")
      clauses.push("deleted_at is null");
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    let order = "";
    if (req.query.order) {
      assertOrder(req.query.order);
      order = ` ORDER BY ${req.query.order}`;
    }
    // Optional column projection (?columns=a,b,c). Identifiers only — anything
    // else falls back to SELECT *. ROWID is always included so joins keep working.
    // CREATEDTIME/MODIFIEDTIME ride along on every query: ZCQL's SELECT *
    // omits them, and the client shows Created/Modified everywhere (2026-07).
    let cols = "*, CREATEDTIME, MODIFIEDTIME";
    if (req.query.columns) {
      const ids = String(req.query.columns)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length && ids.every((c) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(c))) {
        if (!ids.includes("ROWID")) ids.unshift("ROWID");
        for (const t of ["CREATEDTIME", "MODIFIEDTIME"]) if (!ids.includes(t)) ids.push(t);
        // The secret-row filter below needs the key — a projection must not hide it (CR-356).
        if (table === "AppSetting" && !ids.includes("setting_key")) ids.push("setting_key");
        cols = ids.join(", ");
      }
    }
    // CR-478: ?all=1 returns the WHOLE table in one response. The client used to
    // walk 300-row pages one HTTP round trip at a time (~1 s each on Catalyst);
    // Customer alone is 2,800+ rows = 10 serial trips on every list page. Here the
    // pages run in parallel against ZCQL after one COUNT, so it is ~1 trip total.
    if (req.query.all === "1") {
      const PAGE = 300, MAX_PAGES = 34; // ~10k rows safety valve, same as the client had
      const zcql = catalyst.zcql();
      const countRow = rowList(await zcql.executeZCQLQuery(`SELECT COUNT(ROWID) FROM ${table}${where}`))[0] || {};
      const total = Number(Object.values(countRow)[0]) || 0;
      const pages = Math.min(Math.ceil(total / PAGE), MAX_PAGES);
      const ord = order || " ORDER BY ROWID asc"; // LIMIT offset paging needs a stable order
      const chunks = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          zcql.executeZCQLQuery(`SELECT ${cols} FROM ${table}${where}${ord} LIMIT ${i * PAGE}, ${PAGE}`),
        ),
      );
      const seen = new Set();
      const rows = [];
      for (const r of chunks.flatMap(rowList)) {
        if (seen.has(String(r.ROWID)) || isSecretSetting(table, r)) continue;
        seen.add(String(r.ROWID));
        rows.push(r);
      }
      return res.json(total > pages * PAGE ? { ok: true, rows, truncated: true } : { ok: true, rows });
    }
    const lim = offset > 0 ? `${offset}, ${limit}` : `${limit}`;
    const sql = `SELECT ${cols} FROM ${table}${where}${order} LIMIT ${lim}`;
    const rows = rowList(await catalyst.zcql().executeZCQLQuery(sql)).filter((r) => !isSecretSetting(table, r));
    res.json({ ok: true, rows });
  } catch (err) {
    sendErr(res, err);
  }
});

/* AppSetting rows that hold secrets (the Zoho Books refresh token, CR-325) are
   written only by lib/zoho.js and never leave via the generic reads. */
const SECRET_SETTINGS = require("./lib/zoho").SECRET_SETTINGS;
const isSecretSetting = (table, row) => table === "AppSetting" && SECRET_SETTINGS.has(String(row.setting_key || ""));

/* CR-337: AppSetting keys only an Admin may write through the generic routes
   (a Staff user must not widen the Zoho sign-in allow-list). CR-356/359: every
   zoho_* row (tokens, orgs, sync watermarks) is server-owned — same rule. */
const ADMIN_SETTINGS = new Set([require("./lib/appauth").LOGIN_DOMAINS_KEY]);
const ZOHO_SETTING_PREFIX = require("./lib/zoho").SETTING_PREFIX;
function assertSettingWrite(req, key) {
  const role = String((req.appUser && req.appUser.role) || "").trim().toLowerCase();
  const k = String(key || "");
  // CR-445: org_* (branding / tax / bank) is Admin-only too.
  if (role !== "admin" && (ADMIN_SETTINGS.has(k) || k.startsWith(ZOHO_SETTING_PREFIX) || isOrgKey(k))) throw badRequest("Admin role required", 403);
}

/* ----------------------------------------------------------------
   Generic: single row
   ---------------------------------------------------------------- */
app.get("/:table/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const table = assertTable(req.params.table);
    const rid = rowidParam(req.params.rowid);
    const rows = rowList(
      await catalyst
        .zcql()
        .executeZCQLQuery(`SELECT *, CREATEDTIME, MODIFIEDTIME FROM ${table} WHERE ROWID = ${rid}`),
    );
    if (!rows.length || isSecretSetting(table, rows[0])) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, row: rows[0] });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Generic: insert
   ---------------------------------------------------------------- */
/* One-time (idempotent) re-sync: push every Size's packing defaults out to its
   Pallet snapshots (coverage + weight) and the Items' box weight (CR-391: item
   pcs/coverage are the item's own, untouched). Overwrites typed weights — warn
   before running. Registered before the generic POST /:table so its
   single-segment path isn't shadowed by it. */
/* CR-473: stamp an item code on every Design that has none (idempotent; Admin via ADMIN_ROUTES).
   Run once per target after the column + deploy; re-runs report stamped: 0. */
app.post("/backfill-item-codes", async (req, res) => {
  try {
    const catalyst = init(req);
    const rows = await zcqlAllRows(catalyst, "SELECT ROWID, design_name, size FROM Design WHERE item_code is null AND deleted_at is null");
    for (const r of rows) {
      await catalyst.datastore().table("Design").updateRow({ ROWID: r.ROWID, item_code: await nextItemCode(catalyst, r.design_name, r.size) });
    }
    delete _cache.Design;
    res.json({ ok: true, data: { stamped: rows.length } });
  } catch (err) {
    sendErr(res, err);
  }
});

app.post("/resync-size-snapshots", async (req, res) => {
  try {
    const catalyst = init(req);
    const sizes = rowList(await catalyst.zcql().executeZCQLQuery("SELECT ROWID FROM Size"));
    let designs = 0;
    let pallets = 0;
    for (const s of sizes) {
      const n = await propagateSizeSnapshots(catalyst, s.ROWID);
      designs += n.designs;
      pallets += n.pallets;
    }
    res.json({ ok: true, data: { sizes: sizes.length, designs, pallets } });
  } catch (err) {
    sendErr(res, err);
  }
});

/* State columns owned by the status-machine routes: [table, column, message].
   The generic CRUD may never write them — on update OR on insert (a forged
   insert would mint a pre-approved record and skip canApprove). One list for
   both verbs so they cannot drift apart. */
const STATE_COLUMNS = [
  ["Quote", "status", "Quote status cannot be set directly — use /quote-status"],
  ["Quote", "conversion_flag", "Quote status cannot be set directly — use /quote-status"],
  ["SalesOrder", "status", "Sales order status cannot be set directly — use /so-status"],
  ["PalletizationPlan", "status", "Palletization plan status cannot be set directly — use /pal-status"],
  ["PalletizationPlanLine", "status", "Palletization line status cannot be set directly — use /pal-line-status"],
  ["PalletizationPlanLine", "load_box", "Line box allocation cannot be set directly — use /pal-line-box"],
  ["PanelOrder", "status", "Panel order status cannot be set directly — use /panel-order-status"],
  ["PanelOrder", "checkpoints", "Panel order checkpoints are set via /panel-order-checkpoint"], // CR-313
  ["PanelOrder", "allocation", "Cut-piece booking is set via /panel-order-allocate"], // CR-312
  ["SampleOrder", "status", "Sample order status is derived by /panel-load-save"], // CR-316 / CR-347
  ["SampleOrder", "allocation", "Cut-piece booking is set via /sample-order-allocate"], // CR-487
  ["SampleOrderLine", "supplied_qty", "Supplies are recorded as loads via /panel-load-save"],
  ["SampleOrderLine", "supplied_on", "Supplies are recorded as loads via /panel-load-save"],
  ["Warehouse", "is_primary", "The primary warehouse is set via /warehouse-primary"], // CR-329
];
// The only state a generic insert may carry: the record's initial one.
// CR-302: empty — PanelOrder (born NewRequest) now inserts via /panel-order-save only.
const INSERT_INITIAL = {};
function assertNoStateWrite(table, row, isInsert) {
  for (const [t, col, msg] of STATE_COLUMNS) {
    const v = (row || {})[col];
    if (t !== table || v === undefined) continue;
    if (isInsert && INSERT_INITIAL[t] && [].concat(INSERT_INITIAL[t][col]).includes(v)) continue;
    throw badRequest(msg);
  }
}

app.post("/:table", async (req, res) => {
  try {
    const catalyst = init(req);
    const table = assertTable(req.params.table);
    if (table === "LoadBox") throw badRequest("Load boxes are managed via the /load-box routes");
    if (table === "PanelLine") throw badRequest("Panel lines are managed via /panel-save (they consume cut-piece stock)");
    // Born status, numbering and totals are decided server-side by these routes.
    if (table === "Quote") throw badRequest("Quotes are created via /quote-with-items");
    if (table === "SalesOrder") throw badRequest("Sales orders are created via /so-with-items or /convert-quote");
    if (table === "PanelOrder" || table === "PanelOrderLine") throw badRequest("Panel orders are created via /panel-order-save"); // CR-302
    if (table === "SampleOrder" || table === "SampleOrderLine") throw badRequest("Sample orders are created via /sample-order-save"); // CR-315
    if (table === "PanelLoad" || table === "PanelLoadLine") throw badRequest("Loads are recorded via /panel-load-save"); // CR-347
    // CR-306/307: the cut-piece item row and its ledger are route-only (closes DF-02 duplicate on-hand rows).
    if (table === "CutPieceStock" || table === "CutStockEntry") throw badRequest("Cut-piece stock is written via /cut-piece-save and /cut-stock-entry");
    const ds = catalyst.datastore();
    const body = req.body || {};
    const rows = Array.isArray(body.rows) ? body.rows : [body];
    if (table === "AppSetting") for (const r of rows) assertSettingWrite(req, r.setting_key); // CR-337

    const result = await withOpLog(
      catalyst,
      { table_name: table, operation: "insert", payload: body },
      async () => {
        // Reject inserts that collide with an existing row on the table's natural key.
        const nk = NATURAL_KEY[table];
        for (const r of rows) {
          assertNoStateWrite(table, r, true);
          assertNoNegatives(r); // rule #5: no negative numeric values
          normalizeNames(table, r); // CR-429: names are stored Title Case (before the natural-key check)
          if (table === "Design") {
            stampDesignCoverage(r); // CR-391
            delete r.item_code; // CR-473: server-minted, never typed
            r.item_code = await nextItemCode(catalyst, r.design_name, r.size);
          }
          if (table === "Warehouse" && rowidParam(r.parent)) {
            // CR-409: a Location sits in a top-level warehouse — one level only.
            const p = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT parent FROM Warehouse WHERE ROWID = ${rowidParam(r.parent)} AND deleted_at is null`))[0];
            if (!p) throw badRequest("Warehouse not found", 404);
            if (rowidParam(p.parent)) throw badRequest("A location can't hold locations — pick the warehouse itself");
          }
          if (nk) await assertUnique(catalyst, table, nk, r[nk], undefined, table === "Warehouse" ? warehouseSiblingScope(r.parent) : "");
        }
        const inserted = await ds.table(table).insertRows(rows);
        const ids = (Array.isArray(inserted) ? inserted : [inserted]).map((r) => r.ROWID);
        delete _cache[table]; // FK-name lookup map is now stale
        return { rowid: ids[0], data: { rowids: ids } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* Size owns the per-box packing DEFAULTS: Pallet snapshots coverage + box
   weight; the Item takes only the box-weight default (CR-391 — its pcs/box and
   coverage are its own). Push a Size edit out to every row referencing that
   Size so the default stays global instead of frozen on the copy.
   Box weight is the one exception (CR 2026-09-10): it's manually overridable
   on Item/Pallet, so when `oldBw` is known the fan-out only rewrites rows
   still carrying the old Size default (or blank) — a manual value survives.
   Without oldBw (insert path, /resync-size-snapshots backfill) it overwrites
   everything, matching the resync route's documented behaviour.
   ponytail: row-by-row (not atomic) — the re-sync route below is idempotent
   and re-runs fix any partial fan-out. */
async function propagateSizeSnapshots(catalyst, sizeId, oldBw) {
  const ds = catalyst.datastore();
  const size = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT box_weight_kg, sqm_per_box, sqft_per_box FROM Size WHERE ROWID = ${sizeId}`,
    ),
  )[0];
  if (!size) return { designs: 0, pallets: 0 };
  const bw = Number(size.box_weight_kg) || 0;
  const sqm = Number(size.sqm_per_box) || 0;
  const sqft = Number(size.sqft_per_box) || 0;
  const keepManualBw = (rowBw) => {
    if (oldBw === undefined) return false; // no old value known → overwrite all
    const cur = Number(rowBw) || 0;
    return cur !== 0 && cur !== oldBw; // a manual override → leave it alone
  };
  const designs = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, box_weight_kg FROM Design WHERE size = ${sizeId}`),
  );
  // CR-391: pcs_per_box and coverage_* are the ITEM's own (typed per item; coverage =
  // its w × l × pcs, see stampDesignCoverage) — only the box-weight default fans out.
  for (const d of designs)
    if (!keepManualBw(d.box_weight_kg)) await ds.table("Design").updateRow({ ROWID: d.ROWID, box_weight_kg: bw });
  const pallets = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, box_weight_kg FROM Pallet WHERE size = ${sizeId}`),
  );
  for (const p of pallets)
    await ds.table("Pallet").updateRow({
      ROWID: p.ROWID,
      ...(keepManualBw(p.box_weight_kg) ? {} : { box_weight_kg: bw }),
      coverage_sqm: sqm, coverage_sqft: sqft,
    });
  return { designs: designs.length, pallets: pallets.length };
}

/* ----------------------------------------------------------------
   Generic: update
   ---------------------------------------------------------------- */
app.patch("/:table/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const table = assertTable(req.params.table);
    const ds = catalyst.datastore();
    const rid = rowidParam(req.params.rowid);
    const patch = { ...(req.body || {}), ROWID: rid };
    // _reason is an audit-only note (e.g. an admin editing locked opening stock):
    // it stays in the OperationLog payload below but is not a column.
    delete patch._reason;

    const result = await withOpLog(
      catalyst,
      { table_name: table, operation: "update", payload: req.body },
      async () => {
        // Quote/SO/plan/panel-order state lives behind the status-machine endpoints.
        assertNoStateWrite(table, patch, false);
        if (table === "AppSetting") {
          // CR-337: the key lives on the row, not in the patch.
          const cur = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT setting_key FROM AppSetting WHERE ROWID = ${rid}`))[0];
          assertSettingWrite(req, (cur && cur.setting_key) || patch.setting_key);
        }
        if (table === "PanelLine")
          throw badRequest("Panel lines are managed via /panel-save (they consume cut-piece stock)");
        if (table === "PanelOrderLine")
          throw badRequest("Panel order lines are managed via /panel-order-save"); // CR-302
        if (table === "SampleOrder" || table === "SampleOrderLine")
          throw badRequest("Sample orders are edited via /sample-order-save"); // CR-315
        if (table === "PanelLoad" || table === "PanelLoadLine") throw badRequest("Loads are recorded via /panel-load-save — remove and re-record to change one"); // CR-347
        if (table === "CutPieceStock" || table === "CutStockEntry")
          throw badRequest("Cut-piece stock moves via /cut-stock-entry; weight via /cut-piece-save"); // CR-306/307
        if (table === "LoadBox")
          throw badRequest("Load boxes are managed via the /load-box routes");
        // Batch-tracking can't flip once the item carries stock — opening would
        // then have two sources (accounting_stock AND opening rows). Only guards
        // an actual change of value (every Design save sends is_batched).
        if (table === "Design" && patch.is_batched !== undefined) {
          const prev = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT is_batched, accounting_stock FROM Design WHERE ROWID = ${rid}`,
            ),
          )[0];
          const was = String(prev && prev.is_batched) === "true";
          const now = patch.is_batched === true || String(patch.is_batched) === "true";
          if (was !== now) {
            const hasStock = (Number(prev && prev.accounting_stock) || 0) > 0;
            const logs = rowList(
              await catalyst.zcql().executeZCQLQuery(
                `SELECT ROWID FROM ProductionLog WHERE design = ${rid} AND (entry_type = 'record' OR entry_type = 'opening' OR entry_type = 'adjust' OR entry_type = 'transfer') AND deleted_at is null LIMIT 1`,
              ),
            );
            if (hasStock || logs.length)
              throw badRequest("Can't change batch-tracking once this item has stock or production history", 409);
          }
        }
        // Reject natural-key changes that collide with a different existing row.
        assertNoNegatives(req.body); // rule #5: no negative numeric values
        normalizeNames(table, patch); // CR-429: names are stored Title Case (before the natural-key check)
        const nk = NATURAL_KEY[table];
        if (nk && patch[nk] !== undefined) {
          let scope = "";
          if (table === "Warehouse") {
            // CR-409: names are unique among siblings; `parent` itself never moves via PATCH.
            if (patch.parent !== undefined) throw badRequest("A location stays in its warehouse — delete and recreate it to move it");
            const cur = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT parent FROM Warehouse WHERE ROWID = ${rid}`))[0];
            scope = warehouseSiblingScope(cur && cur.parent);
          }
          await assertUnique(catalyst, table, nk, patch[nk], rid, scope);
        } else if (table === "Warehouse" && patch.parent !== undefined) {
          throw badRequest("A location stays in its warehouse — delete and recreate it to move it"); // CR-409
        }
        // OrderItem stage flips get a StatusTransition row; this PATCH is
        // the one path all client stage writes converge on.
        const transCol = table === "OrderItem" && patch.stage !== undefined ? "stage" : null;
        let transFrom = null;
        if (transCol) {
          const prev = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ${transCol} FROM ${table} WHERE ROWID = ${rid}`,
            ),
          )[0];
          transFrom = prev ? String(prev[transCol] || "") : "";
        }
        // Capture the pre-edit Size box weight so the fan-out below can tell a
        // row still on the old default apart from a manual override (CR).
        let oldSizeBw;
        if (table === "Size" && patch.box_weight_kg !== undefined) {
          const prev = rowList(
            await catalyst.zcql().executeZCQLQuery(`SELECT box_weight_kg FROM Size WHERE ROWID = ${rid}`),
          )[0];
          oldSizeBw = Number(prev && prev.box_weight_kg) || 0;
        }
        if (table === "Design") {
          stampDesignCoverage(patch); // CR-391: coverage from the item's own w × l × pcs
          delete patch.item_code; // CR-473: never typed; a pre-CR-473 row gets its code on its first edit
          const cur = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT item_code, design_name, size FROM Design WHERE ROWID = ${rid}`))[0];
          if (cur && !cur.item_code) patch.item_code = await nextItemCode(catalyst, patch.design_name ?? cur.design_name, patch.size ?? cur.size);
        }
        const row = await ds.table(table).updateRow(patch);
        // Size edits fan out to the Item + Pallet packing-data snapshots.
        if (table === "Size") await propagateSizeSnapshots(catalyst, rid, oldSizeBw);
        if (transCol)
          await logTransition(catalyst, {
            entity_type: table, entity_rowid: rid,
            from_status: transFrom, to_status: String(patch[transCol] || ""),
          });
        delete _cache[table]; // FK-name lookup map is now stale
        return { rowid: (row && row.ROWID) || rid, data: row };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Delete one SO line item. Unlike the generic delete (which blocks while
   production references the line), this DISASSOCIATES any linked production:
   its sales_order/order_item FKs are nulled so it becomes an Independent
   (make-to-stock) production, an activity entry is logged, the line is
   soft-deleted, and the SO total is recomputed over the remaining lines.
   Refuses to remove the order's last line (an SO must keep ≥1 line item).
   ---------------------------------------------------------------- */
app.post("/delete-order-item/:id", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const zcql = catalyst.zcql();
    const oiId = String(req.params.id).replace(/[^0-9]/g, ""); // ROWIDs are numeric
    const reason = deleteReason(req, "OrderItem"); // CR-270 (was missing — CR-336 drive-by)

    const [line] = rowList(
      await zcql.executeZCQLQuery(
        `SELECT ROWID, sales_order FROM OrderItem WHERE ROWID = ${oiId} AND deleted_at is null LIMIT 1`,
      ),
    );
    if (!line) throw badRequest("Order line not found", 404);
    const soId = String(line.sales_order || "").replace(/[^0-9]/g, "");

    // Keep at least one line on the order.
    if (soId) {
      const siblings = rowList(
        await zcql.executeZCQLQuery(
          `SELECT ROWID FROM OrderItem WHERE sales_order = ${soId} AND deleted_at is null`,
        ),
      );
      if (siblings.length <= 1) throw badRequest("An order must keep at least one line item.", 409);
    }

    // Disassociate any production still linked to this line (→ Independent).
    const prod = rowList(
      await zcql.executeZCQLQuery(
        `SELECT ROWID FROM ProductionLog WHERE order_item = ${oiId} AND deleted_at is null`,
      ),
    );
    for (const p of prod) {
      await ds.table("ProductionLog").updateRow({ ROWID: p.ROWID, sales_order: null, order_item: null });
      await logTransition(catalyst, {
        entity_type: "ProductionLog",
        entity_rowid: p.ROWID,
        from_status: "SO-linked",
        to_status: "Independent",
        note: `SO line ${oiId} removed — production is now independent (make-to-stock).`,
      });
    }
    if (prod.length) {
      await writeOpLog(catalyst, {
        table_name: "ProductionLog",
        operation: "disassociate",
        entity_rowid: oiId,
        status: "success",
        actor: await currentActor(catalyst),
        payload_summary: summarize({ order_item: oiId, sales_order: soId, disassociated: prod.map((p) => p.ROWID) }),
      });
    }

    // Soft-delete the line.
    await ds.table("OrderItem").updateRow({
      ROWID: oiId,
      deleted_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    });
    delete _cache.OrderItem;

    // Recompute the SO total over the remaining lines + doc-level charges.
    if (soId) {
      const remaining = rowList(
        await zcql.executeZCQLQuery(
          `SELECT sub_total FROM OrderItem WHERE sales_order = ${soId} AND deleted_at is null`,
        ),
      );
      const lineSub = remaining.reduce((s, r) => s + (Number(r.sub_total) || 0), 0);
      const [so] = rowList(
        await zcql.executeZCQLQuery(
          `SELECT discount, adjustment, tax_type, tax_pct FROM SalesOrder WHERE ROWID = ${soId} LIMIT 1`,
        ),
      );
      const doc = docCompute(lineSub, so || {});
      await ds.table("SalesOrder").updateRow({ ROWID: soId, total_amount: doc.total_amount, tax_amount: doc.tax_amount });
      delete _cache.SalesOrder;
    }

    await writeOpLog(catalyst, {
      table_name: "OrderItem",
      operation: "soft-delete",
      entity_rowid: oiId,
      status: "success",
      actor: await currentActor(catalyst),
      payload_summary: summarize({ rowid: oiId, reason, disassociatedProduction: prod.length }),
    });

    res.json({ ok: true, rowid: oiId, data: { disassociated: prod.length } });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Generic: delete (soft). Sets deleted_at instead of removing the row,
   so FK CASCADE/SET-NULL never fires and the row stays restorable.
   ?hard=1 forces a real deleteRow. OperationLog has no deleted_at
   (append-only log) so it always hard-deletes.
   ---------------------------------------------------------------- */
app.delete("/:table/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const table = assertTable(req.params.table);
    if (table === "LoadBox") throw badRequest("Load boxes are managed via the /load-box routes");
    const ds = catalyst.datastore();
    const hard = req.query.hard === "1" || table === "OperationLog";
    // Soft panel deletes must go through /panel-delete so pieces return to
    // stock; ?hard=1 stays open for admin/e2e cleanup (no stock movement).
    if (!hard && (table === "Panel" || table === "PanelLine"))
      throw badRequest("Panels are deleted via /panel-delete (returns pieces to cut stock)");
    // CR-302: panel orders delete with their lines, only while New / Received.
    if (!hard && (table === "PanelOrder" || table === "PanelOrderLine"))
      throw badRequest("Panel orders are deleted via /panel-order-delete");
    if (!hard && (table === "SampleOrder" || table === "SampleOrderLine"))
      throw badRequest("Sample orders are deleted via /sample-order-delete"); // CR-315
    if (!hard && (table === "PanelLoad" || table === "PanelLoadLine")) throw badRequest("Loads are removed via /panel-load-delete"); // CR-347
    if (!hard && (table === "CutPieceStock" || table === "CutStockEntry"))
      throw badRequest("Cut pieces are removed via /cut-piece-delete"); // CR-306

    // HARD delete-guard: refuse to delete a record still referenced by a
    // DOWNSTREAM transaction (its own line items don't count — a Quote owns
    // QuoteItems, a SalesOrder owns OrderItems, blocking on those would make
    // every quote/SO undeletable). Not bypassable by ?hard=1.
    const rid = String(req.params.rowid).replace(/[^0-9]/g, ""); // ROWIDs are numeric
    const reason = table === "PalletizationPlan" && !hard ? requireReason(req, "to delete a palletization") : deleteReason(req, table); // CR-370: every role
    // Same rule as the SO form (CR-232): once any line has work — allocated,
    // palletised, loaded, dispatched or sitting on a plan — the order is
    // history, not a draft. Cancel it; never delete it.
    if (table === "SalesOrder") {
      const worked = rowList(await catalyst.zcql().executeZCQLQuery(
        `SELECT ROWID FROM OrderItem WHERE sales_order = ${rid} AND deleted_at is null AND (produced_qty_boxes > 0 OR purchased_qty_boxes > 0 OR palletized_qty_boxes > 0 OR loaded_qty_boxes > 0 OR dispatched_qty_boxes > 0) LIMIT 1`,
      ));
      const planned = worked.length ? [] : rowList(await catalyst.zcql().executeZCQLQuery(
        `SELECT ROWID FROM PalletizationPlanLine WHERE sales_order = ${rid} AND deleted_at is null LIMIT 1`,
      ));
      if (worked.length || planned.length)
        throw badRequest("Work is recorded on this order — it can't be deleted. Cancel it instead.", 409);
    }
    if (table === "Warehouse") {
      const w = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT is_primary FROM Warehouse WHERE ROWID = ${rid}`))[0];
      if (w && (w.is_primary === true || String(w.is_primary) === "true"))
        throw badRequest("The primary warehouse can't be deleted — mark another warehouse as primary first", 409); // CR-329
    }
    const blockers = BLOCK_DELETE[table];
    if (blockers) {
      const used = [];
      for (const [child, col, label] of blockers) {
        const rows = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID FROM ${child} WHERE ${col} = ${rid} AND deleted_at is null LIMIT 1`,
          ),
        );
        if (rows.length) used.push(label);
      }
      if (used.length)
        throw badRequest(
          `Cannot delete — still used by ${[...new Set(used)].join(", ")}. ` +
            `Remove or reassign those first.`,
          409,
        );
    }

    const result = await withOpLog(
      catalyst,
      {
        table_name: table,
        operation: hard ? "delete" : "soft-delete",
        payload: { rowid: rid, reason },
      },
      async () => {
        if (!hard && table === "PalletizationPlan") await discardPlanLines(catalyst, ds, rid, reason); // CR-370: lines → free stock first
        if (hard) {
          await ds.table(table).deleteRow(rid);
        } else {
          await ds.table(table).updateRow({
            ROWID: rid,
            deleted_at: new Date().toISOString().slice(0, 19).replace("T", " "),
          });
        }
        delete _cache[table]; // FK-name lookup map is now stale
        // Deleting a plan/batch header removes its boxes from the pipeline —
        // reconcile the affected order items' counters.
        await recountAfterParentToggle(catalyst, ds, table, rid);
        return { rowid: rid };
      },
    );
    res.json({ ok: true, rowid: result.rowid });
  } catch (err) {
    sendErr(res, err);
  }
});

/** After soft-delete/restore of a PalletizationPlan or PalletisedBatch header,
    recount the order items its lines reference. No-op for other tables. */
async function recountAfterParentToggle(catalyst, ds, table, rid) {
  const childOf = {
    PalletizationPlan: ["PalletizationPlanLine", "plan"],
    PalletisedBatch: ["PalletisedBatchLine", "batch"],
  };
  const spec = childOf[table];
  if (!spec) return;
  const lines = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT order_item FROM ${spec[0]} WHERE ${spec[1]} = ${rid} AND deleted_at is null`,
    ),
  );
  await recountOrderItems(catalyst, ds, lines.map((l) => l.order_item));
}

/* ----------------------------------------------------------------
   Generic: restore a soft-deleted row.
   ---------------------------------------------------------------- */
app.post("/:table/:rowid/restore", async (req, res) => {
  try {
    const catalyst = init(req);
    const table = assertTable(req.params.table);
    const ds = catalyst.datastore();
    const rid = rowidParam(req.params.rowid);

    const result = await withOpLog(
      catalyst,
      { table_name: table, operation: "restore", payload: { rowid: rid } },
      async () => {
        await ds.table(table).updateRow({ ROWID: rid, deleted_at: null });
        await recountAfterParentToggle(catalyst, ds, table, rid);
        return { rowid: rid };
      },
    );
    res.json({ ok: true, rowid: result.rowid });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   One-shot seeding (idempotent) — populates the FK parents the
   Quotes/Sales-Orders slice references. Two-segment path so it never
   collides with the generic single-segment POST /:table route. Safe to
   call repeatedly: existing rows (matched by natural key) are skipped.

   body: { sizes, finishes, brands, categories, glazes, grades,
           paymentTerms, customers:[{code,name,country_code,currency}],
           designs:[{design_name,unique_name,size,finish,brand,category,
                     glaze,grade,pcs_per_box,box_weight_kg,coverage_sqm,
                     coverage_sqft,rate_per_sqft,rate_per_sqmt}] }
   ---------------------------------------------------------------- */
app.post("/seed/masters", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const b = req.body || {};
    const out = {};

    // Seed a single-key lookup table; skip values already present.
    // Most lookups key on `code`; PaymentTerm keys on `name`.
    async function seedLookup(table, names, keyField) {
      if (!Array.isArray(names) || !names.length) return { added: 0, total: 0 };
      const existing = await buildMap(
        catalyst,
        `SELECT ROWID, ${keyField} FROM ${table}`,
        [keyField],
        "ROWID",
      );
      const toAdd = names.filter((n) => !existing.has(String(n).toLowerCase()));
      if (toAdd.length) await ds.table(table).insertRows(toAdd.map((v) => ({ [keyField]: v })));
      return { added: toAdd.length, total: existing.size + toAdd.length };
    }

    // Only Size keys on `code`; every other lookup keys on `name`.
    out.Size = await seedLookup("Size", b.sizes, "code");
    out.Finish = await seedLookup("Finish", b.finishes, "name");
    out.Brand = await seedLookup("Brand", b.brands, "name");
    out.Category = await seedLookup("Category", b.categories, "name");
    out.Glaze = await seedLookup("Glaze", b.glazes, "name");
    out.Grade = await seedLookup("Grade", b.grades, "name");
    out.PaymentTerm = await seedLookup("PaymentTerm", b.paymentTerms, "name");

    // Customers — natural key = code.
    if (Array.isArray(b.customers) && b.customers.length) {
      const exC = await buildMap(catalyst, "SELECT ROWID, code FROM Customer", ["code"], "ROWID");
      const add = b.customers.filter((c) => !exC.has(String(c.code).toLowerCase()));
      if (add.length)
        await ds.table("Customer").insertRows(
          add.map((c) => ({
            code: c.code,
            name: c.name,
            country_code: c.country_code || "",
            currency: c.currency || "INR",
            active: true,
          })),
        );
      out.Customer = { added: add.length, total: exC.size + add.length };
    }

    // Designs — natural key = unique_name; resolve lookup FKs by name.
    if (Array.isArray(b.designs) && b.designs.length) {
      // Refresh lookup maps now that lookups are seeded.
      const [szM, fnM, brM, ctM, glM, grM] = await Promise.all([
        buildMap(catalyst, "SELECT ROWID, code FROM Size", ["code"], "ROWID"),
        buildMap(catalyst, "SELECT ROWID, name FROM Finish", ["name"], "ROWID"),
        buildMap(catalyst, "SELECT ROWID, name FROM Brand", ["name"], "ROWID"),
        buildMap(catalyst, "SELECT ROWID, name FROM Category", ["name"], "ROWID"),
        buildMap(catalyst, "SELECT ROWID, name FROM Glaze", ["name"], "ROWID"),
        buildMap(catalyst, "SELECT ROWID, name FROM Grade", ["name"], "ROWID"),
      ]);
      const exD = await buildMap(
        catalyst,
        "SELECT ROWID, unique_name FROM Design",
        ["unique_name"],
        "ROWID",
      );
      const add = b.designs.filter((d) => !exD.has(String(d.unique_name).toLowerCase()));
      if (add.length)
        await ds.table("Design").insertRows(
          add.map((d) => ({
            design_name: d.design_name,
            unique_name: d.unique_name,
            base_design_name: d.design_name,
            size: resolve(szM, d.size),
            finish: resolve(fnM, d.finish),
            brand: resolve(brM, d.brand),
            category: resolve(ctM, d.category),
            glaze: resolve(glM, d.glaze),
            grade: resolve(grM, d.grade),
            pcs_per_box: Number(d.pcs_per_box) || 0,
            box_weight_kg: Number(d.box_weight_kg) || 0,
            coverage_sqm: Number(d.coverage_sqm) || 0,
            coverage_sqft: Number(d.coverage_sqft) || 0,
            rate_per_sqft: Number(d.rate_per_sqft) || 0,
            rate_per_sqmt: Number(d.rate_per_sqmt) || 0,
            status: "Active",
          })),
        );
      out.Design = { added: add.length, total: exD.size + add.length };
      // Bust cached design map so subsequent quote inserts see new rows.
      delete _cache.Design;
      delete _cache.Customer;
    }

    res.json({ ok: true, seeded: out });
  } catch (err) {
    sendErr(res, err);
  }
});

module.exports = app;

