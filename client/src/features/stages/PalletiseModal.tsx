/* ============================================================
   Palletise dialog — moves the checked Ready-for-Palletization lines into
   Palletization in one go (multi-item; replaces the one-at-a-time drag +
   pallet picker). Per line: identity + batch, a size-width-filtered pallet
   Combobox, and a pallet distribution readout (full pallets + partial).
   A partial pallet can be topped up from ANY other Ready-for-Palletization
   line of the same size width (any item/batch) — the pair then shares the
   physical pallet and carries the Mix Batch marker (/pal-topup).
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { fmt } from "@/lib/format";
import { useModalA11y } from "@/ui/useModalA11y";
import { listPallets, palletsForSize, widthOf, type PalletRow } from "@/features/masters/palletsApi";
import type { PalPlanLine } from "./palPlansApi";

export interface PalletiseEntry {
  lineId: string;
  palletId: string;
  /** Top-up for this line's partial pallet from a donor Planning line. */
  topup?: { donorLineId: string; boxes: number };
}

export function PalletiseModal({
  lines,
  donors,
  busy,
  toLabel = "Palletization",
  onConfirm,
  onClose,
}: {
  lines: PalPlanLine[];
  /** Other Ready-for-Palletization lines — top-up candidates. */
  donors: PalPlanLine[];
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
  const [donorByLine, setDonorByLine] = useState<Record<string, string>>({});
  const [topupByLine, setTopupByLine] = useState<Record<string, number>>({});
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
  const donorById = new Map(donors.map((d) => [d.id, d]));

  // ponytail: one donor per partial, and each donor tops up one pallet — keeps
  // the clamps honest; multi-donor/multi-target splitting when someone asks.
  const donorOptions = (l: PalPlanLine) => {
    const w = widthOf(l.sizeCode);
    const claimed = new Set(
      Object.entries(donorByLine).filter(([lineId]) => lineId !== l.id).map(([, d]) => d),
    );
    return donors.filter((d) => !claimed.has(d.id) && (!w || widthOf(d.sizeCode) === w));
  };

  const setPallet = (lineId: string, pid: string) => {
    setPalletByLine((p) => ({ ...p, [lineId]: pid }));
    // Capacity changed → the old top-up clamp no longer holds; re-pick.
    setDonorByLine(({ [lineId]: _, ...rest }) => rest);
    setTopupByLine(({ [lineId]: _, ...rest }) => rest);
  };
  const setDonor = (l: PalPlanLine, donorId: string) => {
    setDonorByLine((p) => {
      const next = { ...p };
      if (donorId) next[l.id] = donorId;
      else delete next[l.id];
      return next;
    });
    const cap = capOf(l.id);
    const donor = donorById.get(donorId);
    const room = cap > 0 ? cap - (l.boxes % cap) : 0;
    setTopupByLine((p) => {
      const next = { ...p };
      if (donor && room > 0) next[l.id] = Math.min(donor.boxes, room);
      else delete next[l.id];
      return next;
    });
  };
  const setTopup = (l: PalPlanLine, raw: string) => {
    const donor = donorById.get(donorByLine[l.id] || "");
    const cap = capOf(l.id);
    const room = cap > 0 ? cap - (l.boxes % cap) : 0;
    const max = donor ? Math.min(donor.boxes, room) : 0;
    setTopupByLine((p) => ({ ...p, [l.id]: Math.max(0, Math.min(Number(raw) || 0, max)) }));
  };

  const entries: PalletiseEntry[] = lines.map((l) => {
    const donorId = donorByLine[l.id] || "";
    const boxes = topupByLine[l.id] || 0;
    return {
      lineId: l.id,
      palletId: palletByLine[l.id] || "",
      ...(donorId && boxes > 0 ? { topup: { donorLineId: donorId, boxes } } : {}),
    };
  });
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
                <th style={{ minWidth: 300 }}>Pallets</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const opts = palletsForSize(pallets, l.sizeCode);
                const cap = capOf(l.id);
                const full = cap > 0 ? Math.floor(l.boxes / cap) : 0;
                const rem = cap > 0 ? l.boxes % cap : 0;
                const donorId = donorByLine[l.id] || "";
                const donor = donorById.get(donorId);
                const dOpts = donorOptions(l);
                const room = cap > 0 ? cap - rem : 0;
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
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                          {rem > 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span className="dim" style={{ fontSize: "var(--t-sm)", flex: "0 0 auto" }}>Top up</span>
                              <span style={{ minWidth: 180, flex: 1 }}>
                                <Combobox
                                  value={donorId}
                                  options={dOpts.map((d) => ({
                                    value: d.id,
                                    label: `${d.itemCode} · ${d.designLabel}${d.batchNumber ? ` · ${d.batchNumber}` : ""} · ${fmt(d.boxes)} bx`,
                                  }))}
                                  onChange={(v) => setDonor(l, v)}
                                  placeholder={dOpts.length ? "Same-size item…" : "No same-size item waiting"}
                                  ariaLabel="Top-up item"
                                />
                              </span>
                              {donor && (
                                <NumberInput
                                  value={topupByLine[l.id] ?? ""}
                                  onChange={(e) => setTopup(l, e.target.value)}
                                  style={{ width: 80, textAlign: "right" }}
                                  title={`Boxes to add — up to ${fmt(Math.min(donor.boxes, room))}`}
                                />
                              )}
                              {donor && (topupByLine[l.id] || 0) > 0 && (
                                <span
                                  className="chip"
                                  style={{ fontSize: 11, color: "var(--c-amber)", borderColor: "var(--c-amber)" }}
                                  title={`${fmt(topupByLine[l.id] || 0)} boxes of ${donor.designLabel}${donor.batchNumber ? ` (batch ${donor.batchNumber})` : ""} share this pallet`}
                                >
                                  Mix Batch
                                </span>
                              )}
                            </div>
                          )}
                        </div>
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
