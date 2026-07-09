/* ============================================================
   Design (Item) edit — full-page edit form reached by row-click from
   the Design Master (/design/:id/edit). Reuses the shared <DesignFields>
   core. Save → updateDesign; Delete → deleteDesign; both return to the
   master list. This is the master-page convention's edit surface.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import {
  DesignFields,
  blankDesign,
  missingRequired,
  rowToValues,
  toDesignInput,
  type DesignValues,
} from "./DesignForm";
import {
  cachedDesigns,
  deleteDesign,
  listDesigns,
  updateDesign,
  type DesignImage,
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
  partyBrands: [],
  partyBrandSeq: {},
};

export function DesignEdit() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [v, setV] = useState<DesignValues>(blankDesign());
  const [images, setImages] = useState<DesignImage[]>([]);
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
      if (found) {
        setV(rowToValues(found));
        setImages(found.images);
      } else setError("Design not found.");
    })();
    return () => {
      live = false;
    };
  }, [id]);

  const set = (k: keyof DesignValues, val: string) => setV((p) => ({ ...p, [k]: val }));
  const missing = missingRequired(v);

  // Errors stay hidden until the first submit attempt, then update live.
  const [showErrors, setShowErrors] = useState(false);

  const onSave = async () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    const input = toDesignInput(v, lookups, images);
    // Friendly duplicate pre-check; the server's 409 on unique_name is the backstop.
    const dup = (cachedDesigns() || []).find(
      (d) => d.id !== id && d.uniqueName.trim().toLowerCase() === input.unique_name.trim().toLowerCase(),
    );
    if (dup) {
      toast.error(`An item named "${input.unique_name}" already exists`);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await updateDesign(id, input);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success("Design updated");
    navigate(`/design/${id}`);
  };

  const onDelete = async () => {
    if (!row) return;
    if (!(await confirmDialog({ message: `Are you sure you want to delete design "${row.designName}"? This cannot be undone.`, danger: true }))) return;
    setBusy(true);
    setError(null);
    const res = await deleteDesign(id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Delete failed");
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Design deleted");
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
            <DesignFields value={v} onChange={set} lookups={lookups} showErrors={showErrors} mode="edit" />
          </div>
          <div className="df-foot" style={{ marginTop: 14 }}>
            <button className="btn" disabled={busy} onClick={() => void onDelete()} title="Delete design">
              Delete
            </button>
            <div style={{ flex: 1 }} />
            <span className="df-req-note">
              {showErrors && missing ? <span className="field-err">Fill the required fields above</span> : "* required"}
            </span>
            <button className="btn" disabled={busy} onClick={() => navigate("/design")}>
              Cancel
            </button>
            <button className="hbtn primary" disabled={busy} onClick={() => void onSave()}>
              <Icon name="check" size={13} />
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
