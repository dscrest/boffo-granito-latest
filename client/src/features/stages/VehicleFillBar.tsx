/* ============================================================
   Vehicle loading bar — shared visualization of how palletised boxes
   spread across trucks/vehicles. Extracted from PalletPackForm so the
   close-pallet form and the Palletization Plan form use ONE implementation.

   Given per-design box lines + a per-vehicle capacity, it auto-derives the
   vehicle count so no vehicle exceeds 100% (a full vehicle spills into the
   next), colours each design distinctly, and lets the operator add empty
   extras. `extra` / `onExtraChange` are controlled by the parent.
   ============================================================ */
import { useMemo } from "react";
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
const DESIGN_PALETTE = [
  "oklch(0.68 0.17 55)", // orange (brand)
  "oklch(0.60 0.13 195)", // teal
  "oklch(0.58 0.15 250)", // blue
  "oklch(0.55 0.16 300)", // purple
  "oklch(0.60 0.18 350)", // magenta
  "oklch(0.60 0.15 150)", // green
  "oklch(0.66 0.13 90)", // gold
  "oklch(0.58 0.18 25)", // rust
];

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
  /** Operator-added empty vehicles beyond the auto-derived count. */
  extra: number;
  onExtraChange: (updater: (n: number) => number) => void;
}) {
  const allocBoxes = lines.reduce((s, l) => s + l.boxes, 0);
  // Vehicle count grows so nothing exceeds one vehicle's capacity; the operator
  // can add empty extras on top. autoVehicles is the trailing-extra threshold.
  const autoVehicles = Math.max(1, Math.ceil(allocBoxes / Math.max(1, truckCapacity)));
  const vehicleCount = autoVehicles + extra;

  // First-fit each line's boxes across the vehicles so the bar can show
  // per-item colour segments. A full vehicle spills into the next, never over.
  const truckLoads = useMemo(() => {
    const cap = vehicleCount * truckCapacity;
    const loads: { label: string; boxes: number; color: string }[][] = Array.from({ length: vehicleCount }, () => []);
    let idx = 0;
    let used = 0;
    const colorByDesign = new Map<string, string>();
    for (const l of lines) {
      let remaining = l.boxes;
      if (!colorByDesign.has(l.designId))
        colorByDesign.set(l.designId, DESIGN_PALETTE[colorByDesign.size % DESIGN_PALETTE.length]);
      const color = colorByDesign.get(l.designId)!;
      while (remaining > 0 && idx < vehicleCount) {
        const space = truckCapacity - loads[idx].reduce((s, seg) => s + seg.boxes, 0);
        const put = Math.min(remaining, space);
        if (put > 0) {
          loads[idx].push({ label: l.label, boxes: put, color });
          used += put;
          remaining -= put;
        }
        if (remaining > 0) idx++;
      }
    }
    return { loads, cap, used };
  }, [lines, vehicleCount, truckCapacity]);

  if (lines.length === 0) return null;

  return (
    <div className="form-section">
      <div className="form-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>Vehicle loading</span>
        <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
          {fmt(truckLoads.used)} / {fmt(truckLoads.cap)} boxes · {vehicleCount} vehicle{vehicleCount > 1 ? "s" : ""}
        </span>
        <button
          type="button"
          className="btn"
          style={{ marginLeft: "auto", padding: "3px 8px" }}
          onClick={() => onExtraChange((n) => n + 1)}
        >
          <Icon name="plus" size={12} /> Add vehicle
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {truckLoads.loads.map((segs, i) => {
          const loaded = segs.reduce((s, seg) => s + seg.boxes, 0);
          const fillPct = truckCapacity > 0 ? Math.round((loaded / truckCapacity) * 100) : 0;
          const fillColor = loaded === truckCapacity ? "var(--c-green)" : "var(--c-amber)";
          // Vehicles beyond the auto-needed count are operator-added extras — removable.
          const removable = i >= autoVehicles;
          const removeVehicle = () => onExtraChange((n) => Math.max(0, n - 1));
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {removable && (
                <button type="button" className="btn x" title="Remove vehicle" onClick={removeVehicle} style={{ padding: 2 }}>
                  <Icon name="x" size={14} />
                </button>
              )}
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
                    title={`${fmt(loaded)} / ${fmt(truckCapacity)} boxes`}
                  >
                    {segs.map((seg, j) => {
                      const pct = loaded > 0 ? Math.round((seg.boxes / loaded) * 100) : 0;
                      const wide = seg.boxes / truckCapacity >= 0.1;
                      return (
                        <div
                          key={j}
                          style={{
                            width: `${(seg.boxes / truckCapacity) * 100}%`,
                            background: seg.color,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                            fontSize: 11,
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
                  <span style={{ fontSize: 13, fontWeight: 700, color: fillColor, minWidth: 44, textAlign: "right" }} title="Vehicle fill vs capacity">
                    {fillPct}%
                  </span>
                </div>
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                  Vehicle {i + 1} · {fmt(loaded)} / {fmt(truckCapacity)} boxes
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
              {removable && (
                <MoreMenu kebab items={[{ label: "Remove vehicle", danger: true, onClick: removeVehicle }]} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
