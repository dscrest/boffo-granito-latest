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
import { useModalA11y } from "@/ui/useModalA11y";
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
  createDesign,
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

export function DesignEdit({ clone }: { clone?: boolean } = {}) {
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
        const seed = rowToValues(found);
        if (clone) {
          // Fresh short code (assigned on create) + a distinct name so the
          // computed unique_name doesn't collide with the source. No images.
          seed.seq_code = "";
          seed.design_name = `Copy of ${seed.design_name}`.trim();
        }
        setV(seed);
        setImages(clone ? [] : found.images);
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
    // A clone is a new row, so it must not match ANY existing item (no self-exclude).
    const dup = (cachedDesigns() || []).find(
      (d) => (clone || d.id !== id) && d.uniqueName.trim().toLowerCase() === input.unique_name.trim().toLowerCase(),
    );
    if (dup) {
      toast.error(`An item named "${input.unique_name}" already exists`);
      return;
    }
    setBusy(true);
    setError(null);
    const res = clone ? await createDesign(input) : await updateDesign(id, input);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success(clone ? "Item created" : "Design updated");
    navigate(`/design/${clone ? res.rowid : id}`);
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

  // Esc / focus-trap only apply to the clone modal; the edit page keeps its
  // full-page chrome and never attaches this ref (so onClose is a no-op there).
  const panelRef = useModalA11y(clone ? () => navigate("/design") : () => {});

  // Clone reuses the create-item modal presentation (centered dialog, note on
  // the left) rather than the full-page edit surface.
  if (clone) {
    return (
      <div className="modal-backdrop">
        <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()}>
          <div className="df-head">
            <div className="ico">
              <Icon name="tile" size={18} />
            </div>
            <div>
              <div className="ttl">{loading ? "Loading…" : row ? `Clone ${row.designName}` : "Item not found"}</div>
              <div className="sub2">Item master · saved to Catalyst Data Store</div>
            </div>
            <button className="btn x" onClick={() => navigate("/design")} title="Close">
              ✕
            </button>
          </div>

          {error && (
            <div className="df-body" style={{ color: "var(--c-red)" }}>
              {error}
            </div>
          )}

          {row && (
            <>
              <div className="df-body">
                <DesignFields value={v} onChange={set} lookups={lookups} showErrors={showErrors} mode="create" />
              </div>
              <div className="df-foot">
                <span className="df-req-note">
                  {showErrors && missing ? <span className="field-err">Fill the required fields above</span> : "* Indicates a mandatory field"}
                </span>
                <button className="btn" disabled={busy} onClick={() => navigate("/design")}>
                  Cancel
                </button>
                <button className="hbtn primary" disabled={busy} onClick={() => void onSave()}>
                  <Icon name="check" size={13} />
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

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
              {showErrors && missing ? <span className="field-err">Fill the required fields above</span> : "* Indicates a mandatory field"}
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
