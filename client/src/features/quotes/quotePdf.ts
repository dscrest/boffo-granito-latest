/* ============================================================
   quotePdf — quotation PDF via pdfmake (lib/pdf), styled to the
   same branded template as QuotePrint (quoteTemplate.ts): dark
   logo band, meta panel, spec'd item table, amount-in-words,
   terms + bank details, signatures, orange footer rule.
   Feeds both Download PDF and the inline Details|PDF preview.
   ============================================================ */
import { docTotals, lineTotals, type Quote, type QuoteLine } from "@/data";
import { downloadPdf } from "@/lib/pdf";
import { listDesigns } from "@/features/masters/designsApi";
import type { Content, ContentText, TDocumentDefinitions } from "pdfmake/interfaces";
import {
  BANK,
  COMPANY,
  QP,
  amountInWords,
  logoDataUrl,
  moneyFor,
  prettyDate,
  termsList,
} from "./quoteTemplate";

/* Design authored at 794px page width; A4 is 595pt → 0.75 scale. */
const M = 33; // 44px side padding

const th = (text: string, right = false): ContentText => ({
  text: text.toUpperCase(),
  fontSize: 6.5,
  bold: true,
  color: "#fff",
  fillColor: QP.ink,
  characterSpacing: 0.75,
  alignment: right ? "right" : "left",
  margin: [0, 3, 0, 3],
});

const td = (text: string, right = false): ContentText => ({
  text,
  fontSize: 8,
  color: QP.body,
  alignment: right ? "right" : "left",
  margin: [0, 4, 0, 4],
});

/** Orange eyebrow + solid dark underline (section titles). */
const secTitle = (text: string): Content => ({
  table: {
    widths: ["*"],
    body: [[{
      text: text.toUpperCase(),
      fontSize: 7.5,
      bold: true,
      color: QP.orange,
      characterSpacing: 1.6,
      border: [false, false, false, true],
      margin: [0, 0, 0, 4],
    }]],
  },
  layout: { hLineWidth: () => 1.2, hLineColor: () => QP.ink, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0 },
  margin: [0, 0, 0, 6],
});

/** pdfmake document definition for one quote (download + inline preview). */
export async function buildQuoteDoc(quote: Quote): Promise<TDocumentDefinitions> {
  const logo = await logoDataUrl();
  /* TTL-cached list; spec columns degrade to "—" if the master is unreachable. */
  const dres = await listDesigns().catch(() => null);
  const designs = dres?.ok ? dres.designs : [];
  const totals = docTotals(quote.lines, {
    docDiscount: quote.docDiscount,
    adjustment: quote.adjustment,
    taxType: quote.taxType,
    taxPct: quote.taxPct,
  });
  const money = moneyFor(quote.currency);
  const totalBoxes = quote.lines.reduce((s, l) => s + (l.qty || 0), 0);

  const lineRow = (l: QuoteLine, i: number): Content[] => {
    const d = designs.find((x) => x.designName === l.item);
    const t = lineTotals(l);
    return [
      { ...td(String(i + 1).padStart(2, "0")), color: QP.dim },
      {
        stack: [
          { text: l.item, fontSize: 8.5, bold: true, color: QP.ink },
          ...(d?.brandLabel ? [{ text: d.brandLabel, fontSize: 7, color: QP.dim }] : []),
        ],
        margin: [0, 4, 0, 4],
      } as Content,
      td(d?.sizeLabel || "—"),
      td(d?.finishLabel || "—"),
      td(String(l.qty), true),
      td(money(l.rate), true),
      td(String(l.discount || 0), true),
      { ...td(money(t.subTotal), true), bold: true, color: QP.ink },
    ];
  };

  const sumRow = (label: string, value: string): Content => ({
    table: {
      widths: ["*", "auto"],
      body: [[
        { text: label, fontSize: 8, bold: true, color: QP.dim, border: [false, false, false, true], margin: [0, 5, 0, 5] },
        { text: value, fontSize: 8.5, bold: true, color: QP.ink, alignment: "right", border: [false, false, false, true], margin: [0, 5, 0, 5] },
      ]],
    },
    layout: { hLineWidth: () => 0.75, hLineColor: () => QP.line, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
  });

  const sumRows: Content[] = [
    sumRow("Total boxes", String(totalBoxes)),
    sumRow("Subtotal", money(totals.final)),
  ];
  if (totals.docDiscount > 0) sumRows.push(sumRow("Discount", `− ${money(totals.docDiscount)}`));
  if (totals.adjustment !== 0) sumRows.push(sumRow("Adjustment", money(totals.adjustment)));
  if (totals.taxType !== "None")
    sumRows.push(sumRow(`${totals.taxType} (${totals.taxPct}%)`, `${totals.taxType === "TDS" ? "− " : "+ "}${money(totals.taxAmt)}`));

  return {
    pageSize: "A4",
    pageMargins: [M, 100, M, 58],
    defaultStyle: { fontSize: 8, color: QP.body },

    /* Full-bleed dark logo band. Header/footer ignore table LAYOUT callbacks
       (pdfmake quirk) — fills and border suppression must sit on the cells. */
    header: {
      table: {
        widths: ["*", "auto"],
        body: [[
          { image: logo, width: 100, fillColor: QP.ink, border: [false, false, false, false], margin: [M, 18, 0, 16] },
          {
            stack: [
              { text: "QUOTATION", fontSize: 19, bold: true, color: "#fff", characterSpacing: 4.5 },
              { columns: [{ width: "*", text: "" }, { width: 48, canvas: [{ type: "rect", x: 0, y: 0, w: 48, h: 3, color: QP.orange }] }], margin: [0, 5, 0, 0] },
            ],
            fillColor: QP.ink,
            border: [false, false, false, false],
            margin: [0, 24, M, 16],
          },
        ]],
      },
    },

    /* Orange-ruled company footer. */
    footer: {
      stack: [
        { canvas: [{ type: "rect", x: 0, y: 0, w: 595.28, h: 2.5, color: QP.orange }] },
        {
          table: {
            widths: ["auto", "*", "auto"],
            body: [[
              { text: COMPANY.name, fontSize: 7, bold: true, color: QP.ink, characterSpacing: 0.9, fillColor: QP.paper, border: [false, false, false, false], margin: [M, 8, 0, 8] },
              { text: COMPANY.address, fontSize: 7, color: QP.dim, alignment: "center", fillColor: QP.paper, border: [false, false, false, false], margin: [0, 8, 0, 8] },
              { text: COMPANY.contact, fontSize: 7, color: QP.dim, fillColor: QP.paper, border: [false, false, false, false], margin: [0, 8, M, 8] },
            ]],
          },
        },
      ],
    },

    content: [
      /* QUOTATION FOR + meta panel */
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "QUOTATION FOR", fontSize: 7.5, bold: true, color: QP.orange, characterSpacing: 1.6, margin: [0, 0, 0, 5] },
              { text: quote.customer, fontSize: 13, bold: true, color: QP.ink, margin: [0, 0, 0, 2] },
              { text: quote.address || "—", fontSize: 9, color: QP.body, lineHeight: 1.3 },
            ],
          },
          {
            width: 190,
            table: {
              widths: ["auto", "*"],
              body: ([
                ["QUOTE NO.", quote.quoteNo, QP.ink],
                ["DATE", prettyDate(quote.quoteDate), QP.ink],
                ["VALID UNTIL", prettyDate(quote.expiryDate), QP.orange],
                ["SALES REP", quote.salesperson || "—", QP.ink],
              ] as [string, string, string][]).map(([k, v, c]) => [
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
          },
        ],
        columnGap: 24,
        margin: [0, 0, 0, 18],
      },

      /* Item table */
      {
        table: {
          headerRows: 1,
          widths: [18, "*", 58, 46, 34, 52, 34, 62],
          body: [
            [th("#"), th("Product / Design"), th("Size (mm)"), th("Finish"), th("Boxes", true), th("Rate /Box", true), th("Disc %", true), th("Amount", true)],
            ...quote.lines.map(lineRow),
          ],
        },
        layout: {
          hLineWidth: (i: number) => (i > 1 ? 0.75 : 0),
          hLineColor: () => QP.line,
          vLineWidth: () => 0,
          paddingLeft: (i: number) => (i === 0 ? 6 : 3),
          paddingRight: (i: number) => (i === 7 ? 6 : 3), // last column

          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
      },

      /* Amount in words + totals */
      {
        unbreakable: true,
        columns: [
          {
            width: "*",
            stack: [
              { text: [{ text: "Amount in words: ", bold: true, color: QP.body }, { text: amountInWords(totals.net, quote.currency), color: QP.dim }], fontSize: 8, lineHeight: 1.3 },
              ...(quote.customerNotes
                ? [{ text: [{ text: "Notes: ", bold: true, color: QP.body }, { text: quote.customerNotes, color: QP.dim }], fontSize: 8, lineHeight: 1.3, margin: [0, 6, 0, 0] } as Content]
                : []),
            ],
            margin: [0, 3, 0, 0] as [number, number, number, number],
          },
          {
            width: 220,
            stack: [
              ...sumRows,
              {
                table: {
                  widths: ["*", "auto"],
                  body: [[
                    { text: "TOTAL", fontSize: 8, bold: true, color: QP.orange, characterSpacing: 1.2, margin: [9, 8, 0, 8] },
                    { text: money(totals.net), fontSize: 13, bold: true, color: "#fff", alignment: "right", margin: [0, 5, 9, 5] },
                  ]],
                },
                layout: { defaultBorder: false, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0, fillColor: () => QP.ink },
                margin: [0, 6, 0, 0],
              },
              { text: "Taxes, freight & insurance extra as applicable.", fontSize: 7, color: QP.dim, alignment: "right", margin: [0, 4, 0, 0] },
            ],
          },
        ],
        columnGap: 24,
        margin: [0, 10, 0, 0],
      },

      /* Terms + bank details */
      {
        unbreakable: true,
        columns: [
          {
            width: "*",
            stack: [
              secTitle("Terms & Conditions"),
              { ol: termsList(quote.terms), fontSize: 8, color: QP.body, lineHeight: 1.35, markerColor: QP.dim },
            ],
          },
          {
            width: 190,
            stack: [
              secTitle("Bank Details"),
              ...BANK.map(([k, v]) => ({ text: [{ text: `${k}: `, bold: true, color: QP.ink }, { text: v }], fontSize: 8, margin: [0, 1.5, 0, 1.5] } as Content)),
            ],
          },
        ],
        columnGap: 24,
        margin: [0, 20, 0, 0],
      },

      /* Signatures */
      {
        unbreakable: true,
        columns: [
          {
            width: "*",
            stack: [
              { text: "CUSTOMER ACCEPTANCE", fontSize: 7.5, bold: true, color: QP.dim, characterSpacing: 1.2 },
              { canvas: [{ type: "line", x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.75, lineColor: QP.ink }], margin: [0, 34, 0, 4] },
              { text: "Signature & company stamp", fontSize: 8, color: QP.dim },
            ],
          },
          {
            width: "*",
            stack: [
              { text: `FOR ${COMPANY.name}`, fontSize: 7.5, bold: true, color: QP.ink, characterSpacing: 1.2 },
              { canvas: [{ type: "line", x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.75, lineColor: QP.ink }], margin: [0, 34, 0, 4] },
              { text: "Authorised signatory", fontSize: 8, color: QP.dim },
            ],
          },
        ],
        columnGap: 44,
        margin: [0, 30, 0, 0],
      },
    ],
  };
}

/** Build and download the PDF for one quote. */
export async function downloadQuotePdf(quote: Quote): Promise<void> {
  await downloadPdf(await buildQuoteDoc(quote), `${quote.quoteNo.replace(/[\\/]/g, "-")}.pdf`);
}
