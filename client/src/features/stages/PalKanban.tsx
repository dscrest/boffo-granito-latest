/* ============================================================
   Palletization board — TWO-LEVEL. The first two columns are PER ITEM
   (a PalletizationPlanLine): drag one item card between "In Palletization"
   and "Ready for Loading" and only that item moves (setPalLineStatus). The
   last two columns are PER LOAD BOX (a LoadBox — a vehicle slot): drag a
   Ready item onto "In Loading" (or a specific box) to load it — the open box
   is reused or auto-created (setLineBox). Dispatch asks for the vehicle if
   none is set, then dispatches the box as one unit (dispatchLoadBox — the
   server auto-completes fully-dispatched plans).
   "Ready for Loading" shows only UNLOADED ready items (remaining-to-load).
   Legacy plans that reached Loading/Dispatched before boxes existed still
   render as plan cards. Hand-rolled HTML5 drag-and-drop like Production.
   ============================================================ */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { fmt } from "@/lib/format";
import { isoInfo } from "@/features/masters/customersApi";
import { VehicleLoadModal } from "./VehicleLoadModal";
import { DESIGN_PALETTE } from "./VehicleFillBar";
import {
  createLoadBox,
  dispatchLoadBox,
  invalidatePalPlans,
  PAL_LINE_TRANSITIONS,
  PAL_TRANSITIONS,
  setLineBox,
  setPalLineStatus,
  setPalStatus,
  setPalVehicle,
  updateLoadBox,
  type LoadBox,
  type PalPlan,
  type PalPlanLine,
  type PalLineStatus,
  type PalStatus,
} from "./palPlansApi";

// Board columns. Line columns advance one item; box columns hold vehicle slots.
const COLUMNS = [
  { key: "Planning", label: "In Palletization", chip: "p-planning", level: "line" },
  { key: "ReadyToLoad", label: "Ready for Loading", chip: "p-ready", level: "line" },
  { key: "Loading", label: "In Loading", chip: "p-loading", level: "box" },
  { key: "Completed", label: "Dispatched", chip: "p-completed", level: "box" },
] as const;

type Drag = { kind: "line" | "plan"; id: string; from: string } | null;

export function PalKanban({
  plans,
  boxes,
  canEdit,
  onChanged,
}: {
  plans: PalPlan[];
  boxes: LoadBox[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [drag, setDrag] = useState<Drag>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [overBox, setOverBox] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Vehicle modal target: a load box (dispatch=true chains dispatch after the
  // vehicle is saved), or a legacy plan (pre-box Loading flow).
  const [vehModal, setVehModal] = useState<{ box?: LoadBox; plan?: PalPlan; dispatch?: boolean } | null>(null);

  const allLines = plans.flatMap((p) => p.lines.map((l) => ({ p, l })));
  const linesOfBox = (boxId: string) => allLines.filter(({ l }) => l.loadBoxId === boxId);

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

  const loadIntoBox = async (line: PalPlanLine, box: LoadBox) => {
    setBusy(true);
    const res = await setLineBox(line.id, box.id);
    setBusy(false);
    after(res.ok, res.error || "Could not load the item", `${line.itemCode} → Box ${box.boxNumber}`);
  };

  const unload = async (line: PalPlanLine, box: LoadBox) => {
    setBusy(true);
    const res = await setLineBox(line.id, "");
    setBusy(false);
    after(res.ok, res.error || "Could not unload the item", `${line.itemCode} back to Ready for Loading (Box ${box.boxNumber})`);
  };

  // Drop on the column background: reuse the open box, or auto-create one.
  const dropIntoLoading = async (line: PalPlanLine) => {
    setBusy(true);
    const open = boxes.find((b) => b.status === "Open");
    let boxId = open?.id;
    let boxNo = open?.boxNumber;
    if (!boxId) {
      const created = await createLoadBox();
      if (!created.ok || !created.data?.ROWID) {
        setBusy(false);
        after(false, created.error || "Could not add a box", "");
        return;
      }
      boxId = String(created.data.ROWID);
      boxNo = created.data.box_number;
    }
    const res = await setLineBox(line.id, boxId);
    setBusy(false);
    after(res.ok, res.error || "Could not load the item", `${line.itemCode} → Box ${boxNo ?? ""}`.trim());
  };

  const dispatchBox = async (box: LoadBox) => {
    setBusy(true);
    const res = await dispatchLoadBox(box.id);
    setBusy(false);
    after(res.ok, res.error || "Could not dispatch", `${box.vehicleNumber || `Box ${box.boxNumber}`} dispatched`);
  };

  const assignVehicle = async (vehicleId: string) => {
    const t = vehModal;
    setVehModal(null);
    if (!t) return;
    setBusy(true);
    const res = t.box
      ? await updateLoadBox(t.box.id, { vehicle: vehicleId })
      : t.plan
        ? await (async () => {
            // Legacy plan path: advance to Loading first if needed, then attach.
            const step = t.plan!.status === "Loading" ? ({ ok: true } as const) : await setPalStatus(t.plan!.id, "Loading");
            return step.ok ? await setPalVehicle(t.plan!.id, vehicleId) : step;
          })()
        : ({ ok: false, error: "Nothing selected" } as const);
    setBusy(false);
    if (t.box && t.dispatch) {
      if (!res.ok) { after(false, ("error" in res && res.error) || "Could not assign vehicle", ""); return; }
      await dispatchBox(t.box);
      return;
    }
    after(res.ok, ("error" in res && res.error) || "Could not assign vehicle", "Vehicle assigned");
  };

  // ponytail: box capacity stays at the server default (1000); expose an edit
  // control via updateLoadBox(...{capacity}) if real vehicles need tuning.

  const onDropColumn = (col: (typeof COLUMNS)[number]) => {
    const d = drag;
    setDrag(null);
    setOverCol(null);
    setOverBox(null);
    if (!d) return;
    if (col.key === "Loading" && d.kind === "line") {
      if (busy) return; // in-flight guard: a double-drop must not create two boxes
      const hit = allLines.find(({ l }) => l.id === d.id);
      if (!hit || hit.l.status !== "ReadyToLoad" || hit.l.loadBoxId) return;
      void dropIntoLoading(hit.l);
      return;
    }
    if (col.level === "line" && d.kind === "line") {
      const to = col.key as PalLineStatus;
      if (d.from === to || !(PAL_LINE_TRANSITIONS[d.from as PalLineStatus] || []).includes(to)) return;
      const line = allLines.find(({ l }) => l.id === d.id)?.l;
      if (line?.loadBoxId) return; // loaded items leave via the box, not a drag back
      void moveLine(d.id, to, line?.itemCode || "Item");
    } else if (col.level === "box" && d.kind === "plan") {
      // Legacy plan card drag (pre-box plans only).
      const to = col.key as PalStatus;
      if (d.from === to || !(PAL_TRANSITIONS[d.from as PalStatus] || []).includes(to)) return;
      const plan = plans.find((p) => p.id === d.id);
      if (!plan) return;
      if (to === "Completed" && !plan.vehicleId) { toast.error("Assign a vehicle before dispatch"); return; }
      void movePlan(plan, to);
    }
  };

  const onDropBox = (box: LoadBox) => {
    const d = drag;
    setDrag(null);
    setOverCol(null);
    setOverBox(null);
    if (!d || d.kind !== "line" || box.status !== "Open") return;
    const hit = allLines.find(({ l }) => l.id === d.id);
    if (!hit || hit.l.status !== "ReadyToLoad" || hit.l.loadBoxId) return;
    void loadIntoBox(hit.l, box);
  };

  // Item card (a plan line) for the two line columns.
  const itemCard = (p: PalPlan, l: PalPlanLine) => (
    <div
      key={l.id}
      draggable={canEdit}
      onDragStart={() => canEdit && setDrag({ kind: "line", id: l.id, from: l.status })}
      onDragEnd={() => { setDrag(null); setOverCol(null); setOverBox(null); }}
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
        {[l.customerName, l.sizeCode].filter(Boolean).join("  ·  ") || "—"}
      </div>
      <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {[l.soNumber, l.palletName].filter((s) => s && s !== "—").join("  ·  ") || "—"}
      </div>
      <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>{p.palNumber}</div>
    </div>
  );

  // Legacy plan (vehicle) card — plans that reached Loading/Dispatched pre-boxes.
  const planCard = (p: PalPlan) => (
    <div
      key={p.id}
      draggable={canEdit && p.status !== "Completed"}
      onDragStart={() => canEdit && setDrag({ kind: "plan", id: p.id, from: p.status })}
      onDragEnd={() => { setDrag(null); setOverCol(null); setOverBox(null); }}
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
            onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); setVehModal({ plan: p }); }}
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

  // Load-box (vehicle slot) card for the two box columns.
  const boxCard = (box: LoadBox) => {
    const inBox = linesOfBox(box.id);
    const loaded = inBox.reduce((s, { l }) => s + l.boxes, 0);
    const pct = Math.min(100, Math.round((loaded / Math.max(1, box.capacity)) * 100));
    const full = loaded >= box.capacity;
    const open = box.status === "Open";
    // Stable colour per design (first-seen), same rule as VehicleFillBar.
    const colorByDesign = new Map<string, string>();
    inBox.forEach(({ l }) => {
      if (!colorByDesign.has(l.designId)) colorByDesign.set(l.designId, DESIGN_PALETTE[colorByDesign.size % DESIGN_PALETTE.length]);
    });
    // Export countries — distinct, from the customers of the loaded lines.
    const countries = [...new Set(inBox.map(({ l }) => l.countryCode).filter(Boolean))].map(isoInfo);
    const isTarget = open && drag?.kind === "line";
    return (
      <div
        key={box.id}
        onDragOver={(e) => { if (!canEdit || !isTarget) return; e.preventDefault(); e.stopPropagation(); setOverBox(box.id); }}
        onDragLeave={() => setOverBox((s) => (s === box.id ? null : s))}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropBox(box); }}
        style={{
          border: `1px ${isTarget ? "dashed var(--accent)" : "solid var(--border)"} `,
          borderRadius: 8, padding: 10, background: overBox === box.id ? "var(--accent-soft)" : "var(--bg)",
          transition: "background .12s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="truck" size={14} />
          <span className="mono" style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {box.vehicleNumber || `Box ${box.boxNumber}`}
          </span>
          <span className="chip" style={{ marginLeft: "auto", fontSize: 11 }}>{fmt(loaded)} / {fmt(box.capacity)} box</span>
        </div>

        {/* Fill bar — completion indicator, coloured by design like VehicleFillBar. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <div
            style={{ flex: 1, display: "flex", height: 12, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border)", background: "var(--panel-2)" }}
            title={`${fmt(loaded)} / ${fmt(box.capacity)} boxes`}
          >
            {inBox.map(({ l }) => (
              <div key={l.id} style={{ width: `${(l.boxes / Math.max(1, box.capacity)) * 100}%`, background: colorByDesign.get(l.designId) }} title={`${l.designLabel}: ${fmt(l.boxes)} boxes`} />
            ))}
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: full ? "var(--c-green)" : "var(--c-amber)", minWidth: 34, textAlign: "right" }} title="Box fill vs capacity">
            {pct}%
          </span>
        </div>

        {/* Export countries (from the loaded customers). */}
        {countries.length > 0 && (
          <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 6, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
            {countries.map((c) => (
              <span key={c.country}>{c.flag} {c.country}</span>
            ))}
          </div>
        )}

        {/* Loaded items. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: inBox.length ? 8 : 0 }}>
          {inBox.map(({ p, l }) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--t-sm)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: colorByDesign.get(l.designId), flex: "0 0 auto" }} />
              <button
                type="button"
                className="linkish"
                style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                onClick={() => navigate(`/packing/${p.id}`)}
                title={`Open ${p.palNumber}`}
              >
                <span className="mono">{l.itemCode}</span> · {l.designLabel}
              </button>
              <span className="dim mono" style={{ marginLeft: "auto", flex: "0 0 auto" }}>{fmt(l.boxes)}</span>
              {canEdit && open && (
                <button type="button" className="btn x" title="Back to Ready for Loading" style={{ padding: 1, height: 16, width: 16, display: "inline-flex", alignItems: "center", justifyContent: "center" }} onClick={() => void unload(l, box)}>
                  <Icon name="x" size={10} />
                </button>
              )}
            </div>
          ))}
          {open && inBox.length === 0 && (
            <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "6px 0", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 6, marginTop: 8 }}>
              Drag Ready items here
            </div>
          )}
        </div>

        {/* Vehicle / dispatch. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          {open ? (
            <>
              <span className="dim" style={{ fontSize: "var(--t-sm)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {box.vehicleNumber ? [box.vehicleNumber, box.driverName].filter(Boolean).join("  ·  ") : "No vehicle yet"}
              </span>
              {canEdit && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy || inBox.length === 0}
                  title={inBox.length === 0 ? "Load at least one item" : "Dispatch this vehicle"}
                  style={{ marginLeft: "auto", height: 22, padding: "0 8px", fontSize: "var(--t-sm)", display: "inline-flex", alignItems: "center", gap: 4, flex: "0 0 auto" }}
                  onClick={() => (box.vehicleId ? void dispatchBox(box) : setVehModal({ box, dispatch: true }))}
                >
                  <Icon name="check" size={11} /> Dispatch
                </button>
              )}
            </>
          ) : (
            <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
              {[box.driverName, box.mobileNumber, box.dispatchDate].filter(Boolean).join("  ·  ")}
            </span>
          )}
        </div>
      </div>
    );
  };

  // Column contents by level.
  const colContent = (col: (typeof COLUMNS)[number]) => {
    if (col.level === "line") {
      const status = col.key as PalLineStatus;
      if (status === "Planning") {
        // A partially-boxed plan is already "Loading" — its unpalletised items still belong here.
        const cards = plans
          .filter((p) => p.status !== "Completed")
          .flatMap((p) => p.lines.filter((l) => l.status === "Planning").map((l) => ({ p, l })));
        return { count: cards.length, node: cards.map(({ p, l }) => itemCard(p, l)) };
      }
      // Ready for Loading = palletized MINUS loaded: only unallocated ready lines.
      const groups = plans
        .map((p) => ({ p, ready: p.lines.filter((l) => l.status === "ReadyToLoad" && !l.loadBoxId) }))
        .filter((g) => g.ready.length > 0 && g.p.status !== "Completed");
      const count = groups.reduce((s, g) => s + g.ready.length, 0);
      return {
        count,
        node: groups.map(({ p, ready }) => (
          <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="mono dim" style={{ fontSize: "var(--t-sm)", fontWeight: 600 }}>{p.palNumber}</div>
            {ready.map((l) => itemCard(p, l))}
          </div>
        )),
      };
    }
    // Box columns: Open boxes under "In Loading", Dispatched under "Dispatched";
    // legacy plans (no boxed lines) keep their old plan cards alongside.
    const boxCards = boxes.filter((b) => (col.key === "Loading" ? b.status === "Open" : b.status === "Dispatched"));
    const legacy = plans.filter((p) => p.status === col.key && !p.lines.some((l) => l.loadBoxId));
    return {
      count: boxCards.length + legacy.length,
      node: [...boxCards.map((b) => boxCard(b)), ...legacy.map((p) => planCard(p))],
    };
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(220px, 1fr))`, gap: 12, alignItems: "start", overflowX: "auto" }}>
        {COLUMNS.map((col) => {
          const { count, node } = colContent(col);
          const isOver = overCol === col.key && !overBox;
          // Line drags land on line columns (status move), on a box card, or on
          // the Loading column itself (open box reused or auto-created); legacy
          // plan drags land on box columns.
          const accepts =
            drag &&
            ((col.level === "line" && drag.kind === "line") ||
              (col.level === "box" && drag.kind === "plan") ||
              (col.key === "Loading" && drag.kind === "line"));
          return (
            <div
              key={col.key}
              onDragOver={(e) => { if (!canEdit || !accepts) return; e.preventDefault(); setOverCol(col.key); }}
              onDragLeave={() => setOverCol((s) => (s === col.key ? null : s))}
              onDrop={(e) => { e.preventDefault(); onDropColumn(col); }}
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
          palNumber={vehModal.box ? `Box ${vehModal.box.boxNumber}` : vehModal.plan?.palNumber || ""}
          busy={busy}
          onConfirm={(vehicleId) => void assignVehicle(vehicleId)}
          onClose={() => setVehModal(null)}
        />
      )}
    </>
  );
}
