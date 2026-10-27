/* ============================================================
   pdf — lazy pdfmake loader + shared document helpers.

   pdfmake (and its ~2MB embedded font VFS) is dynamically imported
   so it never lands in the main bundle; first download pays the
   fetch, later ones reuse the cached module.
   ============================================================ */
import type { TDocumentDefinitions, Content, StyleDictionary } from "pdfmake/interfaces";
import { getOrg } from "@/lib/org";

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

/* Image → data URL pdfmake accepts (CR-474). PNG / JPEG pass through; anything else
   (webp, gif, avif uploads) is re-encoded to PNG on a canvas from the fetched blob —
   createImageBitmap(blob) never taints the canvas, whatever origin the bytes came from.
   Long edge capped at 1600px so a phone photo does not bloat the PDF. "" on any failure
   (builders print a placeholder). Cached per URL. */
const imageCache = new Map<string, Promise<string>>();
export function imageDataUrl(url: string): Promise<string> {
  let p = imageCache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const blob = await (await fetch(url)).blob();
        if (blob.type === "image/png" || blob.type === "image/jpeg") {
          return await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(new Error("Could not read image"));
            fr.readAsDataURL(blob);
          });
        }
        const bmp = await createImageBitmap(blob);
        const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bmp.width * scale);
        canvas.height = Math.round(bmp.height * scale);
        canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png");
      } catch {
        return "";
      }
    })();
    imageCache.set(url, p);
  }
  return p;
}

/** Build and trigger a browser download of the given pdfmake document. */
export async function downloadPdf(doc: TDocumentDefinitions, filename: string): Promise<void> {
  const pdfMake = await getPdfMake();
  pdfMake.createPdf(doc).download(filename);
}

/** Render the document to a blob: URL for inline preview (iframe src) —
    much lighter than a base64 data: URL. Caller revokes when replacing. */
export async function pdfBlobUrl(doc: TDocumentDefinitions): Promise<string> {
  const pdfMake = await getPdfMake();
  const blob = await pdfMake.createPdf(doc).getBlob();
  return URL.createObjectURL(blob);
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

/** Standard letterhead row: brand (Settings ▸ Organization, CR-445) left, doc title + number right. */
export function pdfHeader(docTitle: string, docNumber: string): Content {
  return {
    columns: [
      { stack: [{ text: getOrg().name, style: "brand" }, { text: "Order OS", style: "fine" }] },
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
