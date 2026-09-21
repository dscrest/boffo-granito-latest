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
import { canApprove, checkSession, hasFeature, type SessionUser } from "@/lib/auth";
import { NotificationBell, UserMenu } from "@/features/shell/HeaderMenus";
import boffoLogo from "@/assets/boffo-logo.png";
import { GlobalSearch } from "@/features/search/GlobalSearch";
import { TourHost } from "@/features/tour/Tour";
import { loadDefaultView } from "@/features/settings/settingsApi";

/* Lazy page chunks (named exports → default-wrapped for React.lazy). */
const Dashboard = lazy(() => import("@/features/dashboard/Dashboard").then((m) => ({ default: m.Dashboard })));
const Quotes = lazy(() => import("@/features/quotes/QuotesTable").then((m) => ({ default: m.QuotesTable })));
const QuoteDetail = lazy(() => import("@/features/quotes/QuoteDetail").then((m) => ({ default: m.QuoteDetail })));
const PlanContainerisation = lazy(() => import("@/features/quotes/PlanContainerisation").then((m) => ({ default: m.PlanContainerisation })));
const PlanSoContainerisation = lazy(() => import("@/features/quotes/PlanContainerisation").then((m) => ({ default: m.PlanSoContainerisation })));
const Approvals = lazy(() => import("@/features/quotes/Approvals").then((m) => ({ default: m.Approvals })));
const Kanban = lazy(() => import("@/features/pipeline/Kanban").then((m) => ({ default: m.Kanban })));
const ByOrderView = lazy(() => import("@/features/orders/ByOrderView").then((m) => ({ default: m.ByOrderView })));
const PalPlanFormPage = lazy(() => import("@/features/stages/PalPlanFormPage").then((m) => ({ default: m.PalPlanFormPage })));
const PalletFormPage = lazy(() => import("@/features/masters/PalletFormPage").then((m) => ({ default: m.PalletFormPage })));
const PartyFormPage = lazy(() => import("@/features/masters/PartyFormPage").then((m) => ({ default: m.PartyFormPage })));
const ProductionLogSheet = lazy(() => import("@/features/stages/ProductionLogSheet").then((m) => ({ default: m.ProductionLogSheet })));
const ProductionFormPage = lazy(() => import("@/features/stages/ProductionFormPage").then((m) => ({ default: m.ProductionFormPage })));
const OrderFormPage = lazy(() => import("@/features/orders/OrderFormPage").then((m) => ({ default: m.OrderFormPage })));
const QuoteFormPage = lazy(() => import("@/features/quotes/QuoteFormPage").then((m) => ({ default: m.QuoteFormPage })));
const OrdersTable = lazy(() => import("@/features/orders/OrdersTable").then((m) => ({ default: m.OrdersTable })));
const PurchaseOrders = lazy(() => import("@/features/stages/PurchaseOrders").then((m) => ({ default: m.PurchaseOrders })));
const Production = lazy(() => import("@/features/stages/Production").then((m) => ({ default: m.Production })));
const ProductionDetail = lazy(() => import("@/features/stages/ProductionDetail").then((m) => ({ default: m.ProductionDetail })));
const QC = lazy(() => import("@/features/stages/QC").then((m) => ({ default: m.QC })));
const OperationsLog = lazy(() => import("@/features/ops/OperationsLog").then((m) => ({ default: m.OperationsLog })));
const Invoices = lazy(() => import("@/features/invoices/Invoices").then((m) => ({ default: m.Invoices })));
const ReportsHome = lazy(() => import("@/features/reports/ReportsHome").then((m) => ({ default: m.ReportsHome })));
const ReportView = lazy(() => import("@/features/reports/Reports").then((m) => ({ default: m.ReportView })));
// "Palletization" = the PAL/FY/NNN plan feature (grid + kanban +
// per-record detail). The flat PalletisedBatch grid (Palletizations.tsx) is now
// parked — unrouted, not deleted; the SO-detail Palletization tab still uses it.
const PalPlans = lazy(() => import("@/features/stages/PalPlans").then((m) => ({ default: m.PalPlans })));
const PalPlanDetail = lazy(() => import("@/features/stages/PalPlanDetail").then((m) => ({ default: m.PalPlanDetail })));
// /loading = the dedicated batch-wise loading & dispatch page (LoadBox dock),
// split out of the Dispatch Control Board in the 2026-08-22 declutter.
const LoadingBay = lazy(() => import("@/features/stages/LoadingBay").then((m) => ({ default: m.LoadingBay })));
const LoadingPlanPage = lazy(() => import("@/features/stages/LoadingPlanPage").then((m) => ({ default: m.LoadingPlanPage })));
const LoadingSession = lazy(() => import("@/features/stages/LoadingSession").then((m) => ({ default: m.LoadingSession })));
const LoadingDetail = lazy(() => import("@/features/stages/LoadingDetail").then((m) => ({ default: m.LoadingDetail })));
const LoadPlanner = lazy(() => import("@/features/stages/LoadPlanner").then((m) => ({ default: m.LoadPlanner })));
const DesignMaster = lazy(() => import("@/features/masters/DesignMaster").then((m) => ({ default: m.DesignMaster })));
const PartiesView = lazy(() => import("@/features/masters/Parties").then((m) => ({ default: m.PartiesView })));
const CustomerDetail = lazy(() => import("@/features/masters/CustomerDetail").then((m) => ({ default: m.CustomerDetail })));
const ItemDetail = lazy(() => import("@/features/masters/ItemDetail").then((m) => ({ default: m.ItemDetail })));
const StockDetails = lazy(() => import("@/features/masters/StockDetails").then((m) => ({ default: m.StockDetails })));
const DesignEdit = lazy(() => import("@/features/masters/DesignEdit").then((m) => ({ default: m.DesignEdit })));
const OrderDetail = lazy(() => import("@/features/orders/OrderDetail").then((m) => ({ default: m.OrderDetail })));
const PurchaseOrderDetail = lazy(() => import("@/features/stages/PurchaseOrderDetail").then((m) => ({ default: m.PurchaseOrderDetail })));
const Masters = lazy(() => import("@/features/masters/Masters").then((m) => ({ default: m.Masters })));
// Panel Craft — showcase panels (master + detail) and their cutting-job orders.
const Panels = lazy(() => import("@/features/panels/Panels").then((m) => ({ default: m.Panels })));
const PanelDetail = lazy(() => import("@/features/panels/PanelDetail").then((m) => ({ default: m.PanelDetail })));
const PanelOrders = lazy(() => import("@/features/panels/PanelOrders").then((m) => ({ default: m.PanelOrders })));
const CutStock = lazy(() => import("@/features/panels/CutStock").then((m) => ({ default: m.CutStock })));
const Pallets = lazy(() => import("@/features/masters/Pallets").then((m) => ({ default: m.Pallets })));
const PalletDetail = lazy(() => import("@/features/masters/PalletDetail").then((m) => ({ default: m.PalletDetail })));
const Sizes = lazy(() => import("@/features/masters/Sizes").then((m) => ({ default: m.Sizes })));
const SizeDetail = lazy(() => import("@/features/masters/SizeDetail").then((m) => ({ default: m.SizeDetail })));
const Containers = lazy(() => import("@/features/masters/Containers").then((m) => ({ default: m.Containers })));
const FitSuggest = lazy(() => import("@/features/stages/FitSuggest").then((m) => ({ default: m.FitSuggest })));
const UsersAdmin = lazy(() => import("@/features/admin/Users").then((m) => ({ default: m.UsersAdmin })));
const RolesAdmin = lazy(() => import("@/features/admin/Roles").then((m) => ({ default: m.RolesAdmin })));
const CurrenciesAdmin = lazy(() => import("@/features/admin/Currencies").then((m) => ({ default: m.CurrenciesAdmin })));
const SettingsHome = lazy(() => import("@/features/settings/SettingsHome").then((m) => ({ default: m.SettingsHome })));
const DataOperations = lazy(() => import("@/features/settings/DataOperations").then((m) => ({ default: m.DataOperations })));

/* Sidebar is a nested tree: a node is a leaf (has `id` → route) or a
   collapsible parent (has `children`). Parents accordion open/close on click;
   the branch holding the active route auto-expands. */
interface NavNode {
  id?: string;
  label: string;
  icon: string;
  /** Link target override — defaults to `/${id}`. Lets a leaf land on a
      different route than its permission/count key (e.g. Sales Orders keys on
      "byorder" but lands on the Grid at /orders). */
  path?: string;
  children?: NavNode[];
}

/* Build the sidebar tree. Settings/Masters lives in the top-right header gear
   (not the left panel). Customers leads the Sales group (Books-parity order). */
function navTree(): NavNode[] {
  const tree: NavNode[] = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    {
      label: "Inventory",
      icon: "tile",
      children: [
        { id: "design", label: "Items", icon: "tile" },
        // Stock Details — batch-wise on-hand (produced − loaded), derived
        // in batchStockApi; also surfaced as the item detail Stock tab.
        { id: "stock", label: "Stock Details", icon: "tile" },
        // Size Master lives under Settings ▸ Product Masters (admin-only).
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
        // Approval inbox — visible to any role that may approve quotes or sales
        // orders (Role.matrix approve list; Admin always qualifies).
        ...(canApprove("Quote") || canApprove("SalesOrder")
          ? [{ id: "approvals", label: "Approvals", icon: "shield-check" }]
          : []),
        // Single "Sales Order" leaf — the List | Kanban toggle at the top of
        // the page (ViewToggle) switches between /byorder and /kanban.
        // #21: "All Orders" page commented out — By Order is the primary list.
        { id: "byorder", label: "Sales Orders", icon: "orders", path: "/orders" },
        // Palletization is TWO pages over one board (CR-160): the queue and
        // the work-in-progress + Ready-for-Loading handoff. Same feature id
        // ("packing") so one role permission covers both.
        { id: "packing", label: "Ready for Palletization", icon: "palette", path: "/packing" },
        { id: "packing", label: "In Palletization", icon: "palette", path: "/palletizing" },
        { id: "loading", label: "Loading and Dispatch", icon: "truck" },
      ],
    },
    // Panel Craft — showcase panels the reps show retailers: the panel
    // master + the panel-order cutting-job board (cut-piece stock).
    {
      label: "Panel Craft",
      icon: "tile",
      children: [
        // Workflow order: stock entered first, panels assembled from it,
        // then orders dispatch against it.
        { id: "cut-stock", label: "Cut Stock", icon: "tile" },
        { id: "panels", label: "Panels", icon: "tile" },
        { id: "panel-orders", label: "Panel Orders", icon: "orders" },
      ],
    },
    // ponytail: Stages menu hidden for now — routes still registered, just no nav entry.
    // Re-add this block to bring it back.
    // {
    //   label: "Stages",
    //   icon: "truck",
    //   children: [
    //     { id: "po", label: "Purchase Orders", icon: "docs" },
    //     { id: "qc", label: "Quality Control", icon: "shield-check" },
    //     { id: "containers", label: "Container Master", icon: "truck" },
    //     { id: "fit", label: "Fit Suggester", icon: "kanban" },
    //     { id: "loadplan", label: "Load Planner", icon: "truck" },
    //     { id: "final", label: "Final Loading", icon: "invoice" },
    //     { id: "invoices", label: "Invoices", icon: "invoice" },
    //   ],
    // },
    {
      label: "Reports",
      icon: "chart",
      children: [
        { id: "reports", label: "Reports", icon: "chart" },
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
    if (n.id === id || n.path === `/${id}`) return trail;
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
  openGroups: Record<string, boolean>;
  onToggle: (label: string) => void;
}

/* Renders one tree node: a NavLink leaf, or a collapsible parent that
   recurses into its children when open. `depth` drives the indent.
   Record counts were removed from the rail 2026-09-04 (with their
   live-count subscriptions and boot-time quote fetch). */
const NavNodeRow = memo(function NavNodeRow({ node, depth, openGroups, onToggle }: NavNodeRowProps) {
  const pad = { paddingLeft: 8 + depth * 14 } as const;

  if (!node.children) {
    const to = node.path ?? `/${node.id}`;
    // Anchor by path segment so two leaves sharing a feature id (the two
    // Palletization pages) get distinct tour anchors.
    return (
      <NavLink to={to} data-tour={`nav-${to.replace(/^\//, "")}`} className={({ isActive }) => `item ${isActive ? "active" : ""}`} style={pad}>
        <Icon name={node.icon} size={14} className="ic" />
        <span>{node.label}</span>
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
    // Refresh the Default view preference so boards opened later this session
    // (and the next cold tab, via the mirror) seed from the current setting.
    void loadDefaultView();
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

  // 2026-09-04: the runtime accent override is gone — the accent now comes
  // from the theme.css :root tokens (indigo); a JS write here would beat them.

  return (
    <div className={`app ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          {/* Expanded: full white+orange logo on a dark chip (it needs a dark
              ground). Collapsed: the compact "B" mark (CSS swaps them). */}
          <div className="mark">B</div>
          <div className="logo-chip">
            <img src={boffoLogo} alt="BOFFO — Adorable Surfaces" />
          </div>
          <button
            type="button"
            className="collapse-btn"
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            title={collapsed ? "Expand menu" : "Collapse menu"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
          >
            <Icon name="menu" size={14} />
          </button>
        </div>

        <nav className="group">
          {tree.map((n) => (
            <NavNodeRow
              key={n.label}
              node={n}
              depth={0}
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
        {isAdmin && (
          <button className="hbtn" title="Settings" aria-label="Settings" data-tour="settings" onClick={() => navigate("/settings")}>
            <Icon name="settings" size={13} />
          </button>
        )}
        <NotificationBell />
        <UserMenu user={user} />
      </header>

      <main className="main">
        {/* Key on the section (first path segment), not the full path, so moving
            between a list and its own detail doesn't remount <main> and flash the
            Suspense skeleton — only a genuine section change resets the boundary. */}
        <ErrorBoundary key={location.pathname.split("/")[1] || "root"}>
        <Suspense fallback={<div style={{ padding: 24 }}><SkeletonRows rows={8} /></div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/quotes" element={<Quotes />} />
            {/* CR-219: form pages — declared before the :id detail routes */}
            <Route path="/quotes/new" element={<QuoteFormPage />} />
            <Route path="/quotes/:id/edit" element={<QuoteFormPage />} />
            <Route path="/quotes/:id/clone" element={<QuoteFormPage />} />
            <Route path="/quotes/:id" element={<QuoteDetail />} />
            <Route path="/quotes/:id/containerise" element={<PlanContainerisation />} />
            <Route path="/kanban" element={<Kanban />} />
            <Route path="/byorder" element={<ByOrderView />} />
            <Route path="/orders" element={<OrdersTable />} />

            <Route path="/orders/new" element={<OrderFormPage />} />
            <Route path="/orders/:id/edit" element={<OrderFormPage />} />
            <Route path="/orders/:id/clone" element={<OrderFormPage />} />
            <Route path="/orders/:id/containerise" element={<PlanSoContainerisation />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/po/:id" element={<PurchaseOrderDetail />} />
            {/* CR-220: form pages — declared before the :id detail routes */}
            <Route path="/design/new" element={<DesignEdit />} />
            <Route path="/design/:id/edit" element={<DesignEdit />} />
            <Route path="/design/:id/clone" element={<DesignEdit clone />} />
            <Route path="/design/:id" element={<ItemDetail />} />
            <Route path="/parties/new" element={<PartyFormPage />} />
            <Route path="/parties/:id/edit" element={<PartyFormPage />} />
            <Route path="/parties/:id/clone" element={<PartyFormPage />} />
            <Route path="/parties/:id" element={<CustomerDetail />} />
            <Route path="/po" element={<PurchaseOrders />} />
            <Route path="/prod" element={<Production />} />
            <Route path="/prod/new" element={<ProductionFormPage />} />
            <Route path="/prod/record" element={<ProductionLogSheet />} />
            <Route path="/prod/:id/edit" element={<ProductionFormPage />} />
            <Route path="/prod/:id/clone" element={<ProductionFormPage />} />
            <Route path="/prod/:id" element={<ProductionDetail />} />
            <Route path="/qc" element={<QC />} />
            <Route path="/containers" element={<Containers />} />
            <Route path="/fit" element={<FitSuggest />} />
            <Route path="/loadplan" element={<LoadPlanner />} />
            <Route path="/ops" element={<OperationsLog />} />
            <Route path="/packing" element={<PalPlans stages={["Planning"]} sectionsKey="palplans.stages.ready" />} />
            {/* CR-170: Ready for Loading renders on /loading, not here. */}
            <Route path="/palletizing" element={<PalPlans stages={["Palletizing"]} />} />
            <Route path="/packing/new" element={<PalPlanFormPage />} />
            <Route path="/packing/:id/edit" element={<PalPlanFormPage />} />
            <Route path="/packing/:id/clone" element={<PalPlanFormPage />} />
            <Route path="/packing/:id" element={<PalPlanDetail />} />
            <Route path="/loading" element={<LoadingBay />} />
            <Route path="/loading/new" element={<LoadingSession />} />
            {/* CR-227 trial: spreadsheet-style New Loading, beside the session. */}
            <Route path="/loading/plan" element={<LoadingPlanPage />} />
            <Route path="/loading/:id/plan" element={<LoadingPlanPage />} />
          <Route path="/loading/:id/session" element={<LoadingSession />} />
          <Route path="/loading/:id" element={<LoadingDetail />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/reports" element={<ReportsHome />} />
            <Route path="/reports/:id" element={<ReportView />} />
            <Route path="/design" element={<DesignMaster />} />
            <Route path="/stock" element={<StockDetails />} />
            <Route path="/pallets" element={<Pallets />} />
            <Route path="/pallets/new" element={<PalletFormPage />} />
            <Route path="/pallets/:id/edit" element={<PalletFormPage />} />
            <Route path="/pallets/:id/clone" element={<PalletFormPage />} />
            <Route path="/pallets/:id" element={<PalletDetail />} />
            <Route path="/panels" element={<Panels />} />
            <Route path="/panels/:id" element={<PanelDetail />} />
            <Route path="/panel-orders" element={<PanelOrders />} />
            <Route path="/cut-stock" element={<CutStock />} />
            <Route path="/sizes" element={<Sizes />} />
            <Route path="/sizes/:id" element={<SizeDetail />} />
            <Route path="/settings" element={isAdmin ? <SettingsHome /> : <Navigate to="/dashboard" replace />} />
            <Route path="/data-operations" element={isAdmin ? <DataOperations /> : <Navigate to="/dashboard" replace />} />
            <Route path="/masters" element={isAdmin ? <Masters /> : <Navigate to="/dashboard" replace />} />
            <Route path="/users" element={isAdmin ? <UsersAdmin /> : <Navigate to="/dashboard" replace />} />
            <Route path="/roles" element={isAdmin ? <RolesAdmin /> : <Navigate to="/dashboard" replace />} />
            <Route path="/currencies" element={isAdmin ? <CurrenciesAdmin /> : <Navigate to="/dashboard" replace />} />
            <Route
              path="/approvals"
              element={canApprove("Quote") || canApprove("SalesOrder") || canApprove("Production") ? <Approvals /> : <Navigate to="/dashboard" replace />}
            />
            <Route path="/parties" element={<PartiesView />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
      <ToastHost />
      <ConfirmHost />
      <TourHost
        userReady={user !== null}
        expandSidebar={() => setCollapsed(false)}
        openGroup={(label) => setOpenGroups((p) => ({ ...p, [label]: true }))}
      />
    </div>
  );
}
