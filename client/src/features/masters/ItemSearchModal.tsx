/* ============================================================
   Item search modal (CR-434) — the "bigger search surface" behind the
   🔍 beside an item-name picker (Base Design Name on the Item form).
   Mirrors CustomerSearchModal: search box over a table of Active items;
   a row click (or Enter) picks it. The caller decides what to store
   (Base Design stores the picked item's NAME, not its id).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import { cachedDesigns, type DesignRow } from "./designsApi";

export function ItemSearchModal({
  onPick,
  onClose,
  exclude,
  filter,
}: {
  onPick: (d: DesignRow) => void;
  onClose: () => void;
  /** Item ROWID to leave out (the item being edited can't be its own base). */
  exclude?: string;
  filter?: (d: DesignRow) => boolean;
}) {
  const panelRef = useModalA11y(onClose);
  const [q, setQ] = useState("");
  // Every typed word must appear somewhere in the row (same token rule as the Combobox).
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (d: DesignRow) =>
    `${d.designName} ${d.baseDesignName} ${d.sku} ${d.uniqueName} ${d.collectionName} ${d.sizeLabel} ${d.partyBrandName}`.toLowerCase();
  const rows = (cachedDesigns() || [])
    .filter((d) => d.status === "Active" && d.id !== exclude && (!filter || filter(d)))
    .filter((d) => tokens.every((t) => hay(d).includes(t)))
    .sort((a, b) => a.designName.localeCompare(b.designName));
  const pick = (d: DesignRow) => {
    onPick(d);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Search items" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="search" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div className="ttl">Search Items</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
            <div className="lp-search">
              <Icon name="search" size={13} />
              <input type="text" placeholder="Search by name, SKU, size, collection, brand…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
            </div>
            <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Design Name</th>
                    <th>SKU</th>
                    <th>Size</th>
                    <th>Collection</th>
                    <th>Customer Brand</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="dim">No items match.</td></tr>
                  )}
                  {rows.map((d) => (
                    <tr
                      key={d.id}
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                      onClick={() => pick(d)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          pick(d);
                        }
                      }}
                    >
                      <td style={{ fontWeight: 600 }}>{d.designName}</td>
                      <td className="mono">{d.sku}</td>
                      <td>{d.sizeLabel}</td>
                      <td>{d.collectionName}</td>
                      <td>{d.partyBrandName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
