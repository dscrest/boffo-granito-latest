/* "Send to next stage" — the explicit stage-advance affordance (critique P1).
   Renders only for the judgment stages (po/prod/qc); from packing onward the
   stage moves when work is recorded (palletise / load / dispatch), so the
   button disappears rather than offering a write that would contradict the
   quantities. The PATCH is op-logged server-side; the receipt is the toast. */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { stageOf, type Order } from "@/data";
import { toast } from "@/ui/Toast";
import { advanceStage, NEXT_STAGE } from "./ordersApi";

export function AdvanceButton({
  order,
  className = "hbtn sm",
  verbose = false,
}: {
  order: Order;
  className?: string;
  /** true → "Send to Quality Control"; false → compact "→ QC" for table rows. */
  verbose?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const next = NEXT_STAGE[order.stage];
  if (!next) return null;
  const target = stageOf(next);

  const send = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    const res = await advanceStage(order.id, order.stage);
    setBusy(false);
    if (res.ok) toast.success(`${order.design} sent to ${target.label}`);
    else toast.error(res.error || "Stage update failed");
  };

  return (
    <button
      className={className}
      disabled={busy}
      onClick={send}
      onKeyDown={(e) => e.stopPropagation()}
      title={`Send ${order.design} to ${target.label}`}
    >
      {busy ? (
        "Sending…"
      ) : verbose ? (
        <>
          Send to {target.label} <Icon name="chev-r" size={12} />
        </>
      ) : (
        <>
          <Icon name="chev-r" size={11} /> {target.short}
        </>
      )}
    </button>
  );
}
