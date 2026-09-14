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

/* ---------------- per-pallet slips (Record Palletised) ----------------
   One A4 page per PHYSICAL pallet, batch number on each — the print that
   fires when palletised boxes are recorded. A line of N boxes on a pallet
   of capacity C makes ceil(N/C) slips (last one partial); lines sharing a
   pallet_group are ONE mixed pallet → one slip listing every batch. */

interface SlipMember {
  designLabel: string;
  sizeCode: string;
  finish: string;
  batchNumber: string; // "" = legacy unattributed → "—"
  boxes: number;
}

interface PalletSlip {
  // itemCode is a client-side position ordinal that renumbers after later
  // splits — the batch number is the stable trace ID on the slip.
  docNo: string;
  customerName: string;
  soNumber: string;
  palletName: string;
  members: SlipMember[];
  boxes: number;
  index: number;
  count: number;
}

function slipPage(s: PalletSlip, dateISO: string, first: boolean): Content {
  return {
    stack: [
      pdfHeader("Pallet Slip", s.docNo),
      metaLines([
        ["Customer", s.customerName || "—"],
        ["Sales Order", s.soNumber || "—"],
        ["Pallet", s.palletName || "—"],
        ["Date", prettyDate(dateISO)],
      ]),
      { text: "", margin: [0, 8, 0, 0] },
      {
        table: {
          headerRows: 1,
          widths: ["*", "auto", "auto", "auto", "auto"],
          body: [
            [
              { text: "Design", style: "th" },
              { text: "Size", style: "th" },
              { text: "Finish", style: "th" },
              { text: "Batch", style: "th" },
              { text: "Boxes", style: "th", alignment: "right" },
            ],
            ...s.members.map((m) => [
              { text: m.designLabel || "—", style: "td" },
              { text: m.sizeCode || "—", style: "td" },
              { text: m.finish || "—", style: "td" },
              { text: m.batchNumber || "—", style: "td" },
              { text: nfmt(m.boxes), style: "tdNum" },
            ]),
          ] as Content[][],
        },
        layout: "lightHorizontalLines",
      },
      {
        text: [{ text: "Boxes on this pallet:  ", fontSize: 12 }, { text: nfmt(s.boxes), fontSize: 26, bold: true }],
        margin: [0, 20, 0, 0],
      },
      { text: `Pallet ${s.index} of ${s.count}`, style: "meta", margin: [0, 4, 0, 0] },
      ...(s.members.length > 1
        ? [{ text: "Mixed batches on one pallet", style: "meta", color: "#b45309", margin: [0, 6, 0, 0] } as Content]
        : []),
    ],
    ...(first ? {} : { pageBreak: "before" as const }),
  };
}

/** Slips right after a Record Palletised confirm — `lines` are the modal's
    source lines (pre-split), `entries` the recorded boxes per line. All
    pallets land in ONE multi-page PDF (N downloads would hit the popup
    blocker), mixed-pallet groups first, then batch-sequential. */
export async function downloadPalletSlipsForEntries(entries: PalletiseEntry[], lines: PalPlanLine[]): Promise<void> {
  const r = await listPallets(); // cached — the Palletise modal already fetched it
  const palletById = new Map((r.ok ? r.pallets : []).map((p) => [p.id, p]));
  const byId = new Map(lines.map((l) => [l.id, l]));
  const live: Array<{ e: PalletiseEntry; l: PalPlanLine }> = [];
  for (const e of entries) {
    const l = byId.get(e.lineId);
    if (l && e.boxes > 0) live.push({ e, l });
  }

  const slips: PalletSlip[] = [];

  // Mixed physical pallets: the group IS the pallet — one slip, no slicing.
  const groups = new Map<string, typeof live>();
  const singles: typeof live = [];
  for (const x of live) {
    if (x.l.palletGroup) {
      const g = groups.get(x.l.palletGroup) || [];
      g.push(x);
      groups.set(x.l.palletGroup, g);
    } else singles.push(x);
  }
  for (const g of groups.values()) {
    const head = g[0];
    slips.push({
      docNo: [...new Set(g.map((x) => x.l.itemCode))].join(" · "),
      customerName: head.l.customerName,
      soNumber: [...new Set(g.map((x) => x.l.soNumber).filter(Boolean))].join(" · "),
      palletName: palletById.get(head.e.palletId)?.name || head.l.palletName || "",
      members: g.map((x) => ({
        designLabel: x.l.designLabel,
        sizeCode: x.l.sizeCode,
        finish: x.l.finish,
        batchNumber: x.l.batchNumber,
        boxes: x.e.boxes,
      })),
      boxes: g.reduce((s, x) => s + x.e.boxes, 0),
      index: 1,
      count: 1,
    });
  }

  // Batch-sequential singles, one slip per physical pallet.
  singles.sort(
    (a, b) =>
      (a.l.batchNumber || "").localeCompare(b.l.batchNumber || "") || a.l.itemCode.localeCompare(b.l.itemCode),
  );
  for (const { e, l } of singles) {
    const p = palletById.get(e.palletId);
    const cap = p?.boxesPerPallet || 0;
    const count = cap > 0 ? Math.ceil(e.boxes / cap) : 1;
    let left = e.boxes;
    for (let i = 1; i <= count; i++) {
      const on = cap > 0 ? Math.min(cap, left) : left;
      left -= on;
      slips.push({
        docNo: l.itemCode,
        customerName: l.customerName,
        soNumber: l.soNumber,
        palletName: p?.name || l.palletName || "",
        members: [{ designLabel: l.designLabel, sizeCode: l.sizeCode, finish: l.finish, batchNumber: l.batchNumber, boxes: on }],
        boxes: on,
        index: i,
        count,
      });
    }
  }

  if (slips.length === 0) return;
  const date = todayISO();
  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [36, 36, 36, 44],
    styles: PDF_STYLES,
    content: slips.map((s, i) => slipPage(s, date, i === 0)),
    footer: (page: number, count: number) => ({
      text: `Pallet slips · ${prettyDate(date)} · page ${page} of ${count}`,
      style: "fine",
      alignment: "center",
      margin: [0, 12, 0, 0],
    }),
  };
  return downloadPdf(doc, `pallet-slips-${date}.pdf`);
}

/** Slips for already-palletised lines (direct drag-drop moves to Ready). */
export function downloadPalletSlipsForLines(lines: PalPlanLine[]): Promise<void> {
  const target = lines.filter(isPalletised);
  return downloadPalletSlipsForEntries(
    target.map((l) => ({ lineId: l.id, palletId: l.palletId, boxes: l.boxes })),
    target,
  );
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
