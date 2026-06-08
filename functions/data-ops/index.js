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
   Health / root
   ---------------------------------------------------------------- */
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "data-ops" });
});

/* ----------------------------------------------------------------
   Business: Quote header + line items
   body: { customer, quote_date, payment_term, port_of_discharge, status,
           currency, remarks, address, quote_number,
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
        const lines = Array.isArray(body.lines) ? body.lines : [];
        let total = 0;
        const items = lines.map((l) => {
          const gross = (Number(l.qty) || 0) * (Number(l.rate) || 0);
          const disc = gross * ((Number(l.discount) || 0) / 100);
          const sub = round2(gross - disc);
          total += sub;
          return { line: l, sub };
        });

        const quoteRow = await ds.table("Quote").insertRow({
          quote_number: body.quote_number || "",
          customer: resolve(cMap, body.customer),
          quote_date: body.quote_date || undefined,
          payment_term: resolve(pMap, body.payment_term),
          port_of_discharge: body.port_of_discharge || "",
          status: body.status || "Draft",
          currency: body.currency || "EUR",
          remarks: body.remarks || "",
          address: body.address || "",
          conversion_flag: "None",
          total_amount: round2(total),
        });
        const quoteId = quoteRow.ROWID;

        for (const it of items) {
          const gross = (Number(it.line.qty) || 0) * (Number(it.line.rate) || 0);
          await ds.table("QuoteItem").insertRow({
            quote: quoteId,
            design: resolve(dMap, it.line.item),
            quantity_boxes: Number(it.line.qty) || 0,
            rate: Number(it.line.rate) || 0,
            rate_basis: it.line.rate_basis || "box",
            discount_pct: Number(it.line.discount) || 0,
            sub_total: it.sub,
            final_total: it.sub,
          });
        }
        return { rowid: quoteId, data: { ROWID: quoteId, total_amount: round2(total) } };
      },
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

/* ----------------------------------------------------------------
   Business: SalesOrder header + line items
   body: { customer, po_number, order_date, payment_term, port_of_discharge,
           status, currency, remarks, address, order_number, quote_rowid?,
           lines: [{ item, qty, rate, stage?, priority? , due_date? }] }
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
      async () => createSalesOrder(ds, body, { dMap, cMap, pMap }),
    );
    res.json({ ok: true, rowid: result.rowid, data: result.data });
  } catch (err) {
    sendErr(res, err);
  }
});

async function createSalesOrder(ds, body, maps) {
  const soRow = await ds.table("SalesOrder").insertRow({
    order_number: body.order_number || "",
    quote: body.quote_rowid || null,
    customer: resolve(maps.cMap, body.customer),
    po_number: body.po_number || "",
    order_date: body.order_date || undefined,
    payment_term: resolve(maps.pMap, body.payment_term),
    port_of_discharge: body.port_of_discharge || "",
    status: body.status || "Confirmed",
    currency: body.currency || "EUR",
    remarks: body.remarks || "",
    address: body.address || "",
    manual_so_number: body.manual_so_number || "",
  });
  const soId = soRow.ROWID;
  const lines = Array.isArray(body.lines) ? body.lines : [];
  for (const l of lines) {
    await ds.table("OrderItem").insertRow({
      sales_order: soId,
      design: resolve(maps.dMap, l.item),
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
    });
  }
  return { rowid: soId, data: { ROWID: soId } };
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
            payment_term: body.payment_term,
            port_of_discharge: q.port_of_discharge,
            status: "Confirmed",
            currency: q.currency,
            remarks: `Converted from ${q.quote_number}${body.mode === "Partial" ? " (partial)" : ""}`,
            address: q.address,
            quote_rowid: quoteId,
            lines: Array.isArray(body.lines) ? body.lines : [],
          },
          { dMap, cMap, pMap },
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

