/* ============================================================
   Customer form page (CR-220) — PartyForm as a full page:
     /parties/new              create (next customer code prefilled)
     /parties/:id/edit         edit          (:id = customer code, as the detail)
     /parties/:id/clone        clone into a new customer (new code)
   ============================================================ */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { nextCustomerCode } from "@/lib/seq";
import { PartyForm } from "./PartyForm";
import { createCustomer, listCustomers, updateCustomer, type CustomerInput } from "./customersApi";

export function PartyFormPage() {
  const { id = "" } = useParams();
  const code = decodeURIComponent(id);
  const clone = useLocation().pathname.endsWith("/clone");
  const editing = !!code && !clone;
  const navigate = useNavigate();

  const [data, setData] = useState<Awaited<ReturnType<typeof listCustomers>> | null>(null);
  useEffect(() => {
    void listCustomers().then(setData);
  }, []);

  if (!can("customers", editing ? "edit" : "create")) {
    return <EmptyState title="No access" hint="You don't have permission for this" />;
  }
  if (!data) return <div className="dim">Loading…</div>;
  const party = code ? data.customers.find((c) => c.code === code) : undefined;
  if (code && !party) return <EmptyState title="Customer not found" />;

  const nextCode = nextCustomerCode(data.customers.map((c) => c.code));
  const initial: Partial<CustomerInput> = party
    ? {
        // Clone never copies the identity: it takes the next code and starts Active.
        code: editing ? party.code : nextCode,
        name: party.name,
        country_code: party.countryCode,
        currency: party.currency,
        payment_term: party.paymentTermId,
        box_brand: party.boxBrandId,
        port_of_discharge: party.portOfDischarge,
        address: party.address,
        active: editing ? party.active : true,
        ...party.extras,
      }
    : { code: nextCode };

  const detailUrl = (c: string) => `/parties/${encodeURIComponent(c)}`;

  const onSave = async (input: CustomerInput) => {
    const res = editing ? await updateCustomer(party!.id, input) : await createCustomer(input);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success(editing ? "Customer updated" : "Customer created");
    // The detail URL is keyed by code — follow the saved code (it may have been edited).
    navigate(detailUrl(input.code.trim().toUpperCase()), { replace: true });
  };

  return (
    <PartyForm
      key={`${code}|${clone}`}
      paymentTerms={data.paymentTerms}
      salesPersons={data.salesPersons}
      isEdit={editing}
      initial={initial}
      onSave={onSave}
      onClose={() => navigate(code ? detailUrl(code) : "/parties")}
    />
  );
}
