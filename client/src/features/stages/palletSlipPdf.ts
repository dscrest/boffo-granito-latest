/* ============================================================
   Palletization slip PDF — one branded load slip per Palletization Plan.
   Mirrors quotePdf.ts but is a logistics doc (no money / amount-in-words):
   header + plan meta, then one section per Associated Sales Order listing
   design / pallet / boxes, and a grand total. Uses the shared lazy pdfmake
   loader + letterhead helpers in lib/pdf so pdfmake stays out of the bundle.
   ============================================================ */
import type { TDocumentDefinitions, Content } from "pdfmake/interfaces";
import { downloadPdf, PDF_STYLES, pdfHeader, metaLines } from "@/lib/pdf";
import { prettyDate } from "@/features/quotes/quoteTemplate";
import { PAL_STATUS_LABEL, type PalPlan } from "./palPlansApi";

const nfmt = (n: number) => n.toLocaleString("en-IN");

function buildPalletSlipDoc(plan: PalPlan): TDocumentDefinitions {
  // Group lines by Sales Order (same as the detail's Associated SO(s) section).
  const bySo = new Map<string, { soNumber: string; lines: PalPlan["lines"] }>();
  plan.lines.forEach((l) => {
    const g = bySo.get(l.salesOrderId) ?? bySo.set(l.salesOrderId, { soNumber: l.soNumber, lines: [] }).get(l.salesOrderId)!;
    g.lines.push(l);
  });

  const soSections: Content[] = [...bySo.values()].map((g): Content => {
    const subtotal = g.lines.reduce((s, l) => s + l.boxes, 0);
    return {
      stack: [
        { text: `Sales Order ${g.soNumber}`, style: "h2" },
        {
          table: {
            headerRows: 1,
            widths: ["*", "*", "auto"],
            body: ([
              [
                { text: "Design", style: "th" },
                { text: "Pallet", style: "th" },
                { text: "Boxes", style: "th", alignment: "right" },
              ],
              ...g.lines.map((l) => [
                { text: l.designLabel, style: "td" },
                { text: l.palletName, style: "td" },
                { text: nfmt(l.boxes), style: "tdNum" },
              ]),
              [
                { text: "Subtotal", style: "td", bold: true, colSpan: 2 },
                {},
                { text: nfmt(subtotal), style: "tdNum", bold: true },
              ],
            ] as Content[][]),
          },
          layout: "lightHorizontalLines",
          margin: [0, 0, 0, 6],
        },
      ],
    };
  });

  return {
    pageSize: "A4",
    pageMargins: [36, 36, 36, 44],
    styles: PDF_STYLES,
    content: [
      pdfHeader("Palletization Slip", plan.palNumber),
      metaLines([
        ["Status", PAL_STATUS_LABEL[plan.status]],
        ["Vehicle", plan.vehicleNumber || undefined],
        ["Planned Date", prettyDate(plan.plannedDate)],
        ["Dispatch Date", plan.dispatchDate ? prettyDate(plan.dispatchDate) : undefined],
        ["Sales Person", plan.salespersonName || undefined],
        ["Remarks", plan.remarks || undefined],
      ]),
      { text: "", margin: [0, 6, 0, 0] },
      ...soSections,
      {
        columns: [
          { text: "" },
          { text: `Total boxes: ${nfmt(plan.totalBoxes)}`, style: "grand", alignment: "right" },
        ],
        margin: [0, 6, 0, 0],
      },
    ],
    footer: (page: number, count: number) => ({ text: `${plan.palNumber} · page ${page} of ${count}`, style: "fine", alignment: "center", margin: [0, 12, 0, 0] }),
  };
}

/** Build + download the palletization slip PDF for one plan. */
export function downloadPalletSlipPdf(plan: PalPlan): Promise<void> {
  return downloadPdf(buildPalletSlipDoc(plan), `${plan.palNumber.replace(/\//g, "-")}.pdf`);
}
