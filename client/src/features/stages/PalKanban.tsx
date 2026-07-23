/* ============================================================
   Palletization board — TWO-LEVEL. The first two columns are PER ITEM
   (a PalletizationPlanLine): drag one item card between "In Palletization"
   and "Ready for Loading" and only that item moves (setPalLineStatus). The
   last two columns are PER VEHICLE (a PalletizationPlan): once every line of
   a plan is Ready, a "Load vehicle" button assembles the whole plan onto a
   vehicle and it advances as one card through "In Loading" → "Dispatched".
   Dragging a single item never moves the vehicle — the load step is a button,
   not a drag. Hand-rolled HTML5 drag-and-drop like the Production board.
   ============================================================ */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { fmt } from "@/lib/format";
import { VehicleLoadModal } from "./VehicleLoadModal";
import {
  invalidatePalPlans,
  PAL_LINE_TRANSITIONS,
  PAL_TRANSITIONS,
  setPalLineStatus,
  setPalStatus,
  setPalVehicle,
  type PalPlan,
  type PalLineStatus,
  type PalStatus,
} from "./palPlansApi";

// Board columns. Line columns advance one item; plan columns advance a vehicle.
const COLUMNS = [
  { key: "Planning", label: "In Palletization", chip: "p-planning", level: "line" },
  { key: "ReadyToLoad", label: "Ready for Loading", chip: "p-ready", level: "line" },
  { key: "Loading", label: "In Loading", chip: "p-loading", level: "plan" },
  { key: "Completed", label: "Dispatched", chip: "p-completed", level: "plan" },
] as const;

type Drag = { kind: "line" | "plan"; id: string; from: string } | null;

export function PalKanban({ plans, canEdit, onChanged }: { plans: PalPlan[]; canEdit: boolean; onChanged: () => void }) {
  const navigate = useNavigate();
  const [drag, setDrag] = useState<Drag>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Plan whose vehicle modal is open. mode "load" = assemble a Ready plan onto a
  // vehicle (Planning → Loading + vehicle); "reassign" = change an In-Loading plan's vehicle.
  const [vehModal, setVehModal] = useState<{ plan: PalPlan; mode: "load" | "reassign" } | null>(null);

  const after = (ok: boolean, err: string, msg: string) => {
    if (!ok) { toast.error(err); return; }
    toast.success(msg);
    invalidatePalPlans();
    onChanged();
  };

  const moveLine = async (lineId: string, to: PalLineStatus, code: string) => {
    setBusy(true);
    const res = await setPalLineStatus(lineId, to);
    setBusy(false);
    after(res.ok, res.error || "Move failed", `${code} → ${to === "ReadyToLoad" ? "Ready for Loading" : "In Palletization"}`);
  };

  const movePlan = async (plan: PalPlan, to: PalStatus) => {
    setBusy(true);
    const res = await setPalStatus(plan.id, to);
    setBusy(false);
    after(res.ok, res.error || "Move failed", `${plan.palNumber} → ${to === "Completed" ? "Dispatched" : "In Loading"}`);
  };

  // "Load vehicle": advance the plan to Loading, then attach the vehicle (server
  // requires the plan be In Loading before a vehicle is assigned).
  const loadVehicle = async (plan: PalPlan, vehicleId: string) => {
    setBusy(true);
    const step = plan.status === "Loading" ? { ok: true } as const : await setPalStatus(plan.id, "Loading");
    const res = step.ok ? await setPalVehicle(plan.id, vehicleId) : step;
    setBusy(false);
    setVehModal(null);
    after(res.ok, ("error" in res && res.error) || "Could not load vehicle", `Vehicle assigned to ${plan.palNumber}`);
  };

  const onDrop = (col: (typeof COLUMNS)[number]) => {
    const d = drag;
    setDrag(null);
    setOverCol(null);
    if (!d) return;
    if (col.level === "line" && d.kind === "line") {
      const to = col.key as PalLineStatus;
      if (d.from === to || !(PAL_LINE_TRANSITIONS[d.from as PalLineStatus] || []).includes(to)) return;
      const line = plans.flatMap((p) => p.lines).find((l) => l.id === d.id);
      void moveLine(d.id, to, line?.itemCode || "Item");
    } else if (col.level === "plan" && d.kind === "plan") {
      const to = col.key as PalStatus;
      if (d.from === to || !(PAL_TRANSITIONS[d.from as PalStatus] || []).includes(to)) return;
      const plan = plans.find((p) => p.id === d.id);
      if (!plan) return;
      if (to === "Completed" && !plan.vehicleId) { toast.error("Assign a vehicle before dispatch"); return; }
      void movePlan(plan, to);
    }
  };

  // Item card (a plan line) for the two line columns.
  const itemCard = (p: PalPlan, l: PalPlan["lines"][number]) => (
    <div
      key={l.id}
      draggable={canEdit}
      onDragStart={() => canEdit && setDrag({ kind: "line", id: l.id, from: l.status })}
      onDragEnd={() => { setDrag(null); setOverCol(null); }}
      onClick={() => navigate(`/packing/${p.id}`)}
      title={`Open ${p.palNumber}`}
      style={{
        border: "1px solid var(--border)", borderRadius: 8, padding: 10, background: "var(--bg)",
        cursor: canEdit ? "grab" : "pointer", opacity: drag?.id === l.id ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="mono" style={{ fontWeight: 600 }}>{l.itemCode}</span>
        <span className="chip" style={{ marginLeft: "auto", fontSize: 11 }}>{fmt(l.boxes)} box</span>
      </div>
      <div className="design-name" style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {l.designLabel}
      </div>
      <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {[l.soNumber, l.palletName].filter((s) => s && s !== "—").join("  ·  ") || "—"}
      </div>
      <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>{p.palNumber}</div>
    </div>
  );

  // Plan (vehicle) card for the two plan columns.
  const planCard = (p: PalPlan) => (
    <div
      key={p.id}
      draggable={canEdit && p.status !== "Completed"}
      onDragStart={() => canEdit && setDrag({ kind: "plan", id: p.id, from: p.status })}
      onDragEnd={() => { setDrag(null); setOverCol(null); }}
      onClick={() => navigate(`/packing/${p.id}`)}
      title={`Open ${p.palNumber}`}
      style={{
        border: "1px solid var(--border)", borderRadius: 8, padding: 10, background: "var(--bg)",
        cursor: canEdit && p.status !== "Completed" ? "grab" : "pointer", opacity: drag?.id === p.id ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="mono" style={{ fontWeight: 600 }}>{p.palNumber}</span>
        <span className="chip" style={{ marginLeft: "auto", fontSize: 11 }}>{fmt(p.totalBoxes)} box</span>
        {canEdit && p.status === "Loading" && (
          <button
            type="button"
            className="btn x"
            title={p.vehicleNumber ? "Reassign vehicle" : "Assign vehicle"}
            aria-label={p.vehicleNumber ? "Reassign vehicle" : "Assign vehicle"}
            style={{ padding: 2, height: 20, width: 20, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); setVehModal({ plan: p, mode: "reassign" }); }}
          >
            <Icon name="truck" size={12} />
          </button>
        )}
      </div>
      <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {p.lines.length} item{p.lines.length === 1 ? "" : "s"}{p.soNumbers.length ? `  ·  ${p.soNumbers.join(", ")}` : ""}
      </div>
      <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
        {p.vehicleNumber ? `🚛 ${p.vehicleNumber}` : "No vehicle yet"}
      </div>
    </div>
  );

  // Column contents by level.
  const colContent = (col: (typeof COLUMNS)[number]) => {
    if (col.level === "line") {
      const status = col.key as PalLineStatus;
      if (status === "Planning") {
        const cards = plans
          .filter((p) => p.status === "Planning")
          .flatMap((p) => p.lines.filter((l) => l.status === "Planning").map((l) => ({ p, l })));
        return { count: cards.length, node: cards.map(({ p, l }) => itemCard(p, l)) };
      }
      // Ready for Loading — grouped by plan so a fully-ready plan can be loaded.
      const groups = plans
        .filter((p) => p.status === "Planning" && p.lines.some((l) => l.status === "ReadyToLoad"))
        .map((p) => ({ p, ready: p.lines.filter((l) => l.status === "ReadyToLoad"), allReady: p.lines.every((l) => l.status === "ReadyToLoad") }));
      const count = groups.reduce((s, g) => s + g.ready.length, 0);
      return {
        count,
        node: groups.map(({ p, ready, allReady }) => (
          <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="mono dim" style={{ fontSize: "var(--t-sm)", fontWeight: 600 }}>{p.palNumber}</span>
              {canEdit && (
                <button
                  type="button"
                  className="btn"
                  disabled={!allReady || busy}
                  title={allReady ? "Load these items onto a vehicle" : "All items must be Ready for Loading first"}
                  style={{ marginLeft: "auto", height: 22, padding: "0 8px", fontSize: "var(--t-sm)", display: "inline-flex", alignItems: "center", gap: 4 }}
                  onClick={() => setVehModal({ plan: p, mode: "load" })}
                >
                  <Icon name="truck" size={11} /> Load vehicle
                </button>
              )}
            </div>
            {ready.map((l) => itemCard(p, l))}
          </div>
        )),
      };
    }
    const cards = plans.filter((p) => p.status === col.key);
    return { count: cards.length, node: cards.map((p) => planCard(p)) };
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(220px, 1fr))`, gap: 12, alignItems: "start", overflowX: "auto" }}>
        {COLUMNS.map((col) => {
          const { count, node } = colContent(col);
          const isOver = overCol === col.key;
          // Only highlight columns that accept the current drag.
          const accepts = drag && ((col.level === "line" && drag.kind === "line") || (col.level === "plan" && drag.kind === "plan"));
          return (
            <div
              key={col.key}
              onDragOver={(e) => { if (!canEdit || !accepts) return; e.preventDefault(); setOverCol(col.key); }}
              onDragLeave={() => setOverCol((s) => (s === col.key ? null : s))}
              onDrop={(e) => { e.preventDefault(); onDrop(col); }}
              className="card"
              style={{ padding: 0, background: isOver ? "var(--accent-soft)" : undefined, transition: "background .12s" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
                <span className={`chip palstatus ${col.chip}`}>{col.label}</span>
                <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>{count}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, minHeight: 80 }}>
                {node}
                {count === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "6px 2px" }}>—</div>}
              </div>
            </div>
          );
        })}
      </div>

      {vehModal && (
        <VehicleLoadModal
          palNumber={vehModal.plan.palNumber}
          busy={busy}
          onConfirm={(vehicleId) => void loadVehicle(vehModal.plan, vehicleId)}
          onClose={() => setVehModal(null)}
        />
      )}
    </>
  );
}
