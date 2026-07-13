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
  cachedPaymentTerms,
  listCustomers,
  toParty,
  type CustomerRow,
  type PaymentTermOption,
} from "./customersApi";
import { cachedDesigns, listDesigns, type DesignRow } from "./designsApi";
import { cachedSalesPersons, listSalesPersons, type SalesPersonRow } from "./salespersonApi";
import { cachedCurrencies, listCurrencies, type CurrencyRow } from "./currenciesApi";

export interface UseMasters {
  customers: CustomerRow[];
  parties: Party[]; // mock-shaped customers
  paymentTerms: PaymentTermOption[];
  designRows: DesignRow[];
  designs: Design[]; // mock-shaped designs (label strings)
  salesPersons: SalesPersonRow[];
  currencies: CurrencyRow[];
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
  const [paymentTerms, setPaymentTerms] = useState<PaymentTermOption[]>(() => cachedPaymentTerms());
  const [designRows, setDesignRows] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [salesPersons, setSalesPersons] = useState<SalesPersonRow[]>(() => cachedSalesPersons() ?? []);
  const [currencies, setCurrencies] = useState<CurrencyRow[]>(() => cachedCurrencies() ?? []);
  const [loading, setLoading] = useState(
    () => cachedCustomers() == null || cachedDesigns() == null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    // Each master paints as soon as ITS fetch lands — don't hold the
    // customer/payment-term pick lists hostage to the slower designs list.
    const pc = listCustomers().then((c) => {
      if (c.ok) {
        setCustomers(c.customers);
        setPaymentTerms(c.paymentTerms);
      }
      return c;
    });
    const pd = listDesigns().then((d) => {
      if (d.ok) setDesignRows(d.designs);
      return d;
    });
    const ps = listSalesPersons().then((s) => {
      if (s.ok) setSalesPersons(s.salesPersons);
      return s;
    });
    const pcur = listCurrencies().then((cur) => {
      if (cur.ok) setCurrencies(cur.currencies);
      return cur;
    });
    void Promise.all([pc, pd, ps, pcur]).then(([c, d]) => {
      setLoading(false);
      setError(c.ok && d.ok ? null : c.error || d.error || "Failed to load masters");
    });
  };

  useEffect(load, []);

  const parties = useMemo(() => customers.filter((c) => c.active).map(toParty), [customers]);
  const designs = useMemo(() => designRows.map(toDesign), [designRows]);

  return { customers, parties, paymentTerms, designRows, designs, salesPersons, currencies, loading, error, reload: load };
}
