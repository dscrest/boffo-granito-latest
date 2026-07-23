/* ============================================================
   Assign-vehicle screen — used while a palletization plan is In Loading (the
   "Assign Vehicle" action) to attach the vehicle needed before dispatch. Pick a
   vehicle from the Vehicle master, or create one inline (number + driver +
   mobile, all required). Confirm returns the chosen Vehicle ROWID to the caller.
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { toast } from "@/ui/Toast";
import { useModalA11y } from "@/ui/useModalA11y";
import { listVehicles, createVehicle, type VehicleRow } from "@/features/masters/vehiclesApi";

export function VehicleLoadModal({
  palNumber,
  busy,
  onConfirm,
  onClose,
}: {
  palNumber: string;
  busy?: boolean;
  onConfirm: (vehicleId: string) => void;
  onClose: () => void;
}) {
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [selected, setSelected] = useState("");
  // Inline-create state ("" = picking; object = the new-vehicle form is open).
  const [creating, setCreating] = useState<{ vehicle_number: string; driver_name: string; mobile_number: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const r = await listVehicles();
    if (r.ok) setVehicles(r.vehicles);
  };
  useEffect(() => { void load(); }, []);

  const saveVehicle = async () => {
    if (!creating) return;
    if (!creating.vehicle_number.trim() || !creating.driver_name.trim() || !creating.mobile_number.trim()) return;
    setSaving(true);
    const res = await createVehicle({
      vehicle_number: creating.vehicle_number.trim(),
      driver_name: creating.driver_name.trim(),
      mobile_number: creating.mobile_number.trim(),
    });
    setSaving(false);
    if (!res.ok || !res.rowid) {
      toast.error(res.error || "Could not add vehicle");
      return;
    }
    await load();
    setSelected(res.rowid);
    setCreating(null);
  };

  const panelRef = useModalA11y(onClose);
  const createInvalid = !!creating && (!creating.vehicle_number.trim() || !creating.driver_name.trim() || !creating.mobile_number.trim());

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="truck" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Assign Vehicle</div>
            <div className="dim" style={{ fontSize: "var(--t-sm)" }}>Assign a vehicle to {palNumber}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          {creating ? (
            <div className="form-section">
              <div className="form-section-title">New Vehicle</div>
              <div className="form-grid">
                <label className="form-field">
                  <span className="lbl">Vehicle Number<span className="req"> *</span></span>
                  <input value={creating.vehicle_number} autoFocus placeholder="e.g. GJ-01-AB-1234"
                    onChange={(e) => setCreating((c) => c && { ...c, vehicle_number: e.target.value })} />
                </label>
                <label className="form-field">
                  <span className="lbl">Driver Name<span className="req"> *</span></span>
                  <input value={creating.driver_name} placeholder="Driver name"
                    onChange={(e) => setCreating((c) => c && { ...c, driver_name: e.target.value })} />
                </label>
                <label className="form-field">
                  <span className="lbl">Mobile<span className="req"> *</span></span>
                  <input value={creating.mobile_number} placeholder="Mobile number"
                    onChange={(e) => setCreating((c) => c && { ...c, mobile_number: e.target.value })} />
                </label>
              </div>
            </div>
          ) : (
            <div className="form-section">
              <div className="form-section-title">Vehicle</div>
              <label className="form-field">
                <span className="lbl">Vehicle<span className="req"> *</span></span>
                <Combobox
                  value={selected}
                  options={vehicles.map((v) => ({
                    value: v.id,
                    label: [v.vehicleNumber, v.driverName].filter(Boolean).join(" · "),
                    hint: v.mobile,
                  }))}
                  onChange={setSelected}
                  onCreate={(text) => setCreating({ vehicle_number: text, driver_name: "", mobile_number: "" })}
                  placeholder="Search or add a vehicle…"
                />
              </label>
              {selected && (() => {
                const v = vehicles.find((x) => x.id === selected);
                return v ? <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 6 }}>{[v.driverName, v.mobile].filter(Boolean).join("  ·  ")}</div> : null;
              })()}
            </div>
          )}
        </div>

        <div className="df-foot">
          <div style={{ flex: 1 }} />
          {creating ? (
            <>
              <button className="btn" onClick={() => setCreating(null)} disabled={saving}>Cancel</button>
              <button className="hbtn primary" onClick={() => void saveVehicle()} disabled={saving || createInvalid}>
                <Icon name="check" size={13} /> {saving ? "Saving…" : "Add vehicle"}
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="hbtn primary" onClick={() => onConfirm(selected)} disabled={busy || !selected}>
                <Icon name="check" size={13} /> {busy ? "Saving…" : "Assign vehicle"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
