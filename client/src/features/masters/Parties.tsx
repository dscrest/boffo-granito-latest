/* Parties — ported verbatim from prototype/app.jsx (PartiesView). */
import { Icon } from "@/ui/Icon";
import { ProgressBar } from "@/ui/primitives";
import { fmt, pct } from "@/lib/format";
import { ORDERS, PARTIES } from "@/data";

export function PartiesView() {
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Parties</div>
          <div className="sub">
            {PARTIES.length} active buyers across {new Set(PARTIES.map((p) => p.country)).size} countries
          </div>
        </div>
        <div className="right">
          <button className="hbtn primary">
            <Icon name="plus" size={13} />
            Add party
          </button>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
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
