/* ============================================================
   Design (Item) form — captures the full Catalyst `Design` schema:
   6 FK lookups (Size, Finish, Category, Glaze, Brand, Grade) + spec /
   rate fields. The reusable <DesignFields> core (sections grid +
   computed unique_name/sku banner + image upload) is shared by the
   modal `DesignForm` (new) and the full-page DesignEdit (edit).

   Lookup selects store the parent ROWID (FK value); options come live
   from designsApi (no static lists). Field keys match Data Store
   column names for 1:1 API wiring.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { ImageUploader } from "@/ui/ImageUploader";
import { useModalA11y } from "@/ui/useModalA11y";
import { type DesignInput, type DesignLookups, type DesignRow, type LookupOption } from "./designsApi";

/* Flat, all-string form state. Lookup fields hold a parent ROWID. */
export interface DesignValues {
  design_name: string;
  base_design_name: string;
  party_brand_name: string;
  collection_name: string;
  status: string;
  size: string;
  finish: string;
  category: string;
  glaze: string;
  brand: string;
  grade: string;
  pcs_per_box: string;
  box_weight_kg: string;
  coverage_sqm: string;
  coverage_sqft: string;
  random_faces: string;
  rate_per_sqft: string;
  rate_per_sqmt: string;
  accounting_stock: string;
  image_url: string;
}

const STATUSES = ["Continue", "Discontinued"];

type FieldKind = "text" | "number" | "select";
interface FieldSpec {
  key: keyof DesignValues;
  label: string;
  kind?: FieldKind;
  lookup?: keyof DesignLookups; // dynamic FK options
  options?: string[]; // static select options (e.g. status)
  required?: boolean;
  suffix?: string;
}

const SECTIONS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: "Identity",
    fields: [
      { key: "design_name", label: "Design Name", required: true },
      { key: "base_design_name", label: "Base Design Name" },
      { key: "party_brand_name", label: "Party Brand Name" },
      { key: "collection_name", label: "Collection" },
    ],
  },
  {
    title: "Classification",
    fields: [
      { key: "size", label: "Size", kind: "select", lookup: "sizes", required: true },
      { key: "finish", label: "Finish", kind: "select", lookup: "finishes", required: true },
      { key: "category", label: "Category", kind: "select", lookup: "categories" },
      { key: "glaze", label: "Glaze", kind: "select", lookup: "glazes" },
      { key: "brand", label: "Brand", kind: "select", lookup: "brands", required: true },
      { key: "grade", label: "Grade", kind: "select", lookup: "grades" },
      { key: "status", label: "Status", kind: "select", options: STATUSES },
    ],
  },
  {
    title: "Specs",
    fields: [
      { key: "pcs_per_box", label: "Pcs / Box", kind: "number" },
      { key: "box_weight_kg", label: "Box Weight", kind: "number", suffix: "kg" },
      { key: "coverage_sqm", label: "Coverage", kind: "number", suffix: "m²" },
      { key: "coverage_sqft", label: "Coverage", kind: "number", suffix: "ft²" },
      { key: "random_faces", label: "Random Faces", kind: "number" },
    ],
  },
  {
    title: "Rates & Stock",
    fields: [
      { key: "rate_per_sqft", label: "Rate / ft²", kind: "number" },
      { key: "rate_per_sqmt", label: "Rate / m²", kind: "number" },
      { key: "accounting_stock", label: "Accounting Stock", kind: "number" },
    ],
  },
];

const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);
const REQUIRED = ALL_FIELDS.filter((f) => f.required).map((f) => f.key);

export function blankDesign(): DesignValues {
  const v = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, ""])) as unknown as DesignValues;
  v.status = "Continue"; // #10: new designs default to Continue
  return v;
}

/** True when any required field is still empty. */
export function missingRequired(v: DesignValues): boolean {
  return REQUIRED.some((k) => !v[k].trim());
}

const s = (n: number) => (n ? String(n) : "");

/** Hydrate a fetched DesignRow into editable form state (numbers → strings). */
export function rowToValues(r: DesignRow): DesignValues {
  return {
    design_name: r.designName,
    base_design_name: r.baseDesignName,
    party_brand_name: r.partyBrandName,
    collection_name: r.collectionName,
    status: r.status,
    size: r.sizeId,
    finish: r.finishId,
    category: r.categoryId,
    glaze: r.glazeId,
    brand: r.brandId,
    grade: r.gradeId,
    pcs_per_box: s(r.pcsPerBox),
    box_weight_kg: s(r.boxWeightKg),
    coverage_sqm: s(r.coverageSqm),
    coverage_sqft: s(r.coverageSqft),
    random_faces: s(r.randomFaces),
    rate_per_sqft: s(r.ratePerSqft),
    rate_per_sqmt: s(r.ratePerSqmt),
    accounting_stock: s(r.accountingStock),
    image_url: r.imageUrl,
  };
}

const labelById = (opts: LookupOption[], id: string) => opts.find((o) => o.id === id)?.label ?? "";

/** unique_name = "Design - Size - Finish" (app-enforced unique downstream). */
export function computeUniqueName(v: DesignValues, lk: DesignLookups): string {
  return [v.design_name, labelById(lk.sizes, v.size), labelById(lk.finishes, v.finish)]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" - ");
}

/** SKU = position codes of Size-Category-Finish-Glaze → NN-NN-NN-NN (00 = unset). */
export function computeSku(v: DesignValues, lk: DesignLookups): string {
  const pad = (n: number) => (n <= 0 ? "00" : String(n).padStart(2, "0"));
  const pos = (opts: LookupOption[], id: string) => opts.findIndex((o) => o.id === id) + 1;
  return [pos(lk.sizes, v.size), pos(lk.categories, v.category), pos(lk.finishes, v.finish), pos(lk.glazes, v.glaze)]
    .map(pad)
    .join("-");
}

const numOr0 = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);

/** Convert form state → API DesignInput (numbers parsed, unique_name/sku computed). */
export function toDesignInput(v: DesignValues, lk: DesignLookups, images: string[] = []): DesignInput {
  return {
    design_name: v.design_name,
    base_design_name: v.base_design_name,
    party_brand_name: v.party_brand_name,
    collection_name: v.collection_name,
    status: v.status,
    unique_name: computeUniqueName(v, lk),
    sku: computeSku(v, lk),
    size: v.size,
    finish: v.finish,
    category: v.category,
    glaze: v.glaze,
    brand: v.brand,
    grade: v.grade,
    pcs_per_box: numOr0(v.pcs_per_box),
    box_weight_kg: numOr0(v.box_weight_kg),
    coverage_sqm: numOr0(v.coverage_sqm),
    coverage_sqft: numOr0(v.coverage_sqft),
    random_faces: numOr0(v.random_faces),
    rate_per_sqft: numOr0(v.rate_per_sqft),
    rate_per_sqmt: numOr0(v.rate_per_sqmt),
    accounting_stock: numOr0(v.accounting_stock),
    image_url: images[0] || v.image_url || "", // legacy single-image field = first image
    image_urls: JSON.stringify(images),
  };
}

/* Reusable sections grid + computed-key banner + image upload.
   Presentational: owns no save logic, just renders fields and reports edits. */
export function DesignFields({
  value,
  onChange,
  lookups,
  showErrors,
  images,
  onImages,
}: {
  value: DesignValues;
  onChange: (k: keyof DesignValues, v: string) => void;
  lookups: DesignLookups;
  showErrors?: boolean;
  images: string[];
  onImages: (next: string[]) => void;
}) {
  const uniqueName = useMemo(() => computeUniqueName(value, lookups), [value, lookups]);
  const sku = useMemo(() => computeSku(value, lookups), [value, lookups]);

  return (
    <>
      <div className="df-banner">
        <span className="k">unique_name</span>
        <span className="chip">{uniqueName || "—"}</span>
        <div style={{ flex: 1 }} />
        <span className="k">sku</span>
        <span className="chip">{sku}</span>
      </div>

      {SECTIONS.map((sec) => (
        <div key={sec.title} className="form-section">
          <div className="form-section-title">{sec.title}</div>
          <div className="form-grid">
            {sec.fields.map((f) => {
              const opts = f.lookup ? lookups[f.lookup] : null;
              const err = showErrors && f.required && !value[f.key].trim() ? `${f.label} is required` : null;
              return (
                <label key={f.key} className="form-field">
                  <span className="lbl">
                    {f.label}
                    {f.suffix && <span className="hint"> ({f.suffix})</span>}
                    {f.required && <span className="req"> *</span>}
                  </span>
                  {f.kind === "select" ? (
                    <select className={err ? "error" : ""} value={value[f.key]} onChange={(e) => onChange(f.key, e.target.value)}>
                      <option value="">—</option>
                      {opts
                        ? opts.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))
                        : f.options!.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                    </select>
                  ) : (
                    <input
                      className={err ? "error" : ""}
                      type={f.kind === "number" ? "number" : "text"}
                      value={value[f.key]}
                      onChange={(e) => onChange(f.key, e.target.value)}
                      placeholder={f.label}
                    />
                  )}
                  {err && <span className="field-err">{err}</span>}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {/* #12: up to 5 images uploaded to Catalyst File Store. */}
      <div className="form-section">
        <div className="form-section-title">Images (max 5)</div>
        <ImageUploader value={images} onChange={onImages} max={5} />
      </div>
    </>
  );
}

/* New-design modal. Emits a DesignInput on save (parent persists). */
export function DesignForm({
  lookups,
  onSave,
  onClose,
}: {
  lookups: DesignLookups;
  onSave: (input: DesignInput) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState<DesignValues>(blankDesign());
  const [images, setImages] = useState<string[]>([]);
  const set = (k: keyof DesignValues, val: string) => setV((p) => ({ ...p, [k]: val }));
  const missing = missingRequired(v);

  // Errors stay hidden until the first submit attempt, then update live.
  const [showErrors, setShowErrors] = useState(false);
  const submit = () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    onSave(toDesignInput(v, lookups, images));
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="tile" size={18} />
          </div>
          <div>
            <div className="ttl">New Design</div>
            <div className="sub2">Item master · saved to Catalyst Data Store</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          <DesignFields value={v} onChange={set} lookups={lookups} showErrors={showErrors} images={images} onImages={setImages} />
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && missing ? <span className="field-err">Fill the required fields above</span> : "* required"}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" onClick={submit}>
            <Icon name="check" size={13} />
            Save design
          </button>
        </div>
      </div>
    </div>
  );
}
