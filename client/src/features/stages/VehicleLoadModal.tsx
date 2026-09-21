/* ============================================================
   Assign Vehicle / Edit Load Details — captures the vehicle and the load
   details on a LoadBox before dispatch. Vehicle is FREE TEXT (CR-185):
   number + driver + mobile are typed, never picked from a master; Save
   resolves them through `resolveVehicle` (find by formatted number →
   update driver/mobile → else create) so LoadBox.vehicle still points at a
   real Vehicle row and every display/report keeps working. Confirm hands
   the resolved Vehicle ROWID ("" when no number typed) to the caller.
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { useModalA11y } from "@/ui/useModalA11y";
import { resolveVehicle } from "@/features/masters/vehiclesApi";
import { LoadDetailsFields, useLoadDetails } from "./LoadDetailsFields";
import type { LoadBox, LoadingCapture } from "./palPlansApi";

export function VehicleLoadModal({
  palNumber,
  title = "Assign Vehicle",
  busy,
  initialVehicle,
  initialCapture,
  onConfirm,
  onClose,
}: {
  palNumber: string;
  title?: string;
  busy?: boolean;
  /** The box's current vehicle (display fields) — prefills the three inputs. */
  initialVehicle?: Pick<LoadBox, "vehicleNumber" | "driverName" | "mobileNumber">;
  initialCapture?: LoadingCapture;
  onConfirm: (vehicleId: string, capture: LoadingCapture) => void;
  onClose: () => void;
}) {
  const details = useLoadDetails(initialVehicle, initialCapture);
  const { vehicle, capture } = details;
  const [resolving, setResolving] = useState(false);

  const save = async () => {
    if (busy || resolving) return;
    setResolving(true);
    const veh = await resolveVehicle(vehicle);
    setResolving(false);
    if (!veh.ok) {
      toast.error(veh.error || "Could not save the vehicle");
      return;
    }
    onConfirm(veh.rowid, capture);
  };

  const panelRef = useModalA11y(onClose);
  const saving = !!busy || resolving;

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="truck" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{title}</div>
            <div className="dim" style={{ fontSize: "var(--t-sm)" }}>{palNumber}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <LoadDetailsFields {...details} />
        </div>

        <div className="df-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="hbtn primary" onClick={() => void save()} disabled={saving}>
            <Icon name="check" size={13} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
