/* ============================================================
   Glass Kit (CR-378) — the kitchen-sink page of the BOFFO Glass design
   system: every control and state on one admin-only screen (#/glass-kit)
   so the skin can be reviewed by clicking, in dark, light and system.
   Static markup only; no data, no API. Deletable once the trial is
   accepted — the owner of every rule is styles/glass.css.
   ============================================================ */
import { useState, type ReactNode } from "react";
import { Icon } from "@/ui/Icon";
import { Chip, type ChipTone } from "@/ui/Chip";
import { KPI, ProgressBar, StageBadge } from "@/ui/primitives";
import { EmptyState, Note } from "@/ui/States";
import { toast } from "@/ui/Toast";
import { confirmDialog, confirmDiscard } from "@/ui/ConfirmDialog";

const TONES: ChipTone[] = ["gray", "amber", "sky", "teal", "blue", "violet", "green", "slate", "red"];

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <span className="title">{title}</span>
        {sub && <span className="muted">· {sub}</span>}
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

const Row = ({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) => (
  <div className="row" style={{ gap: 10, flexWrap: wrap ? "wrap" : "nowrap", alignItems: "center" }}>{children}</div>
);

export function GlassKit() {
  const [seg, setSeg] = useState<"all" | "active" | "inactive">("all");
  const [on, setOn] = useState(true);
  const [tab, setTab] = useState(0);
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Design system</div>
          <div className="title">BOFFO Glass</div>
          <div className="sub">Every control of the glass skin, in its states. Flip the theme with the header toggle.</div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => toast.info("An info toast")}><Icon name="info" size={13} /> Toast</button>
          <button className="hbtn primary" onClick={() => toast.success("Saved")}><Icon name="check" size={13} /> Primary</button>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <KPI label="Total Order Qty" value="12,480" unit="boxes" delta="18 active orders" spark={[3, 5, 4, 7, 6, 9, 8]} />
        <KPI label="Produced" value="9,120" unit="boxes" delta="73% of ordered" color="var(--c-blue)" />
        <KPI label="Pallets Packed" value="214" unit="pallets" delta="6,840 boxes total" color="var(--c-violet)" />
        <KPI label="Ready to Load" value="38" unit="pallets" delta="1,216 boxes ready" color="var(--c-cyan)" />
        <KPI label="Loaded" value="156" unit="pallets" delta="4,992 boxes loaded" color="var(--c-green)" />
      </div>

      <Section title="Buttons" sub="one .primary per view">
        <Row>
          <button className="btn">Default</button>
          <button className="btn primary">Primary</button>
          <button className="btn active">Selected</button>
          <button className="btn danger">Danger</button>
          <button className="btn" disabled>Disabled</button>
          <button className="btn x plain" title="Icon only"><Icon name="columns" size={13} /></button>
          <button className="pc-ibtn" title="Toolbar icon"><Icon name="filter" size={13} /></button>
          <button className="hbtn"><Icon name="plus" size={13} /> Header button</button>
          <button className="linkish">Link-ish text</button>
        </Row>
        <Row>
          <button className="hbtn" onClick={() => void confirmDialog({ title: "Confirm this?", message: "A designed confirm dialog.", confirmLabel: "Yes, do it", cancelLabel: "No" })}>Confirm dialog</button>
          <button className="hbtn" onClick={() => void confirmDiscard()}>Discard dialog</button>
          <button className="hbtn" onClick={() => toast.error("Something went wrong")}>Error toast</button>
        </Row>
      </Section>

      <Section title="Segmented, switch, tabs">
        <Row>
          <div className="seg" role="group" aria-label="Status">
            {(["all", "active", "inactive"] as const).map((k) => (
              <button key={k} type="button" className={`seg-btn${seg === k ? " on" : ""}`} aria-pressed={seg === k} onClick={() => setSeg(k)}>
                {k[0]!.toUpperCase() + k.slice(1)}
                <span className="badge">{k === "all" ? 48 : k === "active" ? 42 : 6}</span>
              </button>
            ))}
          </div>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" className="switch" checked={on} onChange={(e) => setOn(e.target.checked)} />
            <span>{on ? "On" : "Off"}</span>
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked readOnly />
            <span>Native checkbox</span>
          </label>
        </Row>
        <div className="dtabs">
          {["Details", "Orders", "Activity"].map((t, i) => (
            <button key={t} className={`tab${tab === i ? " active" : ""}`} onClick={() => setTab(i)}>
              {t}
              <span className="ct">{i * 3 + 2}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Inputs">
        <div className="form-rows">
          <div className="form-field">
            <div className="lbl">Text <span className="req">*</span></div>
            <input type="text" placeholder="Type here…" />
          </div>
          <div className="form-field">
            <div className="lbl">Select</div>
            <select defaultValue="b">
              <option value="a">Sheet</option>
              <option value="b">Kanban</option>
            </select>
          </div>
          <div className="form-field">
            <div className="lbl">Number</div>
            <input type="number" defaultValue={42} />
          </div>
          <div className="form-field">
            <div className="lbl">Date</div>
            <input type="date" defaultValue="2026-10-22" />
          </div>
          <div className="form-field span2">
            <div className="lbl">Notes</div>
            <textarea defaultValue="A textarea." />
          </div>
          <div className="form-field">
            <div className="lbl">Error</div>
            <input type="text" className="error" defaultValue="Invalid value" />
            <div className="field-err">This field is required.</div>
          </div>
        </div>
        <Row>
          <span className="gsearch">
            <Icon name="search" size={13} />
            <input type="text" placeholder="Search pill…" />
          </span>
          <select className="pg-size" defaultValue="25"><option>25</option><option>50</option></select>
        </Row>
      </Section>

      <Section title="Chips, badges, dots">
        <Row>{TONES.map((t) => <Chip key={t} tone={t} label={t} />)}</Row>
        <Row>
          <span className="chip">neutral chip</span>
          <span className="pill">pill</span>
          <span className="badge">12</span>
          <StageBadge stage="Production" />
          <StageBadge stage="Packing" />
          <StageBadge stage="Loading" />
          <span className="prio urgent"><Icon name="flag" size={11} /> Urgent</span>
          <span className="prio high">High</span>
          <span className="prio medium">Medium</span>
          <span className="prio low">Low</span>
        </Row>
        <Row>
          <span className="row" style={{ gap: 6 }}><span className="dot blue" /> Produced</span>
          <span className="row" style={{ gap: 6 }}><span className="dot violet" /> Palletized</span>
          <span className="row" style={{ gap: 6 }}><span className="dot green" /> Loaded</span>
          <span className="row" style={{ gap: 6 }}><span className="live-dot" /> Live</span>
          <span className="row" style={{ gap: 6 }}><span className="presence online" /> Online</span>
          <span className="row" style={{ gap: 6 }}><span className="presence away" /> Away</span>
          <span className="row" style={{ gap: 6 }}><span className="presence busy" /> In a meeting</span>
        </Row>
      </Section>

      <Section title="Identity">
        <Row>
          {["Northpeak", "Ironbark Imports", "Granite Pay", "Redwood Analytics", "Keystone Freight", "Cobalt Mobility"].map((n, i) => (
            <span className="ident" key={n}>
              <span className={`ini hue-${i}`}>{n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
              <span className="ident-text">
                <span className="linkish">{n}</span>
                <span className="ident-sub mono">CUS-0{i + 1}</span>
              </span>
            </span>
          ))}
        </Row>
        <Row>
          <span className="av-stack">
            {["JP", "AR", "LO", "SO"].map((x, i) => <span key={x} className={`av hue-${i}`}>{x}</span>)}
          </span>
          <span className="av lg hue-4">DS</span>
        </Row>
      </Section>

      <Section title="Progress, notes, empty state">
        <div style={{ maxWidth: 360 }}><ProgressBar value={136} max={150} /></div>
        <div style={{ maxWidth: 360 }}><ProgressBar value={60} max={150} color="var(--c-green)" height={6} /></div>
        <Note tone="info">An informational note sits under the content it explains.</Note>
        <Note tone="warn">A warning note.</Note>
        <EmptyState icon="flag" title="Nothing here yet" hint="Click New to add the first record." />
      </Section>

      <div className="card">
        <div className="fbar">
          <Icon name="filter" size={12} />
          <select defaultValue=""><option value="">Filter by…</option><option>Country</option></select>
          <div style={{ flex: 1 }} />
          <span className="gsearch"><Icon name="search" size={13} /><input type="text" placeholder="Search…" /></span>
          <button className="btn active"><Icon name="columns" size={13} /></button>
          <button className="hbtn primary"><Icon name="plus" size={13} /> New</button>
        </div>
        <table className="tbl">
          <thead>
            <tr><th>Customer</th><th>Status</th><th>Stage</th><th style={{ textAlign: "right" }}>Qty</th><th>Owner</th></tr>
          </thead>
          <tbody>
            {[["Northpeak", true, "Production", "4,115"], ["Ironbark Imports", true, "Packing", "3,885"], ["Granite Pay", false, "Loading", "3,635"]].map(([n, a, s, q], i) => (
              <tr key={String(n)} className={i === 1 ? "sel" : undefined}>
                <td>
                  <span className="ident">
                    <span className={`ini hue-${i}`}>{String(n).slice(0, 2).toUpperCase()}</span>
                    <span className="ident-text"><span className="linkish">{String(n)}</span><span className="ident-sub mono">CUS-0{i + 1}</span></span>
                  </span>
                </td>
                <td><Chip tone={a ? "green" : "gray"} label={a ? "Active" : "Inactive"} /></td>
                <td><StageBadge stage={String(s)} /></td>
                <td className="num mono">{String(q)}</td>
                <td><span className={`av hue-${i + 2}`}>{["JP", "AR", "LO"][i]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
