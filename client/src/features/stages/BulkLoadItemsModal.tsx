/* ============================================================
   Batch picker (CR-247, reshaped CR-256) — ONE modal, two uses:
   "Add Items in Bulk" (every Ready-for-Loading batch) and an Item Table
   row's Batches cell (that item's batches only). Left: batches (search,
   click to toggle). Right: the selection with a boxes stepper each.
   Opens on the page's current picks; Apply hands back the WHOLE
   selection for its scope — a batch left out goes back to 0.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { bandLabel, batchLabel, partialNote, type SoBand } from "./newLoadingRows";

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
  const all = useMemo(
    () => bands.flatMap((b) => b.designs.flatMap((r) => r.lines.map((p) => ({ ...p, rowKey: r.key, title: `${r.designLabel} · ${bandLabel(b)}` })))),
    [bands],
  );
  const [sel, setSel] = useState<Map<string, number>>(() => new Map(all.flatMap((x) => ((initial.get(x.line.id) || 0) > 0 ? [[x.line.id, initial.get(x.line.id)!] as [string, number]] : []))));

  const needle = q.trim().toLowerCase();
  const shown = needle ? all.filter((x) => `${x.title} ${x.line.batchNumber}`.toLowerCase().includes(needle)) : all;
  const picked = all.filter((x) => sel.has(x.line.id));
  const total = picked.reduce((s, x) => s + sel.get(x.line.id)!, 0);

  const toggle = (id: string, boxes: number) =>
    setSel((p) => {
      const m = new Map(p);
      if (!m.delete(id)) m.set(id, boxes);
      return m;
    });
  const setBoxes = (id: string, max: number, v: number) => setSel((p) => new Map(p).set(id, Math.max(1, Math.min(max, Math.floor(v) || 1))));

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 920 }} onClick={(e) => e.stopPropagation()}>
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
              {shown.map((x) => {
                const on = sel.has(x.line.id);
                return (
                  <button
                    key={x.line.id}
                    type="button"
                    className={`bulk-item${on ? " on" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggle(x.line.id, x.line.boxes)}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="design-name">{x.title}</span>
                      <span className="dim mono" style={{ display: "block", fontSize: "var(--t-sm)" }}>
                        {batchLabel(x.line)}
                        {x.partial && ` · ${partialNote(x.partial)}`}
                      </span>
                    </span>
                    <span className="mono nw" style={{ textAlign: "right" }}>
                      <span className="dim" style={{ display: "block", fontSize: "var(--t-sm)" }}>Ready</span>
                      {fmt(x.line.boxes)} boxes
                    </span>
                    <span className="bulk-tick">{on && <Icon name="check" size={12} />}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bulk-sel">
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: "var(--t-lg)" }}>Selected Items</span>
              <span className="chip">{picked.length}</span>
              <span className="mono dim" style={{ marginLeft: "auto", fontSize: "var(--t-sm)" }}>Total boxes: {fmt(total)}</span>
            </div>
            <div className="bulk-scroll">
              {picked.map((x) => {
                const v = sel.get(x.line.id)!;
                return (
                  <div key={x.line.id} className="bulk-row">
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="design-name">{x.title}</span>
                      <span className="dim mono" style={{ display: "block", fontSize: "var(--t-sm)" }}>{batchLabel(x.line)}</span>
                    </span>
                    <button type="button" className="btn x" aria-label="Fewer boxes" onClick={() => setBoxes(x.line.id, x.line.boxes, v - 1)}>−</button>
                    <NumberInput
                      maxDecimals={0}
                      value={v}
                      aria-label={`Boxes, ${x.title} batch ${batchLabel(x.line)}`}
                      onChange={(e) => setBoxes(x.line.id, x.line.boxes, Number(e.target.value))}
                      style={{ width: 80, textAlign: "right" }}
                    />
                    <button type="button" className="btn x" aria-label="More boxes" onClick={() => setBoxes(x.line.id, x.line.boxes, v + 1)}>+</button>
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
                        onClick={() => onAdd(picked.map((x) => ({ rowKey: x.rowKey, lineId: x.line.id, boxes: sel.get(x.line.id)! })))}
          >
            <Icon name="check" size={13} /> Apply
          </button>
        </div>
      </div>
    </div>
  );
}
