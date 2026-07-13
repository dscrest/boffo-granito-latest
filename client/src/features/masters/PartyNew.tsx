/* New Customer as a full page (route /parties/new) — Books-style: the
   PartyForm rendered in page mode (sections stacked, Save/Cancel at the
   bottom). Saving redirects to the created customer's detail page.
   Editing still happens in the modal (Parties / CustomerDetail). */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { SkeletonRows } from "@/ui/States";
import { nextCustomerCode } from "@/lib/seq";
import { PartyForm } from "./PartyForm";
import { createCustomer, listCustomers, type CustomerInput, type PaymentTermOption } from "./customersApi";

export function PartyNew() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermOption[]>([]);
  const [salesPersons, setSalesPersons] = useState<PaymentTermOption[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listCustomers().then((res) => {
      if (!res.ok) {
        toast.error(res.error || "Failed to load customers");
        navigate("/parties");
        return;
      }
      setCode(nextCustomerCode(res.customers.map((c) => c.code)));
      setPaymentTerms(res.paymentTerms);
      setSalesPersons(res.salesPersons);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = async (input: CustomerInput) => {
    if (busy) return;
    setBusy(true);
    const res = await createCustomer(input);
    setBusy(false);
    if (!res.ok) {
      // Keep the page open — leaving would discard everything typed.
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success("Customer saved");
    navigate(`/parties/${input.code}`);
  };

  if (!code) return <div style={{ padding: 24 }}><SkeletonRows rows={8} /></div>;

  return (
    <PartyForm
      asPage
      paymentTerms={paymentTerms}
      salesPersons={salesPersons}
      initial={{ code }}
      onSave={(c) => void onSave(c)}
      onClose={() => navigate("/parties")}
    />
  );
}
