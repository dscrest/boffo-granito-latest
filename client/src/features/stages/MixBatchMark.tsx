/* CR-498: the ONE Mix Batch marker — an amber icon with a hover hint, never a text chip.
   A Mix Batch pallet = one physical pallet shared by more than one batch (or item) via
   `pallet_group`. Used on the palletization sheet, the kanban card, the Loading bay, the
   bulk-load picker and the Complete Palletization dialog. */
import type { CSSProperties } from "react";
import { Icon } from "@/ui/Icon";

export const MIX_BATCH_HINT = "Mix Batch pallet — shares one physical pallet with another batch of this item";

export const MixBatchMark = ({ title = MIX_BATCH_HINT, style }: { title?: string; style?: CSSProperties }) => (
  <span
    role="img"
    aria-label="Mix Batch pallet"
    title={title}
    style={{ display: "inline-flex", verticalAlign: "middle", color: "var(--c-amber)", marginLeft: 6, ...style }}
  >
    <Icon name="palette" size={13} />
  </span>
);
