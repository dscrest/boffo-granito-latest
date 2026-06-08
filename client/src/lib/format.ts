/* Formatting helpers, ported verbatim from prototype/ui.jsx. */

export const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n || 0));

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

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
