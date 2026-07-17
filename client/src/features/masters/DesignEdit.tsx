/* ============================================================
   Design (Item) edit / clone — modal form, consistent with every other
   master (Size/Pallet/Customer edit in a modal, not a page). Reuses the
   shared <DesignFields> core. Save → updateDesign (edit) / createDesign
   (clone). Hosted inline over the item detail via idProp/onClose/onSaved;
   also still mounts standalone on the /design/:id/edit|clone routes.
   Delete lives on the item detail's More menu, not here.
   ============================================================ */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
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

export function DesignEdit({
  clone,
  idProp,
  onClose,
  onSaved,
}: {
  clone?: boolean;
  idProp?: string;
  onClose?: () => void;
  onSaved?: (id: string) => void;
} = {}) {
  const { id: idParam = "" } = useParams();
  const id = idProp ?? idParam;
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
    const savedId = (clone ? res.rowid : id) ?? id;
    if (onSaved) onSaved(savedId);
    else navigate(`/design/${savedId}`);
  };

  // Close returns to the host (inline) or the detail/list (standalone route).
  const close = () => (onClose ? onClose() : navigate(clone ? "/design" : `/design/${id}`));
  const panelRef = useModalA11y(close);

  // Edit and clone share one modal presentation — uniform with the other
  // masters. They differ only in title, field mode, and save target.
  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="tile" size={18} />
          </div>
          <div>
            <div className="ttl">
              {loading ? "Loading…" : row ? `${clone ? "Clone" : "Edit"} ${row.designName}` : "Item not found"}
            </div>
            <div className="sub2">Item master</div>
          </div>
          <button className="btn x" onClick={close} title="Close" tabIndex={-1}>
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
              <DesignFields value={v} onChange={set} lookups={lookups} showErrors={showErrors} mode={clone ? "create" : "edit"} />
            </div>
            <div className="df-foot">
              <span className="df-req-note">
                {showErrors && missing ? <span className="field-err">Fill the required fields above</span> : "* Indicates a mandatory field"}
              </span>
              <button className="btn" disabled={busy} onClick={close}>
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
