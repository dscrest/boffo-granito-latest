/* Panel Craft design-trial helpers (2026-09-04) — toolbar icon button
   and column filter select for the .nd record grids, plus the status →
   chip-tone map. Trial-local; graduates to ui/ if the design goes
   app-wide. */
import { Icon } from "@/ui/Icon";
import type { ChipTone } from "@/ui/Chip";
import { designImageUrl } from "@/lib/api";
import type { PanelOrderStatus } from "./panelOrdersApi";
import type { PanelRow } from "./panelsApi";

export const ORDER_STATUS_TONE: Record<PanelOrderStatus, ChipTone> = {
  NewRequest: "slate",
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

/** E-commerce tile (CR-192) — the showcase image IS the panel's identity for a
    rep. Shared by the New Panel Order picker (multi-select) and the /panels
    Photo view (CR-279). Styles: `.panel-card` in styles.css. */
export function PanelTile({
  panel: p,
  selected,
  onClick,
  title,
}: {
  panel: PanelRow;
  selected?: boolean;
  onClick: () => void;
  title?: string;
}) {
  const designs = p.lines.map((l) => l.designName).join(", ");
  const meta =
    [
      p.panelSize && `Panel: ${p.panelSize}`,
      p.vinylSize && `Vinyl: ${p.vinylSize}`,
      p.lines.length && `${p.lines.length} design${p.lines.length > 1 ? "s" : ""}`,
    ]
      .filter(Boolean)
      .join("  ·  ") || "No details yet";
  return (
    <button
      type="button"
      className={`panel-card${selected ? " sel" : ""}`}
      aria-pressed={selected === undefined ? undefined : selected}
      onClick={onClick}
      title={title ?? p.panelCode}
    >
      {p.images[0] ? (
        <img className="img" src={designImageUrl(p.images[0].id)} alt={p.panelCode} loading="lazy" />
      ) : (
        <div className="img none">No image</div>
      )}
      <div className="code">
        {selected && <Icon name="check" size={12} />} {p.panelCode}
      </div>
      <div className="meta" title={meta}>{meta}</div>
      {designs && (
        <div className="meta" title={designs}>
          {designs}
        </div>
      )}
    </button>
  );
}
