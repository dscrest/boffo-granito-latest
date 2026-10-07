/* ============================================================
   Customer search modal (CR-276) — the "bigger search surface" behind the
   🔍 beside every Customer picker (Quote, Sales Order, Palletization).
   Search box over a table of active customers; a row click (or Enter)
   picks it. The caller's existing onChange runs, so address / terms /
   currency / sales person inheritance is unchanged. House modal chrome,
   same as Allocate Stock.
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import { useMasters } from "./useMasters";
import type { CustomerRow } from "./customersApi";

export function CustomerSearchModal({
  onPick,
  onClose,
  filter,
}: {
  onPick: (c: CustomerRow) => void;
  onClose: () => void;
  /** Narrow the list (e.g. Palletization: only customers with palletizable stock). */
  filter?: (c: CustomerRow) => boolean;
}) {
  const panelRef = useModalA11y(onClose);
  const { customers } = useMasters();
  const [q, setQ] = useState("");
  // Every typed word must appear somewhere in the row (same token rule as the Combobox).
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (c: CustomerRow) =>
    `${c.name} ${c.code} ${c.country} ${c.currency} ${c.handlingPersonLabel} ${c.paymentTermLabel}`.toLowerCase();
  const rows = customers.filter((c) => c.active && (!filter || filter(c))).filter((c) => tokens.every((t) => hay(c).includes(t)));
  const pick = (c: CustomerRow) => {
    onPick(c);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Search customers" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="search" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div className="ttl">Search Customers</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
            <div className="lp-search">
              <Icon name="search" size={13} />
              <input type="text" placeholder="Search by name, code, country, currency, sales person…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
            </div>
            <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Code</th>
                    <th>Country</th>
                    <th>Currency</th>
                    <th>Sales Person</th>
                    <th>Payment Term</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="dim">No customers match.</td></tr>
                  )}
                  {rows.map((c) => (
                    <tr
                      key={c.id}
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                      onClick={() => pick(c)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          pick(c);
                        }
                      }}
                    >
                      <td style={{ fontWeight: 600 }}>{c.flag ? `${c.flag} ` : ""}{c.name}</td>
                      <td className="mono">{c.code}</td>
                      <td>{c.country}</td>
                      <td className="mono">{c.currency}</td>
                      <td>{c.handlingPersonLabel}</td>
                      <td>{c.paymentTermLabel}</td>
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
