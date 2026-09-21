/* ============================================================
   Pallet master form page (CR-220) — PalletForm as a full page:
     /pallets/new                create
     /pallets/new?size=<id>      create for one Size (picker locked) —
                                 opened from the Size detail, returns there
     /pallets/:id/edit           edit
     /pallets/:id/clone          clone into a new pallet
   ============================================================ */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { PalletForm, type PalletFormInitial } from "./PalletForm";
import { createPallet, listPallets, updatePallet, type PalletInput, type PalletRow, type SizeOption } from "./palletsApi";

export function PalletFormPage() {
  const { id = "" } = useParams();
  const palletId = decodeURIComponent(id);
  const [params] = useSearchParams();
  const sizeId = palletId ? "" : params.get("size") || "";
  const clone = useLocation().pathname.endsWith("/clone");
  const editing = !!palletId && !clone;
  const navigate = useNavigate();

  const [data, setData] = useState<{ pallets: PalletRow[]; sizes: SizeOption[] } | null>(null);
  useEffect(() => {
    void listPallets().then((r) => setData(r.ok ? { pallets: r.pallets, sizes: r.sizes } : { pallets: [], sizes: [] }));
  }, []);

  // Pallet permissions ride on the Item master module (as the list + detail do).
  if (!can("items", editing ? "edit" : "create")) {
    return <EmptyState title="No access" hint="You don't have permission for this" />;
  }
  if (!data) return <div className="dim">Loading…</div>;
  const pallet = palletId ? data.pallets.find((p) => p.id === palletId) : undefined;
  if (palletId && !pallet) return <EmptyState title="Pallet not found" />;
  const size = sizeId ? data.sizes.find((s) => s.id === sizeId) : undefined;
  if (sizeId && !size) return <EmptyState title="Size not found" />;

  const initial: PalletFormInitial | undefined = pallet
    ? {
        // Clone never copies the auto-generated identity (name / packing details).
        ...(editing ? { name: pallet.name, packing_details: pallet.packingDetails } : {}),
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
      }
    : size
      ? {
          size: size.id,
          pallet_size_label: size.label,
          coverage_sqm: size.sqmPerBox,
          coverage_sqft: size.sqftPerBox,
          box_weight_kg: size.boxWeightKg,
        }
      : undefined;

  const detailUrl = (rowid: string) => `/pallets/${encodeURIComponent(rowid)}`;
  const sizeUrl = `/sizes/${encodeURIComponent(sizeId)}`;

  const onSave = async (input: PalletInput) => {
    const res = editing ? await updatePallet(palletId, input) : await createPallet(input);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success(editing ? "Pallet updated" : "Pallet created");
    // A pallet created from a Size goes back to that Size (its pallets list); otherwise the saved record.
    navigate(size ? sizeUrl : editing ? detailUrl(palletId) : res.rowid ? detailUrl(res.rowid) : "/pallets", { replace: true });
  };

  return (
    <PalletForm
      key={`${palletId}|${sizeId}|${clone}`}
      // Distinct types already saved, fed to the form so the picker can create-on-save.
      palletTypes={[...new Set(data.pallets.map((p) => p.palletType).filter(Boolean))].sort()}
      sizeOptions={data.sizes}
      lockSize={!!size}
      isEdit={editing}
      initial={initial}
      onSave={onSave}
      onClose={() => navigate(size ? sizeUrl : palletId ? detailUrl(palletId) : "/pallets")}
    />
  );
}
