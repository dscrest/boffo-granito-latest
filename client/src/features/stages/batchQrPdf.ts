/* ============================================================
   Batch QR slip — one scannable sticker per production batch record.
   Same rationale as the pallet QR label: the QR encodes a LINK to the
   public slip page (#/share/batch/<token>), not raw text, so phones
   render it richly. Scanning opens a clean no-login page (batch, item,
   qty, mfg date, logged-by). The same summary is printed below the code
   so the slip is useful even unscanned.
   ============================================================ */
import { toDataURL } from "qrcode";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { downloadPdf } from "@/lib/pdf";
import { COMPANY, QP } from "@/features/quotes/quoteTemplate";
import { shareProductionRecord, type ProductionRecordRow } from "./productionApi";

// ponytail: 100×150mm sticker stock, in points — same roll as the pallet QR label.
const LABEL: [number, number] = [283, 425];
const M = 20;

/** Human-readable summary printed under the QR (legible without scanning). */
function summaryLines(rec: ProductionRecordRow): string[] {
  const lines = [
    `Item: ${rec.design || "—"}${rec.size ? ` · ${rec.size}` : ""}`,
    `Qty: ${rec.qtyBoxes} boxes`,
    `Mfg date: ${rec.productionDate || rec.createdTime.slice(0, 10) || "—"}`,
  ];
  if (rec.shade) lines.push(`Shade: ${rec.shade}`);
  if (rec.performedBy) lines.push(`Logged by: ${rec.performedBy}`);
  if (rec.note) lines.push(`Remark: ${rec.note}`);
  return lines;
}

async function buildDoc(rec: ProductionRecordRow, url: string): Promise<TDocumentDefinitions> {
  const qr = await toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 600 });

  const summary: Content = {
    stack: summaryLines(rec).map((t) => ({
      text: t,
      fontSize: 8,
      bold: /^(Item:|Qty:|Mfg date:)/.test(t),
      color: QP.body,
      margin: [0, 0.5, 0, 0.5] as [number, number, number, number],
    })),
  };

  return {
    pageSize: { width: LABEL[0], height: LABEL[1] },
    pageMargins: [M, M, M, M],
    defaultStyle: { fontSize: 8, color: QP.body },
    content: [
      { text: "BOFFO", fontSize: 16, bold: true, color: QP.ink, characterSpacing: 2 },
      {
        columns: [
          { width: "*", text: `Batch ${rec.batchNumber || "—"}`, fontSize: 11, bold: true, color: QP.ink },
          { width: "auto", text: `${rec.qtyBoxes} box`, fontSize: 9, color: QP.dim, alignment: "right" },
        ],
        margin: [0, 2, 0, 6],
      },
      { text: "Scan for batch details", fontSize: 7.5, color: QP.dim, alignment: "center", margin: [0, 0, 0, 4] },
      { image: qr, width: LABEL[0] - 2 * M - 40, alignment: "center", margin: [0, 0, 0, 10] },
      {
        canvas: [{ type: "line", x1: 0, y1: 0, x2: LABEL[0] - 2 * M, y2: 0, lineWidth: 0.75, lineColor: QP.line }],
        margin: [0, 0, 0, 8],
      },
      summary,
      { text: COMPANY.contact, fontSize: 6.5, color: QP.dim, margin: [0, 10, 0, 0] },
    ],
  };
}

/** Build + download the QR slip for one production batch record.
    Mints the record's public share token first, so the QR links to its live page. */
export async function downloadBatchQrPdf(rec: ProductionRecordRow): Promise<void> {
  const token = await shareProductionRecord(rec.id);
  const url = `${window.location.origin}${window.location.pathname}#/share/batch/${token}`;
  await downloadPdf(await buildDoc(rec, url), `Batch-QR-${rec.batchNumber || rec.id}.pdf`);
}
