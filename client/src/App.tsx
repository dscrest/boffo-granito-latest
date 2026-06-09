/* ============================================================
   BOFFO Order OS — app shell + router
   Sidebar + header markup kept identical to prototype/app.jsx.
   Navigation is HashRouter-based; each page is lazy-loaded into its own
   chunk (code-splitting). Route path === the prototype's view id.
   ============================================================ */
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { DESIGNS, ORDERS, PARTIES, QUOTES, STAGES } from "@/data";
import { checkSession, type SessionUser } from "@/lib/auth";

/* Lazy page chunks (named exports → default-wrapped for React.lazy). */
const Dashboard = lazy(() => import("@/features/dashboard/Dashboard").then((m) => ({ default: m.Dashboard })));
const Quotes = lazy(() => import("@/features/quotes/QuotesTable").then((m) => ({ default: m.QuotesTable })));
const Kanban = lazy(() => import("@/features/pipeline/Kanban").then((m) => ({ default: m.Kanban })));
const ByOrderView = lazy(() => import("@/features/orders/ByOrderView").then((m) => ({ default: m.ByOrderView })));
const OrdersTable = lazy(() => import("@/features/orders/OrdersTable").then((m) => ({ default: m.OrdersTable })));
const PurchaseOrders = lazy(() => import("@/features/stages/PurchaseOrders").then((m) => ({ default: m.PurchaseOrders })));
const Production = lazy(() => import("@/features/stages/Production").then((m) => ({ default: m.Production })));
const QC = lazy(() => import("@/features/stages/QC").then((m) => ({ default: m.QC })));
const OperationsLog = lazy(() => import("@/features/ops/OperationsLog").then((m) => ({ default: m.OperationsLog })));
const PalletPacking = lazy(() => import("@/features/stages/PalletPacking").then((m) => ({ default: m.PalletPacking })));
const Loading = lazy(() => import("@/features/stages/Loading").then((m) => ({ default: m.Loading })));
const FinalLoading = lazy(() => import("@/features/stages/FinalLoading").then((m) => ({ default: m.FinalLoading })));
const DesignMaster = lazy(() => import("@/features/masters/DesignMaster").then((m) => ({ default: m.DesignMaster })));
const PartiesView = lazy(() => import("@/features/masters/Parties").then((m) => ({ default: m.PartiesView })));
const Masters = lazy(() => import("@/features/masters/Masters").then((m) => ({ default: m.Masters })));

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

/* Build the sidebar tree. `isAdmin` gates the Settings group (Masters), which is
   admin-only — non-admins never see the lookup-table editors. Customers leads the
   Sales group (Books-parity menu order). */
function navTree(isAdmin: boolean): NavNode[] {
  const tree: NavNode[] = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    {
      label: "Items",
      icon: "tile",
      children: [
        { id: "design", label: "Items", icon: "tile" },
        { id: "prod", label: "Production", icon: "factory" },
        { id: "packing", label: "Pallets", icon: "palette" },
      ],
    },
    {
      label: "Sales",
      icon: "orders",
      children: [
        { id: "parties", label: "Customers", icon: "flag" },
        { id: "quotes", label: "Quotes", icon: "quote" },
        {
          label: "Sales Orders",
          icon: "docs",
          children: [
            { id: "kanban", label: "Pipeline", icon: "kanban" },
            { id: "byorder", label: "By Order", icon: "orders" },
            { id: "orders", label: "All Orders", icon: "docs" },
          ],
        },
      ],
    },
    {
      label: "Stages",
      icon: "truck",
      children: [
        { id: "po", label: "Purchase Orders", icon: "docs" },
        { id: "qc", label: "Quality Control", icon: "shield-check" },
        { id: "loading", label: "Loading", icon: "truck" },
        { id: "final", label: "Final Loading", icon: "invoice" },
      ],
    },
    {
      label: "System",
      icon: "settings",
      children: [{ id: "ops", label: "Operations Log", icon: "clock" }],
    },
  ];
  if (isAdmin) {
    tree.push({
      label: "Settings",
      icon: "settings",
      children: [{ id: "masters", label: "Masters", icon: "settings" }],
    });
  }
  return tree;
}

/* breadcrumb [section, page] per route id, mirrors the tree hierarchy. */
const VIEW_LABELS: Record<string, [string, string]> = {
  dashboard: ["Workspace", "Dashboard"],
  design: ["Items", "Items"],
  masters: ["Settings", "Masters"],
  prod: ["Items", "Production"],
  packing: ["Items", "Pallets"],
  quotes: ["Sales", "Quotes"],
  parties: ["Sales", "Customers"],
  kanban: ["Sales Orders", "Pipeline"],
  byorder: ["Sales Orders", "By Order"],
  orders: ["Sales Orders", "All Orders"],
  po: ["Stages", "Purchase Orders"],
  qc: ["Stages", "Quality Control"],
  loading: ["Stages", "Loading"],
  final: ["Stages", "Final Loading"],
  ops: ["System", "Operations Log"],
};

/* Labels of every parent on the path to `id` — used to auto-open ancestors. */
function ancestorsOf(id: string, nodes: NavNode[] = navTree(true), trail: string[] = []): string[] | null {
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
   recurses into its children when open. `depth` drives the indent. */
function NavNodeRow({ node, depth, counts, openGroups, onToggle }: NavNodeRowProps) {
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
}

export default function App() {
  const location = useLocation();
  const currentId = location.pathname.replace(/^\//, "") || "dashboard";

  // Session → admin gate for the Settings (Masters) group + route.
  const [user, setUser] = useState<SessionUser | null>(null);
  useEffect(() => {
    void checkSession().then(setUser);
  }, []);
  const isAdmin = user?.role === "Admin";
  const tree = useMemo(() => navTree(isAdmin), [isAdmin]);

  // Which parent groups are expanded. Active route's ancestors auto-open.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    (ancestorsOf(currentId) || []).forEach((l) => (init[l] = true));
    return init;
  });
  useEffect(() => {
    const anc = ancestorsOf(currentId);
    if (anc?.length) setOpenGroups((p) => ({ ...p, ...Object.fromEntries(anc.map((l) => [l, true])) }));
  }, [currentId]);
  const toggleGroup = (label: string) => setOpenGroups((p) => ({ ...p, [label]: !p[label] }));

  useEffect(() => {
    applyAccent(TWEAK_DEFAULTS.accent);
    const d = TWEAK_DEFAULTS.density;
    document.documentElement.style.setProperty("--t-md", d === "spacious" ? "13.5px" : "12.5px");
    document.documentElement.style.setProperty("--t-sm", d === "spacious" ? "12px" : "11.5px");
  }, []);

  const counts = useMemo<Record<string, number | string>>(() => {
    const c: Record<string, number | string> = { dashboard: "", quotes: QUOTES.length, kanban: ORDERS.length, orders: ORDERS.length };
    const distinctPOs = new Set<string>();
    ORDERS.forEach((o) => distinctPOs.add(`${o.poNumber}__${o.partyCode}`));
    c.byorder = distinctPOs.size;
    STAGES.forEach((s) => (c[s.id] = ORDERS.filter((o) => o.stage === s.id).length));
    c.design = DESIGNS.length;
    c.parties = PARTIES.length;
    return c;
  }, []);

  const crumbs = VIEW_LABELS[currentId] || ["", ""];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">B</div>
          <div className="name">BOFFO</div>
          <div className="ver">v4.0</div>
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
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="dot" />
            <span style={{ color: "var(--fg-2)" }}>Synced</span>
            <span style={{ marginLeft: "auto", color: "var(--dim)" }} className="mono">
              3s ago
            </span>
          </div>
          <div className="row" style={{ color: "var(--dim)" }}>
            <Icon name="clock" size={11} />
            <span>Plant Morbi · Shift A</span>
          </div>
        </div>
      </aside>

      <header className="header">
        <div className="crumbs">
          <Icon name="chev-r" size={12} style={{ opacity: 0.4 }} />
          <span>{crumbs[0]}</span>
          <Icon name="chev-r" size={12} style={{ opacity: 0.4 }} />
          <span className="cur">{crumbs[1]}</span>
        </div>
        <div className="search">
          <Icon name="search" size={13} className="icon" />
          <input placeholder="Search PO, design, party, invoice…" />
          <span className="kbd">⌘K</span>
        </div>
        <button className="hbtn" title="Notifications">
          <Icon name="bell" size={13} />
          <span className="dot red" style={{ width: 5, height: 5, marginLeft: -3 }} />
        </button>
        <button className="hbtn">
          <Icon name="settings" size={13} />
        </button>
        <div className="avatar">BG</div>
      </header>

      <main className="main">
        <Suspense fallback={<div className="muted mono" style={{ padding: 24 }}>Loading…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/quotes" element={<Quotes />} />
            <Route path="/kanban" element={<Kanban />} />
            <Route path="/byorder" element={<ByOrderView />} />
            <Route path="/orders" element={<OrdersTable />} />
            <Route path="/po" element={<PurchaseOrders />} />
            <Route path="/prod" element={<Production />} />
            <Route path="/qc" element={<QC />} />
            <Route path="/ops" element={<OperationsLog />} />
            <Route path="/packing" element={<PalletPacking />} />
            <Route path="/loading" element={<Loading />} />
            <Route path="/final" element={<FinalLoading />} />
            <Route path="/design" element={<DesignMaster />} />
            <Route path="/masters" element={isAdmin ? <Masters /> : <Navigate to="/dashboard" replace />} />
            <Route path="/parties" element={<PartiesView />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
