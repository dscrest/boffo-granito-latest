/* ============================================================
   Warehouses & Locations (CR-329 · CR-409) — Settings ▸ Warehouses & Locations:
   the stock locations master. A WAREHOUSE (Name · Primary ★ · Purposes · Note)
   holds LOCATIONS — rows of the same table with `parent` set, codes like
   A1 … F12 (60–70 per warehouse). Stock is recorded at a location and stays
   there until a Transfer Order moves it; a warehouse with no locations is
   itself the location.
   Grid: warehouses with their locations collapsed beneath (chevron; the page
   search opens matches). Row click → edit modal; the warehouse row's "+" menu
   adds ONE location or GENERATES the grid (rows A–F × bays 1–12, existing
   codes skipped, one insert call). The Primary tick routes through
   /warehouse-primary (never a generic PATCH — the server pins history to the
   old primary first); a location can never be primary. Own page rather than
   Masters.tsx: that editor has no boolean / multi-select / tree.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDelete } from "@/ui/ConfirmDialog";
import { useModalA11y } from "@/ui/useModalA11y";
import { BoffoLoader } from "@/ui/BoffoLoader";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { MoreMenu } from "@/features/common/DetailBits";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { WAREHOUSE_PURPOSES, gridCodes } from "@/lib/warehouseStock";
import {
  childrenOf,
  createLocation,
  createLocations,
  createWarehouse,
  deleteWarehouse,
  listWarehouses,
  markPrimary,
  topLevel,
  updateLocation,
  updateWarehouse,
  type WarehouseRow,
} from "./warehousesApi";

const dash = <span className="dim">—</span>;

/** One grid line: a warehouse (with its location count) or a location beneath it. */
interface Line {
  row: WarehouseRow;
  kind: "warehouse" | "location";
  count: number;
}

const COLUMNS: ColumnDef<Line>[] = [
  {
    key: "name",
    label: "Name",
    render: (l) =>
      l.kind === "warehouse" ? (
        <span style={{ color: "var(--fg)", fontWeight: 500 }}>
          {l.row.name}
          {l.count > 0 && <span className="dim" style={{ fontWeight: 400 }}> · {l.count} location{l.count === 1 ? "" : "s"}</span>}
        </span>
      ) : (
        <span className="mono" style={{ paddingLeft: 26, color: "var(--fg)" }}>↳ {l.row.name}</span>
      ),
  },
  { key: "primary", label: "Primary", render: (l) => (l.row.isPrimary ? <span className="chip" title="Stock recorded without a location counts here">★ Primary</span> : dash) },
  { key: "purposes", label: "Purposes", render: (l) => (l.kind === "warehouse" && l.row.purposes.length ? l.row.purposes.map((p) => <span key={p} className="chip" style={{ marginRight: 4 }}>{p}</span>) : dash) },
  { key: "note", label: "Note", className: "muted", render: (l) => l.row.note || dash },
  { key: "created", label: "Created", className: "muted mono", render: (l) => fmtDateTime(l.row.createdTime) },
  { key: "modified", label: "Modified", className: "muted mono", render: (l) => fmtDateTime(l.row.modifiedTime) },
];

type Editing = { kind: "warehouse"; row: WarehouseRow | null } | { kind: "location"; warehouse: WarehouseRow; row: WarehouseRow | null };

export function Warehouses() {
  const [rows, setRows] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("warehousesTableColumns.v2", COLUMNS, ["created", "modified"]);

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

  // Warehouses in creation order, their locations (A1, A2, … natural order) beneath when
  // expanded — or whichever locations match the search.
  const lines = useMemo((): Line[] => {
    const q = query.trim().toLowerCase();
    const out: Line[] = [];
    for (const w of topLevel(rows)) {
      const kids = childrenOf(rows, w.id);
      const wMatch = !q || `${w.name} ${w.purposes.join(" ")} ${w.note}`.toLowerCase().includes(q);
      const kidMatches = q ? kids.filter((l) => `${l.name} ${l.note}`.toLowerCase().includes(q)) : kids;
      if (!wMatch && !kidMatches.length) continue;
      out.push({ row: w, kind: "warehouse", count: kids.length });
      const show = q ? kidMatches : expanded.has(w.id) ? kids : [];
      for (const l of show) out.push({ row: l, kind: "location", count: 0 });
    }
    return out;
  }, [rows, query, expanded]);
  const pager = usePagination(lines.length, "warehousesPageSize", query);
  const pageLines = pager.slice(lines);
  const allShownSelected = pageLines.length > 0 && pageLines.every((l) => selected.has(l.row.id));
  const toggleOne = (id: string) =>
    setSelected((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((p) => {
      const next = new Set(p);
      if (allShownSelected) pageLines.forEach((l) => next.delete(l.row.id));
      else pageLines.forEach((l) => next.add(l.row.id));
      return next;
    });
  const toggleExpand = (id: string) =>
    setExpanded((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const ids = useMemo(() => [...selected], [selected]);

  const onSaveWarehouse = async (input: { name: string; purposes: string[]; note: string; primary: boolean }) => {
    const target = editing?.kind === "warehouse" ? editing.row : null;
    setBusy(true);
    const res = target ? await updateWarehouse(target.id, input) : await createWarehouse(input);
    if (!res.ok) {
      setBusy(false);
      toast.error(res.error || "Save failed");
      return;
    }
    const id = target?.id || String(res.rowid || "");
    // Primary: ticked here, or simply the first warehouse ever saved.
    if (id && ((input.primary && !target?.isPrimary) || topLevel(rows).length === 0)) {
      const p = await markPrimary(id);
      if (!p.ok) toast.error(p.error || "Could not mark as primary");
    }
    setBusy(false);
    setEditing(null);
    toast.success(target ? "Warehouse updated" : "Warehouse saved");
    await load();
  };

  const onSaveLocation = async (input: { name: string; note: string }) => {
    if (editing?.kind !== "location") return;
    setBusy(true);
    const res = editing.row ? await updateLocation(editing.row.id, input) : await createLocation(editing.warehouse.id, input.name, input.note);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    setEditing(null);
    setExpanded((p) => new Set(p).add(editing.warehouse.id));
    toast.success(editing.row ? "Location updated" : `Location ${input.name.toUpperCase()} added to ${editing.warehouse.name}`);
    await load();
  };

  const onGenerate = async (codes: string[]) => {
    if (editing?.kind !== "location") return;
    setBusy(true);
    const res = await createLocations(editing.warehouse.id, codes);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not create the locations");
      return;
    }
    setEditing(null);
    setExpanded((p) => new Set(p).add(editing.warehouse.id));
    toast.success(`${codes.length} location${codes.length === 1 ? "" : "s"} added to ${editing.warehouse.name} (${codes[0]} … ${codes[codes.length - 1]})`);
    await load();
  };

  const onBulkDelete = async () => {
    const reason = await confirmDelete({ message: `Are you sure you want to delete ${ids.length} selected warehouse${ids.length > 1 ? "s / locations" : " or location"}?` });
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
    if (done) toast.success(`${done} deleted`);
    await load();
  };

  const canEdit = can("items", "edit");
  const edit = (l: Line) => {
    if (!canEdit) return;
    if (l.kind === "warehouse") setEditing({ kind: "warehouse", row: l.row });
    else setEditing({ kind: "location", warehouse: rows.find((w) => w.id === l.row.parentId)!, row: l.row });
  };
  const siblingNames = (warehouseId: string) => childrenOf(rows, warehouseId).map((l) => l.name.toUpperCase());

  return (
    <div>
      {/* CR-436: rendered inside Masters ▸ Export Master — the tab names the page. */}
      {editing?.kind === "warehouse" && (
        <WarehouseForm row={editing.row} busy={busy} onlyRow={topLevel(rows).length === 0} onSave={onSaveWarehouse} onClose={() => setEditing(null)} />
      )}
      {editing?.kind === "location" && (
        <LocationForm
          warehouse={editing.warehouse}
          row={editing.row}
          siblings={siblingNames(editing.warehouse.id)}
          busy={busy}
          onSave={onSaveLocation}
          onGenerate={onGenerate}
          onClose={() => setEditing(null)}
        />
      )}
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
          <span className="muted mono">{lines.length} rows</span>
          <div style={{ flex: 1 }} />
          <span className="gsearch">
            <Icon name="search" size={13} />
            <input type="text" placeholder="Search warehouses or a code (B7)…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />
          {canEdit && (
            <button className="hbtn primary" onClick={() => setEditing({ kind: "warehouse", row: null })}>
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
                {canEdit && <th style={{ width: 44 }} />}
              </tr>
            </thead>
            <tbody>
              {pageLines.map((l) => {
                const r = l.row;
                const sel = selected.has(r.id);
                const open = expanded.has(r.id) || !!query.trim();
                return (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => edit(l)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) edit(l);
                    }}
                    style={{ cursor: canEdit ? "pointer" : undefined, background: sel ? "var(--accent-soft)" : undefined }}
                    title={canEdit ? (l.kind === "warehouse" ? "Edit warehouse" : "Edit location") : undefined}
                  >
                    <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={sel} onChange={() => toggleOne(r.id)} />
                    </td>
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.key === "name" && l.kind === "warehouse" && l.count > 0 && (
                          <button
                            type="button"
                            className="btn x"
                            style={{ marginRight: 6, padding: "0 4px" }}
                            title={open ? "Hide locations" : "Show locations"}
                            aria-expanded={open}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(r.id);
                            }}
                          >
                            <Icon name={open ? "chev-d" : "chev-r"} size={13} />
                          </button>
                        )}
                        {c.render!(l)}
                      </td>
                    ))}
                    {canEdit && (
                      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "right" }}>
                        {l.kind === "warehouse" && (
                          <MoreMenu
                            kebab
                            icon="plus"
                            title="Add locations"
                            items={[
                              { label: "New location", onClick: () => setEditing({ kind: "location", warehouse: r, row: null }) },
                              { label: "Edit warehouse", onClick: () => setEditing({ kind: "warehouse", row: r }) },
                            ]}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {!loading && lines.length === 0 && (
                <tr>
                  <td colSpan={visible.length + (canEdit ? 2 : 1)}>
                    {rows.length > 0 ? (
                      <EmptyState title="No matching results" hint="Try a different search" />
                    ) : (
                      <EmptyState
                        icon="package"
                        title="No warehouses yet"
                        hint="Until one exists, stock is one pool. The first warehouse you add becomes the primary; add its locations (A1 … F12) from the row's + menu."
                        action={canEdit ? <button className="hbtn primary" onClick={() => setEditing({ kind: "warehouse", row: null })}>New warehouse</button> : undefined}
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
              <span className="lbl">Purposes <span className="dim">(pick any — labels only; Loading Bay is where loaded boxes are taken from first; its locations inherit them)</span></span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 4 }}>
                {WAREHOUSE_PURPOSES.map((p) => (
                  <label key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="checkbox" checked={purposes.includes(p)} onChange={() => togglePurpose(p)} />
                    {p}
                  </label>
                ))}
              </div>
            </div>
            <label className="form-field" style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, cursor: primaryLocked ? "default" : "pointer" }} title={primaryLocked ? "Mark another warehouse as primary to move the flag" : "Stock recorded without a location counts in the primary"}>
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

/* CR-409: one location (code + note) or the whole grid — rows A–F × bays 1–12 → A1 … F12.
   Codes are uppercased; ones that already exist in this warehouse are skipped. */
function LocationForm({
  warehouse,
  row,
  siblings,
  busy,
  onSave,
  onGenerate,
  onClose,
}: {
  warehouse: WarehouseRow;
  row: WarehouseRow | null;
  /** Existing codes in this warehouse (uppercase) — duplicates are refused / skipped. */
  siblings: string[];
  busy: boolean;
  onSave: (input: { name: string; note: string }) => void;
  onGenerate: (codes: string[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"single" | "generate">("single");
  const [name, setName] = useState(row?.name ?? "");
  const [note, setNote] = useState(row?.note ?? "");
  const [rowFrom, setRowFrom] = useState("A");
  const [rowTo, setRowTo] = useState("F");
  const [bayFrom, setBayFrom] = useState(1);
  const [bayTo, setBayTo] = useState(12);
  const [showErrors, setShowErrors] = useState(false);
  const panelRef = useModalA11y(onClose);

  const code = name.trim().toUpperCase();
  const taken = new Set(siblings.filter((s) => s !== (row?.name ?? "").toUpperCase()));
  const singleErr = !code ? "Code is required" : taken.has(code) ? `${code} already exists in ${warehouse.name}` : "";
  const codes = gridCodes(rowFrom, rowTo, bayFrom, bayTo);
  const fresh = codes.filter((c) => !taken.has(c));
  const tooMany = codes.length > 500;
  const genErr = !codes.length ? "Rows must be letters A–Z (from ≤ to) and bays whole numbers (from ≤ to)" : tooMany ? "Keep it under 500 locations at a time" : !fresh.length ? "Every code in that range already exists" : "";

  const submit = () => {
    if (mode === "generate" && !row) {
      if (genErr) {
        setShowErrors(true);
        return;
      }
      onGenerate(fresh);
      return;
    }
    if (singleErr) {
      setShowErrors(true);
      return;
    }
    onSave({ name: code, note: note.trim() });
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="package" size={18} /></div>
          <div>
            <div className="ttl">{row ? `Edit Location · ${warehouse.name} ▸ ${row.name}` : `New Location · ${warehouse.name}`}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          {!row && (
            <div className="form-field" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 16 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="loc-mode" checked={mode === "single"} onChange={() => setMode("single")} /> One location
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="loc-mode" checked={mode === "generate"} onChange={() => setMode("generate")} /> Generate a grid (A1 … F12)
                </label>
              </div>
            </div>
          )}
          {mode === "single" || row ? (
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Code<span className="req"> *</span></span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. A1" autoFocus aria-invalid={showErrors && !!singleErr} style={{ textTransform: "uppercase" }} />
                {showErrors && singleErr && <span className="field-err">{singleErr}</span>}
              </label>
              <label className="form-field">
                <span className="lbl">Note</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
              </label>
            </div>
          ) : (
            <>
              <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, minmax(70px, 1fr))" }}>
                <label className="form-field">
                  <span className="lbl">Rows from</span>
                  <input value={rowFrom} maxLength={1} onChange={(e) => setRowFrom(e.target.value.toUpperCase())} style={{ textTransform: "uppercase" }} autoFocus />
                </label>
                <label className="form-field">
                  <span className="lbl">to</span>
                  <input value={rowTo} maxLength={1} onChange={(e) => setRowTo(e.target.value.toUpperCase())} style={{ textTransform: "uppercase" }} />
                </label>
                <label className="form-field">
                  <span className="lbl">Bays from</span>
                  <input type="number" min={1} value={bayFrom} onChange={(e) => setBayFrom(Number(e.target.value) || 1)} />
                </label>
                <label className="form-field">
                  <span className="lbl">to</span>
                  <input type="number" min={1} value={bayTo} onChange={(e) => setBayTo(Number(e.target.value) || 1)} />
                </label>
              </div>
              <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 8 }} aria-live="polite">
                {genErr && showErrors ? (
                  <span className="field-err">{genErr}</span>
                ) : codes.length ? (
                  <>
                    <span className="mono" style={{ color: "var(--fg)" }}>{fresh.length}</span> new location{fresh.length === 1 ? "" : "s"}: <span className="mono">{fresh[0] ?? "—"} … {fresh[fresh.length - 1] ?? "—"}</span>
                    {codes.length - fresh.length > 0 && <> · {codes.length - fresh.length} already exist, skipped</>}
                  </>
                ) : (
                  genErr
                )}
              </div>
            </>
          )}
        </div>
        <div className="df-foot">
          <span className="df-req-note">{busy ? <BoffoLoader size="sm" label="Creating locations" /> : "* Indicates a mandatory field"}</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="hbtn primary" disabled={busy} onClick={submit}>
            <Icon name="check" size={13} />
            {busy ? "Saving…" : mode === "generate" && !row ? `Create ${fresh.length}` : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
