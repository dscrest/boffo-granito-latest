/* Parties (Customers) — Books-parity list view over the live Customer
   master (customersApi). New customers save straight to the Data Store;
   order counts come from the live orders cache (useOrders).
   Grid standard: header-click sorting, generic "filter by field" bar,
   counts live in the GridFooter only. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { ProgressBar } from "@/ui/primitives";
import { can } from "@/lib/auth";
import { exportCsv } from "@/lib/csv";
import { fmtDateTime, pct } from "@/lib/format";
import { nextCustomerCode } from "@/lib/seq";
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
  currency: string;
  paymentTerm: string;
  handlingPerson: string;
  active: boolean;
  orders: number;
  qty: number;
  loaded: number;
  createdTime: string;
  modifiedTime: string;
};

// Toggleable + reorderable columns (Name pinned outside the map).
const PARTY_COLUMNS: ColumnDef<Row>[] = [
  { key: "code", label: "Code", className: "mono muted", render: (r) => r.code },
  { key: "country", label: "Country", render: (r) => r.country },
  { key: "currency", label: "Currency", className: "muted", render: (r) => r.currency },
  { key: "paymentTerm", label: "Payment Term", className: "muted", render: (r) => r.paymentTerm },
  { key: "openOrders", label: "Open Orders", className: "num mono", style: { textAlign: "right" }, render: (r) => r.orders },
  {
    key: "loaded",
    label: "Loaded",
    style: { width: 160 },
    render: (r) =>
      r.qty > 0 ? (
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <ProgressBar value={r.loaded} max={r.qty} color="var(--c-green)" height={4} />
          <span className="mono muted" style={{ fontSize: "var(--t-sm)" }}>{pct(r.loaded, r.qty)}%</span>
        </div>
      ) : (
        <span className="muted">—</span>
      ),
  },
  { key: "created", label: "Created", className: "muted mono", render: (r) => fmtDateTime(r.createdTime) },
  { key: "modified", label: "Modified", className: "muted mono", render: (r) => fmtDateTime(r.modifiedTime) },
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
  const [criteria, setCriteria] = useState<FilterCriteria>({});
  const { ordered, visible, hidden, toggle, move } = useColumns("partiesTableColumns", PARTY_COLUMNS, ["created", "modified"]);

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
    // Land on the new record (route is keyed by code) so the next action can't
    // target the wrong one.
    navigate(`/parties/${encodeURIComponent(input.code.trim().toUpperCase())}`);
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
          currency: c.currency || "—",
          paymentTerm: c.paymentTermLabel || "—",
          handlingPerson: c.handlingPersonLabel,
          active: c.active,
          orders: open.length,
          qty: open.reduce((s, o) => s + o.orderQty, 0),
          loaded: open.reduce((s, o) => s + o.loadedQty, 0),
          createdTime: c.createdTime,
          modifiedTime: c.modifiedTime,
        };
      }),
    [customers, orders],
  );

  // Advanced search fields (magnifier button) — options DB-sourced from rows.
  const filterFields = useMemo<FilterField<Row>[]>(() => {
    const opts = (get: (r: Row) => string) => [...new Set(base.map(get).filter(Boolean))].sort();
    const status = (r: Row) => (r.active ? "Active" : "Inactive");
    return [
      { key: "name", label: "Name", type: "text", get: (r) => r.name },
      { key: "code", label: "Code", type: "text", get: (r) => r.code },
      { key: "country", label: "Country", type: "multiselect", options: opts((r) => r.country), get: (r) => r.country },
      { key: "status", label: "Working Status", type: "multiselect", options: opts(status), get: status },
      { key: "handlingPerson", label: "Sales Person", type: "multiselect", options: opts((r) => r.handlingPerson), get: (r) => r.handlingPerson },
      { key: "currency", label: "Currency", type: "multiselect", options: opts((r) => r.currency), get: (r) => r.currency },
      { key: "created", label: "Created Between", type: "daterange", get: (r) => r.createdTime },
    ];
  }, [base]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const quick = base.filter((r) => {
      if (filterField && filterValue && String(r[filterField]) !== filterValue) return false;
      if (!q) return true;
      return `${r.name} ${r.code} ${r.country}`.toLowerCase().includes(q);
    });
    return applyFilters(quick, criteria, filterFields);
  }, [base, query, filterField, filterValue, criteria, filterFields]);

  // Sort get handles column keys that don't map 1:1 onto Row fields.
  const sort = useSortRows(
    rows,
    (r, k) =>
      (k === "openOrders" ? r.orders : k === "created" ? r.createdTime : k === "modified" ? r.modifiedTime : (r[k as keyof Row] as string | number)),
    "name",
  );
  const pager = usePagination(rows.length, "partiesPageSize", `${query}|${filterField}|${filterValue}|${JSON.stringify(criteria)}`);

  const filterValues = useMemo(() => {
    if (!filterField) return [];
    return [...new Set(base.map((r) => String(r[filterField])).filter(Boolean))].sort();
  }, [base, filterField]);

  return (
    /* Column fills the scrollport exactly (same as Sizes) so the grid card
       grows and its footer sits on the window edge — no dead band below. */
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {showForm && (
        <PartyForm
          paymentTerms={paymentTerms}
          salesPersons={salesPersons}
          initial={{ code: nextCustomerCode(customers.map((c) => c.code)) }}
          onSave={onSave}
          onClose={() => setShowForm(false)}
        />
      )}

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
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input
            type="text"
            placeholder="Search name, code, country…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
        <AdvancedFilterButton title="Customers" fields={filterFields} criteria={criteria} onChange={setCriteria} />
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
        {can("customers", "export") && (
          <button
            className="hbtn"
            style={{ height: 26, padding: "0 10px", borderRadius: 5 }}
            title="Export the filtered rows as CSV"
            onClick={() =>
              exportCsv("customers", sort.sorted, [
                { header: "Name", value: (r) => r.name },
                { header: "Code", value: (r) => r.code },
                { header: "Country", value: (r) => r.country },
                { header: "Currency", value: (r) => r.currency },
                { header: "Payment Term", value: (r) => r.paymentTerm },
                { header: "Handling Person", value: (r) => r.handlingPerson },
                { header: "Open Orders", value: (r) => r.orders },
                { header: "Status", value: (r) => (r.active ? "Active" : "Inactive") },
              ])
            }
          >
            <Icon name="docs" size={13} />
            Export
          </button>
        )}
        {can("customers", "create") && (
          /* fbar controls are 26px tall; the 30px .hbtn default would stretch the bar. */
          <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            New customer
          </button>
        )}
      </div>

      {loading && customers.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : (
      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                <SortTh id="name" label="Name" sort={sort} />
                {visible.map((c) => (
                  <SortTh key={c.key} id={c.key} label={c.label} sort={sort} style={c.style} />
                ))}
              </tr>
            </thead>
            <tbody>
              {pager.slice(sort.sorted).map((r) => (
                <tr
                  key={r.key}
                  tabIndex={0}
                  onClick={() => navigate(`/parties/${encodeURIComponent(r.code)}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/parties/${encodeURIComponent(r.code)}`);
                  }}
                  style={{ cursor: "pointer" }}
                  title="View customer"
                >
                  <td>
                    <Link className="linkish" to={`/parties/${encodeURIComponent(r.code)}`} onClick={(e) => e.stopPropagation()} title="View customer">
                      {r.name}
                    </Link>
                    {!r.active && (
                      <span className="chip" style={{ marginLeft: 6 }}>
                        inactive
                      </span>
                    )}
                  </td>
                  {visible.map((c) => (
                    <td key={c.key} className={c.className} style={c.style}>
                      {c.render!(r)}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={visible.length + 1} style={{ padding: 0 }}>
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
