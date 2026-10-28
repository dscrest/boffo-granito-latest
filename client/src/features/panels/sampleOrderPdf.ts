/* ============================================================
   Sample Order PDF (CR-486) — the pick slip the godown works from: the
   order (customer, SMP number, date, sales person, source, order note)
   and one row per sample line with the item photo, name + item code,
   piece (full tile / cut piece · size), Requested · Supplied · Remaining,
   the line's typed Remarks and a BLANK "Broken / Adjustment" box to fill
   in by pen. The standing Stock Adjustments reminder sits under the table
   (house rule: notes at the bottom), then Taken out by / Checked by lines.
   On demand only — More ▸ Print order PDF on /sample-orders/:id. Same
   branded frame as the Panel Order PDF (panelOrderPdf.ts).
   ============================================================ */
import type { Content, ContentText, TDocumentDefinitions } from "pdfmake/interfaces";
import { downloadPdf, imageDataUrl } from "@/lib/pdf";
import { designImageUrl } from "@/lib/api";
import { QP, logoDataUrl, prettyDate } from "@/features/quotes/quoteTemplate";
import { brandedOrderDoc, metaTable, tableLayout, td, th } from "./panelOrderPdf";
import { remaining, SAMPLE_PIECE_LABEL, type SampleOrderRow } from "./sampleOrdersApi";

const nfmt = (n: number) => n.toLocaleString("en-IN");
/** Taller cells than the panel tables — the godown writes in the last column. */
const cell = (text: string, right = false): ContentText => ({ ...td(text, right), margin: [0, 9, 0, 9] });
const NOTE = "Broken pieces and full tiles taken from an opened box: enter them on Stock Adjustments, reason Sample / Display. Cut pieces leave cut stock when the load is recorded.";

async function buildSampleOrderDoc(order: SampleOrderRow): Promise<TDocumentDefinitions> {
  const [logo, ...thumbs] = await Promise.all([
    logoDataUrl(),
    ...order.lines.map((l) => (l.images[0] ? imageDataUrl(designImageUrl(l.images[0].id)).catch(() => "") : Promise.resolve(""))),
  ]);
  const source = order.salesOrderNo ? `Sales Order ${order.salesOrderNo}` : order.quoteNo ? `Quote ${order.quoteNo}` : "Direct";
  const rem = order.totalQty - order.suppliedQty;

  const lineRow = (l: SampleOrderRow["lines"][number], i: number): Content[] => {
    const r = remaining(l);
    return [
      { ...cell(String(i + 1).padStart(2, "0")), color: QP.dim },
      thumbs[i] ? { image: thumbs[i], fit: [26, 26], margin: [0, 4, 0, 4] } : cell(""),
      { stack: [{ text: l.designName, fontSize: 8, bold: true, color: QP.ink }, ...(l.itemCode ? [{ text: l.itemCode, fontSize: 6.5, color: QP.dim, margin: [0, 1, 0, 0] } as Content] : [])], margin: [0, 7, 0, 7] },
      cell(l.pieceKind === "Cut" ? `${SAMPLE_PIECE_LABEL.Cut} · ${l.cutSizeName || "—"}` : SAMPLE_PIECE_LABEL.Full),
      cell(nfmt(l.qty), true),
      cell(nfmt(l.suppliedQty), true),
      { ...cell(nfmt(r), true), bold: true, color: r > 0 ? QP.orange : QP.ink },
      cell(l.note || ""),
      cell(""), // Broken / Adjustment — pen
    ];
  };

  return brandedOrderDoc("SAMPLE ORDER", order.orderNumber || "", logo, [
    /* Customer + meta */
    {
      columns: [
        {
          width: "*",
          stack: [
            { text: "CUSTOMER", fontSize: 7.5, bold: true, color: QP.orange, characterSpacing: 1.6, margin: [0, 0, 0, 5] },
            { text: order.customerName || "—", fontSize: 13, bold: true, color: QP.ink, margin: [0, 0, 0, 2] },
            { text: `Sales person: ${order.salesperson || "—"}`, fontSize: 9, color: QP.body, lineHeight: 1.3 },
            { text: `Source: ${source}`, fontSize: 9, color: QP.body, lineHeight: 1.3 },
            ...(order.note ? [{ text: `Note: ${order.note}`, fontSize: 8, color: QP.dim, margin: [0, 6, 0, 0] } as Content] : []),
          ],
        },
        metaTable([
          ["ORDER NO.", order.orderNumber || "—", QP.orange],
          ["ORDER DATE", order.orderDate ? prettyDate(order.orderDate) : "—", QP.ink],
          ["ITEMS", nfmt(order.lines.length), QP.ink],
          ["SUPPLIED", `${nfmt(order.suppliedQty)} of ${nfmt(order.totalQty)} pcs`, QP.ink],
        ]),
      ],
      columnGap: 24,
      margin: [0, 0, 0, 18],
    },
    /* Items */
    {
      table: {
        headerRows: 1,
        widths: [16, 30, "*", 72, 44, 44, 48, 80, 70],
        body: [
          [th("#"), th(""), th("Item"), th("Piece"), th("Requested", true), th("Supplied", true), th("Remaining", true), th("Remarks"), th("Broken / Adjustment")],
          ...(order.lines.length ? order.lines.map(lineRow) : [[{ ...cell("No samples on this order"), colSpan: 9, color: QP.dim }, {}, {}, {}, {}, {}, {}, {}, {}]]),
          [
            { ...cell("Total"), colSpan: 4, bold: true, color: QP.ink }, {}, {}, {},
            { ...cell(nfmt(order.totalQty), true), bold: true, color: QP.ink },
            { ...cell(nfmt(order.suppliedQty), true), bold: true, color: QP.ink },
            { ...cell(nfmt(rem), true), bold: true, color: rem > 0 ? QP.orange : QP.ink },
            cell(""),
            cell(""),
          ],
        ],
      },
      layout: tableLayout(8),
    },
    { text: NOTE, fontSize: 7.5, color: QP.dim, margin: [0, 10, 0, 0] },
    /* Signatures */
    {
      unbreakable: true,
      columns: [
        {
          width: "*",
          stack: [
            { text: "TAKEN OUT BY", fontSize: 7.5, bold: true, color: QP.dim, characterSpacing: 1.2 },
            { canvas: [{ type: "line", x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.75, lineColor: QP.ink }], margin: [0, 34, 0, 4] },
            { text: "Name · date", fontSize: 8, color: QP.dim },
          ],
        },
        {
          width: "*",
          stack: [
            { text: "CHECKED BY", fontSize: 7.5, bold: true, color: QP.ink, characterSpacing: 1.2 },
            { canvas: [{ type: "line", x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.75, lineColor: QP.ink }], margin: [0, 34, 0, 4] },
            { text: "Signature", fontSize: 8, color: QP.dim },
          ],
        },
      ],
      columnGap: 44,
      margin: [0, 30, 0, 0],
    },
  ]);
}

/** Build + download the Sample Order pick slip. */
export async function downloadSampleOrderPdf(order: SampleOrderRow): Promise<void> {
  const tag = (order.orderNumber || order.id).replace(/[\s/]+/g, "-");
  await downloadPdf(await buildSampleOrderDoc(order), `SampleOrder-${tag}.pdf`);
}
