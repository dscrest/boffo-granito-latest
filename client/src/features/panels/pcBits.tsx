/* Panel Craft design-trial helpers (2026-09-04) — toolbar icon button
   and column filter select for the .nd record grids, plus the status →
   chip-tone map. Trial-local; graduates to ui/ if the design goes
   app-wide. */
import { Icon } from "@/ui/Icon";
import type { ChipTone } from "@/ui/Chip";
import type { PanelOrderStatus } from "./panelOrdersApi";

export const ORDER_STATUS_TONE: Record<PanelOrderStatus, ChipTone> = {
  Received: "amber",
  InCutting: "blue",
  Ready: "teal",
  Dispatched: "green",
};

export function IconBtn({
  icon,
  title,
  onClick,
  disabled,
  danger,
  active,
}: {
  icon: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  // Disabled buttons stay rendered and dim (opacity .35) — never hidden.
  return (
    <button
      type="button"
      className={`pc-ibtn${danger ? " danger" : ""}${active ? " active" : ""}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={14} strokeWidth={2} />
    </button>
  );
}

/** Column filter: one <select> fed by the distinct values in the data. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      className={value ? "on" : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={`Filter by ${label.toLowerCase()}`}
    >
      <option value="">All {label}s</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
