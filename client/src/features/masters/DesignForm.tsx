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
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { Combobox, type ComboOption } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { insert } from "@/lib/dataOps";
import { isAdmin } from "@/lib/auth";
import { nextSeqCode } from "@/lib/seq";
import { cachedDesigns, invalidateDesigns, type DesignImage, type DesignInput, type DesignLookups, type DesignRow, type LookupOption } from "./designsApi";

/* Flat, all-string form state. Lookup fields hold a parent ROWID.
   Coverage is NOT held here — it's derived from width/length/pcs. */
export interface DesignValues {
  design_name: string;
  seq_code: string; // design short code — first SKU segment
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
  width_mm: string;
  length_mm: string;
  pcs_per_box: string;
  box_weight_kg: string;
  random_faces: string;
  rate_per_sqft: string;
  rate_per_sqmt: string;
  accounting_stock: string;
  is_batched: string; // "Yes" | "No" — batch-tracked item
  image_url: string;
}

const STATUSES = ["Active", "Inactive"]; // renamed from Continue/Discontinued (2026-07)

/* "datalist" = free-text value with a creatable Combobox over suggestions
   (party brand: the PartyBrand master ∪ legacy values already on designs). */
type FieldKind = "text" | "number" | "select" | "datalist";
interface FieldSpec {
  key: keyof DesignValues;
  label: string;
  kind?: FieldKind;
  lookup?: "sizes" | "finishes" | "categories" | "glazes" | "brands" | "grades"; // dynamic FK options
  options?: string[]; // static select options (e.g. status)
  suggest?: "partyBrands"; // datalist suggestions (free-text + pick list)
  required?: boolean;
  suffix?: string;
  /** Owned by the Size master — auto-filled from the picked Size, never typed. */
  fromSize?: boolean;
}

const SECTIONS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: "Identity",
    fields: [
      { key: "design_name", label: "Design Name", required: true },
      // Short Code (seq_code) is no longer typed — designsApi.createDesign
      // assigns the next sequence in the background; edits keep the stored one.
      { key: "base_design_name", label: "Base Design Name" },
      { key: "party_brand_name", label: "Customer Brand Name", kind: "datalist", suggest: "partyBrands" },
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
    title: "Dimensions & Coverage",
    fields: [
      { key: "width_mm", label: "Width", kind: "number", suffix: "mm", fromSize: true },
      { key: "length_mm", label: "Length", kind: "number", suffix: "mm", fromSize: true },
      { key: "random_faces", label: "Random Faces", kind: "number" },
    ],
  },
  {
    title: "Rates & Stock",
    fields: [
      { key: "rate_per_sqft", label: "Rate / ft²", kind: "number" },
      { key: "rate_per_sqmt", label: "Rate / m²", kind: "number" },
      { key: "is_batched", label: "Batch-tracked item", kind: "select", options: ["No", "Yes"] },
      { key: "accounting_stock", label: "Opening Stock", kind: "number" },
    ],
  },
];

const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);
const REQUIRED = ALL_FIELDS.filter((f) => f.required).map((f) => f.key);

export function blankDesign(): DesignValues {
  const v = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, ""])) as unknown as DesignValues;
  v.seq_code = ""; // no longer a rendered field — assigned on create by designsApi
  // Packing fields are no longer rendered (owned by the Size master) but still
  // live in state — snapshotted from the chosen Size and read by toDesignInput.
  v.pcs_per_box = "";
  v.box_weight_kg = "";
  v.status = "Active"; // #10: new designs default to Active
  v.is_batched = "Yes"; // default batch-tracked; opt out per item
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
    seq_code: r.seqCode,
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
    width_mm: s(r.widthMm),
    length_mm: s(r.lengthMm),
    pcs_per_box: s(r.pcsPerBox),
    box_weight_kg: s(r.boxWeightKg),
    random_faces: s(r.randomFaces),
    rate_per_sqft: s(r.ratePerSqft),
    rate_per_sqmt: s(r.ratePerSqmt),
    accounting_stock: s(r.accountingStock ?? 0),
    is_batched: r.isBatched ? "Yes" : "No",
    image_url: r.imageUrl,
  };
}

const labelById = (opts: LookupOption[], id: string) => opts.find((o) => o.id === id)?.label ?? "";

/** unique_name = "Design - Size - Finish[ - Party Brand]" (app-enforced unique downstream). */
export function computeUniqueName(v: DesignValues, lk: DesignLookups): string {
  return [v.design_name, labelById(lk.sizes, v.size), labelById(lk.finishes, v.finish), v.party_brand_name]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" - ");
}

/* SKU formula (PO spec 2026-07-04):
   DesignShortCode - Size - Finish - Category - Glaze - Brand - Grade
   [- PartyBrand]  — the party-brand segment is appended only when a party
   brand is set. Every segment is the stored `seq_code` of the chosen master
   value ("00" = unset). */
const SKU_SEGMENTS = [
  { lookup: "sizes", field: "size" },
  { lookup: "finishes", field: "finish" },
  { lookup: "categories", field: "category" },
  { lookup: "glazes", field: "glaze" },
  { lookup: "brands", field: "brand" },
  { lookup: "grades", field: "grade" },
] as const;

export function computeSku(v: DesignValues, lk: DesignLookups): string {
  const code = (s?: string) => (s || "").trim() || "00";
  const parts = [
    code(v.seq_code), // design short code
    ...SKU_SEGMENTS.map(({ lookup, field }) =>
      code(lk[lookup].find((o: LookupOption) => o.id === v[field])?.seqCode),
    ),
  ];
  const pb = v.party_brand_name.trim();
  if (pb) parts.push(code(lk.partyBrandSeq[pb]));
  return parts.join("-");
}

const numOr0 = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const SQFT_PER_SQM = 10.763915;

/** Coverage per box, derived from tile dimensions:
    sqm = (width/1000 · length/1000) · pcs;  sqft = sqm · 10.763915. */
export function computeCoverage(v: DesignValues): { sqm: number; sqft: number } {
  const sqm = (numOr0(v.width_mm) / 1000) * (numOr0(v.length_mm) / 1000) * numOr0(v.pcs_per_box);
  return { sqm: round4(sqm), sqft: round4(sqm * SQFT_PER_SQM) };
}

/** Convert form state → API DesignInput (numbers parsed, unique_name/sku/coverage computed). */
export function toDesignInput(v: DesignValues, lk: DesignLookups, images: DesignImage[] = []): DesignInput {
  const cov = computeCoverage(v);
  return {
    design_name: v.design_name,
    base_design_name: v.base_design_name,
    party_brand_name: v.party_brand_name,
    collection_name: v.collection_name,
    status: v.status,
    unique_name: computeUniqueName(v, lk),
    sku: computeSku(v, lk),
    seq_code: v.seq_code,
    size: v.size,
    finish: v.finish,
    category: v.category,
    glaze: v.glaze,
    brand: v.brand,
    grade: v.grade,
    width_mm: numOr0(v.width_mm),
    length_mm: numOr0(v.length_mm),
    pcs_per_box: numOr0(v.pcs_per_box),
    box_weight_kg: numOr0(v.box_weight_kg),
    coverage_sqm: cov.sqm,
    coverage_sqft: cov.sqft,
    random_faces: numOr0(v.random_faces),
    rate_per_sqft: numOr0(v.rate_per_sqft),
    rate_per_sqmt: numOr0(v.rate_per_sqmt),
    accounting_stock: numOr0(v.accounting_stock),
    is_batched: v.is_batched === "Yes",
    image_url: images[0]?.id || v.image_url || "", // legacy single-image field = first image id
    image_urls: JSON.stringify(images),
  };
}

/* Reusable sections grid + computed-key banner.
   Presentational: owns no save logic, just renders fields and reports edits.
   `mode` drives the creation rules: status locked to Active, no accounting
   stock at create (images live on the item detail screen now).
   Pallet association was removed from this form per the 2026-07-04 spec —
   the DesignPallet capability (designsApi.setDesignPallets) is kept for when
   it is reintroduced elsewhere. */
export function DesignFields({
  value,
  onChange,
  lookups,
  showErrors,
  mode,
}: {
  value: DesignValues;
  onChange: (k: keyof DesignValues, v: string) => void;
  lookups: DesignLookups;
  showErrors?: boolean;
  mode: "create" | "edit";
}) {
  const uniqueName = useMemo(() => computeUniqueName(value, lookups), [value, lookups]);
  // On create/clone the short code is assigned on save; preview the provisional
  // next code so the SKU doesn't read as a duplicate "00-…".
  const sku = useMemo(() => {
    const v =
      mode === "create" && !value.seq_code
        ? { ...value, seq_code: nextSeqCode((cachedDesigns() || []).map((d) => d.seqCode)) }
        : value;
    return computeSku(v, lookups);
  }, [value, lookups, mode]);
  const cov = useMemo(() => computeCoverage(value), [value]);

  // Packing data is owned by the Size master — the item snapshots it. Fill any
  // blank field from the chosen Size (covers edit-load of rows saved before
  // Size carried this data, and fresh size picks).
  useEffect(() => {
    if (!value.size) return;
    const opt = lookups.sizes.find((o) => o.id === value.size);
    if (!opt) return;
    if (!value.width_mm && opt.widthMm) onChange("width_mm", String(opt.widthMm));
    if (!value.length_mm && opt.lengthMm) onChange("length_mm", String(opt.lengthMm));
    if (!value.pcs_per_box && opt.pcsPerPacking) onChange("pcs_per_box", String(opt.pcsPerPacking));
    if (!value.box_weight_kg && opt.boxWeightKg) onChange("box_weight_kg", String(opt.boxWeightKg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.size, lookups.sizes]);

  // On an explicit Size change, overwrite the packing snapshot with that size's.
  const handleField = (key: keyof DesignValues, val: string) => {
    onChange(key, val);
    if (key === "size") {
      const opt = lookups.sizes.find((o) => o.id === val);
      onChange("width_mm", opt?.widthMm ? String(opt.widthMm) : "");
      onChange("length_mm", opt?.lengthMm ? String(opt.lengthMm) : "");
      onChange("pcs_per_box", opt?.pcsPerPacking ? String(opt.pcsPerPacking) : "");
      onChange("box_weight_kg", opt?.boxWeightKg ? String(opt.boxWeightKg) : "");
    }
  };

  // Creatable party brand: set the free-text value, then persist to the
  // PartyBrand master so it appears in every future pick list.
  const createPartyBrand = async (name: string) => {
    onChange("party_brand_name", name);
    const res = await insert("PartyBrand", { name });
    if (!res.ok) toast.error(res.error || "Could not add the customer brand to the master");
    else invalidateDesigns(); // next lookup fetch includes the new brand
  };

  return (
    <>
      <div className="df-banner">
        <span className="k">unique_name</span>
        <span className="chip">{uniqueName || "—"}</span>
        <div style={{ flex: 1 }} />
        <span className="k">coverage</span>
        <span className="chip">{cov.sqft ? `${cov.sqft} ft² · ${cov.sqm} m²` : "—"}</span>
        <div style={{ flex: 1 }} />
        <span className="k">sku</span>
        <span className="chip">{sku}</span>
      </div>

      {SECTIONS.map((sec) => {
        // #7: Accounting Stock is edit-only (removed from the creation flow).
        const fields = sec.fields.filter((f) => !(mode === "create" && f.key === "accounting_stock"));
        return (
        <div key={sec.title} className="form-section">
          <div className="form-section-title">{sec.title}</div>
          <div className="form-grid">
            {fields.map((f) => {
              const opts = f.lookup ? lookups[f.lookup] : null;
              const err = showErrors && f.required && !value[f.key].trim() ? `${f.label} is required` : null;
              // Opening stock locks once set — only an admin may re-edit it
              // (mirrors the item-detail lock; the batch-wise button is gated too).
              const stockFieldLocked = f.key === "accounting_stock" && !isAdmin() && numOr0(value.accounting_stock) > 0;
              return (
                <label key={f.key} className="form-field">
                  <span className="lbl">
                    {f.label}
                    {f.suffix && <span className="hint"> ({f.suffix})</span>}
                    {f.required && <span className="req"> *</span>}
                  </span>
                  {f.kind === "select" ? (
                    // Status is read-only everywhere — Active/Inactive is changed
                    // only via the item's More menu, never typed here.
                    f.key === "status" ? (
                      <input value={value.status || "Active"} readOnly tabIndex={-1} style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }} title="Change status from the item's More menu" />
                    ) : (
                    (() => {
                      // Lookup FK options (id/label) or static string options.
                      // Size picker shows the plain dimension ("300x300") only —
                      // type / thickness / pcs belong to palletization, not the
                      // item — and same-code variants dedupe to one option.
                      const comboOpts: ComboOption[] = opts
                        ? opts.map((o) => ({ value: o.id, label: o.label }))
                        : f.options!.map((o) => ({ value: o, label: o }));
                      // House standard: every pick list is a searchable Combobox.
                      return (
                        <Combobox
                          value={value[f.key]}
                          options={comboOpts}
                          onChange={(val) => handleField(f.key, val)}
                          placeholder={`Search ${f.label.toLowerCase()}…`}
                          invalid={!!err}
                        />
                      );
                    })()
                    )
                  ) : f.kind === "datalist" ? (
                    (() => {
                      // Free-text value + creatable pick list (PartyBrand master).
                      const vals = f.suggest ? lookups[f.suggest] : [];
                      const cur = value[f.key];
                      const all = cur && !vals.includes(cur) ? [cur, ...vals] : vals;
                      return (
                        <Combobox
                          value={cur}
                          options={all.map((o) => ({ value: o, label: o }))}
                          onChange={(val) => onChange(f.key, val)}
                          onCreate={(name) => void createPartyBrand(name)}
                          placeholder={`Search ${f.label.toLowerCase()}…`}
                          invalid={!!err}
                        />
                      );
                    })()
                  ) : stockFieldLocked ? (
                    // Opening stock already set — non-admins see it read-only.
                    <input
                      value={value[f.key] || "0"}
                      readOnly
                      tabIndex={-1}
                      style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }}
                      title="Locked after first entry — only an admin can change opening stock"
                    />
                  ) : f.fromSize ? (
                    // Size master owns this value; editing it here would let the
                    // item drift from the size it claims to be.
                    <input
                      value={value[f.key] || "—"}
                      readOnly
                      tabIndex={-1}
                      style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }}
                      title="From the selected Size — edit it in Size Master"
                    />
                  ) : (
                    <input
                      className={err ? "error" : ""}
                      type={f.kind === "number" ? "number" : "text"}
                      // Rule #5: numeric fields never accept negatives (server rejects too).
                      min={f.kind === "number" ? 0 : undefined}
                      value={value[f.key]}
                      onChange={(e) =>
                        onChange(f.key, f.kind === "number" ? e.target.value.replace(/^-/, "") : e.target.value)
                      }
                      placeholder={f.label}
                    />
                  )}
                  {err && <span className="field-err">{err}</span>}
                </label>
              );
            })}
          </div>
        </div>
        );
      })}

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
  const set = (k: keyof DesignValues, val: string) => setV((p) => ({ ...p, [k]: val }));
  const missing = missingRequired(v);

  // Errors stay hidden until the first submit attempt, then update live.
  const [showErrors, setShowErrors] = useState(false);
  const submit = () => {
    if (missing) {
      setShowErrors(true);
      return;
    }
    // #12: images are managed on the item detail screen, not at creation.
    onSave(toDesignInput(v, lookups, []));
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="tile" size={18} />
          </div>
          <div>
            <div className="ttl">New Item</div>
            <div className="sub2">Item master</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>

        <div className="df-body">
          <DesignFields value={v} onChange={set} lookups={lookups} showErrors={showErrors} mode="create" />
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && missing ? <span className="field-err">Fill the required fields above</span> : "* Indicates a mandatory field"}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" onClick={submit}>
            <Icon name="check" size={13} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
