/* ============================================================
   OrdersFilter — shared choosable filter for the orders views
   (By Order + Pipeline). Pick a field (Customer / PO / Stage),
   choose a value via a type-to-search Combobox (lists are long),
   plus a free-text search box. applyOrderFilter() runs the same
   logic everywhere.
   ============================================================ */
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { STAGES, type Order } from "@/data";

export type FilterField = "none" | "customer" | "po" | "stage";
export interface OrdersFilterState {
  field: FilterField;
  value: string; // partyCode | poNumber | stage id
  search: string;
}

export const EMPTY_FILTER: OrdersFilterState = { field: "none", value: "", search: "" };

/** Filter + free-text search applied to a flat Order list. */
export function applyOrderFilter(orders: Order[], st: OrdersFilterState): Order[] {
  let arr = orders;
  if (st.value) {
    if (st.field === "customer") arr = arr.filter((o) => o.partyCode === st.value);
    else if (st.field === "po") arr = arr.filter((o) => o.poNumber === st.value);
    else if (st.field === "stage") arr = arr.filter((o) => o.stage === st.value);
  }
  const q = st.search.trim().toLowerCase();
  if (q) {
    arr = arr.filter((o) =>
      [o.orderNumber, o.poNumber, o.design, o.party, o.partyCode, o.salesperson, o.size, o.finish, o.brand]
        .some((f) => String(f || "").toLowerCase().includes(q)),
    );
  }
  return arr;
}

export function OrdersFilter({
  orders,
  value: st,
  onChange,
}: {
  orders: Order[];
  value: OrdersFilterState;
  onChange: (next: OrdersFilterState) => void;
}) {
  // Value options for the chosen field (type-to-search Combobox).
  const valueOptions = (() => {
    if (st.field === "customer") {
      const m = new Map<string, string>();
      orders.forEach((o) => { if (o.partyCode) m.set(o.partyCode, o.party); });
      return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) => ({ value: code, label: name, hint: code }));
    }
    if (st.field === "po") {
      return [...new Set(orders.map((o) => o.poNumber).filter(Boolean))].sort().map((po) => ({ value: po, label: po }));
    }
    if (st.field === "stage") {
      return STAGES.map((s) => ({ value: s.id, label: s.label }));
    }
    return [];
  })();

  return (
    <div className="fbar">
      <span className="row" style={{ gap: 6, color: "var(--fg-2)" }}>
        <Icon name="filter" size={13} /> Filter
      </span>
      <select
        value={st.field}
        onChange={(e) => onChange({ ...st, field: e.target.value as FilterField, value: "" })}
        title="Filter by field"
      >
        <option value="none">No filter</option>
        <option value="customer">Customer</option>
        <option value="po">PO Number</option>
        <option value="stage">Stage</option>
      </select>
      {st.field !== "none" && (
        <div style={{ minWidth: 220 }}>
          <Combobox
            value={st.value}
            options={valueOptions}
            onChange={(v) => onChange({ ...st, value: v })}
            placeholder={`Search ${st.field}…`}
          />
        </div>
      )}
      <div style={{ flex: 1 }} />
      <input
        type="text"
        value={st.search}
        onChange={(e) => onChange({ ...st, search: e.target.value })}
        placeholder="Search PO, design, customer…"
      />
    </div>
  );
}
