/* ============================================================
   Container Master — table of shipping-container specs backed by the
   Catalyst Data Store via containersApi. Create / edit / delete write
   real rows; every mutation is recorded in OperationLog (see /ops).
   Phase 4 (load-container, dispatch, fit-suggest) operates on these.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { fmt } from "@/lib/format";
import { ContainerForm } from "./ContainerForm";
import {
  createContainer,
  deleteContainer,
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

  const onDelete = async (row: ContainerRow) => {
    if (!window.confirm(`Delete container "${row.containerNumber}"? This cannot be undone.`)) return;
    setNotice("Deleting…");
    const res = await deleteContainer(row.id);
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Delete failed");
      toast.error(res.error || "Delete failed");
      return;
    }
    setNotice("Container deleted.");
    toast.success("Container deleted");
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
          <button className="hbtn primary" onClick={() => setEditing({ row: null })}>
            <Icon name="plus" size={13} />
            New container
          </button>
        </div>
      </div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar">
        <span className="muted mono">{filtered.length} rows</span>
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Search container…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && rows.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: "center" }}>#</th>
                <th>Container No.</th>
                <th>Type</th>
                <th>Vessel</th>
                <th className="num" style={{ textAlign: "right" }}>Cap. Boxes</th>
                <th className="num" style={{ textAlign: "right" }}>Cap. Pallets</th>
                <th>ETD</th>
                <th>Discharge</th>
                <th>Status</th>
                <th style={{ width: 90, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id}>
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
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn" title="Edit" onClick={() => setEditing({ row: r })}>
                      Edit
                    </button>{" "}
                    <button className="btn" title="Delete" onClick={() => void onDelete(r)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
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
    </div>
  );
}
