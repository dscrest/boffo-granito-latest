/* ============================================================
   Container Master form page (CR-261):
     /containers/new          create
     /containers/:id/edit     edit
     /containers/:id/clone    clone (same size + pallets — a size may have several
                              containers since CR-273; change the mix and save)
   ============================================================ */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { ContainerFormatForm, type ContainerFormatFormInitial } from "./ContainerFormatForm";
import {
  createContainerFormat,
  listContainerFormats,
  updateContainerFormat,
  type ContainerFormatInput,
  type ContainerFormatRow,
} from "./containerFormatsApi";
import type { PalletRow, SizeOption } from "./palletsApi";

export function ContainerFormatFormPage() {
  const { id = "" } = useParams();
  const rowId = decodeURIComponent(id);
  const clone = useLocation().pathname.endsWith("/clone");
  const editing = !!rowId && !clone;
  const navigate = useNavigate();

  const [data, setData] = useState<{ formats: ContainerFormatRow[]; pallets: PalletRow[]; sizes: SizeOption[] } | null>(null);
  useEffect(() => {
    void listContainerFormats().then((r) => setData(r.ok ? { formats: r.formats, pallets: r.pallets, sizes: r.sizes } : { formats: [], pallets: [], sizes: [] }));
  }, []);

  if (!can("items", editing ? "edit" : "create")) return <EmptyState title="No access" hint="You don't have permission for this" />;
  if (!data) return <div className="dim">Loading…</div>;
  const row = rowId ? data.formats.find((f) => f.id === rowId) : undefined;
  if (rowId && !row) return <EmptyState title="Container not found" />;

  const initial: ContainerFormatFormInitial | undefined = row
    ? {
        size: row.sizeId,
        lines: row.lines.map((l) => ({ palletId: l.palletId, count: l.count })),
        remarks: row.remarks,
      }
    : undefined;
  const detailUrl = (rid: string) => `/containers/${encodeURIComponent(rid)}`;

  const onSave = async (input: ContainerFormatInput) => {
    const res = editing ? await updateContainerFormat(rowId, input, data.pallets, data.sizes) : await createContainerFormat(input, data.pallets, data.sizes);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success(editing ? "Container updated" : "Container created");
    navigate(editing ? detailUrl(rowId) : res.rowid ? detailUrl(res.rowid) : "/containers", { replace: true });
  };

  return (
    <ContainerFormatForm
      key={`${rowId}|${clone}`}
      isEdit={editing}
      initial={initial}
      sizeOptions={data.sizes}
      pallets={data.pallets}
      onSave={onSave}
      onClose={() => navigate(rowId ? detailUrl(rowId) : "/containers")}
    />
  );
}
