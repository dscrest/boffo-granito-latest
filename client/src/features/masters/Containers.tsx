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
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { fmt } from "@/lib/format";
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

export function Containers() {
  const [rows, setRows] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ row: ContainerRow | null } | null>(null); // null=closed, {row:null}=new

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
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.containerNumber.toLowerCase().includes(q) ||
        r.vesselName.toLowerCase().includes(q) ||
        r.portOfDischarge.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const onSave = async (input: ContainerInput) => {
    const target = editing?.row;
    setEditing(null);
    setNotice(target ? "Saving changes…" : "Saving container…");
    const res = target ? await updateContainer(target.id, input) : await createContainer(input);
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    setNotice(`Container saved (#${res.rowid}).`);
    toast.success(target ? "Container updated" : "Container saved");
    await load();
  };

  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const toggleOne = (id: string) =>
    setSelected((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((p) => {
      const next = new Set(p);
      if (allShownSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });

  const ids = useMemo(() => [...selected], [selected]);

  const onBulkDelete = async () => {
    if (!window.confirm(`Delete ${ids.length} selected container${ids.length > 1 ? "s" : ""}? This cannot be undone.`))
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
          <div className="sub">
            {loading ? "Loading…" : `${filtered.length} of ${rows.length} containers`}
            {notice && (
              <>
                {" · "}
                <span className="dim">{notice}</span>
              </>
            )}
          </div>
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
          <span className="muted mono">{filtered.length} rows</span>
          <div style={{ flex: 1 }} />
          <input type="text" placeholder="Search container…" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                <th>Container No.</th>
                <th>Type</th>
                <th>Vessel</th>
                <th className="num" style={{ textAlign: "right" }}>Cap. Boxes</th>
                <th className="num" style={{ textAlign: "right" }}>Cap. Pallets</th>
                <th>ETD</th>
                <th>Discharge</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
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
                    <td className="muted mono" style={{ textAlign: "center" }}>{i + 1}</td>
                    <td className="mono" style={{ color: "var(--fg)" }}>{r.containerNumber}</td>
                    <td>{r.containerType ? <span className="chip">{r.containerType}</span> : <span className="dim">—</span>}</td>
                    <td className="muted">{r.vesselName || <span className="dim">—</span>}</td>
                    <td className="num mono">{r.capacityBoxes > 0 ? fmt(r.capacityBoxes) : <span className="dim">—</span>}</td>
                    <td className="num mono">{r.capacityPallets > 0 ? fmt(r.capacityPallets) : <span className="dim">—</span>}</td>
                    <td className="mono muted">{r.etd || <span className="dim">—</span>}</td>
                    <td className="muted">{r.portOfDischarge || <span className="dim">—</span>}</td>
                    <td>
                      <span className="chip" style={{ color: STATUS_COLOR[r.status] || "var(--dim)" }}>{r.status}</span>
                    </td>
                  </tr>
                );
              })}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={10}>
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
      </div>

      {!loading && rows.length > 0 && <LoadBoard containers={rows} />}
    </div>
  );
}
