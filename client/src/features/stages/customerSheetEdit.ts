/* Customer Sheet (Loading, customer view) — pure helpers for the Excel-style
   loading sheet: pallet-number running ranges per container, and the diff that
   turns staged drafts into server ops. No React, so testable via
   customerSheetEdit.test.ts (npx tsx). */

/** "1 TO 16" style running pallet ranges, one container at a time. Each line
    consumes ceil(boxes / boxesPerPallet) pallet slots; a line with an unknown
    pallet spec (boxesPerPallet 0) renders "" and doesn't advance the cursor. */
export function palletRanges(
  lines: Array<{ id: string; boxes: number; boxesPerPallet: number }>,
): Map<string, string> {
  const out = new Map<string, string>();
  let cursor = 1;
  for (const l of lines) {
    if (l.boxesPerPallet <= 0 || l.boxes <= 0) {
      out.set(l.id, "");
      continue;
    }
    const count = Math.ceil(l.boxes / l.boxesPerPallet);
    out.set(l.id, count === 1 ? String(cursor) : `${cursor} TO ${cursor + count - 1}`);
    cursor += count;
  }
  return out;
}

/** Pallet No. per line: a typed value (PalletizationPlanLine.pallet_no) wins,
    else the auto running range (CR-184).
    ponytail: the auto cursor ignores manual rows; renumber-around-manual if asked. */
export function palletNumbers(
  lines: Array<{ id: string; boxes: number; boxesPerPallet: number; palletNo: string }>,
): Map<string, string> {
  const auto = palletRanges(lines);
  const out = new Map<string, string>();
  for (const l of lines) out.set(l.id, l.palletNo.trim() || auto.get(l.id) || "");
  return out;
}

/* ---- staged drafts → server ops -------------------------------- */

/** Container-level captures (same LoadBox fields the Confirm Load modal writes). */
export type BoxDraft = {
  container_number?: string;
  lr_number?: string;
  electronic_seal?: string;
  line_seal?: string;
  vehicle_number?: string; // typed registration; the save resolves it to a Vehicle ROWID (CR-185)
};
export type BoxCurrent = {
  containerNumber: string;
  lrNumber: string;
  electronicSeal: string;
  lineSeal: string;
  vehicleNumber: string;
};
/** Per-line edits: the manual Pallet No. ("" = back to the auto range) and the
    typed Pallet type (CR-208). Box Brand is auto/read-only — no draft. */
export type LineDraft = { palletNo?: string; palletType?: string };
export type LineCurrent = { palletNo: string; palletType: string };
/** Order-level PO number (shared across every loading of that SO). */
export type SoDraft = { poNumber?: string };

export type SheetOp = { id: string; patch: Record<string, unknown> };

const BOX_KEYS: Array<[keyof BoxDraft, keyof BoxCurrent]> = [
  ["container_number", "containerNumber"],
  ["lr_number", "lrNumber"],
  ["electronic_seal", "electronicSeal"],
  ["line_seal", "lineSeal"],
  ["vehicle_number", "vehicleNumber"],
];

/** Diff drafts against current values; only changed, trimmed keys are emitted. */
export function resolveCustomerSheet(
  current: {
    boxes: Record<string, BoxCurrent>;
    lines: Record<string, LineCurrent>;
    sos: Record<string, string>; // SO id → current poNumber
  },
  drafts: {
    boxes: Record<string, BoxDraft>;
    lines: Record<string, LineDraft>;
    sos: Record<string, SoDraft>;
  },
): { boxOps: SheetOp[]; lineOps: SheetOp[]; soOps: SheetOp[]; dirty: boolean } {
  const boxOps: SheetOp[] = [];
  for (const [id, d] of Object.entries(drafts.boxes)) {
    const cur = current.boxes[id];
    if (!cur) continue;
    const patch: Record<string, unknown> = {};
    for (const [draftKey, curKey] of BOX_KEYS) {
      const v = d[draftKey];
      if (v == null) continue; // untouched cell
      // A blanked vehicle is "leave as-is" — the server rejects an empty vehicle.
      if (draftKey === "vehicle_number" && !v.trim()) continue;
      if (v.trim() !== cur[curKey]) patch[draftKey] = v.trim();
    }
    if (Object.keys(patch).length) boxOps.push({ id, patch });
  }

  const lineOps: SheetOp[] = [];
  for (const [id, d] of Object.entries(drafts.lines)) {
    const cur = current.lines[id] ?? { palletNo: "", palletType: "" };
    const patch: Record<string, unknown> = {};
    if (d.palletNo != null && d.palletNo.trim() !== cur.palletNo) patch.pallet_no = d.palletNo.trim();
    if (d.palletType != null && d.palletType.trim() !== cur.palletType) patch.pallet_type = d.palletType.trim();
    if (Object.keys(patch).length) lineOps.push({ id, patch });
  }

  const soOps: SheetOp[] = [];
  for (const [id, d] of Object.entries(drafts.sos)) {
    const v = d.poNumber;
    if (v == null) continue;
    if (v.trim() !== (current.sos[id] ?? "")) soOps.push({ id, patch: { po_number: v.trim() } });
  }

  return { boxOps, lineOps, soOps, dirty: boxOps.length + lineOps.length + soOps.length > 0 };
}
