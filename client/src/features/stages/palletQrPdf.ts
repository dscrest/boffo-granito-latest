/* ============================================================
   Pallet QR label — one scannable sticker per LoadBox (container).
   The QR encodes a LINK to the public label page (#/share/box/<token>),
   not raw text: phones (iOS Camera especially) only render QR content
   richly when it's a URL — plain text gets sent to a web search. Scanning
   opens a clean, orderly page (items, destination, container, vehicle,
   salesperson tap-to-call) with no login. The same summary is printed
   below the code so the sticker is useful even unscanned.
   ============================================================ */
import { toDataURL } from "qrcode";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { downloadPdf } from "@/lib/pdf";
import { COMPANY, QP } from "@/features/quotes/quoteTemplate";
import { shareLoadBox, type LoadBox, type PalPlan, type PalPlanLine } from "./palPlansApi";

// ponytail: 100×150mm sticker stock, in points. Physical-printer knob — retune
// pageSize/QR width to your label roll.
const LABEL: [number, number] = [283, 425];
const M = 20;

const uniq = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))];

/** Human-readable summary printed under the QR (legible without scanning). */
function summaryLines(box: LoadBox, entries: Array<{ p: PalPlan; l: PalPlanLine }>): string[] {
  const items = entries.map(
    ({ l }) =>
      `${l.designLabel}${l.sizeCode ? ` ${l.sizeCode}` : ""} ×${l.boxes}${l.batchNumber ? ` [${l.batchNumber}]` : ""} → ${l.customerName || "?"}${l.countryCode ? ` (${l.countryCode})` : ""}`,
  );
  const dests = uniq(entries.map(({ l }) => `${l.customerName}${l.countryCode ? ` (${l.countryCode})` : ""}`));
  const reps = uniq(entries.map(({ p }) => `${p.salespersonName}${p.salespersonPhone ? ` ${p.salespersonPhone}` : ""}`));
  const vehicle = [box.vehicleNumber, box.driverName, box.mobileNumber].filter(Boolean).join(" · ");

  const lines = [`Container: ${box.containerNumber || "—"}`];
  if (vehicle) lines.push(`Vehicle: ${vehicle}`);
  lines.push("", "Items:", ...items.map((t) => `• ${t}`), "");
  lines.push(`Destination: ${dests.join("; ") || "—"}`);
  lines.push(`Sales: ${reps.join("; ") || "—"}`);
  return lines;
}

async function buildDoc(box: LoadBox, entries: Array<{ p: PalPlan; l: PalPlanLine }>, url: string): Promise<TDocumentDefinitions> {
  const qr = await toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 600 });
  const total = entries.reduce((s, { l }) => s + l.boxes, 0);

  const summary: Content = {
    stack: summaryLines(box, entries).map((t) => ({
      text: t || " ",
      fontSize: t.startsWith("•") ? 7.5 : 8,
      bold: /^(Container:|Vehicle:|Destination:|Sales:|Items:)/.test(t),
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
          { width: "*", text: `Container ${box.boxNumber}`, fontSize: 11, bold: true, color: QP.ink },
          { width: "auto", text: `${total} box`, fontSize: 9, color: QP.dim, alignment: "right" },
        ],
        margin: [0, 2, 0, 6],
      },
      { text: "Scan for shipment details", fontSize: 7.5, color: QP.dim, alignment: "center", margin: [0, 0, 0, 4] },
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

/** Build + download the pallet QR label for one load box / container.
    Mints the box's public share token first, so the QR links to its live page. */
export async function downloadPalletQrPdf(box: LoadBox, entries: Array<{ p: PalPlan; l: PalPlanLine }>): Promise<void> {
  const token = await shareLoadBox(box.id);
  const url = `${window.location.origin}${window.location.pathname}#/share/box/${token}`;
  await downloadPdf(await buildDoc(box, entries, url), `Pallet-QR-Container-${box.boxNumber}.pdf`);
}
