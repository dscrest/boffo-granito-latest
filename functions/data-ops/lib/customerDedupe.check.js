"use strict";
/* CR-373 self-check: node lib/customerDedupe.check.js */
const assert = require("node:assert/strict");
const { planDedupe } = require("./customerDedupe");

const row = (ROWID, code, name, crm, books, CREATEDTIME) => ({ ROWID, code, name, crm_account_id: crm, books_contact_id: books, CREATEDTIME });

// Pair: the Books-linked twin is kept even though it carries the higher code; orders of the other move to it.
{
  const p = planDedupe([row(1, "CUS-00231", "Hindustan Ceramics NX", "C1", "", "2026-10-21 12:55:42"), row(2, "CUS-00631", "Hindustan Ceramics NX", "C1", "B1", "2026-10-21 14:56:30")]);
  assert.equal(p.groups.length, 1);
  assert.equal(p.groups[0].keep.rowid, "2");
  assert.deepEqual(p.groups[0].drop.map((d) => d.rowid), ["1"]);
  assert.equal(p.groups[0].inherit_books, "");
  assert.equal(p.recodes.length, 0);
  assert.equal(p.conflicts.length, 0, "a merged pair is not a name conflict");
}

// Triple without a Books link: the lowest code is kept; a twin's Books id is inherited when the keeper has none.
{
  const p = planDedupe([
    row(1, "CUS-00490", "United Overseas", "C2", "", "2026-10-21 13:00:48"),
    row(2, "CUS-00468", "United Overseas", "C2", "", "2026-10-21 13:00:11"),
    row(3, "CUS-00724", "United Overseas", "C2", "B2", "2026-10-21 15:02:16"),
  ]);
  assert.equal(p.groups[0].keep.rowid, "3", "Books link wins over the lower code");
  assert.equal(p.groups[0].drop.length, 2);
  const q = planDedupe([row(1, "CUS-00490", "X", "C3", "", "2026-10-21 13:00:48"), row(2, "CUS-00468", "X", "C3", "", "2026-10-21 13:00:11")]);
  assert.equal(q.groups[0].keep.code, "CUS-00468");
  const r = planDedupe([row(1, "CUS-00001", "Y", "C4", "", "2026-10-21 12:00:00"), row(2, "CUS-00002", "Y", "C4", "B4", "2026-10-21 12:00:01")]);
  assert.equal(r.groups[0].keep.rowid, "2");
  const t = planDedupe([row(1, "CUS-00001", "Z", "C5", "", "2026-10-21 12:00:00"), row(2, "CUS-00002", "Z", "C5", "", "2026-10-21 12:00:01")]);
  assert.equal(t.groups[0].inherit_books, "");
}

// Code collision between two DIFFERENT customers: the earlier-created keeps the code; the next free code
// counts every live code (CUS-00700 exists on a row that is itself dropped → the new code is 00701).
{
  const p = planDedupe([
    row(1, "CUS-00618", "Shiv Tiles", "C6", "B6", "2026-10-21 14:55:46"),
    row(2, "CUS-00618", "Shri Ram Marble", "C7", "B7", "2026-10-21 14:54:25"),
    row(3, "CUS-00700", "Shiv Tiles", "C6", "", "2026-10-21 12:55:06"),
  ]);
  assert.equal(p.groups.length, 1);
  assert.equal(p.recodes.length, 1);
  assert.equal(p.recodes[0].rowid, "1");
  assert.equal(p.recodes[0].from, "CUS-00618");
  assert.equal(p.recodes[0].to, "CUS-00701");
}

// Same name on different CRM accounts, or unlinked: conflict only, never a group.
{
  const p = planDedupe([
    row(1, "CUS-00188", "Suraj Marketing", "C8", "", "2026-10-21 12:54:54"),
    row(2, "CUS-00613", "suraj  marketing", "C9", "B9", "2026-10-21 14:54:18"),
    row(3, "CUS-00001", "Dummy Trading Co", "", "", "2026-10-02 10:00:00"),
    row(4, "CUS-00002", "Dummy Trading Co", "", "", "2026-10-02 10:00:01"),
  ]);
  assert.equal(p.groups.length, 0);
  assert.equal(p.conflicts.length, 2);
  assert.deepEqual(p.conflicts.map((c) => c.rows.length), [2, 2]);
}

// Already clean → empty plan (idempotent second run).
{
  const p = planDedupe([row(1, "CUS-00001", "A", "C1", "B1", "2026-10-21 12:00:00"), row(2, "CUS-00002", "B", "C2", "", "2026-10-21 12:00:00"), row(3, "CUS-00003", "C", "", "", "")]);
  assert.deepEqual(p, { groups: [], recodes: [], conflicts: [] });
}

console.log("customerDedupe.check: ok");
