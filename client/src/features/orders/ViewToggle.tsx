/* Grid | List | Kanban segmented toggle shown at the top of the Sales Order
   pages. Real <Link> anchors (right-click open-in-new-tab works) styled like
   the QuoteDetail Details|PDF segmented control. */
import type { CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";

function segStyle(active: boolean): CSSProperties {
  return {
    background: active ? "var(--accent-soft)" : "transparent",
    color: active ? "var(--fg)" : "var(--muted)",
    fontWeight: active ? 600 : 400,
    padding: "4px 12px",
    fontSize: "var(--t-sm)",
    textDecoration: "none",
  };
}

export function ViewToggle() {
  const { pathname } = useLocation();
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }} title="Switch view">
      {/* exact match: /orders/:id (detail) must not light up Grid */}
      <Link to="/orders" style={segStyle(pathname === "/orders")}>Grid</Link>
      <Link to="/byorder" style={segStyle(pathname.startsWith("/byorder"))}>List</Link>
      <Link to="/kanban" style={segStyle(pathname.startsWith("/kanban"))}>Kanban</Link>
    </div>
  );
}
