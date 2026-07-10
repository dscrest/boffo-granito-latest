/* ============================================================
   New Party (Customer) form — captures the Catalyst `Customer`
   schema and emits a CustomerInput for a real Data Store insert
   (Parties owns the createCustomer call). payment_term is a real
   ForeignKey → PaymentTerm, picked from live options. Layout
   mirrors Zoho Books "New Customer": customer type, contact person
   row, company + display name, auto customer number, then billing +
   shipping address columns with a "same as billing" copy toggle.
   The customer code is system-assigned (CUS-00001…, lib/seq) and
   read-only here. Reuses shared form/modal CSS (df-*, form-*).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { storedAuth } from "@/lib/auth";
import {
  composeAddress,
  emptyExtras,
  isoInfo,
  type CustomerExtras,
  type CustomerInput,
  type PaymentTermOption,
} from "./customersApi";

/* Full ISO 3166-1 alpha-2 list (Data Store stores ISO, not emoji);
   display name + flag are derived via isoInfo / Intl.DisplayNames. */
const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AR", "AT", "AU", "AW", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BM", "BN", "BO", "BR",
  "BS", "BT", "BW", "BY", "BZ", "CA", "CD", "CF", "CG", "CH", "CI", "CL", "CM",
  "CN", "CO", "CR", "CU", "CV", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "ER", "ES", "ET", "FI", "FJ", "FM", "FR", "GA", "GB", "GD",
  "GE", "GH", "GM", "GN", "GQ", "GR", "GT", "GW", "GY", "HK", "HN", "HR", "HT",
  "HU", "ID", "IE", "IL", "IN", "IQ", "IR", "IS", "IT", "JM", "JO", "JP", "KE",
  "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KZ", "LA", "LB", "LC", "LI",
  "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MG", "MH",
  "MK", "ML", "MM", "MN", "MR", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NE", "NG", "NI", "NL", "NO", "NP", "NR", "NZ", "OM", "PA", "PE", "PG", "PH",
  "PK", "PL", "PT", "PW", "PY", "QA", "RO", "RS", "RU", "RW", "SA", "SB", "SC",
  "SD", "SE", "SG", "SI", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV",
  "SY", "SZ", "TD", "TG", "TH", "TJ", "TL", "TM", "TN", "TO", "TR", "TT", "TV",
  "TW", "TZ", "UA", "UG", "US", "UY", "UZ", "VC", "VE", "VN", "VU", "WS", "YE",
  "ZA", "ZM", "ZW",
];
const COUNTRY_OPTIONS = COUNTRY_CODES.map((iso) => {
  const { country, flag } = isoInfo(iso);
  return { value: iso, label: `${flag} ${country}` };
}).sort((a, b) => a.label.localeCompare(b.label));

const CURRENCIES = ["EUR", "USD", "INR"];
const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Dr."];

const EMAIL_RE = /^\S+@\S+\.\S+$/;

/* Phone numbers are stored as one string ("+91 9876543210"); the UI
   splits them into a dial-code select + a digits-only input. */
const DIAL_CODES = ["+91", "+1", "+7", "+30", "+31", "+33", "+34", "+39", "+40", "+44", "+46", "+48", "+49", "+966", "+971"];
function splitPhone(s: string): { dial: string; num: string } {
  const m = /^(\+\d{1,4})\s*(.*)$/.exec(s.trim());
  return m ? { dial: m[1], num: m[2] } : { dial: "+91", num: s.trim() };
}
function joinPhone(p: { dial: string; num: string }): string {
  return p.num ? `${p.dial} ${p.num}` : "";
}

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
    if (!base.customer_type) base.customer_type = "business";
    // New customers default to the logged-in user as Sales Person.
    if (!isEdit && !base.handling_person) {
      const me = (storedAuth()?.user.email ?? "").toLowerCase();
      base.handling_person = salesPersons.find((s) => (s.email ?? "").toLowerCase() === me)?.id ?? "";
    }
    return base;
  });
  const [workPhone, setWorkPhone] = useState(() => splitPhone((initial?.contact_work_phone as string) ?? ""));
  const [mobile, setMobile] = useState(() => splitPhone((initial?.contact_mobile as string) ?? ""));
  // "Same as billing": on for a new customer; on edit, only when shipping
  // already mirrors billing (or is empty).
  const [sameAsBilling, setSameAsBilling] = useState(() =>
    ADDRESS_KEYS.every((k) => {
      const ship = (initial?.[`shipping_${k}`] as string) ?? "";
      return !ship || ship === ((initial?.[`billing_${k}`] as string) ?? "");
    }),
  );

  const set = (k: string, val: string | boolean) => setV((p) => ({ ...p, [k]: val }));
  // While "same as billing" is on, billing edits write their shipping twin
  // too, so shipping state is always real (no render-time mirroring).
  const setExtra = (k: keyof CustomerExtras, val: string) =>
    setX((p) => {
      const n = { ...p, [k]: val };
      if (sameAsBilling && k.startsWith("billing_")) {
        n[`shipping_${k.slice("billing_".length)}` as keyof CustomerExtras] = val;
      }
      return n;
    });
  const toggleSameAsBilling = (checked: boolean) => {
    setSameAsBilling(checked);
    if (checked) {
      setX((p) => {
        const n = { ...p };
        for (const k of ADDRESS_KEYS) n[`shipping_${k}`] = p[`billing_${k}`];
        return n;
      });
    }
  };

  const missing = !v.name.trim();
  const emailBad = !!x.contact_email.trim() && !EMAIL_RE.test(x.contact_email.trim());

  // Display Name suggestions à la Books: company + contact permutations.
  // The current value must always be an option or the Combobox shows blank.
  const contactFull = [x.contact_first_name, x.contact_last_name].map((s) => s.trim()).filter(Boolean).join(" ");
  const contactSaluted = [x.contact_salutation.trim(), contactFull].filter(Boolean).join(" ");
  const displayNameOptions = [
    ...new Set([x.company_name.trim(), contactFull, contactSaluted, v.name.trim()].filter(Boolean)),
  ].map((n) => ({ value: n, label: n }));

  const submit = () => {
    if (missing || emailBad) return;
    const extras = {
      ...x,
      contact_work_phone: joinPhone(workPhone),
      contact_mobile: joinPhone(mobile),
    };
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
        return (
          <label key={key} className="form-field">
            <span className="lbl">{ADDRESS_LABELS[k]}</span>
            <input
              value={x[key]}
              disabled={disabled}
              onChange={(e) => setExtra(key, e.target.value)}
              placeholder={ADDRESS_LABELS[k]}
            />
          </label>
        );
      })}
    </div>
  );

  const phoneField = (
    label: string,
    p: { dial: string; num: string },
    setP: (p: { dial: string; num: string }) => void,
  ) => (
    <label className="form-field">
      <span className="lbl">{label}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <select
          value={p.dial}
          onChange={(e) => setP({ ...p, dial: e.target.value })}
          style={{ flex: "0 0 86px", width: 86 }}
        >
          {DIAL_CODES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          value={p.num}
          inputMode="numeric"
          maxLength={10}
          onChange={(e) => setP({ ...p, num: e.target.value.replace(/\D/g, "").slice(0, 10) })}
          placeholder={label}
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
    </label>
  );

  return (
    <div className="modal-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="modal-panel card df-modal"
        style={{ maxWidth: 1000 }}
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
          <button className="hbtn primary" style={{ marginLeft: "auto" }} disabled={missing || emailBad} onClick={submit}>
            <Icon name="check" size={13} />
            Save
          </button>
          <button className="btn x" style={{ marginLeft: 0 }} onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Customer</div>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label className="form-field">
                <span className="lbl">Customer Type</span>
                <div style={{ display: "flex", gap: 18, alignItems: "center", minHeight: 34 }}>
                  {(["business", "individual"] as const).map((t) => (
                    <span
                      key={t}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                      onClick={() => setExtra("customer_type", t)}
                    >
                      <input
                        type="radio"
                        name="customer_type"
                        checked={x.customer_type === t}
                        onChange={() => setExtra("customer_type", t)}
                      />
                      {t === "business" ? "Business" : "Individual"}
                    </span>
                  ))}
                </div>
              </label>
              <label className="form-field">
                <span className="lbl">Customer Number</span>
                <input
                  value={v.code}
                  readOnly
                  tabIndex={-1}
                  placeholder="Auto-assigned (CUS-…)"
                  title="System-assigned customer number"
                />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Primary Contact</span>
                <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: 6 }}>
                  <select value={x.contact_salutation} onChange={(e) => setExtra("contact_salutation", e.target.value)}>
                    <option value="">Salutation</option>
                    {SALUTATIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <input
                    value={x.contact_first_name}
                    onChange={(e) => setExtra("contact_first_name", e.target.value)}
                    placeholder="First Name"
                  />
                  <input
                    value={x.contact_last_name}
                    onChange={(e) => setExtra("contact_last_name", e.target.value)}
                    placeholder="Last Name"
                  />
                </div>
              </label>
              <label className="form-field">
                <span className="lbl">Company Name</span>
                <input
                  value={x.company_name}
                  onChange={(e) => setExtra("company_name", e.target.value)}
                  placeholder="Company Name"
                />
              </label>
              <label className="form-field">
                <span className="lbl">
                  Display Name<span className="req"> *</span>
                </span>
                <Combobox
                  value={v.name}
                  options={displayNameOptions}
                  onChange={(val) => set("name", val)}
                  onCreate={(label) => set("name", label)}
                  placeholder="Select or type to add"
                  invalid={missing}
                />
              </label>
              <label className="form-field">
                <span className="lbl">Email Address</span>
                <input
                  type="email"
                  className={emailBad ? "error" : undefined}
                  value={x.contact_email}
                  onChange={(e) => setExtra("contact_email", e.target.value)}
                  placeholder="name@company.com"
                />
                {emailBad && (
                  <span style={{ fontSize: 11, color: "var(--c-red)" }}>Enter a valid email address</span>
                )}
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {phoneField("Work Phone", workPhone, setWorkPhone)}
                {phoneField("Mobile", mobile, setMobile)}
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Other Details</div>
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
                <span className="lbl">Sales Person</span>
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
              <div className="form-field">
                <span className="lbl">Country</span>
                <Combobox
                  value={country}
                  options={COUNTRY_OPTIONS}
                  onChange={setCountry}
                  placeholder="Select country"
                />
              </div>
              <label className="form-field">
                <span className="lbl">Port of Discharge</span>
                <input value={v.port_of_discharge} onChange={(e) => set("port_of_discharge", e.target.value)} placeholder="Gdańsk" />
              </label>
              <label className="form-field">
                <span className="lbl">Main Customer Name</span>
                <input
                  value={x.main_party_name}
                  onChange={(e) => setExtra("main_party_name", e.target.value)}
                  placeholder="Parent / group customer"
                />
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
                  onChange={(e) => toggleSameAsBilling(e.target.checked)}
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
          <span className="df-req-note">* Indicates a mandatory field</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={missing || emailBad} onClick={submit}>
            <Icon name="check" size={13} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
