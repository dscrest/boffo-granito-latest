/* ============================================================
   sealChecks — pure duplicate check for the Loading Session sheet
   (CR-203): a container no. / e-seal / line seal typed on one loading
   that already sits on another (open or dispatched). Warn-only.
   ============================================================ */
import type { BoxDraft } from "./customerSheetEdit";

export type SealBox = { id: string; label: string; containerNumber: string; electronicSeal: string; lineSeal: string };
export type SealDup = { boxId: string; field: string; value: string; otherLabel: string };

const FIELDS = [
  ["Container No.", "containerNumber", "container_number"],
  ["E-seal", "electronicSeal", "electronic_seal"],
  ["Line seal", "lineSeal", "line_seal"],
] as const;

const norm = (v: string) => v.replace(/\s+/g, "").toUpperCase();

/** Dups on the boxes in `scope` (the sheet's rows), checked against ALL boxes, drafts applied. */
export function duplicateSeals(all: SealBox[], drafts: Record<string, BoxDraft>, scope: string[]): SealDup[] {
  const out: SealDup[] = [];
  for (const [field, cur, key] of FIELDS) {
    const valueOf = (b: SealBox) => norm(drafts[b.id]?.[key] ?? b[cur]);
    for (const id of scope) {
      const b = all.find((x) => x.id === id);
      const v = b ? valueOf(b) : "";
      if (!b || !v) continue;
      const other = all.find((x) => x.id !== id && valueOf(x) === v);
      if (other) out.push({ boxId: id, field, value: (drafts[id]?.[key] ?? b[cur]).trim(), otherLabel: other.label });
    }
  }
  return out;
}
