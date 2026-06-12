/* ============================================================
   useMasters — live Customer + Design masters for any screen.

   Cache-first: paints the last customersApi/designsApi snapshots
   instantly, then revalidates (both lists are TTL-cached + deduped,
   so forms and detail pages mounting together cost one fetch each).
   Exposes both the full rows and mock-shaped views (Party/Design
   from data.ts) so screens written against the mocks migrate with
   a one-line import swap.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import type { Design, Party } from "@/data";
import {
  cachedCustomers,
  listCustomers,
  toParty,
  type CustomerRow,
  type PaymentTermOption,
} from "./customersApi";
import { cachedDesigns, listDesigns, type DesignRow } from "./designsApi";

export interface UseMasters {
  customers: CustomerRow[];
  parties: Party[]; // mock-shaped customers
  paymentTerms: PaymentTermOption[];
  designRows: DesignRow[];
  designs: Design[]; // mock-shaped designs (label strings)
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function toDesign(d: DesignRow): Design {
  return {
    name: d.designName,
    size: d.sizeLabel,
    finish: d.finishLabel,
    brand: d.brandLabel,
    category: d.categoryLabel,
  };
}

export function useMasters(): UseMasters {
  const [customers, setCustomers] = useState<CustomerRow[]>(() => cachedCustomers() ?? []);
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermOption[]>([]);
  const [designRows, setDesignRows] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [loading, setLoading] = useState(
    () => cachedCustomers() == null || cachedDesigns() == null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    void Promise.all([listCustomers(), listDesigns()]).then(([c, d]) => {
      setLoading(false);
      if (!c.ok || !d.ok) {
        setError(c.error || d.error || "Failed to load masters");
        return;
      }
      setError(null);
      setCustomers(c.customers);
      setPaymentTerms(c.paymentTerms);
      setDesignRows(d.designs);
    });
  };

  useEffect(load, []);

  const parties = useMemo(() => customers.filter((c) => c.active).map(toParty), [customers]);
  const designs = useMemo(() => designRows.map(toDesign), [designRows]);

  return { customers, parties, paymentTerms, designRows, designs, loading, error, reload: load };
}
