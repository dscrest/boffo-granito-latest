/* ============================================================
   Batch picker (CR-247, reshaped CR-256, pallets CR-258) — ONE modal, two uses:
   "Add Items in Bulk" (every Ready-for-Loading batch) and an Item Table
   row's Batches cell (that item's batches only). Left: entries (search,
   click to toggle). Right: the selection — a typed PALLETS count (no
   stepper, CR-260) + a tick for the loose remainder per batch; boxes stay the stored unit and are shown
   as the conversion. Mix Batch partners (one physical pallet, shared
   pallet_group) are ONE entry that moves whole. Opens on the page's
   current picks; Apply hands back the WHOLE selection for its scope — an
   entry left out goes back to 0.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { batchLabel, palletBoxesLabel, palletSplit, partialNote, pickerEntries, type PickEntry, type SoBand } from "./newLoadingRows";

/** The Mix Batch marker: one physical pallet shared by more than one batch/item. */
export const MxChip = () => (
  <span className="chip mx" style={{ marginLeft: 6 }} title="Mix Batch: one physical pallet shared by more than one batch/item">MXBATCH</span>
);

export function BulkLoadItemsModal({ bands, initial, title = "Add Items in Bulk", onAdd, onClose }: {
  /** The scope: every band, or one band narrowed to a single item. */
  bands: SoBand[];
  /** Boxes already picked per line id — the modal opens on them. */
  initial: Map<string, number>;
  title?: string;
  onAdd: (picks: { rowKey: string; lineId: string; boxes: number }[]) => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const [q, setQ] = useState("");
  const all = useMemo(() => pickerEntries(bands), [bands]);
  // The ONE state: boxes per line id (what /pal-lines-box takes). Pallets/loose are derived from it.
  const [sel, setSel] = useState<Map<string, number>>(
    () => new Map(all.flatMap((e) => e.lines.flatMap((p) => ((initial.get(p.line.id) || 0) > 0 ? [[p.line.id, initial.get(p.line.id)!] as [string, number]] : [])))),
  );

  const needle = q.trim().toLowerCase();
  const shown = needle ? all.filter((e) => `${e.title} ${e.lines.map((p) => p.line.batchNumber).join(" ")}`.toLowerCase().includes(needle)) : all;
  const isOn = (e: PickEntry) => e.lines.some((p) => sel.has(p.line.id));
  const picked = all.filter(isOn);
  const boxesOf = (e: PickEntry) => e.lines.reduce((s, p) => s + (sel.get(p.line.id) || 0), 0);
  const total = picked.reduce((s, e) => s + boxesOf(e), 0);
  // Summary in pallets: full pallets per entry, a Mix Batch entry = 1 pallet, loose as boxes.
  const totalPallets = picked.reduce((s, e) => s + (e.mixed ? 1 : palletSplit(boxesOf(e), e.bpp).pallets), 0);
  const totalLoose = picked.reduce((s, e) => s + (e.mixed ? 0 : palletSplit(boxesOf(e), e.bpp).loose), 0);

  const toggle = (e: PickEntry) =>
    setSel((prev) => {
      const m = new Map(prev);
      if (isOn(e)) for (const p of e.lines) m.delete(p.line.id);
      else for (const p of e.lines) m.set(p.line.id, p.line.boxes);
      return m;
    });
  /** Single-line entry: set its boxes; 0 deselects. */
  const setBoxes = (e: PickEntry, v: number) =>
    setSel((prev) => {
      const m = new Map(prev);
      const n = Math.min(e.boxes, Math.floor(v) || 0);
      if (n <= 0) m.delete(e.key);
      else m.set(e.key, n);
      return m;
    });
  // ponytail: an off-grid box count typed on the Item Table row shows as floor pallets + loose ticked; any click here normalises it.
  const setPallets = (e: PickEntry, pallets: number, looseOn: boolean) => {
    const max = palletSplit(e.boxes, e.bpp);
    const p = Math.max(0, Math.min(max.pallets, Math.floor(pallets) || 0));
    setBoxes(e, p * e.bpp + (looseOn ? max.loose : 0));
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 1100 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="plus" size={18} /></div>
          <div style={{ flex: 1, fontWeight: 600 }}>{title}</div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body bulk-pick">
          <div className="bulk-list">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search design, order or batch…" aria-label="Search items" />
            <div className="bulk-scroll">
              {shown.length === 0 && <div className="dim" style={{ padding: 12 }}>Nothing ready for loading.</div>}
              {shown.map((e) => {
                const on = isOn(e);
                return (
                  <div key={e.key}>
                    <button type="button" className={`bulk-item${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(e)}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="design-name">
                          {e.mixed ? e.lines[0].line.designLabel : e.title}
                          {e.mixed && <MxChip />}
                        </span>
                        <span className="dim mono" style={{ display: "block", fontSize: "var(--t-sm)" }}>
                          {e.mixed ? `One pallet shared by ${e.lines.length} batches` : batchLabel(e.lines[0].line)}
                          {!e.mixed && e.lines[0].partial && ` · ${partialNote(e.lines[0].partial)}`}
                        </span>
                      </span>
                      <span className="mono nw" style={{ textAlign: "right" }}>
                        <span className="dim" style={{ display: "block", fontSize: "var(--t-sm)" }}>Ready</span>
                        {e.mixed ? "1 pallet" : palletBoxesLabel(e.boxes, e.bpp)}
                        {(e.mixed || e.bpp > 0) && <span className="dim" style={{ display: "block", fontSize: "var(--t-sm)" }}>= {fmt(e.boxes)} boxes</span>}
                      </span>
                      <span className="bulk-tick">{on && <Icon name="check" size={12} />}</span>
                    </button>
                    {/* Tree: each batch/item on the shared pallet, under its parent. Clicking a child toggles the whole pallet. */}
                    {e.mixed && e.lines.map((p) => (
                      <button key={p.line.id} type="button" className={`bulk-item sub${on ? " on" : ""}`} tabIndex={-1} aria-hidden onClick={() => toggle(e)}>
                        <span className="mono" style={{ flex: 1, minWidth: 0 }}>└ {p.rowKey === e.lines[0].rowKey ? "" : `${p.line.designLabel} · `}{batchLabel(p.line)}</span>
                        <span className="mono nw">{fmt(p.line.boxes)} boxes</span>
                        <span style={{ width: 20, flex: "none" }} />
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bulk-sel">
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: "var(--t-lg)" }}>Selected Items</span>
              <span className="chip">{picked.length}</span>
              <span className="mono dim nw" style={{ marginLeft: "auto", fontSize: "var(--t-sm)" }}>
                Total: {totalPallets > 0 && `${fmt(totalPallets)} pallet${totalPallets === 1 ? "" : "s"}`}
                {totalPallets > 0 && totalLoose > 0 && " + "}
                {totalLoose > 0 && `${fmt(totalLoose)} boxes`}
                {total > 0 && ` · ${fmt(total)} boxes`}
              </span>
            </div>
            <div className="bulk-scroll">
              {picked.map((e) => {
                const v = boxesOf(e);
                const max = palletSplit(e.boxes, e.bpp);
                const cur = palletSplit(v, e.bpp);
                const looseOn = cur.loose > 0;
                const sub = e.mixed ? `One pallet shared by ${e.lines.length} batches` : batchLabel(e.lines[0].line);
                return (
                  <div key={e.key} className="bulk-row">
                    <span className="bulk-name">
                      <span className="design-name">{e.mixed ? e.lines[0].line.designLabel : e.title}{e.mixed && <MxChip />}</span>
                      <span className="dim mono" style={{ display: "block", fontSize: "var(--t-sm)" }}>{sub}</span>
                    </span>
                    {e.mixed ? (
                      <>
                        <span className="mono nw">1 pallet · {fmt(v)} boxes</span>
                        {e.lines.map((p) => (
                          <span key={p.line.id} className="mono sub" style={{ flexBasis: "100%", display: "flex", gap: 8 }}>
                            <span style={{ flex: 1 }}>└ {p.rowKey === e.lines[0].rowKey ? "" : `${p.line.designLabel} · `}{batchLabel(p.line)}</span>
                            <span>{fmt(p.line.boxes)} boxes</span>
                          </span>
                        ))}
                      </>
                    ) : e.bpp > 0 ? (
                      <>
                        <NumberInput
                          maxDecimals={0}
                          value={cur.pallets}
                          aria-label={`Pallets, ${e.title} batch ${sub}`}
                          title={`of ${fmt(max.pallets)} full pallets`}
                          onChange={(ev) => setPallets(e, Number(ev.target.value), looseOn)}
                          style={{ width: 72, textAlign: "right" }}
                        />
                        <span className="mono dim nw" style={{ fontSize: "var(--t-sm)" }}>pallets</span>
                        <span className="mono nw" style={{ fontSize: "var(--t-sm)" }}>
                          {max.loose > 0 ? (
                            <label className="nw" style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                              <input type="checkbox" checked={looseOn} onChange={(ev) => setPallets(e, cur.pallets, ev.target.checked)} />
                              + {fmt(max.loose)} loose
                            </label>
                          ) : (
                            <span className="dim">of {max.pallets}</span>
                          )}
                        </span>
                        <span className="mono dim nw" style={{ fontSize: "var(--t-sm)", minWidth: 80, textAlign: "right" }}>= {fmt(v)} boxes</span>
                      </>
                    ) : (
                      <>
                        <NumberInput
                          maxDecimals={0}
                          value={v}
                          aria-label={`Boxes, ${e.title} batch ${sub}`}
                          title={`of ${fmt(e.boxes)} boxes`}
                          onChange={(ev) => setBoxes(e, Number(ev.target.value))}
                          style={{ width: 80, textAlign: "right" }}
                        />
                        <span className="mono dim nw" style={{ fontSize: "var(--t-sm)" }}>boxes</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="hbtn primary"
            onClick={() => onAdd(picked.flatMap((e) => e.lines.filter((p) => sel.has(p.line.id)).map((p) => ({ rowKey: p.rowKey, lineId: p.line.id, boxes: sel.get(p.line.id)! }))))}
          >
            <Icon name="check" size={13} /> Apply
          </button>
        </div>
      </div>
    </div>
  );
}
