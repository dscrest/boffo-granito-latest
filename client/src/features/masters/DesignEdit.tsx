/* ============================================================
   Item (Design) form page (CR-220) — the ONE Item form, a full page:
     /design/new            create
     /design/:id/edit       edit
     /design/:id/clone      clone into a new item
   Reuses the shared <DesignFields> core. Save → createDesign (new /
   clone) or updateDesign (edit), then lands on the saved item.
   Images are picked here (Design Data, CR-396); Delete lives on the item detail.
   ============================================================ */
import { useEffect, useState } from "react";
import { titleCase } from "@/lib/format";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { FormPage, useFormSave } from "@/ui/FormPage";
import {
  DesignFields,
  blankDesign,
  missingRequired,
  rowToValues,
  toDesignInput,
  type DesignValues,
} from "./DesignForm";
import {
  EMPTY_LOOKUPS,
  cachedDesigns,
  createDesign,
  listDesigns,
  updateDesign,
  type DesignImage,
  type DesignLookups,
  type DesignRow,
} from "./designsApi";
import { loadDefaultDesignOwner } from "@/features/settings/settingsApi";

export function DesignEdit({ clone }: { clone?: boolean } = {}) {
  const { id = "" } = useParams();
  const creating = !id || !!clone; // new or clone → createDesign
  const navigate = useNavigate();
  const [v, setV] = useState<DesignValues>(blankDesign());
  const [images, setImages] = useState<DesignImage[]>([]);
  const [lookups, setLookups] = useState<DesignLookups>(EMPTY_LOOKUPS);
  const [row, setRow] = useState<DesignRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      setLoading(true);
      const res = await listDesigns();
      if (!live) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.error || "Failed to load item");
        return;
      }
      setLookups(res.lookups);
      if (!id) {
        // CR-392: a new item starts on the organisation's default design owner (Settings ▸ Preferences).
        const owner = await loadDefaultDesignOwner();
        if (live && owner) setV((p) => (p.design_owner ? p : { ...p, design_owner: owner }));
        return; // new item: blank form, lookups only
      }
      const found = res.designs.find((d) => d.id === id) ?? null;
      setRow(found);
      if (found) {
        const seed = rowToValues(found);
        if (clone) {
          // Fresh short code (assigned on create) + a distinct name so the
          // computed unique_name doesn't collide with the source. No images.
          // Opening stock is per-item and must NOT carry over (the field is
          // hidden on create, but its seeded value would still be submitted).
          seed.seq_code = "";
          seed.accounting_stock = "";
          seed.design_name = `Copy of ${seed.design_name}`.trim();
        }
        setV(seed);
        setImages(clone ? [] : found.images);
      }
    })();
    return () => {
      live = false;
    };
  }, [id]);

  const close = () => navigate(id ? `/design/${id}` : "/design");
  const form = useFormSave(close);
  const set = (k: keyof DesignValues, val: string) => {
    form.touch();
    setV((p) => ({ ...p, [k]: val }));
  };
  const missing = missingRequired(v);

  // Errors stay hidden until the first submit attempt, then update live.
  const [showErrors, setShowErrors] = useState(false);

  const save = async () => {
    // CR-396: images are picked on the form (Design Data) and saved with the item.
    // CR-429: the server stores these Title Case — compute unique_name / the party-brand SKU segment from the same text.
    const input = toDesignInput(
      {
        ...v,
        design_name: titleCase(v.design_name),
        // CR-437: blank Base Design Name = the Design Name (decided at save, so the field stays clearable while editing).
        base_design_name: titleCase(v.base_design_name.trim() || v.design_name),
        party_brand_name: titleCase(v.party_brand_name),
      },
      lookups,
      images,
    );
    // Friendly duplicate pre-check; the server's 409 on unique_name is the backstop.
    // A new/cloned item must not match ANY existing item (no self-exclude).
    const dup = (cachedDesigns() || []).find(
      (d) => (creating || d.id !== id) && d.uniqueName.trim().toLowerCase() === input.unique_name.trim().toLowerCase(),
    );
    if (dup) {
      toast.error(`An item named "${input.unique_name}" already exists`);
      return;
    }
    setError(null);
    const res = creating ? await createDesign(input) : await updateDesign(id, input);
    if (!res.ok) {
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success(creating ? "Item created" : "Item updated");
    // Land on the saved record; replace so Back never returns to a spent form.
    navigate(`/design/${(creating ? res.rowid : id) ?? id}`, { replace: true });
  };
  const submit = () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    void form.run(save);
  };

  if (!can("items", creating ? "create" : "edit")) {
    return <EmptyState title="No access" hint="You don't have permission for this" />;
  }
  if (loading) return <div className="dim">Loading…</div>;
  if (id && !row) return <EmptyState title="Item not found" hint={error || undefined} />;

  return (
    <FormPage
      title={!id ? "New Item" : clone ? "Clone Item" : "Edit Item"}
      sub={row ? (clone ? `Copy of ${row.designName}` : row.designName) : ""}
      busy={form.busy}
      onCancel={() => void form.cancel()}
      onSave={submit}
      note={
        <>
          {showErrors && missing ? <span className="field-err">Fill the required fields above</span> : "* Indicates a mandatory field"}
          <span className="df-fx-note">ƒx Indicates a formula field (auto-calculated)</span>
        </>
      }
    >
      {error && <div className="field-err" style={{ marginBottom: 10 }}>{error}</div>}
      <DesignFields
        value={v}
        onChange={set}
        lookups={lookups}
        showErrors={showErrors}
        mode={creating ? "create" : "edit"}
        images={images}
        onImages={(next) => {
          form.touch();
          setImages(next);
        }}
        selfId={clone ? undefined : id || undefined}
      />
    </FormPage>
  );
}
