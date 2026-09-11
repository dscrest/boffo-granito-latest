/* House-skinned recharts wrappers. Mark styling (rounded pill bars, soft area)
   adapted from Monocharts (github.com/Subhan-code/Monocharts); shells and
   colors are ours — CSS tokens, no Tailwind. */
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
} from "recharts";
import { fmt } from "@/lib/format";

/* recharts writes fills as SVG attributes, where var() is invalid — resolve
   tokens to their oklch/hex values once per render instead. */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function ChartTip({ active, label, rows }: { active?: boolean; label?: string; rows: [string, string][] }) {
  if (!active || rows.length === 0) return null;
  return (
    <div
      style={{
        background: "var(--panel-2, #fff)",
        border: "1px solid var(--border-2)",
        borderRadius: 9,
        padding: "6px 10px",
        fontSize: "var(--t-sm)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
      }}
    >
      {label && <div style={{ color: "var(--fg)", fontWeight: 600, marginBottom: 2 }}>{label}</div>}
      {rows.map(([k, v]) => (
        <div key={k} style={{ color: "var(--muted)" }}>
          {k}: <span className="mono" style={{ color: "var(--fg-2)" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export interface StageBarDatum {
  label: string;
  value: number;
  /** house token suffix, e.g. "blue" → var(--c-blue) */
  color: string;
  count?: number;
}

/** Horizontal rounded ("pill") bars, one per pipeline stage. Identity is
    carried by the axis label; the stage color is a redundant house cue. */
export function StageBarChart({ data, height = 220 }: { data: StageBarDatum[]; height?: number }) {
  if (data.every((d) => d.value === 0)) {
    return <div className="muted" style={{ textAlign: "center", padding: 18 }}>No boxes in the pipeline.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={92}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 13, fill: "var(--fg-2)" }}
        />
        <Tooltip
          cursor={{ fill: "var(--hover, rgba(0,0,0,0.04))" }}
          content={({ active, payload }) => {
            const d = payload?.[0]?.payload as StageBarDatum | undefined;
            return (
              <ChartTip
                active={active && !!d}
                label={d?.label}
                rows={d ? [["Boxes", fmt(d.value)], ...(d.count != null ? [["Orders", fmt(d.count)] as [string, string]] : [])] : []}
              />
            );
          }}
        />
        <Bar dataKey="value" barSize={14} radius={7} background={{ fill: "var(--border)", radius: 7 } as never}>
          {data.map((d) => (
            <Cell key={d.label} fill={cssVar(`--c-${d.color}`, "#695d50")} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v) => fmt(Number(v) || 0)}
            style={{ fill: "var(--muted)", fontSize: 12, fontFamily: "inherit" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface TrendPoint {
  label: string;
  value: number;
}

/** Single-series rounded area chart (order intake over time), accent-colored. */
export function TrendChart({ data, unit = "boxes", height = 220 }: { data: TrendPoint[]; unit?: string; height?: number }) {
  if (data.every((d) => d.value === 0)) {
    return <div className="muted" style={{ textAlign: "center", padding: 18 }}>No orders in this period.</div>;
  }
  const accent = cssVar("--accent-ink", "#b95c0d");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.22} />
            <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11.5, fill: "var(--muted)" }}
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis hide domain={[0, "auto"]} />
        <Tooltip
          cursor={{ stroke: "var(--border-2)", strokeDasharray: "3 3" }}
          content={({ active, payload, label }) => (
            <ChartTip
              active={active}
              label={String(label ?? "")}
              rows={payload?.length ? [[unit, fmt(payload[0].value as number)]] : []}
            />
          )}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={accent}
          strokeWidth={2}
          strokeLinecap="round"
          fill="url(#trendFill)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--panel-2, #fff)" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
