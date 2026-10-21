/* ============================================================
   Customer form page (CR-220) — PartyForm as a full page:
     /parties/new              create (next customer code prefilled)
     /parties/:id/edit         edit          (:id = customer code, as the detail)
     /parties/:id/clone        clone into a new customer (new code)
   CR-325/359: router state { zoho: ZohoPick } (from "From Zoho CRM" or a
   customer's "Map to Zoho CRM" / "Re-pull") prefills the form from the
   server-mapped record — the form IS the review step; Save goes through
   the normal path.
   ============================================================ */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { nextCustomerCode } from "@/lib/seq";
import { PartyForm } from "./PartyForm";
import { createCustomer, listCustomers, updateCustomer, type CustomerInput } from "./customersApi";
import { ZOHO } from "./zohoApi";
import type { ZohoPick } from "./ZohoSearchModal";

export function PartyFormPage() {
  const { id = "" } = useParams();
  const code = decodeURIComponent(id);
  const loc = useLocation();
  const clone = loc.pathname.endsWith("/clone");
  const zoho = (loc.state as { zoho?: ZohoPick } | null)?.zoho;
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
  const base: Partial<CustomerInput> = party
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
  // Zoho values win where Zoho has one; everything else keeps the current value.
  const initial: Partial<CustomerInput> = zoho ? { ...base, ...zoho.mapped } : base;

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
    <>
      {zoho && (
        <div className="df-banner" role="status">
          <span className="k">Filled from {ZOHO.label}</span>
          <span>
            {ZOHO.noun[0].toUpperCase() + ZOHO.noun.slice(1)} &ldquo;{zoho.name}&rdquo; — review the values below and Save. Nothing is written until you do.
          </span>
        </div>
      )}
      <PartyForm
        key={`${code}|${clone}|${zoho?.id ?? ""}`}
        paymentTerms={data.paymentTerms}
        salesPersons={data.salesPersons}
        isEdit={editing}
        initial={initial}
        onSave={onSave}
        onClose={() => navigate(code ? detailUrl(code) : "/parties")}
      />
    </>
  );
}
