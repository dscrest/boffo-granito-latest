# Item Master + Grid UI Change Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a 7-item feature/UI batch — bold grid headers, un-clipped advanced-filter popup, Items grid size/status selects removed, activity-log local time + Status column removed, uploaded-filename preservation, keep-selection-after-edit, and no-refresh on the selected item.

**Architecture:** Design/UI changes land in shared surfaces (global CSS, the shared `AdvancedFilter` and `ActivityLog` components) so every grid inherits them from one edit. Behavior changes are scoped to the Item master (`DesignMaster` / `ItemDetail` / `DesignEdit` / `designsApi`) plus one server handler (`functions/data-ops`). Cache stays in-place via a new `patch()` on the generic list cache — no full refetch of the selected item.

**Tech Stack:** React + TypeScript (Vite), plain CSS (`client/src/styles/styles.css`), Catalyst AppSail Node function (`functions/data-ops/index.js`).

## Global Constraints

- This is NOT stock Next.js/React tooling assumptions — follow existing file patterns; read `AGENTS.md`.
- No unit-test framework in `client/` — verify each task with a TypeScript build (`cd client && npm run build`) and a browser check. Do NOT scaffold a test runner.
- Master-page UI convention holds: no inline row actions, row-click → detail, bulk select for update/delete. Do not regress it.
- Catalyst datetime string format is `"2026-06-29 15:56:48:741"` (space separator, millis after a COLON, NO timezone; treat as UTC).
- Commit after each task. End commit messages with the Co-Authored-By trailer already used in this repo.
- Do not touch the shared `fmtDateTime` (grid Created/Modified columns depend on its current truncation).

---

### Task 1: Global CSS — bold headers + un-clipped advanced-filter popup

**Files:**
- Modify: `client/src/styles/styles.css` (`.tbl th` ~line 477; add `.filter-modal` near `.modal-panel` ~line 1215)
- Modify: `client/src/ui/AdvancedFilter.tsx:252` (FilterModal panel className) and `:260` (body)

**Interfaces:**
- Produces: CSS class `.filter-modal` (rounded card box, `overflow: visible`). Consumed by `AdvancedFilter.tsx`.

- [ ] **Step 1: Bold every grid header**

In `client/src/styles/styles.css`, `.tbl th` block, change:
```css
  font-weight: 500;
```
to:
```css
  font-weight: 700;
```

- [ ] **Step 2: Add the `.filter-modal` panel class**

Immediately after the `.modal-body { ... }` rule (~line 1226) in `styles.css`, add:
```css
/* Advanced-search modal: a card-looking panel that does NOT clip its
   children. `.card` uses `overflow: clip`, which sliced the multiselect
   checkbox dropdowns and the rounded corners — this panel keeps the box
   but lets popups render fully. */
.filter-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 20, 25, 0.03);
  overflow: visible;
}
.filter-modal .modal-body {
  overflow: visible;   /* don't clip the field dropdowns */
  padding-right: 0;
}
```

- [ ] **Step 3: Point the FilterModal at the new class**

In `client/src/ui/AdvancedFilter.tsx`, `FilterModal` return (~line 252), change the panel element className from:
```tsx
      <div className="card modal-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label={`Search ${title}`} style={{ maxWidth: 900 }}>
```
to:
```tsx
      <div className="modal-panel filter-modal" ref={panelRef} role="dialog" aria-modal="true" aria-label={`Search ${title}`} style={{ maxWidth: 900 }}>
```

- [ ] **Step 4: Build**

Run: `cd client && npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 5: Browser verify**

Open the Items grid (`/design`), click the magnifier **Search** button, expand the **Size** multiselect. Expected: the checkbox dropdown and all four panel corners render fully — nothing clipped. Confirm grid column headers render bold on Items, Orders, and the Activity table.

- [ ] **Step 6: Commit**

```bash
git add client/src/styles/styles.css client/src/ui/AdvancedFilter.tsx
git commit -m "$(printf 'UI: bold grid headers + un-clip advanced-filter popup\n\n.tbl th 500->700 (all grids). Advanced-filter modal dropped .card\n(overflow:clip) for a .filter-modal panel with overflow:visible so the\nmultiselect dropdowns and panel corners no longer clip.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Activity Log — remove Status column + local-time timestamps

**Files:**
- Modify: `client/src/lib/format.ts` (add `fmtLocalDateTime`)
- Modify: `client/src/features/common/RecordDetail.tsx` (`ActivityLog`, ~lines 53–84)
- Check: `client/src/features/orders/OrderDrawer.tsx`, `client/src/features/quotes/QuoteDetail.tsx` for other activity-time renders

**Interfaces:**
- Produces: `fmtLocalDateTime(s?: string): string` — Catalyst/UTC datetime → viewer local time string. Consumed by ActivityLog and any other activity renderers.

- [ ] **Step 1: Add the local-time formatter**

In `client/src/lib/format.ts`, directly under the existing `fmtDateTime` export, add:
```ts
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
```

- [ ] **Step 2: Remove the Status column header + cell; use local time**

In `client/src/features/common/RecordDetail.tsx`, import the helper — change:
```tsx
import { fmtDateTime } from "@/lib/format";
```
to:
```tsx
import { fmtDateTime, fmtLocalDateTime } from "@/lib/format";
```
In the `ActivityLog` `<thead>`, delete the Status header line:
```tsx
              <th>Status</th>
```
In the row body, delete the entire Status `<td>`:
```tsx
                  <td>
                    <span className={`chip qstatus ${ok ? "q-converted" : "q-rejected"}`}>{str(r.status) || "—"}</span>
                  </td>
```
Change the Time cell from:
```tsx
                  <td className="mono muted">{str(r.occurred_at) || str(r.CREATEDTIME)}</td>
```
to:
```tsx
                  <td className="mono muted">{fmtLocalDateTime(str(r.occurred_at) || str(r.CREATEDTIME))}</td>
```
Change the empty-state colSpan from `5` to `4`:
```tsx
                <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 18 }}>
```
Keep the `const ok = ...` line — it still drives the Detail/Error cell color.

- [ ] **Step 3: Apply local time to any other activity renderers**

Grep both files for activity time rendering:
Run: `cd client && grep -n "occurred_at\|CREATEDTIME\|Activity" src/features/orders/OrderDrawer.tsx src/features/quotes/QuoteDetail.tsx`
For each place that renders an activity/audit timestamp as a raw string or via `fmtDateTime`, switch it to `fmtLocalDateTime(...)`. If neither file renders its own activity times (both may reuse `ActivityLog`), no change — note that in the commit body.

- [ ] **Step 4: Build**

Run: `cd client && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Browser verify**

Open an item detail (`/design/:id`) → Activity section. Expected: no **Status** column; the **Time** column shows local time (e.g. matches your machine clock, not UTC).

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/format.ts client/src/features/common/RecordDetail.tsx
git commit -m "$(printf 'Activity log: local-time timestamps + drop Status column\n\nAdd fmtLocalDateTime (Catalyst UTC datetime -> viewer local). ActivityLog\nnow renders Time in local zone and no longer shows the Status column.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Items grid — remove size/status selects; magnifier search on Items + Orders

**Files:**
- Modify: `client/src/features/masters/DesignMaster.tsx` (state ~190-192, memos ~219-223, filtered ~247-259, pager key ~261, fbar ~392-414)
- Modify: `client/src/features/orders/OrdersTable.tsx` (fbar ~229-239)
- Modify: `client/src/styles/styles.css` (add `.gsearch` wrapper)

**Interfaces:**
- Produces: CSS class `.gsearch` — a relative wrapper putting a magnifier icon inside a grid quick-search input.

- [ ] **Step 1: Add the `.gsearch` wrapper style**

In `client/src/styles/styles.css`, near the `.fbar` rules (search `.fbar` to locate; if absent add at end of the filter-bar section), add:
```css
/* Grid quick-search with a leading magnifier (mirrors the header search). */
.gsearch { position: relative; display: inline-flex; align-items: center; }
.gsearch > svg { position: absolute; left: 10px; color: var(--dim); pointer-events: none; }
.gsearch > input { padding-left: 30px; }
```

- [ ] **Step 2: Items grid — delete the size/status selects and their state**

In `client/src/features/masters/DesignMaster.tsx`:

Remove the two state hooks:
```tsx
  const [sizeF, setSizeF] = useState("");
  const [statusF, setStatusF] = useState("");
```
Remove the now-unused option memos:
```tsx
  const sizeOptions = useMemo(
    () => [...new Set([...lookups.sizes.map((o) => o.label), ...rows.map((r) => r.sizeLabel)].filter(Boolean))].sort(),
    [rows, lookups],
  );
  const statusOptions = useMemo(() => [...new Set(rows.map((r) => r.status).filter(Boolean))].sort(), [rows]);
```
In `filtered`, delete the two predicate lines:
```tsx
      if (sizeF && r.sizeLabel !== sizeF) return false;
      if (statusF && r.status !== statusF) return false;
```
and drop `sizeF, statusF` from that `useMemo` dependency array.

Update the pager reset key — change:
```tsx
  const pager = usePagination(filtered.length, "designPageSize", `${query}|${sizeF}|${statusF}|${JSON.stringify(criteria)}`);
```
to:
```tsx
  const pager = usePagination(filtered.length, "designPageSize", `${query}|${JSON.stringify(criteria)}`);
```

- [ ] **Step 3: Items grid — rebuild the non-selection filter bar**

Replace the `else` branch's `.fbar` (the block that currently starts `<div className="fbar">` containing the two `<select>`s) with:
```tsx
        <div className="fbar">
          <div style={{ flex: 1 }} />
          <span className="gsearch">
            <Icon name="search" size={13} />
            <input type="text" placeholder="Search items…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          <AdvancedFilterButton title="Items" fields={filterFields} criteria={criteria} onChange={setCriteria} />
          <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
        </div>
```
(Size and Status remain in `filterFields` → still filterable via the magnifier. Leave `filterFields` unchanged.)

- [ ] **Step 4: Orders grid — magnifier search**

In `client/src/features/orders/OrdersTable.tsx`, `.fbar` (~line 229), change:
```tsx
        <input
          type="text"
          placeholder="Search PO, party, design…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
```
to:
```tsx
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input
            type="text"
            placeholder="Search PO, party, design…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
```
Confirm `Icon` is already imported in this file (it is — used elsewhere in the fbar/head).

- [ ] **Step 5: Build**

Run: `cd client && npm run build`
Expected: build succeeds, no "declared but never read" errors for `sizeF`/`statusF`/`sizeOptions`/`statusOptions` (all removed).

- [ ] **Step 6: Browser verify**

Items grid (`/design`): no "All sizes"/"All statuses" dropdowns; a wide search box with a magnifier icon; opening the magnifier **Search** still offers Size and Status. Orders grid (`/orders`): search box shows a magnifier icon.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/masters/DesignMaster.tsx client/src/features/orders/OrdersTable.tsx client/src/styles/styles.css
git commit -m "$(printf 'Grids: drop inline size/status selects on Items; magnifier search\n\nItems quick-filter now lives only in the advanced (magnifier) filter;\nthe grid keeps a single wide search box with a leading magnifier icon,\nmatched on Orders. New .gsearch wrapper.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

> Follow-up (not in this task, no silent cap): the remaining grids (Parties, Pallets, Containers, Invoices, QuotesTable, Reports, SalesPersons, Users, PurchaseOrders) can adopt `.gsearch` in a later sweep. They are unaffected except by the global bold-header + popup fixes.

---

### Task 4: Preserve uploaded image filename (server)

**Files:**
- Modify: `functions/data-ops/index.js:444` (inside `POST /upload/design-image`)

**Interfaces:**
- Behavior only — response still `{ ok, id, name }`; `name` now preserves the original filename (minus path/control chars).

- [ ] **Step 1: Relax `safeName` to preserve the original name**

In `functions/data-ops/index.js`, in the `/upload/design-image` handler, change:
```js
    const safeName = String(name || "image.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
```
to:
```js
    // Preserve the uploaded filename (req 2026-07-08): keep spaces, parens,
    // and unicode; strip only path separators and control chars for safety.
    const safeName =
      String(name || "image.jpg")
        .replace(/[\\/\x00-\x1f]/g, "")
        .trim() || "image.jpg";
```

- [ ] **Step 2: Sanity-check the tmp path still works**

The tmp path is `` `${crypto.randomBytes(8).toString("hex")}-${safeName}` `` — a name with spaces is a valid filename on disk, so no change needed. Confirm the line still references `safeName`.

- [ ] **Step 3: Deploy note**

This is a server change — it takes effect only after the data-ops function is deployed. Do NOT deploy as part of this task unless the user asks; note in the commit body that a `catalyst deploy` of `functions/data-ops` is required for it to take effect.

- [ ] **Step 4: Verify (post-deploy, manual)**

After deploy: upload an image named `my photo (front).jpg` on an item, then check the File Store folder / the upload response `name`. Expected: stored name is `my photo (front).jpg`, not `my_photo__front_.jpg`.

- [ ] **Step 5: Commit**

```bash
git add functions/data-ops/index.js
git commit -m "$(printf 'Upload: preserve original image filename\n\ndesign-image upload keeps the original filename (spaces/parens/unicode);\nstrips only path separators and control chars. Requires a data-ops\nredeploy to take effect.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Cache patch + no-refresh on the selected item

**Files:**
- Modify: `client/src/lib/cache.ts` (`ListCache` interface + `createListCache`)
- Modify: `client/src/features/masters/designsApi.ts` (export `patchDesignCache`)
- Modify: `client/src/features/masters/ItemDetail.tsx` (`saveImages`, `onToggleStatus`, `deleteAt` paths)

**Interfaces:**
- Produces: `ListCache.patch(fn: (value: R) => R): void` — replaces the snapshot in place and notifies, without a network fetch.
- Produces: `patchDesignCache(id: string, patch: Partial<DesignRow>): void` in `designsApi.ts`.
- Consumes (ItemDetail): `patchDesignCache`, and `DesignRow` shape (`status`, `images: string[]`, `image?: string`).

- [ ] **Step 1: Add `patch` to the cache type**

In `client/src/lib/cache.ts`, in the `ListCache` interface, add after `invalidate()`:
```ts
  /** Replace the snapshot in place (no fetch) and notify subscribers.
      No-op if there is no snapshot yet. */
  patch(fn: (value: R) => R): void;
```

- [ ] **Step 2: Implement `patch` in the factory**

In the returned object of `createListCache`, add after `invalidate()`:
```ts
    patch(fn) {
      if (!snapshot) return;
      snapshot = { value: fn(snapshot.value), ts: snapshot.ts };
      notify();
    },
```

- [ ] **Step 3: Export `patchDesignCache`**

In `client/src/features/masters/designsApi.ts`, near `invalidateDesigns` (~line 124), add:
```ts
/** Patch one design in the cached snapshot in place — used by the item
    detail so status/image edits update only the selected item, no refetch. */
export function patchDesignCache(id: string, patch: Partial<DesignRow>): void {
  cache.patch((v) =>
    v.ok ? { ...v, designs: v.designs.map((d) => (d.id === id ? { ...d, ...patch } : d)) } : v,
  );
}
```
If the fetch-result type doesn't expose `designs` on the failure branch, guard on `v.ok` as shown (the `ok` discriminant is required by `createListCache<R extends { ok: boolean }>`).

- [ ] **Step 4: ItemDetail — patch instead of refetch on image save**

In `client/src/features/masters/ItemDetail.tsx`, import the helper — add `patchDesignCache` to the existing `designsApi` import:
```tsx
import { cachedDesigns, deleteDesign, invalidateDesigns, listDesigns, patchDesignCache, type DesignRow } from "./designsApi";
```
Rewrite `saveImages` to patch locally + cache, dropping the `invalidateDesigns()+refresh()`:
```tsx
  /** Persist a new image list (positional: [front, rear, ...other]). */
  const saveImages = async (next: string[]) => {
    if (!design) return;
    setImgBusy(true);
    const res = await update("Design", design.id, {
      image_urls: JSON.stringify(next),
      image_url: next[0] || "",
    });
    if (!res.ok) {
      toast.error(res.error || "Could not save images");
      setImgBusy(false);
      return;
    }
    const patch = { images: next, image: next[0] || "" } as Partial<DesignRow>;
    setDesigns((prev) => (prev ? prev.map((d) => (d.id === design.id ? { ...d, ...patch } : d)) : prev));
    patchDesignCache(design.id, patch);
    setImgBusy(false);
  };
```
(If `DesignRow` has no `image` field, patch only `images`; check the interface at `designsApi.ts:45` and match its exact field names.)

- [ ] **Step 5: ItemDetail — patch instead of refetch on status toggle**

Rewrite the success path of `onToggleStatus`:
```tsx
  const onToggleStatus = async () => {
    if (!design) return;
    // Active/Inactive (renamed from Continue/Discontinued 2026-07); tolerate legacy values.
    const inactive = design.status === "Inactive" || design.status === "Discontinued";
    const next = inactive ? "Active" : "Inactive";
    setBusy(true);
    const res = await update("Design", design.id, { status: next });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Status change failed");
      return;
    }
    toast.success(`Marked as ${next}`);
    const patch = { status: next } as Partial<DesignRow>;
    setDesigns((prev) => (prev ? prev.map((d) => (d.id === design.id ? { ...d, ...patch } : d)) : prev));
    patchDesignCache(design.id, patch);
  };
```
`deleteAt` calls `saveImages`, so it inherits the no-refetch path — no separate change.

- [ ] **Step 6: Build**

Run: `cd client && npm run build`
Expected: build succeeds; `invalidateDesigns` may now be unused in ItemDetail — if the build flags it as unused, remove it from the import.

- [ ] **Step 7: Browser verify**

Open an item detail. Toggle status (More → Mark as Inactive/Active): the badge/detail updates, the left list stays put, no skeleton flash, no scroll jump. Add/delete an image: only that item's slots change; no full reload.

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/cache.ts client/src/features/masters/designsApi.ts client/src/features/masters/ItemDetail.tsx
git commit -m "$(printf 'Item detail: patch selected item in place, no full refetch\n\nAdd ListCache.patch + patchDesignCache. Status toggle and image\nsave/delete now update only the affected design in state and cache\ninstead of invalidate()+listDesigns(), so the selected item and list\ndont refresh.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: Keep selection after edit

**Files:**
- Modify: `client/src/features/masters/DesignEdit.tsx:104` (post-save navigate)

**Interfaces:**
- Consumes: `updateDesign` (already invalidates the designs cache); item detail repaints from cache with no skeleton.

- [ ] **Step 1: Land on the item detail after saving**

In `client/src/features/masters/DesignEdit.tsx`, in the successful `updateDesign` path (~line 104), change:
```tsx
    toast.success("Design updated");
    navigate("/design");
```
to:
```tsx
    toast.success("Design updated");
    navigate(`/design/${id}`);
```
Leave the cancel/back navigation (~line 120) at `/design` — cancel should return to the list. Confirm `updateDesign` invalidates the cache (check `designsApi.ts` ~line 335); if it does not, add `invalidateDesigns()` before the navigate so the detail shows fresh values.

- [ ] **Step 2: Build**

Run: `cd client && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Browser verify**

Open an item → Edit → change a field → Save. Expected: lands on that item's detail (`/design/:id`), same item selected in the left list, showing the updated value — not the grid list.

- [ ] **Step 4: Commit**

```bash
git add client/src/features/masters/DesignEdit.tsx
git commit -m "$(printf 'Item edit: keep selection - return to detail, not the list\n\nSave now navigates to /design/:id so the edited item stays selected;\ncancel still returns to the grid.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: Docs + memory

**Files:**
- Modify/Create: project changes-&-plans doc (find the existing changelog; if none, create `docs/CHANGES.md`)
- Create: `C:\Users\Dhiraj\.claude\projects\d--Zoho-Related-Work-Catalyst-Zoho-boffo-granito-latest\memory\activity-log-local-time.md`
- Modify: memory `MEMORY.md` index

- [ ] **Step 1: Record the batch in the project changelog**

Run: `cd "d:/Zoho Related Work/Catalyst Zoho/boffo-granito-latest" && ls CHANGES.md docs/CHANGES.md 2>/dev/null; git log --oneline -5`
Append a dated entry summarising the seven changes (bold headers, un-clipped popup, Items size/status selects removed, activity-log local time + Status column removed, filename preservation [needs data-ops deploy], keep-selection-after-edit, no-refresh selected item). If no changelog exists, create `docs/CHANGES.md` with this entry.

- [ ] **Step 2: Add the local-time memory**

Create `...\memory\activity-log-local-time.md`:
```markdown
---
name: activity-log-local-time
description: All activity logs render timestamps in the viewer's local time via fmtLocalDateTime.
metadata:
  type: reference
---

Activity logs across the app render timestamps in the viewer's LOCAL time,
not server/UTC. Use `fmtLocalDateTime(iso)` from `client/src/lib/format.ts`
(normalises Catalyst `"YYYY-MM-DD HH:MM:SS:mmm"` UTC → local). Do NOT change
the shared `fmtDateTime` — grid Created/Modified columns rely on its raw
16-char slice. Shipped 2026-07-08 with the item-master UI batch; the
Activity Log also dropped its Status column that day. See [[master-page-ui-convention]].
```

- [ ] **Step 3: Add the index pointer**

In `...\memory\MEMORY.md`, add under the index list:
```markdown
- [Activity log local time](activity-log-local-time.md) — all activity logs show local time via fmtLocalDateTime; don't touch shared fmtDateTime.
```

- [ ] **Step 4: Commit the changelog (docs only; memory dir is outside the repo)**

```bash
git add docs/CHANGES.md 2>/dev/null; git commit -m "$(printf 'Docs: record item-master + grid UI batch\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Self-Review

- **Spec coverage:** req1→T4, req2 (keep selection)→T6, req2 (no refresh)→T5, req3→T2(C2), req4→T2(C1), req5→T3, req6→T1(A1), req7→T1(A2); docs/memory→T7. All covered.
- **Type consistency:** `patch(fn)` on ListCache (T5.1/T5.2) and `patchDesignCache(id, patch)` (T5.3) used consistently in ItemDetail (T5.4/T5.5). `fmtLocalDateTime` defined (T2.1) and consumed (T2.2/T2.3). `.filter-modal` (T1.2) consumed (T1.3). `.gsearch` (T3.1) consumed (T3.3/T3.4).
- **Placeholders:** none — every code step shows the exact change. T4 verify is post-deploy (server), stated explicitly.
- **Known field-name check:** T5.4/T5.5 instruct verifying `DesignRow` field names (`image` vs `image_url`) at `designsApi.ts:45` before patching — the one spot needing a look at the exact interface.

## Verification (whole batch)

`cd client && npm run build` clean, then browser-walk: bold headers everywhere; advanced popup un-clipped on a narrow viewport; Items grid has no size/status selects + magnifier search; Orders search has a magnifier; Activity Log has no Status column and local-time stamps; edit an item → lands on its detail still selected; status/image change updates only that item. Filename preservation verified after a `functions/data-ops` deploy.
