/* ============================================================
   New Party (Customer) form — captures the Catalyst `Customer`
   schema and emits a CustomerInput for a real Data Store insert
   (Parties owns the createCustomer call). payment_term is a real
   ForeignKey → PaymentTerm, picked from live options. Reuses
   shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import type { CustomerInput, PaymentTermOption } from "./customersApi";

/* country → ISO code + flag (Data Store stores ISO, not emoji). */
const COUNTRIES: Record<string, { iso: string; flag: string }> = {
  Poland: { iso: "PL", flag: "🇵🇱" },
  Lithuania: { iso: "LT", flag: "🇱🇹" },
  Romania: { iso: "RO", flag: "🇷🇴" },
  Croatia: { iso: "HR", flag: "🇭🇷" },
  Greece: { iso: "GR", flag: "🇬🇷" },
  India: { iso: "IN", flag: "🇮🇳" },
};
const CURRENCIES = ["EUR", "USD", "INR"];

export function PartyForm({
  paymentTerms,
  initial,
  isEdit,
  onSave,
  onClose,
}: {
  paymentTerms: PaymentTermOption[];
  initial?: Partial<CustomerInput>;
  isEdit?: boolean;
  onSave: (c: CustomerInput) => void;
  onClose: () => void;
}) {
  const initialCountry =
    Object.keys(COUNTRIES).find((c) => COUNTRIES[c].iso === initial?.country_code) ?? "";
  const [country, setCountry] = useState(initialCountry);
  const [v, setV] = useState({
    name: initial?.name ?? "",
    code: initial?.code ?? "",
    currency: initial?.currency ?? "EUR",
    payment_term: initial?.payment_term ?? "",
    port_of_discharge: initial?.port_of_discharge ?? "",
    address: initial?.address ?? "",
    active: initial?.active ?? true,
  });
  const set = (k: string, val: string | boolean) => setV((p) => ({ ...p, [k]: val }));
  const missing = !v.name.trim() || !v.code.trim();

  const submit = () => {
    if (missing) return;
    onSave({
      name: v.name,
      code: v.code,
      country_code: COUNTRIES[country]?.iso ?? "",
      currency: v.currency,
      payment_term: v.payment_term,
      port_of_discharge: v.port_of_discharge,
      address: v.address,
      active: v.active,
    });
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="modal-panel card df-modal"
        style={{ maxWidth: 620 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="df-head">
          <div className="ico">
            <Icon name="flag" size={18} />
          </div>
          <div>
            <div className="ttl">{isEdit ? "Edit Customer" : "New Customer"}</div>
            <div className="sub2">
              {isEdit ? "Editing saved customer — changes overwrite the database record" : "Customer · saves to the Customer master"}
            </div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Identity</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">
                  Name<span className="req"> *</span>
                </span>
                <input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Buyer name" />
              </label>
              <label className="form-field">
                <span className="lbl">
                  Code<span className="req"> *</span>
                </span>
                <input value={v.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="MRK" />
              </label>
              <label className="form-field">
                <span className="lbl">Country</span>
                <select value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="">—</option>
                  {Object.keys(COUNTRIES).map((c) => (
                    <option key={c} value={c}>
                      {COUNTRIES[c].flag} {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Commercial</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Currency</span>
                <select value={v.currency} onChange={(e) => set("currency", e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Payment Term</span>
                <select value={v.payment_term} onChange={(e) => set("payment_term", e.target.value)}>
                  <option value="">—</option>
                  {paymentTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Active</span>
                <select value={v.active ? "Yes" : "No"} onChange={(e) => set("active", e.target.value === "Yes")}>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Port of Discharge</span>
                <input value={v.port_of_discharge} onChange={(e) => set("port_of_discharge", e.target.value)} placeholder="Gdańsk" />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Address</span>
                <input value={v.address} onChange={(e) => set("address", e.target.value)} placeholder="Billing / shipping address" />
              </label>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">* required</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={missing} onClick={submit}>
            <Icon name="check" size={13} />
            {isEdit ? "Update customer" : "Save customer"}
          </button>
        </div>
      </div>
    </div>
  );
}
