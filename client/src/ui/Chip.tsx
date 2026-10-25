/* Status chip — the one Chip component of the Panel Craft design trial
   (2026-09-04). Tinted pill: text = tone colour, background = the same
   colour at ~9%. Renders nothing when there is no label. CR-378: the tone
   colours live in CSS (`theme.css` .nd-chip.tone-*, overridden per theme
   by glass.css) so dark surfaces can re-tint them — no hex in TSX. */
export type ChipTone = "gray" | "amber" | "sky" | "teal" | "blue" | "violet" | "green" | "slate" | "red";

export function Chip({ tone = "gray", label, title }: { tone?: ChipTone; label?: string | null; title?: string }) {
  if (!label) return null; // no empty/placeholder chips
  const text = label.replace(/([a-z])([A-Z])/g, "$1 $2"); // CamelCase → spaced
  return (
    <span className={`nd-chip tone-${tone}`} title={title}>
      {text}
    </span>
  );
}
