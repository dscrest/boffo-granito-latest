/* ============================================================
   Container Master — table of shipping-container specs backed by the
   Catalyst Data Store via containersApi. Create / edit / delete write
   real rows; every mutation is recorded in OperationLog (see /ops).
   Phase 4 (load-container, dispatch, fit-suggest) operates on these.

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
import { fmt, fmtDateTime } from "@/lib/format";
import { canDelete, canUpdate } from "@/lib/auth";
import { ContainerForm } from "./ContainerForm";
import { LoadBoard } from "./LoadBoard";
import {
  bulkDeleteContainers,
  createContainer,
  listContainers,
  updateContainer,
  type ContainerInput,
  type ContainerRow,
} from "./containersApi";

const STATUS_COLOR: Record<string, string> = {
  planned: "var(--dim)",
  loading: "var(--c-cyan)",
  sealed: "var(--c-amber)",
  dispatched: "var(--c-green)",
};

const dash = <span className="dim">—</span>;

// Toggleable + reorderable columns (checkbox/# pinned outside the map).
const CONTAINER_COLUMNS: ColumnDef<ContainerRow>[] = [
  {
    key: "number",
    label: "Container No.",
    className: "mono",
    render: (r) => <span style={{ color: "var(--fg)" }}>{r.containerNumber}</span>,
  },
  { key: "type", label: "Type", render: (r) => (r.containerType ? <span className="chip">{r.containerType}</span> : dash) },
  { key: "vessel", label: "Vessel", className: "muted", render: (r) => r.vesselName || dash },
  {
    key: "capBoxes",
    label: "Cap. Boxes",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.capacityBoxes > 0 ? fmt(r.capacityBoxes) : dash),
  },
  {
    key: "capPallets",
    label: "Cap. Pallets",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.capacityPallets > 0 ? fmt(r.capacityPallets) : dash),
  },
  { key: "etd", label: "ETD", className: "mono muted", render: (r) => r.etd || dash },
  { key: "discharge", label: "Discharge", className: "muted", render: (r) => r.portOfDischarge || dash },
  {
    key: "status",
    label: "Status",
    render: (r) => <span className="chip" style={{ color: STATUS_COLOR[r.status] || "var(--dim)" }}>{r.status}</span>,
  },
  { key: "created", label: "Created", className: "muted mono", render: (r) => fmtDateTime(r.createdTime) },
  { key: "modified", label: "Modified", className: "muted mono", render: (r) => fmtDateTime(r.modifiedTime) },
];

export function Containers() {
  const [rows, setRows] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusF, setStatusF] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ row: ContainerRow | null } | null>(null); // null=closed, {row:null}=new
  const { ordered, visible, hidden, toggle, move } = useColumns("containersTableColumns", CONTAINER_COLUMNS, ["created", "modified"]);

  const load = async () => {
    setLoading(true);
    const res = await listContainers();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load containers");
      return;
    }
    setError(null);
    setRows(res.containers);
    setSelected(new Set());
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusF && r.status !== statusF) return false;
      if (!q) return true;
      return (
        r.containerNumber.toLowerCase().includes(q) ||
        r.vesselName.toLowerCase().includes(q) ||
        r.portOfDischarge.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      );
    });
  }, [rows, query, statusF]);

  const pager = usePagination(filtered.length, "containersPageSize", `${query}|${statusF}`);
  const pageRows = pager.slice(filtered);
  const statusOptions = useMemo(() => [...new Set(rows.map((r) => r.status).filter(Boolean))].sort(), [rows]);

  const onSave = async (input: ContainerInput) => {
    const target = editing?.row;
    setNotice(target ? "Saving changes…" : "Saving container…");
    const res = target ? await updateContainer(target.id, input) : await createContainer(input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      setNotice(null);
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    setEditing(null);
    setNotice(`Container saved (#${res.rowid}).`);
    toast.success(target ? "Container updated" : "Container saved");
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
    if (!(await confirmDialog({ message: `Delete ${ids.length} selected container${ids.length > 1 ? "s" : ""}? This cannot be undone.`, danger: true })))
      return;
    setBusy(true);
    setNotice(`Deleting ${ids.length} container${ids.length > 1 ? "s" : ""}…`);
    const res = await bulkDeleteContainers(ids);
    setBusy(false);
    if (!res.ok) {
      setError(`${res.failed} delete(s) failed: ${res.firstError || "unknown error"}`);
      toast.error(`${res.done} deleted, ${res.failed} failed`);
    } else {
      toast.success(`${res.done} container${res.done === 1 ? "" : "s"} deleted`);
    }
    setNotice(`Deleted ${res.done} container${res.done === 1 ? "" : "s"}.`);
    await load();
  };

  const initial: Partial<ContainerInput> | undefined = editing?.row
    ? {
        container_number: editing.row.containerNumber,
        container_type: editing.row.containerType,
        capacity_boxes: editing.row.capacityBoxes,
        capacity_pallets: editing.row.capacityPallets,
        capacity_area_sqm: editing.row.capacityAreaSqm,
        max_weight_kg: editing.row.maxWeightKg,
        vessel_name: editing.row.vesselName,
        etd: editing.row.etd,
        eta: editing.row.eta,
        port_of_loading: editing.row.portOfLoading,
        port_of_discharge: editing.row.portOfDischarge,
        status: editing.row.status,
      }
    : undefined;

  return (
    <div>
      {editing && (
        <ContainerForm
          initial={initial}
          isEdit={!!editing.row}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="page-head">
        <div>
          <div className="title">Container Master</div>
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
              New container
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
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} title="Filter by status">
            <option value="">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <input type="text" placeholder="Search container…" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                  <th key={c.key} style={c.style}>{c.label}</th>
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
                    title="Edit container"
                  >
                    {/* checkbox cell stops propagation so toggling never opens the form */}
                    <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={sel} onChange={() => toggleOne(r.id)} />
                    </td>
                    <td className="muted mono" style={{ textAlign: "center" }}>{pager.from + i}</td>
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
                        icon="truck"
                        title="No containers yet"
                        hint="Add your first container spec with New container"
                        action={
                          <button className="hbtn primary" onClick={() => setEditing({ row: null })}>
                            New container
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

      {!loading && rows.length > 0 && <LoadBoard containers={rows} />}
    </div>
  );
}
