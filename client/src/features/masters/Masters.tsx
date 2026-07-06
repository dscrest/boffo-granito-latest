/* ============================================================
   Masters — generic, config-driven data-entry for the BOFFO
   lookup tables (Size, Finish, Category, Glaze, Brand, Grade,
   PaymentTerm). One <MasterTable> driven by a per-table field
   schema, backed by the Catalyst Data Store via mastersApi (each
   write recorded in OperationLog). Markup reuses existing app
   classes (page-head, fbar, card, tbl, btn, hbtn).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { Combobox } from "@/ui/Combobox";
import { ErrorCard, SkeletonRows } from "@/ui/States";
import { canDelete, canUpdate } from "@/lib/auth";
import { createMaster, deleteMaster, listMaster, updateMaster, type MasterRow } from "./mastersApi";

/* Admin areas that have their own dedicated pages (not local-draft lookup
   tables). Surfaced here as config tiles that route out to those pages. */
const LINKS: { label: string; icon: string; route: string }[] = [
  { label: "Sales Persons", icon: "user", route: "/salespersons" },
  { label: "Users", icon: "users", route: "/users" },
];

type FieldType = "text" | "number" | "select";

interface Field {
  key: string;
  label: string;
  type?: FieldType; // default "text"
  options?: string[]; // for type "select"
  required?: boolean;
}

interface MasterDef {
  key: string;
  label: string;
  icon: string;
  /** Catalyst Data Store table name (CRUD target). */
  table: string;
  /** column field that visually leads the row (rendered as a chip) */
  lead: string;
  fields: Field[];
}

type Row = MasterRow;

/* Column/field schema per master. Field keys match the Catalyst Data Store
   column names, so values pass straight through mastersApi to the table. */
const MASTERS: MasterDef[] = [
  {
    key: "size",
    label: "Size",
    icon: "tile",
    table: "Size",
    lead: "code",
    fields: [
      { key: "code", label: "Code", required: true },
      { key: "width_mm", label: "Width (mm)", type: "number" },
      { key: "length_mm", label: "Length (mm)", type: "number" },
      { key: "seq_code", label: "Seq" },
    ],
  },
  {
    key: "finish",
    label: "Finish",
    icon: "palette",
    table: "Finish",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq" },
    ],
  },
  {
    key: "category",
    label: "Category",
    icon: "tile",
    table: "Category",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq" },
    ],
  },
  {
    key: "glaze",
    label: "Glaze",
    icon: "palette",
    table: "Glaze",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq" },
    ],
  },
  {
    key: "brand",
    label: "Brand",
    icon: "flag",
    table: "Brand",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "internal_or_external", label: "Type", type: "select", options: ["Internal", "External"] },
      { key: "seq_code", label: "Seq" },
    ],
  },
  {
    key: "party_brand",
    label: "Party Brand",
    icon: "flag",
    table: "PartyBrand",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq" },
    ],
  },
  {
    key: "grade",
    label: "Grade",
    icon: "check",
    table: "Grade",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq" },
    ],
  },
  {
    key: "payment_term",
    label: "Payment Term",
    icon: "invoice",
    table: "PaymentTerm",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      {
        key: "term_type",
        label: "Type",
        type: "select",
        options: ["Advance", "Credit", "Net 15", "Net 30", "Net 45", "Net 60"],
      },
    ],
  },
];

const emptyForm = (def: MasterDef): Record<string, string> =>
  Object.fromEntries(def.fields.map((f) => [f.key, ""]));

function MasterEditor({
  def,
  initial,
  onSave,
  onCancel,
}: {
  def: MasterDef;
  initial: Record<string, string>;
  onSave: (vals: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const missing = def.fields.some((f) => f.required && !vals[f.key]?.trim());

  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));

  const isEdit = def.fields.every((f) => f.key in initial) && Object.values(initial).some(Boolean);
  return (
    <div className="card form-section" style={{ marginBottom: 12, padding: 16, borderLeft: "3px solid var(--accent)" }}>
      <div className="form-section-title" style={{ marginBottom: 14 }}>
        <Icon name={isEdit ? "settings" : "plus"} size={13} className="ic" />
        {isEdit ? "Edit" : "New"} {def.label}
      </div>
      <div className="form-grid">
        {def.fields.map((f) => (
          <label key={f.key} className="form-field">
            <span className="lbl">
              {f.label}
              {f.required && <span className="req"> *</span>}
            </span>
            {f.type === "select" ? (
              <Combobox
                value={vals[f.key] ?? ""}
                options={[{ value: "", label: "" }, ...f.options!.map((o) => ({ value: o, label: o }))]}
                onChange={(val) => set(f.key, val)}
                placeholder={`Search ${f.label.toLowerCase()}…`}
              />
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                // Rule #5: numeric fields never accept negatives (server rejects too).
                min={f.type === "number" ? 0 : undefined}
                value={vals[f.key] ?? ""}
                onChange={(e) => set(f.key, f.type === "number" ? e.target.value.replace(/^-/, "") : e.target.value)}
                placeholder={f.label}
              />
            )}
          </label>
        ))}
      </div>
      <div className="right" style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="hbtn primary" disabled={missing} onClick={() => onSave(vals)}>
          <Icon name="check" size={13} />
          Save
        </button>
      </div>
    </div>
  );
}

function MasterTable({ def }: { def: MasterDef }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string | null } | null>(null); // null = closed, {id:null} = new

  const fieldKeys = useMemo(() => def.fields.map((f) => f.key), [def]);

  const load = async () => {
    setLoading(true);
    const res = await listMaster(def.table, fieldKeys);
    setLoading(false);
    if (!res.ok) {
      setError(res.error || `Failed to load ${def.label}`);
      return;
    }
    setError(null);
    setRows(res.rows);
    setSelected(new Set());
  };

  // Reload whenever the active master changes (keyed remount also resets state).
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.table]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => def.fields.some((f) => (r[f.key] ?? "").toLowerCase().includes(q)));
  }, [rows, query, def]);

  // Seed the editor with ONLY the form's field keys — the row also carries
  // the internal _id (ROWID), which must never reach the PATCH payload
  // (Catalyst rejects unknown columns: "Invalid column name _id").
  const editRow = editing?.id ? rows.find((r) => r._id === editing.id) : undefined;
  const initialForm = editRow
    ? Object.fromEntries(def.fields.map((f) => [f.key, editRow[f.key] ?? ""]))
    : emptyForm(def);

  const save = async (vals: Record<string, string>) => {
    const editId = editing?.id;
    setBusy(true);
    const res = editId
      ? await updateMaster(def.table, editId, vals)
      : await createMaster(def.table, vals);
    setBusy(false);
    if (!res.ok) {
      // Keep the editor open — closing here would discard everything typed.
      toast.error(res.error || "Save failed");
      setError(res.error || "Save failed");
      return;
    }
    setEditing(null);
    toast.success(editId ? `${def.label} updated` : `${def.label} added`);
    await load();
  };

  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r._id));

  const toggleOne = (id: string) =>
    setSelected((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((p) => {
      const next = new Set(p);
      if (allShownSelected) filtered.forEach((r) => next.delete(r._id));
      else filtered.forEach((r) => next.add(r._id));
      return next;
    });

  const removeSelected = async () => {
    const ids = [...selected];
    if (!window.confirm(`Delete ${ids.length} selected row${ids.length > 1 ? "s" : ""}?`)) return;
    setBusy(true);
    const results = await Promise.all(ids.map((id) => deleteMaster(def.table, id)));
    setBusy(false);
    const failed = results.filter((r) => !r.ok).length;
    if (failed) {
      toast.error(`${ids.length - failed} deleted, ${failed} failed`);
      setError(results.find((r) => !r.ok)?.error || "Delete failed");
    } else {
      toast.success(`${ids.length} deleted`);
    }
    await load();
  };

  return (
    <div>
      {/* Bulk action bar replaces the filter bar while a selection is active. */}
      {selected.size > 0 ? (
        <div className="fbar" style={{ borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>
            {selected.size} selected
          </span>
          {canDelete() && (
            <button className="btn" onClick={() => void removeSelected()} disabled={busy}>
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
          <span className="muted mono">{filtered.length} rows</span>
          <div style={{ flex: 1 }} />
          <input type="text" placeholder={`Search ${def.label.toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
          {canUpdate() && (
            <button className="hbtn primary" onClick={() => setEditing({ id: null })}>
              <Icon name="plus" size={13} />
              New {def.label.toLowerCase()}
            </button>
          )}
        </div>
      )}

      {editing && <MasterEditor def={def} initial={initialForm} onSave={save} onCancel={() => setEditing(null)} />}

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="card">
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
              {def.fields.map((f) => (
                <th key={f.key} className={f.type === "number" ? "num" : ""} style={f.type === "number" ? { textAlign: "right" } : undefined}>
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={def.fields.length + 2} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  {rows.length > 0 ? "No matching results." : `No rows yet — click “New ${def.label.toLowerCase()}”.`}
                </td>
              </tr>
            )}
            {filtered.map((r, i) => {
              const sel = selected.has(r._id);
              return (
                <tr
                  key={r._id}
                  tabIndex={0}
                  onClick={() => setEditing({ id: r._id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) setEditing({ id: r._id });
                  }}
                  style={{ cursor: "pointer", background: sel ? "var(--accent-soft)" : undefined }}
                  title={`Edit ${def.label.toLowerCase()}`}
                >
                  {/* checkbox cell stops propagation so toggling never opens the editor */}
                  <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel} onChange={() => toggleOne(r._id)} />
                  </td>
                  <td className="muted mono" style={{ textAlign: "center" }}>
                    {i + 1}
                  </td>
                  {def.fields.map((f) => (
                    <td key={f.key} className={f.type === "number" ? "num" : ""}>
                      {f.key === def.lead && r[f.key] ? (
                        <span className="chip">{r[f.key]}</span>
                      ) : r[f.key] ? (
                        r[f.key]
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}

export function Masters() {
  const [active, setActive] = useState(MASTERS[0].key);
  const def = MASTERS.find((m) => m.key === active)!;
  const navigate = useNavigate();

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Masters</div>
          <div className="sub">
            Lookup data entry · {MASTERS.length} tables · saved to Catalyst Data Store
          </div>
        </div>
      </div>

      <div className="fbar" style={{ flexWrap: "wrap" }}>
        {MASTERS.map((m) => (
          <button key={m.key} className={`btn ${m.key === active ? "active" : ""}`} onClick={() => setActive(m.key)}>
            <Icon name={m.icon} size={12} className="ic" /> {m.label}
          </button>
        ))}
        <div style={{ width: 1, alignSelf: "stretch", background: "var(--line, var(--border))", margin: "0 4px" }} />
        {LINKS.map((l) => (
          <button key={l.route} className="btn" onClick={() => navigate(l.route)} title={`Open ${l.label}`}>
            <Icon name={l.icon} size={12} className="ic" /> {l.label}
            <Icon name="arrow-r" size={11} style={{ marginLeft: 4, opacity: 0.5 }} />
          </button>
        ))}
      </div>

      <MasterTable key={def.key} def={def} />
    </div>
  );
}
