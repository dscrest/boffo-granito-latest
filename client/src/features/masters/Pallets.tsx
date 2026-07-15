/* ============================================================
   Pallet Master — table of pallet specs backed by the Catalyst
   Data Store via palletsApi. Create / edit / delete write real rows;
   every mutation is recorded in OperationLog (see /ops). Phase 4
   (palletisation + container fit) reads these specs.

   Follows the master-page UI convention (see DesignMaster):
   • NO inline row actions — row-click opens the pallet detail page.
   • Bulk select (checkboxes) → bulk delete on selection.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { fmt, fmtDateTime } from "@/lib/format";
import { can } from "@/lib/auth";
import { PalletForm } from "./PalletForm";
import { bulkDeletePallets, createPallet, listPallets, type PalletInput, type PalletRow, type SizeOption } from "./palletsApi";

const dash = <span className="dim">—</span>;

// Toggleable + reorderable columns (checkbox/# pinned outside the map).
const PALLET_COLUMNS: ColumnDef<PalletRow>[] = [
  {
    key: "name",
    label: "Name",
    render: (r) => (
      <Link className="linkish" to={`/pallets/${r.id}`} onClick={(e) => e.stopPropagation()} title="View pallet">
        <span className="chip">{r.name}</span>
      </Link>
    ),
  },
  { key: "packing", label: "Packing", className: "muted mono", render: (r) => r.packingDetails || dash },
  {
    key: "size",
    label: "Size",
    render: (r) =>
      r.sizeLabel || r.palletSizeLabel ? <span className="chip size">{r.sizeLabel || r.palletSizeLabel}</span> : dash,
  },
  { key: "type", label: "Type", className: "muted", render: (r) => r.palletType || dash },
  {
    key: "coverage",
    label: "Coverage (m² / ft²)",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.coverageSqm > 0 ? `${r.coverageSqm} / ${r.coverageSqft}` : dash),
  },
  {
    key: "boxesPerCont",
    label: "Boxes / Cont.",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) =>
      r.totalBoxesPerContainer > 0 ? <span style={{ color: "var(--fg)" }}>{fmt(r.totalBoxesPerContainer)}</span> : dash,
  },
  {
    key: "palletsPerCont",
    label: "Pallets / Cont.",
    className: "num mono",
    style: { textAlign: "right" },
    render: (r) => (r.totalPalletsPerContainer > 0 ? fmt(r.totalPalletsPerContainer) : dash),
  },
  { key: "created", label: "Created", className: "muted mono", render: (r) => fmtDateTime(r.createdTime) },
  { key: "modified", label: "Modified", className: "muted mono", render: (r) => fmtDateTime(r.modifiedTime) },
];

export function Pallets() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PalletRow[]>([]);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { ordered, visible, hidden, toggle, move } = useColumns("palletsTableColumns", PALLET_COLUMNS, ["created", "modified"]);
  const [showNew, setShowNew] = useState(false);

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

  const pager = usePagination(filtered.length, "palletsPageSize", query);
  const pageRows = pager.slice(filtered);

  const onCreate = async (input: PalletInput) => {
    const res = await createPallet(input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    setShowNew(false);
    toast.success("Pallet saved");
    // Land on the new record so the next action can't target the wrong one.
    if (res.rowid) navigate(`/pallets/${encodeURIComponent(res.rowid)}`);
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
    if (!(await confirmDialog({ message: `Are you sure you want to delete ${ids.length} selected pallet${ids.length > 1 ? "s" : ""}? This cannot be undone.`, danger: true })))
      return;
    setBusy(true);
    const res = await bulkDeletePallets(ids);
    setBusy(false);
    if (!res.ok) {
      setError(`${res.failed} delete(s) failed: ${res.firstError || "unknown error"}`);
      toast.error(`${res.done} deleted, ${res.failed} failed`);
    } else {
      toast.success(`${res.done} pallet${res.done === 1 ? "" : "s"} deleted`);
    }
    await load();
  };

  // Distinct types already saved, fed to the form so the picker can create-on-save.
  const palletTypes = useMemo(
    () => [...new Set(rows.map((r) => r.palletType).filter(Boolean))].sort(),
    [rows],
  );

  return (
    /* Column fills the scrollport exactly (.main pads 14px top + a 32px ::after),
       so the grid card grows and its footer sits on the window edge — no dead
       band under short tables. */
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - var(--header-h) - 46px)" }}>
      {showNew && (
        <PalletForm palletTypes={palletTypes} sizeOptions={sizes} onSave={onCreate} onClose={() => setShowNew(false)} />
      )}

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      {/* Bulk action bar replaces the filter bar while a selection is active. */}
      {ids.length > 0 ? (
        <div className="fbar" style={{ borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>
            {ids.length} selected
          </span>
          {can("items", "delete") && (
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
          {/* Type filter intentionally omitted for now — search covers it. */}
          <span className="muted" style={{ fontSize: "var(--t-sm)" }}>{loading ? "Loading…" : null}</span>
          <div style={{ flex: 1 }} />
          <span className="gsearch">
            <Icon name="search" size={13} />
            <input type="text" placeholder="Search pallet…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
          {can("items", "create") && (
            /* fbar controls are 26px tall; the 30px .hbtn default would stretch the bar. */
            <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} onClick={() => setShowNew(true)}>
              <Icon name="plus" size={13} />
              New pallet
            </button>
          )}
        </div>
      )}

      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
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
                {visible.map((c) => (
                  <th key={c.key} style={c.style}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => {
                const sel = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    style={{ background: sel ? "var(--accent-soft)" : undefined }}
                  >
                    {/* checkbox cell stops propagation so toggling never navigates */}
                    <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={sel} onChange={() => toggleOne(r.id)} />
                    </td>
                    <td className="muted mono" style={{ textAlign: "center" }}>{pager.from + i}</td>
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(r)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={visible.length + 2}>
                    {rows.length > 0 ? (
                      <EmptyState title="No matching results" hint="Try a different filter" />
                    ) : (
                      <EmptyState
                        icon="package"
                        title="No pallets yet"
                        hint="Add your first pallet spec with New pallet"
                        action={
                          <button className="hbtn primary" onClick={() => setShowNew(true)}>
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
