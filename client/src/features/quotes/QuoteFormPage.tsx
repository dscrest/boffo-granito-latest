/* ============================================================
   Quote form page (CR-219) — the QuoteForm as a full page, one
   component for every mode:
     /quotes/new                    create (?customer=<name> prefills)
     /quotes/:id/edit               edit
     /quotes/:id/clone              clone into a new Draft quote
   Mirror of OrderFormPage: load, persist, land on the saved quote.
   ============================================================ */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import type { Quote } from "@/data";
import { QuoteForm } from "./QuoteForm";
import { quoteToInput } from "./QuotesTable";
import { cachedQuotes, createQuote, invalidateQuotes, listQuotes, updateQuoteWithItems } from "./quotesApi";

export function QuoteFormPage() {
  const { id = "" } = useParams();
  const quoteId = decodeURIComponent(id);
  const [params] = useSearchParams();
  const clone = useLocation().pathname.endsWith("/clone");
  const editing = !!quoteId && !clone;
  const navigate = useNavigate();

  // Every mode needs the list: edit/clone for the record, create/clone for the next number.
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void listQuotes().then((r) => { if (r.ok) setQuotes(r.quotes); setLoading(false); });
  }, []);
  const quote = quoteId ? quotes.find((x) => x.id === quoteId) : undefined;

  const detailUrl = (rowid: string) => `/quotes/${encodeURIComponent(rowid)}`;

  if (!can("quotes", editing ? "edit" : "create")) {
    return <EmptyState title="No access" hint="You don't have permission for this" />;
  }
  // Wait for the fresh list — the form seeds its state once, so a stale cache must never be what gets edited.
  if (loading) return <div className="dim">Loading…</div>;
  if (quoteId && !quote) return <EmptyState title="Quote not found" />;

  const onSave = async (q: Quote) => {
    const res = editing ? await updateQuoteWithItems(q.id, quoteToInput(q)) : await createQuote(quoteToInput(q));
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success(editing ? `Quote ${q.quoteNo} updated` : `Quote ${q.quoteNo} created`);
    invalidateQuotes();
    // Land on the saved record; replace so Back never returns to a spent form.
    navigate(editing ? detailUrl(quoteId) : res.rowid ? detailUrl(res.rowid) : "/quotes", { replace: true });
  };

  return (
    <QuoteForm
      key={`${quoteId}|${clone}`}
      nextSeq={editing ? 0 : quotes.length + 1}
      initial={quote}
      clone={clone}
      presetCustomer={params.get("customer") || undefined}
      onSave={onSave}
      onClose={() => navigate(quoteId ? detailUrl(quoteId) : "/quotes")}
    />
  );
}
