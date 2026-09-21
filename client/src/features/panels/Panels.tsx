/* ============================================================
   Panels (Panel Craft) — showcase-panel master grid, backed by the
   Catalyst Data Store via panelsApi. Follows the master-page UI
   convention (see DesignMaster):
   • NO inline row actions — row-click opens the panel detail page.
   • Bulk select (checkboxes) → bulk delete on selection.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { FilterSelect, IconBtn } from "./pcBits";
import { PanelForm, panelToInput } from "./PanelForm";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { bulkDeletePanels, createPanel, listPanels, updatePanel, type PanelInput, type PanelRow } from "./panelsApi";

const dash = <span className="dim">—</span>;

const PANEL_COLUMNS: ColumnDef<PanelRow>[] = [
  { key: "image", label: "Image", style: { width: 44 }, render: (r) => <ImageThumb images={r.images} alt={r.panelCode} /> },
  {
    key: "code",
    label: "Panel Code",
    render: (r) => (
      <Link className="linkish mono" to={`/panels/${r.id}`} title="View panel">
        {r.panelCode}
      </Link>
    ),
  },
  {
    key: "designs",
    label: "Designs",
    render: (r) =>
      r.lines.length === 0 ? dash : r.lines.length === 1 ? <span className="design-name">{r.lines[0].designName}</span> : `${r.lines.length} designs`,
  },
  { key: "panelSize", label: "Panel Size", className: "muted mono", render: (r) => r.panelSize || dash },
  { key: "vinylSize", label: "Vinyl Size", className: "muted mono", render: (r) => r.vinylSize || dash },
  {
    key: "cutSizes",
    label: "Cut Piece Sizes",
    className: "muted mono",
    render: (r) => [...new Set(r.lines.map((l) => l.cutSizeName).filter(Boolean))].join(", ") || dash,
  },
  { key: "created", label: "Created", className: "muted mono", render: (r) => fmtDateTime(r.createdTime) },
  { key: "modified", label: "Modified", className: "muted mono", render: (r) => fmtDateTime(r.modifiedTime) },
];

export function Panels() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PanelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("panels.query", "");
  const [designFilter, setDesignFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { ordered, visible, hidden, toggle, move } = useColumns("panelsTableColumns", PANEL_COLUMNS, ["created", "modified"]);
  const [showNew, setShowNew] = useState(false);
  const [editRow, setEditRow] = useState<PanelRow | null>(null);
  const [cloneRow, setCloneRow] = useState<PanelRow | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await listPanels();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load panels");
      return;
    }
    setError(null);
    setRows(res.panels);
    setSelected(new Set());
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!designFilter || r.lines.some((l) => l.designName === designFilter)) &&
        (!q ||
          r.panelCode.toLowerCase().includes(q) ||
          r.lines.some((l) => l.designName.toLowerCase().includes(q) || l.cutSizeName.toLowerCase().includes(q))),
    );
  }, [rows, query, designFilter]);

  const designOptions = useMemo(
    () => [...new Set(rows.flatMap((r) => r.lines.map((l) => l.designName)).filter(Boolean))].sort(),
    [rows],
  );

  const sort = useSortRows(
    filtered,
    (r, k) =>
      k === "designs" ? r.lines.length
      : k === "panelSize" ? r.panelSize
      : k === "vinylSize" ? r.vinylSize
      : k === "cutSizes" ? r.lines.map((l) => l.cutSizeName).join(", ")
      : k === "created" ? r.createdTime
      : k === "modified" ? r.modifiedTime
      : r.panelCode,
    "created",
    -1, // newest first
  );
  const pager = usePagination(sort.sorted.length, "panelsPageSize", `${query}|${designFilter}`);
  const pageRows = pager.slice(sort.sorted);

  const onCreate = async (input: PanelInput) => {
    const res = await createPanel(input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    setShowNew(false);
    setCloneRow(null);
    toast.success("Panel saved");
    // Land on the new record so the next action can't target the wrong one.
    if (res.rowid) navigate(`/panels/${encodeURIComponent(res.rowid)}`);
  };

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
  // Toolbar enable rules: Edit/Clone at exactly 1 selected, Delete at ≥1.
  const singleRow = ids.length === 1 ? (rows.find((r) => r.id === ids[0]) ?? null) : null;

  const onBulkDelete = async () => {
    if (!(await confirmDialog({ message: `Are you sure you want to delete ${ids.length} selected panel${ids.length > 1 ? "s" : ""}? This cannot be undone.`, danger: true })))
      return;
    setBusy(true);
    const res = await bulkDeletePanels(rows.filter((r) => selected.has(r.id)));
    setBusy(false);
    if (!res.ok) {
      setError(`${res.failed} delete(s) failed: ${res.firstError || "unknown error"}`);
      toast.error(`${res.done} deleted, ${res.failed} failed`);
    } else {
      toast.success(`${res.done} panel${res.done === 1 ? "" : "s"} deleted`);
    }
    await load();
  };

  const onDeleteOne = async (r: PanelRow) => {
    if (!(await confirmDialog({ message: `Are you sure you want to delete panel "${r.panelCode}"? This cannot be undone.`, danger: true }))) return;
    setBusy(true);
    const res = await bulkDeletePanels([r]);
    setBusy(false);
    if (!res.ok) toast.error(res.firstError || "Delete failed");
    else toast.success("Panel deleted");
    await load();
  };

  const onEdit = async (input: PanelInput) => {
    if (!editRow) return;
    const res = await updatePanel(editRow.id, input);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    setEditRow(null);
    toast.success("Panel updated");
    await load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {showNew && <PanelForm onSave={(i) => void onCreate(i)} onClose={() => setShowNew(false)} />}
      {editRow && <PanelForm isEdit initial={panelToInput(editRow)} onSave={(i) => void onEdit(i)} onClose={() => setEditRow(null)} />}
      {/* Clone never copies the identity — panel_code is typed fresh. */}
      {cloneRow && (
        <PanelForm initial={{ ...panelToInput(cloneRow), panel_code: "" }} onSave={(i) => void onCreate(i)} onClose={() => setCloneRow(null)} />
      )}

      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}

      {/* One toolbar; Edit/Clone/Delete enable off the selection (dim, never hide). */}
      <div className="fbar">
        {can("panel_craft", "edit") && (
          <IconBtn icon="edit" title="Edit selected panel" disabled={!singleRow || busy} onClick={() => singleRow && setEditRow(singleRow)} />
        )}
        {can("panel_craft", "create") && (
          <IconBtn icon="copy" title="Clone selected panel" disabled={!singleRow || busy} onClick={() => singleRow && setCloneRow(singleRow)} />
        )}
        {can("panel_craft", "delete") && (
          <IconBtn icon="trash" title="Delete selected" danger disabled={ids.length === 0 || busy} onClick={() => void onBulkDelete()} />
        )}
        <span className="pc-divider" />
        <IconBtn icon="refresh" title="Refresh" onClick={() => void load()} disabled={loading} />
        <span className="muted">{loading ? "Loading…" : ids.length > 0 ? `${ids.length} selected` : null}</span>
        <div style={{ flex: 1 }} />
        <FilterSelect label="Design" value={designFilter} onChange={setDesignFilter} options={designOptions} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search panel…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
        {can("panel_craft", "create") && (
          <button className="hbtn primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" size={13} />
            New panel
          </button>
        )}
      </div>

      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {loading && rows.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 34, textAlign: "center" }}>
                    <input type="checkbox" checked={allShownSelected} onChange={toggleAll} title={allShownSelected ? "Deselect all" : "Select all"} />
                  </th>
                  {visible.map((c) => (
                    <SortTh key={c.key} id={c.key} label={c.label} sort={sort} style={c.style} />
                  ))}
                  <th style={{ width: 68 }} />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const sel = selected.has(r.id);
                  return (
                    <tr key={r.id} className={sel ? "sel" : undefined}>
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={sel} onChange={() => toggleOne(r.id)} />
                      </td>
                      {visible.map((c) => (
                        <td key={c.key} className={c.className} style={c.style}>
                          {c.render!(r)}
                        </td>
                      ))}
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="row-actions">
                          {can("panel_craft", "edit") && <IconBtn icon="edit" title="Edit panel" onClick={() => setEditRow(r)} />}
                          {can("panel_craft", "delete") && <IconBtn icon="trash" title="Delete panel" danger onClick={() => void onDeleteOne(r)} />}
                        </span>
                      </td>
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
                          icon="tile"
                          title="No panels yet"
                          hint="Add your first showcase panel with New panel"
                          action={
                            <button className="hbtn primary" onClick={() => setShowNew(true)}>
                              New panel
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
