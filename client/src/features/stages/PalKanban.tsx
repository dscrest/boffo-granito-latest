/* ============================================================
   Palletization board — one card per PalletizationPlan across the five
   lifecycle stages (In Palletization → Palletized → Ready for Loading →
   In Loading → Dispatched). Cards drag between ADJACENT stages only
   (PAL_TRANSITIONS); dropping onto "In Loading" opens the vehicle screen
   first. Card click opens the plan detail. Mirrors the Production board's
   hand-rolled HTML5 drag-and-drop.
   ============================================================ */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { fmt } from "@/lib/format";
import { STATUS_CHIP } from "./PalPlans";
import { VehicleLoadModal } from "./VehicleLoadModal";
import {
  invalidatePalPlans,
  PAL_STATUSES,
  PAL_STATUS_LABEL,
  PAL_TRANSITIONS,
  setPalStatus,
  type PalPlan,
  type PalStatus,
} from "./palPlansApi";

export function PalKanban({ plans, canEdit, onChanged }: { plans: PalPlan[]; canEdit: boolean; onChanged: () => void }) {
  const navigate = useNavigate();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Pending "→ In Loading" move awaiting a vehicle (drag onto the Loading column).
  const [pendingLoad, setPendingLoad] = useState<PalPlan | null>(null);

  const move = async (plan: PalPlan, to: PalStatus, vehicle?: string) => {
    setBusy(true);
    const res = await setPalStatus(plan.id, to, vehicle);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Status change failed");
      return;
    }
    setPendingLoad(null);
    toast.success(`${plan.palNumber} → ${PAL_STATUS_LABEL[to]}`);
    invalidatePalPlans();
    onChanged();
  };

  const onDrop = (to: PalStatus) => {
    const plan = plans.find((p) => p.id === dragId);
    setDragId(null);
    setOverStage(null);
    if (!plan || plan.status === to) return;
    if (!(PAL_TRANSITIONS[plan.status] || []).includes(to)) return; // adjacent-only
    if (to === "Loading") setPendingLoad(plan); // vehicle screen first
    else void move(plan, to, undefined);
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${PAL_STATUSES.length}, minmax(220px, 1fr))`, gap: 12, alignItems: "start", overflowX: "auto" }}>
        {PAL_STATUSES.map((stage) => {
          const cards = plans.filter((p) => p.status === stage);
          const isOver = overStage === stage;
          return (
            <div
              key={stage}
              onDragOver={(e) => { if (!canEdit || !dragId) return; e.preventDefault(); setOverStage(stage); }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={(e) => { e.preventDefault(); onDrop(stage); }}
              className="card"
              style={{ padding: 0, background: isOver ? "var(--accent-soft)" : undefined, transition: "background .12s" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
                <span className={`chip palstatus ${STATUS_CHIP[stage]}`}>{PAL_STATUS_LABEL[stage]}</span>
                <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>{cards.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, minHeight: 80 }}>
                {cards.map((p) => (
                  <div
                    key={p.id}
                    draggable={canEdit}
                    onDragStart={() => canEdit && setDragId(p.id)}
                    onDragEnd={() => { setDragId(null); setOverStage(null); }}
                    onClick={() => navigate(`/packing/${p.id}`)}
                    title="Open plan"
                    style={{
                      border: "1px solid var(--border)", borderRadius: 8, padding: 10, background: "var(--bg)",
                      cursor: canEdit ? "grab" : "pointer", opacity: dragId === p.id ? 0.5 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="mono" style={{ fontWeight: 600 }}>{p.palNumber}</span>
                      <span className="chip" style={{ marginLeft: "auto", fontSize: 11 }}>{fmt(p.totalBoxes)} box</span>
                    </div>
                    <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.soNumbers.length ? p.soNumbers.join(", ") : "—"}
                    </div>
                    {(p.vehicleNumber || p.salespersonName) && (
                      <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {[p.vehicleNumber && `🚛 ${p.vehicleNumber}`, p.salespersonName].filter(Boolean).join("  ·  ")}
                      </div>
                    )}
                  </div>
                ))}
                {cards.length === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "6px 2px" }}>—</div>}
              </div>
            </div>
          );
        })}
      </div>

      {pendingLoad && (
        <VehicleLoadModal
          palNumber={pendingLoad.palNumber}
          busy={busy}
          onConfirm={(vehicleId) => void move(pendingLoad, "Loading", vehicleId)}
          onClose={() => setPendingLoad(null)}
        />
      )}
    </>
  );
}
