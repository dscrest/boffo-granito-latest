/* ============================================================
   DetailRail — the sticky, resizable left-panel sibling list shared by
   detail pages (extracted from PalPlanDetail; same design as Quote/Order
   detail rails). Search + rows of a dim subtitle (customer · status) over the
   mono code (CR-179: swapped so the customer reads first); the current record
   is highlighted.
   ============================================================ */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/ui/Icon";

export type DetailRailItem = {
  id: string;
  to: string;
  title: string;
  subtitle: string;
  /** Extra search haystack (e.g. SO numbers) beyond title + subtitle. */
  searchText?: string;
};

export function DetailRail({ placeholder, currentId, items }: { placeholder: string; currentId: string; items: DetailRailItem[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const listed = needle
    ? items.filter((x) => `${x.title} ${x.subtitle} ${x.searchText ?? ""}`.toLowerCase().includes(needle))
    : items;
  return (
    <div
      className="card"
      style={{
        width: 300, minWidth: 220, maxWidth: 420, flexShrink: 0, padding: 0,
        resize: "horizontal", overflow: "hidden", display: "flex", flexDirection: "column",
        height: "calc(100vh - var(--header-h) - 46px)", position: "sticky", top: 0,
      }}
    >
      <div className="lp-search">
        <Icon name="search" size={13} />
        <input type="text" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
        {listed.map((x) => {
          const cur = x.id === currentId;
          return (
            <Link
              key={x.id}
              to={x.to}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: "none",
                borderBottom: "1px solid var(--border)", background: cur ? "var(--accent-soft)" : "transparent",
                cursor: "pointer", font: "inherit", color: "inherit", textDecoration: "none",
              }}
              title={x.title}
            >
              <div className="dim" style={{ fontSize: "var(--t-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={x.subtitle}>
                {x.subtitle}
              </div>
              <div className="mono" style={{ fontWeight: 500, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.title}</div>
            </Link>
          );
        })}
        {listed.length === 0 && <div className="dim" style={{ padding: 12 }}>No matching records</div>}
      </div>
    </div>
  );
}
