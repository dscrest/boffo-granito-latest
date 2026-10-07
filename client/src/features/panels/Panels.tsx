/* ============================================================
   Panels (Panel Craft) — showcase-panel master, backed by the
   Catalyst Data Store via panelsApi. Follows the master-page UI
   convention (see DesignMaster):
   • NO row actions — the whole row (or tile) opens the panel detail
     page, where Edit / More ▸ Clone / Delete live (CR-279).
   • Photo | Grid toggle (CR-279): Photo = .panel-card tiles (the
     picker's PanelTile), Grid = the ColumnDef table; both share the
     filter, sort and pager. Photo is the default.
   • Bulk select (checkboxes, Grid view) → bulk delete on selection.
   • New / Edit / Clone are form pages: /panels/new|:id/edit|:id/clone.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDelete } from "@/ui/ConfirmDialog";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { FilterSelect, IconBtn, PanelTile } from "./pcBits";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { bulkDeletePanels, listPanels, type PanelRow } from "./panelsApi";

const dash = <span className="dim">—</span>;
const detailPath = (r: PanelRow) => `/panels/${encodeURIComponent(r.id)}`;

const PANEL_COLUMNS: ColumnDef<PanelRow>[] = [
  { key: "image", label: "Image", style: { width: 44 }, render: (r) => <ImageThumb images={r.images} alt={r.panelCode} /> },
  {
    key: "code",
    label: "Panel Code",
    render: (r) => (
      <Link className="linkish mono" to={detailPath(r)} title="View panel" onClick={(e) => e.stopPropagation()}>
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
  const [view, setView] = usePersistedState<"photo" | "grid">("panels.view", "photo");
  const [designFilter, setDesignFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("panelsTableColumns", PANEL_COLUMNS, ["created", "modified"]);

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
    const reason = await confirmDelete({ message: `Are you sure you want to delete ${ids.length} selected panel${ids.length > 1 ? "s" : ""}? This cannot be undone.` });
    if (reason == null) return;
    setBusy(true);
    const res = await bulkDeletePanels(rows.filter((r) => selected.has(r.id)), reason);
    setBusy(false);
    if (!res.ok) {
      setError(`${res.failed} delete(s) failed: ${res.firstError || "unknown error"}`);
      toast.error(`${res.done} deleted, ${res.failed} failed`);
    } else {
      toast.success(`${res.done} panel${res.done === 1 ? "" : "s"} deleted`);
    }
    await load();
  };

  const newPanel = () => navigate("/panels/new");
  const open = (r: PanelRow) => navigate(detailPath(r));

  const empty =
    rows.length > 0 ? (
      <EmptyState title="No matching results" hint="Try a different filter" />
    ) : (
      <EmptyState
        icon="tile"
        title="No panels yet"
        hint="Add your first showcase panel with New panel"
        action={
          can("panel_craft", "create") ? (
            <button className="hbtn primary" onClick={newPanel}>
              New panel
            </button>
          ) : undefined
        }
      />
    );
  const showEmpty = !loading && !error && filtered.length === 0;

  const photo = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, padding: 10, alignContent: "start" }}>
      {pageRows.map((r) => (
        <PanelTile key={r.id} panel={r} onClick={() => open(r)} />
      ))}
      {showEmpty && <div style={{ gridColumn: "1 / -1" }}>{empty}</div>}
    </div>
  );

  const grid = (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: 34, textAlign: "center" }}>
            <input type="checkbox" checked={allShownSelected} onChange={toggleAll} title={allShownSelected ? "Deselect all" : "Select all"} />
          </th>
          {visible.map((c) => (
            <SortTh key={c.key} id={c.key} label={c.label} sort={sort} style={c.style} />
          ))}
        </tr>
      </thead>
      <tbody>
        {pageRows.map((r) => {
          const sel = selected.has(r.id);
          return (
            <tr
              key={r.id}
              className={sel ? "sel" : undefined}
              tabIndex={0}
              style={{ cursor: "pointer" }}
              onClick={() => open(r)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.target === e.currentTarget) open(r);
              }}
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
        {showEmpty && (
          <tr>
            <td colSpan={visible.length + 1}>{empty}</td>
          </tr>
        )}
      </tbody>
    </table>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {error && <ErrorCard message={`${error} — check the Audit log (/ops).`} onRetry={() => void load()} />}

      {/* One toolbar; bulk Delete enables off the selection (dim, never hide). */}
      <div className="fbar">
        {can("panel_craft", "delete") && (
          <IconBtn icon="trash" title="Delete selected" danger disabled={ids.length === 0 || busy} onClick={() => void onBulkDelete()} />
        )}
        <span className="pc-divider" />
        <IconBtn icon="refresh" title="Refresh" onClick={() => void load()} disabled={loading} />
        <span className="muted">{loading ? "Loading…" : ids.length > 0 ? `${ids.length} selected` : null}</span>
        <div style={{ flex: 1 }} />
        <span role="group" aria-label="Panels view" title="Switch view" style={{ display: "inline-flex", gap: 4 }}>
          <IconBtn icon="tile" title="Photo view" active={view === "photo"} onClick={() => setView("photo")} />
          <IconBtn icon="orders" title="Grid view" active={view === "grid"} onClick={() => setView("grid")} />
        </span>
        <span className="pc-divider" />
        <FilterSelect label="Design" value={designFilter} onChange={setDesignFilter} options={designOptions} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search panel…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        {view === "grid" && <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />}
        {can("panel_craft", "create") && (
          <button className="hbtn primary" onClick={newPanel}>
            <Icon name="plus" size={13} />
            New panel
          </button>
        )}
      </div>

      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {loading && rows.length === 0 ? <SkeletonRows rows={6} /> : view === "photo" ? photo : grid}
        </div>
        {!(loading && rows.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
