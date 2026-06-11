/* ============================================================
   Load Container form — commits ContainerLoading rows via the
   load-container saga (palletized → loaded). Operator picks a container
   (planned/loading) and the closed pallet batches to load onto it. The
   server enforces capacity + rejects double-loads. Reuses df-* form CSS.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { listContainers, type ContainerRow } from "@/features/masters/containersApi";
import { listLoadableBatches, type LoadContainerInput, type LoadableBatch } from "./palletisationApi";

export function LoadContainerForm({
  onSave,
  onClose,
}: {
  onSave: (input: LoadContainerInput) => void;
  onClose: () => void;
}) {
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [batches, setBatches] = useState<LoadableBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [containerId, setContainerId] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void (async () => {
      const [c, b] = await Promise.all([listContainers(), listLoadableBatches()]);
      setLoading(false);
      if (!c.ok || !b.ok) {
        setError(c.error || b.error || "Failed to load");
        return;
      }
      // Only containers that can still take pallets.
      setContainers(c.containers.filter((x) => x.status === "planned" || x.status === "loading"));
      setBatches(b.batches);
    })();
  }, []);

  const container = useMemo(() => containers.find((c) => c.id === containerId) || null, [containers, containerId]);
  const pickedIds = useMemo(() => Object.keys(picked).filter((k) => picked[k]), [picked]);
  const pickedBoxes = useMemo(
    () => batches.filter((b) => picked[b.batchId]).reduce((s, b) => s + b.boxes, 0),
    [batches, picked],
  );

  const overCap = !!container && container.capacityBoxes > 0 && pickedBoxes > container.capacityBoxes;
  const missing = !containerId || pickedIds.length === 0;

  const submit = () => {
    if (missing || overCap) return;
    onSave({ container: containerId, batches: pickedIds });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel card df-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="truck" size={18} />
          </div>
          <div>
            <div className="ttl">Load Container</div>
            <div className="sub2">Loads closed pallets · palletized → loaded</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          {loading && <div className="muted" style={{ padding: 8 }}>Loading containers & batches…</div>}
          {error && (
            <div style={{ borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "8px 12px", marginBottom: 10 }}>
              {error}
            </div>
          )}
          {!loading && !error && (containers.length === 0 || batches.length === 0) && (
            <div className="muted" style={{ padding: 8 }}>
              {containers.length === 0
                ? "No planned/loading containers. Add one in Container Master."
                : "No closed pallets are waiting to load. Close a pallet first."}
            </div>
          )}

          {!loading && containers.length > 0 && batches.length > 0 && (
            <>
              <div className="form-section">
                <div className="form-section-title">Container</div>
                <div className="form-grid">
                  <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                    <span className="lbl">
                      Container<span className="req"> *</span>
                    </span>
                    <select value={containerId} onChange={(e) => setContainerId(e.target.value)}>
                      <option value="">— select —</option>
                      {containers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.containerNumber} · {c.status}
                          {c.capacityBoxes > 0 ? ` (cap ${c.capacityBoxes})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="form-section">
                <div className="form-section-title">Pallets to load</div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}></th>
                      <th>Batch</th>
                      <th>Design</th>
                      <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.batchId}>
                        <td style={{ textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={!!picked[b.batchId]}
                            onChange={(e) => setPicked((p) => ({ ...p, [b.batchId]: e.target.checked }))}
                          />
                        </td>
                        <td className="mono muted">#{b.batchId}</td>
                        <td><span className="design-name">{b.label}</span></td>
                        <td className="num mono">{b.boxes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {overCap && (
                  <div style={{ color: "var(--c-red)", fontSize: 11, marginTop: 6 }}>
                    Selected {pickedBoxes} boxes exceed container capacity ({container?.capacityBoxes}).
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {pickedIds.length > 0 ? `${pickedIds.length} pallet${pickedIds.length > 1 ? "s" : ""} · ${pickedBoxes} boxes` : "* required"}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={missing || overCap} onClick={submit}>
            <Icon name="check" size={13} />
            Load container
          </button>
        </div>
      </div>
    </div>
  );
}
