/* ============================================================
   BOFFO Order OS — app shell + router
   Sidebar + header markup kept identical to prototype/app.jsx.
   Navigation is HashRouter-based; each page is lazy-loaded into its own
   chunk (code-splitting). Route path === the prototype's view id.
   ============================================================ */
import { Suspense, lazy, useEffect, useMemo } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { DESIGNS, ORDERS, PARTIES, STAGES } from "@/data";

/* Lazy page chunks (named exports → default-wrapped for React.lazy). */
const Dashboard = lazy(() => import("@/features/dashboard/Dashboard").then((m) => ({ default: m.Dashboard })));
const Kanban = lazy(() => import("@/features/pipeline/Kanban").then((m) => ({ default: m.Kanban })));
const ByOrderView = lazy(() => import("@/features/orders/ByOrderView").then((m) => ({ default: m.ByOrderView })));
const OrdersTable = lazy(() => import("@/features/orders/OrdersTable").then((m) => ({ default: m.OrdersTable })));
const PurchaseOrders = lazy(() => import("@/features/stages/PurchaseOrders").then((m) => ({ default: m.PurchaseOrders })));
const Production = lazy(() => import("@/features/stages/Production").then((m) => ({ default: m.Production })));
const PalletPacking = lazy(() => import("@/features/stages/PalletPacking").then((m) => ({ default: m.PalletPacking })));
const Loading = lazy(() => import("@/features/stages/Loading").then((m) => ({ default: m.Loading })));
const FinalLoading = lazy(() => import("@/features/stages/FinalLoading").then((m) => ({ default: m.FinalLoading })));
const DesignMaster = lazy(() => import("@/features/masters/DesignMaster").then((m) => ({ default: m.DesignMaster })));
const PartiesView = lazy(() => import("@/features/masters/Parties").then((m) => ({ default: m.PartiesView })));

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

interface NavItem {
  id: string;
  label: string;
  icon: string;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "dashboard" },
      { id: "kanban", label: "Pipeline", icon: "kanban" },
      { id: "byorder", label: "By Order", icon: "orders" },
      { id: "orders", label: "All Orders", icon: "docs" },
    ],
  },
  {
    title: "Stages",
    items: [
      { id: "po", label: "Purchase Orders", icon: "docs" },
      { id: "prod", label: "Production", icon: "factory" },
      { id: "packing", label: "Pallet Packing", icon: "palette" },
      { id: "loading", label: "Loading", icon: "truck" },
      { id: "final", label: "Final Loading", icon: "invoice" },
    ],
  },
  {
    title: "Masters",
    items: [
      { id: "design", label: "Design Master", icon: "tile" },
      { id: "parties", label: "Parties", icon: "flag" },
    ],
  },
];

const VIEW_LABELS: Record<string, [string, string]> = {
  dashboard: ["Workspace", "Dashboard"],
  kanban: ["Orders", "Pipeline"],
  byorder: ["Orders", "By Order"],
  orders: ["Orders", "All Orders"],
  po: ["Stages", "Purchase Orders"],
  prod: ["Stages", "Production"],
  packing: ["Stages", "Pallet Packing"],
  loading: ["Stages", "Loading"],
  final: ["Stages", "Final Loading"],
  design: ["Masters", "Design Master"],
  parties: ["Masters", "Parties"],
};

export default function App() {
  const location = useLocation();
  const currentId = location.pathname.replace(/^\//, "") || "dashboard";

  useEffect(() => {
    applyAccent(TWEAK_DEFAULTS.accent);
    const d = TWEAK_DEFAULTS.density;
    document.documentElement.style.setProperty("--t-md", d === "spacious" ? "13.5px" : "12.5px");
    document.documentElement.style.setProperty("--t-sm", d === "spacious" ? "12px" : "11.5px");
  }, []);

  const counts = useMemo<Record<string, number | string>>(() => {
    const c: Record<string, number | string> = { dashboard: "", kanban: ORDERS.length, orders: ORDERS.length };
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

        {NAV_GROUPS.map((g) => (
          <div className="group" key={g.title}>
            <div className="group-title">{g.title}</div>
            {g.items.map((it) => (
              <NavLink key={it.id} to={`/${it.id}`} className={({ isActive }) => `item ${isActive ? "active" : ""}`}>
                <Icon name={it.icon} size={14} className="ic" />
                <span>{it.label}</span>
                {counts[it.id] != null && counts[it.id] !== "" && <span className="count">{counts[it.id]}</span>}
              </NavLink>
            ))}
          </div>
        ))}

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
            <Route path="/kanban" element={<Kanban />} />
            <Route path="/byorder" element={<ByOrderView />} />
            <Route path="/orders" element={<OrdersTable />} />
            <Route path="/po" element={<PurchaseOrders />} />
            <Route path="/prod" element={<Production />} />
            <Route path="/packing" element={<PalletPacking />} />
            <Route path="/loading" element={<Loading />} />
            <Route path="/final" element={<FinalLoading />} />
            <Route path="/design" element={<DesignMaster />} />
            <Route path="/parties" element={<PartiesView />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
