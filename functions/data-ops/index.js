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
  const rows = await catalyst.zcql().executeZCQLQuery(sql);
  const map = new Map();
  for (const r of rows) {
    // ZCQL returns rows keyed by table name; grab the first (only) table block.
    const rec = r[Object.keys(r)[0]];
    const id = rec[valueField];
    for (const kf of keyFields) {
      const k = rec[kf];
      if (k != null && k !== "") map.set(String(k).toLowerCase(), String(id));
    }
  }
  return map;
}

async function designMap(catalyst) {
  if (!_cache.Design)
    _cache.Design = await buildMap(
      catalyst,
      "SELECT ROWID, design_name, unique_name FROM Design WHERE deleted_at is null",
      ["design_name", "unique_name"],
      "ROWID",
    );
  return _cache.Design;
}
async function customerMap(catalyst) {
  if (!_cache.Customer)
    _cache.Customer = await buildMap(
      catalyst,
      "SELECT ROWID, name, code FROM Customer WHERE deleted_at is null",
      ["name", "code"],
      "ROWID",
    );
  return _cache.Customer;
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
  ],
  Quote: [["SalesOrder", "quote", "sales order"]], // downstream conversion; NOT QuoteItem (no line-delete UI yet)
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
async function assertUnique(catalyst, table, field, value, excludeRowid) {
  if (value == null || String(value).trim() === "") return;
  const safe = String(value).replace(/'/g, "''"); // ZCQL string-literal escape
  // Ignore soft-deleted rows so a deleted name can be re-used (every table
  // here has deleted_at; assertUnique is never called on OperationLog).
  const rows = rowList(
    await catalyst
      .zcql()
      .executeZCQLQuery(`SELECT ROWID FROM ${table} WHERE ${field} = '${safe}' AND deleted_at is null`),
  );
  if (rows.some((r) => String(r.ROWID) !== String(excludeRowid || ""))) {
    throw badRequest(`${table} ${field} "${value}" already exists`, 409);
  }
}

/* Fields that are legitimately signed (deltas / doc adjustments) — exempt
   from the app-wide no-negative-numbers rule (persistent rule #5). */
const SIGNED_FIELDS = new Set(["adjustment", "qty_delta"]);

/** Throw 400 if any numeric value in the payload is negative (rule #5).
    Covers both real numbers and numeric strings; SIGNED_FIELDS exempt. */
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
const EXT_MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
};
app.get("/public/design-image/:fileId", async (req, res) => {
  try {
    const catalyst = init(req);
    const folder = catalyst.filestore().folder(DESIGN_IMAGES_FOLDER);
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
    stream.pipe(res);
  } catch (err) {
    res.status(404).json({ ok: false, error: "Image not found" });
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

/* Cron entry point (URL-type Catalyst cron) — gated by FX_CRON_KEY,
   registered before the auth guard because the cron can't send app tokens. */
app.get("/cron/fx-refresh", async (req, res) => {
  try {
    const key = process.env.FX_CRON_KEY;
    if (!key || req.query.key !== key) return res.status(403).json({ ok: false, error: "Forbidden" });
    res.json(await refreshFxRates(init(req)));
  } catch (err) {
    sendErr(res, err);
  }
});

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
      `SELECT ROWID, box_number, vehicle, container_number, status, dispatch_date FROM LoadBox WHERE share_token = '${token}' AND deleted_at is null`,
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
require("./lib/appauth").register(app, { init, rowList, sendErr });

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
    const safeName =
      String(name || "image.jpg")
        .replace(/[\\/\x00-\x1f]/g, "")
        .trim() || "image.jpg";
    const buf = Buffer.from(String(data), "base64");
    if (!buf.length) throw badRequest("Empty image");
    if (buf.length > 8 * 1024 * 1024) throw badRequest("Image exceeds 8MB");
    tmpPath = pathlib.join(os.tmpdir(), `${crypto.randomBytes(8).toString("hex")}-${safeName}`);
    fs.writeFileSync(tmpPath, buf);
    const catalyst = init(req);
    const uploaded = await catalyst
      .filestore()
      .folder(DESIGN_IMAGES_FOLDER)
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
    const dMap = await designMap(catalyst);
    const cMap = await customerMap(catalyst);
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

        const doc = docCompute(total, body);
        const quoteRow = await ds.table("Quote").insertRow({
          quote_number: body.quote_number || "",
          customer,
          quote_date: body.quote_date || undefined,
          // date column rejects "" → omit (undefined) when blank.
          expiry_date: body.expiry_date || undefined,
          payment_term: paymentTerm,
          port_of_discharge: body.port_of_discharge || "",
          // Every quote is born Draft — approval is mandatory before Sent,
          // so a crafted create can't mint a pre-approved quote.
          status: "Draft",
          currency: body.currency || "INR",
          exchange_rate: Number(body.exchange_rate) || 1,
          remarks: body.remarks || "",
          address: body.address || "",
          shipping_address: body.shipping_address || "",
          sales_person: salesPerson || undefined,
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

        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          await ds.table("QuoteItem").insertRow({
            quote: quoteId,
            design: designIds[i],
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
    const dMap = await designMap(catalyst);
    const cMap = await customerMap(catalyst);
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

        const doc = docCompute(total, body);
        // Status is never editable here (use /quote-status). Editing content
        // invalidates a pending/granted approval → back to Draft.
        const cur = rowList(
          await catalyst.zcql().executeZCQLQuery(`SELECT status FROM Quote WHERE ROWID = ${quoteId}`),
        )[0];
        const curStatus = String((cur && cur.status) || "Draft");
        const nextStatus = curStatus === "PendingApproval" || curStatus === "Approved" ? "Draft" : curStatus;
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
            from_status: curStatus, to_status: nextStatus, note: "edited — approval reset",
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
const SO_TRANSITIONS = {
  Draft: ["PendingApproval"],
  PendingApproval: ["Confirmed", "Rejected"], // approver only (approve / reject with reason)
  Confirmed: ["InProgress", "Cancelled"],
  InProgress: ["Cancelled"],
  Cancelled: ["Confirmed"],
  Rejected: ["PendingApproval"], // resubmit a rejected order straight for approval
};

app.post("/so-status/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const soId = req.params.rowid;
    const to = String((req.body || {}).status || "");
    const reason = String((req.body || {}).reason || "").trim();

    const result = await withOpLog(
      catalyst,
      { table_name: "SalesOrder", operation: "status", payload: { ROWID: soId, status: to, reason } },
      async () => {
        const rows = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, order_number, status, sales_person FROM SalesOrder WHERE ROWID = ${soId}`,
          ),
        );
        if (!rows.length) throw badRequest(`Sales order not found: ${soId}`, 404);
        const so = rows[0];

        const from = String(so.status || "Draft");
        if (!(SO_TRANSITIONS[from] || []).includes(to))
          throw badRequest(`Cannot move sales order from ${from} to ${to}`, 409);
        if (from === "PendingApproval" && !canApprove(req, "SalesOrder"))
          throw badRequest("Your role cannot approve or reject sales orders", 403);
        if (to === "Rejected" && !reason)
          throw badRequest("A rejection reason is required");

        // Persist the reason on the record (see /quote-status) for the grid hover.
        await ds.table("SalesOrder").updateRow(
          to === "Rejected" ? { ROWID: soId, status: to, reject_reason: reason } : { ROWID: soId, status: to },
        );
        await logTransition(catalyst, {
          entity_type: "SalesOrder", entity_rowid: soId, from_status: from, to_status: to, note: reason,
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

        // On confirmation, auto-enqueue the order's items into the production
        // waitlist as editable plan rows. Dedupe on order_item so a re-confirm
        // (Cancelled → Confirmed) never double-inserts. Manual "Record New
        // Production" still works alongside this.
        if (to === "Confirmed") {
          const items = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ROWID, design, ordered_qty_boxes FROM OrderItem WHERE sales_order = ${soId} AND deleted_at is null`,
            ),
          );
          if (items.length) {
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
        }
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
           port_of_discharge, status, currency, remarks, address, order_number,
           quote_rowid?, salesperson, customer_notes, terms, box_branding?,
           lines: [{ item, qty, rate, discount?, stage?, priority?, due_date? }] }
   ---------------------------------------------------------------- */
app.post("/so-with-items", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const dMap = await designMap(catalyst);
    const cMap = await customerMap(catalyst);
    const pMap = await paymentTermMap(catalyst);
    const sMap = await salesPersonMap(catalyst);

    const result = await withOpLog(
      catalyst,
      { table_name: "SalesOrder", operation: "insert", payload: body },
      async () => createSalesOrder(ds, body, { dMap, cMap, pMap, sMap, catalyst }),
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Business: update an existing SalesOrder header + REPLACE its line
   items — mirror of /update-quote-with-items. order_number is never
   editable; status is never editable here (use /so-status).
   ---------------------------------------------------------------- */
app.post("/update-so-with-items/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const soId = req.params.rowid;
    const dMap = await designMap(catalyst);
    const cMap = await customerMap(catalyst);
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

        // Once any work is recorded the lines are FK-referenced downstream
        // (pallets, containers) — a wholesale line replace would orphan them.
        const QTY_COLS = [
          "produced_qty_boxes", "purchased_qty_boxes", "palletized_qty_boxes",
          "loaded_qty_boxes", "dispatched_qty_boxes",
        ];
        const oldItems = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, ${QTY_COLS.join(", ")} FROM OrderItem WHERE sales_order = ${soId}`,
          ),
        );
        if (oldItems.some((it) => QTY_COLS.some((c) => (Number(it[c]) || 0) > 0)))
          throw badRequest("Work already recorded on this order — items can no longer be edited", 409);

        // Validate everything up front — never write a header then fail on a line.
        assertDateOrder(body.order_date, body.shipment_date, "order date", "shipment date");
        const customer = resolveOrThrow(cMap, body.customer, "Customer");
        const paymentTerm = resolveOptional(pMap, body.payment_term, "Payment term");
        const salesPerson = resolveOptional(sMap, body.salesperson, "Sales person");
        const { items, total } = computeLines(body.lines);
        const designIds = items.map((it) => resolveOrThrow(dMap, it.line.item, "Design"));

        const doc = docCompute(total, body);
        // Editing content invalidates a pending/granted approval → back to
        // Draft ("Confirmed" is the approved state in SO_TRANSITIONS).
        const curStatus = String(cur.status || "Draft");
        const nextStatus = curStatus === "PendingApproval" || curStatus === "Confirmed" ? "Draft" : curStatus;
        await ds.table("SalesOrder").updateRow({
          ROWID: soId,
          customer,
          po_number: body.po_number || "",
          order_date: body.order_date || undefined,
          shipment_date: body.shipment_date || undefined,
          payment_term: paymentTerm,
          port_of_discharge: body.port_of_discharge || "",
          status: nextStatus,
          currency: body.currency || "INR",
          exchange_rate: Number(body.exchange_rate) || 1,
          remarks: body.remarks || "",
          address: body.address || "",
          box_branding: body.box_branding || "",
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
            from_status: curStatus, to_status: nextStatus, note: "edited — approval reset",
          });

        // Replace lines wholesale — safe because the guard above proved no
        // work quantities exist, so nothing downstream references these rows.
        for (const r of oldItems) await ds.table("OrderItem").deleteRow(r.ROWID);
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const l = it.line;
          await ds.table("OrderItem").insertRow({
            sales_order: soId,
            design: designIds[i],
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
async function nextOrderNumber(catalyst) {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Indian FY (Apr–Mar)
  const prefix = `SO/${y}-${String((y + 1) % 100).padStart(2, "0")}/`;
  const rows = rowList(await catalyst.zcql().executeZCQLQuery("SELECT order_number FROM SalesOrder"));
  let max = 0;
  for (const r of rows) {
    const n = String(r.order_number || "");
    if (n.startsWith(prefix)) max = Math.max(max, parseInt(n.slice(prefix.length), 10) || 0);
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
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
    // Manual SOs start in Draft (approval flow); convert-quote passes
    // "Confirmed" explicitly — the source quote already passed approval.
    // Every order is born Draft — approval is mandatory (mirror of quotes),
    // so a crafted create can't mint a pre-approved order.
    status: "Draft",
    currency: body.currency || "INR",
    exchange_rate: Number(body.exchange_rate) || 1,
    remarks: body.remarks || "",
    address: body.address || "",
    manual_so_number: body.manual_so_number || "",
    // Branding printed on the boxes: our Brand name or the customer's own.
    box_branding: body.box_branding || "",
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
    const dMap = await designMap(catalyst);
    const cMap = await customerMap(catalyst);
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
            currency: q.currency,
            exchange_rate: q.exchange_rate,
            remarks: body.remarks || `Converted from ${q.quote_number}${body.mode === "Partial" ? " (partial)" : ""}`,
            address: q.address,
            // Carry the quote's Books-parity header fields onto the SO, allowing
            // the convert request to override per-field. Sales person carries by
            // FK (sales_person_rowid); a name override resolves in createSalesOrder.
            sales_person_rowid: q.sales_person || null,
            salesperson: body.salesperson || "",
            box_branding: body.box_branding || "",
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
          { dMap, cMap, pMap, sMap, catalyst },
        );

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

async function recountOrderItems(catalyst, ds, oiIds) {
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
      // Batch/shade rides per line so a mixed pallet keeps each leftover's own.
      batch_number: String(l.batch_number || body.batch_number || "").trim(),
      shade: String(l.shade || body.shade || "").trim(),
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
    // Denormalised header batch/shade for a single-batch pallet's slip (blank on mixed).
    batch_number: String(body.batch_number || "").trim(),
    shade: String(body.shade || "").trim(),
    remarks: body.remarks || "",
  });
  const batchId = batchRow.ROWID;
  const insertedLines = [];
  try {
    for (const l of lines) {
      const lr = await ds.table("PalletisedBatchLine").insertRow({ batch: batchId, order_item: l.order_item, boxes: l.boxes, batch_number: l.batch_number, shade: l.shade });
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
   pallet (is_mixed=true, design=null). Each line keeps its own batch/shade so a
   mixed pallet legitimately holds several. Mirrors closePallet's
   validate → insert → compensate shape. body: { sales_order, pallet,
   performed_by?, lines: [{ order_item, boxes, batch_number?, shade? }] } */
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
      shade: String(l.shade || "").trim(),
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
        batch: batchId, order_item: l.order_item, boxes: l.boxes, batch_number: l.batch_number, shade: l.shade,
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

/* Server-assigned production batch number: B/FY/NNN. Minted only when the
   client didn't supply one (operators may type an existing batch to append
   output to it). MAX-scan mirrors nextPalNumber; assertUnique is the backstop. */
async function nextBatchNumber(catalyst) {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // Indian FY (Apr–Mar)
  const prefix = `B/${y}-${String((y + 1) % 100).padStart(2, "0")}/`;
  const rows = rowList(await catalyst.zcql().executeZCQLQuery("SELECT batch_number FROM ProductionLog"));
  let max = 0;
  for (const r of rows) {
    const n = String(r.batch_number || "");
    if (n.startsWith(prefix)) max = Math.max(max, parseInt(n.slice(prefix.length), 10) || 0);
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
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
    const boxes = nonNeg(l.boxes, `Line ${i + 1} boxes`);
    if (boxes <= 0) throw badRequest(`Line ${i + 1}: boxes must be > 0`);
    return {
      sales_order: l.sales_order ? String(l.sales_order) : null,
      order_item: String(l.order_item),
      design: l.design ? String(l.design) : null,
      pallet: l.pallet ? String(l.pallet) : null,
      boxes,
      position: Number(l.position) || i,
      status: "Planning", // every line born Ready for Palletization; advances via /pal-line-status
      // Carried opaquely: /update-pal-plan replaces all lines from client
      // input, so dropping this here would wipe batches on every plan edit.
      batch_number: l.batch_number ? String(l.batch_number) : "",
    };
  });
}

/** Insert a PalletizationPlan header + its lines. Compensates on mid-write failure. */
async function createPalPlan(catalyst, ds, body, sMap) {
  // Blank pal_number → server assigns the next number (clients never mint it).
  const palNumber = String(body.pal_number || "").trim() || (await nextPalNumber(catalyst));
  await assertUnique(catalyst, "PalletizationPlan", "pal_number", palNumber);
  const lines = normalizePlanLines(body);
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
   so re-records, complete-after-record and manual Planning lines all
   converge. New lines are born "Planning" = the board's "Ready for
   Palletization" column. Callers wrap in try/catch: a queue failure must
   never fail an already-committed production record. */
async function autoEnqueuePalletization(catalyst, ds, orderItemId) {
  const oiId = String(orderItemId || "");
  if (!/^\d+$/.test(oiId)) return;
  const zcql = catalyst.zcql();
  const oi = rowList(
    await zcql.executeZCQLQuery(
      `SELECT ROWID, sales_order, design, pallet, produced_qty_boxes, palletized_qty_boxes FROM OrderItem WHERE ROWID = ${oiId}`,
    ),
  )[0];
  const soId = oi ? String(oi.sales_order || "") : "";
  if (!soId) return;
  const available = (Number(oi.produced_qty_boxes) || 0) - (Number(oi.palletized_qty_boxes) || 0);
  if (available <= 0) return;

  // All live lines of the SO, restricted to live plans (soft-deleted plans
  // drop out — mirror of recountOrderItems).
  const soLines = rowList(
    await zcql.executeZCQLQuery(
      `SELECT ROWID, plan, order_item, boxes, status, batch_number FROM PalletizationPlanLine WHERE sales_order = ${soId} AND deleted_at is null`,
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
  // item (uniform tile texture per customer). Ground truth both sides:
  // produced per batch (record children) minus already-enqueued per batch
  // (ANY status — boxes palletized/dispatched for a batch never re-enqueue).
  // Residue with no batch attribution (legacy qty_boxes, /production-complete)
  // lands on the "" line — exactly the old aggregate behavior.
  const recs = rowList(
    await zcql.executeZCQLQuery(
      `SELECT batch_number, qty_boxes, second_stage, CREATEDTIME FROM ProductionLog WHERE order_item = ${oiId} AND entry_type = 'record' AND deleted_at is null`,
    ),
  );
  const producedByBatch = new Map(); // batch → { qty, first, second }
  for (const r of recs) {
    const b = String(r.batch_number || "");
    const cur = producedByBatch.get(b) || { qty: 0, first: String(r.CREATEDTIME || ""), second: false };
    cur.qty += Number(r.qty_boxes) || 0;
    if (String(r.CREATEDTIME || "") < cur.first) cur.first = String(r.CREATEDTIME || "");
    cur.second = cur.second || String(r.second_stage) === "true";
    producedByBatch.set(b, cur);
  }
  const enqueuedByBatch = new Map();
  for (const l of liveLines) {
    if (String(l.order_item) !== oiId) continue;
    const b = String(l.batch_number || "");
    enqueuedByBatch.set(b, (enqueuedByBatch.get(b) || 0) + (Number(l.boxes) || 0));
  }

  // st: "Planning" | "Palletizing" — 2nd-stage records land straight in the
  // Palletization column, everything else in Ready for Palletization.
  const upsert = async (batch, alloc, st = "Planning") => {
    const mine = liveLines.find(
      (l) =>
        String(l.plan) === planId &&
        String(l.order_item) === oiId &&
        String(l.status) === st &&
        String(l.batch_number || "") === batch,
    );
    if (mine) {
      await ds.table("PalletizationPlanLine").updateRow({
        ROWID: mine.ROWID, boxes: (Number(mine.boxes) || 0) + alloc,
      });
      mine.boxes = (Number(mine.boxes) || 0) + alloc;
    } else {
      const lr = await ds.table("PalletizationPlanLine").insertRow({
        plan: planId,
        sales_order: soId,
        order_item: oiId,
        design: oi.design ? String(oi.design) : null,
        pallet: oi.pallet ? String(oi.pallet) : null,
        boxes: alloc,
        position: liveLines.filter((l) => String(l.plan) === planId).length,
        status: st,
        batch_number: batch,
      });
      liveLines.push({ ROWID: lr.ROWID, plan: planId, order_item: oiId, boxes: alloc, status: st, batch_number: batch });
    }
  };

  let remaining = topUp;
  const batches = [...producedByBatch.entries()]
    .filter(([b]) => b !== "")
    .sort((a, c) => (a[1].first < c[1].first ? -1 : 1)); // FIFO by first record
  for (const [b, p] of batches) {
    if (remaining <= 0) break;
    const want = p.qty - (enqueuedByBatch.get(b) || 0);
    const alloc = Math.min(Math.max(want, 0), remaining);
    if (alloc <= 0) continue;
    await upsert(b, alloc, p.second ? "Palletizing" : "Planning");
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
            `SELECT ROWID, pal_number FROM PalletizationPlan WHERE ROWID = ${planId}`,
          ),
        )[0];
        if (!cur) throw badRequest(`Palletization plan not found: ${planId}`, 404);
        const lines = normalizePlanLines(body);
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
        // Soft-delete old lines, insert the new set.
        const old = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, order_item FROM PalletizationPlanLine WHERE plan = ${planId} AND deleted_at is null`,
          ),
        );
        const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
        for (const r of old) await ds.table("PalletizationPlanLine").updateRow({ ROWID: r.ROWID, deleted_at: stamp });
        for (const l of lines) await ds.table("PalletizationPlanLine").insertRow({ plan: planId, ...l });
        // Wholesale line replace can raise OR lower an item's counters — recount both sets.
        await recountOrderItems(catalyst, ds, [...old.map((r) => r.order_item), ...lines.map((l) => l.order_item)]);
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
   item-wise move on the kanban — advancing one line never touches its plan or siblings. */
app.post("/pal-line-status/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const lineId = req.params.rowid;
    const to = String((req.body || {}).status || "");
    const pallet = String((req.body || {}).pallet || "");

    const result = await withOpLog(
      catalyst,
      { table_name: "PalletizationPlanLine", operation: "status", payload: { ROWID: lineId, status: to, ...(pallet ? { pallet } : {}) } },
      async () => {
        const rows = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, status, order_item FROM PalletizationPlanLine WHERE ROWID = ${lineId}`,
          ),
        );
        if (!rows.length) throw badRequest(`Palletization line not found: ${lineId}`, 404);
        const from = String(rows[0].status || "Planning");
        // Same-status call = pallet (re)assignment only — e.g. a 2nd-stage line
        // that landed in Palletizing without one; logTransition no-ops on it.
        if (from !== to && !(PAL_LINE_TRANSITIONS[from] || []).includes(to))
          throw badRequest(`Cannot move palletization line from ${from} to ${to}`, 409);
        await ds.table("PalletizationPlanLine").updateRow({
          ROWID: lineId, status: to, ...(/^\d+$/.test(pallet) ? { pallet } : {}),
        });
        await logTransition(catalyst, {
          entity_type: "PalletizationPlanLine", entity_rowid: lineId, from_status: from, to_status: to,
        });
        await recountOrderItems(catalyst, ds, [rows[0].order_item]);
        return { rowid: lineId, data: { ROWID: lineId, status: to } };
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
              `SELECT ROWID, status, plan, sales_order, order_item, design, pallet, boxes, position, batch_number FROM PalletizationPlanLine WHERE ROWID = ${id} AND deleted_at is null`,
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
            pallet_group: group,
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

async function getBox(catalyst, boxId) {
  const rows = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, box_number, status, vehicle, capacity FROM LoadBox WHERE ROWID = ${boxId} AND deleted_at is null`,
    ),
  );
  if (!rows.length) throw badRequest(`Load box not found: ${boxId}`, 404);
  return rows[0];
}

/** Non-deleted lines allocated to a box. */
async function boxLines(catalyst, boxId) {
  return rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, plan, order_item, boxes FROM PalletizationPlanLine WHERE load_box = ${boxId} AND deleted_at is null`,
    ),
  );
}

/* Loading-capture fields entered at the box (container no + seals + supervisor).
   Copies any present field from the request body onto a LoadBox patch. Shared by
   /load-box-update (advance entry) and /load-box-dispatch (last-minute) so data
   entered at either point is persisted. */
const LOAD_BOX_FIELDS = ["container_number", "line_seal", "electronic_seal", "loading_supervisor"];
function applyLoadBoxFields(patch, body) {
  for (const f of LOAD_BOX_FIELDS) {
    if (body[f] !== undefined) patch[f] = String(body[f] || "").trim();
  }
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
    // Advisory only — fill % is measured against the lines' pallet capacity client-side.
    const capacity = Number((req.body || {}).capacity) || 0;
    const result = await withOpLog(
      catalyst,
      { table_name: "LoadBox", operation: "insert", payload: req.body },
      async () => {
        const boxNumber = await nextBoxNumber(catalyst);
        const row = await ds.table("LoadBox").insertRow({ box_number: boxNumber, status: "Open", capacity });
        return { rowid: row.ROWID, data: { ROWID: row.ROWID, box_number: boxNumber } };
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
    if (!box) throw badRequest(`Load box not found: ${boxId}`, 404);
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
        const box = await getBox(catalyst, boxId);
        if (String(box.status) !== "Open") throw badRequest("Only an open box can be changed", 409);
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
    const result = await withOpLog(
      catalyst,
      { table_name: "LoadBox", operation: "delete", payload: { ROWID: boxId } },
      async () => {
        const box = await getBox(catalyst, boxId);
        if (String(box.status) !== "Open") throw badRequest("A dispatched box cannot be removed", 409);
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
        if (String(box.status) !== "Open") throw badRequest("Box is already dispatched", 409);
        if (!String(box.vehicle || "")) throw badRequest("Assign a vehicle before dispatch", 400);
        const lines = await boxLines(catalyst, boxId);
        if (!lines.length) throw badRequest("An empty box cannot be dispatched", 400);
        const dispatchDate = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST
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
            note: `Box ${box.box_number} dispatched`,
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
        return { rowid: boxId, data: { ROWID: boxId, status: "Dispatched", dispatch_date: dispatchDate } };
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
      { table_name: "PalletizationPlanLine", operation: "box-allocate", payload: { ROWID: lineId, box: toBox, boxes: reqBoxes } },
      async () => {
        const line = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, status, plan, load_box, sales_order, order_item, design, pallet, boxes, position, batch_number FROM PalletizationPlanLine WHERE ROWID = ${lineId} AND deleted_at is null`,
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
            throw badRequest("Only a Ready-for-Loading item can be loaded into a box", 409);
          const box = await getBox(catalyst, boxIdParam(toBox));
          if (String(box.status) !== "Open") throw badRequest("That box is already dispatched", 409);
          const lineBoxes = Number(line.boxes) || 0;
          if (reqBoxes !== undefined) {
            const n = Number(reqBoxes);
            if (!Number.isInteger(n) || n <= 0) throw badRequest("boxes must be a positive integer");
            if (n > lineBoxes) throw badRequest("Cannot load more boxes than the line has");
            if (n < lineBoxes) {
              // Split: remainder first (stays Ready, unloaded) so a mid-write
              // failure leaves state recoverable; then shrink + load the original.
              const rem = await ds.table("PalletizationPlanLine").insertRow({
                plan: planId,
                sales_order: line.sales_order ? String(line.sales_order) : undefined,
                order_item: line.order_item ? String(line.order_item) : undefined,
                design: line.design ? String(line.design) : undefined,
                pallet: line.pallet ? String(line.pallet) : undefined,
                boxes: lineBoxes - n,
                position: Number(line.position) || 0,
                status: "ReadyToLoad",
                batch_number: line.batch_number ? String(line.batch_number) : "",
              });
              try {
                await ds.table("PalletizationPlanLine").updateRow({ ROWID: lineId, boxes: n, load_box: String(box.ROWID) });
              } catch (e) {
                try { await ds.table("PalletizationPlanLine").deleteRow(rem.ROWID); } catch (_) {}
                throw e;
              }
              // Plan-status follow happens below, same as a whole-line load.
            } else {
              await ds.table("PalletizationPlanLine").updateRow({ ROWID: lineId, load_box: String(box.ROWID) });
            }
          } else {
            await ds.table("PalletizationPlanLine").updateRow({ ROWID: lineId, load_box: String(box.ROWID) });
          }
          // First allocation pulls the plan into Loading.
          if (planId) {
            const plan = rowList(
              await catalyst.zcql().executeZCQLQuery(
                `SELECT ROWID, status FROM PalletizationPlan WHERE ROWID = ${planId}`,
              ),
            )[0];
            if (plan && String(plan.status) === "Planning")
              await setPlanStatus(catalyst, ds, planId, "Planning", "Loading");
          }
        } else {
          await ds.table("PalletizationPlanLine").updateRow({ ROWID: lineId, load_box: null });
          if (planId) await demoteEmptyPlans(catalyst, ds, [planId]);
        }
        await recountOrderItems(catalyst, ds, [line.order_item]);
        return { rowid: lineId, data: { ROWID: lineId, load_box: toBox || null } };
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
            `SELECT ROWID, design, pallet, ordered_qty_boxes, palletized_qty_boxes FROM OrderItem WHERE sales_order = ${soId} AND deleted_at is null`,
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
          const cap = (Number(oi.ordered_qty_boxes) || 0) - (Number(oi.palletized_qty_boxes) || 0);
          if (n > cap) throw badRequest(`Only ${Math.max(cap, 0)} boxes remain to send for an item`, 409);
        }

        const planId = await ensureOpenPlan(catalyst, ds, soId, "Auto — direct loading");
        let pos = rowList(
          await zcql.executeZCQLQuery(
            `SELECT ROWID FROM PalletizationPlanLine WHERE plan = ${planId} AND deleted_at is null`,
          ),
        ).length;
        for (const [oiId, n] of wanted) {
          const oi = byId.get(oiId);
          const lr = await ds.table("PalletizationPlanLine").insertRow({
            plan: planId,
            sales_order: soId,
            order_item: oiId,
            design: oi.design ? String(oi.design) : null,
            pallet: oi.pallet ? String(oi.pallet) : null,
            boxes: n,
            position: pos++,
            status: "ReadyToLoad",
            batch_number: "",
            ...(box ? { load_box: String(box.ROWID) } : {}),
          });
          await logTransition(catalyst, {
            entity_type: "PalletizationPlanLine", entity_rowid: String(lr.ROWID),
            from_status: "", to_status: "ReadyToLoad", note: "sent to loading",
          });
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
   until its records cover qty_requested. Kanban stage is moved MANUALLY (drag),
   independent of recording.

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
        // Boxes already requested against each order_item (every live plan line —
        // requested always ⊇ produced), so we don't request more than ordered.
        const inFlight = new Map();
        if (orderItemIds.length) {
          const uniq = [...new Set(orderItemIds.map(String))];
          const rows = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT order_item, qty_requested FROM ProductionLog WHERE entry_type = 'plan' AND deleted_at is null AND order_item IN (${uniq.join(",")})`,
            ),
          );
          for (const r of rows) {
            const k = String(r.order_item);
            inFlight.set(k, (inFlight.get(k) || 0) + (Number(r.qty_requested) || 0));
          }
        }
        const group = `PR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const created = [];
        for (const l of lines) {
          let design = l.design;
          let salesOrder = "";
          if (l.order_item) {
            const oi = oiMap.get(l.order_item);
            if (!oi) throw badRequest(`OrderItem not found: ${l.order_item}`, 404);
            const ordered = Number(oi.ordered_qty_boxes) || 0;
            const pending = inFlight.get(l.order_item) || 0;
            if (pending + l.qty_requested > ordered)
              throw badRequest(
                `Requesting ${l.qty_requested} exceeds remaining for this line (${pending} already requested of ${ordered} ordered)`,
                409,
              );
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
            stage: "New",
            request_group: group,
            production_date: String(body.production_date || ""),
            shift: String(body.shift || ""),
            performed_by: String(body.performed_by || ""),
            note: String(body.note || ""),
          });
          await logTransition(catalyst, {
            entity_type: "ProductionLog", entity_rowid: row.ROWID, from_status: "", to_status: "New",
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
    const result = await withOpLog(
      catalyst,
      { table_name: "ProductionLog", operation: "production-delete", payload: { ROWID: rowid } },
      async () => {
        const pl = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, order_item, qty_boxes FROM ProductionLog WHERE ROWID = ${rowid} AND deleted_at is null`,
          ),
        )[0];
        if (!pl) throw badRequest(`Production entry not found: ${rowid}`, 404);

        // Record children hold the recorded boxes to reverse (+ any legacy qty_boxes
        // on the plan line itself, from before the split-row model).
        const children = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, qty_boxes FROM ProductionLog WHERE parent_log = ${rowid} AND deleted_at is null`,
          ),
        );
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

/* Record actual output against a plan line. Inserts a SEPARATE dated "record"
   child row (entry_type=record, parent_log=plan) — the plan line is untouched, so
   partial records accumulate and the line stays recordable until its records
   cover qty_requested. Bumps OrderItem.produced (order-linked, capped at ordered)
   and steps stage po→prod. Kanban stage is NOT changed here (moved manually).
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

        // Batch/shade: one batch = one shade. Blank batch → auto-mint B/FY/NNN;
        // a supplied batch must pass the duplicate guard (setting-controlled).
        const suppliedBatch = String(body.batch_number || "").trim();
        await assertBatchesAllowed(catalyst, [suppliedBatch], pl.design);
        const batchNumber = suppliedBatch || (await nextBatchNumber(catalyst));
        const shade = String(body.shade || "").trim();

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
          shade,
          second_stage: body.second_stage === true,
          production_date: body.production_date != null ? String(body.production_date) : "",
          shift: body.shift != null ? String(body.shift) : "",
          performed_by: body.performed_by != null ? String(body.performed_by) : "",
          note: body.note != null ? String(body.note) : "",
        });
        await logTransition(catalyst, {
          entity_type: "ProductionLog", entity_rowid: rowid, from_status: "", to_status: `Recorded +${qty}`,
        });
        // Produced boxes flow straight to the palletization queue; a queue
        // failure never fails the already-committed record.
        if (orderItemId) {
          try { await autoEnqueuePalletization(catalyst, ds, orderItemId); }
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
   child per batch (blank batch auto-minted per row; shade dropped, written "").
   On any insert failure it deletes the rows it added and reverts the OrderItem
   bump, so a partial record never sticks.
   body: { rows: [{ qty_boxes, batch_number?, mfg_date?, note? }], shift?, performed_by? } */
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
            second_stage: r.second_stage === true,
          };
        });
        const sum = lines.reduce((s, l) => s + l.qty, 0);

        const pl = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, order_item, design, sales_order, request_group, qty_requested, qty_boxes, stage FROM ProductionLog WHERE ROWID = ${rowid} AND deleted_at is null`,
          ),
        )[0];
        if (!pl) throw badRequest(`Production entry not found: ${rowid}`, 404);
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
          for (const l of lines) {
            // Mint per row; the prior insert is committed so the next scan bumps.
            const batchNumber = l.batch_number || (await nextBatchNumber(catalyst));
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
              shade: "",
              second_stage: l.second_stage,
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
        // After the insert loop committed (not before — the compensation path
        // above would otherwise leave a stray queue line).
        if (orderItemId) {
          try { await autoEnqueuePalletization(catalyst, ds, orderItemId); }
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
          const batchNumber = l.batch_number || (await nextBatchNumber(catalyst));
          const rec = await ds.table("ProductionLog").insertRow({
            entry_type: "opening",
            design: designId,
            qty_requested: 0,
            qty_boxes: l.qty,
            status: "",
            stage: "",
            batch_number: batchNumber,
            shade: "",
            production_date: l.mfg_date,
            note: l.note,
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

/* Move a production to a Kanban stage — manual drag; recording output does NOT
   change the stage. Sets `stage` on the given plan-line ROWIDs (the whole group).
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
   body: { lines: [{ id, qty_boxes }], production_date?, performed_by?, note? }
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
            // Batch/shade per line (each completed line is one design's run);
            // blank batch → auto-mint. One batch = one shade.
            const batchNumber = String((l && l.batch_number) || "").trim() || (await nextBatchNumber(catalyst));
            const shade = String((l && l.shade) || "").trim();
            await ds.table("ProductionLog").insertRow({
              parent_log: id, entry_type: "record",
              design: pl.design || null, sales_order: pl.sales_order || null,
              order_item: pl.order_item || null, request_group: pl.request_group || null,
              qty_requested: 0, qty_boxes: delta, status: "Produced", stage: "Completed",
              batch_number: batchNumber, shade,
              production_date: productionDate, shift: "", performed_by: performedBy, note,
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
  const designs = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, coverage_sqm, box_weight_kg FROM Design`));
  const dMap = new Map(designs.map((d) => [String(d.ROWID), { cov: Number(d.coverage_sqm) || 0, bw: Number(d.box_weight_kg) || 0 }]));
  const pals = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, empty_pallet_weight_kg FROM Pallet`));
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
  const designs = rowList(await zcql.executeZCQLQuery(`SELECT ROWID, coverage_sqm, box_weight_kg FROM Design`));
  const dMap = new Map(designs.map((d) => [String(d.ROWID), { cov: Number(d.coverage_sqm) || 0, bw: Number(d.box_weight_kg) || 0 }]));
  const pals = rowList(await zcql.executeZCQLQuery(`SELECT ROWID, empty_pallet_weight_kg FROM Pallet`));
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
        cols = ids.join(", ");
      }
    }
    const lim = offset > 0 ? `${offset}, ${limit}` : `${limit}`;
    const sql = `SELECT ${cols} FROM ${table}${where}${order} LIMIT ${lim}`;
    const rows = rowList(await catalyst.zcql().executeZCQLQuery(sql));
    res.json({ ok: true, rows });
  } catch (err) {
    sendErr(res, err);
  }
});

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
    if (!rows.length) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, row: rows[0] });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Generic: insert
   ---------------------------------------------------------------- */
/* One-time (idempotent) re-sync: push every Size's packing data out to its
   Item + Pallet snapshots. Fixes rows that drifted before propagation existed,
   and is safe to re-run (e.g. after a bulk Size import). Registered before the
   generic POST /:table so its single-segment path isn't shadowed by it. */
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

app.post("/:table", async (req, res) => {
  try {
    const catalyst = init(req);
    const table = assertTable(req.params.table);
    if (table === "LoadBox") throw badRequest("Load boxes are managed via the /load-box routes");
    const ds = catalyst.datastore();
    const body = req.body || {};
    const rows = Array.isArray(body.rows) ? body.rows : [body];

    const result = await withOpLog(
      catalyst,
      { table_name: table, operation: "insert", payload: body },
      async () => {
        // Reject inserts that collide with an existing row on the table's natural key.
        const nk = NATURAL_KEY[table];
        for (const r of rows) {
          assertNoNegatives(r); // rule #5: no negative numeric values
          if (nk) await assertUnique(catalyst, table, nk, r[nk]);
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

/* Size owns per-box packing data (box weight, coverage, pcs); Item + Pallet
   snapshot it. Push a Size edit out to every row referencing that Size so the
   value stays global instead of frozen on the copy each was saved with.
   ponytail: row-by-row (not atomic) — the re-sync route below is idempotent
   and re-runs fix any partial fan-out. */
async function propagateSizeSnapshots(catalyst, sizeId) {
  const ds = catalyst.datastore();
  const size = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT box_weight_kg, sqm_per_box, sqft_per_box, pcs_per_packing FROM Size WHERE ROWID = ${sizeId}`,
    ),
  )[0];
  if (!size) return { designs: 0, pallets: 0 };
  const bw = Number(size.box_weight_kg) || 0;
  const sqm = Number(size.sqm_per_box) || 0;
  const sqft = Number(size.sqft_per_box) || 0;
  const pcs = Number(size.pcs_per_packing) || 0;
  const designs = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM Design WHERE size = ${sizeId}`));
  for (const d of designs)
    await ds.table("Design").updateRow({ ROWID: d.ROWID, box_weight_kg: bw, coverage_sqm: sqm, coverage_sqft: sqft, pcs_per_box: pcs });
  const pallets = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM Pallet WHERE size = ${sizeId}`));
  for (const p of pallets)
    await ds.table("Pallet").updateRow({ ROWID: p.ROWID, box_weight_kg: bw, coverage_sqm: sqm, coverage_sqft: sqft });
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
        // Quote/SO status live behind their status-machine endpoints.
        if (table === "Quote" && (patch.status !== undefined || patch.conversion_flag !== undefined))
          throw badRequest("Quote status cannot be set directly — use /quote-status");
        if (table === "SalesOrder" && patch.status !== undefined)
          throw badRequest("Sales order status cannot be set directly — use /so-status");
        if (table === "PalletizationPlan" && patch.status !== undefined)
          throw badRequest("Palletization plan status cannot be set directly — use /pal-status");
        if (table === "PalletizationPlanLine" && patch.status !== undefined)
          throw badRequest("Palletization line status cannot be set directly — use /pal-line-status");
        if (table === "PalletizationPlanLine" && patch.load_box !== undefined)
          throw badRequest("Line box allocation cannot be set directly — use /pal-line-box");
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
                `SELECT ROWID FROM ProductionLog WHERE design = ${rid} AND (entry_type = 'record' OR entry_type = 'opening') AND deleted_at is null LIMIT 1`,
              ),
            );
            if (hasStock || logs.length)
              throw badRequest("Can't change batch-tracking once this item has stock or production history", 409);
          }
        }
        // Reject natural-key changes that collide with a different existing row.
        assertNoNegatives(req.body); // rule #5: no negative numeric values
        const nk = NATURAL_KEY[table];
        if (nk && patch[nk] !== undefined) {
          await assertUnique(catalyst, table, nk, patch[nk], rid);
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
        const row = await ds.table(table).updateRow(patch);
        // Size edits fan out to the Item + Pallet packing-data snapshots.
        if (table === "Size") await propagateSizeSnapshots(catalyst, rid);
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
      payload_summary: summarize({ rowid: oiId, disassociatedProduction: prod.length }),
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

    // HARD delete-guard: refuse to delete a record still referenced by a
    // DOWNSTREAM transaction (its own line items don't count — a Quote owns
    // QuoteItems, a SalesOrder owns OrderItems, blocking on those would make
    // every quote/SO undeletable). Not bypassable by ?hard=1.
    const rid = String(req.params.rowid).replace(/[^0-9]/g, ""); // ROWIDs are numeric
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
        payload: { rowid: rid },
      },
      async () => {
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

