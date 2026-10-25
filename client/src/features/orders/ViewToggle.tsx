/* Grid | List segmented toggle (Kanban hidden app-wide, CR-418) shown at the top of the Sales Order
   pages. Icon-only, real <Link> anchors (right-click open-in-new-tab works)
   styled like the QuoteDetail Details|PDF segmented control. */
import type { CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";
import { Icon } from "@/ui/Icon";

function segStyle(active: boolean): CSSProperties {
  return {
    background: active ? "var(--accent-soft)" : "transparent",
    color: active ? "var(--fg)" : "var(--muted)",
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 12px",
    textDecoration: "none",
  };
}

export function ViewToggle() {
  const { pathname } = useLocation();
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }} title="Switch view">
      <Link to="/byorder" style={segStyle(pathname.startsWith("/byorder"))} title="List" aria-label="List view"><Icon name="tile" size={15} /></Link>
      {/* Grid is the default Sales Order view (the sidebar lands here).
          exact match: /orders/:id (detail) must not light up Grid */}
      <Link to="/orders" style={segStyle(pathname === "/orders")} title="Grid" aria-label="Grid view"><Icon name="orders" size={15} /></Link>
    </div>
  );
}
