/* ============================================================
   Dispatch Entry — post-dispatch printable sheet (claude.ai/design
   "Dispatch Board", 2026-08-17). Opens right after a box dispatches:
   header with the box QR (same share link as the pallet label), vehicle /
   driver fields editable for the printout only (never persisted — the
   Vehicle master stays the source of truth), the loaded lines, totals and
   signature blocks. Rendered through a body portal so the @media print
   rules hide the app chrome and emit only the sheet (QuotePrint pattern).
   ============================================================ */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/ui/Icon";
import { fmt } from "@/lib/format";
import { shareLoadBox, type LoadBox, type PalPlan, type PalPlanLine } from "./palPlansApi";

type Entry = { p: PalPlan; l: PalPlanLine };

export function DispatchEntryOverlay({ box, entries, onClose }: { box: LoadBox; entries: Entry[]; onClose: () => void }) {
  const [vehicle, setVehicle] = useState(box.vehicleNumber);
  const [driver, setDriver] = useState(box.driverName);
  const [phone, setPhone] = useState(box.mobileNumber);
  const [qr, setQr] = useState<string | null>(null);
  const [qrErr, setQrErr] = useState(false);

  // The box often arrives before the post-dispatch refetch fills in the
  // vehicle just assigned — adopt the fields once they land, unless typed over.
  useEffect(() => {
    setVehicle((v) => v || box.vehicleNumber);
    setDriver((v) => v || box.driverName);
    setPhone((v) => v || box.mobileNumber);
  }, [box.vehicleNumber, box.driverName, box.mobileNumber]);

  // Box QR = the same public share link the pallet label prints.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const token = await shareLoadBox(box.id);
        const url = `${location.origin}${location.pathname}#/share/box/${token}`;
        const { toDataURL } = await import("qrcode");
        const data = await toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 240 });
        if (alive) setQr(data);
      } catch {
        if (alive) setQrErr(true); // offline print still works without the QR
      }
    })();
    return () => {
      alive = false;
    };
  }, [box.id]);

  const totalBoxes = entries.reduce((s, { l }) => s + l.boxes, 0);
  const date = (box.dispatchDate || "").slice(0, 10) || new Date().toISOString().slice(0, 10);

  return createPortal(
    <div className="qprint-overlay" onClick={onClose}>
      <div className="qprint-bar" onClick={(e) => e.stopPropagation()}>
        <span className="mono dim">Container {box.boxNumber}</span>
        <div style={{ flex: 1 }} />
        <button
          className="hbtn"
          onClick={() => void import("./dispatchCopyPdf").then((m) => m.downloadDispatchCopyPdf(box, entries))}
        >
          <Icon name="printer" size={13} /> Download PDF
        </button>
        <button className="hbtn" onClick={onClose}>
          <Icon name="x" size={13} /> Close
        </button>
        <button className="hbtn primary" onClick={() => window.print()}>
          <Icon name="printer" size={13} /> Print
        </button>
      </div>

      <div className="dentry-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="dentry-head">
          <div>
            <div className="dentry-title">Dispatch Entry</div>
            <div className="dentry-sub mono">
              Container {box.boxNumber}
              {box.containerNumber ? ` · ${box.containerNumber}` : ""}
            </div>
          </div>
          <div className="dentry-headmeta">
            <div><b>{vehicle || "—"}</b>{driver ? ` · ${driver}` : ""}</div>
            <div>Date: {date}</div>
          </div>
          {qr ? (
            <img src={qr} alt="Dispatch QR" width={76} height={76} style={{ flexShrink: 0 }} />
          ) : (
            qrErr && <span className="dentry-dim">QR unavailable</span>
          )}
        </header>

        <div className="dentry-fields">
          <label>
            Vehicle number
            <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="—" />
          </label>
          <label>
            Driver name
            <input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="—" />
          </label>
          <label>
            Driver contact
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="—" />
          </label>
        </div>

        <table className="dentry-table">
          <thead>
            <tr>
              <th>Pallet</th>
              <th>Item</th>
              <th>Customer · SO</th>
              <th>Batch</th>
              <th style={{ textAlign: "right" }}>Boxes</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ l }) => (
              <tr key={l.id}>
                <td className="mono" style={{ fontWeight: 600 }}>{l.itemCode}</td>
                <td>{l.designLabel}</td>
                <td>
                  {l.customerName || "—"}
                  <div className="dentry-dim mono">{l.soNumber || "—"}</div>
                </td>
                <td className="mono">{l.batchNumber || "—"}</td>
                <td className="mono" style={{ textAlign: "right" }}>{fmt(l.boxes)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="dentry-total">
          Total: {entries.length} pallet{entries.length === 1 ? "" : "s"} · {fmt(totalBoxes)} boxes
          <span>Scan the QR to pull this dispatch on any device.</span>
        </div>

        <div className="dentry-sign">
          <div>Loaded by</div>
          <div>Checked by</div>
          <div>Driver signature</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
