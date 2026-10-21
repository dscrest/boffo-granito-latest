"use strict";

/**
 * CR-359 — the provider-agnostic customer sync (lifted out of booksSync.js, CR-356/358).
 * A provider adapter (lib/booksSync.js, lib/crmSync.js) supplies:
 *   name, label, linkColumn          "books" / "crm", Customer.<link> column
 *   listChanged(ctx, {watermark, full, page}) → { hits: [{id, name, modified}] newest first, hasMore }
 *   loadAux(ctx)                     per-run lookups (payment terms, CRM field map)
 *   fetch(ctx, id, aux)              the full remote record (null when gone)
 *   toCustomer(record, aux)          → Customer patch (non-empty values only, link column included)
 *   toRecord(row, aux)               → remote body for create / update
 *   create(ctx, body, aux) → id      update(ctx, id, body, aux, row)
 *   search(ctx, q)                   → [{id, name, detail, phone, place}] for the picker
 *
 *   sync(ctx, A, {full:false})       incremental pull: stop at the watermark (zoho_<p>_sync_at).
 *   sync(ctx, A, {full:true, page})  one-time import, one page per call; the client loops on `done`.
 *   push(ctx, A, rowid)              create / update the remote record for a customer.
 *
 * The remote wins on a pull: a value overwrites only where it is non-empty; add-on-only columns
 * (code, box_brand, port_of_discharge, handling_person, main_party_name, working_status, overseas,
 * additional_addresses) are never touched. A customer is matched by the link column, else by name
 * (case-insensitive, unmapped only) which links it, else created with the next CUS- code. Every
 * write goes to OperationLog (actor zoho-<provider>-sync). No watermark yet = nothing imported =
 * the incremental run does nothing and says so — the full pull is always explicit (Import all).
 */
const zoho = require("./zoho");

// CR-362: 1 list + per account (CRM detail + Contacts + Books check + insert) ≈ 1.1 s — a page of 25 ran
// 26–36 s and hit the gateway's ~30 s limit (408 / dropped connection) on the 2026-10-21 import.
const IMPORT_PAGE = 10; // ≈ 12 s per page
const INCREMENTAL_CAP = 50; // oldest-first; the rest arrive on the next run

const s = (v) => (v == null ? "" : String(v).trim());
const syncAtKey = (A) => `zoho_${A.name}_sync_at`;
const summaryKey = (A) => `zoho_${A.name}_sync_summary`;

/* Country display name → ISO, the way the client derives country_code from the billing
   country (Intl.DisplayNames; no hand-kept list). */
const NAME_TO_ISO = (() => {
  const m = new Map();
  let names;
  try {
    names = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return m;
  }
  for (let a = 65; a <= 90; a++)
    for (let b = 65; b <= 90; b++) {
      const iso = String.fromCharCode(a) + String.fromCharCode(b);
      let n = "";
      try {
        n = names.of(iso) || "";
      } catch {
        /* invalid region */
      }
      if (n && n !== iso) m.set(n, iso);
    }
  return m;
})();

/** Legacy one-line `address` (quote/order autofill reads it) — composed like PartyForm does. */
const composeAddress = ({ attention, street1, street2, city, state, pincode, country }) => {
  const cityLine = [city, state, pincode].map(s).filter(Boolean).join(" ");
  return [attention, street1, street2, cityLine, country].map(s).filter(Boolean).join(", ");
};

/** Twin of client lib/seq.ts nextCustomerCode. */
function nextCustomerCode(codes) {
  let max = 0;
  for (const c of codes) {
    const n = /^CUS-(\d+)$/.exec(s(c));
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `CUS-${String(max + 1).padStart(5, "0")}`;
}

/* Remote timestamps ("2026-10-21T10:30:00+0530" / "+05:30") — Date.parse handles the offset;
   string compare is the fallback for an unparseable pair. */
function newerThan(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isNaN(ta) || Number.isNaN(tb) ? String(a) > String(b) : ta > tb;
}

/** Which hits to process. Incremental: the hits newer than `watermark` (list is newest first),
    oldest first, capped. Full: every hit — except (CR-362) hits already linked (`linked` = Set of remote
    ids) and not modified since the watermark, so a re-run after a failed page costs list calls only.
    Returns { rows, reachedWatermark, skipped }. */
function pickChanged(hits, watermark, { full, linked }) {
  if (full) {
    const unchanged = hits.filter((h) => linked && linked.has(s(h.id)) && watermark && !newerThan(h.modified, watermark));
    const rows = hits.filter((h) => !unchanged.includes(h));
    return { rows, reachedWatermark: false, skipped: unchanged.length, unchanged };
  }
  const fresh = [];
  let reached = false;
  for (const r of hits) {
    if (watermark && !newerThan(r.modified, watermark)) {
      reached = true;
      break;
    }
    fresh.push(r);
  }
  fresh.reverse(); // oldest first, so the watermark can advance safely when capped
  return { rows: fresh.slice(0, INCREMENTAL_CAP), reachedWatermark: reached, skipped: 0, unchanged: [] };
}

async function lastSummary(catalyst, rowList, A) {
  const row = (await zoho.settingRows(catalyst, rowList, [summaryKey(A)]))[0];
  try {
    return row ? JSON.parse(String(row.setting_value || "")) : null;
  } catch {
    return null;
  }
}

/** PaymentTerm label ↔ ROWID maps, shared by both adapters. */
async function loadTerms(catalyst, rowList) {
  const rows = rowList(await catalyst.zcql().executeZCQLQuery("SELECT ROWID, name FROM PaymentTerm WHERE deleted_at is null"));
  const idByLabel = new Map();
  const labelById = new Map();
  for (const r of rows) {
    idByLabel.set(s(r.name).toLowerCase(), String(r.ROWID));
    labelById.set(String(r.ROWID), s(r.name));
  }
  return { idByLabel, labelById };
}

const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

/* CR-358 — one run at a time per warm instance. The Signals webhook, the cron, "Refresh now" and an
   Import page can land seconds apart; two runs that both read `existing` before either writes would
   insert the same new record twice. One lock for both providers (same Customer table).
   ponytail: in-process lock (Catalyst runs one instance of this function); a Data Store lock row is
   the upgrade if it ever fans out. */
let inflight = null;
async function sync(ctx, A, opts) {
  while (inflight) await inflight.catch(() => {});
  inflight = run(ctx, A, opts);
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

async function run(ctx, A, { full = false, page = 1 } = {}) {
  const { catalyst, rowList, writeOpLog } = ctx;
  const summary = { ok: true, provider: A.name, mode: full ? "import" : "refresh", page, done: true, created: 0, updated: 0, linked: 0, skipped: 0, errors: [], at: istNow() };
  const watermarkRow = (await zoho.settingRows(catalyst, rowList, [syncAtKey(A)]))[0];
  let watermark = watermarkRow ? s(watermarkRow.setting_value) : "";

  if (!full && !watermark) {
    // Nothing imported yet — the explicit Import all is the only full pull.
    summary.skipped = -1;
    summary.note = "Run Import all customers once — the refresh only picks up changes after that.";
    await zoho.putSetting(catalyst, rowList, summaryKey(A), JSON.stringify(summary));
    return summary;
  }

  const { hits, hasMore } = await A.listChanged(ctx, { watermark, full, page, perPage: full ? IMPORT_PAGE : 200 });
  const existing = hits.length
    ? rowList(await catalyst.zcql().executeZCQLQuery("SELECT ROWID, code, name, crm_account_id, books_contact_id FROM Customer WHERE deleted_at is null"))
    : [];
  const byLink = new Map();
  const byName = new Map();
  const codes = [];
  for (const r of existing) {
    codes.push(r.code);
    const lid = s(r[A.linkColumn]);
    if (lid) byLink.set(lid, r);
    else byName.set(s(r.name).toLowerCase(), r);
  }
  const { rows: todo, reachedWatermark, skipped, unchanged } = pickChanged(hits, watermark, { full, linked: new Set(byLink.keys()) });
  if (full) {
    summary.done = !hasMore;
    summary.skipped = skipped; // CR-362: already imported, unchanged
  } else summary.done = reachedWatermark || !hasMore || todo.length === hits.length;

  // One adapter aux per run (CR-363: the re-check below shares it, and its note is reported once).
  const aux = todo.length || (full && unchanged.length && A.recheck) ? await A.loadAux(ctx) : null;
  if (todo.length) {
    let code = nextCustomerCode(codes);
    const bump = () => {
      const c = code;
      code = nextCustomerCode([code]);
      return c;
    };
    const table = catalyst.datastore().table("Customer");

    for (const hit of todo) {
      const rid = s(hit.id);
      const started = Date.now();
      try {
        const record = await A.fetch(ctx, rid, aux);
        if (!record) throw new Error("record not found");
        const patch = A.toCustomer(record, aux);
        patch[A.linkColumn] = rid;
        const nameKey = s(patch.name).toLowerCase();
        let row = byLink.get(rid);
        let op = "update";
        if (!row) {
          row = byName.get(nameKey);
          if (row) {
            op = "link";
            byName.delete(nameKey);
            byLink.set(rid, row);
          }
        }
        if (row) {
          await table.updateRow({ ROWID: row.ROWID, ...patch });
          if (op === "link") summary.linked++;
          else summary.updated++;
        } else {
          op = "create";
          const ins = await table.insertRow({ code: bump(), active: true, ...patch });
          row = { ROWID: ins && ins.ROWID, name: patch.name };
          byLink.set(rid, row);
          summary.created++;
        }
        await writeOpLog(catalyst, {
          table_name: "Customer",
          operation: `${A.name}-sync:${op}`,
          entity_rowid: row.ROWID,
          status: "ok",
          duration_ms: Date.now() - started,
          actor: `zoho-${A.name}-sync`,
          payload_summary: `${patch.name || rid} ← ${A.label} ${rid}`,
        });
        if (!watermark || newerThan(hit.modified, watermark)) watermark = s(hit.modified);
      } catch (e) {
        if (e && e.statusCode === 409) throw e; // reauth_required — nothing partial to report
        summary.errors.push(`${s(hit.name) || rid}: ${(e && e.message) || e}`);
        await writeOpLog(catalyst, {
          table_name: "Customer",
          operation: `${A.name}-sync`,
          status: "error",
          error_text: (e && e.message) || String(e),
          duration_ms: Date.now() - started,
          actor: `zoho-${A.name}-sync`,
          payload_summary: `${A.label} ${rid}`,
        });
        // The remote wins only once it has been written — an errored record keeps the old
        // watermark so the next run retries it.
        if (!full) break;
      }
    }
  } else if (!full) {
    summary.skipped = hits.length;
  }
  if (full && unchanged.length && A.recheck) {
    // CR-363: skipped-as-unchanged rows still get the cheap cross-link check (Books link for CRM rows).
    const table = catalyst.datastore().table("Customer");
    for (const hit of unchanged) {
      const row = byLink.get(s(hit.id));
      if (!row) continue;
      const started = Date.now();
      try {
        const patch = await A.recheck(ctx, aux, row);
        if (!patch) continue;
        await table.updateRow({ ROWID: row.ROWID, ...patch });
        summary.linked++;
        await writeOpLog(catalyst, {
          table_name: "Customer",
          operation: `${A.name}-sync:recheck`,
          entity_rowid: row.ROWID,
          status: "ok",
          duration_ms: Date.now() - started,
          actor: `zoho-${A.name}-sync`,
          payload_summary: `${s(row.name) || hit.id} ← ${Object.entries(patch).map(([k, v]) => `${k} ${v}`).join(", ")}`,
        });
      } catch (e) {
        if (e && e.statusCode === 409) throw e;
        summary.errors.push(`${s(hit.name) || hit.id}: ${(e && e.message) || e}`);
      }
    }
  }
  if (aux && aux.note) summary.errors.push(aux.note);
  if (full && page === 1 && hits.length) {
    // Page 1 of a newest-first import holds the newest record of all — that is the watermark.
    const top = s(hits[0].modified);
    if (!watermark || newerThan(top, watermark)) watermark = top;
  }
  if (watermark) await zoho.putSetting(catalyst, rowList, syncAtKey(A), watermark);
  await zoho.putSetting(catalyst, rowList, summaryKey(A), JSON.stringify(summary));
  return summary;
}

async function push(ctx, A, rowid) {
  const { catalyst, rowList, writeOpLog } = ctx;
  if (!rowid) throw zoho.httpErr("Customer rowid required", 400);
  const conn = await zoho.getConnection(catalyst, rowList, A.name);
  if (!conn) throw zoho.httpErr("reauth_required", 409);
  if (!zoho.canWrite(conn)) throw zoho.httpErr(`Reconnect ${A.label} in Settings to allow creating customers there`, 409);
  const row = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT * FROM Customer WHERE ROWID = ${rowid} AND deleted_at is null`))[0];
  if (!row) throw zoho.httpErr("Customer not found", 404);
  const aux = await A.loadAux(ctx);
  const body = A.toRecord(row, aux);
  const link = s(row[A.linkColumn]);
  const started = Date.now();
  const id = link ? await A.update(ctx, link, body, aux, row) : await A.create(ctx, body, aux);
  if (!link && id) await catalyst.datastore().table("Customer").updateRow({ ROWID: row.ROWID, [A.linkColumn]: id });
  await writeOpLog(catalyst, {
    table_name: "Customer",
    operation: link ? `${A.name}-push:update` : `${A.name}-push:create`,
    entity_rowid: row.ROWID,
    status: "ok",
    duration_ms: Date.now() - started,
    actor: `zoho-${A.name}-sync`,
    payload_summary: `${s(row.name)} → ${A.label} ${id}`,
  });
  return { id, created: !link };
}

module.exports = {
  IMPORT_PAGE,
  INCREMENTAL_CAP,
  NAME_TO_ISO,
  composeAddress,
  nextCustomerCode,
  newerThan,
  pickChanged,
  loadTerms,
  lastSummary,
  sync,
  push,
  s,
};
