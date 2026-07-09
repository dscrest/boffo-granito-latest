/* ============================================================
   Size Master — table of tile size specs backed by the Catalyst
   Data Store via sizesApi. Create / edit / delete write real rows;
   every mutation is recorded in OperationLog (see /ops).

   Size is the source of truth for per-box packing data: the Item
   form and the Pallet form snapshot coverage/weight from the size
   picked there.

   Follows the master-page UI convention (see DesignMaster):
   • NO inline row actions — row-click opens the edit form.
   • Bulk select (checkboxes) → bulk delete on selection.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { fmtDateTime } from "@/lib/format";
import { canDelete, canUpdate } from "@/lib/auth";
import { SizeForm } from "./SizeForm";
import { bulkDeleteSizes, createSize, listSizes, updateSize, type SizeInput, type SizeRow } from "./sizesApi";

const dash = <span className="dim">—</span>;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

// Toggleable + reorderable columns (checkbox/# pinned outside the map).
const SIZE_COLUMNS: ColumnDef<SizeRow>[] = [
  { key: "code", label: "Size", render: (r) => <span className="chip size">{r.code || dash}</span> },
  { key: "type", label: "Type", className: "muted", render: (r) => r.tileType || dash },
  {
    key: "thickness",
    label: "Thickness (mm)",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.thicknessMm > 0 ? String(r.thicknessMm) : dash),
  },
  {
    key: "pcs",
    label: "Pcs / Box",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.pcsPerPacking > 0 ? String(r.pcsPerPacking) : dash),
  },
  {
    key: "sqmPerBox",
    label: "SQM / Box",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.sqmPerBox > 0 ? String(r4(r.sqmPerBox)) : dash),
  },
  {
    key: "sqftPerBox",
    label: "SQFT / Box",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.sqftPerBox > 0 ? String(r2(r.sqftPerBox)) : dash),
  },
  {
    key: "boxWeight",
    label: "Box Weight (kg)",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.boxWeightKg > 0 ? String(r.boxWeightKg) : dash),
  },
  { key: "seq", label: "Short Code", className: "muted mono", render: (r) => r.seqCode || dash },
  { key: "remark", label: "Remark", className: "muted", render: (r) => r.remark || dash },
  { key: "created", label: "Created", className: "muted mono", render: (r) => fmtDateTime(r.createdTime) },
  { key: "modified", label: "Modified", className: "muted mono", render: (r) => fmtDateTime(r.modifiedTime) },
];

export function Sizes() {
  const [rows, setRows] = useState<SizeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeF, setTypeF] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { ordered, visible, hidden, toggle, move } = useColumns("sizesTableColumns", SIZE_COLUMNS, [
    "seq",
    "remark",
    "created",
    "modified",
  ]);
  const [editing, setEditing] = useState<{ row: SizeRow | null } | null>(null); // null=closed, {row:null}=new

  const load = async () => {
    setLoading(true);
    const res = await listSizes();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load sizes");
      return;
    }
    setError(null);
    setRows(res.sizes);
    setSelected(new Set());
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeF && r.tileType !== typeF) return false;
      if (!q) return true;
      return (
        r.code.toLowerCase().includes(q) ||
        r.tileType.toLowerCase().includes(q) ||
        r.seqCode.toLowerCase().includes(q) ||
        r.remark.toLowerCase().includes(q)
      );
    });
  }, [rows, query, typeF]);

  const pager = usePagination(filtered.length, "sizesPageSize", `${query}|${typeF}`);
  const pageRows = pager.slice(filtered);

  const onSave = async (input: SizeInput) => {
    const target = editing?.row;
    setNotice(target ? "Saving changes…" : "Saving size…");
    const res = target ? await updateSize(target.id, input) : await createSize(input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      setNotice(null);
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    setEditing(null);
    setNotice(`Size saved (#${res.rowid}).`);
    toast.success(target ? "Size updated" : "Size saved");
    await load();
  };

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

  const ids = useMemo(() => [...selected], [selected]);

  const onBulkDelete = async () => {
    if (
      !(await confirmDialog({
        message: `Are you sure you want to delete ${ids.length} selected size${ids.length > 1 ? "s" : ""}? Items and pallets that reference them will lose the link. This cannot be undone.`,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setNotice(`Deleting ${ids.length} size${ids.length > 1 ? "s" : ""}…`);
    const res = await bulkDeleteSizes(ids);
    setBusy(false);
    if (!res.ok) {
      setError(`${res.failed} delete(s) failed: ${res.firstError || "unknown error"}`);
      toast.error(`${res.done} deleted, ${res.failed} failed`);
    } else {
      toast.success(`${res.done} size${res.done === 1 ? "" : "s"} deleted`);
    }
    setNotice(`Deleted ${res.done} size${res.done === 1 ? "" : "s"}.`);
    await load();
  };

  // Distinct types already saved, fed to the form so the picker can create-on-save.
  const tileTypes = useMemo(() => [...new Set(rows.map((r) => r.tileType).filter(Boolean))].sort(), [rows]);

  const initial: Partial<SizeInput> | undefined = editing?.row
    ? {
        width_mm: editing.row.widthMm,
        length_mm: editing.row.lengthMm,
        seq_code: editing.row.seqCode,
        tile_type: editing.row.tileType,
        thickness_mm: editing.row.thicknessMm,
        pcs_per_packing: editing.row.pcsPerPacking,
        box_weight_kg: editing.row.boxWeightKg,
        remark: editing.row.remark,
      }
    : undefined;

  return (
    <div>
      {editing && (
        <SizeForm
          tileTypes={tileTypes}
          initial={initial}
          isEdit={!!editing.row}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="page-head">
        <div>
          <div className="title">Size Master</div>
          <div className="sub">{loading ? "Loading…" : <span className="dim">{notice}</span>}</div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void load()} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
          {canUpdate() && (
            <button className="hbtn primary" onClick={() => setEditing({ row: null })}>
              <Icon name="plus" size={13} />
              New size
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
          <select value={typeF} onChange={(e) => setTypeF(e.target.value)} title="Filter by type">
            <option value="">All types</option>
            {tileTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <span className="gsearch">
            <Icon name="search" size={13} />
            <input type="text" placeholder="Search size…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
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
                  {visible.map((c) => (
                    <th key={c.key} style={c.style}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => {
                  const sel = selected.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      tabIndex={0}
                      onClick={() => setEditing({ row: r })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.target === e.currentTarget) setEditing({ row: r });
                      }}
                      style={{ cursor: "pointer", background: sel ? "var(--accent-soft)" : undefined }}
                      title="Edit size"
                    >
                      {/* checkbox cell stops propagation so toggling never opens the form */}
                      <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={sel} onChange={() => toggleOne(r.id)} />
                      </td>
                      <td className="muted mono" style={{ textAlign: "center" }}>
                        {pager.from + i}
                      </td>
                      {visible.map((c) => (
                        <td key={c.key} className={c.className} style={c.style}>
                          {c.render!(r)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {!loading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={visible.length + 2}>
                      {rows.length > 0 ? (
                        <EmptyState title="No matching results" hint="Try a different filter" />
                      ) : (
                        <EmptyState
                          icon="package"
                          title="No sizes yet"
                          hint="Add your first tile size with New size"
                          action={
                            <button className="hbtn primary" onClick={() => setEditing({ row: null })}>
                              New size
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
