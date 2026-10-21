/* ============================================================
   Warehouses (CR-329) — Settings ▸ Warehouses: the stock locations master
   (Zoho Books "Locations"). Name · Primary ★ · Purposes · Note. Row click →
   edit modal (Cancel + Save); the Primary tick in the modal routes through
   /warehouse-primary (never a generic PATCH — the server pins history to
   the old primary first). The first warehouse saved becomes primary. Own
   page rather than Masters.tsx: that editor has no boolean / multi-select.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDelete } from "@/ui/ConfirmDialog";
import { useModalA11y } from "@/ui/useModalA11y";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { WAREHOUSE_PURPOSES } from "@/lib/warehouseStock";
import { createWarehouse, deleteWarehouse, listWarehouses, markPrimary, updateWarehouse, type WarehouseRow } from "./warehousesApi";

const dash = <span className="dim">—</span>;

const COLUMNS: ColumnDef<WarehouseRow>[] = [
  { key: "name", label: "Name", render: (r) => <span style={{ color: "var(--fg)", fontWeight: 500 }}>{r.name}</span> },
  { key: "primary", label: "Primary", render: (r) => (r.isPrimary ? <span className="chip" title="Stock recorded without a warehouse counts here">★ Primary</span> : dash) },
  { key: "purposes", label: "Purposes", render: (r) => (r.purposes.length ? r.purposes.map((p) => <span key={p} className="chip" style={{ marginRight: 4 }}>{p}</span>) : dash) },
  { key: "note", label: "Note", className: "muted", render: (r) => r.note || dash },
  { key: "created", label: "Created", className: "muted mono", render: (r) => fmtDateTime(r.createdTime) },
  { key: "modified", label: "Modified", className: "muted mono", render: (r) => fmtDateTime(r.modifiedTime) },
];

export function Warehouses() {
  const [rows, setRows] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ row: WarehouseRow | null } | null>(null);
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("warehousesTableColumns", COLUMNS, ["created", "modified"]);

  const load = async () => {
    setLoading(true);
    const res = await listWarehouses();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load warehouses");
      return;
    }
    setError(null);
    setRows(res.rows);
    setSelected(new Set());
  };
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.name} ${r.purposes.join(" ")} ${r.note}`.toLowerCase().includes(q)) : rows;
  }, [rows, query]);
  const pager = usePagination(filtered.length, "warehousesPageSize", query);
  const pageRows = pager.slice(filtered);
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
  const ids = useMemo(() => [...selected], [selected]);

  const onSave = async (input: { name: string; purposes: string[]; note: string; primary: boolean }) => {
    const target = editing?.row;
    setBusy(true);
    const res = target ? await updateWarehouse(target.id, input) : await createWarehouse(input);
    if (!res.ok) {
      setBusy(false);
      toast.error(res.error || "Save failed");
      return;
    }
    const id = target?.id || String(res.rowid || "");
    // Primary: ticked here, or simply the first warehouse ever saved.
    if (id && ((input.primary && !target?.isPrimary) || rows.length === 0)) {
      const p = await markPrimary(id);
      if (!p.ok) toast.error(p.error || "Could not mark as primary");
    }
    setBusy(false);
    setEditing(null);
    toast.success(target ? "Warehouse updated" : "Warehouse saved");
    await load();
  };

  const onBulkDelete = async () => {
    const reason = await confirmDelete({ message: `Are you sure you want to delete ${ids.length} selected warehouse${ids.length > 1 ? "s" : ""}?` });
    if (reason == null) return;
    setBusy(true);
    let done = 0;
    let firstError = "";
    for (const id of ids) {
      const res = await deleteWarehouse(id, reason);
      if (res.ok) done++;
      else firstError = firstError || res.error || "Delete failed";
    }
    setBusy(false);
    if (firstError) toast.error(firstError);
    if (done) toast.success(`${done} warehouse${done === 1 ? "" : "s"} deleted`);
    await load();
  };

  const canEdit = can("items", "edit");
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Warehouses</div>
          <div className="sub">Where stock sits — the primary is where stock recorded without a warehouse counts</div>
        </div>
      </div>

      {editing && <WarehouseForm row={editing.row} busy={busy} onlyRow={rows.length === 0} onSave={onSave} onClose={() => setEditing(null)} />}
      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      {ids.length > 0 ? (
        <div className="fbar" style={{ marginBottom: 12, borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>{ids.length} selected</span>
          {can("items", "delete") && (
            <button className="btn" onClick={() => void onBulkDelete()} disabled={busy}>Delete</button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : (
        <div className="fbar">
          <span className="muted mono">{filtered.length} rows</span>
          <div style={{ flex: 1 }} />
          <span className="gsearch">
            <Icon name="search" size={13} />
            <input type="text" placeholder="Search warehouses…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />
          {canEdit && (
            <button className="hbtn primary" onClick={() => setEditing({ row: null })}>
              <Icon name="plus" size={13} />
              New warehouse
            </button>
          )}
        </div>
      )}

      <div className="card">
        {loading && rows.length === 0 ? (
          <SkeletonRows rows={4} />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 34, textAlign: "center" }}>
                  <input type="checkbox" checked={allShownSelected} onChange={toggleAll} title={allShownSelected ? "Deselect all" : "Select all"} />
                </th>
                {visible.map((c) => (
                  <th key={c.key} className={c.className} style={c.style}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const sel = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => canEdit && setEditing({ row: r })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget && canEdit) setEditing({ row: r });
                    }}
                    style={{ cursor: canEdit ? "pointer" : undefined, background: sel ? "var(--accent-soft)" : undefined }}
                    title={canEdit ? "Edit warehouse" : undefined}
                  >
                    <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={sel} onChange={() => toggleOne(r.id)} />
                    </td>
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>{c.render!(r)}</td>
                    ))}
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={visible.length + 1}>
                    {rows.length > 0 ? (
                      <EmptyState title="No matching results" hint="Try a different search" />
                    ) : (
                      <EmptyState
                        icon="package"
                        title="No warehouses yet"
                        hint="Until one exists, stock is one pool. The first warehouse you add becomes the primary."
                        action={canEdit ? <button className="hbtn primary" onClick={() => setEditing({ row: null })}>New warehouse</button> : undefined}
                      />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {!(loading && rows.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}

function WarehouseForm({
  row,
  busy,
  onlyRow,
  onSave,
  onClose,
}: {
  row: WarehouseRow | null;
  busy: boolean;
  /** No warehouse exists yet — this one becomes primary regardless. */
  onlyRow: boolean;
  onSave: (input: { name: string; purposes: string[]; note: string; primary: boolean }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(row?.name ?? "");
  const [purposes, setPurposes] = useState<string[]>(row?.purposes ?? []);
  const [note, setNote] = useState(row?.note ?? "");
  const [primary, setPrimary] = useState(!!row?.isPrimary || onlyRow);
  const [showErrors, setShowErrors] = useState(false);
  const panelRef = useModalA11y(onClose);
  const togglePurpose = (p: string) => setPurposes((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const missing = !name.trim();
  const submit = () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    onSave({ name: name.trim(), purposes: WAREHOUSE_PURPOSES.filter((p) => purposes.includes(p)), note: note.trim(), primary });
  };
  // The current primary can't untick itself — another warehouse takes the flag instead.
  const primaryLocked = !!row?.isPrimary || onlyRow;

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="package" size={18} /></div>
          <div>
            <div className="ttl">{row ? "Edit Warehouse" : "New Warehouse"}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Warehouse</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Name<span className="req"> *</span></span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Production Godown" autoFocus aria-invalid={showErrors && missing} />
                {showErrors && missing && <span className="field-err">Name is required</span>}
              </label>
              <label className="form-field">
                <span className="lbl">Note</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
              </label>
            </div>
            <div className="form-field" style={{ marginTop: 10 }}>
              <span className="lbl">Purposes <span className="dim">(pick any — labels only; Loading Bay is where loaded boxes are taken from first)</span></span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 4 }}>
                {WAREHOUSE_PURPOSES.map((p) => (
                  <label key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="checkbox" checked={purposes.includes(p)} onChange={() => togglePurpose(p)} />
                    {p}
                  </label>
                ))}
              </div>
            </div>
            <label className="form-field" style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, cursor: primaryLocked ? "default" : "pointer" }} title={primaryLocked ? "Mark another warehouse as primary to move the flag" : "Stock recorded without a warehouse counts in the primary"}>
              <input type="checkbox" checked={primary} disabled={primaryLocked} onChange={(e) => setPrimary(e.target.checked)} />
              <span>Primary warehouse</span>
              {!primaryLocked && primary && <span className="dim">— existing unassigned stock stays with the current primary</span>}
            </label>
          </div>
        </div>
        <div className="df-foot">
          <span className="df-req-note">* Indicates a mandatory field</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="hbtn primary" disabled={busy} onClick={submit}>
            <Icon name="check" size={13} />
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
