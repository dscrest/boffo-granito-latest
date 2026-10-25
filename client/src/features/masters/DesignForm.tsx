/* ============================================================
   Design (Item) form — captures the full Catalyst `Design` schema:
   6 FK lookups (Size, Finish, Category, Glaze, Brand, Grade) + spec /
   rate fields. The reusable <DesignFields> core (sections grid +
   computed unique_name/sku banner + image upload) is rendered by the
   Item form page, DesignEdit (new / edit / clone — CR-220).

   Lookup selects store the parent ROWID (FK value); options come live
   from designsApi (no static lists). Field keys match Data Store
   column names for 1:1 API wiring.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { Combobox, type ComboOption } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { insert } from "@/lib/dataOps";
import { isAdmin } from "@/lib/auth";
import { titleCase } from "@/lib/format";
import { nextSeqCode } from "@/lib/seq";
import { ImageManager } from "@/features/common/ImageManager";
import { CustomerSearchModal } from "./CustomerSearchModal";
import { ItemSearchModal } from "./ItemSearchModal";
import { useMasters } from "./useMasters";
import { cachedDesigns, invalidateDesigns, type DesignImage, type DesignInput, type DesignLookups, type DesignRow, type LookupOption } from "./designsApi";

/* Flat, all-string form state. Lookup fields hold a parent ROWID.
   Coverage is NOT held here — it's derived from width/length/pcs. */
export interface DesignValues {
  design_name: string;
  seq_code: string; // design short code — first SKU segment
  base_design_name: string;
  design_owner: string; // CR-392: Customer ROWID
  design_buyer: string; // CR-392: Customer ROWID
  party_brand_name: string;
  collection_name: string;
  status: string;
  size: string;
  finish: string;
  category: string;
  glaze: string;
  brand: string;
  grade: string;
  surface_application: string; // CR-394 lookups
  punch: string;
  series: string;
  catalogue: string;
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

/* "datalist" = free-text value with a Combobox over suggestions (party brand:
   creatable, the PartyBrand master ∪ legacy values; base design: existing item
   names + the CR-434 item search modal). "customer" = a Customer ROWID picked via Combobox + search modal. */
type FieldKind = "text" | "number" | "select" | "datalist" | "customer";
/* Display-only formula fields (not in DesignValues, never in the payload). */
type CalcKey = "weight_per_pc" | "weight_per_sqm" | "coverage_sqft" | "coverage_sqm";
interface FieldSpec {
  key: keyof DesignValues | CalcKey;
  label: string;
  kind?: FieldKind;
  lookup?: "sizes" | "finishes" | "categories" | "glazes" | "brands" | "grades" | "surfaceApplications" | "punches" | "series" | "catalogues"; // dynamic FK options
  options?: string[]; // static select options (e.g. status)
  suggest?: "partyBrands" | "designNames"; // datalist suggestions
  required?: boolean;
  suffix?: string;
  /** Owned by the Size master — auto-filled from the picked Size, never typed. */
  fromSize?: boolean;
  /** Size value is only the DEFAULT — typable override per item (CR-190 weight, CR-391 pcs). */
  sizeDefault?: boolean;
  /** ƒx formula field — read-only, computed from the current values. */
  calc?: (v: DesignValues) => string;
}

/* Section order and names follow the Design Master spec (2026-10-23, CR-396):
   Main Information · Calculations · Design Data · Working Data · Marketing Data. */
const SECTIONS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: "Main Information",
    fields: [
      // Design Code (seq_code) is auto-generated — designsApi.createDesign assigns
      // the next sequence on save; edits keep the stored one. Shown in the SKU banner.
      { key: "design_name", label: "Design Name", required: true },
      { key: "base_design_name", label: "Base Design Name", kind: "datalist", suggest: "designNames" }, // CR-395: picked from items
      { key: "design_owner", label: "Design Owner", kind: "customer" }, // CR-392
      { key: "design_buyer", label: "Custom Design Buyer", kind: "customer" },
      { key: "party_brand_name", label: "Custom Design Buyer Brand", kind: "datalist", suggest: "partyBrands" }, // CR-393: buyer's brands
    ],
  },
  {
    title: "Calculations",
    fields: [
      { key: "size", label: "Size", kind: "select", lookup: "sizes", required: true },
      { key: "width_mm", label: "Width", kind: "number", suffix: "mm", fromSize: true },
      { key: "length_mm", label: "Length", kind: "number", suffix: "mm", fromSize: true },
      // CR-391: typed per item — the Size value is only the starting default.
      { key: "pcs_per_box", label: "Pcs Per Packing", kind: "number", sizeDefault: true },
      { key: "coverage_sqft", label: "Coverage Area", suffix: "ft²", calc: (v) => s(computeCoverage(v).sqft) },
      { key: "coverage_sqm", label: "Coverage Area", suffix: "m²", calc: (v) => s(computeCoverage(v).sqm) },
      { key: "box_weight_kg", label: "Box Weight", kind: "number", suffix: "kg", sizeDefault: true },
      { key: "weight_per_pc", label: "Weight / piece", suffix: "kg", calc: (v) => computeWeights(v).perPc },
      { key: "weight_per_sqm", label: "Weight / m²", suffix: "kg", calc: (v) => computeWeights(v).perSqm },
      { key: "rate_per_sqft", label: "Rate / ft²", kind: "number" },
      { key: "rate_per_sqmt", label: "Rate / m²", kind: "number" },
    ],
  },
  {
    title: "Design Data",
    fields: [
      // Design Image renders at the top of this section (ImageManager) — see DesignFields.
      { key: "random_faces", label: "No. of Random Faces", kind: "number" },
      { key: "finish", label: "Finish", kind: "select", lookup: "finishes", required: true },
      { key: "category", label: "Category", kind: "select", lookup: "categories" },
      { key: "surface_application", label: "Surface Application", kind: "select", lookup: "surfaceApplications" }, // CR-394
      { key: "punch", label: "Punch Type", kind: "select", lookup: "punches" },
      { key: "glaze", label: "Glaze", kind: "select", lookup: "glazes" },
      // CR-430: Brand is no longer on the form (kept in the grid / filter / bulk edit / detail; SKU slot = "00").
      { key: "grade", label: "Grade", kind: "select", lookup: "grades" },
    ],
  },
  {
    title: "Working Data",
    fields: [
      { key: "status", label: "Status", kind: "select", options: STATUSES },
      { key: "is_batched", label: "Batch-tracked item", kind: "select", options: ["No", "Yes"] },
      { key: "accounting_stock", label: "Opening Stock", kind: "number" },
    ],
  },
  {
    title: "Marketing Data",
    fields: [
      { key: "collection_name", label: "Collection Name" },
      { key: "series", label: "Series Name", kind: "select", lookup: "series" }, // CR-394
      { key: "catalogue", label: "Catalogue Name", kind: "select", lookup: "catalogues" },
    ],
  },
];

const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);
/** Real DesignValues keys only — formula fields are display-only. */
const VALUE_FIELDS = ALL_FIELDS.filter((f): f is FieldSpec & { key: keyof DesignValues } => !f.calc);
const REQUIRED = VALUE_FIELDS.filter((f) => f.required).map((f) => f.key);

export function blankDesign(): DesignValues {
  const v = Object.fromEntries(VALUE_FIELDS.map((f) => [f.key, ""])) as unknown as DesignValues;
  v.seq_code = ""; // no longer a rendered field — assigned on create by designsApi
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
    design_owner: r.designOwnerId,
    design_buyer: r.designBuyerId,
    party_brand_name: r.partyBrandName,
    collection_name: r.collectionName,
    status: r.status,
    size: r.sizeId,
    finish: r.finishId,
    category: r.categoryId,
    glaze: r.glazeId,
    brand: r.brandId,
    grade: r.gradeId,
    surface_application: r.surfaceApplicationId,
    punch: r.punchId,
    series: r.seriesId,
    catalogue: r.catalogueId,
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

/** Derived weights (CR-190): per piece = box ÷ pcs/box; per m² = box ÷ coverage m².
    Blank ("") when any input is 0 — never a division by zero. */
export function computeWeights(v: DesignValues): { perPc: string; perSqm: string } {
  const bw = numOr0(v.box_weight_kg);
  const pcs = numOr0(v.pcs_per_box);
  const sqm = computeCoverage(v).sqm;
  return {
    perPc: bw && pcs ? String(Math.round((bw / pcs) * 1000) / 1000) : "",
    perSqm: bw && sqm ? String(Math.round((bw / sqm) * 100) / 100) : "",
  };
}

// ponytail: one runnable check on the weight formulas, dev-only so it never ships.
if (import.meta.env?.DEV) {
  const base = { ...blankDesign(), width_mm: "600", length_mm: "1200", pcs_per_box: "2", box_weight_kg: "28.8" };
  const w = computeWeights(base); // sqm/box = 0.6·1.2·2 = 1.44
  if (w.perPc !== "14.4" || w.perSqm !== "20") throw new Error(`computeWeights broke: ${JSON.stringify(w)}`);
  const none = computeWeights({ ...base, box_weight_kg: "" });
  if (none.perPc !== "" || none.perSqm !== "") throw new Error("computeWeights must blank when weight is 0");
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
    design_owner: v.design_owner,
    design_buyer: v.design_buyer,
    surface_application: v.surface_application,
    punch: v.punch,
    series: v.series,
    catalogue: v.catalogue,
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
   `mode` drives the creation rules: status locked to Active on create, no
   accounting stock at create. Images (CR-396) render inside Design Data when
   the page passes `images` + `onImages` (uploads go to the File Store at once,
   the id list is saved with the item).
   Pallet association was removed from this form per the 2026-07-04 spec —
   the DesignPallet capability (designsApi.setDesignPallets) is kept for when
   it is reintroduced elsewhere. */
export function DesignFields({
  value,
  onChange,
  lookups,
  showErrors,
  mode,
  images,
  onImages,
  selfId,
}: {
  value: DesignValues;
  onChange: (k: keyof DesignValues, v: string) => void;
  lookups: DesignLookups;
  showErrors?: boolean;
  mode: "create" | "edit";
  images?: DesignImage[];
  onImages?: (next: DesignImage[]) => void;
  /** The item being edited — excluded from the Base Design Name suggestions. */
  selfId?: string;
}) {
  // CR-392: owner / buyer pickers read the customer master (cache-first).
  const { customers } = useMasters();
  const customerOptions = useMemo<ComboOption[]>(
    () => customers.filter((c) => c.active || c.id === value.design_owner || c.id === value.design_buyer).map((c) => ({ value: c.id, label: c.name, hint: c.code || undefined })),
    [customers, value.design_owner, value.design_buyer],
  );
  const [custSearch, setCustSearch] = useState<"design_owner" | "design_buyer" | null>(null);
  const [itemSearch, setItemSearch] = useState(false); // CR-434: 🔍 beside Base Design Name
  // CR-395: Base Design Name is picked from existing item names (distinct, never itself).
  const designNames = useMemo(
    () => [...new Set((cachedDesigns() || []).filter((d) => d.id !== selfId).map((d) => d.designName.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selfId, lookups],
  );
  // CR-393: the buyer's brands (plus unassigned / legacy names); every brand when no buyer is set.
  const brandNames = useMemo(
    () => lookups.partyBrands.filter((b) => !value.design_buyer || !b.customerId || b.customerId === value.design_buyer).map((b) => b.name),
    [lookups.partyBrands, value.design_buyer],
  );
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
  const sizeOpt = lookups.sizes.find((o) => o.id === value.size);

  // Width / length are the Size's (read-only here). Pcs/box and box weight take
  // the Size value only as a DEFAULT (CR-391 / CR-190): fill them when blank so a
  // fresh pick or a legacy row starts with the Size's number, never overwrite a
  // typed value, and the server no longer fans Size edits onto them.
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

  // On an explicit Size change the dimensions follow the new Size; pcs and weight
  // restart from the new Size's defaults (still typable afterwards).
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
  // PartyBrand master (under the chosen buyer, CR-393) so it appears in every
  // future pick list — and under that customer's Brands on their detail page.
  const createPartyBrand = async (raw: string) => {
    const name = titleCase(raw); // CR-429: the master stores Title Case; the SKU segment keys on the exact name
    onChange("party_brand_name", name);
    const res = await insert("PartyBrand", { name, ...(value.design_buyer ? { customer: value.design_buyer } : {}) });
    if (!res.ok) toast.error(res.error || "Could not add the customer brand to the master");
    else invalidateDesigns(); // next lookup fetch includes the new brand
  };

  return (
    <>
      <div className="df-banner">
        <span className="k">unique_name</span>
        <span className="chip">{uniqueName || "—"}</span>
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
          {/* CR-396: Design Image lives in Design Data (spec), uploads land in the File Store at once. */}
          {sec.title === "Design Data" && images && onImages && (
            <div style={{ marginBottom: 12 }}>
              <ImageManager
                images={images}
                canEdit
                onSave={async (next) => {
                  onImages(next);
                  return true;
                }}
              />
            </div>
          )}
          <div className="form-rows">
            {fields.map((f) => {
              const opts = f.lookup ? lookups[f.lookup] : null;
              // Formula fields have no stored value; every other key is a DesignValues key.
              const cur = f.calc ? "" : value[f.key as keyof DesignValues];
              const err = showErrors && f.required && !cur.trim() ? `${f.label} is required` : null;
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
                  {f.calc ? (
                    // ƒx formula field — computed live, never typed (same skin as SizeForm).
                    <input
                      value={f.calc(value) || "—"}
                      readOnly
                      tabIndex={-1}
                      className="calc"
                      title={
                        f.key === "weight_per_pc"
                          ? "Formula field: Box Weight ÷ Pcs Per Packing"
                          : f.key === "weight_per_sqm"
                            ? "Formula field: Box Weight ÷ Coverage m²"
                            : f.key === "coverage_sqm"
                              ? "Formula field: (Width ÷ 1000) × (Length ÷ 1000) × Pcs Per Packing"
                              : "Formula field: Coverage m² × 10.7639"
                      }
                    />
                  ) : f.kind === "customer" ? (
                    // CR-392: Customer picker — Combobox + the house search modal (form-ux rule 12).
                    <div className="ctl-row">
                      <Combobox
                        className="grow"
                        value={cur}
                        options={customerOptions}
                        onChange={(val) => onChange(f.key as keyof DesignValues, val)}
                        placeholder={`Search ${f.label.toLowerCase()}…`}
                        ariaLabel={f.label}
                      />
                      <button type="button" className="btn" aria-label="Search customers" title="Search customers" onClick={() => setCustSearch(f.key as "design_owner" | "design_buyer")}>
                        <Icon name="search" size={13} />
                      </button>
                    </div>
                  ) : f.kind === "select" ? (
                    // Status: a new item is always Active (set from the detail
                    // More menu or here once it exists — CR-396 Working Data).
                    f.key === "status" && mode === "create" ? (
                      <input value={value.status || "Active"} readOnly tabIndex={-1} style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }} title="New items start Active" />
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
                          value={cur}
                          options={comboOpts}
                          onChange={(val) => handleField(f.key as keyof DesignValues, val)}
                          placeholder={`Search ${f.label.toLowerCase()}…`}
                          invalid={!!err}
                        />
                      );
                    })()
                    )
                  ) : f.kind === "datalist" ? (
                    (() => {
                      // Free-text value + pick list: the buyer's brands (creatable → PartyBrand
                      // master) or existing item names (Base Design, never creatable).
                      const vals = f.suggest === "partyBrands" ? brandNames : designNames;
                      const all = cur && !vals.includes(cur) ? [cur, ...vals] : vals;
                      const combo = (
                        <Combobox
                          className={f.suggest === "designNames" ? "grow" : undefined}
                          value={cur}
                          options={all.map((o) => ({ value: o, label: o }))}
                          onChange={(val) => onChange(f.key as keyof DesignValues, val)}
                          onCreate={f.suggest === "partyBrands" ? (name) => void createPartyBrand(name) : undefined}
                          placeholder={f.suggest === "designNames" ? "Same as Design Name" : `Search ${f.label.toLowerCase()}…`} // CR-437
                          invalid={!!err}
                        />
                      );
                      // CR-434: Base Design gets the house 🔍 search modal (same control as the Customer pickers).
                      return f.suggest === "designNames" ? (
                        <div className="ctl-row">
                          {combo}
                          <button type="button" className="btn" aria-label="Search items" title="Search items" onClick={() => setItemSearch(true)}>
                            <Icon name="search" size={13} />
                          </button>
                        </div>
                      ) : combo;
                    })()
                  ) : stockFieldLocked ? (
                    // Opening stock already set — non-admins see it read-only.
                    <input
                      value={cur || "0"}
                      readOnly
                      tabIndex={-1}
                      style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }}
                      title="Locked after first entry — only an admin can change opening stock"
                    />
                  ) : f.fromSize ? (
                    // Size master owns this value; editing it here would let the
                    // item drift from the size it claims to be.
                    <input
                      value={cur || "—"}
                      readOnly
                      tabIndex={-1}
                      style={{ background: "var(--bg-2, transparent)", color: "var(--dim)" }}
                      title="From the selected Size — edit it in Size Master"
                    />
                  ) : f.kind === "number" ? (
                    // House numeric field: digits + one dot, never negative.
                    <NumberInput
                      className={err ? "error" : ""}
                      maxDecimals={f.sizeDefault ? 2 : undefined}
                      value={cur}
                      onChange={(e) => {
                        onChange(f.key as keyof DesignValues, e.target.value);
                        // The two rates are one price in two units — the typed one fills the other.
                        const n = Number(e.target.value);
                        const other = (x: number) => (e.target.value.trim() && n > 0 ? String(Math.round(x * 100) / 100) : "");
                        if (f.key === "rate_per_sqmt") onChange("rate_per_sqft", other(n / SQFT_PER_SQM));
                        if (f.key === "rate_per_sqft") onChange("rate_per_sqmt", other(n * SQFT_PER_SQM));
                      }}
                      placeholder={f.sizeDefault ? String((f.key === "pcs_per_box" ? sizeOpt?.pcsPerPacking : sizeOpt?.boxWeightKg) || "") || f.label : f.label}
                      title={f.sizeDefault ? "Starts from the selected Size — this item's own value, type to change it" : undefined}
                    />
                  ) : (
                    <input
                      className={err ? "error" : ""}
                      value={cur}
                      onChange={(e) => onChange(f.key as keyof DesignValues, e.target.value)}
                      // CR-429: the stored name is Title Case — show it before save so unique_name agrees.
                      onBlur={(e) => f.key === "design_name" && onChange("design_name", titleCase(e.target.value))}
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

      {custSearch && (
        <CustomerSearchModal
          onPick={(c) => onChange(custSearch, c.id)}
          onClose={() => setCustSearch(null)}
        />
      )}
      {itemSearch && (
        <ItemSearchModal
          exclude={selfId}
          onPick={(d) => onChange("base_design_name", d.designName)}
          onClose={() => setItemSearch(false)}
        />
      )}
    </>
  );
}
