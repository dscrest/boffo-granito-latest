"use strict";

/**
 * CR-373 — pure planner for POST /customer-dedupe (index.js). The 2026-10-21 CRM imports minted twins
 * (same crm_account_id, 822 rows for ≈530 accounts) and reused CUS- codes — ZCQL's 300-row cap inside
 * the sync, fixed by CR-372. planDedupe(rows) → { groups, recodes, conflicts }:
 *
 *   groups     rows sharing a crm_account_id. keep = the row that carries the Books link (CRM & Books —
 *              "all data related to Books lives on the CRM-synced customer"), else the lowest CUS- code;
 *              drop = the rest. inherit_books = a dropped twin's books_contact_id the keeper should take
 *              when it has none ("" = nothing to copy).
 *   recodes    survivors sharing one CUS- code: the earliest-created keeps it, the others get the next
 *              free code (counted over EVERY live code, dropped rows included — a code is never reused).
 *   conflicts  survivors sharing a name (case / whitespace-insensitive) on different CRM accounts or
 *              unlinked. Reported only — CRM is the source; merge them there or map by hand.
 *
 * Self-check: node lib/customerDedupe.check.js
 */
const { nextCustomerCode, s } = require("./customerSync");

const nameKey = (r) => s(r.name).toLowerCase().replace(/\s+/g, " ");
const codeNum = (c) => {
  const m = /^CUS-(\d+)$/.exec(s(c));
  return m ? Number(m[1]) : Infinity;
};
const pick = (r) => ({ rowid: r.ROWID, code: r.code, name: r.name, books: !!r.books_contact_id, created: r.created });
const push = (map, k, v) => map.set(k, [...(map.get(k) || []), v]);

function planDedupe(rows) {
  const live = (rows || []).map((r) => ({
    ROWID: String(r.ROWID),
    code: s(r.code),
    name: s(r.name),
    crm_account_id: s(r.crm_account_id),
    books_contact_id: s(r.books_contact_id),
    created: s(r.CREATEDTIME),
  }));

  const byCrm = new Map();
  for (const r of live) if (r.crm_account_id) push(byCrm, r.crm_account_id, r);
  const groups = [];
  const dropped = new Set();
  for (const [id, rs] of byCrm) {
    if (rs.length < 2) continue;
    const sorted = [...rs].sort(
      (a, b) => (b.books_contact_id ? 1 : 0) - (a.books_contact_id ? 1 : 0) || codeNum(a.code) - codeNum(b.code) || a.created.localeCompare(b.created),
    );
    const keep = sorted[0];
    const drop = sorted.slice(1);
    for (const d of drop) dropped.add(d.ROWID);
    const twinBooks = (drop.find((d) => d.books_contact_id) || {}).books_contact_id || "";
    groups.push({ crm_account_id: id, keep: pick(keep), drop: drop.map(pick), inherit_books: keep.books_contact_id ? "" : twinBooks });
  }

  const survivors = live.filter((r) => !dropped.has(r.ROWID));
  const byCode = new Map();
  for (const r of survivors) if (r.code) push(byCode, r.code, r);
  let code = nextCustomerCode(live.map((r) => r.code));
  const recodes = [];
  for (const [c, rs] of byCode) {
    if (rs.length < 2) continue;
    const sorted = [...rs].sort((a, b) => a.created.localeCompare(b.created) || a.ROWID.localeCompare(b.ROWID));
    for (const r of sorted.slice(1)) {
      recodes.push({ ...pick(r), from: c, to: code });
      code = nextCustomerCode([code]);
    }
  }

  const byNm = new Map();
  for (const r of survivors) push(byNm, nameKey(r), r);
  const conflicts = [];
  for (const rs of byNm.values()) {
    if (rs.length < 2) continue;
    conflicts.push({ name: rs[0].name, rows: rs.map((r) => ({ ...pick(r), crm_account_id: r.crm_account_id })) });
  }

  return { groups, recodes, conflicts };
}

module.exports = { planDedupe, nameKey };
