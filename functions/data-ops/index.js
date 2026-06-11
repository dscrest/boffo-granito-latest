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

const app = express();
app.use(express.json({ limit: "1mb" }));

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
  "Pallet",
  "DesignPallet",
  "PalletisedBatch",
  "PalletisedBatchLine",
  "Container",
  "ContainerLoading",
  "OrderItemEvent",
  "Activity",
  "OperationLog",
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
      "SELECT ROWID, design_name, unique_name FROM Design",
      ["design_name", "unique_name"],
      "ROWID",
    );
  return _cache.Design;
}
async function customerMap(catalyst) {
  if (!_cache.Customer)
    _cache.Customer = await buildMap(
      catalyst,
      "SELECT ROWID, name, code FROM Customer",
      ["name", "code"],
      "ROWID",
    );
  return _cache.Customer;
}
async function paymentTermMap(catalyst) {
  if (!_cache.PaymentTerm)
    _cache.PaymentTerm = await buildMap(
      catalyst,
      "SELECT ROWID, name FROM PaymentTerm",
      ["name"],
      "ROWID",
    );
  return _cache.PaymentTerm;
}

function resolve(map, name) {
  if (name == null || name === "") return null;
  return map.get(String(name).toLowerCase()) || null;
}

/* ----------------------------------------------------------------
   OperationLog wrapper — records every mutating op's outcome.
   ---------------------------------------------------------------- */
async function currentActor(catalyst) {
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
  return catalystSDK.initialize(req);
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
  const rows = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM ${table} WHERE ${field} = '${safe}'`),
  );
  if (rows.some((r) => String(r.ROWID) !== String(excludeRowid || ""))) {
    throw badRequest(`${table} ${field} "${value}" already exists`, 409);
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
  PaymentTerm: "name",
  Pallet: "name",
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

    const result = await withOpLog(
      catalyst,
      { table_name: "Quote", operation: "insert", payload: body },
      async () => {
        // Validate everything up front — never write a header then fail on a line.
        await assertUnique(catalyst, "Quote", "quote_number", body.quote_number);
        assertDateOrder(body.quote_date, body.expiry_date, "quote date", "expiry date");
        const customer = resolveOrThrow(cMap, body.customer, "Customer");
        const paymentTerm = resolveOptional(pMap, body.payment_term, "Payment term");
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
          status: body.status || "Draft",
          currency: body.currency || "EUR",
          remarks: body.remarks || "",
          address: body.address || "",
          salesperson: body.salesperson || "",
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

    const result = await withOpLog(
      catalyst,
      { table_name: "Quote", operation: "update", payload: { ROWID: quoteId, ...body } },
      async () => {
        // Validate everything up front — never write a header then fail on a line.
        await assertUnique(catalyst, "Quote", "quote_number", body.quote_number, quoteId);
        assertDateOrder(body.quote_date, body.expiry_date, "quote date", "expiry date");
        const customer = resolveOrThrow(cMap, body.customer, "Customer");
        const paymentTerm = resolveOptional(pMap, body.payment_term, "Payment term");
        const { items, total } = computeLines(body.lines);
        const designIds = items.map((it) => resolveOrThrow(dMap, it.line.item, "Design"));

        const doc = docCompute(total, body);
        await ds.table("Quote").updateRow({
          ROWID: quoteId,
          quote_number: body.quote_number || "",
          customer,
          quote_date: body.quote_date || undefined,
          expiry_date: body.expiry_date || undefined,
          payment_term: paymentTerm,
          port_of_discharge: body.port_of_discharge || "",
          status: body.status || "Draft",
          currency: body.currency || "EUR",
          remarks: body.remarks || "",
          address: body.address || "",
          salesperson: body.salesperson || "",
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

        // Replace lines: delete existing QuoteItem rows for this quote, re-insert.
        const oldRows = rowList(
          await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM QuoteItem WHERE quote = ${quoteId}`),
        );
        for (const r of oldRows) await ds.table("QuoteItem").deleteRow(r.ROWID);

        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          await ds.table("QuoteItem").insertRow({
            quote: quoteId,
            design: designIds[i],
            quantity_boxes: Number(it.line.qty) || 0,
            rate: Number(it.line.rate) || 0,
            rate_basis: it.line.rate_basis || "box",
            discount_pct: Number(it.line.discount) || 0,
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
   Business: SalesOrder header + line items
   body: { customer, po_number, order_date, shipment_date, payment_term,
           port_of_discharge, status, currency, remarks, address, order_number,
           quote_rowid?, salesperson, customer_notes, terms,
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

    const result = await withOpLog(
      catalyst,
      { table_name: "SalesOrder", operation: "insert", payload: body },
      async () => createSalesOrder(ds, body, { dMap, cMap, pMap, catalyst }),
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

async function createSalesOrder(ds, body, maps) {
  // Validate everything up front — never write a header then fail on a line.
  if (maps.catalyst) await assertUnique(maps.catalyst, "SalesOrder", "order_number", body.order_number);
  assertDateOrder(body.order_date, body.shipment_date, "order date", "shipment date");
  // Customer: convert-quote passes the source quote's customer ROWID directly
  // (customer_rowid); direct SO creation passes a name to resolve strictly.
  const customer = body.customer_rowid || resolveOrThrow(maps.cMap, body.customer, "Customer");
  const paymentTerm = resolveOptional(maps.pMap, body.payment_term, "Payment term");
  const { items, total } = computeLines(body.lines);
  const designIds = items.map((it) => resolveOrThrow(maps.dMap, it.line.item, "Design"));

  const doc = docCompute(total, body);
  const soRow = await ds.table("SalesOrder").insertRow({
    order_number: body.order_number || "",
    quote: body.quote_rowid || null,
    customer,
    po_number: body.po_number || "",
    order_date: body.order_date || undefined,
    // date column rejects "" → omit (undefined) when blank.
    shipment_date: body.shipment_date || undefined,
    payment_term: paymentTerm,
    port_of_discharge: body.port_of_discharge || "",
    status: body.status || "Confirmed",
    currency: body.currency || "EUR",
    remarks: body.remarks || "",
    address: body.address || "",
    manual_so_number: body.manual_so_number || "",
    salesperson: body.salesperson || "",
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
      sub_total: it.sub,
      final_total: it.sub,
    });
  }
  return { rowid: soId, data: { ROWID: soId, total_amount: doc.total_amount } };
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
            status: "Confirmed",
            currency: q.currency,
            remarks: `Converted from ${q.quote_number}${body.mode === "Partial" ? " (partial)" : ""}`,
            address: q.address,
            // Carry the quote's Books-parity header fields onto the SO, allowing
            // the convert request to override per-field.
            salesperson: body.salesperson || q.salesperson || "",
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
          { dMap, cMap, pMap, catalyst },
        );

        const flag = body.mode === "Partial" ? "Partial" : "Full";
        await ds.table("Quote").updateRow({
          ROWID: quoteId,
          conversion_flag: flag,
          status: flag === "Full" ? "Converted" : "PartiallyConverted",
        });
        return { rowid: so.rowid, data: { so_rowid: so.rowid, quote_rowid: quoteId, conversion_flag: flag } };
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
  const oiMap = await loadOrderItems(catalyst, [...reqByOi.keys()], "ROWID, produced_qty_boxes, palletized_qty_boxes");
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

  // Container + capacity.
  const cRows = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, capacity_boxes, capacity_pallets, status FROM Container WHERE ROWID = ${containerId}`,
    ),
  );
  if (!cRows.length) throw badRequest(`Container not found: ${containerId}`, 404);
  const container = cRows[0];
  const capBoxes = Number(container.capacity_boxes) || 0;
  const capPallets = Number(container.capacity_pallets) || 0;

  // Existing loadings on this container (count + boxes already loaded).
  const existing = rowList(
    await catalyst.zcql().executeZCQLQuery(`SELECT batch FROM ContainerLoading WHERE container = ${containerId}`),
  );
  const existingSet = new Set(existing.map((r) => String(r.batch)));
  let loadedBoxes = 0;
  if (existing.length) {
    const exBatches = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT boxes_packed FROM PalletisedBatch WHERE ROWID IN (${existing.map((r) => String(r.batch)).join(",")})`,
      ),
    );
    loadedBoxes = exBatches.reduce((s, b) => s + (Number(b.boxes_packed) || 0), 0);
  }
  const palletCount = existing.length;

  // New batches: exist, not already loaded.
  const nb = rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, boxes_packed, status FROM PalletisedBatch WHERE ROWID IN (${batchIds.join(",")})`,
    ),
  );
  const nbMap = new Map(nb.map((b) => [String(b.ROWID), b]));
  let addBoxes = 0;
  for (const bid of batchIds) {
    const b = nbMap.get(bid);
    if (!b) throw badRequest(`Batch not found: ${bid}`, 404);
    if (existingSet.has(bid) || String(b.status) === "loaded") throw badRequest(`Batch ${bid} already loaded`, 409);
    addBoxes += Number(b.boxes_packed) || 0;
  }
  if (capBoxes && loadedBoxes + addBoxes > capBoxes) {
    throw badRequest(`Capacity exceeded: ${loadedBoxes}+${addBoxes} > ${capBoxes} boxes`, 409);
  }
  if (capPallets && palletCount + batchIds.length > capPallets) {
    throw badRequest(`Pallet capacity exceeded: ${palletCount}+${batchIds.length} > ${capPallets}`, 409);
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
          `SELECT ROWID, palletized_qty_boxes, loaded_qty_boxes FROM OrderItem WHERE ROWID = ${ln.order_item}`,
        ),
      );
      if (!oiRows.length) continue;
      const oi = oiRows[0];
      const addQty = Number(ln.boxes) || 0;
      const next = Math.min((Number(oi.loaded_qty_boxes) || 0) + addQty, Number(oi.palletized_qty_boxes) || 0);
      await ds.table("OrderItem").updateRow({ ROWID: ln.order_item, loaded_qty_boxes: next, stage: "loading" });
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
    await catalyst.zcql().executeZCQLQuery(`SELECT batch FROM ContainerLoading WHERE container = ${containerId}`),
  );
  if (!loadings.length) throw badRequest("Container has no loaded pallets", 409);

  for (const ld of loadings) {
    const lineRows = rowList(
      await catalyst.zcql().executeZCQLQuery(`SELECT order_item, boxes FROM PalletisedBatchLine WHERE batch = ${ld.batch}`),
    );
    for (const ln of lineRows) {
      const oiRows = rowList(
        await catalyst.zcql().executeZCQLQuery(
          `SELECT ROWID, loaded_qty_boxes, dispatched_qty_boxes FROM OrderItem WHERE ROWID = ${ln.order_item}`,
        ),
      );
      if (!oiRows.length) continue;
      const oi = oiRows[0];
      const addQty = Number(ln.boxes) || 0;
      const next = Math.min((Number(oi.dispatched_qty_boxes) || 0) + addQty, Number(oi.loaded_qty_boxes) || 0);
      await ds.table("OrderItem").updateRow({ ROWID: ln.order_item, dispatched_qty_boxes: next, stage: "final" });
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
  const closed = rowList(await zcql.executeZCQLQuery(`SELECT ROWID, design, pallet, boxes_packed, is_demo FROM PalletisedBatch WHERE status = 'closed'`));
  const allLoadings = rowList(await zcql.executeZCQLQuery(`SELECT container, batch FROM ContainerLoading`));
  const loadedSet = new Set(allLoadings.map((r) => String(r.batch)));

  const batches = closed
    .filter((b) => !loadedSet.has(String(b.ROWID)))
    .map((b) => {
      const der = derive(b);
      const demo = b.is_demo === true || String(b.is_demo) === "true";
      return {
        batch: String(b.ROWID),
        design: String(b.design || ""),
        boxes: der.boxes,
        areaSqm: der.areaSqm,
        weightKg: der.weightKg,
        tier: demo ? 3 : 0, // 0 = current pending order; 3 = demo. Customer tiers (1/2) = §7.5 (later).
      };
    });

  // Available containers: loading + planned. capacity_area_sqm / max_weight_kg are nullable.
  const cRows = rowList(
    await zcql.executeZCQLQuery(
      `SELECT ROWID, container_number, capacity_boxes, capacity_pallets, capacity_area_sqm, max_weight_kg, status, etd FROM Container WHERE status = 'loading' OR status = 'planned'`,
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
    // ZCQL hard-caps LIMIT at 300 rows per query.
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 300);
    const where = req.query.where ? ` WHERE ${req.query.where}` : "";
    const order = req.query.order ? ` ORDER BY ${req.query.order}` : "";
    const sql = `SELECT * FROM ${table}${where}${order} LIMIT ${limit}`;
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
        .executeZCQLQuery(`SELECT * FROM ${table} WHERE ROWID = ${req.params.rowid}`),
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
        if (nk) for (const r of rows) await assertUnique(catalyst, table, nk, r[nk]);
        const inserted = await ds.table(table).insertRows(rows);
        const ids = (Array.isArray(inserted) ? inserted : [inserted]).map((r) => r.ROWID);
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
        // Reject natural-key changes that collide with a different existing row.
        const nk = NATURAL_KEY[table];
        if (nk && patch[nk] !== undefined) {
          await assertUnique(catalyst, table, nk, patch[nk], req.params.rowid);
        }
        const row = await ds.table(table).updateRow(patch);
        return { rowid: (row && row.ROWID) || req.params.rowid, data: row };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Generic: delete
   ---------------------------------------------------------------- */
app.delete("/:table/:rowid", async (req, res) => {
  try {
    const catalyst = init(req);
    const table = assertTable(req.params.table);
    const ds = catalyst.datastore();

    const result = await withOpLog(
      catalyst,
      { table_name: table, operation: "delete", payload: { rowid: req.params.rowid } },
      async () => {
        await ds.table(table).deleteRow(req.params.rowid);
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
            currency: c.currency || "EUR",
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
            status: "Continue",
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

