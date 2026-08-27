/* ============================================================
   Vehicle loading bar — shared visualization of how palletised boxes
   spread across trucks/vehicles. Extracted from PalletPackForm so the
   close-pallet form and the Palletization Plan form use ONE implementation.

   Given per-design box lines + a per-vehicle capacity, it auto-derives the
   vehicle count so no vehicle exceeds 100% (a full vehicle spills into the
   next) and colours each design distinctly. The operator can then override
   the auto plan: clear a vehicle, remove one, or re-assign the freed boxes
   to another vehicle. Freed boxes sit in an "Unassigned" pool until placed —
   nothing is ever forced over 100%. The allocation is advisory (display only);
   callers persist item lines, not the per-vehicle split.

   2026-07-28: PalPlanDetail dropped its advisory card ("remove the vehicle
   part for now") — the component currently has no callers; DESIGN_PALETTE
   below is still shared by the board's box cards and LoadContainerModal.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { fmt } from "@/lib/format";
import { MoreMenu } from "@/features/common/DetailBits";

export interface VehicleLine {
  designId: string;
  label: string;
  boxes: number;
}

// Distinct, on-theme colours assigned by first-seen design so N designs get N
// visibly-different segments (a hash can collide two designs). Brand orange
// leads so a single-item load reads as "the app colour". Cycles past 8.
// Exported: the Dispatch board's box cards colour their fill bars the same way.
export const DESIGN_PALETTE = [
  "oklch(0.68 0.17 55)", // orange (brand)
  "oklch(0.60 0.13 195)", // teal
  "oklch(0.58 0.15 250)", // blue
  "oklch(0.55 0.16 300)", // purple
  "oklch(0.60 0.18 350)", // magenta
  "oklch(0.60 0.15 150)", // green
  "oklch(0.66 0.13 90)", // gold
  "oklch(0.58 0.18 25)", // rust
];

type Seg = { designId: string; label: string; boxes: number; color: string };
const loadOf = (segs: Seg[]) => segs.reduce((s, x) => s + x.boxes, 0);
const clone = (slots: Seg[][]) => slots.map((s) => s.map((x) => ({ ...x })));

export function VehicleFillBar({
  lines,
  truckCapacity,
  extra,
  onExtraChange,
}: {
  /** Palletised box lines (one per order item), coloured by design. */
  lines: VehicleLine[];
  /** Boxes one vehicle holds (advisory; ≈ one container of the chosen pallets). */
  truckCapacity: number;
  /** Operator-added empty vehicles beyond the auto-derived count (auto mode only). */
  extra: number;
  onExtraChange: (updater: (n: number) => number) => void;
}) {
  const cap = Math.max(1, truckCapacity);
  const allocBoxes = lines.reduce((s, l) => s + l.boxes, 0);
  // Vehicle count grows so nothing exceeds one vehicle's capacity; the operator
  // can add empty extras on top.
  const autoVehicles = Math.max(1, Math.ceil(allocBoxes / cap));
  const autoCount = autoVehicles + extra;

  // Stable colour per design across auto + manual views.
  const colorByDesign = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lines) if (!m.has(l.designId)) m.set(l.designId, DESIGN_PALETTE[m.size % DESIGN_PALETTE.length]);
    return m;
  }, [lines]);

  // Auto first-fit: split each line across vehicles, spilling to the next.
  const auto = useMemo(() => {
    const slots: Seg[][] = Array.from({ length: autoCount }, () => []);
    let idx = 0;
    for (const l of lines) {
      let rem = l.boxes;
      const color = colorByDesign.get(l.designId)!;
      while (rem > 0 && idx < autoCount) {
        const space = cap - loadOf(slots[idx]);
        const put = Math.min(rem, space);
        if (put > 0) {
          slots[idx].push({ designId: l.designId, label: l.label, boxes: put, color });
          rem -= put;
        }
        if (rem > 0) idx++;
      }
    }
    return slots;
  }, [lines, autoCount, cap, colorByDesign]);

  // Manual override (null = follow auto). Reset whenever the inputs change
  // materially (box qty / capacity edited above) so it never goes stale.
  const [manual, setManual] = useState<{ slots: Seg[][]; unassigned: Seg[] } | null>(null);
  const sig = useMemo(() => lines.map((l) => `${l.designId}:${l.boxes}`).join("|") + `#${cap}`, [lines, cap]);
  const lastSig = useRef(sig);
  useEffect(() => {
    if (lastSig.current !== sig) {
      lastSig.current = sig;
      setManual(null);
    }
  }, [sig]);

  const slots = manual ? manual.slots : auto;
  const unassigned = manual ? manual.unassigned : [];
  const vehicleCount = slots.length;
  const usedBoxes = slots.reduce((s, seg) => s + loadOf(seg), 0);
  const unassignedBoxes = loadOf(unassigned);
  const totalCap = vehicleCount * cap;

  // Snapshot the current auto plan into editable manual state on first edit.
  const base = () => manual ?? { slots: clone(auto), unassigned: [] as Seg[] };

  const clearVehicle = (i: number) => {
    const b = base();
    setManual({ slots: b.slots.map((s, k) => (k === i ? [] : s)), unassigned: [...b.unassigned, ...b.slots[i]] });
  };
  const removeVehicle = (i: number) => {
    const b = base();
    setManual({ slots: b.slots.filter((_, k) => k !== i), unassigned: [...b.unassigned, ...b.slots[i]] });
  };
  const addVehicle = () => {
    if (manual) setManual({ ...manual, slots: [...manual.slots, []] });
    else onExtraChange((n) => n + 1);
  };
  // Place an unassigned segment onto a vehicle, up to its free space (splits the
  // remainder back into the pool); merges into an existing same-design segment.
  const place = (b: { slots: Seg[][]; unassigned: Seg[] }, segIdx: number, vehI: number) => {
    const seg = b.unassigned[segIdx];
    const free = cap - loadOf(b.slots[vehI]);
    if (!seg || free <= 0) return b;
    const put = Math.min(seg.boxes, free);
    const slots = b.slots.map((s, k) => {
      if (k !== vehI) return s;
      const ex = s.find((x) => x.designId === seg.designId && x.label === seg.label);
      return ex ? s.map((x) => (x === ex ? { ...x, boxes: x.boxes + put } : x)) : [...s, { ...seg, boxes: put }];
    });
    const rest = seg.boxes - put;
    const unassigned = b.unassigned.flatMap((u, k) => (k === segIdx ? (rest > 0 ? [{ ...u, boxes: rest }] : []) : [u]));
    return { slots, unassigned };
  };
  const assign = (segIdx: number, vehI: number) => setManual(place(base(), segIdx, vehI));
  const assignNew = (segIdx: number) => {
    const b = base();
    setManual(place({ slots: [...b.slots, []], unassigned: b.unassigned }, segIdx, b.slots.length));
  };

  if (lines.length === 0) return null;

  return (
    <div className="form-section">
      <div className="form-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>Vehicle loading</span>
        <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>
          {fmt(usedBoxes)} / {fmt(totalCap)} boxes · {vehicleCount} vehicle{vehicleCount === 1 ? "" : "s"}
          {unassignedBoxes > 0 && <span style={{ color: "var(--c-red)" }}> · {fmt(unassignedBoxes)} not loaded</span>}
        </span>
        {manual && (
          <button type="button" className="btn" style={{ marginLeft: "auto", padding: "3px 8px" }} onClick={() => setManual(null)}>
            Reset to auto
          </button>
        )}
        <button
          type="button"
          className="btn"
          style={{ marginLeft: manual ? undefined : "auto", padding: "3px 8px" }}
          onClick={addVehicle}
        >
          <Icon name="plus" size={12} /> Add vehicle
        </button>
      </div>

      {unassignedBoxes > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "6px 12px",
            padding: "8px 10px",
            marginBottom: 10,
            borderRadius: 6,
            background: "var(--panel-2)",
          }}
        >
          <span style={{ fontSize: "var(--t-sm)", fontWeight: 600, color: "var(--c-red)" }}>
            {fmt(unassignedBoxes)} boxes not loaded — assign:
          </span>
          {unassigned.map((seg, k) => {
            const targets = slots
              .map((s, vi) => ({ vi, free: cap - loadOf(s) }))
              .filter((t) => t.free > 0)
              .map((t) => ({ label: `Vehicle ${t.vi + 1} · ${fmt(t.free)} free`, onClick: () => assign(k, t.vi) }));
            return (
              <span key={k} className="dim" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--t-sm)" }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: seg.color, flex: "0 0 auto" }} />
                {seg.label} · {fmt(seg.boxes)} boxes
                <MoreMenu kebab items={[...targets, { label: "New vehicle", onClick: () => assignNew(k) }]} />
              </span>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {slots.map((segs, i) => {
          const loaded = loadOf(segs);
          const fillPct = Math.round((loaded / cap) * 100);
          const fillColor = loaded === cap ? "var(--c-green)" : "var(--c-amber)";
          const menu: { label: string; danger?: boolean; onClick: () => void }[] = [];
          if (loaded > 0) menu.push({ label: "Clear items", onClick: () => clearVehicle(i) });
          menu.push({ label: "Remove vehicle", danger: true, onClick: () => removeVehicle(i) });
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button type="button" className="btn x" title="Remove vehicle" onClick={() => removeVehicle(i)} style={{ padding: 2 }}>
                <Icon name="x" size={14} />
              </button>
              <Icon name="truck" size={20} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      height: 18,
                      borderRadius: 5,
                      overflow: "hidden",
                      border: "1px solid var(--border)",
                      background: "var(--panel-2)",
                    }}
                    title={`${fmt(loaded)} / ${fmt(cap)} boxes`}
                  >
                    {segs.map((seg, j) => {
                      const pct = loaded > 0 ? Math.round((seg.boxes / loaded) * 100) : 0;
                      const wide = seg.boxes / cap >= 0.1;
                      return (
                        <div
                          key={j}
                          style={{
                            width: `${(seg.boxes / cap) * 100}%`,
                            background: seg.color,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                            fontSize: 13,
                            fontWeight: 600,
                            textShadow: "0 1px 1px rgba(0,0,0,0.35)",
                            overflow: "hidden",
                          }}
                          title={`${seg.label}: ${fmt(seg.boxes)} boxes · ${pct}%`}
                        >
                          {wide ? `${pct}%` : ""}
                        </div>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: fillColor, minWidth: 44, textAlign: "right" }} title="Vehicle fill vs capacity">
                    {fillPct}%
                  </span>
                </div>
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                  Vehicle {i + 1} · {fmt(loaded)} / {fmt(cap)} boxes
                </div>
                {segs.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 4 }}>
                    {segs.map((seg, j) => {
                      const pct = loaded > 0 ? Math.round((seg.boxes / loaded) * 100) : 0;
                      return (
                        <span key={j} className="dim" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--t-sm)" }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: seg.color, flex: "0 0 auto" }} />
                          {seg.label} · {fmt(seg.boxes)} boxes · {pct}%
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <MoreMenu kebab items={menu} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
