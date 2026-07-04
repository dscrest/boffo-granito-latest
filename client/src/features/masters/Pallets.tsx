/* ============================================================
   Pallet Master — table of pallet specs backed by the Catalyst
   Data Store via palletsApi. Create / edit / delete write real rows;
   every mutation is recorded in OperationLog (see /ops). Phase 4
   (palletisation + container fit) reads these specs.

   Follows the master-page UI convention (see DesignMaster):
   • NO inline row actions — row-click opens the edit form.
   • Bulk select (checkboxes) → bulk delete on selection.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useHiddenColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { fmt } from "@/lib/format";
import { canDelete, canUpdate } from "@/lib/auth";
import { PalletForm } from "./PalletForm";
import {
  bulkDeletePallets,
  createPallet,
  listPallets,
  updatePallet,
  type PalletInput,
  type PalletRow,
  type SizeOption,
} from "./palletsApi";

// Toggleable columns (Name + checkbox/# always shown).
const PALLET_COLUMNS: ColumnDef[] = [
  { key: "packing", label: "Packing" },
  { key: "size", label: "Size" },
  { key: "type", label: "Type" },
  { key: "coverage", label: "Coverage (m² / ft²)" },
  { key: "boxesPerCont", label: "Boxes / Cont." },
  { key: "palletsPerCont", label: "Pallets / Cont." },
];

export function Pallets() {
  const [rows, setRows] = useState<PalletRow[]>([]);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeF, setTypeF] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { hidden, toggle, show } = useHiddenColumns("palletsTableColumns");
  const [editing, setEditing] = useState<{ row: PalletRow | null } | null>(null); // null=closed, {row:null}=new

  const load = async () => {
    setLoading(true);
    const res = await listPallets();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load pallets");
      return;
    }
    setError(null);
    setRows(res.pallets);
    setSizes(res.sizes);
    setSelected(new Set());
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeF && r.palletType !== typeF) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.sizeLabel.toLowerCase().includes(q) ||
        r.palletType.toLowerCase().includes(q) ||
        r.packingDetails.toLowerCase().includes(q)
      );
    });
  }, [rows, query, typeF]);

  const pager = usePagination(filtered.length, "palletsPageSize", `${query}|${typeF}`);
  const pageRows = pager.slice(filtered);

  const onSave = async (input: PalletInput) => {
    const target = editing?.row;
    setNotice(target ? "Saving changes…" : "Saving pallet…");
    const res = target ? await updatePallet(target.id, input) : await createPallet(input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      setNotice(null);
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    setEditing(null);
    setNotice(`Pallet saved (#${res.rowid}).`);
    toast.success(target ? "Pallet updated" : "Pallet saved");
    await load();
  };

  // ponytail: select-all covers the visible page only; `selected` accumulates across pages.
  const allShownSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  const toggleOne = (id: string) =>
    setSelected((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((p) => {
      const next = new Set(p);
      if (allShownSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });

  const ids = useMemo(() => [...selected], [selected]);

  const onBulkDelete = async () => {
    if (!window.confirm(`Delete ${ids.length} selected pallet${ids.length > 1 ? "s" : ""}? This cannot be undone.`))
      return;
    setBusy(true);
    setNotice(`Deleting ${ids.length} pallet${ids.length > 1 ? "s" : ""}…`);
    const res = await bulkDeletePallets(ids);
    setBusy(false);
    if (!res.ok) {
      setError(`${res.failed} delete(s) failed: ${res.firstError || "unknown error"}`);
      toast.error(`${res.done} deleted, ${res.failed} failed`);
    } else {
      toast.success(`${res.done} pallet${res.done === 1 ? "" : "s"} deleted`);
    }
    setNotice(`Deleted ${res.done} pallet${res.done === 1 ? "" : "s"}.`);
    await load();
  };

  // Distinct types already saved, fed to the form so the picker can create-on-save.
  const palletTypes = useMemo(
    () => [...new Set(rows.map((r) => r.palletType).filter(Boolean))].sort(),
    [rows],
  );

  const initial: Partial<PalletInput> | undefined = editing?.row
    ? {
        name: editing.row.name,
        packing_details: editing.row.packingDetails,
        size: editing.row.sizeId,
        pallet_type: editing.row.palletType,
        // Carries the "WxL" tile label the form parses back into Width/Length.
        pallet_size_label: editing.row.palletSizeLabel || editing.row.sizeLabel,
        coverage_sqm: editing.row.coverageSqm,
        coverage_sqft: editing.row.coverageSqft,
        box_weight_kg: editing.row.boxWeightKg,
        boxes_per_pallet: editing.row.boxesPerPallet,
        pallets_per_container: editing.row.palletsPerContainer,
        empty_pallet_weight_kg: editing.row.emptyWeightKg,
        b_boxes_per_pallet: editing.row.bBoxesPerPallet,
        b_pallets_per_container: editing.row.bPalletsPerContainer,
        b_pallet_weight: editing.row.bPalletWeightKg,
        remarks: editing.row.remarks,
      }
    : undefined;

  return (
    <div>
      {editing && (
        <PalletForm
          palletTypes={palletTypes}
          sizeOptions={sizes}
          initial={initial}
          isEdit={!!editing.row}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="page-head">
        <div>
          <div className="title">Pallet Master</div>
          <div className="sub">{loading ? "Loading…" : <span className="dim">{notice}</span>}</div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void load()} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
          {canUpdate() && (
            <button className="hbtn primary" onClick={() => setEditing({ row: null })}>
              <Icon name="plus" size={13} />
              New pallet
            </button>
          )}
        </div>
      </div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      {/* Bulk action bar replaces the filter bar while a selection is active. */}
      {ids.length > 0 ? (
        <div className="fbar" style={{ borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>
            {ids.length} selected
          </span>
          {canDelete() && (
            <button className="btn" onClick={() => void onBulkDelete()} disabled={busy}>
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
          <select value={typeF} onChange={(e) => setTypeF(e.target.value)} title="Filter by type">
            <option value="">All types</option>
            {palletTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <input type="text" placeholder="Search pallet…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <ColumnPicker columns={PALLET_COLUMNS} hidden={hidden} onToggle={toggle} />
        </div>
      )}

      <div className="card">
        <div style={{ overflow: "auto" }}>
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
                <th style={{ width: 36, textAlign: "center" }}>#</th>
                <th>Name</th>
                {show("packing") && <th>Packing</th>}
                {show("size") && <th>Size</th>}
                {show("type") && <th>Type</th>}
                {show("coverage") && <th className="num" style={{ textAlign: "right" }}>Coverage (m² / ft²)</th>}
                {show("boxesPerCont") && <th className="num" style={{ textAlign: "right" }}>Boxes / Cont.</th>}
                {show("palletsPerCont") && <th className="num" style={{ textAlign: "right" }}>Pallets / Cont.</th>}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => {
                const sel = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => setEditing({ row: r })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) setEditing({ row: r });
                    }}
                    style={{ cursor: "pointer", background: sel ? "var(--accent-soft)" : undefined }}
                    title="Edit pallet"
                  >
                    {/* checkbox cell stops propagation so toggling never opens the form */}
                    <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={sel} onChange={() => toggleOne(r.id)} />
                    </td>
                    <td className="muted mono" style={{ textAlign: "center" }}>{pager.from + i}</td>
                    <td><span className="chip">{r.name}</span></td>
                    {show("packing") && <td className="muted mono">{r.packingDetails || <span className="dim">—</span>}</td>}
                    {show("size") && <td>{r.sizeLabel || r.palletSizeLabel ? <span className="chip size">{r.sizeLabel || r.palletSizeLabel}</span> : <span className="dim">—</span>}</td>}
                    {show("type") && <td className="muted">{r.palletType || <span className="dim">—</span>}</td>}
                    {show("coverage") && (
                      <td className="num mono">
                        {r.coverageSqm > 0 ? `${r.coverageSqm} / ${r.coverageSqft}` : <span className="dim">—</span>}
                      </td>
                    )}
                    {show("boxesPerCont") && (
                      <td className="num mono" style={{ color: "var(--fg)" }}>
                        {r.totalBoxesPerContainer > 0 ? fmt(r.totalBoxesPerContainer) : <span className="dim">—</span>}
                      </td>
                    )}
                    {show("palletsPerCont") && <td className="num mono">{r.totalPalletsPerContainer > 0 ? fmt(r.totalPalletsPerContainer) : <span className="dim">—</span>}</td>}
                  </tr>
                );
              })}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    {rows.length > 0 ? (
                      <EmptyState title="No matching results" hint="Try a different filter" />
                    ) : (
                      <EmptyState
                        icon="package"
                        title="No pallets yet"
                        hint="Add your first pallet spec with New pallet"
                        action={
                          <button className="hbtn primary" onClick={() => setEditing({ row: null })}>
                            New pallet
                          </button>
                        }
                      />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          )}
        </div>
        {!(loading && rows.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
