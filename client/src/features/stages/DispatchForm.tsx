/* ============================================================
   Dispatch form — closes out a loaded container via the dispatch saga
   (loaded → dispatched). Cascades dispatched_qty_boxes across every
   order item on the container and marks it dispatched (idempotent
   server-side). Reuses the shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import { listContainers, type ContainerRow } from "@/features/masters/containersApi";

export function DispatchForm({
  onConfirm,
  onClose,
}: {
  onConfirm: (containerId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerId, setContainerId] = useState("");
  // Errors stay hidden until the first submit attempt, then update live.
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const c = await listContainers();
      setLoading(false);
      if (!c.ok) {
        setError(c.error || "Failed to load containers");
        return;
      }
      // Only loaded (not yet dispatched) containers can dispatch.
      setContainers(c.containers.filter((x) => x.status === "loading" || x.status === "sealed"));
    })();
  }, []);

  const container = useMemo(() => containers.find((c) => c.id === containerId) || null, [containers, containerId]);
  const containerErr = showErrors && !containerId ? "Container is required" : null;

  const submit = async () => {
    if (!containerId) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      await onConfirm(containerId);
    } finally {
      setSaving(false);
    }
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="invoice" size={18} />
          </div>
          <div>
            <div className="ttl">Dispatch Container</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>

        <div className="df-body">
          {loading && <div className="muted" style={{ padding: 8 }}>Loading containers…</div>}
          {error && (
            <div style={{ borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "8px 12px", marginBottom: 10 }}>
              {error}
            </div>
          )}
          {!loading && !error && containers.length === 0 && (
            <div className="muted" style={{ padding: 8 }}>
              No loaded containers ready to dispatch. Load a container first.
            </div>
          )}

          {!loading && containers.length > 0 && (
            <div className="form-section">
              <div className="form-grid">
                <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                  <span className="lbl">
                    Container<span className="req"> *</span>
                  </span>
                  <select className={containerErr ? "error" : ""} value={containerId} onChange={(e) => setContainerId(e.target.value)}>
                    <option value="">— select —</option>
                    {containers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.containerNumber} · {c.status}
                        {c.vesselName ? ` · ${c.vesselName}` : ""}
                      </option>
                    ))}
                  </select>
                  {containerErr && <span className="field-err">{containerErr}</span>}
                </label>
              </div>
              {container && (
                <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Dispatching is final — every pallet on {container.containerNumber} will be marked dispatched.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && !containerId ? <span className="field-err">Select a container to dispatch</span> : "* Indicates a mandatory field"}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={saving} onClick={submit}>
            <Icon name="check" size={13} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
