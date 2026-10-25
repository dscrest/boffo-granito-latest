/* CR-308: reasons for an inventory adjustment — a Masters ▸ Export Master lookup
   (AdjustmentReason), read by both the box-stock and cut-stock sheets. */
import { list } from "@/lib/dataOps";
import type { ComboOption } from "@/ui/Combobox";

export async function listAdjustmentReasons(): Promise<ComboOption[]> {
  const res = await list("AdjustmentReason", { limit: 300, order: "name" });
  return (res.rows || [])
    .map((r) => String(r.name ?? "").trim())
    .filter(Boolean)
    .map((name) => ({ value: name, label: name }));
}
