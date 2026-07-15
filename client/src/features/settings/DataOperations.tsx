/* ============================================================
   Data Operations — Settings landing for bulk data actions.
   Menu only for now (Export placeholder); operations wired later.
   ============================================================ */
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";

interface OpItem {
  label: string;
  icon: string;
  hint: string;
}

const OPS: OpItem[] = [
  { label: "Export", icon: "docs", hint: "Export records to CSV — coming soon" },
];

export function DataOperations() {
  const navigate = useNavigate();
  return (
    <div>
      <div className="page-head">
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <button className="hbtn" onClick={() => navigate("/settings")} title="Back to settings">
            <Icon name="chev-l" size={13} />
          </button>
          <div>
            <div className="title">Data Operations</div>
            <div className="sub">Bulk import / export and data maintenance</div>
          </div>
        </div>
      </div>

      <div className="settings-grid">
        <div className="card">
          <div className="card-head">
            <Icon name="docs" size={13} className="ic" />
            <div className="title">Operations</div>
          </div>
          <div className="card-body settings-list">
            {OPS.map((it) => (
              <button key={it.label} className="settings-item" disabled title={it.hint}>
                <Icon name={it.icon} size={13} className="ic" />
                <span>{it.label}</span>
                <span className="dim" style={{ marginLeft: "auto", fontSize: "var(--t-sm)" }}>Soon</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
