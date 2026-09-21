/* Billing | Shipping address pickers, side by side (CR-221) — shared by the
   Quote and Sales Order forms. Options are the picked customer's addresses of
   each kind (primary column set + same-typed extras from the customer detail);
   free text is still allowed for one-off addresses. */
import { Combobox } from "@/ui/Combobox";
import { composeAddress, composeExtraAddress, parseAddresses, type CustomerRow } from "@/features/masters/customersApi";

type Kind = "billing" | "shipping";

function customerAddresses(cust: CustomerRow | undefined, kind: Kind): string[] {
  if (!cust) return [];
  const primary =
    kind === "billing" ? composeAddress(cust.extras, "billing") || cust.address : composeAddress(cust.extras, "shipping");
  const extras = parseAddresses(cust.extras.additional_addresses)
    .filter((a) => a.type === kind)
    .map(composeExtraAddress);
  return [...new Set([primary, ...extras].filter(Boolean))];
}

/** The addresses a transaction inherits when a customer is picked (shipping falls back to billing). */
export function defaultAddresses(cust: CustomerRow): { billing: string; shipping: string } {
  const billing = composeAddress(cust.extras, "billing") || cust.address || "";
  return { billing, shipping: composeAddress(cust.extras, "shipping") || billing };
}

export function AddressPair({
  customer,
  billing,
  shipping,
  onChange,
}: {
  customer: CustomerRow | undefined;
  billing: string;
  shipping: string;
  onChange: (kind: Kind, value: string) => void;
}) {
  // The current value stays selectable even when it's not on the master (legacy
  // records / free text) — a Combobox renders blank when its value is missing.
  const options = (current: string, kind: Kind) => {
    const all = customerAddresses(customer, kind);
    if (current && !all.includes(current)) all.unshift(current);
    return all.map((a) => ({ value: a, label: a }));
  };
  const field = (kind: Kind, label: string, value: string) => (
    <div className="form-field">
      <span className="lbl">{label}</span>
      <Combobox
        value={value}
        options={options(value, kind)}
        onChange={(v) => onChange(kind, v)}
        onCreate={(v) => onChange(kind, v)}
        placeholder={`Select or type the ${kind} address…`}
      />
    </div>
  );
  return (
    <div className="addr-pair">
      {field("billing", "Billing Address", billing)}
      {field("shipping", "Shipping Address", shipping)}
    </div>
  );
}
