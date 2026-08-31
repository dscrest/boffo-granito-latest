/* Date bucketing for the matrix reports' column axis. Pure and dependency-free
   so it carries its own self-check (bucket.check.ts). */

export type Bucket = "day" | "week" | "month";

export const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** YYYY-MM-DD → a sortable bucket key ("" for a missing/malformed date).
    Week buckets key on the Monday, computed in UTC so a local timezone west of
    Greenwich can't shift the day back. */
export function bucketOf(iso: string, b: Bucket): string {
  const day = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  if (b === "month") return day.slice(0, 7);
  if (b === "day") return day;
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // getUTCDay: 0 = Sunday
  return d.toISOString().slice(0, 10);
}

/** Human label for a bucket key produced by bucketOf. */
export function bucketLabel(key: string, b: Bucket): string {
  if (!key) return "—";
  if (b === "month") {
    const [y, m] = key.split("-");
    return `${MONTHS[Number(m) - 1] || m} ${y}`;
  }
  const [, m, d] = key.split("-");
  const short = `${d} ${MONTHS[Number(m) - 1] || m}`;
  return b === "week" ? `w/c ${short}` : short;
}
