/* Small date helpers for form defaults. All return/accept the HTML
   date-input format "yyyy-MM-dd". */

/** Today as "yyyy-MM-dd" (local time). */
export function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

/** Add `days` to a "yyyy-MM-dd" string (or today when blank) → "yyyy-MM-dd". */
export function addDays(fromISO: string, days: number): string {
  const base = fromISO ? new Date(`${fromISO}T00:00:00`) : new Date();
  base.setDate(base.getDate() + days);
  const off = base.getTimezoneOffset();
  return new Date(base.getTime() - off * 60_000).toISOString().slice(0, 10);
}
