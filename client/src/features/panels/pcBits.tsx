/* Panel Craft design-trial helpers (2026-09-04) — toolbar icon button
   and column filter select for the .nd record grids, plus the status →
   chip-tone map. Trial-local; graduates to ui/ if the design goes
   app-wide. */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import type { ChipTone } from "@/ui/Chip";
import { designImageUrl } from "@/lib/api";
import { ImageLightbox } from "@/features/common/ImageLightbox";
import type { DesignImage } from "@/features/masters/designsApi";
import type { LoadingStatus, PanelOrderStatus, PanelProgress } from "./panelOrdersApi";
import type { SampleOrderStatus } from "./sampleOrderStatus";
import type { PanelRow } from "./panelsApi";

export const ORDER_STATUS_TONE: Record<PanelOrderStatus, ChipTone> = {
  NewRequest: "slate",
  Received: "slate", // CR-400: the open stages all read "New"
  InCutting: "slate",
  Ready: "teal",
  Dispatched: "green",
  Cancelled: "red", // CR-368
};

/** CR-315: sample order status → chip tone. */
export const SAMPLE_STATUS_TONE: Record<SampleOrderStatus, ChipTone> = {
  New: "slate",
  PartiallySupplied: "amber",
  Supplied: "green",
  Cancelled: "red", // CR-368
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
  // CR-321: an applied filter shows a clear × (house .combo-clear skin) beside the chevron.
  return (
    <span className="fsel">
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
      {value && (
        <button type="button" className="combo-clear" title={`Clear ${label.toLowerCase()} filter`} aria-label={`Clear ${label.toLowerCase()} filter`} onClick={() => onChange("")}>
          ×
        </button>
      )}
    </span>
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

/** CR-398: the ⓘ cell on an order line (Panel / Sample order forms) — hover = the record's
    details (native title), click = its photos in the lightbox. The photo left the row: the
    rep already picked by photo in the showcase picker; here it only broke column alignment. */
export function InfoDot({ title, images, alt }: { title: string; images: DesignImage[]; alt: string }) {
  const [viewer, setViewer] = useState<number | null>(null);
  const hasImg = images.length > 0;
  return (
    <>
      <button
        type="button"
        className="btn ord-info"
        title={`${title || "No details"}${hasImg ? " — click to view photo" : ""}`}
        aria-label={`Details for ${alt}: ${title || "none"}`}
        disabled={!title && !hasImg}
        onClick={() => hasImg && setViewer(0)}
        tabIndex={-1}
      >
        <Icon name="info" size={13} />
      </button>
      {viewer !== null && <ImageLightbox images={images} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
    </>
  );
}

/** CR-347: derived Loading Status (loadingStatus) — Not loaded · Partially loaded · Loaded. */
export const LOADING_TONE: Record<LoadingStatus, ChipTone> = { "Not loaded": "slate", "Partially loaded": "amber", Loaded: "green" };

/** CR-367/400: the one derived panel-order status (panelProgress) → chip tone. */
export const PROGRESS_TONE: Record<PanelProgress, ChipTone> = {
  New: "slate",
  Ready: "teal",
  Completed: "green",
  Dispatched: "green",
  Cancelled: "red",
};
/* CR-313: per-checkpoint status → chip tone. */
export const checkpointTone = (status: string): ChipTone =>
  status === "Ready" ? "green" : status === "Pending" ? "slate" : status === "Received" ? "blue" : "amber";
