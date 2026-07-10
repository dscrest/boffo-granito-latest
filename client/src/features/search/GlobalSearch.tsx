/* ============================================================
   Global header search — client-side palette over the four caches
   the app shell already hydrates (orders, quotes, customers, designs).

   No backend endpoint: the same stale-while-revalidate caches that feed
   the sidebar badges feed this. We warm them on mount and subscribe so
   results stay live. ⌘K / Ctrl-K focuses; ↑/↓ + Enter navigate; Esc clears.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { cachedOrders, listOrders, subscribeOrders } from "@/features/orders/ordersApi";
import { cachedQuotes, listQuotes, subscribeQuotes } from "@/features/quotes/quotesApi";
import { cachedCustomers, listCustomers, subscribeCustomers } from "@/features/masters/customersApi";
import { cachedDesigns, listDesigns, subscribeDesigns } from "@/features/masters/designsApi";

type Kind = "Order" | "Quote" | "Customer" | "Item";

interface Hit {
  kind: Kind;
  id: string;
  title: string;
  sub: string;
  route: string;
}

const PER_GROUP = 6; // cap matches per entity so one group can't bury the rest
const norm = (v: unknown) => (v == null ? "" : String(v)).toLowerCase();

/** Build the flat hit list for `q` across all four caches (already grouped order). */
function search(q: string): Hit[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const hit = (hay: (string | undefined)[], make: () => Hit): Hit | null =>
    hay.some((h) => norm(h).includes(t)) ? make() : null;
  const take = <T,>(rows: T[] | null, fn: (r: T) => Hit | null): Hit[] =>
    (rows ?? []).map(fn).filter((x): x is Hit => x !== null).slice(0, PER_GROUP);

  const orders = take(cachedOrders(), (o) =>
    hit([o.poNumber, o.party, o.partyCode, o.design, o.salesperson], () => ({
      kind: "Order",
      id: o.id,
      title: o.poNumber ? `PO ${o.poNumber}` : o.design || "Order",
      sub: [o.party, o.design].filter(Boolean).join(" · "),
      route: `/orders/${o.id}`,
    })),
  );
  const quotes = take(cachedQuotes(), (qt) =>
    hit([qt.quoteNo, qt.customer, qt.partyCode, qt.referenceNo, qt.salesperson], () => ({
      kind: "Quote",
      id: qt.id,
      title: qt.quoteNo || "Quote",
      sub: [qt.customer, qt.status].filter(Boolean).join(" · "),
      route: `/quotes/${qt.id}`,
    })),
  );
  const customers = take(cachedCustomers(), (c) =>
    hit([c.name, c.code, c.country], () => ({
      kind: "Customer",
      id: c.id,
      title: c.name || c.code || "Customer",
      sub: [c.code, c.country].filter(Boolean).join(" · "),
      route: `/parties/${c.id}`,
    })),
  );
  const designs = take(cachedDesigns(), (d) =>
    hit([d.designName, d.sku, d.uniqueName, d.collectionName, d.baseDesignName], () => ({
      kind: "Item",
      id: d.id,
      title: d.designName || d.sku || "Item",
      sub: [d.sku, d.sizeLabel].filter(Boolean).join(" · "),
      route: `/design/${d.id}`,
    })),
  );

  return [...orders, ...quotes, ...customers, ...designs];
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Bumped on every cache change so the memo recomputes against fresh data.
  const [rev, setRev] = useState(0);

  // Warm the four caches once so search works before any page is visited,
  // and re-render as each lands / mutates.
  useEffect(() => {
    void listOrders();
    void listQuotes();
    void listCustomers();
    void listDesigns();
    const bump = () => setRev((n) => n + 1);
    const unsubs = [subscribeOrders(bump), subscribeQuotes(bump), subscribeCustomers(bump), subscribeDesigns(bump)];
    return () => unsubs.forEach((u) => u());
  }, []);

  const hits = useMemo(() => search(q), [q, rev]);
  useEffect(() => setActive(0), [q]);

  // ⌘K / Ctrl-K focuses the box from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback(
    (h: Hit) => {
      setQ("");
      setOpen(false);
      inputRef.current?.blur();
      navigate(h.route);
    },
    [navigate],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQ("");
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const h = hits[active];
      if (h) go(h);
    }
  };

  const showDrop = open && q.trim().length > 0;

  return (
    <div className="search">
      <Icon name="search" size={13} className="icon" />
      <input
        ref={inputRef}
        value={q}
        placeholder="Search PO, design, customer, invoice…"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showDrop}
        aria-controls="global-search-results"
      />
      <span className="kbd">⌘K</span>

      {showDrop && (
        <div className="search-results" id="global-search-results" role="listbox">
          {hits.length === 0 ? (
            <div className="search-empty">No matches for “{q.trim()}”</div>
          ) : (
            hits.map((h, i) => (
              <button
                type="button"
                key={`${h.kind}-${h.id}`}
                className={`search-hit ${i === active ? "active" : ""}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()} // keep input focused through the click
                onClick={() => go(h)}
              >
                <span className="search-hit-kind">{h.kind}</span>
                <span className="search-hit-title">{h.title}</span>
                {h.sub && <span className="search-hit-sub">{h.sub}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
