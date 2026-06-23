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

export function Pallets() {
  const [rows, setRows] = useState<PalletRow[]>([]);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
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
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.sizeLabel.toLowerCase().includes(q) ||
        r.palletType.toLowerCase().includes(q) ||
        r.packingDetails.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const onSave = async (input: PalletInput) => {
    const target = editing?.row;
    setEditing(null);
    setNotice(target ? "Saving changes…" : "Saving pallet…");
    const res = target ? await updatePallet(target.id, input) : await createPallet(input);
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    setNotice(`Pallet saved (#${res.rowid}).`);
    toast.success(target ? "Pallet updated" : "Pallet saved");
    await load();
  };

  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const toggleOne = (id: string) =>
    setSelected((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((p) => {
      const next = new Set(p);
      if (allShownSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
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

  const initial: Partial<PalletInput> | undefined = editing?.row
    ? {
        name: editing.row.name,
        packing_details: editing.row.packingDetails,
        size: editing.row.sizeId,
        pallet_type: editing.row.palletType,
        pallet_size_label: editing.row.palletSizeLabel,
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
          sizes={sizes}
          initial={initial}
          isEdit={!!editing.row}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="page-head">
        <div>
          <div className="title">Pallet Master</div>
          <div className="sub">
            {loading ? "Loading…" : `${filtered.length} of ${rows.length} pallets`}
            {notice && (
              <>
                {" · "}
                <span className="dim">{notice}</span>
              </>
            )}
          </div>
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
          <span className="muted mono">{filtered.length} rows</span>
          <div style={{ flex: 1 }} />
          <input type="text" placeholder="Search pallet…" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                <th>Packing</th>
                <th>Size</th>
                <th>Type</th>
                <th className="num" style={{ textAlign: "right" }}>Coverage (m² / ft²)</th>
                <th className="num" style={{ textAlign: "right" }}>Boxes / Cont.</th>
                <th className="num" style={{ textAlign: "right" }}>Pallets / Cont.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
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
                    <td className="muted mono" style={{ textAlign: "center" }}>{i + 1}</td>
                    <td><span className="chip">{r.name}</span></td>
                    <td className="muted mono">{r.packingDetails || <span className="dim">—</span>}</td>
                    <td>{r.sizeLabel ? <span className="chip size">{r.sizeLabel}</span> : <span className="dim">—</span>}</td>
                    <td className="muted">{r.palletType || <span className="dim">—</span>}</td>
                    <td className="num mono">
                      {r.coverageSqm > 0 ? `${r.coverageSqm} / ${r.coverageSqft}` : <span className="dim">—</span>}
                    </td>
                    <td className="num mono" style={{ color: "var(--fg)" }}>
                      {r.totalBoxesPerContainer > 0 ? fmt(r.totalBoxesPerContainer) : <span className="dim">—</span>}
                    </td>
                    <td className="num mono">{r.totalPalletsPerContainer > 0 ? fmt(r.totalPalletsPerContainer) : <span className="dim">—</span>}</td>
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
      </div>
    </div>
  );
}
