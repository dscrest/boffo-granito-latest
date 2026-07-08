/* ============================================================
   BOFFO Order OS — app shell + router
   Sidebar + header markup kept identical to prototype/app.jsx.
   Navigation is HashRouter-based; each page is lazy-loaded into its own
   chunk (code-splitting). Route path === the prototype's view id.
   ============================================================ */
import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { ToastHost } from "@/ui/Toast";
import { ConfirmHost } from "@/ui/ConfirmDialog";
import { SkeletonRows } from "@/ui/States";
import { ErrorBoundary } from "@/ui/ErrorBoundary";
import { STAGES, type Order } from "@/data";
import { checkSession, hasFeature, type SessionUser } from "@/lib/auth";
import { NotificationBell, UserMenu } from "@/features/shell/HeaderMenus";
import { cachedQuotes, listQuotes, subscribeQuotes } from "@/features/quotes/quotesApi";
import { cachedOrders, subscribeOrders } from "@/features/orders/ordersApi";
import { cachedCustomers, subscribeCustomers } from "@/features/masters/customersApi";
import { cachedDesigns, subscribeDesigns } from "@/features/masters/designsApi";
import { GlobalSearch } from "@/features/search/GlobalSearch";

/* Lazy page chunks (named exports → default-wrapped for React.lazy). */
const Dashboard = lazy(() => import("@/features/dashboard/Dashboard").then((m) => ({ default: m.Dashboard })));
const Quotes = lazy(() => import("@/features/quotes/QuotesTable").then((m) => ({ default: m.QuotesTable })));
const QuoteDetail = lazy(() => import("@/features/quotes/QuoteDetail").then((m) => ({ default: m.QuoteDetail })));
const Kanban = lazy(() => import("@/features/pipeline/Kanban").then((m) => ({ default: m.Kanban })));
const ByOrderView = lazy(() => import("@/features/orders/ByOrderView").then((m) => ({ default: m.ByOrderView })));
// #21: "All Orders" list commented out — "By Order" (/byorder) is the primary orders page.
// OrdersTable.tsx is kept (ByOrderView imports draftToInput from it); only the route/nav are removed.
// const OrdersTable = lazy(() => import("@/features/orders/OrdersTable").then((m) => ({ default: m.OrdersTable })));
const PurchaseOrders = lazy(() => import("@/features/stages/PurchaseOrders").then((m) => ({ default: m.PurchaseOrders })));
const Production = lazy(() => import("@/features/stages/Production").then((m) => ({ default: m.Production })));
const QC = lazy(() => import("@/features/stages/QC").then((m) => ({ default: m.QC })));
const OperationsLog = lazy(() => import("@/features/ops/OperationsLog").then((m) => ({ default: m.OperationsLog })));
const Invoices = lazy(() => import("@/features/invoices/Invoices").then((m) => ({ default: m.Invoices })));
const Reports = lazy(() => import("@/features/reports/Reports").then((m) => ({ default: m.Reports })));
const PalletPacking = lazy(() => import("@/features/stages/PalletPacking").then((m) => ({ default: m.PalletPacking })));
const Loading = lazy(() => import("@/features/stages/Loading").then((m) => ({ default: m.Loading })));
const LoadPlanner = lazy(() => import("@/features/stages/LoadPlanner").then((m) => ({ default: m.LoadPlanner })));
const FinalLoading = lazy(() => import("@/features/stages/FinalLoading").then((m) => ({ default: m.FinalLoading })));
const DesignMaster = lazy(() => import("@/features/masters/DesignMaster").then((m) => ({ default: m.DesignMaster })));
const PartiesView = lazy(() => import("@/features/masters/Parties").then((m) => ({ default: m.PartiesView })));
const CustomerDetail = lazy(() => import("@/features/masters/CustomerDetail").then((m) => ({ default: m.CustomerDetail })));
const ItemDetail = lazy(() => import("@/features/masters/ItemDetail").then((m) => ({ default: m.ItemDetail })));
const DesignEdit = lazy(() => import("@/features/masters/DesignEdit").then((m) => ({ default: m.DesignEdit })));
const OrderDetail = lazy(() => import("@/features/orders/OrderDetail").then((m) => ({ default: m.OrderDetail })));
const PurchaseOrderDetail = lazy(() => import("@/features/stages/PurchaseOrderDetail").then((m) => ({ default: m.PurchaseOrderDetail })));
const Masters = lazy(() => import("@/features/masters/Masters").then((m) => ({ default: m.Masters })));
const Pallets = lazy(() => import("@/features/masters/Pallets").then((m) => ({ default: m.Pallets })));
const Containers = lazy(() => import("@/features/masters/Containers").then((m) => ({ default: m.Containers })));
const FitSuggest = lazy(() => import("@/features/stages/FitSuggest").then((m) => ({ default: m.FitSuggest })));
const UsersAdmin = lazy(() => import("@/features/admin/Users").then((m) => ({ default: m.UsersAdmin })));
const SalesPersonsAdmin = lazy(() => import("@/features/admin/SalesPersons").then((m) => ({ default: m.SalesPersonsAdmin })));

const TWEAK_DEFAULTS = {
  accent: "oklch(0.55 0.16 150)",
  density: "compact" as "compact" | "spacious",
};

function applyAccent(color: string) {
  const r = document.documentElement;
  r.style.setProperty("--accent", color);
  const soft = color.startsWith("oklch(") ? color.replace(/\)$/, " / 0.12)") : color;
  r.style.setProperty("--accent-soft", soft);
}

/* Sidebar is a nested tree: a node is a leaf (has `id` → route) or a
   collapsible parent (has `children`). Parents accordion open/close on click;
   the branch holding the active route auto-expands. */
interface NavNode {
  id?: string;
  label: string;
  icon: string;
  children?: NavNode[];
}

/* Build the sidebar tree. Settings/Masters lives in the top-right header gear
   (not the left panel). Customers leads the Sales group (Books-parity order). */
function navTree(): NavNode[] {
  const tree: NavNode[] = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    {
      label: "Items",
      icon: "tile",
      children: [
        { id: "design", label: "Items", icon: "tile" },
        // Pallet Master = the master of pallet formats (an Items master).
        // Palletization (Sales, id "packing") is the process that consumes it.
        { id: "pallets", label: "Pallet Master", icon: "palette" },
        { id: "prod", label: "Production", icon: "factory" },
      ],
    },
    {
      label: "Sales",
      icon: "cart",
      children: [
        { id: "parties", label: "Customers", icon: "users" },
        { id: "quotes", label: "Quotes", icon: "quote" },
        {
          label: "Master Orders",
          icon: "docs",
          children: [
            { id: "kanban", label: "Pipeline", icon: "kanban" },
            { id: "byorder", label: "By Order", icon: "orders" },
            // #21: "All Orders" page commented out — By Order is the primary list.
            // { id: "orders", label: "All Orders", icon: "docs" },
          ],
        },
        { id: "packing", label: "Palletization", icon: "palette" },
      ],
    },
    {
      label: "Stages",
      icon: "truck",
      children: [
        { id: "po", label: "Purchase Orders", icon: "docs" },
        { id: "qc", label: "Quality Control", icon: "shield-check" },
        { id: "containers", label: "Containers", icon: "truck" },
        { id: "fit", label: "Fit Suggester", icon: "kanban" },
        { id: "loadplan", label: "Load Planner", icon: "truck" },
        { id: "loading", label: "Loading", icon: "truck" },
        { id: "final", label: "Final Loading", icon: "invoice" },
        { id: "invoices", label: "Invoices", icon: "invoice" },
      ],
    },
    {
      label: "Reports",
      icon: "chart",
      children: [
        { id: "reports", label: "Quantity Reports", icon: "chart" },
        { id: "ops", label: "Audit Log", icon: "clock" },
      ],
    },
  ];
  return tree;
}

/* Drop leaves the signed-in role may not see (Role.features), then prune
   parents left without children. ["*"] in features = everything visible. */
function filterTreeByRole(nodes: NavNode[]): NavNode[] {
  return nodes
    .map((n) => (n.children ? { ...n, children: filterTreeByRole(n.children) } : n))
    .filter((n) => (n.children ? n.children.length > 0 : !n.id || hasFeature(n.id)));
}

/* Labels of every parent on the path to `id` — used to auto-open ancestors. */
function ancestorsOf(id: string, nodes: NavNode[] = navTree(), trail: string[] = []): string[] | null {
  for (const n of nodes) {
    if (n.id === id) return trail;
    if (n.children) {
      const found = ancestorsOf(id, n.children, [...trail, n.label]);
      if (found) return found;
    }
  }
  return null;
}

interface NavNodeRowProps {
  node: NavNode;
  depth: number;
  counts: Record<string, number | string>;
  openGroups: Record<string, boolean>;
  onToggle: (label: string) => void;
}

/* Renders one tree node: a NavLink leaf, or a collapsible parent that
   recurses into its children when open. `depth` drives the indent.
   Memoized: count-badge updates (e.g. live quote count) re-render only
   rows whose props changed, not the whole tree. */
const NavNodeRow = memo(function NavNodeRow({ node, depth, counts, openGroups, onToggle }: NavNodeRowProps) {
  const pad = { paddingLeft: 8 + depth * 14 } as const;

  if (!node.children) {
    const c = counts[node.id!];
    return (
      <NavLink to={`/${node.id}`} className={({ isActive }) => `item ${isActive ? "active" : ""}`} style={pad}>
        <Icon name={node.icon} size={14} className="ic" />
        <span>{node.label}</span>
        {c != null && c !== "" && <span className="count">{c}</span>}
      </NavLink>
    );
  }

  const open = !!openGroups[node.label];
  return (
    <>
      <button
        type="button"
        className={`item parent ${open ? "open" : ""}`}
        style={pad}
        aria-expanded={open}
        onClick={() => onToggle(node.label)}
      >
        <Icon name={node.icon} size={14} className="ic" />
        <span>{node.label}</span>
        <Icon name="chev-r" size={13} className="chev" />
      </button>
      {open && (
        <div className="subnav">
          {node.children.map((child) => (
            <NavNodeRow
              key={child.label}
              node={child}
              depth={depth + 1}
              counts={counts}
              openGroups={openGroups}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </>
  );
});

export default function App() {
  const location = useLocation();
  const currentId = location.pathname.replace(/^\//, "") || "dashboard";
  // Detail routes like /quotes/:id share the parent's breadcrumb/menu state.
  const baseId = currentId.split("/")[0];

  // Session → admin gate for the Settings (Masters) group + route.
  const [user, setUser] = useState<SessionUser | null>(null);
  useEffect(() => {
    void checkSession().then(setUser);
  }, []);
  const isAdmin = user?.role === "Admin";
  const navigate = useNavigate();
  // Re-filter when the session user lands (perms snapshot lives in sessionStorage).
  const tree = useMemo(() => filterTreeByRole(navTree()), [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whole-sidebar collapse (icon rail ↔ full). Persisted across sessions.
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem("sidebar-collapsed") === "1");
  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);
  // Narrow screens: auto-collapse to the icon rail (user can still expand).
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1100px)");
    const apply = () => {
      if (mq.matches) setCollapsed(true);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Which parent groups are expanded. Active route's ancestors auto-open.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    (ancestorsOf(baseId) || []).forEach((l) => (init[l] = true));
    return init;
  });
  useEffect(() => {
    const anc = ancestorsOf(baseId);
    if (anc?.length) setOpenGroups((p) => ({ ...p, ...Object.fromEntries(anc.map((l) => [l, true])) }));
  }, [baseId]);
  // Stable ref so memoized NavNodeRow doesn't re-render on unrelated state.
  const toggleGroup = useCallback(
    (label: string) => setOpenGroups((p) => ({ ...p, [label]: !p[label] })),
    [],
  );

  useEffect(() => {
    applyAccent(TWEAK_DEFAULTS.accent);
    const d = TWEAK_DEFAULTS.density;
    document.documentElement.style.setProperty("--t-md", d === "spacious" ? "13.5px" : "12.5px");
    document.documentElement.style.setProperty("--t-sm", d === "spacious" ? "12px" : "11.5px");
  }, []);

  // Live quote count for the sidebar badge — seed length is only the fallback
  // until the Data Store cache hydrates. Stays in sync with creates/deletes
  // via the quotesApi subscription.
  const [liveQuoteCount, setLiveQuoteCount] = useState<number | null>(() => cachedQuotes()?.length ?? null);
  useEffect(() => {
    const sync = () => setLiveQuoteCount(cachedQuotes()?.length ?? null);
    const unsub = subscribeQuotes(sync);
    void listQuotes(); // warm the cache so the badge is live before visiting Quotes
    return unsub;
  }, []);

  // Live order counts: subscribe-only (no warm fetch — the first orders
  // screen visited hydrates the cache); mock seeds until then.
  const [liveOrders, setLiveOrders] = useState<Order[] | null>(() => cachedOrders());
  useEffect(
    () =>
      subscribeOrders(() => {
        const c = cachedOrders();
        if (c) setLiveOrders(c);
      }),
    [],
  );

  // Live master counts: subscribe-only (no warm fetch — the first masters
  // screen or form visited hydrates the caches); mock seeds until then.
  const [masterCounts, setMasterCounts] = useState<{ parties: number | null; designs: number | null }>(() => ({
    parties: cachedCustomers()?.length ?? null,
    designs: cachedDesigns()?.length ?? null,
  }));
  useEffect(() => {
    const sync = () =>
      setMasterCounts({
        parties: cachedCustomers()?.length ?? null,
        designs: cachedDesigns()?.length ?? null,
      });
    const unsubC = subscribeCustomers(sync);
    const unsubD = subscribeDesigns(sync);
    return () => {
      unsubC();
      unsubD();
    };
  }, []);

  const counts = useMemo<Record<string, number | string>>(() => {
    // Live-only: before the caches hydrate the badges show 0, never mock seeds.
    const ords = liveOrders ?? [];
    const c: Record<string, number | string> = { dashboard: "", quotes: liveQuoteCount ?? 0, kanban: ords.length, orders: ords.length };
    const distinctPOs = new Set<string>();
    ords.forEach((o) => distinctPOs.add(`${o.poNumber}__${o.partyCode}`));
    c.byorder = distinctPOs.size;
    STAGES.forEach((s) => (c[s.id] = ords.filter((o) => o.stage === s.id).length));
    c.design = masterCounts.designs ?? 0;
    c.parties = masterCounts.parties ?? 0;
    return c;
  }, [liveQuoteCount, liveOrders, masterCounts]);

  return (
    <div className={`app ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">B</div>
          <div className="name">BOFFO</div>
          <div className="ver">v4.0</div>
          <button
            type="button"
            className="collapse-btn"
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            title={collapsed ? "Expand menu" : "Collapse menu"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
          >
            <Icon name={collapsed ? "chev-r" : "chev-l"} size={14} />
          </button>
        </div>

        <nav className="group">
          {tree.map((n) => (
            <NavNodeRow
              key={n.label}
              node={n}
              depth={0}
              counts={counts}
              openGroups={openGroups}
              onToggle={toggleGroup}
            />
          ))}
        </nav>

        <div className="foot">
          <div className="row">
            <span className="dot" />
            <span style={{ color: "var(--fg-2)" }}>Live data</span>
          </div>
        </div>
      </aside>

      <header className="header">
        {/* Breadcrumbs removed 2026-07-06 — the sidebar shows location; search leads the header. */}
        <GlobalSearch />
        <NotificationBell />
        <button className="hbtn" title="Settings" aria-label="Settings" onClick={() => navigate("/masters")}>
          <Icon name="settings" size={13} />
        </button>
        {isAdmin && (
          <button className="hbtn" title="Sales Persons" aria-label="Sales Persons" onClick={() => navigate("/salespersons")}>
            <Icon name="user" size={13} />
          </button>
        )}
        {isAdmin && (
          <button className="hbtn" title="Users" aria-label="Users" onClick={() => navigate("/users")}>
            <Icon name="users" size={13} />
          </button>
        )}
        <UserMenu user={user} />
      </header>

      <main className="main">
        <ErrorBoundary key={location.pathname}>
        <Suspense fallback={<div style={{ padding: 24 }}><SkeletonRows rows={8} /></div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/quotes" element={<Quotes />} />
            <Route path="/quotes/:id" element={<QuoteDetail />} />
            <Route path="/kanban" element={<Kanban />} />
            <Route path="/byorder" element={<ByOrderView />} />
            {/* #21: All Orders list route removed — see /byorder. */}
            {/* <Route path="/orders" element={<OrdersTable />} /> */}
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/po/:id" element={<PurchaseOrderDetail />} />
            <Route path="/design/:id/edit" element={<DesignEdit />} />
            <Route path="/design/:id" element={<ItemDetail />} />
            <Route path="/parties/:id" element={<CustomerDetail />} />
            <Route path="/po" element={<PurchaseOrders />} />
            <Route path="/prod" element={<Production />} />
            <Route path="/qc" element={<QC />} />
            <Route path="/containers" element={<Containers />} />
            <Route path="/fit" element={<FitSuggest />} />
            <Route path="/loadplan" element={<LoadPlanner />} />
            <Route path="/ops" element={<OperationsLog />} />
            <Route path="/packing" element={<PalletPacking />} />
            <Route path="/loading" element={<Loading />} />
            <Route path="/final" element={<FinalLoading />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/design" element={<DesignMaster />} />
            <Route path="/pallets" element={<Pallets />} />
            <Route path="/masters" element={isAdmin ? <Masters /> : <Navigate to="/dashboard" replace />} />
            <Route path="/users" element={isAdmin ? <UsersAdmin /> : <Navigate to="/dashboard" replace />} />
            <Route path="/salespersons" element={isAdmin ? <SalesPersonsAdmin /> : <Navigate to="/dashboard" replace />} />
            <Route path="/parties" element={<PartiesView />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}
