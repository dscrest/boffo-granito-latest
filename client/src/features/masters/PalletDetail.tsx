/* ============================================================
   Pallet detail — same split view as the Size / Item detail pages.
   Left: resizable, searchable list of pallets. Right: header with
   Edit / More (Delete) / ✕, grouped detail sections, Activity log.

   Like Size there is no dedicated edit *page*, so Edit opens the
   shared PalletForm modal in place.

   Values a pallet doesn't carry read "Not set" rather than a bare
   dash — a labelled blank says more than a hyphen.
   ============================================================ */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { SkeletonRows, EmptyState } from "@/ui/States";
import { canDelete, canUpdate } from "@/lib/auth";
import { fmtLocalDateTime } from "@/lib/format";
import { ActivityLog } from "@/features/common/RecordDetail";
import { AssociatedOrders, DetailRow, MoreMenu } from "@/features/common/DetailBits";
import { PalletPackForm } from "@/features/stages/PalletPackForm";
import { closePallet, type ClosePalletInput } from "@/features/stages/palletisationApi";
import { PalletForm } from "./PalletForm";
import {
  cachedPalletOrders,
  cachedPallets,
  deletePallet,
  listPalletOrders,
  listPallets,
  updatePallet,
  type PalletInput,
  type PalletOrder,
  type PalletRow,
  type SizeOption,
} from "./palletsApi";

/* lib/format's fmt() rounds to whole numbers — coverage (1.44 m²) needs decimals. */
const nfmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format;

/** [label, value, isUnset] — unset fields render dimmed as "Not set". */
type Detail = [string, string, boolean];
const num = (label: string, n: number): Detail => [label, n > 0 ? nfmt(n) : "Not set", !(n > 0)];
const text = (label: string, s: string): Detail => [label, s || "Not set", !s];

function Section({ title, rows }: { title: string; rows: Detail[] }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div className="form-section-title" style={{ marginBottom: 8 }}>{title}</div>
      {rows.map(([label, value, unset]) => (
        <DetailRow key={label} label={label} value={value} dim={unset} />
      ))}
    </div>
  );
}

export function PalletDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  // Seed from cache so switching pallets / returning to the tab never flashes a skeleton.
  const [pallets, setPallets] = useState<PalletRow[] | null>(() => cachedPallets());
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  // Read-only here — which orders were packed on each pallet (PalletisedBatch).
  const [palletOrders, setPalletOrders] = useState<Record<string, PalletOrder[]> | null>(() =>
    cachedPalletOrders(),
  );
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [packing, setPacking] = useState(false);

  const refresh = () =>
    listPallets().then((res) => {
      setPallets(res.ok ? res.pallets : (cachedPallets() ?? []));
      if (res.ok) setSizes(res.sizes);
    });
  const refreshOrders = () =>
    listPalletOrders().then((res) => setPalletOrders(res.ok ? res.byPallet : (cachedPalletOrders() ?? {})));
  useEffect(() => {
    void refresh();
    void refreshOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pallets === null) return <SkeletonRows rows={6} />;

  const pallet = pallets.find((p) => p.id === id) ?? null;
  // null while the batch fetch is in flight; [] once we know this pallet has none.
  const linkedOrders = palletOrders && (palletOrders[id] ?? []);
  const needle = q.trim().toLowerCase();
  const listed = needle
    ? pallets.filter((p) => `${p.name} ${p.sizeLabel} ${p.palletType}`.toLowerCase().includes(needle))
    : pallets;

  // Distinct types already saved, fed to the form so the picker can create-on-save.
  const palletTypes = [...new Set(pallets.map((p) => p.palletType).filter(Boolean))].sort();

  const onSave = async (input: PalletInput) => {
    if (!pallet) return;
    const res = await updatePallet(pallet.id, input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      toast.error(res.error || "Save failed");
      return;
    }
    setEditing(false);
    toast.success("Pallet updated");
    await refresh();
  };

  const onDelete = async () => {
    if (!pallet) return;
    if (
      !(await confirmDialog({
        message: `Are you sure you want to delete pallet "${pallet.name}"? This cannot be undone.`,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const res = await deletePallet(pallet.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Pallet deleted");
    navigate("/pallets");
  };

  // Pack an order onto this spec without leaving for the Palletization stage.
  // The saga busts the pallet-orders cache, so Associated Orders refetches.
  const onPalletize = async (input: ClosePalletInput) => {
    const res = await closePallet(input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      toast.error(res.error || "Close-pallet failed");
      return;
    }
    setPacking(false);
    toast.success(`Pallet closed — batch #${res.rowid} · ${res.data?.boxes_packed ?? 0} boxes.`);
    await refreshOrders();
  };

  const moreItems = [
    { label: "Palletize Order", onClick: () => setPacking(true) },
    ...(canDelete() ? [{ label: "Delete", danger: true, onClick: () => void onDelete() }] : []),
  ];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {editing && pallet && (
        <PalletForm
          palletTypes={palletTypes}
          sizeOptions={sizes}
          isEdit
          initial={{
            name: pallet.name,
            packing_details: pallet.packingDetails,
            size: pallet.sizeId,
            pallet_type: pallet.palletType,
            // Carries the "WxL" tile label the form parses back into Width/Length.
            pallet_size_label: pallet.palletSizeLabel || pallet.sizeLabel,
            coverage_sqm: pallet.coverageSqm,
            coverage_sqft: pallet.coverageSqft,
            box_weight_kg: pallet.boxWeightKg,
            boxes_per_pallet: pallet.boxesPerPallet,
            pallets_per_container: pallet.palletsPerContainer,
            empty_pallet_weight_kg: pallet.emptyWeightKg,
            b_boxes_per_pallet: pallet.bBoxesPerPallet,
            b_pallets_per_container: pallet.bPalletsPerContainer,
            b_pallet_weight: pallet.bPalletWeightKg,
            remarks: pallet.remarks,
          }}
          onSave={onSave}
          onClose={() => setEditing(false)}
        />
      )}

      {packing && pallet && (
        <PalletPackForm presetPalletId={pallet.id} onSave={onPalletize} onClose={() => setPacking(false)} />
      )}

      {/* Pallet list — fixed viewport height with its OWN scroll, sticky while
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
          <input type="text" placeholder="Search pallets…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {/* overscrollBehavior contain: reaching the list's end must not
            hand the wheel over to the page. flex:1 fills the card bottom. */}
        <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
          {listed.map((p) => {
            const cur = p.id === id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(`/pallets/${p.id}`)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 12px",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  background: cur ? "var(--accent-soft)" : "transparent",
                  cursor: "pointer",
                  font: "inherit",
                }}
                title={p.name}
              >
                <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {p.name}
                </div>
                {/* Label the values instead of printing bare dashes for the ones a pallet doesn't carry. */}
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                  {[
                    p.sizeLabel && `Size: ${p.sizeLabel}`,
                    p.palletType && `Type: ${p.palletType}`,
                    p.totalBoxesPerContainer > 0 && `${nfmt(p.totalBoxesPerContainer)} boxes/cont.`,
                  ]
                    .filter(Boolean)
                    .join("  ·  ") || "No details yet"}
                </div>
              </button>
            );
          })}
          {listed.length === 0 && <div className="dim" style={{ padding: 12 }}>No matching pallets</div>}
        </div>
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!pallet ? (
          <div className="card" style={{ padding: 20 }}>
            <EmptyState title="Pallet not found" hint="Pick a pallet from the list" />
          </div>
        ) : (
          <>
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              {/* Header inside the card so it top-aligns with the pallet list (Zoho-style). */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  className="title"
                  style={{ flex: 1, minWidth: 0, fontSize: 26, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={pallet.name}
                >
                  {pallet.name}
                </div>
                {canUpdate() && (
                  <button className="hbtn" onClick={() => setEditing(true)} disabled={busy} title="Edit pallet">
                    <Icon name="edit" size={13} />
                    Edit
                  </button>
                )}
                <MoreMenu items={moreItems} />
                <button className="btn x" onClick={() => navigate("/pallets")} title="Close">
                  <Icon name="x" size={13} />
                </button>
              </div>
              {/* Only the facts this pallet actually carries — an unset field says nothing. */}
              <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                {[
                  pallet.sizeLabel && `Size: ${pallet.sizeLabel}`,
                  pallet.palletType && `Type: ${pallet.palletType}`,
                  pallet.packingDetails && `Packing: ${pallet.packingDetails}`,
                ]
                  .filter(Boolean)
                  .join("  ·  ") || "No size or type set"}
              </div>

              {/* Two columns: the pallet's own facts left, the orders packed on it
                  right. Wraps instead of squashing once the pallet list is dragged wide. */}
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ flex: "1 1 460px", maxWidth: 520, minWidth: 0 }}>
                  <Section
                    title="Primary Details"
                    rows={[
                      text("Name", pallet.name),
                      text("Size", pallet.sizeLabel),
                      text("Pallet Size", pallet.palletSizeLabel),
                      text("Type", pallet.palletType),
                      text("Packing", pallet.packingDetails),
                      num("Coverage (m² / box)", pallet.coverageSqm),
                      num("Coverage (ft² / box)", pallet.coverageSqft),
                      num("Box Weight (kg)", pallet.boxWeightKg),
                    ]}
                  />

                  <Section
                    title="Arrangement A"
                    rows={[
                      num("Boxes / Pallet", pallet.boxesPerPallet),
                      num("Pallets / Container", pallet.palletsPerContainer),
                      num("Empty Pallet Weight (kg)", pallet.emptyWeightKg),
                    ]}
                  />

                  {/* Arrangement B only exists on mixed loads — hide the section entirely otherwise. */}
                  {(pallet.bBoxesPerPallet > 0 || pallet.bPalletsPerContainer > 0) && (
                    <Section
                      title="Arrangement B"
                      rows={[
                        num("Boxes / Pallet", pallet.bBoxesPerPallet),
                        num("Pallets / Container", pallet.bPalletsPerContainer),
                        num("Pallet Weight (kg)", pallet.bPalletWeightKg),
                      ]}
                    />
                  )}

                  <Section
                    title="Per Container (A + B)"
                    rows={[
                      num("Total Boxes", pallet.totalBoxesPerContainer),
                      num("Total Pallets", pallet.totalPalletsPerContainer),
                      num("Total Coverage (m²)", pallet.totalSqmPerContainer),
                      num("Total Coverage (ft²)", pallet.totalSqftPerContainer),
                      num("Total Box Weight (kg)", pallet.totalBoxWeightPerContainer),
                    ]}
                  />

                  <Section
                    title="Record"
                    rows={[
                      text("Remarks", pallet.remarks),
                      ["Created", fmtLocalDateTime(pallet.createdTime), false],
                      ["Modified", fmtLocalDateTime(pallet.modifiedTime), false],
                    ]}
                  />
                </div>

                {/* marginTop matches the 14px a Section puts above its title. */}
                <div style={{ flex: "1 1 320px", minWidth: 0, marginTop: 14 }}>
                  <AssociatedOrders
                    orders={linkedOrders}
                    onOpen={(soId) => navigate(`/orders/${encodeURIComponent(soId)}`)}
                  />
                </div>
              </div>
            </div>

            {/* Audit trail: who created / changed this pallet, from OperationLog. */}
            <div className="form-section-title" style={{ margin: "14px 0 8px" }}>Activity</div>
            <ActivityLog table="Pallet" entityId={pallet.id} />
          </>
        )}
      </div>
    </div>
  );
}
