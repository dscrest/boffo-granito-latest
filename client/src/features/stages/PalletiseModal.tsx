/* ============================================================
   Palletise dialog — moves the checked Ready-for-Palletization lines into
   Palletization in one go (multi-item; replaces the one-at-a-time drag +
   pallet picker). Per line: identity + batch, a size-width-filtered pallet
   Combobox, and a pallet distribution readout (full pallets + partial).
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { fmt } from "@/lib/format";
import { useModalA11y } from "@/ui/useModalA11y";
import { listPallets, palletsForSize, type PalletRow } from "@/features/masters/palletsApi";
import type { PalPlanLine } from "./palPlansApi";

export interface PalletiseEntry {
  lineId: string;
  palletId: string;
}

export function PalletiseModal({
  lines,
  busy,
  toLabel = "Palletization",
  onConfirm,
  onClose,
}: {
  lines: PalPlanLine[];
  busy: boolean;
  /** Destination stage shown in the footer (Mark-ready routes here too). */
  toLabel?: string;
  onConfirm: (entries: PalletiseEntry[]) => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const [pallets, setPallets] = useState<PalletRow[]>([]);
  const [palletByLine, setPalletByLine] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.palletId])),
  );
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    let alive = true;
    void listPallets().then((r) => {
      if (alive && r.ok) setPallets(r.pallets);
    });
    return () => {
      alive = false;
    };
  }, []);

  const palletById = new Map(pallets.map((p) => [p.id, p]));
  // Distribution is per PHYSICAL pallet (boxes_per_pallet), not per container.
  const capOf = (lineId: string) => palletById.get(palletByLine[lineId] || "")?.boxesPerPallet || 0;

  const setPallet = (lineId: string, pid: string) => setPalletByLine((p) => ({ ...p, [lineId]: pid }));

  const entries: PalletiseEntry[] = lines.map((l) => ({
    lineId: l.id,
    palletId: palletByLine[l.id] || "",
  }));
  const missingPallet = entries.filter((e) => !e.palletId).length;
  const totalBoxes = lines.reduce((s, l) => s + l.boxes, 0);

  const submit = () => {
    if (missingPallet > 0) {
      setShowErrors(true);
      return;
    }
    onConfirm(entries);
  };

  return (
    <div className="modal-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="modal-panel card df-modal"
        style={{ maxWidth: 980 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="df-head">
          <div className="ico"><Icon name="package" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Palletise · {lines.length} item{lines.length === 1 ? "" : "s"}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <table className="tbl">
            <thead>
              <tr>
                <th>Item</th>
                <th>Batch</th>
                <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                <th style={{ minWidth: 240 }}>Pallet</th>
                <th style={{ minWidth: 180 }}>Pallets</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const opts = palletsForSize(pallets, l.sizeCode);
                const cap = capOf(l.id);
                const full = cap > 0 ? Math.floor(l.boxes / cap) : 0;
                const rem = cap > 0 ? l.boxes % cap : 0;
                return (
                  <tr key={l.id}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600 }}>{l.itemCode}</span>
                      <div className="design-name">{l.designLabel}</div>
                      <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                        {[l.customerName, l.soNumber, l.sizeCode].filter(Boolean).join("  ·  ") || "—"}
                      </div>
                    </td>
                    <td>
                      {l.batchNumber ? (
                        <span className="chip mono" style={{ fontSize: 11 }}>Batch {l.batchNumber}</span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td className="num mono">{fmt(l.boxes)}</td>
                    <td>
                      <Combobox
                        value={palletByLine[l.id] || ""}
                        options={opts.map((p) => ({ value: p.id, label: p.name }))}
                        onChange={(v) => setPallet(l.id, v)}
                        placeholder={opts.length ? "Choose pallet…" : "No matching pallet"}
                        invalid={showErrors && !palletByLine[l.id]}
                      />
                    </td>
                    <td>
                      {cap > 0 ? (
                        <span style={{ fontSize: "var(--t-sm)" }}>
                          {full > 0 && <strong>{full} full pallet{full === 1 ? "" : "s"}</strong>}
                          {full > 0 && rem > 0 && " + "}
                          {rem > 0 && (
                            <span>
                              partial <span className="mono">{fmt(rem)}/{fmt(cap)}</span>
                            </span>
                          )}
                          {full > 0 && rem === 0 && " — exact fit"}
                        </span>
                      ) : (
                        <span className="dim" style={{ fontSize: "var(--t-sm)" }}>Choose a pallet to see the split</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && missingPallet > 0 ? (
              <span className="field-err">Choose a pallet for every item</span>
            ) : (
              `${fmt(totalBoxes)} boxes · ${lines.length} item${lines.length === 1 ? "" : "s"} → ${toLabel}`
            )}
          </span>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="hbtn primary" disabled={busy} onClick={submit}>
            <Icon name="check" size={13} />
            {busy ? "Saving…" : "Palletise"}
          </button>
        </div>
      </div>
    </div>
  );
}
