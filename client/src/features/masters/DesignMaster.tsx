/* Design Master — table of designs (Items) with a New Design entry form.
   Base rows come from mock DESIGNS; newly-entered designs are kept in local
   `drafts` state (frontend-only, not yet persisted) and shown first. */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { fmt, finishClass } from "@/lib/format";
import { DESIGNS, FINISHES, ORDERS, SIZES } from "@/data";
import { DesignForm, type DesignDraft } from "./DesignForm";

interface DesignRow {
  name: string;
  base: string;
  size: string;
  finish: string;
  brand: string;
  glaze: string;
  isDraft: boolean;
}

export function DesignMaster() {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [drafts, setDrafts] = useState<DesignDraft[]>([]);

  const addDraft = (d: DesignDraft) => {
    setDrafts((p) => [d, ...p]);
    setShowForm(false);
  };

  const rows = useMemo<DesignRow[]>(() => {
    const draftRows: DesignRow[] = drafts.map((d) => ({
      name: d.design_name,
      base: d.base_design_name || d.design_name,
      size: d.size,
      finish: d.finish,
      brand: d.brand,
      glaze: d.glaze || d.finish,
      isDraft: true,
    }));
    const baseRows: DesignRow[] = DESIGNS.map((d) => ({
      name: d.name,
      base: d.name,
      size: d.size,
      finish: d.finish,
      brand: d.brand,
      glaze: d.finish,
      isDraft: false,
    }));
    return [...draftRows, ...baseRows];
  }, [drafts]);

  return (
    <div>
      {showForm && <DesignForm onSave={addDraft} onClose={() => setShowForm(false)} />}
      <div className="page-head">
        <div>
          <div className="title">Design Master</div>
          <div className="sub">
            {rows.length} designs · {SIZES.length} sizes · {FINISHES.length} finishes
            {drafts.length > 0 && (
              <>
                {" · "}
                <span className="dim">{drafts.length} unsaved draft{drafts.length > 1 ? "s" : ""}</span>
              </>
            )}
          </div>
        </div>
        <div className="right">
          <button className="hbtn">
            <Icon name="download" size={13} />
            Export
          </button>
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            New design
          </button>
        </div>
      </div>

      <div className="fbar">
        <button className="btn active">All</button>
        <button className="btn">600x1200</button>
        <button className="btn">200x1200</button>
        <button className="btn">600x600</button>
        <button className="btn">75x600</button>
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Search design…" />
        <button className="btn">Group by Brand</button>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: "center" }}>#</th>
              <th>Design Name</th>
              <th>Base Design</th>
              <th>Size</th>
              <th>Finish</th>
              <th>Brand</th>
              <th>Glaze</th>
              <th className="num" style={{ textAlign: "right" }}>
                Active POs
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Open Qty
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => {
              const open = ORDERS.filter((o) => o.design === d.name).reduce((s, o) => s + (o.orderQty - o.loadedQty), 0);
              const pos = ORDERS.filter((o) => o.design === d.name).length;
              return (
                <tr key={`${d.name}-${i}`}>
                  <td className="muted mono" style={{ textAlign: "center" }}>
                    {i + 1}
                  </td>
                  <td>
                    {d.isDraft ? (
                      <span className="design-name">{d.name}</span>
                    ) : (
                      <button
                        className="design-name"
                        style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", color: "var(--accent)" }}
                        onClick={() => navigate(`/design/${encodeURIComponent(d.name)}`)}
                        title="Open details"
                      >
                        {d.name}
                      </button>
                    )}
                    {d.isDraft && (
                      <span className="chip" style={{ marginLeft: 6, background: "var(--accent-soft)", color: "var(--accent)" }}>
                        draft
                      </span>
                    )}
                  </td>
                  <td className="muted">{d.base}</td>
                  <td>
                    <span className={`chip size ${d.size.startsWith("200") || d.size.startsWith("75") ? "b" : ""}`}>{d.size}</span>
                  </td>
                  <td>
                    <span className={`chip finish ${finishClass(d.finish)}`}>{d.finish}</span>
                  </td>
                  <td>
                    <span className={`chip brand ${d.brand === "BIG" ? "big" : ""}`}>{d.brand}</span>
                  </td>
                  <td>
                    <span className={`chip finish ${finishClass(d.glaze)}`}>{d.glaze}</span>
                  </td>
                  <td className="num">{pos}</td>
                  <td className="num">{open > 0 ? fmt(open) : <span className="dim">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
