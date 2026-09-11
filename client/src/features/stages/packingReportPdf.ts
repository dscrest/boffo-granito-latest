/* ============================================================
   Pallet Packing Report PDF — the app-generated version of the
   warehouse's handwritten form: one row per item palletised with
   SIZE / PARTY / DESIGN / FINISH / boxes-per-pallet / pallet count /
   total boxes / remaining boxes, a blank LOCATION column for pen,
   and a signature line. Two entry points: right after a Palletise
   confirm (just the moved entries) and from PalPlanDetail (all the
   plan's palletised lines). Uses the shared lazy pdfmake loader.
   ============================================================ */
import type { TDocumentDefinitions, Content } from "pdfmake/interfaces";
import { downloadPdf, PDF_STYLES, pdfHeader, metaLines } from "@/lib/pdf";
import { listAll } from "@/lib/dataOps";
import { prettyDate } from "@/features/quotes/quoteTemplate";
import { listPallets } from "@/features/masters/palletsApi";
import type { PalPlan, PalPlanLine } from "./palPlansApi";
import type { PalletiseEntry } from "./PalletiseModal";

interface PackingReportRow {
  sizeCode: string;
  customerName: string;
  designLabel: string;
  finish: string;
  boxesPerPallet: number; // 0 = pallet unknown → "—"
  totalBoxes: number; // boxes palletised on this row
  remainingBoxes: number;
}

const nfmt = (n: number) => n.toLocaleString("en-IN");

// Same split math as PalletiseModal: full physical pallets + loose boxes.
const palletCount = (boxes: number, cap: number): string => {
  if (cap <= 0) return "—";
  const full = Math.floor(boxes / cap);
  const rem = boxes % cap;
  return rem ? `${full} + ${rem} box` : String(full);
};

function buildDoc(rows: PackingReportRow[], docNumber: string, dateISO: string): TDocumentDefinitions {
  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [36, 36, 36, 44],
    styles: PDF_STYLES,
    content: [
      pdfHeader("Pallet Packing Report", docNumber),
      metaLines([["Date", prettyDate(dateISO)]]),
      { text: "", margin: [0, 6, 0, 0] },
      {
        table: {
          headerRows: 1,
          widths: ["auto", "*", "*", "auto", "auto", "auto", "auto", "auto", 90],
          body: [
            [
              { text: "Size", style: "th" },
              { text: "Party Name", style: "th" },
              { text: "Design Name", style: "th" },
              { text: "Finish", style: "th" },
              { text: "Boxes / Pallet", style: "th", alignment: "right" },
              { text: "No. of Pallets", style: "th", alignment: "right" },
              { text: "Total Box", style: "th", alignment: "right" },
              { text: "Remaining Box", style: "th", alignment: "right" },
              { text: "Location", style: "th" },
            ],
            ...rows.map((r) => [
              { text: r.sizeCode || "—", style: "td" },
              { text: r.customerName || "—", style: "td" },
              { text: r.designLabel || "—", style: "td" },
              { text: r.finish || "—", style: "td" },
              { text: r.boxesPerPallet > 0 ? nfmt(r.boxesPerPallet) : "—", style: "tdNum" },
              { text: palletCount(r.totalBoxes, r.boxesPerPallet), style: "tdNum" },
              { text: nfmt(r.totalBoxes), style: "tdNum" },
              { text: nfmt(r.remainingBoxes), style: "tdNum" },
              { text: "", style: "td" },
            ]),
          ] as Content[][],
        },
        layout: "lightHorizontalLines",
      },
      {
        columns: [
          { text: "" },
          { text: `Total boxes: ${nfmt(rows.reduce((s, r) => s + r.totalBoxes, 0))}`, style: "grand", alignment: "right" },
        ],
        margin: [0, 6, 0, 0],
      },
      { text: "REPORT PERSON NAME & SIGNATURE: ____________________________", style: "meta", margin: [0, 36, 0, 0] },
    ],
    footer: (page: number, count: number) => ({
      text: `${docNumber} · page ${page} of ${count}`,
      style: "fine",
      alignment: "center",
      margin: [0, 12, 0, 0],
    }),
  };
}

async function capsByPalletId(): Promise<Map<string, number>> {
  const r = await listPallets(); // cached — the Palletise modal already fetched it
  return new Map((r.ok ? r.pallets : []).map((p) => [p.id, p.boxesPerPallet || 0]));
}

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Palletised = reached Ready for Loading (or already in a container).
    In Palletization is merely STARTED — it never prints and still counts
    as remaining. */
const isPalletised = (l: PalPlanLine) => l.status === "ReadyToLoad" || !!l.loadBoxId;

// ponytail: rows sharing an orderItemId print the same REMAINING value on
// each row — matches the handwritten form's per-item meaning.

/** Trigger (a): right after items become palletised via the Palletise dialog.
    `lines` are the modal's source lines (pre-split boxes), `pool` every line
    of every plan pre-refresh (for un-palletised siblings of the same item). */
export async function downloadPackingReportForEntries(
  entries: PalletiseEntry[],
  lines: PalPlanLine[],
  pool: PalPlanLine[],
): Promise<void> {
  const caps = await capsByPalletId();
  const byId = new Map(lines.map((l) => [l.id, l]));
  const batchIds = new Set(entries.map((e) => e.lineId));
  const rows: PackingReportRow[] = [];
  for (const e of entries) {
    const l = byId.get(e.lineId);
    if (!l || e.boxes <= 0) continue;
    const siblings = pool
      .filter((p) => p.orderItemId === l.orderItemId && !isPalletised(p) && !batchIds.has(p.id))
      .reduce((s, p) => s + p.boxes, 0);
    rows.push({
      sizeCode: l.sizeCode,
      customerName: l.customerName,
      designLabel: l.designLabel,
      finish: l.finish,
      boxesPerPallet: caps.get(e.palletId) ?? 0,
      totalBoxes: e.boxes,
      remainingBoxes: l.boxes - e.boxes + siblings,
    });
  }
  if (rows.length === 0) return;
  const date = todayISO();
  return downloadPdf(buildDoc(rows, prettyDate(date), date), `packing-report-${date}.pdf`);
}

/** Already-palletised lines (board multi-select print, per-line print on the
    plan detail, direct moves to Ready that skip the dialog). */
export function downloadPackingReportForLines(lines: PalPlanLine[], pool: PalPlanLine[]): Promise<void> {
  const target = lines.filter(isPalletised);
  return downloadPackingReportForEntries(
    target.map((l) => ({ lineId: l.id, palletId: l.palletId, boxes: l.boxes })),
    target,
    pool,
  );
}

/** Today's palletisation report — every line that reached Ready for Loading
    today, found via the StatusTransition audit trail. Returns the line count
    so the caller can toast when nothing was palletised today. */
export async function downloadTodaysPackingReport(plans: PalPlan[]): Promise<number> {
  // The generic list endpoint only accepts ONE `col = 'value'` clause
  // (assertWhere) — filter status + day client-side.
  const res = await listAll("StatusTransition", { where: `entity_type = 'PalletizationPlanLine'` });
  if (!res.ok || res.truncated) throw new Error(res.error || "Failed to load palletisation activity");
  const today = new Date().toDateString();
  const ids = new Set<string>();
  for (const t of res.rows || []) {
    if (String(t.to_status) !== "ReadyToLoad") continue;
    // occurred_at is written in UTC ("YYYY-MM-DD hh:mm:ss") — compare local days.
    const at = String(t.occurred_at || t.CREATEDTIME || "");
    const d = new Date(at.includes("T") ? at : `${at.replace(" ", "T")}Z`);
    if (!Number.isNaN(d.getTime()) && d.toDateString() === today) ids.add(String(t.entity_rowid));
  }
  const pool = plans.flatMap((p) => p.lines);
  const lines = pool.filter((l) => ids.has(l.id) && isPalletised(l));
  if (lines.length > 0) await downloadPackingReportForLines(lines, pool);
  return lines.length;
}

/** Trigger (b): PalPlanDetail — every palletised line of the plan. */
export async function downloadPackingReportForPlan(plan: PalPlan): Promise<void> {
  const caps = await capsByPalletId();
  const remainingFor = (l: PalPlanLine) =>
    plan.lines
      .filter((p) => p.orderItemId === l.orderItemId && !isPalletised(p))
      .reduce((s, p) => s + p.boxes, 0);
  const rows: PackingReportRow[] = plan.lines
    .filter(isPalletised)
    .map((l) => ({
      sizeCode: l.sizeCode,
      customerName: l.customerName,
      designLabel: l.designLabel,
      finish: l.finish,
      boxesPerPallet: caps.get(l.palletId) ?? 0,
      totalBoxes: l.boxes,
      remainingBoxes: remainingFor(l),
    }));
  const date = plan.plannedDate || todayISO();
  return downloadPdf(buildDoc(rows, plan.palNumber, date), `packing-report-${plan.palNumber.replace(/\//g, "-")}.pdf`);
}
