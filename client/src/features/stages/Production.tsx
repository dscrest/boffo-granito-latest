/* Production — request → approval → output log (grid + detail). Live KPIs and
   active-jobs-by-size live on the Dashboard; this page tracks each production
   line through its lifecycle, styled like the Quotes master. */
import { ProductionTable } from "./ProductionTable";

export function Production() {
  return (
    <div>
      <ProductionTable />
    </div>
  );
}
