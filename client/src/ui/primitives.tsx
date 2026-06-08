/* Shared UI primitives, ported verbatim from prototype/ui.jsx + views.jsx (KPI).
   Markup unchanged; only typed and exported (no more window globals). */
import { Icon } from "./Icon";
import { stageOf } from "../data";

export function StageBadge({ stage }: { stage: string }) {
  const s = stageOf(stage);
  return (
    <span className={`stage ${s.color}`}>
      <span className={`dot ${s.color}`} />
      {s.short}
    </span>
  );
}

export function ProgressBar({
  value,
  max,
  color = "accent",
  height = 4,
}: {
  value: number;
  max: number;
  color?: string;
  height?: number;
}) {
  const w = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className="bar" style={{ height }}>
      <i style={{ width: `${w}%`, background: color === "accent" ? "var(--accent)" : color }} />
    </div>
  );
}

export function SplitBar({
  produced,
  palletized,
  loaded,
  total,
}: {
  produced: number;
  palletized: number;
  loaded: number;
  total: number;
}) {
  const pctv = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const p1 = pctv(loaded, total); // green
  const p2 = pctv(palletized - loaded, total); // violet
  const p3 = pctv(produced - palletized, total); // blue
  return (
    <div className="bar tall" style={{ background: "var(--panel-2)", position: "relative" }}>
      <i style={{ width: `${p1}%`, background: "var(--c-green)", left: 0 }} />
      <i style={{ width: `${p2}%`, background: "var(--c-violet)", left: `${p1}%` }} />
      <i style={{ width: `${p3}%`, background: "var(--c-blue)", left: `${p1 + p2}%` }} />
    </div>
  );
}

export function Spark({
  points,
  color = "var(--accent)",
  w = 70,
  h = 22,
}: {
  points: number[];
  color?: string;
  w?: number;
  h?: number;
}) {
  const max = Math.max(...points),
    min = Math.min(...points);
  const span = Math.max(1, max - min);
  const pts = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / span) * (h - 3) - 1}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <polyline
        points={pts}
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.95"
      />
    </svg>
  );
}

export function KPI({
  label,
  value,
  unit,
  delta,
  trend,
  spark,
  color = "var(--accent)",
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  trend?: "up" | "down";
  spark: number[];
  color?: string;
}) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">
        {value}
        <span className="unit">{unit}</span>
      </div>
      <div className="delta">
        {trend === "up" && <Icon name="arrow-up" size={11} style={{ color: "var(--c-green)" }} />}
        {trend === "down" && <Icon name="arrow-down" size={11} style={{ color: "var(--c-red)" }} />}
        <span>{delta}</span>
      </div>
      <div className="spark">
        <Spark points={spark} color={color} w={62} h={20} />
      </div>
    </div>
  );
}
