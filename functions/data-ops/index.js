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

// CORS — same-origin in prod; permissive so the dev proxy / probes never trip.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
  "DesignPallet",
  "PalletisedBatch",
  "PalletisedBatchLine",
  "Container",
  "ContainerLoading",
  "OrderItemEvent",
  "Activity",
  "OperationLog",
  "Invoice",
  "TransactionSeries",
  "SalesPerson",
  "Currency",
  "StatusTransition",
  "Notification",
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
  Size: "code",
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
  PendingApproval: ["Approved", "Draft"], // approver only (approve / reject with reason)
  Approved: ["Sent"],
  Sent: ["Accepted", "Rejected"],
  Accepted: ["Rejected"], // customer can back out until conversion
  Rejected: ["Draft"],
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
        if (from === "PendingApproval" && to === "Draft" && !reason)
          throw badRequest("A rejection reason is required");

        await ds.table("Quote").updateRow({ ROWID: quoteId, status: to });
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
  PendingApproval: ["Confirmed", "Draft"], // approver only (approve / reject with reason)
  Confirmed: ["InProgress", "Cancelled"],
  InProgress: ["Cancelled"],
  Cancelled: ["Confirmed"],
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
        if (from === "PendingApproval" && to === "Draft" && !reason)
          throw badRequest("A rejection reason is required");

        await ds.table("SalesOrder").updateRow({ ROWID: soId, status: to });
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
  });
  const soId = soRow.ROWID;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const l = it.line;
    await ds.table("OrderItem").insertRow({
      sales_order: soId,
      design: designIds[i],
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
   Invariants enforced in code (no DB checks):
     loaded ≤ palletized ≤ produced ≤ ordered ; dispatched ≤ loaded.
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
    return { order_item: String(l.order_item), boxes };
  });
  const totalBoxes = lines.reduce((s, l) => s + l.boxes, 0);

  // Aggregate per order item, then check palletized + new ≤ produced.
  const reqByOi = new Map();
  for (const l of lines) reqByOi.set(l.order_item, (reqByOi.get(l.order_item) || 0) + l.boxes);
  const oiMap = await loadOrderItems(catalyst, [...reqByOi.keys()], "ROWID, produced_qty_boxes, palletized_qty_boxes, stage");
  for (const [oiId, reqBoxes] of reqByOi) {
    const oi = oiMap.get(oiId);
    if (!oi) throw badRequest(`OrderItem not found: ${oiId}`, 404);
    const produced = Number(oi.produced_qty_boxes) || 0;
    const palletized = Number(oi.palletized_qty_boxes) || 0;
    if (palletized + reqBoxes > produced) {
      throw badRequest(
        `OrderItem ${oiId}: palletizing ${reqBoxes} exceeds produced (${palletized}+${reqBoxes} > ${produced})`,
        409,
      );
    }
  }

  // --- writes (compensate on failure) ---
  const batchRow = await ds.table("PalletisedBatch").insertRow({
    sales_order: body.sales_order,
    pallet: body.pallet,
    design: body.design || null,
    boxes_packed: totalBoxes,
    delivery_date: body.delivery_date || undefined, // date col rejects "" → omit
    status: "closed",
    remarks: body.remarks || "",
  });
  const batchId = batchRow.ROWID;
  const insertedLines = [];
  const updatedOi = []; // { id, prev }
  try {
    for (const l of lines) {
      const lr = await ds.table("PalletisedBatchLine").insertRow({ batch: batchId, order_item: l.order_item, boxes: l.boxes });
      insertedLines.push(lr.ROWID);
    }
    for (const [oiId, reqBoxes] of reqByOi) {
      const prev = Number(oiMap.get(oiId).palletized_qty_boxes) || 0;
      await ds.table("OrderItem").updateRow({ ROWID: oiId, palletized_qty_boxes: prev + reqBoxes, stage: "packing" });
      await logTransition(catalyst, {
        entity_type: "OrderItem", entity_rowid: oiId,
        from_status: oiMap.get(oiId).stage || "", to_status: "packing",
      });
      updatedOi.push({ id: oiId, prev });
      await ds.table("OrderItemEvent").insertRow({
        order_item: oiId,
        event_type: "packed",
        qty_delta: reqBoxes,
        performed_by: String(body.performed_by || ""),
        note: `Pallet batch #${batchId}`,
      });
    }
  } catch (e) {
    // Compensate: restore counters, delete lines + batch. Best-effort; events left as audit.
    for (const u of updatedOi) {
      try { await ds.table("OrderItem").updateRow({ ROWID: u.id, palletized_qty_boxes: u.prev }); } catch (_) {}
    }
    for (const id of insertedLines) {
      try { await ds.table("PalletisedBatchLine").deleteRow(id); } catch (_) {}
    }
    try { await ds.table("PalletisedBatch").deleteRow(batchId); } catch (_) {}
    throw e;
  }
  return { rowid: batchId, data: { ROWID: batchId, boxes_packed: totalBoxes, lines: lines.length } };
}

/* 3a2. Production log — OrderItemEvent + OrderItem.produced bump (+ stage po→prod).
   body: { order_item, qty_boxes, production_date?, shift?, performed_by?, note? } */
app.post("/production-log", async (req, res) => {
  try {
    const catalyst = init(req);
    const ds = catalyst.datastore();
    const body = req.body || {};
    const result = await withOpLog(
      catalyst,
      { table_name: "OrderItemEvent", operation: "production-log", payload: body },
      async () => {
        if (!body.order_item) throw badRequest("order_item is required");
        const qty = nonNeg(body.qty_boxes, "qty_boxes");
        if (qty <= 0) throw badRequest("qty_boxes must be > 0");
        const oiMap = await loadOrderItems(catalyst, [body.order_item], "ROWID, ordered_qty_boxes, produced_qty_boxes, stage");
        const oi = oiMap.get(String(body.order_item));
        if (!oi) throw badRequest(`OrderItem not found: ${body.order_item}`, 404);
        const ordered = Number(oi.ordered_qty_boxes) || 0;
        const produced = Number(oi.produced_qty_boxes) || 0;
        if (produced + qty > ordered) {
          throw badRequest(`Producing ${qty} exceeds ordered (${produced}+${qty} > ${ordered})`, 409);
        }
        const noteBits = [body.shift, body.production_date, body.note].map((s) => String(s || "").trim()).filter(Boolean);
        const ev = await ds.table("OrderItemEvent").insertRow({
          order_item: String(body.order_item),
          event_type: "production_update",
          qty_delta: qty,
          performed_by: String(body.performed_by || ""),
          note: noteBits.join(" · "),
        });
        // Never regress a later stage — only po steps forward to prod here.
        const patch = { ROWID: String(body.order_item), produced_qty_boxes: produced + qty };
        if (String(oi.stage || "po") === "po") patch.stage = "prod";
        await ds.table("OrderItem").updateRow(patch);
        if (patch.stage)
          await logTransition(catalyst, {
            entity_type: "OrderItem", entity_rowid: body.order_item,
            from_status: oi.stage || "po", to_status: patch.stage,
          });
        return { rowid: ev.ROWID, data: { produced_qty_boxes: produced + qty, stage: patch.stage || oi.stage } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
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
  for (let i = 0; i < batchIds.length; i++) {
    const bid = batchIds[i];
    const posSpec = raw[i] && typeof raw[i] === "object" && raw[i].position != null ? Number(raw[i].position) : palletCount + i + 1;
    const lr = await ds.table("ContainerLoading").insertRow({ container: containerId, batch: bid, position: posSpec });
    loadingIds.push(lr.ROWID);
    await ds.table("PalletisedBatch").updateRow({ ROWID: bid, status: "loaded" });
    // Bump loaded_qty_boxes per order item from this batch's lines (clamp ≤ palletized).
    const lineRows = rowList(
      await catalyst.zcql().executeZCQLQuery(`SELECT order_item, boxes FROM PalletisedBatchLine WHERE batch = ${bid}`),
    );
    for (const ln of lineRows) {
      const oiRows = rowList(
        await catalyst.zcql().executeZCQLQuery(
          `SELECT ROWID, palletized_qty_boxes, loaded_qty_boxes, stage FROM OrderItem WHERE ROWID = ${ln.order_item}`,
        ),
      );
      if (!oiRows.length) continue;
      const oi = oiRows[0];
      const addQty = Number(ln.boxes) || 0;
      const next = Math.min((Number(oi.loaded_qty_boxes) || 0) + addQty, Number(oi.palletized_qty_boxes) || 0);
      await ds.table("OrderItem").updateRow({ ROWID: ln.order_item, loaded_qty_boxes: next, stage: "loading" });
      await logTransition(catalyst, {
        entity_type: "OrderItem", entity_rowid: ln.order_item,
        from_status: oi.stage || "", to_status: "loading",
      });
      await ds.table("OrderItemEvent").insertRow({
        order_item: ln.order_item,
        event_type: "loaded",
        qty_delta: addQty,
        performed_by: String(body.loaded_by || ""),
        note: `Container #${containerId}`,
      });
    }
  }
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

  for (const ld of loadings) {
    const lineRows = rowList(
      await catalyst.zcql().executeZCQLQuery(`SELECT order_item, boxes FROM PalletisedBatchLine WHERE batch = ${ld.batch}`),
    );
    for (const ln of lineRows) {
      const oiRows = rowList(
        await catalyst.zcql().executeZCQLQuery(
          `SELECT ROWID, loaded_qty_boxes, dispatched_qty_boxes, stage FROM OrderItem WHERE ROWID = ${ln.order_item}`,
        ),
      );
      if (!oiRows.length) continue;
      const oi = oiRows[0];
      const addQty = Number(ln.boxes) || 0;
      const next = Math.min((Number(oi.dispatched_qty_boxes) || 0) + addQty, Number(oi.loaded_qty_boxes) || 0);
      await ds.table("OrderItem").updateRow({ ROWID: ln.order_item, dispatched_qty_boxes: next, stage: "final" });
      await logTransition(catalyst, {
        entity_type: "OrderItem", entity_rowid: ln.order_item,
        from_status: oi.stage || "", to_status: "final",
      });
      await ds.table("OrderItemEvent").insertRow({
        order_item: ln.order_item,
        event_type: "dispatched",
        qty_delta: addQty,
        performed_by: String(body.performed_by || ""),
        note: `Container #${containerId} dispatched`,
      });
    }
    await ds.table("PalletisedBatch").updateRow({ ROWID: ld.batch, status: "dispatched" });
  }
  await ds.table("Container").updateRow({ ROWID: containerId, status: "dispatched" });
  return { rowid: containerId, data: { container: containerId, batches: loadings.length } };
}

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
    if (req.query.where) clauses.push(`(${req.query.where})`);
    if (req.query.include_deleted !== "1" && table !== "OperationLog")
      clauses.push("deleted_at is null");
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const order = req.query.order ? ` ORDER BY ${req.query.order}` : "";
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
    const rows = rowList(
      await catalyst
        .zcql()
        .executeZCQLQuery(`SELECT *, CREATEDTIME, MODIFIEDTIME FROM ${table} WHERE ROWID = ${req.params.rowid}`),
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
app.post("/:table", async (req, res) => {
  try {
    const catalyst = init(req);
    const table = assertTable(req.params.table);
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

/* ----------------------------------------------------------------
   Generic: update
   ---------------------------------------------------------------- */
app.patch("/:table/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const table = assertTable(req.params.table);
    const ds = catalyst.datastore();
    const patch = { ...(req.body || {}), ROWID: req.params.rowid };

    const result = await withOpLog(
      catalyst,
      { table_name: table, operation: "update", payload: req.body },
      async () => {
        // Quote/SO status live behind their status-machine endpoints.
        if (table === "Quote" && (patch.status !== undefined || patch.conversion_flag !== undefined))
          throw badRequest("Quote status cannot be set directly — use /quote-status");
        if (table === "SalesOrder" && patch.status !== undefined)
          throw badRequest("Sales order status cannot be set directly — use /so-status");
        // Reject natural-key changes that collide with a different existing row.
        assertNoNegatives(req.body); // rule #5: no negative numeric values
        const nk = NATURAL_KEY[table];
        if (nk && patch[nk] !== undefined) {
          await assertUnique(catalyst, table, nk, patch[nk], req.params.rowid);
        }
        // OrderItem stage flips get a StatusTransition row; this PATCH is
        // the one path all client stage writes converge on.
        const transCol = table === "OrderItem" && patch.stage !== undefined ? "stage" : null;
        let transFrom = null;
        if (transCol) {
          const prev = rowList(
            await catalyst.zcql().executeZCQLQuery(
              `SELECT ${transCol} FROM ${table} WHERE ROWID = ${req.params.rowid}`,
            ),
          )[0];
          transFrom = prev ? String(prev[transCol] || "") : "";
        }
        const row = await ds.table(table).updateRow(patch);
        if (transCol)
          await logTransition(catalyst, {
            entity_type: table, entity_rowid: req.params.rowid,
            from_status: transFrom, to_status: String(patch[transCol] || ""),
          });
        delete _cache[table]; // FK-name lookup map is now stale
        return { rowid: (row && row.ROWID) || req.params.rowid, data: row };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
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
    const ds = catalyst.datastore();
    const hard = req.query.hard === "1" || table === "OperationLog";

    const result = await withOpLog(
      catalyst,
      {
        table_name: table,
        operation: hard ? "delete" : "soft-delete",
        payload: { rowid: req.params.rowid },
      },
      async () => {
        if (hard) {
          await ds.table(table).deleteRow(req.params.rowid);
        } else {
          await ds.table(table).updateRow({
            ROWID: req.params.rowid,
            deleted_at: new Date().toISOString().slice(0, 19).replace("T", " "),
          });
        }
        delete _cache[table]; // FK-name lookup map is now stale
        return { rowid: req.params.rowid };
      },
    );
    res.json({ ok: true, rowid: result.rowid });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Generic: restore a soft-deleted row.
   ---------------------------------------------------------------- */
app.post("/:table/:rowid/restore", async (req, res) => {
  try {
    const catalyst = init(req);
    const table = assertTable(req.params.table);
    const ds = catalyst.datastore();

    const result = await withOpLog(
      catalyst,
      { table_name: table, operation: "restore", payload: { rowid: req.params.rowid } },
      async () => {
        await ds.table(table).updateRow({ ROWID: req.params.rowid, deleted_at: null });
        return { rowid: req.params.rowid };
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

