/* ============================================================
   New Party (Customer) form — captures the Catalyst `Customer`
   schema and emits a CustomerInput for a real Data Store insert
   (Parties owns the createCustomer call). payment_term is a real
   ForeignKey → PaymentTerm, picked from live options. Layout
   mirrors Zoho Books "New Customer": contact person row, then
   billing + shipping address columns with a "same as billing"
   copy toggle. Reuses shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import {
  composeAddress,
  emptyExtras,
  isoInfo,
  type CustomerExtras,
  type CustomerInput,
  type PaymentTermOption,
} from "./customersApi";

/* ISO codes offered in the country picker (Data Store stores ISO, not
   emoji); display name + flag are derived via isoInfo. */
const COUNTRY_CODES = [
  "AM", "CO", "DE", "EC", "ES", "FR", "GR", "HR", "IN", "IT", "LC", "LT",
  "MT", "NI", "NL", "PE", "PL", "RO", "RU", "SA", "SD", "SE", "TN",
];
const COUNTRY_OPTIONS = COUNTRY_CODES.map((iso) => ({ iso, ...isoInfo(iso) })).sort((a, b) =>
  a.country.localeCompare(b.country),
);
const CURRENCIES = ["EUR", "USD", "INR"];
const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Dr."];

/* One address column (billing_* or shipping_*). Field order mirrors Books. */
const ADDRESS_KEYS = ["attention", "country", "street1", "street2", "city", "state", "pincode", "phone"] as const;
const ADDRESS_LABELS: Record<(typeof ADDRESS_KEYS)[number], string> = {
  attention: "Attention",
  country: "Country/Region",
  street1: "Street 1",
  street2: "Street 2",
  city: "City",
  state: "State",
  pincode: "Pin Code",
  phone: "Phone",
};

export function PartyForm({
  paymentTerms,
  salesPersons,
  initial,
  isEdit,
  onSave,
  onClose,
}: {
  paymentTerms: PaymentTermOption[];
  salesPersons: PaymentTermOption[];
  initial?: Partial<CustomerInput>;
  isEdit?: boolean;
  onSave: (c: CustomerInput) => void;
  onClose: () => void;
}) {
  const [country, setCountry] = useState(initial?.country_code ?? "");
  const [v, setV] = useState({
    name: initial?.name ?? "",
    code: initial?.code ?? "",
    currency: initial?.currency ?? "EUR",
    payment_term: initial?.payment_term ?? "",
    port_of_discharge: initial?.port_of_discharge ?? "",
    address: initial?.address ?? "",
    active: initial?.active ?? true,
  });
  const [x, setX] = useState<CustomerExtras>(() => {
    const base = emptyExtras();
    for (const k of Object.keys(base) as (keyof CustomerExtras)[]) {
      base[k] = (initial?.[k] as string) ?? "";
    }
    return base;
  });
  // "Same as billing": on for a new customer; on edit, only when shipping
  // already mirrors billing (or is empty).
  const [sameAsBilling, setSameAsBilling] = useState(() =>
    ADDRESS_KEYS.every((k) => {
      const ship = (initial?.[`shipping_${k}`] as string) ?? "";
      return !ship || ship === ((initial?.[`billing_${k}`] as string) ?? "");
    }),
  );

  const set = (k: string, val: string | boolean) => setV((p) => ({ ...p, [k]: val }));
  const setExtra = (k: keyof CustomerExtras, val: string) => setX((p) => ({ ...p, [k]: val }));
  const missing = !v.name.trim() || !v.code.trim();

  const submit = () => {
    if (missing) return;
    const extras = { ...x };
    if (sameAsBilling) {
      for (const k of ADDRESS_KEYS) extras[`shipping_${k}`] = extras[`billing_${k}`];
    }
    // Keep the legacy one-line `address` (quote/order autofill reads it):
    // composed from billing parts, falling back to whatever was typed before.
    const composed = composeAddress(extras, "billing");
    onSave({
      name: v.name,
      code: v.code,
      country_code: country,
      currency: v.currency,
      payment_term: v.payment_term,
      port_of_discharge: v.port_of_discharge,
      address: composed || v.address,
      active: v.active,
      ...extras,
    });
  };

  const panelRef = useModalA11y(onClose);

  const addressColumn = (prefix: "billing" | "shipping", disabled: boolean) => (
    <div style={{ display: "grid", gap: 8 }}>
      {ADDRESS_KEYS.map((k) => {
        const key = `${prefix}_${k}` as keyof CustomerExtras;
        const value = disabled ? x[`billing_${k}`] : x[key];
        return (
          <label key={key} className="form-field">
            <span className="lbl">{ADDRESS_LABELS[k]}</span>
            <input
              value={value}
              disabled={disabled}
              onChange={(e) => setExtra(key, e.target.value)}
              placeholder={ADDRESS_LABELS[k]}
            />
          </label>
        );
      })}
    </div>
  );

  return (
    <div className="modal-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="modal-panel card df-modal"
        style={{ maxWidth: 760 }}
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
                  <option value=""></option>
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.iso} value={c.iso}>
                      {c.flag} {c.country}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Main Party Name</span>
                <input
                  value={x.main_party_name}
                  onChange={(e) => setExtra("main_party_name", e.target.value)}
                  placeholder="Parent / group party"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Working Status</span>
                <input
                  value={x.working_status}
                  onChange={(e) => setExtra("working_status", e.target.value)}
                  placeholder="Working status"
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Primary Contact</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Salutation</span>
                <select value={x.contact_salutation} onChange={(e) => setExtra("contact_salutation", e.target.value)}>
                  <option value=""></option>
                  {SALUTATIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">First Name</span>
                <input value={x.contact_first_name} onChange={(e) => setExtra("contact_first_name", e.target.value)} placeholder="First Name" />
              </label>
              <label className="form-field">
                <span className="lbl">Last Name</span>
                <input value={x.contact_last_name} onChange={(e) => setExtra("contact_last_name", e.target.value)} placeholder="Last Name" />
              </label>
              <label className="form-field">
                <span className="lbl">Email Address</span>
                <input type="email" value={x.contact_email} onChange={(e) => setExtra("contact_email", e.target.value)} placeholder="name@company.com" />
              </label>
              <label className="form-field">
                <span className="lbl">Work Phone</span>
                <input value={x.contact_work_phone} onChange={(e) => setExtra("contact_work_phone", e.target.value)} placeholder="Work Phone" />
              </label>
              <label className="form-field">
                <span className="lbl">Mobile</span>
                <input value={x.contact_mobile} onChange={(e) => setExtra("contact_mobile", e.target.value)} placeholder="Mobile" />
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
                  <option value=""></option>
                  {paymentTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Handling Person</span>
                <select value={x.handling_person} onChange={(e) => setExtra("handling_person", e.target.value)}>
                  <option value=""></option>
                  {salesPersons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
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
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">
              Address
              <label
                style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400, textTransform: "none", letterSpacing: 0, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={sameAsBilling}
                  onChange={(e) => setSameAsBilling(e.target.checked)}
                />
                Shipping same as billing
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              <div>
                <div className="lbl" style={{ marginBottom: 8, fontWeight: 600 }}>Billing Address</div>
                {addressColumn("billing", false)}
              </div>
              <div style={{ opacity: sameAsBilling ? 0.55 : 1 }}>
                <div className="lbl" style={{ marginBottom: 8, fontWeight: 600 }}>Shipping Address</div>
                {addressColumn("shipping", sameAsBilling)}
              </div>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">* indicates a mandatory field</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={missing} onClick={submit}>
            <Icon name="check" size={13} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
