/* ============================================================
   Load Copy PDF (CR-351) — the printable record of ONE panel / sample
   order's row on a vehicle trip (PanelLoad): LD number, date, order,
   customer, the VEHICLE block (number · driver · mobile — the fields the
   floor needs on paper), line × material × qty × stamped kg, note,
   driver / company signatures. Same branded template as the container
   Dispatch Copy (stages/dispatchCopyPdf.ts). Logistics doc — no money.
   ============================================================ */
import type { Content, ContentText, TDocumentDefinitions } from "pdfmake/interfaces";
import { downloadPdf } from "@/lib/pdf";
import { COMPANY, QP, logoDataUrl, prettyDate } from "@/features/quotes/quoteTemplate";
import { MATERIAL_LABEL, pieceLabel, type LoadRow } from "./panelOrdersApi";
import { lineLabel, type LoadableOrder } from "./PanelLoads";

const M = 33;
const nfmt = (n: number) => n.toLocaleString("en-IN");
const kg = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100) / 100} kg`);

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
const td = (text: string, right = false): ContentText => ({ text, fontSize: 8, color: QP.body, alignment: right ? "right" : "left", margin: [0, 4, 0, 4] });

async function buildLoadCopyDoc(order: LoadableOrder, ld: LoadRow): Promise<TDocumentDefinitions> {
  const logo = await logoDataUrl();
  const totalQty = ld.lines.reduce((s, l) => s + l.qty, 0);
  const totalKg = ld.lines.every((l) => l.weightKg != null) ? ld.lines.reduce((s, l) => s + (l.weightKg ?? 0), 0) : null;

  const lineRow = (l: LoadRow["lines"][number], i: number): Content[] => [
    { ...td(String(i + 1).padStart(2, "0")), color: QP.dim },
    { ...td(lineLabel(order, l.lineId)), bold: true, color: QP.ink },
    // CR-405: a panel's pieces print per kind ("Grey · 300x300"); boards and legacy whole-panel lines keep the material word.
    td(l.material === "Item" && l.designName && order.type === "Panel" && order.lines.find((x) => x.id === l.lineId)?.panelId ? pieceLabel(l) : MATERIAL_LABEL[l.material]),
    { ...td(nfmt(l.qty), true), bold: true, color: QP.ink },
    td(kg(l.weightKg), true),
  ];

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
              { text: "LOAD COPY", fontSize: 19, bold: true, color: "#fff", characterSpacing: 4.5 },
              { columns: [{ width: "*", text: "" }, { width: 48, canvas: [{ type: "rect", x: 0, y: 0, w: 48, h: 3, color: QP.orange }] }], margin: [0, 5, 0, 0] },
            ],
            fillColor: QP.ink,
            border: [false, false, false, false],
            margin: [0, 24, M, 16],
          },
        ]],
      },
    },
    footer: {
      stack: [
        { canvas: [{ type: "rect", x: 0, y: 0, w: 595.28, h: 2.5, color: QP.orange }] },
        {
          table: {
            widths: ["auto", "*", "auto"],
            body: [[
              { text: COMPANY.name, fontSize: 7, bold: true, color: QP.ink, characterSpacing: 0.9, fillColor: QP.paper, border: [false, false, false, false], margin: [M, 8, 0, 8] },
              { text: COMPANY.addressTax, fontSize: 7, color: QP.dim, alignment: "center", fillColor: QP.paper, border: [false, false, false, false], margin: [0, 8, 0, 8] },
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
              { text: ld.vehicle || "—", fontSize: 13, bold: true, color: QP.ink, margin: [0, 0, 0, 2] },
              { text: `Driver: ${ld.driverName || "—"}`, fontSize: 9, color: QP.body, lineHeight: 1.3 },
              { text: `Mobile: ${ld.driverMobile || "—"}`, fontSize: 9, color: QP.body, lineHeight: 1.3 },
              ...(ld.note ? [{ text: ld.note, fontSize: 8, color: QP.dim, margin: [0, 6, 0, 0] } as Content] : []),
            ],
          },
          {
            width: 210,
            table: {
              widths: ["auto", "*"],
              body: ([
                ["LOAD NO.", ld.loadNumber || "—", QP.orange],
                ["LOAD DATE", ld.date ? prettyDate(ld.date) : "—", QP.ink],
                [order.type === "Panel" ? "PANEL ORDER" : "SAMPLE ORDER", order.orderNumber || "—", QP.ink],
                ["CUSTOMER", order.customerName || "—", QP.ink],
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
      /* Lines */
      {
        table: {
          headerRows: 1,
          widths: [18, "*", 90, 60, 70],
          body: [[th("#"), th("Line"), th("Material"), th("Qty", true), th("Weight", true)], ...ld.lines.map(lineRow)],
        },
        layout: {
          hLineWidth: (i: number) => (i > 1 ? 0.75 : 0),
          hLineColor: () => QP.line,
          vLineWidth: () => 0,
          paddingLeft: (i: number) => (i === 0 ? 6 : 3),
          paddingRight: (i: number) => (i === 4 ? 6 : 3),
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
            width: 240,
            table: {
              widths: ["*", "auto"],
              body: [[
                { text: "TOTAL", fontSize: 8, bold: true, color: QP.orange, characterSpacing: 1.2, margin: [9, 8, 0, 8] },
                { text: `${nfmt(totalQty)} units · ${kg(totalKg)}`, fontSize: 11, bold: true, color: "#fff", alignment: "right", margin: [0, 6, 9, 6] },
              ]],
            },
            layout: { defaultBorder: false, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0, fillColor: () => QP.ink },
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

/** Build + download the Load Copy PDF for one order's row of a trip. */
export async function downloadPanelLoadCopyPdf(order: LoadableOrder, ld: LoadRow): Promise<void> {
  const tag = `${ld.loadNumber || "Load"}-${order.orderNumber || order.id}`.replace(/[\s/]+/g, "-");
  await downloadPdf(await buildLoadCopyDoc(order, ld), `LoadCopy-${tag}.pdf`);
}
