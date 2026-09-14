/* ============================================================
   Box Brand pick list (CR-181) — the one DB-sourced options list shared by
   the Quote, Sales Order and Customer forms: Brand master rows (name + logo
   file id), Combobox options carrying the logo thumbnail, and the preview
   URL for the picked brand.
   ============================================================ */
import { useEffect, useState } from "react";
import { designImageUrl } from "@/lib/api";
import type { ComboOption } from "@/ui/Combobox";
import { listMaster, type MasterRow } from "./mastersApi";

export function useBoxBrands(): { brands: MasterRow[]; options: ComboOption[]; logoUrlOf: (id: string) => string } {
  const [brands, setBrands] = useState<MasterRow[]>([]);
  useEffect(() => {
    void listMaster("Brand", ["name", "logo"]).then((r) => {
      if (r.ok) setBrands(r.rows.slice().sort((a, b) => a.name.localeCompare(b.name)));
    });
  }, []);
  const logoUrlOf = (id: string) => {
    const logo = brands.find((b) => b._id === id)?.logo;
    return logo ? designImageUrl(logo) : "";
  };
  return {
    brands,
    options: brands.map((b) => ({ value: b._id, label: b.name, icon: b.logo ? designImageUrl(b.logo) : undefined })),
    logoUrlOf,
  };
}

/** Preview of the picked brand's image beside its Combobox; renders nothing without a logo. */
export function BoxBrandPreview({ src }: { src: string }) {
  if (!src) return null;
  return <img src={src} alt="Box brand" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", flex: "0 0 auto" }} />;
}
