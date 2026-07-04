/* Parties (Customers) — Books-parity list view over the live Customer
   master (customersApi). New customers save straight to the Data Store;
   order counts come from the live orders cache (useOrders).
   Grid standard: header-click sorting, generic "filter by field" bar,
   counts live in the GridFooter only. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useHiddenColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
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

// Toggleable columns (Name always shown).
const PARTY_COLUMNS: ColumnDef[] = [
  { key: "code", label: "Code" },
  { key: "country", label: "Country" },
  { key: "currency", label: "Currency" },
  { key: "paymentTerm", label: "Payment Term" },
  { key: "openOrders", label: "Open Orders" },
  { key: "loaded", label: "Loaded" },
];

/* Generic filter: pick a field, then a value (values derived from live rows). */
const FILTER_FIELDS: { key: keyof Row; label: string }[] = [
  { key: "country", label: "Country" },
  { key: "currency", label: "Currency" },
  { key: "paymentTerm", label: "Payment Term" },
];

export function PartiesView() {
  const navigate = useNavigate();
  const { orders } = useOrders();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermOption[]>([]);
  const [salesPersons, setSalesPersons] = useState<PaymentTermOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [filterField, setFilterField] = useState<"" | keyof Row>("");
  const [filterValue, setFilterValue] = useState("");
  const { hidden, toggle, show } = useHiddenColumns("partiesTableColumns");

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
      setSalesPersons(res.salesPersons);
    });
  };
  useEffect(load, []);

  const onSave = async (input: CustomerInput) => {
    const res = await createCustomer(input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      toast.error(res.error || "Save failed");
      return;
    }
    setShowForm(false);
    toast.success("Customer saved");
    load();
  };

  const base = useMemo<Row[]>(
    () =>
      customers.map((c) => {
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
      }),
    [customers, orders],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return base.filter((r) => {
      if (filterField && filterValue && String(r[filterField]) !== filterValue) return false;
      if (!q) return true;
      return `${r.name} ${r.code} ${r.country}`.toLowerCase().includes(q);
    });
  }, [base, query, filterField, filterValue]);

  const sort = useSortRows(rows, (r, k) => r[k as keyof Row] as string | number, "name");
  const pager = usePagination(rows.length, "partiesPageSize", `${query}|${filterField}|${filterValue}`);

  const filterValues = useMemo(() => {
    if (!filterField) return [];
    return [...new Set(base.map((r) => String(r[filterField])).filter(Boolean))].sort();
  }, [base, filterField]);

  const countries = new Set(customers.map((c) => c.country).filter(Boolean)).size;

  return (
    <div>
      {showForm && (
        <PartyForm paymentTerms={paymentTerms} salesPersons={salesPersons} onSave={onSave} onClose={() => setShowForm(false)} />
      )}
      <div className="page-head">
        <div>
          <div className="title">Customers</div>
          <div className="sub">{loading ? "Loading…" : `Buyers across ${countries} countries`}</div>
        </div>
        <div className="right" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="hbtn" onClick={load} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            New
          </button>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={load} />}

      <div className="fbar">
        <Icon name="filter" size={12} />
        <select
          value={filterField}
          onChange={(e) => {
            setFilterField(e.target.value as "" | keyof Row);
            setFilterValue("");
          }}
          title="Filter by field"
        >
          <option value="">Filter by…</option>
          {FILTER_FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        {filterField && (
          <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)} title="Filter value">
            <option value="">All</option>
            {filterValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="Search name, code, country…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ColumnPicker columns={PARTY_COLUMNS} hidden={hidden} onToggle={toggle} />
      </div>

      {loading && customers.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : (
      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <SortTh id="name" label="Name" sort={sort} />
                {show("code") && <SortTh id="code" label="Code" sort={sort} />}
                {show("country") && <SortTh id="country" label="Country" sort={sort} />}
                {show("currency") && <SortTh id="currency" label="Currency" sort={sort} />}
                {show("paymentTerm") && <SortTh id="paymentTerm" label="Payment Term" sort={sort} />}
                {show("openOrders") && <SortTh id="orders" label="Open Orders" sort={sort} className="num" style={{ textAlign: "right" }} />}
                {show("loaded") && <SortTh id="loaded" label="Loaded" sort={sort} style={{ width: 160 }} />}
              </tr>
            </thead>
            <tbody>
              {pager.slice(sort.sorted).map((r) => (
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
                  {show("code") && <td className="mono muted">{r.code}</td>}
                  {show("country") && <td>{r.country}</td>}
                  {show("currency") && <td className="muted">{r.currency}</td>}
                  {show("paymentTerm") && <td className="muted">{r.paymentTerm}</td>}
                  {show("openOrders") && <td className="num mono">{r.orders}</td>}
                  {show("loaded") && (
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
                  )}
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} style={{ padding: 0 }}>
                    {customers.length > 0 ? (
                      <EmptyState title="No matching results" hint="Try a different filter or search" />
                    ) : (
                      <EmptyState
                        icon="flag"
                        title="No customers yet"
                        hint="Click New to add the first buyer."
                      />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <GridFooter {...pager} />
      </div>
      )}
    </div>
  );
}
