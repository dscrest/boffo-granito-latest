/* ============================================================
   Customer Brands (CR-393) — the private-label brand names a customer
   buys under, shown on the Customer detail (Details tab). Rows live in
   the PartyBrand master with `customer` set; the Item form offers them
   as "Custom Design Buyer Brand" once that customer is the buyer.
   Add = one text box + Add; remove = confirmDelete (reason, Admin exempt).
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDelete } from "@/ui/ConfirmDialog";
import { can } from "@/lib/auth";
import { addCustomerBrand, listCustomerBrands, removeCustomerBrand, type CustomerBrandRow } from "./designsApi";

export function CustomerBrands({ customerId }: { customerId: string }) {
  const [rows, setRows] = useState<CustomerBrandRow[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = can("customers", "edit");

  const load = async () => {
    const res = await listCustomerBrands(customerId);
    setRows(res.ok ? res.rows : []);
  };
  useEffect(() => {
    setRows(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const add = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    const res = await addCustomerBrand(customerId, n);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not add the brand");
      return;
    }
    setName("");
    toast.success("Brand added");
    await load();
  };

  const remove = async (r: CustomerBrandRow) => {
    const reason = await confirmDelete({ message: `Are you sure you want to delete the brand "${r.name}"? Items already using it keep the name.` });
    if (reason == null) return;
    setBusy(true);
    const res = await removeCustomerBrand(r.id, reason);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not delete the brand");
      return;
    }
    toast.success("Brand deleted");
    await load();
  };

  return (
    <>
      <div className="form-section-title" style={{ margin: "14px 0 8px" }}>Customer Brands</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {rows === null ? (
          <span className="dim" style={{ fontSize: "var(--t-sm)" }}>Loading…</span>
        ) : rows.length === 0 ? (
          <span className="dim" style={{ fontSize: "var(--t-sm)" }}>No brands yet.</span>
        ) : (
          rows.map((r) => (
            <span key={r.id} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {r.name}
              {canEdit && (
                <button className="btn x" title="Delete brand" aria-label={`Delete brand ${r.name}`} disabled={busy} onClick={() => void remove(r)} style={{ padding: 0, minHeight: 0, lineHeight: 1 }}>
                  <Icon name="x" size={10} />
                </button>
              )}
            </span>
          ))
        )}
      </div>
      {canEdit && (
        <div className="ctl-row" style={{ marginTop: 8, maxWidth: 360 }}>
          <input
            className="grow"
            value={name}
            placeholder="New brand name"
            aria-label="New brand name"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
          />
          <button className="btn" disabled={busy || !name.trim()} onClick={() => void add()}>
            <Icon name="plus" size={12} /> Add
          </button>
        </div>
      )}
    </>
  );
}
