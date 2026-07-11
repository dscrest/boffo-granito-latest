/* ============================================================
   pdf — lazy pdfmake loader + shared document helpers.

   pdfmake (and its ~2MB embedded font VFS) is dynamically imported
   so it never lands in the main bundle; first download pays the
   fetch, later ones reuse the cached module.
   ============================================================ */
import type { TDocumentDefinitions, Content, StyleDictionary } from "pdfmake/interfaces";

let pdfMakePromise: Promise<typeof import("pdfmake/build/pdfmake")> | null = null;

async function getPdfMake() {
  if (!pdfMakePromise) {
    pdfMakePromise = (async () => {
      const [{ default: pdfMake }, fonts] = await Promise.all([
        import("pdfmake/build/pdfmake"),
        import("pdfmake/build/vfs_fonts"),
      ]);
      // 0.3.x exports the vfs object directly (module default); 0.2.x exposes
      // { vfs }; older builds expose { pdfMake: { vfs } }.
      const f = fonts as {
        vfs?: Record<string, string>;
        pdfMake?: { vfs: Record<string, string> };
        default?: Record<string, string>;
      };
      const vfs = f.vfs ?? f.pdfMake?.vfs ?? f.default;
      const pm = pdfMake as unknown as {
        vfs?: Record<string, string>;
        addVirtualFileSystem?: (v: Record<string, string>) => void;
      };
      if (vfs) {
        if (pm.addVirtualFileSystem) pm.addVirtualFileSystem(vfs);
        else pm.vfs = vfs;
      }
      return pdfMake;
    })();
  }
  return pdfMakePromise;
}

/** Build and trigger a browser download of the given pdfmake document. */
export async function downloadPdf(doc: TDocumentDefinitions, filename: string): Promise<void> {
  const pdfMake = await getPdfMake();
  pdfMake.createPdf(doc).download(filename);
}

/** Render the document to a data: URL for inline preview (iframe src). */
export async function pdfDataUrl(doc: TDocumentDefinitions): Promise<string> {
  const pdfMake = await getPdfMake();
  return pdfMake.createPdf(doc).getDataUrl();
}

/* ---------------- shared look & feel ---------------- */

export const PDF_STYLES: StyleDictionary = {
  brand: { fontSize: 18, bold: true, color: "#1a1a2e" },
  docTitle: { fontSize: 13, bold: true, color: "#444" },
  h2: { fontSize: 10, bold: true, color: "#666", margin: [0, 10, 0, 4] },
  meta: { fontSize: 9, color: "#444" },
  th: { fontSize: 8.5, bold: true, color: "#fff", fillColor: "#2d2d44" },
  td: { fontSize: 9 },
  tdNum: { fontSize: 9, alignment: "right" },
  totLabel: { fontSize: 9, color: "#555", alignment: "right" },
  totVal: { fontSize: 9, bold: true, alignment: "right" },
  grand: { fontSize: 11, bold: true, alignment: "right", color: "#1a1a2e" },
  fine: { fontSize: 8, color: "#777" },
};

/** Standard BOFFO letterhead row: brand left, doc title + number right. */
export function pdfHeader(docTitle: string, docNumber: string): Content {
  return {
    columns: [
      { stack: [{ text: "BOFFO", style: "brand" }, { text: "Order OS · Plant Morbi", style: "fine" }] },
      {
        stack: [
          { text: docTitle, style: "docTitle", alignment: "right" },
          { text: docNumber, style: "meta", alignment: "right" },
        ],
      },
    ],
    margin: [0, 0, 0, 14],
  };
}

/** "label: value" meta line, skipping empty values. */
export function metaLines(pairs: Array<[string, string | undefined]>): Content {
  return {
    stack: pairs
      .filter(([, v]) => v)
      .map(([k, v]) => ({ text: [{ text: `${k}: `, bold: true }, { text: v as string }], style: "meta" })),
  };
}

export const money = (n: number): string =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
