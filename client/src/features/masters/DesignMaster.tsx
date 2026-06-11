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
import { finishClass } from "@/lib/format";
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

const EMPTY_LOOKUPS: DesignLookups = {
  sizes: [],
  finishes: [],
  categories: [],
  glazes: [],
  brands: [],
  grades: [],
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
    <div className="modal-backdrop" onClick={onClose}>
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
    if (!q) return rows;
    return rows.filter((r) =>
      [r.designName, r.uniqueName, r.sku, r.sizeLabel, r.finishLabel, r.brandLabel, r.categoryLabel]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const toggleOne = (id: string) =>
    setSelected((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((p) => {
      if (allShownSelected) {
        const next = new Set(p);
        filtered.forEach((r) => next.delete(r.id));
        return next;
      }
      const next = new Set(p);
      filtered.forEach((r) => next.add(r.id));
      return next;
    });

  const onCreate = async (input: DesignInput) => {
    setShowNew(false);
    setNotice("Saving design…");
    const res = await createDesign(input);
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
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
          <div className="sub">
            {loading ? "Loading…" : `${filtered.length} of ${rows.length} items`}
            {notice && (
              <>
                {" · "}
                <span className="dim">{notice}</span>
              </>
            )}
          </div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void load()} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
          <button className="hbtn primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" size={13} />
            New design
          </button>
        </div>
      </div>

      {error && (
        <div
          className="card"
          style={{ marginBottom: 12, borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "10px 14px" }}
        >
          {error} — check the <a href="#/ops">Operations log</a>.
        </div>
      )}

      {/* Bulk action bar replaces the filter bar while a selection is active. */}
      {ids.length > 0 ? (
        <div className="fbar" style={{ borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>
            {ids.length} selected
          </span>
          <button className="btn" onClick={() => setShowBulk(true)} disabled={busy}>
            <Icon name="settings" size={12} className="ic" /> Bulk edit
          </button>
          <button className="btn" onClick={() => void onBulkDelete()} disabled={busy}>
            Delete
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : (
        <div className="fbar">
          <span className="muted mono">{filtered.length} rows</span>
          <div style={{ flex: 1 }} />
          <input type="text" placeholder="Search design…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      <div className="card">
        <div style={{ overflow: "auto" }}>
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
                <th>Size</th>
                <th>Finish</th>
                <th>Brand</th>
                <th>Category</th>
                <th>Glaze</th>
                <th>Status</th>
                <th>SKU</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => {
                const sel = selected.has(d.id);
                return (
                  <tr
                    key={d.id}
                    onClick={() => navigate(`/design/${d.id}/edit`)}
                    style={{ cursor: "pointer", background: sel ? "var(--accent-soft)" : undefined }}
                    title="Edit item"
                  >
                    {/* checkbox cell stops propagation so toggling never navigates */}
                    <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={sel} onChange={() => toggleOne(d.id)} />
                    </td>
                    <td className="muted mono" style={{ textAlign: "center" }}>
                      {i + 1}
                    </td>
                    <td>
                      <span className="design-name">{d.designName}</span>
                    </td>
                    <td>
                      {d.sizeLabel ? (
                        <span className={`chip size ${d.sizeLabel.startsWith("200") || d.sizeLabel.startsWith("75") ? "b" : ""}`}>
                          {d.sizeLabel}
                        </span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td>
                      {d.finishLabel ? (
                        <span className={`chip finish ${finishClass(d.finishLabel)}`}>{d.finishLabel}</span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td>
                      {d.brandLabel ? (
                        <span className={`chip brand ${d.brandLabel === "BIG" ? "big" : ""}`}>{d.brandLabel}</span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td className="muted">{d.categoryLabel || <span className="dim">—</span>}</td>
                    <td>
                      {d.glazeLabel ? (
                        <span className={`chip finish ${finishClass(d.glazeLabel)}`}>{d.glazeLabel}</span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td className="muted">{d.status || <span className="dim">—</span>}</td>
                    <td className="muted mono">{d.sku || <span className="dim">—</span>}</td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted" style={{ textAlign: "center", padding: 18 }}>
                    No items yet. Click <b>New design</b> to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
