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
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useHiddenColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { finishClass } from "@/lib/format";
import { canDelete, canUpdate } from "@/lib/auth";
import { DesignForm } from "./DesignForm";
import {
  bulkDeleteDesigns,
  bulkUpdateDesigns,
  createDesign,
  setDesignPallets,
  listDesigns,
  type DesignInput,
  type DesignLookups,
  type DesignRow,
} from "./designsApi";

// Toggleable columns (Design Name + checkbox/# always shown).
const DESIGN_COLUMNS: ColumnDef[] = [
  { key: "size", label: "Size" },
  { key: "finish", label: "Finish" },
  { key: "brand", label: "Brand" },
  { key: "category", label: "Category" },
  { key: "glaze", label: "Glaze" },
  { key: "status", label: "Status" },
  { key: "sku", label: "SKU" },
];

const EMPTY_LOOKUPS: DesignLookups = {
  sizes: [],
  finishes: [],
  categories: [],
  glazes: [],
  brands: [],
  grades: [],
  partyBrands: [],
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
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">— leave unchanged —</option>
                  <option value="Continue">Continue</option>
                  <option value="Discontinued">Discontinued</option>
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Brand</span>
                <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                  <option value="">— leave unchanged —</option>
                  {lookups.brands.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Grade</span>
                <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                  <option value="">— leave unchanged —</option>
                  {lookups.grades.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
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
  const [sizeF, setSizeF] = useState("");
  const [statusF, setStatusF] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { hidden, toggle, show } = useHiddenColumns("designTableColumns");
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (sizeF && r.sizeLabel !== sizeF) return false;
      if (statusF && r.status !== statusF) return false;
      if (!q) return true;
      return [r.designName, r.uniqueName, r.sku, r.sizeLabel, r.finishLabel, r.brandLabel, r.categoryLabel]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, sizeF, statusF]);

  const pager = usePagination(filtered.length, "designPageSize", `${query}|${sizeF}|${statusF}`);
  const pageRows = pager.slice(filtered);
  // Filter options come from the live rows (DB-sourced), not static lists.
  const sizeOptions = useMemo(() => [...new Set(rows.map((r) => r.sizeLabel).filter(Boolean))].sort(), [rows]);
  const statusOptions = useMemo(() => [...new Set(rows.map((r) => r.status).filter(Boolean))].sort(), [rows]);

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

  const onCreate = async (input: DesignInput, palletIds: string[]) => {
    setShowNew(false);
    setNotice("Saving design…");
    const res = await createDesign(input);
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    if (res.rowid && palletIds.length) await setDesignPallets(res.rowid, palletIds);
    setNotice(`Design saved (#${res.rowid}).`);
    toast.success("Design saved");
    await load();
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
    if (!window.confirm(`Delete ${ids.length} selected design${ids.length > 1 ? "s" : ""}? This cannot be undone.`))
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
    <div>
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

      <div className="page-head">
        <div>
          <div className="title">Design Master</div>
          {/* Counts live in the grid footer; the sub line only carries status. */}
          <div className="sub">
            {loading ? "Loading…" : <span className="dim">{notice}</span>}
          </div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void load()} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
          {canUpdate() && (
            <button className="hbtn primary" onClick={() => setShowNew(true)}>
              <Icon name="plus" size={13} />
              New design
            </button>
          )}
        </div>
      </div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      {/* Bulk action bar replaces the filter bar while a selection is active. */}
      {ids.length > 0 ? (
        <div className="fbar" style={{ borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>
            {ids.length} selected
          </span>
          {canUpdate() && (
            <button className="btn" onClick={() => setShowBulk(true)} disabled={busy}>
              <Icon name="settings" size={12} className="ic" /> Bulk edit
            </button>
          )}
          {canDelete() && (
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
          <select value={sizeF} onChange={(e) => setSizeF(e.target.value)} title="Filter by size">
            <option value="">All sizes</option>
            {sizeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} title="Filter by status">
            <option value="">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <input type="text" placeholder="Search design…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <ColumnPicker columns={DESIGN_COLUMNS} hidden={hidden} onToggle={toggle} />
        </div>
      )}

      <div className="card">
        <div style={{ overflow: "auto" }}>
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
                <th style={{ width: 36, textAlign: "center" }}>#</th>
                <th>Design Name</th>
                {show("size") && <th>Size</th>}
                {show("finish") && <th>Finish</th>}
                {show("brand") && <th>Brand</th>}
                {show("category") && <th>Category</th>}
                {show("glaze") && <th>Glaze</th>}
                {show("status") && <th>Status</th>}
                {show("sku") && <th>SKU</th>}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((d, i) => {
                const sel = selected.has(d.id);
                return (
                  <tr
                    key={d.id}
                    tabIndex={0}
                    onClick={() => navigate(`/design/${d.id}/edit`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/design/${d.id}/edit`);
                    }}
                    style={{ cursor: "pointer", background: sel ? "var(--accent-soft)" : undefined }}
                    title="Edit item"
                  >
                    {/* checkbox cell stops propagation so toggling never navigates */}
                    <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={sel} onChange={() => toggleOne(d.id)} />
                    </td>
                    <td className="muted mono" style={{ textAlign: "center" }}>
                      {pager.from + i}
                    </td>
                    <td>
                      <span className="design-name">{d.designName}</span>
                    </td>
                    {show("size") && (
                      <td>
                        {d.sizeLabel ? (
                          <span className={`chip size ${d.sizeLabel.startsWith("200") || d.sizeLabel.startsWith("75") ? "b" : ""}`}>
                            {d.sizeLabel}
                          </span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                    )}
                    {show("finish") && (
                      <td>
                        {d.finishLabel ? (
                          <span className={`chip finish ${finishClass(d.finishLabel)}`}>{d.finishLabel}</span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                    )}
                    {show("brand") && (
                      <td>
                        {d.brandLabel ? (
                          <span className={`chip brand ${d.brandLabel === "BIG" ? "big" : ""}`}>{d.brandLabel}</span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                    )}
                    {show("category") && <td className="muted">{d.categoryLabel || <span className="dim">—</span>}</td>}
                    {show("glaze") && (
                      <td>
                        {d.glazeLabel ? (
                          <span className={`chip finish ${finishClass(d.glazeLabel)}`}>{d.glazeLabel}</span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                    )}
                    {show("status") && <td className="muted">{d.status || <span className="dim">—</span>}</td>}
                    {show("sku") && <td className="muted mono">{d.sku || <span className="dim">—</span>}</td>}
                  </tr>
                );
              })}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    {rows.length > 0 ? (
                      <EmptyState title="No matching results" hint="Try a different filter" />
                    ) : (
                      <EmptyState
                        icon="tile"
                        title="No items yet"
                        hint="Add your first item with New design"
                        action={
                          <button className="hbtn primary" onClick={() => setShowNew(true)}>
                            New design
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
