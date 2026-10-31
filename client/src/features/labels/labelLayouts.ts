/* ============================================================
   Box label layouts (CR-502) — the three sticker shapes importers put on
   our boxes, as pdfmake content. A LabelTemplate row picks one layout +
   its size + the texts; the texts carry placeholders filled per box row.
   One label = one PDF page at the template's own size (thermal-roll
   friendly; an A4 sheet grid can come later without touching the data).
   A new sticker shape = one more entry in LAYOUTS.
   ============================================================ */
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { ean13Modules, isEan13 } from "@/lib/ean13";
import { barcodeProblem, code128Modules } from "@/lib/code128";
import { getOrg } from "@/lib/org";
import type { LabelLayoutKey, LabelTemplate } from "./labelsApi";

export const MM = 72 / 25.4; // pdfmake works in points

/** What one box row brings to the label (the print modal builds these). */
export interface LabelRow {
  item: string; // our design name
  customerItem: string; // the customer's name for it ("" → item)
  barcode: string; // the customer's own code, any text ("" = none on file)
  widthMm: number;
  lengthMm: number;
  thicknessMm: number;
  finish: string;
  batch: string;
  mfgDate: string; // ISO yyyy-mm-dd ("" = unknown)
}

export interface LabelField {
  key: string;
  label: string;
  multiline?: boolean;
  default: string;
}

export interface LabelLayout {
  key: LabelLayoutKey;
  label: string;
  defaultSize: [number, number]; // mm
  needsBarcode: boolean;
  fields: LabelField[];
  build: (texts: Record<string, string>, row: LabelRow, w: number, h: number) => Content;
}

export const PLACEHOLDERS = "{item} {ITEM} {customer_item} {CUSTOMER_ITEM} {width_cm} {length_cm} {thickness_cm} {thickness_mm} {finish} {batch} {mfg_date} {barcode}";

const cm = (mm: number) => (mm ? String(Math.round(mm) / 10).replace(/\.0$/, "") : "");
const ddmmyyyy = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);

/** Fill `{placeholders}` from the row; `decimal` swaps "." in numbers (0.88 → 0,88). */
export function fill(s: string, row: LabelRow, decimal = "."): string {
  const num = (v: string) => (decimal === "." ? v : v.replace(".", decimal));
  const ci = row.customerItem || row.item;
  const map: Record<string, string> = {
    item: row.item,
    ITEM: row.item.toUpperCase(),
    customer_item: ci,
    CUSTOMER_ITEM: ci.toUpperCase(),
    width_cm: cm(row.widthMm),
    length_cm: cm(row.lengthMm),
    thickness_cm: num(row.thicknessMm ? String(Math.round(row.thicknessMm * 10) / 100) : ""),
    thickness_mm: num(row.thicknessMm ? String(row.thicknessMm) : ""),
    finish: row.finish,
    batch: row.batch,
    mfg_date: ddmmyyyy(row.mfgDate),
    barcode: row.barcode,
  };
  return s.replace(/\{([a-z_A-Z]+)\}/g, (m, k: string) => (k in map ? map[k] : m));
}

/* ---- barcode as pdfmake canvas rects + human-readable text ----
   The customer's code is whatever they give us: a valid EAN-13 prints as EAN-13 (retail
   scanners, matches their cartons), anything else as Code 128.
   `availPt` = the column width the bars are centred in; the symbol takes up to 80 % of it. */
export function barcodeNode(code: string, availPt: number, heightPt: number): Content {
  if (!code) return { text: "No barcode", fontSize: 6, color: "#b00", alignment: "center" };
  const ean = isEan13(code);
  if (!ean && barcodeProblem(code)) return { text: `Cannot print ${code}`, fontSize: 6, color: "#b00", alignment: "center" };
  const mods = ean ? ean13Modules(code) : code128Modules(code);
  const quiet = 10; // modules of light margin each side — scanners need it
  // Plant printer = TSC TTP-244 Pro, 203 dpi: a bar must be a whole number of dots or the
  // head rounds bars unevenly and scans turn flaky — snap the module to the dot pitch.
  const DOT = (25.4 / 203) * MM;
  const mw = Math.max(DOT, Math.floor((availPt * 0.8) / (mods.length + quiet * 2) / DOT) * DOT);
  const symW = mods.length * mw;
  const textH = 8;
  const barH = Math.max(6, heightPt - textH);
  const canvas: { type: "rect"; x: number; y: number; w: number; h: number; color: string }[] = [];
  for (let i = 0; i < mods.length; i++) {
    if (mods[i] !== "1") continue;
    // EAN guard bars (0-2, 45-49, 92-94) run a little longer, as on every printed EAN
    const guard = ean && (i < 3 || (i >= 45 && i < 50) || i >= 92);
    canvas.push({ type: "rect", x: i * mw, y: 0, w: mw, h: guard ? barH + 3 : barH, color: "#000" });
  }
  const text = ean ? `${code[0]}   ${code.slice(1, 7)}   ${code.slice(7)}` : code;
  // A canvas ignores `alignment`; a fixed-width column between two star columns is what centres it,
  // and the digits sit in that same column so they line up under the bars.
  return {
    columns: [
      { width: "*", text: "" },
      { width: symW, stack: [{ canvas }, { text, fontSize: 7, alignment: "center", margin: [0, -1, 0, 0] }] },
      { width: "*", text: "" },
    ],
  };
}

/* ---- layouts ---- */
const T = (text: string, extra: Record<string, unknown> = {}): Content => ({ text, ...extra });

const barcodeStrip: LabelLayout = {
  key: "barcode-strip",
  label: "Barcode strip",
  defaultSize: [75, 20],
  needsBarcode: true,
  fields: [{ key: "title", label: "Title", default: "{CUSTOMER_ITEM} {width_cm}X{length_cm} CM" }],
  build: (t, row, w, h) => ({
    stack: [T(fill(t.title || "", row), { fontSize: 8, bold: true, alignment: "center", margin: [0, 0, 0, 1] }), barcodeNode(row.barcode, w, h - 14)],
  }),
};

const batchStrip: LabelLayout = {
  key: "batch-strip",
  label: "Batch strip",
  defaultSize: [75, 20],
  needsBarcode: false,
  fields: [
    { key: "line1", label: "Line 1", default: "{ITEM} ({finish})" },
    { key: "line2", label: "Line 2", default: "BATCH.NO-{batch}" },
    { key: "line3", label: "Line 3", default: "MFG.DATE:-{mfg_date}" },
    { key: "extra", label: "Extra marks", default: "" },
  ],
  build: (t, row) => ({
    stack: [
      T(fill(t.line1 || "", row), { fontSize: 10, bold: true, alignment: "center" }),
      T(fill(t.line2 || "", row), { fontSize: 9, bold: true, alignment: "center" }),
      T([fill(t.line3 || "", row), t.extra ? ` ${fill(t.extra, row)}` : ""].join(""), { fontSize: 8, bold: true, alignment: "center" }),
    ],
  }),
};

const specRow = (s: string, row: LabelRow, dec: string) => fill(s, row, dec).split("|").map((c) => c.trim());

const compliance: LabelLayout = {
  key: "compliance",
  label: "Compliance box label",
  defaultSize: [100, 60],
  needsBarcode: true,
  fields: [
    { key: "decimal", label: "Decimal separator", default: "." },
    { key: "product_type", label: "Product type", default: "Glazed porcelain tiles" },
    { key: "size_line", label: "Size line", default: "RECT {width_cm}x{length_cm}x{thickness_cm}cm" },
    { key: "item_line", label: "Item line", default: "{CUSTOMER_ITEM}" },
    { key: "grade", label: "Grade", default: "1st grade" },
    { key: "importer", label: "Importer", multiline: true, default: "Importer: " },
    { key: "standard", label: "Standard", default: "Applied standard: EN 14411:2016 Annex ZA" },
    { key: "ce", label: "CE mark (yes/no)", default: "yes" },
    { key: "product_code", label: "Product code line", default: "08 Dry-pressed ceramic glazed tiles" },
    { key: "group_line", label: "Group line", default: "BIa group (<0.5%) {width_cm} x {length_cm} x {thickness_cm} cm" },
    { key: "use", label: "Intended use", default: "Intended use: interior and exterior floors and walls" },
    { key: "spec_head", label: "Spec table header (a | b | c)", default: "Characteristic | Declared value | Test method" },
    { key: "spec_1", label: "Spec row 1 (a | b | c)", default: "Water absorption % | 0.35% | EN ISO 10545-3" },
    { key: "spec_2", label: "Spec row 2", default: "Bending strength N/mm2 | 42.04 N/mm2 | EN ISO 10545-4" },
    { key: "spec_3", label: "Spec row 3", default: "Fire class | A1fl | No test" },
    { key: "spec_4", label: "Spec row 4", default: "" },
    { key: "buyer_note", label: "Buyer note", multiline: true, default: "Check shade and quality before laying. No claims on laid tiles." },
    { key: "manufacturer", label: "Manufacturer", multiline: true, default: "" },
  ],
  build: (t, row, w, h) => {
    const dec = t.decimal || ".";
    const f = (k: string) => fill(t[k] || "", row, dec);
    const specs = ["spec_1", "spec_2", "spec_3", "spec_4"].filter((k) => (t[k] || "").trim());
    const S = 5.2; // body font size at 100×60 mm
    const left: Content = {
      stack: [
        T(f("product_type"), { fontSize: S }),
        T(f("size_line"), { fontSize: S, bold: true, alignment: "right" }),
        { columns: [T(f("item_line"), { fontSize: S + 2.5, bold: true, width: "*" }), T(f("grade"), { fontSize: S, width: "auto" })], margin: [0, 2, 0, 2] },
        T(f("importer"), { fontSize: S, alignment: "center", margin: [0, 1, 0, 3] }),
        barcodeNode(row.barcode, w * 0.5, 30),
        T(f("buyer_note"), { fontSize: S - 0.5, margin: [0, 3, 0, 0] }),
      ],
    };
    const right: Content = {
      stack: [
        { columns: [...(/^y/i.test(t.ce || "") ? [T("CE", { bold: true, fontSize: 9, width: "auto", margin: [0, 0, 3, 0] })] : []), T(f("standard"), { fontSize: S, bold: true, width: "*" })] },
        T(f("product_code"), { fontSize: S, margin: [0, 1, 0, 0] }),
        T(f("group_line"), { fontSize: S, bold: true }),
        T(f("use"), { fontSize: S, margin: [0, 1, 0, 2] }),
        {
          table: {
            widths: ["*", "*", "*"],
            body: [specRow(t.spec_head || "", row, dec).map((c) => T(c, { fontSize: S - 0.3, bold: true })), ...specs.map((k) => specRow(t[k], row, dec).map((c, i) => T(c, { fontSize: S - 0.3, bold: i === 1 })))],
          },
          layout: { hLineWidth: () => 0.4, vLineWidth: () => 0.4, paddingLeft: () => 1.5, paddingRight: () => 1.5, paddingTop: () => 0.8, paddingBottom: () => 0.8 },
        },
        T(f("manufacturer"), { fontSize: S - 0.5, margin: [0, 2, 0, 0] }),
      ],
    };
    return {
      table: { widths: ["*", "*"], heights: [h - 6], body: [[left, right]] },
      layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2 },
    };
  },
};

export const LAYOUTS: LabelLayout[] = [barcodeStrip, batchStrip, compliance];
export const layoutOf = (key: string): LabelLayout => LAYOUTS.find((l) => l.key === key) ?? barcodeStrip;

/** The texts a NEW template starts with — manufacturer from the Organization profile. */
export function defaultTexts(layout: LabelLayout): Record<string, string> {
  const o = getOrg();
  const t: Record<string, string> = {};
  for (const f of layout.fields) t[f.key] = f.default;
  if (layout.key === "compliance") t.manufacturer = ["Manufacturer:", o.legalName || o.name, o.address].filter(Boolean).join(" ");
  return t;
}

/** One PDF: a page per copy of each row, at the template's size.
    ponytail: one page per box — a 2,000-box batch is a 2,000-page PDF; switch to
    printer-driver copies if that turns out slow. */
export function buildLabelDoc(tpl: LabelTemplate, rows: { row: LabelRow; copies: number }[]): TDocumentDefinitions {
  const layout = layoutOf(tpl.layout);
  const W = (tpl.widthMm || layout.defaultSize[0]) * MM;
  const H = (tpl.heightMm || layout.defaultSize[1]) * MM;
  const m = 1.5 * MM;
  const content: Content[] = [];
  for (const { row, copies } of rows) {
    // Build EVERY copy afresh: pdfmake annotates nodes with layout state while it renders,
    // so one node pushed ten times draws once and leaves the other pages blank.
    for (let i = 0; i < Math.max(1, copies); i++) {
      const page = layout.build(tpl.texts, row, W - 2 * m, H - 2 * m);
      content.push(content.length ? ({ ...(page as object), pageBreak: "before" } as Content) : page);
    }
  }
  return { pageSize: { width: W, height: H }, pageMargins: [m, m, m, m], content, defaultStyle: { fontSize: 7 } };
}
