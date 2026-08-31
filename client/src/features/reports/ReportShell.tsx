/* ============================================================
   ReportShell — the shared frame every report renders through, so
   each report looks the same: title on top, an export
   action, a filter bar (optional From–To date range + the Books-style
   AdvancedFilter modal), a row of KPI summary tiles, then the report's
   own table. Mirrors the .page-head / .fbar / .kpi-grid / .card idiom
   used across the app (OrdersTable, SettingsHome).
   ============================================================ */
import type { ReactNode } from "react";
import { Icon } from "@/ui/Icon";
import { KPI } from "@/ui/primitives";
import { DateInput } from "@/ui/DateInput";
import { AdvancedFilterButton, type FilterField, type FilterCriteria } from "@/ui/AdvancedFilter";
import { can } from "@/lib/auth";
import { exportCsv } from "@/lib/csv";

export interface KpiSpec {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  color?: string;
}

export interface DateRangeState {
  from: string;
  to: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface CsvSpec<T = any> {
  name: string;
  rows: T[];
  columns: { header: string; value: (r: T) => string | number }[];
}

interface ReportShellProps {
  title: string;
  subtitle?: string;
  kpis?: KpiSpec[];
  /** Show a From–To date range in the filter bar when provided. */
  date?: { value: DateRangeState; onChange: (r: DateRangeState) => void };
  /** Show the advanced-filter modal button when provided. */
  filter?: { title: string; fields: FilterField[]; criteria: FilterCriteria; onChange: (c: FilterCriteria) => void };
  /** Report-specific controls (view toggle, grouping) — sits right of the filter button. */
  bar?: ReactNode;
  csv?: CsvSpec;
  children: ReactNode;
}

export function ReportShell({ title, subtitle, kpis, date, filter, bar, csv, children }: ReportShellProps) {
  const showBar = !!date || !!filter || !!bar;
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">{title}</div>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        {csv && can("reports", "export") && (
          <div className="right">
            <button className="hbtn" title="Export the filtered rows as CSV" onClick={() => exportCsv(csv.name, csv.rows, csv.columns)}>
              <Icon name="docs" size={13} /> Export
            </button>
          </div>
        )}
      </div>

      {showBar && (
        <div className="fbar" style={{ marginBottom: 12 }}>
          {date && (
            <div className="row" style={{ gap: 6, alignItems: "center" }}>
              <DateInput
                value={date.value.from}
                max={date.value.to || undefined}
                onChange={(e) => date.onChange({ ...date.value, from: e.target.value })}
                title="From date"
              />
              <span className="dim">–</span>
              <DateInput
                value={date.value.to}
                min={date.value.from || undefined}
                onChange={(e) => date.onChange({ ...date.value, to: e.target.value })}
                title="To date"
              />
              {(date.value.from || date.value.to) && (
                <button className="btn x" title="Clear dates" onClick={() => date.onChange({ from: "", to: "" })}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          )}
          <div style={{ flex: 1 }} />
          {filter && (
            <AdvancedFilterButton title={filter.title} fields={filter.fields} criteria={filter.criteria} onChange={filter.onChange} />
          )}
          {bar}
        </div>
      )}

      {kpis && kpis.length > 0 && (
        <div className="kpi-grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(160px, 1fr))`, marginBottom: 12 }}>
          {kpis.map((k) => (
            <KPI key={k.label} label={k.label} value={k.value} unit={k.unit} delta={k.delta} color={k.color} />
          ))}
        </div>
      )}

      {children}
    </div>
  );
}

/** Highlighted grand-total footer row. Report supplies the <td>s so alignment
    matches its own columns; the row is visually lifted (bold, elevated bg). */
export function TotalsRow({ children }: { children: ReactNode }) {
  return (
    <tfoot>
      <tr style={{ background: "var(--elevated)", fontWeight: 600, borderTop: "2px solid var(--border-2)" }}>
        {children}
      </tr>
    </tfoot>
  );
}

/** Keep only orders whose orderDate (YYYY-MM-DD) falls within [from, to]. */
export function inDateRange(dateStr: string | undefined, r: DateRangeState): boolean {
  const day = String(dateStr || "").slice(0, 10);
  if (r.from && (!day || day < r.from)) return false;
  if (r.to && (!day || day > r.to)) return false;
  return true;
}
