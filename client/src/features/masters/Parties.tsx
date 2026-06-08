/* Parties (Customers) — buyer cards + New Party entry form.
   Base from mock PARTIES; new parties kept in local `drafts` state
   (frontend-only, not yet persisted) and shown first. */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { ProgressBar } from "@/ui/primitives";
import { fmt, pct } from "@/lib/format";
import { ORDERS, PARTIES } from "@/data";
import { PartyForm, type PartyDraft } from "./PartyForm";

export function PartiesView() {
  const [showForm, setShowForm] = useState(false);
  const [drafts, setDrafts] = useState<PartyDraft[]>([]);

  const addDraft = (p: PartyDraft) => {
    setDrafts((d) => [p, ...d]);
    setShowForm(false);
  };

  return (
    <div>
      {showForm && <PartyForm onSave={addDraft} onClose={() => setShowForm(false)} />}
      <div className="page-head">
        <div>
          <div className="title">Parties</div>
          <div className="sub">
            {PARTIES.length + drafts.length} active buyers across {new Set(PARTIES.map((p) => p.country)).size} countries
            {drafts.length > 0 && (
              <>
                {" · "}
                <span className="dim">{drafts.length} unsaved draft{drafts.length > 1 ? "s" : ""}</span>
              </>
            )}
          </div>
        </div>
        <div className="right">
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            Add party
          </button>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {drafts.map((p) => (
          <div className="kpi" key={p._id} style={{ borderLeft: "3px solid var(--accent)" }}>
            <div className="label">
              {p.flag} {p.name} <span className="muted">· {p.country || "—"}</span>
              <span className="chip" style={{ marginLeft: 6, background: "var(--accent-soft)", color: "var(--accent)" }}>
                draft
              </span>
            </div>
            <div className="value">
              0<span className="unit">orders</span>
            </div>
            <div className="delta">
              <span className="mono" style={{ color: "var(--fg-2)" }}>
                {p.code}
              </span>
              <span className="muted">· {p.currency}</span>
              {p.payment_term && <span className="muted">· {p.payment_term}</span>}
            </div>
          </div>
        ))}
        {PARTIES.map((p) => {
          const open = ORDERS.filter((o) => o.partyCode === p.code);
          const qty = open.reduce((s, o) => s + o.orderQty, 0);
          const loaded = open.reduce((s, o) => s + o.loadedQty, 0);
          return (
            <div className="kpi" key={p.code}>
              <div className="label">
                {p.flag} {p.name} <span className="muted">· {p.country}</span>
              </div>
              <div className="value">
                {open.length}
                <span className="unit">orders</span>
              </div>
              <div className="delta">
                <span className="mono" style={{ color: "var(--fg-2)" }}>
                  {fmt(qty)}
                </span>
                <span className="muted">sqm total</span>
                <span className="muted">·</span>
                <span className="mono" style={{ color: "var(--c-green)" }}>
                  {pct(loaded, qty)}%
                </span>
                <span className="muted">loaded</span>
              </div>
              <div style={{ marginTop: 6 }}>
                <ProgressBar value={loaded} max={qty} color="var(--c-green)" height={4} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
