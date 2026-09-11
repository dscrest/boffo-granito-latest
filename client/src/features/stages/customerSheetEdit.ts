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

/* ---- staged drafts → server ops -------------------------------- */

/** Container-level captures (same LoadBox fields the Confirm Load modal writes). */
export type BoxDraft = {
  container_number?: string;
  lr_number?: string;
  electronic_seal?: string;
  line_seal?: string;
  vehicle?: string; // Vehicle ROWID ("" = leave as-is; picking is id-valued)
};
export type BoxCurrent = {
  containerNumber: string;
  lrNumber: string;
  electronicSeal: string;
  lineSeal: string;
  vehicleId: string;
};
/** Per-line Box Brand override ("" = clear back to the customer default). */
export type LineDraft = { boxBrandId?: string };
/** Order-level PO number (shared across every loading of that SO). */
export type SoDraft = { poNumber?: string };

export type SheetOp = { id: string; patch: Record<string, unknown> };

const BOX_KEYS: Array<[keyof BoxDraft, keyof BoxCurrent]> = [
  ["container_number", "containerNumber"],
  ["lr_number", "lrNumber"],
  ["electronic_seal", "electronicSeal"],
  ["line_seal", "lineSeal"],
  ["vehicle", "vehicleId"],
];

/** Diff drafts against current values; only changed, trimmed keys are emitted. */
export function resolveCustomerSheet(
  current: {
    boxes: Record<string, BoxCurrent>;
    lines: Record<string, string>; // line id → current boxBrandId
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
      if (v.trim() !== cur[curKey]) patch[draftKey] = v.trim();
    }
    if (Object.keys(patch).length) boxOps.push({ id, patch });
  }

  const lineOps: SheetOp[] = [];
  for (const [id, d] of Object.entries(drafts.lines)) {
    const v = d.boxBrandId;
    if (v == null) continue;
    if (v !== (current.lines[id] ?? "")) {
      // "" clears the override → null unsets the FK (Catalyst rejects "").
      lineOps.push({ id, patch: { box_brand: v || null } });
    }
  }

  const soOps: SheetOp[] = [];
  for (const [id, d] of Object.entries(drafts.sos)) {
    const v = d.poNumber;
    if (v == null) continue;
    if (v.trim() !== (current.sos[id] ?? "")) soOps.push({ id, patch: { po_number: v.trim() } });
  }

  return { boxOps, lineOps, soOps, dirty: boxOps.length + lineOps.length + soOps.length > 0 };
}
