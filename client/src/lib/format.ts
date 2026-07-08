/* Formatting helpers, ported verbatim from prototype/ui.jsx. */

export const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n || 0));

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** Catalyst datetime ("2026-06-29 15:56:48:741") → "2026-06-29 15:56". */
export const fmtDateTime = (s?: string) => (s ? s.slice(0, 16) : "—");

/** Catalyst datetime ("2026-06-29 15:56:48:741", space-separated, millis
    after a colon, no timezone → treat as UTC) rendered in the viewer's
    LOCAL time. Used by activity logs. Falls back to the raw 16-char slice
    if the string can't be parsed. */
export function fmtLocalDateTime(s?: string): string {
  if (!s) return "—";
  // Normalise "YYYY-MM-DD HH:MM:SS:mmm" → ISO "YYYY-MM-DDTHH:MM:SS.mmmZ".
  const iso = s
    .trim()
    .replace(" ", "T")
    .replace(/:(\d{3})$/, ".$1");
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return s.slice(0, 16);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function finishClass(f: string): string {
  const m: Record<string, string> = {
    Glossy: "glossy",
    Matt: "matt",
    Carving: "carving",
    "High Glossy": "hgloss",
    "Hard Matt": "matt",
  };
  return m[f] || "";
}
