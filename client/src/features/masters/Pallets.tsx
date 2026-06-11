/* ============================================================
   Pallet Master — table of pallet specs backed by the Catalyst
   Data Store via palletsApi. Create / edit / delete write real rows;
   every mutation is recorded in OperationLog (see /ops). Phase 4
   (palletisation + container fit) reads these specs.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { fmt } from "@/lib/format";
import { PalletForm } from "./PalletForm";
import {
  createPallet,
  deletePallet,
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
        r.palletType.toLowerCase().includes(q),
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
      return;
    }
    setNotice(`Pallet saved (#${res.rowid}).`);
    await load();
  };

  const onDelete = async (row: PalletRow) => {
    if (!window.confirm(`Delete pallet "${row.name}"? This cannot be undone.`)) return;
    setNotice("Deleting…");
    const res = await deletePallet(row.id);
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Delete failed");
      return;
    }
    setNotice("Pallet deleted.");
    await load();
  };

  const initial: Partial<PalletInput> | undefined = editing?.row
    ? {
        name: editing.row.name,
        size: editing.row.sizeId,
        pallet_type: editing.row.palletType,
        pallet_size_label: editing.row.palletSizeLabel,
        boxes_per_pallet: editing.row.boxesPerPallet,
        pallets_per_container: editing.row.palletsPerContainer,
        empty_pallet_weight_kg: editing.row.emptyWeightKg,
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
          <button className="hbtn primary" onClick={() => setEditing({ row: null })}>
            <Icon name="plus" size={13} />
            New pallet
          </button>
        </div>
      </div>

      {error && (
        <div
          className="card"
          style={{ marginBottom: 12, borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "10px 14px" }}
        >
          {error} — check the <a href="#/ops">Operations log</a>.
        </div>
      )}

      <div className="fbar">
        <span className="muted mono">{filtered.length} rows</span>
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Search pallet…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: "center" }}>#</th>
                <th>Name</th>
                <th>Size</th>
                <th>Type</th>
                <th className="num" style={{ textAlign: "right" }}>Boxes / Pallet</th>
                <th className="num" style={{ textAlign: "right" }}>Pallets / Container</th>
                <th className="num" style={{ textAlign: "right" }}>Boxes / Container</th>
                <th className="num" style={{ textAlign: "right" }}>Empty Wt (kg)</th>
                <th style={{ width: 90, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id}>
                  <td className="muted mono" style={{ textAlign: "center" }}>{i + 1}</td>
                  <td><span className="chip">{r.name}</span></td>
                  <td>{r.sizeLabel ? <span className="chip size">{r.sizeLabel}</span> : <span className="dim">—</span>}</td>
                  <td className="muted">{r.palletType || <span className="dim">—</span>}</td>
                  <td className="num mono">{r.boxesPerPallet > 0 ? fmt(r.boxesPerPallet) : <span className="dim">—</span>}</td>
                  <td className="num mono">{r.palletsPerContainer > 0 ? fmt(r.palletsPerContainer) : <span className="dim">—</span>}</td>
                  <td className="num mono" style={{ color: "var(--fg)" }}>
                    {r.boxesPerContainer > 0 ? fmt(r.boxesPerContainer) : <span className="dim">—</span>}
                  </td>
                  <td className="num mono">{r.emptyWeightKg > 0 ? r.emptyWeightKg : <span className="dim">—</span>}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn" title="Edit" onClick={() => setEditing({ row: r })}>
                      Edit
                    </button>{" "}
                    <button className="btn" title="Delete" onClick={() => void onDelete(r)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 18 }}>
                    No pallets yet. Click <b>New pallet</b> to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
