/* ============================================================
   Container-plan consumption — how much of a locked plan has actually
   shipped. The plan (Plan Containerisation) is a JSON snapshot with no ids
   and no link to any LoadBox, so progress is DERIVED: dispatched boxes per
   design are drained into the plan's containers in order. Plan a 2000-box
   order as 4 × 500 and ship one container, and C1 reads "Sent" while
   C2..C4 stay "Planned".

   ponytail: auto-consume in plan order — no per-container id, nothing for
   the crew to set. If a match is ever disputed, the upgrade path is an
   explicit LoadBox.plan_container_no + an override picker on the loading.
   ============================================================ */
import type { ContainerPlan } from "@/data";

export type ContainerProgressStatus = "Sent" | "Partial" | "Planned";

export interface ContainerProgress {
  no: number;
  /** Boxes of this container covered by dispatches. */
  sent: number;
  /** Boxes this container was planned to carry. */
  boxes: number;
  /** sent / boxes, 0..100 (0 when the container plans no boxes). */
  pct: number;
  status: ContainerProgressStatus;
}

/**
 * Drain each design's dispatched pool through the plan's containers in order.
 * `dispatchedByDesign` is keyed however the caller resolved designs — pass
 * Design ROWIDs and key the plan lines the same way (see `planDesignKey`).
 */
export function planProgress(
  plan: ContainerPlan,
  dispatchedByDesign: Map<string, number>,
  /** Plan line's design string → the same key `dispatchedByDesign` uses. */
  keyOf: (design: string) => string = (d) => d,
): ContainerProgress[] {
  const pool = new Map(dispatchedByDesign);
  return plan.containers.map((c) => {
    let sent = 0;
    let planned = 0;
    for (const l of c.lines) {
      const boxes = Math.max(0, l.boxes || 0);
      planned += boxes;
      const key = keyOf(l.design);
      const avail = pool.get(key) || 0;
      const take = Math.min(boxes, avail);
      if (take > 0) pool.set(key, avail - take);
      sent += take;
    }
    const pct = planned > 0 ? Math.round((sent / planned) * 100) : 0;
    const status: ContainerProgressStatus = planned > 0 && sent >= planned ? "Sent" : sent > 0 ? "Partial" : "Planned";
    return { no: c.no, sent, boxes: planned, pct, status };
  });
}

/** Roll the per-container verdicts up into one line for a card header. */
export function progressSummary(rows: ContainerProgress[]): { sent: number; total: number; boxes: number; planned: number } {
  return {
    sent: rows.filter((r) => r.status === "Sent").length,
    total: rows.length,
    boxes: rows.reduce((s, r) => s + r.sent, 0),
    planned: rows.reduce((s, r) => s + r.boxes, 0),
  };
}

/** Chip class + label for a container's verdict (board palstatus palette). */
export function progressChip(r: ContainerProgress): { label: string; cls: string } {
  if (r.status === "Sent") return { label: "Sent", cls: "palstatus p-completed" };
  if (r.status === "Partial") return { label: `Partially sent · ${r.sent} of ${r.boxes}`, cls: "palstatus p-loading" };
  return { label: "Planned", cls: "palstatus p-planning" };
}
