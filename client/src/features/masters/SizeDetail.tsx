/* ============================================================
   Size detail — same split view as the Item (Design) detail page.
   Left: resizable, searchable list of sizes. Right: header with
   Edit / More (Delete) / ✕, Primary Details, and the Activity log.

   Unlike Items there is no dedicated edit *page* for a size, so
   Edit opens the shared SizeForm modal in place.
   ============================================================ */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { SkeletonRows, EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmtLocalDateTime } from "@/lib/format";
import { ActivityLog } from "@/features/common/RecordDetail";
import { AssociatedPallets, DetailRow, MoreMenu } from "@/features/common/DetailBits";
import { SizeForm } from "./SizeForm";
import { PalletForm } from "./PalletForm";
import {
  cachedPallets,
  createPallet,
  invalidatePallets,
  listPallets,
  type PalletInput,
  type PalletRow,
  type SizeOption,
} from "./palletsApi";
import { invalidateDesigns } from "./designsApi";
import { cachedSizes, createSize, deleteSize, listSizes, updateSize, type SizeInput, type SizeRow } from "./sizesApi";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** [label, value, isUnset] — unset fields read "Not set" (dimmed) rather than a bare dash. */
type Detail = [string, string, boolean];
const num = (label: string, n: number): Detail => [label, n > 0 ? String(n) : "Not set", !(n > 0)];
const text = (label: string, s: string): Detail => [label, s || "Not set", !s];

const rows = (s: SizeRow): Detail[] => [
  text("Name", s.name),
  text("Size", s.code),
  text("Type", s.tileType),
  num("Width (mm)", s.widthMm),
  num("Length (mm)", s.lengthMm),
  num("Thickness (mm)", s.thicknessMm),
  text("Short Code", s.seqCode),
  num("Pcs / Box", s.pcsPerPacking),
  num("Box Weight (kg)", s.boxWeightKg),
  num("SQFT / Box", r2(s.sqftPerBox)),
  num("SQM / Box", r4(s.sqmPerBox)),
  text("Remark", s.remark),
  ["Created", fmtLocalDateTime(s.createdTime), false],
  ["Modified", fmtLocalDateTime(s.modifiedTime), false],
];

export function SizeDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  // Seed from cache so switching sizes / returning to the tab never flashes a skeleton.
  const [sizes, setSizes] = useState<SizeRow[] | null>(() => cachedSizes());
  // Pallets are read-only here — only to show the ones pointing at this size.
  const [pallets, setPallets] = useState<PalletRow[] | null>(() => cachedPallets());
  // Size master options, as the pallet form wants them — listPallets() already returns these.
  const [sizeOpts, setSizeOpts] = useState<SizeOption[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [creatingPallet, setCreatingPallet] = useState(false);

  const refresh = () => listSizes().then((res) => setSizes(res.ok ? res.sizes : (cachedSizes() ?? [])));
  const refreshPallets = () =>
    listPallets().then((res) => {
      setPallets(res.ok ? res.pallets : (cachedPallets() ?? []));
      if (res.ok) setSizeOpts(res.sizes);
    });
  useEffect(() => {
    void refresh();
    void refreshPallets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (sizes === null) return <SkeletonRows rows={6} />;

  const size = sizes.find((s) => s.id === id) ?? null;
  // Pallet.size is an FK to Size — the relation is already on every pallet row.
  const linked = pallets && pallets.filter((p) => p.sizeId === id);
  const needle = q.trim().toLowerCase();
  const listed = needle
    ? sizes.filter((s) => `${s.code} ${s.tileType} ${s.seqCode}`.toLowerCase().includes(needle))
    : sizes;

  // Distinct types already saved, fed to the form so the picker can create-on-save.
  const tileTypes = [...new Set(sizes.map((s) => s.tileType).filter(Boolean))].sort();
  const palletTypes = [...new Set((pallets ?? []).map((p) => p.palletType).filter(Boolean))].sort();

  const onSave = async (input: SizeInput) => {
    if (!size) return;
    const res = await updateSize(size.id, input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      toast.error(res.error || "Save failed");
      return;
    }
    setEditing(false);
    toast.success("Size updated");
    // Backend fans the new packing data out to Item + Pallet snapshots — drop
    // their caches so every view refetches the propagated values.
    invalidateDesigns();
    invalidatePallets();
    await Promise.all([refresh(), refreshPallets()]);
  };

  // Clone: same dimensions into a fresh size; seq_code left blank so
  // createSize assigns the next short code (never copy the source's).
  const onClone = async (input: SizeInput) => {
    const res = await createSize(input);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    setCloning(false);
    toast.success("Size created");
    if (res.rowid) navigate(`/sizes/${encodeURIComponent(res.rowid)}`);
    await refresh();
  };

  const onDelete = async () => {
    if (!size) return;
    if (
      !(await confirmDialog({
        message: `Are you sure you want to delete size "${size.code}"? Items and pallets that reference it will lose the link. This cannot be undone.`,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const res = await deleteSize(size.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Size deleted");
    navigate("/sizes");
  };

  // A pallet spec is always a spec *for a size* — offer the create right here,
  // with this size locked in and its per-box packing data already mirrored.
  const onCreatePallet = async (input: PalletInput) => {
    const res = await createPallet(input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      toast.error(res.error || "Save failed");
      return;
    }
    setCreatingPallet(false);
    toast.success("Pallet saved");
    await refreshPallets();
  };

  const moreItems = [
    { label: "Create Pallet", onClick: () => setCreatingPallet(true) },
    ...(can("items", "create") && size ? [{ label: "Clone", onClick: () => setCloning(true) }] : []),
    ...(can("items", "delete") ? [{ label: "Delete", danger: true, onClick: () => void onDelete() }] : []),
  ];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {editing && size && (
        <SizeForm
          tileTypes={tileTypes}
          isEdit
          initial={{
            width_mm: size.widthMm,
            length_mm: size.lengthMm,
            seq_code: size.seqCode,
            tile_type: size.tileType,
            thickness_mm: size.thicknessMm,
            pcs_per_packing: size.pcsPerPacking,
            box_weight_kg: size.boxWeightKg,
            remark: size.remark,
          }}
          onSave={onSave}
          onClose={() => setEditing(false)}
        />
      )}

      {cloning && size && (
        <SizeForm
          tileTypes={tileTypes}
          initial={{
            width_mm: size.widthMm,
            length_mm: size.lengthMm,
            seq_code: "", // fresh short code assigned on create — never copied
            tile_type: size.tileType,
            thickness_mm: size.thicknessMm,
            pcs_per_packing: size.pcsPerPacking,
            box_weight_kg: size.boxWeightKg,
            remark: size.remark,
          }}
          onSave={onClone}
          onClose={() => setCloning(false)}
        />
      )}

      {creatingPallet && size && (
        <PalletForm
          lockSize
          sizeOptions={sizeOpts}
          palletTypes={palletTypes}
          initial={{
            size: size.id,
            pallet_size_label: size.code,
            coverage_sqm: size.sqmPerBox,
            coverage_sqft: size.sqftPerBox,
            box_weight_kg: size.boxWeightKg,
          }}
          onSave={onCreatePallet}
          onClose={() => setCreatingPallet(false)}
        />
      )}

      {/* Size list — fixed viewport height with its OWN scroll, sticky while
          the detail scrolls. Drag the bottom-right corner to resize the width. */}
      <div
        className="card"
        style={{
          width: 300,
          minWidth: 220,
          maxWidth: 420,
          flexShrink: 0,
          padding: 0,
          resize: "horizontal",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          /* .main pads 14px on top and ends in a 32px ::after — subtract both so the
             list ends flush with the viewport instead of forcing the page to scroll. */
          height: "calc(100vh - var(--header-h) - 46px)",
          position: "sticky",
          top: 0,
        }}
      >
        <div className="lp-search">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search sizes…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {/* overscrollBehavior contain: reaching the list's end must not
            hand the wheel over to the page. flex:1 fills the card bottom. */}
        <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
          {listed.map((s) => {
            const cur = s.id === id;
            return (
              <Link
                key={s.id}
                to={`/sizes/${s.id}`}
                style={{
                  display: "block",
                  padding: "9px 12px",
                  borderBottom: "1px solid var(--border)",
                  background: cur ? "var(--accent-soft)" : "transparent",
                  color: "inherit",
                  textDecoration: "none",
                }}
                title={s.code}
              >
                <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.name || s.code || "—"}
                </div>
              </Link>
            );
          })}
          {listed.length === 0 && <div className="dim" style={{ padding: 12 }}>No matching sizes</div>}
        </div>
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!size ? (
          <div className="card" style={{ padding: 20 }}>
            <EmptyState title="Size not found" hint="Pick a size from the list" />
          </div>
        ) : (
          <>
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              {/* Header inside the card so it top-aligns with the size list (Zoho-style). */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  className="title"
                  style={{ flex: 1, minWidth: 0, fontSize: 26, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={size.code}
                >
                  {size.code || "—"}
                </div>
                {can("items", "edit") && (
                  <button className="hbtn" onClick={() => setEditing(true)} disabled={busy} title="Edit size">
                    <Icon name="edit" size={13} />
                    Edit
                  </button>
                )}
                <MoreMenu items={moreItems} />
                <button className="btn x" onClick={() => navigate("/sizes")} title="Close">
                  <Icon name="x" size={13} />
                </button>
              </div>
              {/* Only the facts this size actually carries — an unset field says nothing. */}
              <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                {[
                  size.tileType && `Type: ${size.tileType}`,
                  size.seqCode && `Short Code: ${size.seqCode}`,
                  size.thicknessMm > 0 && `Thickness: ${size.thicknessMm} mm`,
                ]
                  .filter(Boolean)
                  .join("  ·  ") || "No type or short code set"}
              </div>

              {/* Two columns: the facts left, the pallets that use this size right.
                  Wraps instead of squashing once the size list is dragged wide. */}
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start", marginTop: 14 }}>
                <div style={{ flex: "1 1 460px", maxWidth: 520, minWidth: 0 }}>
                  <div className="form-section-title" style={{ marginBottom: 8 }}>Primary Details</div>
                  {rows(size).map(([label, value, unset]) => (
                    <DetailRow key={label} label={label} value={value} dim={unset} />
                  ))}
                </div>

                <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                  <AssociatedPallets pallets={linked} onOpen={(pid) => navigate(`/pallets/${pid}`)} />
                </div>
              </div>
            </div>

            {/* Audit trail: who created / changed this size, from OperationLog. */}
            <div className="form-section-title" style={{ margin: "14px 0 8px" }}>Activity</div>
            <ActivityLog table="Size" entityId={size.id} />
          </>
        )}
      </div>
    </div>
  );
}
