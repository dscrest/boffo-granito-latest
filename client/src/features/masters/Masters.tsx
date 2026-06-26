/* ============================================================
   Masters — generic, config-driven data-entry for the BOFFO
   lookup tables (Size, Finish, Category, Glaze, Brand, Grade,
   PaymentTerm). One <MasterTable> driven by a per-table field
   schema. FRONTEND-ONLY for now: rows live in local React state
   (no DB writes yet — backend CRUD wires in later). Markup reuses
   existing app classes (page-head, fbar, card, tbl, btn, hbtn).
   ============================================================ */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { canDelete, canUpdate } from "@/lib/auth";

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
  /** column field that visually leads the row (rendered as a chip) */
  lead: string;
  fields: Field[];
  seed: Row[];
}

type Row = Record<string, string> & { _id: string };

let _seq = 0;
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r${++_seq}`;
const seed = (rows: Record<string, string>[]): Row[] => rows.map((r) => ({ ...r, _id: newId() }));

/* Column/field schema + starter rows per master. Field keys match the
   Catalyst Data Store column names so wiring to the API later is 1:1. */
const MASTERS: MasterDef[] = [
  {
    key: "size",
    label: "Size",
    icon: "tile",
    lead: "code",
    fields: [
      { key: "code", label: "Code", required: true },
      { key: "width_mm", label: "Width (mm)", type: "number" },
      { key: "length_mm", label: "Length (mm)", type: "number" },
      { key: "seq_code", label: "Seq" },
    ],
    seed: seed([
      { code: "600x1200", width_mm: "600", length_mm: "1200", seq_code: "01" },
      { code: "200x1200", width_mm: "200", length_mm: "1200", seq_code: "02" },
      { code: "600x600", width_mm: "600", length_mm: "600", seq_code: "03" },
      { code: "75x600", width_mm: "75", length_mm: "600", seq_code: "04" },
    ]),
  },
  {
    key: "finish",
    label: "Finish",
    icon: "palette",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq" },
    ],
    seed: seed([
      { name: "Glossy", seq_code: "01" },
      { name: "Matt", seq_code: "02" },
      { name: "Carving", seq_code: "03" },
      { name: "Hard Matt", seq_code: "04" },
    ]),
  },
  {
    key: "category",
    label: "Category",
    icon: "tile",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq" },
    ],
    seed: seed([]),
  },
  {
    key: "glaze",
    label: "Glaze",
    icon: "palette",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq" },
    ],
    seed: seed([]),
  },
  {
    key: "brand",
    label: "Brand",
    icon: "flag",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "internal_or_external", label: "Type", type: "select", options: ["Internal", "External"] },
    ],
    seed: seed([
      { name: "Bonza", internal_or_external: "Internal" },
      { name: "BIG", internal_or_external: "External" },
    ]),
  },
  {
    key: "grade",
    label: "Grade",
    icon: "check",
    lead: "name",
    fields: [{ key: "name", label: "Name", required: true }],
    seed: seed([{ name: "1st" }]),
  },
  {
    key: "payment_term",
    label: "Payment Term",
    icon: "invoice",
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
    seed: seed([
      { name: "Advance", term_type: "Advance" },
      { name: "Credit 30", term_type: "Net 30" },
    ]),
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
              <select value={vals[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">—</option>
                {f.options!.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                value={vals[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
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
  const [rows, setRows] = useState<Row[]>(def.seed);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string | null } | null>(null); // null = closed, {id:null} = new

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => def.fields.some((f) => (r[f.key] ?? "").toLowerCase().includes(q)));
  }, [rows, query, def]);

  const initialForm =
    editing && editing.id ? (rows.find((r) => r._id === editing.id) ?? emptyForm(def)) : emptyForm(def);

  const save = (vals: Record<string, string>) => {
    if (editing?.id) {
      setRows((rs) => rs.map((r) => (r._id === editing.id ? { ...r, ...vals } : r)));
    } else {
      setRows((rs) => [...rs, { ...vals, _id: newId() }]);
    }
    setEditing(null);
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

  const removeSelected = () => {
    if (!window.confirm(`Delete ${selected.size} selected row${selected.size > 1 ? "s" : ""}?`)) return;
    setRows((rs) => rs.filter((r) => !selected.has(r._id)));
    setSelected(new Set());
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
            <button className="btn" onClick={removeSelected}>
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

      <div className="card">
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
            {filtered.length === 0 && (
              <tr>
                <td colSpan={def.fields.length + 2} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  No rows yet — click “New {def.label.toLowerCase()}”.
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
            Lookup data entry · {MASTERS.length} tables ·{" "}
            <span style={{ color: "var(--c-amber, var(--dim))" }}>local draft — not yet saved to database</span>
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
