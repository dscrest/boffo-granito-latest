/* ============================================================
   ReportsHome — the /reports landing. Section cards (Sales /
   Customer / Item / Inventory), each listing its reports as
   clickable links that route to /reports/:id. Config-driven from
   the REPORTS registry (single source of truth); mirrors
   SettingsHome's page-head + settings-grid idiom.
   ============================================================ */
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { REPORTS, REPORT_SECTIONS } from "./Reports";

const BY_ID = Object.fromEntries(REPORTS.map((r) => [r.id, r]));

export function ReportsHome() {
  const navigate = useNavigate();

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Reports</div>
          <div className="sub">Sales, customer, item and inventory reports — live data</div>
        </div>
      </div>

      <div className="settings-grid">
        {REPORT_SECTIONS.map((s) => (
          <div key={s.section} className="card">
            <div className="card-head">
              <Icon name={s.icon} size={13} className="ic" />
              <div className="title">{s.section}</div>
            </div>
            <div className="card-body settings-list">
              {s.ids.map((id) => {
                const r = BY_ID[id];
                if (!r) return null;
                return (
                  <button key={id} className="settings-item" onClick={() => navigate(`/reports/${id}`)} title={r.subtitle}>
                    <Icon name={r.icon} size={13} className="ic" />
                    <span>{r.title}</span>
                    <Icon name="arrow-r" size={12} className="chev" />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
