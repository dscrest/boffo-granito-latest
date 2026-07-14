/* ============================================================
   invoicePdf — export-invoice PDF via pdfmake (lib/pdf).

   Lines are re-derived the same way the invoice saga priced them:
   ContainerLoading → PalletisedBatchLine (boxes per order item) →
   OrderItem (rate / discount) → Design (name). All client-side
   joins over data-ops list().
   ============================================================ */
import { list } from "@/lib/dataOps";
import { downloadPdf, metaLines, money, PDF_STYLES, pdfHeader } from "@/lib/pdf";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import type { InvoiceRow } from "./invoicesApi";

const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);

interface PdfLine {
  design: string;
  boxes: number;
  rate: number;
  discountPct: number;
  amount: number;
}

/** Boxes loaded into this container, priced per order item. */
async function fetchLines(containerId: string): Promise<PdfLine[]> {
  if (!containerId) return [];
  const loadings = await list("ContainerLoading", {
    where: `container = ${containerId}`,
    columns: ["batch"],
  });
  const batchIds = [...new Set((loadings.rows || []).map((r) => str(r.batch)).filter(Boolean))];
  if (batchIds.length === 0) return [];

  const batchLines = await list("PalletisedBatchLine", {
    where: `batch IN (${batchIds.join(",")})`,
    limit: 300,
    columns: ["order_item", "boxes"],
  });
  const boxesByItem = new Map<string, number>();
  (batchLines.rows || []).forEach((r) => {
    const id = str(r.order_item);
    if (id) boxesByItem.set(id, (boxesByItem.get(id) || 0) + num(r.boxes));
  });
  const itemIds = [...boxesByItem.keys()];
  if (itemIds.length === 0) return [];

  const items = await list("OrderItem", {
    where: `ROWID IN (${itemIds.join(",")})`,
    columns: ["rate", "discount_pct", "design"],
  });
  const designIds = [...new Set((items.rows || []).map((r) => str(r.design)).filter(Boolean))];
  const designs = designIds.length
    ? await list("Design", { where: `ROWID IN (${designIds.join(",")})`, columns: ["design_name"] })
    : { rows: [] as Array<Record<string, unknown>> };
  const designName = new Map((designs.rows || []).map((r) => [str(r.ROWID), str(r.design_name)]));

  return (items.rows || []).map((it) => {
    const boxes = boxesByItem.get(str(it.ROWID)) || 0;
    const rate = num(it.rate);
    const discountPct = num(it.discount_pct);
    const amount = boxes * rate * (1 - discountPct / 100);
    return { design: designName.get(str(it.design)) || str(it.design), boxes, rate, discountPct, amount };
  });
}

/** Build and download the PDF for one invoice row. */
export async function downloadInvoicePdf(inv: InvoiceRow): Promise<void> {
  const lines = await fetchLines(inv.containerId);

  const lineRows: Content[][] = lines.map((l) => [
    { text: l.design, style: "td" },
    { text: String(l.boxes), style: "tdNum" },
    { text: money(l.rate), style: "tdNum" },
    { text: l.discountPct ? `${l.discountPct}%` : "—", style: "tdNum" },
    { text: money(l.amount), style: "tdNum" },
  ]);

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 50],
    styles: PDF_STYLES,
    content: [
      pdfHeader("EXPORT INVOICE", inv.invoiceNumber),
      {
        columns: [
          metaLines([
            ["Customer", inv.customerName],
            ["Sales Order", inv.orderNumber || undefined],
            ["Container", inv.containerNumber || undefined],
          ]),
          metaLines([
            ["Invoice Date", inv.invoiceDate],
            ["Currency", inv.currency],
            ["Status", inv.status],
          ]),
        ],
        margin: [0, 0, 0, 12],
      },
      ...(lineRows.length
        ? [
            {
              table: {
                headerRows: 1,
                widths: ["*", 55, 65, 45, 80] as const,
                body: [
                  [
                    { text: "Design / Item", style: "th" },
                    { text: "Boxes", style: "th", alignment: "right" },
                    { text: "Rate/Box", style: "th", alignment: "right" },
                    { text: "Disc", style: "th", alignment: "right" },
                    { text: "Amount", style: "th", alignment: "right" },
                  ],
                  ...lineRows,
                ],
              },
              layout: "lightHorizontalLines",
            } as Content,
          ]
        : [{ text: "Line detail unavailable for this container.", style: "fine", margin: [0, 4, 0, 4] } as Content]),
      {
        columns: [
          { text: "" },
          {
            width: 220,
            table: {
              widths: ["*", 90],
              body: [
                [
                  { text: "Invoice Total", style: "grand", border: [false, true, false, false] },
                  {
                    text: `${inv.currency} ${money(inv.totalAmount)}`,
                    style: "grand",
                    border: [false, true, false, false],
                  },
                ],
              ],
            },
            layout: { defaultBorder: false },
          },
        ],
        margin: [0, 10, 0, 0],
      },
      { text: "Computer-generated export invoice — no signature required.", style: "fine", margin: [0, 24, 0, 0] },
    ],
  };

  await downloadPdf(doc, `${inv.invoiceNumber.replace(/[\\/]/g, "-")}.pdf`);
}
