/* ============================================================
   Dispatch Copy PDF — the printable record of one LoadBox (vehicle slot),
   styled to the same branded template as the Quotation (quotePdf.ts /
   quoteTemplate.ts): dark logo band, orange accents, right meta panel,
   dark item-table header, driver/company signatures, orange footer rule.
   Logistics doc — no money columns.
   ============================================================ */
import type { Content, ContentText, TDocumentDefinitions } from "pdfmake/interfaces";
import { downloadPdf } from "@/lib/pdf";
import { COMPANY, QP, logoDataUrl, prettyDate } from "@/features/quotes/quoteTemplate";
import type { LoadBox, PalPlan, PalPlanLine } from "./palPlansApi";

/* Same page metrics as quotePdf: design at 794px width, A4 → 0.75 scale. */
const M = 33;

const nfmt = (n: number) => n.toLocaleString("en-IN");

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

async function buildDispatchCopyDoc(box: LoadBox, entries: Array<{ p: PalPlan; l: PalPlanLine }>): Promise<TDocumentDefinitions> {
  const logo = await logoDataUrl();
  const label = box.vehicleNumber || `Container ${box.boxNumber}`;
  const total = entries.reduce((s, { l }) => s + l.boxes, 0);

  const lineRow = ({ l }: { l: PalPlanLine }, i: number): Content[] => [
    { ...td(String(i + 1).padStart(2, "0")), color: QP.dim },
    {
      stack: [
        { text: l.itemCode, fontSize: 8.5, bold: true, color: QP.ink },
        { text: l.designLabel, fontSize: 7, color: QP.dim },
        ...(l.batchNumber ? [{ text: `Batch ${l.batchNumber}`, fontSize: 7, color: QP.dim }] : []),
      ],
      margin: [0, 4, 0, 4],
    } as Content,
    td(l.customerName || "—"),
    td(l.soNumber || "—"),
    td(l.palletName && l.palletName !== "—" ? l.palletName : "—"),
    { ...td(nfmt(l.boxes), true), bold: true, color: QP.ink },
  ];

  return {
    pageSize: "A4",
    pageMargins: [M, 100, M, 58],
    defaultStyle: { fontSize: 8, color: QP.body },

    /* Full-bleed dark logo band (fills/borders on cells — pdfmake quirk). */
    header: {
      table: {
        widths: ["*", "auto"],
        body: [[
          { image: logo, width: 100, fillColor: QP.ink, border: [false, false, false, false], margin: [M, 18, 0, 16] },
          {
            stack: [
              { text: "DISPATCH COPY", fontSize: 19, bold: true, color: "#fff", characterSpacing: 4.5 },
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
      /* VEHICLE block + meta panel */
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "VEHICLE", fontSize: 7.5, bold: true, color: QP.orange, characterSpacing: 1.6, margin: [0, 0, 0, 5] },
              { text: label, fontSize: 13, bold: true, color: QP.ink, margin: [0, 0, 0, 2] },
              { text: [box.driverName, box.mobileNumber].filter(Boolean).join("  ·  ") || "Driver to be assigned", fontSize: 9, color: QP.body, lineHeight: 1.3 },
            ],
          },
          {
            width: 190,
            table: {
              widths: ["auto", "*"],
              body: ([
                ["CONTAINER NO.", `Container ${box.boxNumber}`, QP.ink],
                ["STATUS", box.status === "Dispatched" ? "Dispatched" : "Loading", box.status === "Dispatched" ? QP.orange : QP.ink],
                ["DISPATCH DATE", box.dispatchDate ? prettyDate(box.dispatchDate) : "—", QP.ink],
                ["TOTAL BOXES", nfmt(total), QP.ink],
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
          widths: [18, "*", 110, 74, 64, 44],
          body: [
            [th("#"), th("Product / Design"), th("Customer"), th("Sales Order"), th("Pallet"), th("Boxes", true)],
            ...entries.map(lineRow),
          ],
        },
        layout: {
          hLineWidth: (i: number) => (i > 1 ? 0.75 : 0),
          hLineColor: () => QP.line,
          vLineWidth: () => 0,
          paddingLeft: (i: number) => (i === 0 ? 6 : 3),
          paddingRight: (i: number) => (i === 5 ? 6 : 3), // last column
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
      },

      /* Total band */
      {
        unbreakable: true,
        columns: [
          { width: "*", text: "" },
          {
            width: 220,
            stack: [
              {
                table: {
                  widths: ["*", "auto"],
                  body: [[
                    { text: "TOTAL BOXES", fontSize: 8, bold: true, color: QP.orange, characterSpacing: 1.2, margin: [9, 8, 0, 8] },
                    { text: nfmt(total), fontSize: 13, bold: true, color: "#fff", alignment: "right", margin: [0, 5, 9, 5] },
                  ]],
                },
                layout: { defaultBorder: false, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0, fillColor: () => QP.ink },
              },
              { text: "Capacity is advisory — verify the physical count before sealing.", fontSize: 7, color: QP.dim, alignment: "right", margin: [0, 4, 0, 0] },
            ],
          },
        ],
        columnGap: 24,
        margin: [0, 10, 0, 0],
      },

      /* Signatures */
      {
        unbreakable: true,
        columns: [
          {
            width: "*",
            stack: [
              { text: "RECEIVED BY DRIVER", fontSize: 7.5, bold: true, color: QP.dim, characterSpacing: 1.2 },
              { canvas: [{ type: "line", x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.75, lineColor: QP.ink }], margin: [0, 34, 0, 4] },
              { text: "Signature & vehicle stamp", fontSize: 8, color: QP.dim },
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

/** Build + download the Dispatch Copy PDF for one load box. */
export async function downloadDispatchCopyPdf(box: LoadBox, entries: Array<{ p: PalPlan; l: PalPlanLine }>): Promise<void> {
  const label = box.vehicleNumber || `Container ${box.boxNumber}`;
  await downloadPdf(await buildDispatchCopyDoc(box, entries), `Dispatch-${label.replace(/[\s/]+/g, "-")}.pdf`);
}
