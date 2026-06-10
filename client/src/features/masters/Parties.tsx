/* Parties (Customers) — Books-parity list view: a table with a New
   button and a ⋯ overflow menu (Sort / Refresh). New parties are kept
   in local `drafts` state (frontend-only, not yet persisted) and shown
   first, tagged "draft". */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { ProgressBar } from "@/ui/primitives";
import { pct } from "@/lib/format";
import { ORDERS, PARTIES } from "@/data";
import { PartyForm, type PartyDraft } from "./PartyForm";

type Row = {
  key: string;
  draft: boolean;
  name: string;
  code: string;
  country: string;
  flag: string;
  currency: string;
  paymentTerm: string;
  orders: number;
  qty: number;
  loaded: number;
};

type SortKey = "name" | "country" | "orders";

export function PartiesView() {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [drafts, setDrafts] = useState<PartyDraft[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");

  const addDraft = (p: PartyDraft) => {
    setDrafts((d) => [p, ...d]);
    setShowForm(false);
  };

  const rows = useMemo<Row[]>(() => {
    const draftRows: Row[] = drafts.map((p) => ({
      key: p._id,
      draft: true,
      name: p.name,
      code: p.code,
      country: p.country || "—",
      flag: p.flag || "",
      currency: p.currency || "—",
      paymentTerm: p.payment_term || "—",
      orders: 0,
      qty: 0,
      loaded: 0,
    }));
    const baseRows: Row[] = PARTIES.map((p) => {
      const open = ORDERS.filter((o) => o.partyCode === p.code);
      return {
        key: p.code,
        draft: false,
        name: p.name,
        code: p.code,
        country: p.country,
        flag: p.flag,
        currency: "—",
        paymentTerm: "—",
        orders: open.length,
        qty: open.reduce((s, o) => s + o.orderQty, 0),
        loaded: open.reduce((s, o) => s + o.loadedQty, 0),
      };
    });
    const sorted = [...baseRows].sort((a, b) => {
      if (sort === "orders") return b.orders - a.orders;
      if (sort === "country") return a.country.localeCompare(b.country);
      return a.name.localeCompare(b.name);
    });
    return [...draftRows, ...sorted]; // unsaved drafts always lead
  }, [drafts, sort]);

  const countries = new Set(PARTIES.map((p) => p.country)).size;

  return (
    <div>
      {showForm && <PartyForm onSave={addDraft} onClose={() => setShowForm(false)} />}
      <div className="page-head">
        <div>
          <div className="title">Customers</div>
          <div className="sub">
            {PARTIES.length + drafts.length} active buyers across {countries} countries
            {drafts.length > 0 && (
              <>
                {" · "}
                <span className="dim">{drafts.length} unsaved draft{drafts.length > 1 ? "s" : ""}</span>
              </>
            )}
          </div>
        </div>
        <div className="right" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            New
          </button>
          <div style={{ position: "relative" }}>
            <button className="hbtn" onClick={() => setMenuOpen((v) => !v)} title="More" aria-haspopup="menu" aria-expanded={menuOpen}>
              <Icon name="more" size={13} />
            </button>
            {menuOpen && (
              <div
                className="card"
                role="menu"
                style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 30, padding: 6, width: 200 }}
                onMouseLeave={() => setMenuOpen(false)}
              >
                <MenuItem label="Sort by Name" active={sort === "name"} onClick={() => { setSort("name"); setMenuOpen(false); }} />
                <MenuItem label="Sort by Country" active={sort === "country"} onClick={() => { setSort("country"); setMenuOpen(false); }} />
                <MenuItem label="Sort by Orders" active={sort === "orders"} onClick={() => { setSort("orders"); setMenuOpen(false); }} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Country</th>
                <th>Currency</th>
                <th>Payment Term</th>
                <th className="num" style={{ textAlign: "right" }}>Open Orders</th>
                <th style={{ width: 160 }}>Loaded</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    {r.flag}{" "}
                    {r.draft ? (
                      <span style={{ color: "var(--fg)" }}>{r.name}</span>
                    ) : (
                      <button
                        className="linkish"
                        style={{ color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                        onClick={() => navigate(`/parties/${encodeURIComponent(r.code)}`)}
                        title="Open details"
                      >
                        {r.name}
                      </button>
                    )}
                    {r.draft && (
                      <span className="chip" style={{ marginLeft: 6, background: "var(--accent-soft)", color: "var(--accent)" }}>
                        draft
                      </span>
                    )}
                  </td>
                  <td className="mono muted">{r.code}</td>
                  <td>{r.country}</td>
                  <td className="muted">{r.currency}</td>
                  <td className="muted">{r.paymentTerm}</td>
                  <td className="num mono">{r.orders}</td>
                  <td>
                    {r.qty > 0 ? (
                      <div className="row" style={{ gap: 8, alignItems: "center" }}>
                        <ProgressBar value={r.loaded} max={r.qty} color="var(--c-green)" height={4} />
                        <span className="mono muted" style={{ fontSize: "var(--t-sm)" }}>{pct(r.loaded, r.qty)}%</span>
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 18 }}>
                    No customers yet. Click <b>New</b> to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MenuItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className="row"
      role="menuitem"
      onClick={onClick}
      style={{
        width: "100%", gap: 8, padding: "6px 8px", background: "none", border: 0,
        font: "inherit", textAlign: "left", cursor: "pointer", color: active ? "var(--accent)" : "var(--fg-2)",
      }}
    >
      <Icon name={active ? "check" : "filter"} size={12} />
      <span>{label}</span>
    </button>
  );
}
