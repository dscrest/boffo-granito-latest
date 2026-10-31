/* ============================================================
   Masters — CR-436: the ONE Masters page. Three sub-tabs (Export
   Master · Item Master · Panel Master), each a horizontal strip of
   its masters rendered in place: the big pages (Items, Sizes,
   Pallets, Containers, Panel Items, Panels, Warehouses, Currencies)
   plus the generic <MasterTable> lookup editor (Finish, Glaze,
   Vehicle …) backed by mastersApi (each write in OperationLog).
   URL = /masters?g=<group>&m=<master> — the query string IS the
   selection, so refresh, ⌘K and the Settings tiles deep-link.
   ============================================================ */
import { lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDelete } from "@/ui/ConfirmDialog";
import { Combobox } from "@/ui/Combobox";
import { ImageUploader } from "@/ui/ImageUploader";
import { designImageUrl } from "@/lib/api";
import { ErrorCard, SkeletonRows } from "@/ui/States";
import { canDelete, canUpdate, hasFeature, isAdmin } from "@/lib/auth";
import { nextSeqCode } from "@/lib/seq";
import { createMaster, deleteMaster, listMaster, updateMaster, type MasterRow } from "./mastersApi";
import { BulkUpdateModal } from "@/ui/BulkUpdateModal";
import { bulkUpdate } from "@/lib/dataOps";
import { formatVehicleNumber } from "./vehiclesApi";

/** "image" = one File Store file id (design_images folder), uploaded via ImageUploader. */
type FieldType = "text" | "number" | "select" | "image";

interface Field {
  key: string;
  label: string;
  type?: FieldType; // default "text"
  options?: string[]; // for type "select"
  required?: boolean;
  /** Background-assigned (e.g. seq_code): shown in the table, never typed. */
  auto?: boolean;
  /** Optional as-you-type formatter (e.g. vehicle number → GJ-01-NR-4757). */
  format?: (raw: string) => string;
}

export interface MasterDef {
  key: string;
  label: string;
  icon: string;
  /** Catalyst Data Store table name (CRUD target). */
  table: string;
  /** column field that visually leads the row (rendered as a chip) */
  lead: string;
  fields: Field[];
  /** CR-505: number fields offered by Bulk Update on ticked rows (server BULK_FIELDS must list them too). */
  bulk?: string[];
}

type Row = MasterRow;

/* Column/field schema per master. Field keys match the Catalyst Data Store
   column names, so values pass straight through mastersApi to the table. */
/* Size is NOT here: it outgrew the generic lookup editor (formula columns,
   per-box packing data) — Sizes.tsx renders inside the hub's Item Master tab. */
const MASTERS: MasterDef[] = [
  {
    key: "finish",
    label: "Finish",
    icon: "palette",
    table: "Finish",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq", auto: true },
    ],
  },
  {
    key: "category",
    label: "Category",
    icon: "tile",
    table: "Category",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq", auto: true },
    ],
  },
  {
    key: "glaze",
    label: "Glaze",
    icon: "palette",
    table: "Glaze",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq", auto: true },
    ],
  },
  {
    key: "brand",
    label: "Box Brand",
    icon: "flag",
    table: "Brand",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "internal_or_external", label: "Type", type: "select", options: ["Internal", "External"] },
      { key: "logo", label: "Image", type: "image" }, // CR-181: shown on the Quote/SO/Customer Box Brand pickers
      { key: "seq_code", label: "Seq", auto: true },
    ],
  },
  {
    key: "party_brand",
    label: "Customer Brand",
    icon: "flag",
    table: "PartyBrand",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq", auto: true },
    ],
  },
  {
    key: "grade",
    label: "Grade",
    icon: "check",
    table: "Grade",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq", auto: true },
    ],
  },
  // CR-394: Design Master lookups — picked on the Item form (Design Data / Marketing Data).
  {
    key: "surface_application",
    label: "Surface Application",
    icon: "palette",
    table: "SurfaceApplication",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq", auto: true },
    ],
  },
  {
    key: "punch",
    label: "Punch Type",
    icon: "tile",
    table: "Punch",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "image", label: "Image", type: "image" }, // the punch pattern photo
      { key: "seq_code", label: "Seq", auto: true },
    ],
  },
  {
    key: "series",
    label: "Series",
    icon: "docs",
    table: "Series",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq", auto: true },
    ],
  },
  {
    key: "catalogue",
    label: "Catalogue",
    icon: "docs",
    table: "Catalogue",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq", auto: true },
    ],
  },
  // Cut Piece Size sits on the Panel Master tab (CUT_PIECE_SIZE_DEF below), not in this list.
  // CR-309 (CR-344 restored, size-keyed): the board a showcase panel is mounted on — picked per panel-order line; its weight joins the panel weight.
  {
    key: "mdf",
    label: "MDF",
    icon: "tile",
    table: "Mdf",
    lead: "size",
    fields: [
      { key: "size", label: "Size", required: true },
      { key: "thickness", label: "Thickness" },
      { key: "weight_kg", label: "Weight (kg)", type: "number" },
      { key: "rate_per_kg", label: "Rate/kg (₹)", type: "number" }, // CR-504: MDF price = weight × this
      { key: "seq_code", label: "Seq", auto: true },
    ],
    bulk: ["rate_per_kg"], // CR-505
  },
  // CR-308: why stock was adjusted (breakage, theft, count correction…) — both modules' adjustment sheets.
  {
    key: "adjustment_reason",
    label: "Adjustment Reason",
    icon: "check",
    table: "AdjustmentReason",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "seq_code", label: "Seq", auto: true },
    ],
  },
  {
    key: "vehicle",
    label: "Vehicle",
    icon: "truck",
    table: "Vehicle",
    lead: "vehicle_number",
    fields: [
      { key: "vehicle_number", label: "Vehicle Number", required: true, format: formatVehicleNumber },
      { key: "driver_name", label: "Driver Name", required: true },
      { key: "mobile_number", label: "Mobile", required: true },
    ],
  },
  {
    key: "payment_term",
    label: "Payment Term",
    icon: "invoice",
    table: "PaymentTerm",
    lead: "name",
    fields: [
      { key: "name", label: "Name", required: true },
      {
        key: "term_type",
        label: "Type",
        type: "select",
        options: ["Advance", "Credit", "Net 15", "Net 30", "Net 45", "Net 60"],
      },
    ],
  },
];

const emptyForm = (def: MasterDef): Record<string, string> =>
  Object.fromEntries(def.fields.map((f) => [f.key, ""]));

function MasterEditor({
  def,
  initial,
  onSave,
  onCancel,
}: {
  def: MasterDef;
  initial: Record<string, string>;
  onSave: (vals: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const missing = def.fields.some((f) => f.required && !vals[f.key]?.trim());

  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));

  const isEdit = def.fields.every((f) => f.key in initial) && Object.values(initial).some(Boolean);
  return (
    <div className="card form-section" style={{ marginBottom: 12, padding: 16, borderLeft: "3px solid var(--accent)" }}>
      <div className="form-section-title" style={{ marginBottom: 14 }}>
        <Icon name={isEdit ? "settings" : "plus"} size={13} className="ic" />
        {isEdit ? "Edit" : "New"} {def.label}
      </div>
      <div className="form-grid">
        {def.fields.filter((f) => !f.auto).map((f) => (
          <label key={f.key} className="form-field">
            <span className="lbl">
              {f.label}
              {f.required && <span className="req"> *</span>}
            </span>
            {f.type === "select" ? (
              <Combobox
                value={vals[f.key] ?? ""}
                options={[{ value: "", label: "" }, ...f.options!.map((o) => ({ value: o, label: o }))]}
                onChange={(val) => set(f.key, val)}
                placeholder={`Search ${f.label.toLowerCase()}…`}
              />
            ) : f.type === "image" ? (
              <ImageUploader
                value={vals[f.key] ? { id: vals[f.key], name: "" } : null}
                onChange={(next) => set(f.key, next?.id ?? "")}
              />
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                // Rule #5: numeric fields never accept negatives (server rejects too).
                min={f.type === "number" ? 0 : undefined}
                value={vals[f.key] ?? ""}
                onChange={(e) => set(f.key, f.format ? f.format(e.target.value) : f.type === "number" ? e.target.value.replace(/^-/, "") : e.target.value)}
                placeholder={f.label}
              />
            )}
          </label>
        ))}
      </div>
      <div className="right" style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <span className="df-req-note">* Indicates a mandatory field</span>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="hbtn primary" disabled={missing} onClick={() => onSave(vals)}>
          <Icon name="check" size={13} />
          Save
        </button>
      </div>
    </div>
  );
}

/** The Cut Piece Size lookup — rendered on the Panel Master tab (CR-426 → CR-436). */
export const CUT_PIECE_SIZE_DEF: MasterDef = {
  key: "cut_piece_size",
  label: "Cut Piece Size",
  icon: "tile",
  table: "CutPieceSize",
  lead: "name",
  fields: [
    { key: "name", label: "Name", required: true },
    { key: "seq_code", label: "Seq", auto: true },
  ],
};

export function MasterTable({ def }: { def: MasterDef }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string | null } | null>(null); // null = closed, {id:null} = new
  const [bulkOpen, setBulkOpen] = useState(false); // CR-505

  const fieldKeys = useMemo(() => def.fields.map((f) => f.key), [def]);

  const load = async () => {
    setLoading(true);
    const res = await listMaster(def.table, fieldKeys);
    setLoading(false);
    if (!res.ok) {
      setError(res.error || `Failed to load ${def.label}`);
      return;
    }
    setError(null);
    setRows(res.rows);
    setSelected(new Set());
  };

  // Reload whenever the active master changes (keyed remount also resets state).
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.table]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => def.fields.some((f) => (r[f.key] ?? "").toLowerCase().includes(q)));
  }, [rows, query, def]);

  // Seed the editor with ONLY the form's field keys — the row also carries
  // the internal _id (ROWID), which must never reach the PATCH payload
  // (Catalyst rejects unknown columns: "Invalid column name _id").
  const editRow = editing?.id ? rows.find((r) => r._id === editing.id) : undefined;
  const initialForm = editRow
    ? Object.fromEntries(def.fields.map((f) => [f.key, editRow[f.key] ?? ""]))
    : emptyForm(def);

  const save = async (vals: Record<string, string>) => {
    const editId = editing?.id;
    // Auto fields (seq_code) are assigned in the background on create.
    if (!editId && def.fields.some((f) => f.key === "seq_code" && f.auto) && !vals.seq_code?.trim()) {
      vals = { ...vals, seq_code: nextSeqCode(rows.map((r) => r.seq_code)) };
    }
    setBusy(true);
    const res = editId
      ? await updateMaster(def.table, editId, vals)
      : await createMaster(def.table, vals);
    setBusy(false);
    if (!res.ok) {
      // Keep the editor open — closing here would discard everything typed.
      toast.error(res.error || "Save failed");
      setError(res.error || "Save failed");
      return;
    }
    setEditing(null);
    toast.success(editId ? `${def.label} updated` : `${def.label} added`);
    await load();
  };

  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r._id));

  const toggleOne = (id: string) =>
    setSelected((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((p) => {
      const next = new Set(p);
      if (allShownSelected) filtered.forEach((r) => next.delete(r._id));
      else filtered.forEach((r) => next.add(r._id));
      return next;
    });

  const removeSelected = async () => {
    const ids = [...selected];
    const reason = await confirmDelete({ message: `Are you sure you want to delete ${ids.length} selected row${ids.length > 1 ? "s" : ""}? This cannot be undone.` });
    if (reason == null) return;
    setBusy(true);
    const results = await Promise.all(ids.map((id) => deleteMaster(def.table, id, reason)));
    setBusy(false);
    const failed = results.filter((r) => !r.ok).length;
    if (failed) {
      toast.error(`${ids.length - failed} deleted, ${failed} failed`);
      setError(results.find((r) => !r.ok)?.error || "Delete failed");
    } else {
      toast.success(`${ids.length} deleted`);
    }
    await load();
  };

  // CR-505: one value on every ticked row, one server call.
  const bulkFields = def.fields.filter((f) => def.bulk?.includes(f.key)).map((f) => ({ key: f.key, label: f.label, type: "number" as const }));
  const onBulk = async (key: string, value: string | number) => {
    setBusy(true);
    const res = await bulkUpdate(def.table, [...selected], { [key]: value });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Bulk update failed");
      return;
    }
    toast.success(`${selected.size} updated`);
    setBulkOpen(false);
    await load();
  };

  return (
    <div>
      {bulkOpen && <BulkUpdateModal noun="row" count={selected.size} fields={bulkFields} busy={busy} onApply={(k, v) => void onBulk(k, v)} onClose={() => setBulkOpen(false)} />}
      {/* Bulk action bar replaces the filter bar while a selection is active. */}
      {selected.size > 0 ? (
        <div className="fbar" style={{ borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>
            {selected.size} selected
          </span>
          {bulkFields.length > 0 && canUpdate() && (
            <button className="btn" onClick={() => setBulkOpen(true)} disabled={busy}>
              <Icon name="settings" size={12} className="ic" /> Bulk Update
            </button>
          )}
          {canDelete() && (
            <button className="btn" onClick={() => void removeSelected()} disabled={busy}>
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : (
        <div className="fbar">
          <span className="muted mono">{filtered.length} rows</span>
          <div style={{ flex: 1 }} />
          <input type="text" placeholder={`Search ${def.label.toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
          {canUpdate() && (
            <button className="hbtn primary" onClick={() => setEditing({ id: null })}>
              <Icon name="plus" size={13} />
              New {def.label.toLowerCase()}
            </button>
          )}
        </div>
      )}

      {editing && <MasterEditor def={def} initial={initialForm} onSave={save} onCancel={() => setEditing(null)} />}

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="card">
        {loading && rows.length === 0 ? (
          <SkeletonRows rows={6} />
        ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 34, textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={allShownSelected}
                  onChange={toggleAll}
                  title={allShownSelected ? "Deselect all" : "Select all"}
                />
              </th>
              {def.fields.map((f) => (
                <th key={f.key} className={f.type === "number" ? "num" : ""} style={f.type === "number" ? { textAlign: "right" } : undefined}>
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={def.fields.length + 1} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  {rows.length > 0 ? "No matching results." : `No rows yet — click “New ${def.label.toLowerCase()}”.`}
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const sel = selected.has(r._id);
              return (
                <tr
                  key={r._id}
                  tabIndex={0}
                  onClick={() => setEditing({ id: r._id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) setEditing({ id: r._id });
                  }}
                  style={{ cursor: "pointer", background: sel ? "var(--accent-soft)" : undefined }}
                  title={`Edit ${def.label.toLowerCase()}`}
                >
                  {/* checkbox cell stops propagation so toggling never opens the editor */}
                  <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel} onChange={() => toggleOne(r._id)} />
                  </td>
                  {def.fields.map((f) => (
                    <td key={f.key} className={f.type === "number" ? "num" : ""}>
                      {f.key === def.lead && r[f.key] ? (
                        <span className="chip">{r[f.key]}</span>
                      ) : f.type === "image" && r[f.key] ? (
                        <img src={designImageUrl(r[f.key])} alt="" style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", display: "block" }} />
                      ) : r[f.key] ? (
                        r[f.key]
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}

/* ---- CR-436 hub ---------------------------------------------------- */
// Big pages load on demand (same lazy pattern as App.tsx; the App-level Suspense covers them).
const Pallets = lazy(() => import("./Pallets").then((m) => ({ default: m.Pallets })));
const ContainerFormats = lazy(() => import("./ContainerFormats").then((m) => ({ default: m.ContainerFormats })));
const Warehouses = lazy(() => import("./Warehouses").then((m) => ({ default: m.Warehouses })));
const CurrenciesAdmin = lazy(() => import("@/features/admin/Currencies").then((m) => ({ default: m.CurrenciesAdmin })));
const DesignMaster = lazy(() => import("./DesignMaster").then((m) => ({ default: m.DesignMaster })));
const Sizes = lazy(() => import("./Sizes").then((m) => ({ default: m.Sizes })));
const PanelItems = lazy(() => import("@/features/panels/PanelItems").then((m) => ({ default: m.PanelItems })));
const Panels = lazy(() => import("@/features/panels/Panels").then((m) => ({ default: m.Panels })));
const LabelTemplatesMaster = lazy(() => import("@/features/labels/CustomerLabels").then((m) => ({ default: m.LabelTemplatesMaster }))); // CR-502

interface HubMaster {
  key: string;
  label: string;
  icon: string;
  /** Sidebar nav id the role must hold (hasFeature), or "admin" = Admin only. */
  feature: string;
  render: () => ReactNode;
}
export interface HubGroup {
  key: string;
  /** Pane title ("Item Master"); the rail shows it without " Master". */
  label: string;
  icon: string;
  masters: HubMaster[];
}

const lookup = (key: string, feature = "admin"): HubMaster => {
  const def = MASTERS.find((m) => m.key === key)!;
  return { key, label: def.label, icon: def.icon, feature, render: () => <MasterTable def={def} /> };
};

// CR-439: rail order Item · Panel · Export (user's order); the first group is the default landing.
export const HUB_GROUPS: HubGroup[] = [
  {
    key: "item",
    label: "Item Master",
    icon: "tile",
    masters: [
      { key: "items", label: "Items", icon: "tile", feature: "design", render: () => <DesignMaster /> },
      { key: "sizes", label: "Size Master", icon: "tile", feature: "sizes", render: () => <Sizes /> },
      ...["finish", "category", "glaze", "brand", "party_brand", "grade", "surface_application", "punch", "series", "catalogue"].map((k) => lookup(k)),
    ],
  },
  {
    key: "panel",
    label: "Panel Master",
    icon: "tile",
    masters: [
      { key: "panel_items", label: "Panel Items", icon: "tile", feature: "panel-items", render: () => <PanelItems /> },
      { key: "cut_piece_size", label: "Cut Piece Size", icon: "tile", feature: "panel-items", render: () => <MasterTable def={CUT_PIECE_SIZE_DEF} /> },
      lookup("mdf"),
      { key: "panels", label: "Panels", icon: "tile", feature: "panels", render: () => <Panels /> },
    ],
  },
  {
    key: "export",
    label: "Export Master",
    icon: "truck",
    masters: [
      { key: "pallets", label: "Pallet Master", icon: "palette", feature: "pallets", render: () => <Pallets /> },
      { key: "containers", label: "Container Master", icon: "truck", feature: "containers", render: () => <ContainerFormats /> },
      lookup("vehicle"),
      lookup("payment_term"),
      lookup("adjustment_reason"),
      { key: "currencies", label: "Currencies", icon: "chart", feature: "admin", render: () => <CurrenciesAdmin /> },
      { key: "warehouses", label: "Warehouses & Locations", icon: "package", feature: "admin", render: () => <Warehouses /> },
      // CR-502: box-sticker templates — the house ones (all customers) live here; a customer's own sit on its Labels tab.
      { key: "label_templates", label: "Label Templates", icon: "printer", feature: "parties", render: () => <LabelTemplatesMaster /> },
    ],
  },
];

const visible = (m: HubMaster) => isAdmin() || (m.feature !== "admin" && hasFeature(m.feature));

/** The groups + masters the signed-in role may see (empty groups dropped). */
export const visibleHubGroups = (): HubGroup[] =>
  HUB_GROUPS.map((g) => ({ ...g, masters: g.masters.filter(visible) })).filter((g) => g.masters.length);

/** Rail label: the group label without " Master" (Item / Panel / Export). */
export const hubRailLabel = (g: HubGroup) => g.label.replace(/ Master$/, "");

/* CR-439: one group of the Masters menu, rendered INSIDE the Settings workspace pane
   (SettingsHome rail = Masters ▸ Item / Panel / Export): the group title, its masters as
   horizontal tabs (.dtabs), and the picked master in place. `?m=` is the tab. */
export function MastersPane({ group }: { group: HubGroup }) {
  const [params, setParams] = useSearchParams();
  const master = group.masters.find((m) => m.key === params.get("m")) ?? group.masters[0];
  return (
    <>
      <div className="set-pane-head">
        <div>
          <div className="title">{group.label}</div>
        </div>
      </div>

      {/* Tabs = the app's chosen-pill strip (.fbar .btn, same look as every filter bar and the rail's
          active row) — the hairline underline was too faint to tell tabs apart. Wraps: 12 tabs on Item. */}
      <div className="fbar" style={{ flexWrap: "wrap" }} role="tablist" aria-label={group.label}>
        {group.masters.map((m) => (
          <button key={m.key} type="button" role="tab" aria-selected={m.key === master.key} className={`btn ${m.key === master.key ? "active" : ""}`} onClick={() => setParams({ g: group.key, m: m.key }, { replace: true })}>
            {m.label}
          </button>
        ))}
      </div>

      <div className="masters-body" key={`${group.key}/${master.key}`}>{master.render()}</div>
    </>
  );
}
