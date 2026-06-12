/* Parties (Customers) — Books-parity list view over the live Customer
   master (customersApi). New customers save straight to the Data Store;
   order counts come from the live orders cache (useOrders). */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ProgressBar } from "@/ui/primitives";
import { pct } from "@/lib/format";
import { useOrders } from "@/features/orders/useOrders";
import { PartyForm } from "./PartyForm";
import {
  createCustomer,
  listCustomers,
  type CustomerInput,
  type CustomerRow,
  type PaymentTermOption,
} from "./customersApi";

type Row = {
  key: string;
  code: string;
  name: string;
  country: string;
  flag: string;
  currency: string;
  paymentTerm: string;
  active: boolean;
  orders: number;
  qty: number;
  loaded: number;
};

type SortKey = "name" | "country" | "orders";

export function PartiesView() {
  const navigate = useNavigate();
  const { orders } = useOrders();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");

  const load = () => {
    setLoading(true);
    void listCustomers().then((res) => {
      setLoading(false);
      if (!res.ok) {
        setError(res.error || "Failed to load customers");
        return;
      }
      setError(null);
      setCustomers(res.customers);
      setPaymentTerms(res.paymentTerms);
    });
  };
  useEffect(load, []);

  const onSave = async (input: CustomerInput) => {
    setShowForm(false);
    const res = await createCustomer(input);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success("Customer saved");
    load();
  };

  const rows = useMemo<Row[]>(() => {
    const base: Row[] = customers.map((c) => {
      const open = orders.filter((o) => o.partyCode === c.code);
      return {
        key: c.id,
        code: c.code,
        name: c.name,
        country: c.country || "—",
        flag: c.flag,
        currency: c.currency || "—",
        paymentTerm: c.paymentTermLabel || "—",
        active: c.active,
        orders: open.length,
        qty: open.reduce((s, o) => s + o.orderQty, 0),
        loaded: open.reduce((s, o) => s + o.loadedQty, 0),
      };
    });
    return base.sort((a, b) => {
      if (sort === "orders") return b.orders - a.orders;
      if (sort === "country") return a.country.localeCompare(b.country);
      return a.name.localeCompare(b.name);
    });
  }, [customers, orders, sort]);

  const countries = new Set(customers.map((c) => c.country).filter(Boolean)).size;

  return (
    <div>
      {showForm && (
        <PartyForm paymentTerms={paymentTerms} onSave={onSave} onClose={() => setShowForm(false)} />
      )}
      <div className="page-head">
        <div>
          <div className="title">Customers</div>
          <div className="sub">
            {customers.length} buyers across {countries} countries
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
                <MenuItem label="Refresh" active={false} onClick={() => { load(); setMenuOpen(false); }} />
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={load} />}

      {loading && customers.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : (
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
                    <button
                      className="linkish"
                      style={{ color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                      onClick={() => navigate(`/parties/${encodeURIComponent(r.code)}`)}
                      title="Open details"
                    >
                      {r.name}
                    </button>
                    {!r.active && (
                      <span className="chip" style={{ marginLeft: 6 }}>
                        inactive
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
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} style={{ padding: 0 }}>
                    <EmptyState
                      icon="flag"
                      title="No customers yet"
                      hint="Click New to add the first buyer."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
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
