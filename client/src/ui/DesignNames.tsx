/** CR-355: the one "Design" summary cell for header-level grids (SO / Quote /
    Panel Order / Panel Loading) — every design on the record, comma-joined, one
    clipped line with the full list on hover (`.clip` rule in styles.css). */
export function DesignNames({ names, max = 260 }: { names: string[]; max?: number }) {
  const text = [...new Set(names.filter(Boolean))].join(", ");
  return <span className="clip" style={{ maxWidth: max }} title={text}>{text || "—"}</span>;
}
