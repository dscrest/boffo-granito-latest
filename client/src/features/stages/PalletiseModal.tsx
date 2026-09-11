/* ============================================================
   Palletise dialog — confirms the pallet for the checked lines and moves
   them in one go (multi-item), normally to In Palletization (two-step
   flow since 2026-09-04; pallet-less legacy lines still pass through it
   on their way to Ready for Loading).
   Per line: identity + batch, a size-width-filtered pallet Combobox
   (prefilled from the SO/quote container plan when one exists), and a
   pallet distribution readout (full pallets + partial).
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { fmt } from "@/lib/format";
import { useModalA11y } from "@/ui/useModalA11y";
import { listPallets, palletsForSize, type PalletRow } from "@/features/masters/palletsApi";
import type { PalPlanLine } from "./palPlansApi";

export interface PalletiseEntry {
  lineId: string;
  palletId: string;
  /** Boxes to move (≤ line boxes). Less than the line's boxes = partial —
      the remainder stays behind in its current stage. */
  boxes: number;
}

export function PalletiseModal({
  lines,
  busy,
  toLabel = "Ready for Loading",
  defaultPalletFor,
  onConfirm,
  onClose,
}: {
  lines: PalPlanLine[];
  busy: boolean;
  /** Destination stage shown in the footer. */
  toLabel?: string;
  /** Fallback pallet per line (SO/quote container plan) — used only when the
      line has no saved pallet of its own; the user can still override. */
  defaultPalletFor?: (l: PalPlanLine) => string;
  onConfirm: (entries: PalletiseEntry[]) => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const [pallets, setPallets] = useState<PalletRow[]>([]);
  // The line's own saved pallet wins; the container plan only fills a blank.
  const [palletByLine, setPalletByLine] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.palletId || defaultPalletFor?.(l) || ""])),
  );
  // Boxes to move per line (string drafts) — defaults to the full line.
  const [boxesByLine, setBoxesByLine] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, String(l.boxes)])),
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

  const boxesOf = (l: PalPlanLine) => Math.min(Math.max(0, Math.floor(Number(boxesByLine[l.id]) || 0)), l.boxes);
  const entries: PalletiseEntry[] = lines.map((l) => ({
    lineId: l.id,
    palletId: palletByLine[l.id] || "",
    boxes: boxesOf(l),
  }));
  const missingPallet = entries.filter((e) => !e.palletId).length;
  const missingBoxes = entries.filter((e) => e.boxes <= 0).length;
  const totalBoxes = lines.reduce((s, l) => s + boxesOf(l), 0);

  const submit = () => {
    if (missingPallet > 0 || missingBoxes > 0) {
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
                // Size-matched pallets, plus the chosen one even if the size
                // filter would miss it (so the plan prefill always shows).
                const opts = palletsForSize(pallets, l.sizeCode);
                const chosen = palletByLine[l.id];
                if (chosen && !opts.some((p) => p.id === chosen)) {
                  const own = pallets.find((p) => p.id === chosen);
                  if (own) opts.unshift(own);
                }
                const cap = capOf(l.id);
                const moving = boxesOf(l);
                const full = cap > 0 ? Math.floor(moving / cap) : 0;
                const rem = cap > 0 ? moving % cap : 0;
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
                        <span className="chip mono" style={{ fontSize: 13 }}>Batch {l.batchNumber}</span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td className="num">
                      {/* Editable: palletise part of the line now, the rest later —
                          the remainder stays in its current stage. */}
                      <NumberInput
                        value={boxesByLine[l.id] ?? ""}
                        onChange={(e) => setBoxesByLine((p) => ({ ...p, [l.id]: e.target.value }))}
                        placeholder="0"
                        style={{ width: 84, textAlign: "right" }}
                        aria-label={`${l.designLabel} boxes to palletise`}
                        className={showErrors && boxesOf(l) <= 0 ? "error" : undefined}
                      />
                      {moving < l.boxes && (
                        <div className="dim" style={{ fontSize: "var(--t-xs)", marginTop: 2 }}>
                          of {fmt(l.boxes)} — {fmt(l.boxes - moving)} stay back
                        </div>
                      )}
                    </td>
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
            {showErrors && (missingPallet > 0 || missingBoxes > 0) ? (
              <span className="field-err">
                {missingPallet > 0 ? "Choose a pallet for every item" : "Enter the boxes to palletise for every item"}
              </span>
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
