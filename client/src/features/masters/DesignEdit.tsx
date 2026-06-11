/* ============================================================
   Design (Item) edit — full-page edit form reached by row-click from
   the Design Master (/design/:id/edit). Reuses the shared <DesignFields>
   core. Save → updateDesign; Delete → deleteDesign; both return to the
   master list. This is the master-page convention's edit surface.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import {
  DesignFields,
  blankDesign,
  missingRequired,
  rowToValues,
  toDesignInput,
  type DesignValues,
} from "./DesignForm";
import {
  deleteDesign,
  listDesigns,
  updateDesign,
  type DesignLookups,
  type DesignRow,
} from "./designsApi";

const EMPTY_LOOKUPS: DesignLookups = {
  sizes: [],
  finishes: [],
  categories: [],
  glazes: [],
  brands: [],
  grades: [],
};

export function DesignEdit() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [v, setV] = useState<DesignValues>(blankDesign());
  const [lookups, setLookups] = useState<DesignLookups>(EMPTY_LOOKUPS);
  const [row, setRow] = useState<DesignRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      setLoading(true);
      const res = await listDesigns();
      if (!live) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.error || "Failed to load design");
        return;
      }
      setLookups(res.lookups);
      const found = res.designs.find((d) => d.id === id) ?? null;
      setRow(found);
      if (found) setV(rowToValues(found));
      else setError("Design not found.");
    })();
    return () => {
      live = false;
    };
  }, [id]);

  const set = (k: keyof DesignValues, val: string) => setV((p) => ({ ...p, [k]: val }));
  const missing = missingRequired(v);

  const onSave = async () => {
    if (missing) return;
    setBusy(true);
    setError(null);
    const res = await updateDesign(id, toDesignInput(v, lookups));
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Save failed");
      return;
    }
    navigate("/design");
  };

  const onDelete = async () => {
    if (!row) return;
    if (!window.confirm(`Delete design "${row.designName}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    const res = await deleteDesign(id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Delete failed");
      return;
    }
    navigate("/design");
  };

  const subtitle = useMemo(
    () => [row?.sizeLabel, row?.finishLabel, row?.brandLabel].filter(Boolean).join(" · "),
    [row],
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">{loading ? "Loading…" : row ? `Edit ${row.designName}` : "Design not found"}</div>
          <div className="sub">{subtitle || "Item master · Catalyst Data Store"}</div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => navigate("/design")}>
            <Icon name="chev-l" size={13} />
            Back
          </button>
        </div>
      </div>

      {error && (
        <div
          className="card"
          style={{ marginBottom: 12, borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "10px 14px" }}
        >
          {error}
        </div>
      )}

      {row && (
        <div className="card df-modal" style={{ padding: 16 }}>
          <div className="df-body" style={{ padding: 0 }}>
            <DesignFields value={v} onChange={set} lookups={lookups} />
          </div>
          <div className="df-foot" style={{ marginTop: 14 }}>
            <button className="btn" disabled={busy} onClick={() => void onDelete()} title="Delete design">
              Delete
            </button>
            <div style={{ flex: 1 }} />
            <span className="df-req-note">* required</span>
            <button className="btn" disabled={busy} onClick={() => navigate("/design")}>
              Cancel
            </button>
            <button className="hbtn primary" disabled={missing || busy} onClick={() => void onSave()}>
              <Icon name="check" size={13} />
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
