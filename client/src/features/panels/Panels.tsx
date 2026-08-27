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
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { PanelForm } from "./PanelForm";
import { bulkDeletePanels, createPanel, listPanels, type PanelInput, type PanelRow } from "./panelsApi";

const dash = <span className="dim">—</span>;

const PANEL_COLUMNS: ColumnDef<PanelRow>[] = [
  {
    key: "code",
    label: "Panel Code",
    render: (r) => (
      <Link className="linkish" to={`/panels/${r.id}`} onClick={(e) => e.stopPropagation()} title="View panel">
        <span className="chip">{r.panelCode}</span>
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { ordered, visible, hidden, toggle, move } = useColumns("panelsTableColumns", PANEL_COLUMNS, ["created", "modified"]);
  const [showNew, setShowNew] = useState(false);

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
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.panelCode.toLowerCase().includes(q) ||
        r.lines.some((l) => l.designName.toLowerCase().includes(q) || l.cutSizeName.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const pager = usePagination(filtered.length, "panelsPageSize", query);
  const pageRows = pager.slice(filtered);

  const onCreate = async (input: PanelInput) => {
    const res = await createPanel(input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    setShowNew(false);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {showNew && <PanelForm onSave={(i) => void onCreate(i)} onClose={() => setShowNew(false)} />}

      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}

      {/* Bulk action bar replaces the filter bar while a selection is active. */}
      {ids.length > 0 ? (
        <div className="fbar" style={{ borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>
            {ids.length} selected
          </span>
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
          <span className="muted" style={{ fontSize: "var(--t-sm)" }}>{loading ? "Loading…" : null}</span>
          <div style={{ flex: 1 }} />
          <span className="gsearch">
            <Icon name="search" size={13} />
            <input type="text" placeholder="Search panel…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
          {can("items", "create") && (
            <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} onClick={() => setShowNew(true)}>
              <Icon name="plus" size={13} />
              New panel
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
                    <input type="checkbox" checked={allShownSelected} onChange={toggleAll} title={allShownSelected ? "Deselect all" : "Select all"} />
                  </th>
                  {visible.map((c) => (
                    <th key={c.key} style={c.style}>{c.label}</th>
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
                      onClick={() => navigate(`/panels/${r.id}`)}
                      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/panels/${r.id}`); }}
                      style={{ cursor: "pointer", background: sel ? "var(--accent-soft)" : undefined }}
                    >
                      <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={sel} onChange={() => toggleOne(r.id)} />
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
                    <td colSpan={visible.length + 1}>
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
