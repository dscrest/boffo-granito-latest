/* ============================================================
   Design Master (Items) — master-page UI convention reference impl.

   Convention (applies to every master list):
   • NO inline row actions — the row itself is the action.
   • Row-click → the dedicated edit page (/design/:id/edit).
   • Bulk select (checkboxes) → bulk update + bulk delete on selection.

   Data is live from the Catalyst Data Store via designsApi. "New design"
   opens the create modal; edits happen on the edit page.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { Combobox } from "@/ui/Combobox";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { finishClass, fmtDateTime } from "@/lib/format";
import { can, canUpdate } from "@/lib/auth";
import { DesignForm } from "./DesignForm";
import {
  bulkDeleteDesigns,
  bulkUpdateDesigns,
  createDesign,
  listDesigns,
  type DesignInput,
  type DesignLookups,
  type DesignRow,
} from "./designsApi";

const dash = <span className="dim">—</span>;

// Toggleable + reorderable columns (checkbox pinned outside the map).
// Reference implementation of the data-driven grid pattern: each ColumnDef
// carries its own cell renderer; thead/tbody map over useColumns().visible.
const DESIGN_COLUMNS: ColumnDef<DesignRow>[] = [
  {
    key: "name",
    label: "Name",
    render: (d) => (
      <Link className="linkish" to={`/design/${d.id}`} onClick={(e) => e.stopPropagation()} title="View item">
        <span className="design-name">{d.uniqueName || d.designName}</span>
      </Link>
    ),
  },
  {
    key: "size",
    label: "Size",
    render: (d) =>
      d.sizeLabel ? (
        <span className={`chip size ${d.sizeLabel.startsWith("200") || d.sizeLabel.startsWith("75") ? "b" : ""}`}>{d.sizeLabel}</span>
      ) : (
        dash
      ),
  },
  {
    key: "finish",
    label: "Finish",
    render: (d) => (d.finishLabel ? <span className={`chip finish ${finishClass(d.finishLabel)}`}>{d.finishLabel}</span> : dash),
  },
  {
    key: "brand",
    label: "Brand",
    render: (d) => (d.brandLabel ? <span className={`chip brand ${d.brandLabel === "BIG" ? "big" : ""}`}>{d.brandLabel}</span> : dash),
  },
  { key: "category", label: "Category", className: "muted", render: (d) => d.categoryLabel || dash },
  {
    key: "glaze",
    label: "Glaze",
    render: (d) => (d.glazeLabel ? <span className={`chip finish ${finishClass(d.glazeLabel)}`}>{d.glazeLabel}</span> : dash),
  },
  { key: "status", label: "Status", className: "muted", render: (d) => d.status || dash },
  { key: "sku", label: "SKU", className: "muted mono", render: (d) => d.sku || dash },
  { key: "created", label: "Created", className: "muted mono", render: (d) => fmtDateTime(d.createdTime) },
  { key: "modified", label: "Modified", className: "muted mono", render: (d) => fmtDateTime(d.modifiedTime) },
];

const EMPTY_LOOKUPS: DesignLookups = {
  sizes: [],
  finishes: [],
  categories: [],
  glazes: [],
  brands: [],
  grades: [],
  partyBrands: [],
  partyBrandSeq: {},
};

/* Bulk-edit is restricted to fields that don't feed the computed
   unique_name (design_name/size/finish) or sku (size/category/finish/glaze),
   so a bulk reclassification can't silently desync those keys. */
function BulkEditModal({
  count,
  lookups,
  busy,
  onApply,
  onClose,
}: {
  count: number;
  lookups: DesignLookups;
  busy: boolean;
  onApply: (patch: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState("");
  const [brand, setBrand] = useState("");
  const [grade, setGrade] = useState("");

  const patch: Record<string, unknown> = {};
  if (status) patch.status = status;
  if (brand) patch.brand = brand;
  if (grade) patch.grade = grade;
  const nothing = Object.keys(patch).length === 0;

  return (
    <div className="modal-backdrop">
      <div className="modal-panel card df-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="settings" size={18} />
          </div>
          <div>
            <div className="ttl">Bulk edit {count} item{count > 1 ? "s" : ""}</div>
            <div className="sub2">Only the fields you set are changed. Blank = leave unchanged.</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="df-body">
          <div className="form-section">
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Status</span>
                <Combobox
                  value={status}
                  options={[
                    { value: "", label: "— leave unchanged —" },
                    { value: "Active", label: "Active" },
                    { value: "Inactive", label: "Inactive" },
                  ]}
                  onChange={setStatus}
                  placeholder="— leave unchanged —"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Brand</span>
                <Combobox
                  value={brand}
                  options={[
                    { value: "", label: "— leave unchanged —" },
                    ...lookups.brands.map((o) => ({ value: o.id, label: o.label })),
                  ]}
                  onChange={setBrand}
                  placeholder="— leave unchanged —"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Grade</span>
                <Combobox
                  value={grade}
                  options={[
                    { value: "", label: "— leave unchanged —" },
                    ...lookups.grades.map((o) => ({ value: o.id, label: o.label })),
                  ]}
                  onChange={setGrade}
                  placeholder="— leave unchanged —"
                />
              </label>
            </div>
          </div>
        </div>
        <div className="df-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={nothing || busy} onClick={() => onApply(patch)}>
            <Icon name="check" size={13} />
            {busy ? "Applying…" : `Apply to ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DesignMaster() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<DesignRow[]>([]);
  const [lookups, setLookups] = useState<DesignLookups>(EMPTY_LOOKUPS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [criteria, setCriteria] = useState<FilterCriteria>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { ordered, visible, hidden, toggle, move } = useColumns("designTableColumns", DESIGN_COLUMNS, ["created", "modified"]);
  const [showNew, setShowNew] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await listDesigns();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load designs");
      return;
    }
    setError(null);
    setRows(res.designs);
    setLookups(res.lookups);
    setSelected(new Set());
  };

  useEffect(() => {
    void load();
  }, []);

  // Advanced search fields (magnifier button). Master-backed pickers
  // (Size/Finish/Brand/Category/Glaze) list the full create-time master, not
  // just values already on a design — union with row values covers legacy.
  const filterFields = useMemo<FilterField<DesignRow>[]>(() => {
    const opts = (get: (r: DesignRow) => string) => [...new Set(rows.map(get).filter(Boolean))].sort();
    const uni = (master: { label: string }[], get: (r: DesignRow) => string) =>
      [...new Set([...master.map((o) => o.label), ...rows.map(get)].filter(Boolean))].sort();
    return [
      { key: "name", label: "Design Name", type: "text", get: (r) => `${r.designName} ${r.uniqueName}` },
      { key: "sku", label: "SKU", type: "text", get: (r) => r.sku },
      { key: "size", label: "Size", type: "multiselect", options: uni(lookups.sizes, (r) => r.sizeLabel), get: (r) => r.sizeLabel },
      { key: "finish", label: "Finish", type: "multiselect", options: uni(lookups.finishes, (r) => r.finishLabel), get: (r) => r.finishLabel },
      { key: "brand", label: "Brand", type: "multiselect", options: uni(lookups.brands, (r) => r.brandLabel), get: (r) => r.brandLabel },
      { key: "category", label: "Category", type: "multiselect", options: uni(lookups.categories, (r) => r.categoryLabel), get: (r) => r.categoryLabel },
      { key: "glaze", label: "Glaze", type: "multiselect", options: uni(lookups.glazes, (r) => r.glazeLabel), get: (r) => r.glazeLabel },
      { key: "status", label: "Status", type: "multiselect", options: opts((r) => r.status), get: (r) => r.status },
      { key: "rate", label: "Rate / ft²", type: "numrange", get: (r) => r.ratePerSqft },
      { key: "created", label: "Created Between", type: "daterange", get: (r) => r.createdTime },
      { key: "modified", label: "Modified Between", type: "daterange", get: (r) => r.modifiedTime },
    ];
  }, [rows, lookups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (!q) return true;
      return [r.designName, r.uniqueName, r.sku, r.sizeLabel, r.finishLabel, r.brandLabel, r.categoryLabel]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    return applyFilters(base, criteria, filterFields);
  }, [rows, query, criteria, filterFields]);

  const pager = usePagination(filtered.length, "designPageSize", `${query}|${JSON.stringify(criteria)}`);
  const pageRows = pager.slice(filtered);

  // ponytail: select-all covers the visible page only; `selected` accumulates across pages.
  const allShownSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  const toggleOne = (id: string) =>
    setSelected((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((p) => {
      const next = new Set(p);
      if (allShownSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });

  const onCreate = async (input: DesignInput) => {
    // Friendly duplicate pre-check; the server's 409 on unique_name is the backstop.
    const dup = rows.find((r) => r.uniqueName.trim().toLowerCase() === input.unique_name.trim().toLowerCase());
    if (dup) {
      toast.error(`An item named "${input.unique_name}" already exists`);
      return; // keep the modal open so the entry can be fixed
    }
    setNotice("Saving design…");
    const res = await createDesign(input);
    if (!res.ok) {
      // Keep the modal open — closing here would discard everything typed.
      setNotice(null);
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    setShowNew(false);
    setNotice(`Design saved (#${res.rowid}).`);
    toast.success("Design saved");
    // Land on the new record so the next action can't target the wrong one.
    if (res.rowid) navigate(`/design/${encodeURIComponent(res.rowid)}`);
  };

  const ids = useMemo(() => [...selected], [selected]);

  const onBulkApply = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setNotice(`Updating ${ids.length} item${ids.length > 1 ? "s" : ""}…`);
    const res = await bulkUpdateDesigns(ids, patch);
    setBusy(false);
    setShowBulk(false);
    if (!res.ok) {
      setError(`${res.failed} update(s) failed: ${res.firstError || "unknown error"}`);
      toast.error(`${res.done} updated, ${res.failed} failed`);
    } else {
      toast.success(`${res.done} design${res.done === 1 ? "" : "s"} updated`);
    }
    setNotice(`Updated ${res.done} item${res.done === 1 ? "" : "s"}.`);
    await load();
  };

  const onBulkDelete = async () => {
    if (!(await confirmDialog({ message: `Are you sure you want to delete ${ids.length} selected design${ids.length > 1 ? "s" : ""}? This cannot be undone.`, danger: true })))
      return;
    setBusy(true);
    setNotice(`Deleting ${ids.length} item${ids.length > 1 ? "s" : ""}…`);
    const res = await bulkDeleteDesigns(ids);
    setBusy(false);
    if (!res.ok) {
      setError(`${res.failed} delete(s) failed: ${res.firstError || "unknown error"}`);
      toast.error(`${res.done} deleted, ${res.failed} failed`);
    } else {
      toast.success(`${res.done} design${res.done === 1 ? "" : "s"} deleted`);
    }
    setNotice(`Deleted ${res.done} item${res.done === 1 ? "" : "s"}.`);
    await load();
  };

  return (
    /* Same shell as Sizes: column fills the scrollport so the grid footer
       sits on the window edge — no dead band above or below the table. */
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {showNew && <DesignForm lookups={lookups} onSave={onCreate} onClose={() => setShowNew(false)} />}
      {showBulk && (
        <BulkEditModal
          count={ids.length}
          lookups={lookups}
          busy={busy}
          onApply={onBulkApply}
          onClose={() => setShowBulk(false)}
        />
      )}

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      {/* Bulk action bar replaces the filter bar while a selection is active. */}
      {ids.length > 0 ? (
        <div className="fbar" style={{ borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>
            {ids.length} selected
          </span>
          {can("items", "edit") && (
            <button className="btn" onClick={() => setShowBulk(true)} disabled={busy}>
              <Icon name="settings" size={12} className="ic" /> Bulk edit
            </button>
          )}
          {can("items", "delete") && (
            <button className="btn" onClick={() => void onBulkDelete()} disabled={busy}>
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : (
        <div className="fbar">
          <span className="muted" style={{ fontSize: "var(--t-sm)" }}>{loading ? "Loading…" : notice}</span>
          <div style={{ flex: 1 }} />
          <span className="gsearch">
            <Icon name="search" size={13} />
            <input type="text" placeholder="Search items…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          <AdvancedFilterButton title="Items" fields={filterFields} criteria={criteria} onChange={setCriteria} />
          <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
          {can("items", "create") && (
            /* fbar controls are 26px tall; the 30px .hbtn default would stretch the bar. */
            <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} onClick={() => setShowNew(true)}>
              <Icon name="plus" size={13} />
              New Item
            </button>
          )}
        </div>
      )}

      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {loading && rows.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 34, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={toggleAll}
                    title={allShownSelected ? "Deselect all" : "Select all"}
                  />
                </th>
                {visible.map((c) => (
                  <th key={c.key} style={c.style}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((d) => {
                const sel = selected.has(d.id);
                return (
                  <tr
                    key={d.id}
                    tabIndex={0}
                    onClick={() => navigate(`/design/${d.id}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/design/${d.id}`); }}
                    style={{ cursor: "pointer", background: sel ? "var(--accent-soft)" : undefined }}
                  >
                    {/* checkbox cell stops propagation so toggling never navigates */}
                    <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={sel} onChange={() => toggleOne(d.id)} />
                    </td>
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(d)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={visible.length + 1}>
                    {rows.length > 0 ? (
                      <EmptyState title="No matching results" hint="Try a different filter" />
                    ) : (
                      <EmptyState
                        icon="tile"
                        title="No items yet"
                        hint="Add your first item with New Item"
                        action={
                          <button className="hbtn primary" onClick={() => setShowNew(true)}>
                            New Item
                          </button>
                        }
                      />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          )}
        </div>
        {!(loading && rows.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
