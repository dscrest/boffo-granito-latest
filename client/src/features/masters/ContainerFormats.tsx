/* ============================================================
   Container Master (CR-261) — grid of container formats: what one
   container of each size holds (pallet formats × count). Same master-page
   convention as Pallets: whole row → detail, bulk select → delete,
   data-driven columns, fixed footer pager.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { newestFirst } from "@/lib/dates";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDelete } from "@/ui/ConfirmDialog";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { fmt, fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { bulkDeleteContainerFormats, listContainerFormats, type ContainerFormatRow } from "./containerFormatsApi";

const dash = <span className="dim">—</span>;

const COLS: ColumnDef<ContainerFormatRow>[] = [
  { key: "size", label: "Size", render: (r) => r.sizeLabel || dash },
  {
    key: "pallets",
    label: "Pallets",
    render: (r) => (
      <span className="clip" style={{ maxWidth: 420 }} title={r.lines.map((l) => `${l.count} × ${l.palletName}`).join(", ")}>
        {r.lines.length ? r.lines.map((l) => `${l.count} × ${l.palletName}`).join(", ") : dash}
      </span>
    ),
  },
  { key: "totalPallets", label: "Total Pallets", className: "num mono", style: { textAlign: "right" }, render: (r) => (r.totalPallets > 0 ? fmt(r.totalPallets) : dash) },
  { key: "totalBoxes", label: "Total Boxes", className: "num mono", style: { textAlign: "right" }, render: (r) => (r.totalBoxes > 0 ? <span style={{ color: "var(--fg)" }}>{fmt(r.totalBoxes)}</span> : dash) },
  {
    key: "name",
    label: "Name",
    className: "muted",
    render: (r) => (
      <Link className="linkish" to={`/containers/${r.id}`} onClick={(e) => e.stopPropagation()} title="View container">
        {r.name || dash}
      </Link>
    ),
  },
  { key: "created", label: "Created", className: "muted mono", render: (r) => fmtDateTime(r.createdTime) },
  { key: "modified", label: "Modified", className: "muted mono", render: (r) => fmtDateTime(r.modifiedTime) },
];

export function ContainerFormats() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ContainerFormatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = usePersistedState("containerFormats.query", "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { ordered, visible, hidden, toggle, move, customised } = useColumns("containerFormatsTableColumns", COLS, ["name", "created", "modified"]);

  const load = async () => {
    setLoading(true);
    const res = await listContainerFormats();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load containers");
      return;
    }
    setError(null);
    setRows(res.formats);
    setSelected(new Set());
  };
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.name} ${r.sizeLabel} ${r.lines.map((l) => l.palletName).join(" ")}`.toLowerCase().includes(q));
  }, [rows, query]);

  const pager = usePagination(filtered.length, "containerFormatsPageSize", query);
  const pageRows = pager.slice(newestFirst(filtered));
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
    const reason = await confirmDelete({ message: `Are you sure you want to delete ${ids.length} selected container${ids.length > 1 ? "s" : ""}? This cannot be undone.` });
    if (reason == null) return;
    setBusy(true);
    const res = await bulkDeleteContainerFormats(ids, reason);
    setBusy(false);
    if (!res.ok) {
      setError(`${res.failed} delete(s) failed: ${res.firstError || "unknown error"}`);
      toast.error(`${res.done} deleted, ${res.failed} failed`);
    } else toast.success(`${res.done} container${res.done === 1 ? "" : "s"} deleted`);
    await load();
  };

  const newBtn = (
    <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} onClick={() => navigate("/containers/new")}>
      <Icon name="plus" size={13} />
      New Container
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}
      {ids.length > 0 ? (
        <div className="fbar" style={{ borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>{ids.length} selected</span>
          {can("items", "delete") && (
            <button className="btn" onClick={() => void onBulkDelete()} disabled={busy}>Delete</button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : (
        <div className="fbar">
          <span className="muted" style={{ fontSize: "var(--t-sm)" }}>{loading ? "Loading…" : null}</span>
          <div style={{ flex: 1 }} />
          <span className="gsearch">
            <Icon name="search" size={13} />
            <input type="text" placeholder="Search container…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} active={customised} />
          {can("items", "create") && newBtn}
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
                      onClick={() => navigate(`/containers/${r.id}`)}
                      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/containers/${r.id}`); }}
                      style={{ cursor: "pointer", background: sel ? "var(--accent-soft)" : undefined }}
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
                {!loading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={visible.length + 1}>
                      {rows.length > 0 ? (
                        <EmptyState title="No matching results" hint="Try a different filter" />
                      ) : (
                        <EmptyState icon="package" title="No containers yet" hint="Define what one container holds with New Container — a size may have several" action={can("items", "create") ? newBtn : undefined} />
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
