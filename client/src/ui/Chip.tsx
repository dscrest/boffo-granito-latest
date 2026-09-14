/* Status chip — the one Chip component of the Panel Craft design trial
   (2026-09-04). Tinted pill: text = tone hex, background = tone + 18
   alpha (~9%). Renders nothing when there is no label. The tone hex map
   is the single place hex is allowed outside CSS. */
export type ChipTone = "gray" | "amber" | "sky" | "teal" | "blue" | "violet" | "green" | "slate" | "red";

const TONE: Record<ChipTone, string> = {
  gray: "#64748b",
  amber: "#b45309",
  sky: "#0369a1",
  teal: "#0d9488",
  blue: "#2563eb",
  violet: "#7c3aed",
  green: "#15803d",
  slate: "#334155",
  red: "#b91c1c",
};

export function Chip({ tone = "gray", label, title }: { tone?: ChipTone; label?: string | null; title?: string }) {
  if (!label) return null; // no empty/placeholder chips
  const text = label.replace(/([a-z])([A-Z])/g, "$1 $2"); // CamelCase → spaced
  const c = TONE[tone];
  return (
    <span className="nd-chip" style={{ color: c, background: c + "18" }} title={title}>
      {text}
    </span>
  );
}
