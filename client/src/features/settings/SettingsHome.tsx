/* ============================================================
   SettingsHome — one "All Settings" landing page that consolidates
   every settings surface into grouped section cards, each with
   clickable items that route to the existing pages. Reached from the
   header gear (admin-only route). Config-driven, mirroring the
   MASTERS/LINKS style in Masters.tsx; markup reuses existing app
   classes (page-head, card, card-head, card-body).
   ============================================================ */
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";

interface SettingItem {
  label: string;
  icon: string;
  route: string;
}

interface SettingSection {
  title: string;
  icon: string;
  items: SettingItem[];
}

const SECTIONS: SettingSection[] = [
  {
    title: "Users & Roles",
    icon: "users",
    items: [
      { label: "Users", icon: "users", route: "/users" },
      { label: "Roles", icon: "shield-check", route: "/roles" },
      { label: "Sales Persons", icon: "user", route: "/salespersons" },
    ],
  },
  {
    title: "Setup & Configuration",
    icon: "settings",
    items: [
      { label: "Currencies", icon: "chart", route: "/currencies" },
      { label: "Payment Terms", icon: "invoice", route: "/masters?m=payment_term" },
    ],
  },
  {
    title: "Data Operations",
    icon: "docs",
    items: [
      { label: "Export", icon: "docs", route: "/data-operations" },
    ],
  },
  {
    title: "Product Masters",
    icon: "tile",
    items: [
      { label: "Finish", icon: "palette", route: "/masters?m=finish" },
      { label: "Category", icon: "tile", route: "/masters?m=category" },
      { label: "Glaze", icon: "palette", route: "/masters?m=glaze" },
      { label: "Brand", icon: "flag", route: "/masters?m=brand" },
      { label: "Customer Brand", icon: "flag", route: "/masters?m=party_brand" },
      { label: "Grade", icon: "check", route: "/masters?m=grade" },
      { label: "Sizes", icon: "tile", route: "/sizes" },
    ],
  },
];

export function SettingsHome() {
  const navigate = useNavigate();

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">All Settings</div>
          <div className="sub">Manage users, configuration and product masters</div>
        </div>
      </div>

      <div className="settings-grid">
        {SECTIONS.map((s) => (
          <div key={s.title} className="card">
            <div className="card-head">
              <Icon name={s.icon} size={13} className="ic" />
              <div className="title">{s.title}</div>
            </div>
            <div className="card-body settings-list">
              {s.items.map((it) => (
                <button
                  key={it.route}
                  className="settings-item"
                  onClick={() => navigate(it.route)}
                  title={`Open ${it.label}`}
                >
                  <Icon name={it.icon} size={13} className="ic" />
                  <span>{it.label}</span>
                  <Icon name="arrow-r" size={12} className="chev" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
