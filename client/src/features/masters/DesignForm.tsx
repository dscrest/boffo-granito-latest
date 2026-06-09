/* ============================================================
   New Design (Item) form — captures the full Catalyst `Design`
   schema: 6 lookups (Size, Finish, Category, Glaze, Brand, Grade)
   + spec/rate fields. FRONTEND-ONLY: produces a DesignDraft held
   in Design Master's local state (no DB writes yet). Field keys
   match the Data Store column names for 1:1 API wiring later.
   Lookup options are static here; swap to live Masters data when
   the backend is wired.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { SIZES, FINISHES, CATEGORIES } from "@/data";

export interface DesignDraft {
  _id: string;
  design_name: string;
  base_design_name: string;
  size: string;
  finish: string;
  category: string;
  glaze: string;
  brand: string;
  grade: string;
  party_brand_name: string;
  collection_name: string;
  pcs_per_box: string;
  box_weight_kg: string;
  coverage_sqm: string;
  coverage_sqft: string;
  random_faces: string;
  rate_per_sqft: string;
  rate_per_sqmt: string;
  status: string;
  image_url: string;
  sku: string;
  unique_name: string;
}

/* Static lookup options (frontend-only). Mirror the Masters seeds.
   CATEGORIES is shared from @/data (also drives the quote/order item filters). */
const GLAZES = ["Glossy", "Matt", "Carving"];
const BRANDS = ["Bonza", "BIG"];
const GRADES = ["1st"];
const STATUSES = ["Continue", "Discontinued"];

type FieldKind = "text" | "number" | "select";
interface FieldSpec {
  key: keyof DesignDraft;
  label: string;
  kind?: FieldKind;
  options?: string[];
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
      { key: "size", label: "Size", kind: "select", options: SIZES, required: true },
      { key: "finish", label: "Finish", kind: "select", options: FINISHES, required: true },
      { key: "category", label: "Category", kind: "select", options: CATEGORIES },
      { key: "glaze", label: "Glaze", kind: "select", options: GLAZES },
      { key: "brand", label: "Brand", kind: "select", options: BRANDS, required: true },
      { key: "grade", label: "Grade", kind: "select", options: GRADES },
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
    title: "Rates & Media",
    fields: [
      { key: "rate_per_sqft", label: "Rate / ft²", kind: "number" },
      { key: "rate_per_sqmt", label: "Rate / m²", kind: "number" },
      { key: "image_url", label: "Image URL" },
    ],
  },
];

const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);

function blank(): Omit<DesignDraft, "_id" | "unique_name" | "sku"> {
  return Object.fromEntries(ALL_FIELDS.map((f) => [f.key, ""])) as Omit<DesignDraft, "_id" | "unique_name" | "sku">;
}

let _seq = 0;
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `d${++_seq}`;

export function DesignForm({
  onSave,
  onClose,
}: {
  onSave: (d: DesignDraft) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState(blank());
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  // unique_name auto-derived (Design-Size-Finish), app-enforced unique downstream.
  const uniqueName = useMemo(() => {
    const parts = [v.design_name, v.size, v.finish].map((s) => s.trim()).filter(Boolean);
    return parts.join(" - ");
  }, [v.design_name, v.size, v.finish]);

  // SKU generator: position codes of Size-Category-Finish-Glaze → NN-NN-NN-NN.
  // 00 = lookup not yet selected. Mirrors the NumberMaster NN-NN-NN-NN format.
  const sku = useMemo(() => {
    const pad = (n: number) => (n <= 0 ? "00" : String(n).padStart(2, "0"));
    return [
      SIZES.indexOf(v.size) + 1,
      CATEGORIES.indexOf(v.category) + 1,
      FINISHES.indexOf(v.finish) + 1,
      GLAZES.indexOf(v.glaze) + 1,
    ]
      .map(pad)
      .join("-");
  }, [v.size, v.category, v.finish, v.glaze]);

  const onImage = (file?: File) => {
    if (!file) return;
    // Frontend-only: read as a data URL for inline preview. Swap to a Catalyst
    // Stratus upload (returning a hosted URL) when Design is wired to the DB.
    const reader = new FileReader();
    reader.onload = () => set("image_url", String(reader.result));
    reader.readAsDataURL(file);
  };

  const missing = ALL_FIELDS.some((f) => f.required && !String(v[f.key as keyof typeof v]).trim());

  const submit = () => {
    if (missing) return;
    onSave({ ...v, _id: newId(), unique_name: uniqueName, sku });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="tile" size={18} />
          </div>
          <div>
            <div className="ttl">New Design</div>
            <div className="sub2">Item master · local draft — not yet saved to database</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          {/* computed unique key preview */}
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
                {sec.fields.map((f) => (
                  <label key={f.key} className="form-field">
                    <span className="lbl">
                      {f.label}
                      {f.suffix && <span className="hint"> ({f.suffix})</span>}
                      {f.required && <span className="req"> *</span>}
                    </span>
                    {f.key === "image_url" ? (
                      <>
                        <input type="file" accept="image/*" onChange={(e) => onImage(e.target.files?.[0])} />
                        {v.image_url && (
                          <img
                            src={v.image_url}
                            alt="item preview"
                            style={{ marginTop: 6, maxHeight: 90, borderRadius: 8, border: "1px solid var(--border)", objectFit: "cover" }}
                          />
                        )}
                      </>
                    ) : f.kind === "select" ? (
                      <select value={v[f.key as keyof typeof v]} onChange={(e) => set(f.key, e.target.value)}>
                        <option value="">—</option>
                        {f.options!.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.kind === "number" ? "number" : "text"}
                        value={v[f.key as keyof typeof v]}
                        onChange={(e) => set(f.key, e.target.value)}
                        placeholder={f.label}
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="df-foot">
          <span className="df-req-note">* required</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={missing} onClick={submit}>
            <Icon name="check" size={13} />
            Save design
          </button>
        </div>
      </div>
    </div>
  );
}
