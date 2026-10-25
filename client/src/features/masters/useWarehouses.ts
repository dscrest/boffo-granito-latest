/* CR-329: the warehouse list + default node for pickers and panels. Paints from the
   cache, revalidates once. `enabled` = at least one warehouse exists — every
   warehouse control hides while the feature is dormant.
   CR-409: a warehouse holds LOCATIONS (A1 … F12). `options` = the leaves a picker
   offers, `primary` = where new stock lands by default (the primary's first
   location), `nodes` = every stock-holding node in display order (warehouse,
   then its locations), `nameOf` = "Warehouse ▸ Location". */
import { useEffect, useState } from "react";
import type { ComboOption } from "@/ui/Combobox";
import { cachedWarehouses, defaultNode, defaultNodeFor, leafOptions, listWarehouses, nodeLabel, primaryWarehouse, stockNodes, type WarehouseRow } from "./warehousesApi";

export function useWarehouses(): {
  /** Every row — warehouses and their locations. */
  warehouses: WarehouseRow[];
  /** Warehouse, then its locations (natural order), for list views. */
  nodes: WarehouseRow[];
  /** Where new stock lands when nothing is picked: the primary's first location, else the primary. */
  primary: WarehouseRow | null;
  /** CR-411: the default leaf for a purpose ("Production", "Palletization", "Loading Bay"), else `primary`. */
  primaryFor: (purpose: string) => WarehouseRow | null;
  options: ComboOption[];
  enabled: boolean;
  nameOf: (id: string) => string;
} {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>(() => cachedWarehouses() ?? []);
  useEffect(() => {
    void listWarehouses().then((r) => r.ok && setWarehouses(r.rows));
  }, []);
  const top = primaryWarehouse(warehouses);
  return {
    warehouses,
    nodes: stockNodes(warehouses),
    primary: defaultNode(warehouses),
    primaryFor: (purpose) => defaultNodeFor(warehouses, purpose),
    options: leafOptions(warehouses),
    enabled: warehouses.length > 0,
    // "" = recorded without a location → the primary warehouse node (its "Unassigned" when it has locations).
    nameOf: (id) => (id ? nodeLabel(warehouses, id) : top ? nodeLabel(warehouses, top.id) : ""),
  };
}
