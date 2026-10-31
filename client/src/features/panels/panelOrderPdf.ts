/* ============================================================
   Panel Order PDF (CR-474) — the order as the customer / godown reads it:
   page 1 = the order (customer, PNL number, date, sales person, source) and
   its lines; then ONE PAGE PER PANEL LINE with the showcase photo as large
   as the page allows, the panel's sizes (panel · MDF · vinyl) and the table
   of its cut pieces (design · item code · cut piece size · pcs per panel ·
   total pcs for the ordered qty · the design's available size). On demand
   only, from the More menu on /panel-orders/:id — never auto-printed.
   Same branded template as the Load Copy (panelLoadCopyPdf.ts).
   ============================================================ */
import type { Column, Content, ContentText, TDocumentDefinitions } from "pdfmake/interfaces";
import { downloadPdf, imageDataUrl } from "@/lib/pdf";
import { designImageUrl } from "@/lib/api";
import { COMPANY, QP, logoDataUrl, moneyFor, prettyDate } from "@/features/quotes/quoteTemplate";
import { lineRate } from "./panelPrice";

const money = moneyFor("INR");
const moneyOr = (v: number | null) => (v == null ? "—" : money(v)); // CR-504: "—" = saved before pricing
import type { PanelOrderRow } from "./panelOrdersApi";
import type { PanelRow } from "./panelsApi";

const M = 33;
export const PAGE_W = 595.28 - 2 * M; // A4 content width
const nfmt = (n: number) => n.toLocaleString("en-IN");

/* Table cells + layout, the cover's key / value panel and the branded page frame are shared with the
   Sample Order PDF (sampleOrderPdf.ts, CR-486). */
export const th = (text: string, right = false): ContentText => ({
  text: text.toUpperCase(),
  fontSize: 6.5,
  bold: true,
  color: "#fff",
  fillColor: QP.ink,
  characterSpacing: 0.75,
  alignment: right ? "right" : "left",
  margin: [0, 3, 0, 3],
});
export const td = (text: string, right = false): ContentText => ({ text, fontSize: 8, color: QP.body, alignment: right ? "right" : "left", margin: [0, 4, 0, 4] });
export const tableLayout = (lastCol: number) => ({
  hLineWidth: (i: number) => (i > 1 ? 0.75 : 0),
  hLineColor: () => QP.line,
  vLineWidth: () => 0,
  paddingLeft: (i: number) => (i === 0 ? 6 : 3),
  paddingRight: (i: number) => (i === lastCol ? 6 : 3),
  paddingTop: () => 0,
  paddingBottom: () => 0,
});

/** The cover's right-hand key / value panel: [label, value, value colour] per row. */
export const metaTable = (rows: [string, string, string][]): Column => ({
  width: 210,
  table: {
    widths: ["auto", "*"],
    body: rows.map(([k, v, c]) => [
      { text: k, fontSize: 7.5, bold: true, color: QP.dim, characterSpacing: 1.2, margin: [0, 6, 0, 6] },
      { text: v, fontSize: 9, bold: true, color: c, alignment: "right", margin: [0, 5, 0, 5] },
    ]),
  },
  layout: {
    hLineWidth: (i: number) => (i === 0 ? 1.5 : 0.75),
    hLineColor: (i: number) => (i === 0 ? QP.ink : QP.line),
    vLineWidth: () => 0,
    paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
  },
});

/** A4 portrait, the branded ink header band (logo + TITLE) and the orange-rule footer
    (company · footerCenter · page x of y) around `content`. */
export function brandedOrderDoc(title: string, footerCenter: string, logo: string, content: Content[]): TDocumentDefinitions {
  return {
    pageSize: "A4",
    pageMargins: [M, 100, M, 58],
    defaultStyle: { fontSize: 8, color: QP.body },
    header: {
      table: {
        widths: ["*", "auto"],
        body: [[
          { ...(logo ? { image: logo, width: 100 } : { text: COMPANY.brand, color: "#fff", bold: true, fontSize: 18 }), fillColor: QP.ink, border: [false, false, false, false], margin: [M, 18, 0, 16] },
          {
            stack: [
              { text: title, fontSize: 19, bold: true, color: "#fff", characterSpacing: 4.5 },
              { columns: [{ width: "*", text: "" }, { width: 48, canvas: [{ type: "rect", x: 0, y: 0, w: 48, h: 3, color: QP.orange }] }], margin: [0, 5, 0, 0] },
            ],
            fillColor: QP.ink,
            border: [false, false, false, false],
            margin: [0, 24, M, 16],
          },
        ]],
      },
    },
    footer: (page: number, pages: number) => ({
      stack: [
        { canvas: [{ type: "rect", x: 0, y: 0, w: 595.28, h: 2.5, color: QP.orange }] },
        {
          table: {
            widths: ["auto", "*", "auto"],
            body: [[
              { text: COMPANY.name, fontSize: 7, bold: true, color: QP.ink, characterSpacing: 0.9, fillColor: QP.paper, border: [false, false, false, false], margin: [M, 8, 0, 8] },
              { text: `${footerCenter}   ·   page ${page} of ${pages}`, fontSize: 7, color: QP.dim, alignment: "center", fillColor: QP.paper, border: [false, false, false, false], margin: [0, 8, 0, 8] },
              { text: COMPANY.contact, fontSize: 7, color: QP.dim, fillColor: QP.paper, border: [false, false, false, false], margin: [0, 8, M, 8] },
            ]],
          },
        },
      ],
    }),
    content,
  };
}

/** One page per panel line: photo, sizes, cut pieces × ordered qty. */
function panelPage(order: PanelOrderRow, line: PanelOrderRow["lines"][number], panel: PanelRow | undefined, image: string): Content {
  const code = panel?.panelCode || line.panelCode;
  const pieces = panel?.lines ?? [];
  const rows = pieces.map((p, i): Content[] => [
    { ...td(String(i + 1).padStart(2, "0")), color: QP.dim },
    { ...td(p.designName), bold: true, color: QP.ink },
    td(p.itemCode || "—"),
    td(p.cutSizeName || p.sizeLabel || "—"),
    td(nfmt(p.qty), true),
    { ...td(nfmt(p.qty * line.qty), true), bold: true, color: QP.ink },
    td(p.sizeLabel || "—"),
  ]);
  return {
    pageBreak: "before",
    stack: [
      {
        columns: [
          { width: "*", text: code, fontSize: 15, bold: true, color: QP.ink },
          { width: "auto", text: `QTY  ${nfmt(line.qty)}`, fontSize: 12, bold: true, color: QP.orange, alignment: "right" },
        ],
        margin: [0, 0, 0, 2],
      },
      {
        text: [
          `Panel ${panel?.panelSize || "—"}`,
          `MDF ${panel?.mdfSize || "—"}`,
          `Vinyl ${panel?.vinylSize || "—"}`,
          // CR-504: the frozen price parts of one panel
          ...(lineRate(line) == null ? [] : [`Vinyl ${money(line.vinylPrice ?? 0)} + MDF ${money(line.mdfPrice ?? 0)} + Cut pieces ${money(line.piecesPrice ?? 0)} = ${money(lineRate(line) ?? 0)} / panel`]),
        ].join("   ·   "),
        fontSize: 8.5,
        color: QP.dim,
        margin: [0, 0, 0, 10],
      },
      image
        ? { image, fit: [PAGE_W, 430], alignment: "center", margin: [0, 0, 0, 12] }
        : { text: "No photo on file for this panel", fontSize: 9, color: QP.dim, alignment: "center", margin: [0, 160, 0, 170] },
      {
        table: {
          headerRows: 1,
          widths: [18, "*", 78, 72, 48, 52, 70],
          body: [
            [th("#"), th("Design"), th("Item code"), th("Cut piece size"), th("Pcs / panel", true), th(`Total × ${nfmt(line.qty)}`, true), th("Available size")],
            ...(rows.length ? rows : [[{ ...td("No cut pieces defined on this panel"), colSpan: 7, color: QP.dim }, {}, {}, {}, {}, {}, {}]]),
          ],
        },
        layout: tableLayout(6),
      },
    ],
  };
}

async function buildPanelOrderDoc(order: PanelOrderRow, panelsById: Map<string, PanelRow>): Promise<TDocumentDefinitions> {
  const panelLines = order.lines.filter((l) => l.panelId);
  const [logo, ...images] = await Promise.all([
    logoDataUrl(),
    ...panelLines.map((l) => {
      const img = panelsById.get(l.panelId)?.images[0];
      return img ? imageDataUrl(designImageUrl(img.id)) : Promise.resolve("");
    }),
  ]);
  const totalQty = order.lines.reduce((s, l) => s + l.qty, 0);
  const source = order.salesOrderNo ? `Sales Order ${order.salesOrderNo}` : order.quoteNo ? `Quote ${order.quoteNo}` : "Direct";

  const lineRow = (l: PanelOrderRow["lines"][number], i: number): Content[] => {
    const p = panelsById.get(l.panelId);
    return [
      { ...td(String(i + 1).padStart(2, "0")), color: QP.dim },
      { ...td(l.panelId ? l.panelCode : `${l.designName} · ${l.cutSizeName || "full size"}`), bold: true, color: QP.ink },
      td(l.panelId ? p?.panelSize || "—" : "Cut piece"),
      td(l.panelId ? `${p?.lines.length ?? 0} design${(p?.lines.length ?? 0) === 1 ? "" : "s"}` : "—"),
      { ...td(nfmt(l.qty), true), bold: true, color: QP.ink },
      td(moneyOr(lineRate(l)), true),
      { ...td(moneyOr(l.amount), true), bold: true, color: QP.ink },
    ];
  };

  return brandedOrderDoc("PANEL ORDER", order.orderNumber || "", logo, [
      /* Page 1 — customer + meta */
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "CUSTOMER", fontSize: 7.5, bold: true, color: QP.orange, characterSpacing: 1.6, margin: [0, 0, 0, 5] },
              { text: order.customerName || "—", fontSize: 13, bold: true, color: QP.ink, margin: [0, 0, 0, 2] },
              { text: `Sales person: ${order.salesperson || "—"}`, fontSize: 9, color: QP.body, lineHeight: 1.3 },
              { text: `Source: ${source}`, fontSize: 9, color: QP.body, lineHeight: 1.3 },
            ],
          },
          metaTable([
            ["ORDER NO.", order.orderNumber || "—", QP.orange],
            ["ORDER DATE", order.orderDate ? prettyDate(order.orderDate) : "—", QP.ink],
            ["PANELS", nfmt(order.lines.length), QP.ink],
            ["TOTAL QTY", nfmt(totalQty), QP.ink],
          ]),
        ],
        columnGap: 24,
        margin: [0, 0, 0, 18],
      },
      /* Lines */
      {
        table: {
          headerRows: 1,
          widths: [18, "*", 70, 56, 36, 68, 76],
          body: [
            [th("#"), th("Panel"), th("Size"), th("Designs"), th("Qty", true), th("Rate", true), th("Amount", true)],
            ...order.lines.map(lineRow),
            [{ ...td("Total"), colSpan: 6, bold: true, color: QP.ink }, {}, {}, {}, {}, {}, { ...td(moneyOr(order.amount), true), bold: true, color: QP.ink }],
          ],
        },
        layout: tableLayout(6),
      },
      {
        text: "Each panel follows on its own page with its photo and cut pieces.",
        fontSize: 7.5,
        color: QP.dim,
        margin: [0, 10, 0, 0],
      },
      /* One page per panel line */
      ...panelLines.map((l, i) => panelPage(order, l, panelsById.get(l.panelId), images[i])),
  ]);
}

/** Build + download the Panel Order PDF (cover + one page per panel). */
export async function downloadPanelOrderPdf(order: PanelOrderRow, panelsById: Map<string, PanelRow>): Promise<void> {
  const tag = (order.orderNumber || order.id).replace(/[\s/]+/g, "-");
  await downloadPdf(await buildPanelOrderDoc(order, panelsById), `PanelOrder-${tag}.pdf`);
}
