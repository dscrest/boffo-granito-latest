/* CR-329: the warehouse list + primary for pickers and panels. Paints from the
   cache, revalidates once. `enabled` = at least one warehouse exists — every
   warehouse control hides while the feature is dormant. */
import { useEffect, useState } from "react";
import type { ComboOption } from "@/ui/Combobox";
import { cachedWarehouses, listWarehouses, primaryWarehouse, warehouseOptions, type WarehouseRow } from "./warehousesApi";

export function useWarehouses(): { warehouses: WarehouseRow[]; primary: WarehouseRow | null; options: ComboOption[]; enabled: boolean; nameOf: (id: string) => string } {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>(() => cachedWarehouses() ?? []);
  useEffect(() => {
    void listWarehouses().then((r) => r.ok && setWarehouses(r.rows));
  }, []);
  const primary = primaryWarehouse(warehouses);
  return {
    warehouses,
    primary,
    options: warehouseOptions(warehouses),
    enabled: warehouses.length > 0,
    nameOf: (id) => (id ? warehouses.find((w) => w.id === id)?.name ?? "—" : primary?.name ?? ""),
  };
}
