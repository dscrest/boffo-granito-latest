/* ============================================================
   Quote detail — read-only record page (Books-parity).

   Route: /quotes/:id. Replaces the old "click row → edit modal" flow.
   Top toolbar carries the actions that used to be inline in the table
   rows (Edit / Convert to Sales Order / Print / Delete). Two tabs:
   Details (header fields + line items) and Activity Log (this quote's
   OperationLog entries). A Fields menu show/hides Details rows,
   persisted per-browser in localStorage.

   Reuses the existing QuoteForm / QuotePrint / ConvertDialog modals and
   the quotesApi cache — no new backend.
   ============================================================ */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { fmt } from "@/lib/format";
import { list, type DSRow } from "@/lib/dataOps";
import { docTotals, lineTotals, type Quote } from "@/data";
import { useMasters } from "@/features/masters/useMasters";
import { QuoteForm } from "./QuoteForm";
import { QuotePrint } from "./QuotePrint";
import { ConvertDialog } from "./ConvertDialog";
import {
  STATUS_CHIP,
  STATUS_LABEL,
  convertible,
  quoteToInput,
} from "./QuotesTable";
import {
  cachedQuotes,
  deleteQuote,
  invalidateQuotes,
  listQuotes,
  updateQuoteWithItems,
} from "./quotesApi";

const str = (v: unknown) => (v == null ? "" : String(v));

/* Details rows, in display order. `key` is the localStorage toggle id. */
type FieldDef = { key: string; label: string; value: (q: Quote) => string; wide?: boolean };
const FIELDS: FieldDef[] = [
  { key: "quoteNo", label: "Quote Number", value: (q) => q.quoteNo },
  { key: "status", label: "Status", value: (q) => STATUS_LABEL[q.status] },
  { key: "quoteDate", label: "Quote Date", value: (q) => q.quoteDate || "—" },
  { key: "expiryDate", label: "Expiry Date", value: (q) => q.expiryDate || "—" },
  { key: "referenceNo", label: "Reference No.", value: (q) => q.referenceNo || "—" },
  { key: "salesperson", label: "Salesperson", value: (q) => q.salesperson || "—" },
  { key: "paymentTerm", label: "Payment Term", value: (q) => q.paymentTerm || "—" },
  { key: "portOfDischarge", label: "Port of Discharge", value: (q) => q.portOfDischarge || "—" },
  { key: "currency", label: "Currency", value: (q) => q.currency },
  { key: "soNumber", label: "Master Order", value: (q) => q.soNumber || "—" },
  { key: "customer", label: "Customer", value: (q) => q.customer || "—" },
  { key: "address", label: "Billing Address", value: (q) => q.address || "—", wide: true },
  { key: "remarks", label: "Remarks", value: (q) => q.remarks || "—", wide: true },
  { key: "customerNotes", label: "Customer Notes", value: (q) => q.customerNotes || "—", wide: true },
  { key: "terms", label: "Terms & Conditions", value: (q) => q.terms || "—", wide: true },
];

const HIDDEN_KEY = "quoteDetailFields"; // stores JSON array of hidden field keys

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function QuoteDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { designs } = useMasters();

  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [loading, setLoading] = useState(() => cachedQuotes() == null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"details" | "activity">("details");

  const [editing, setEditing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [converting, setConverting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [fieldsOpen, setFieldsOpen] = useState(false);

  const [acts, setActs] = useState<DSRow[]>([]);
  const [actsLoading, setActsLoading] = useState(false);

  const quote = useMemo(() => quotes.find((q) => q.id === id) ?? null, [quotes, id]);

  const onPdf = async () => {
    if (!quote) return;
    try {
      const { downloadQuotePdf } = await import("./quotePdf");
      await downloadQuotePdf(quote);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF generation failed");
    }
  };

  const load = async () => {
    setLoading(true);
    const res = await listQuotes();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load quote");
      return;
    }
    setError(null);
    setQuotes(res.quotes);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Activity log: OperationLog rows for this quote, loaded when tab opens.
  useEffect(() => {
    if (tab !== "activity") return;
    let alive = true;
    setActsLoading(true);
    void list("OperationLog", { order: "ROWID desc", limit: 200 }).then((res) => {
      if (!alive) return;
      setActsLoading(false);
      const rows = (res.rows || []).filter((r) => str(r.entity_rowid) === id);
      setActs(rows);
    });
    return () => {
      alive = false;
    };
  }, [tab, id]);

  const persistHidden = (next: Set<string>) => {
    setHidden(next);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
  };
  const toggleField = (key: string) => {
    const next = new Set(hidden);
    next.has(key) ? next.delete(key) : next.add(key);
    persistHidden(next);
  };

  const onEditSave = async (q: Quote) => {
    setEditing(false);
    setBusy(`Updating ${q.quoteNo}…`);
    const res = await updateQuoteWithItems(q.id, quoteToInput(q));
    if (!res.ok) {
      setBusy(null);
      setError(res.error || "Update failed");
      toast.error(res.error || "Update failed");
      return;
    }
    setBusy(null);
    toast.success(`Quote ${q.quoteNo} updated`);
    invalidateQuotes();
    await load();
  };

  const onDelete = async () => {
    if (!quote) return;
    if (!window.confirm(`Delete quote ${quote.quoteNo}? This cannot be undone.`)) return;
    setBusy(`Deleting ${quote.quoteNo}…`);
    const res = await deleteQuote(quote.id);
    if (!res.ok) {
      setBusy(null);
      setError(res.error || "Delete failed");
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success(`Quote ${quote.quoteNo} deleted`);
    invalidateQuotes();
    navigate("/quotes");
  };

  if (loading && !quote) {
    return <div className="muted mono" style={{ padding: 24 }}>Loading quote…</div>;
  }
  if (!quote) {
    return (
      <div>
        <div className="page-head">
          <div>
            <div className="title">Quote not found</div>
            <div className="sub">No quote matches this link.</div>
          </div>
          <div className="right">
            <button className="hbtn" onClick={() => navigate("/quotes")}>
              <Icon name="chev-l" size={13} /> Back to Quotes
            </button>
          </div>
        </div>
      </div>
    );
  }

  const totals = docTotals(quote.lines, {
    docDiscount: quote.docDiscount,
    adjustment: quote.adjustment,
    taxType: quote.taxType,
    taxPct: quote.taxPct,
  });
  const canConvert = convertible(quote.status);

  return (
    <div>
      {editing && (
        <QuoteForm nextSeq={0} initial={quote} onSave={onEditSave} onClose={() => setEditing(false)} />
      )}
      {printing && <QuotePrint quote={quote} onClose={() => setPrinting(false)} />}
      {converting && (
        <ConvertDialog
          quote={quote}
          onClose={() => setConverting(false)}
          onConverted={() => {
            setConverting(false);
            invalidateQuotes();
          }}
        />
      )}

      {/* Toolbar */}
      <div className="page-head">
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <button className="hbtn" onClick={() => navigate("/quotes")} title="Back to Quotes">
            <Icon name="chev-l" size={13} />
          </button>
          <div>
            <div className="title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {quote.quoteNo}
              <span className={`chip qstatus ${STATUS_CHIP[quote.status]}`}>{STATUS_LABEL[quote.status]}</span>
            </div>
            <div className="sub">
              {quote.customer} · Total {quote.currency} {fmt(totals.net)}
              {busy && (
                <>
                  {" · "}
                  <span className="dim">{busy}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="right">
          <button className="hbtn" disabled={!!busy} onClick={() => setEditing(true)} title="Edit quote">
            <Icon name="edit" size={13} /> Edit
          </button>
          <button
            className="hbtn"
            disabled={!canConvert || !!busy}
            onClick={() => setConverting(true)}
            title={canConvert ? "Convert to Master Order" : "Already converted"}
          >
            <Icon name="arrow-r" size={13} /> Convert to Master Order
          </button>
          <button className="hbtn" onClick={() => setPrinting(true)} title="Print / PDF">
            <Icon name="printer" size={13} /> Print Quote
          </button>
          <button className="hbtn" onClick={() => void onPdf()} title="Download PDF">
            <Icon name="download" size={13} /> PDF
          </button>
          <button className="hbtn" disabled={!!busy} onClick={() => void onDelete()} title="Delete quote" style={{ color: "var(--c-red)" }}>
            <Icon name="x" size={13} /> Delete
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "10px 14px" }}>
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="row" style={{ gap: 4, marginBottom: 12, borderBottom: "1px solid var(--border)" }}>
        <button
          className={`tabish ${tab === "details" ? "active" : ""}`}
          onClick={() => setTab("details")}
          style={tabStyle(tab === "details")}
        >
          Details
        </button>
        <button
          className={`tabish ${tab === "activity" ? "active" : ""}`}
          onClick={() => setTab("activity")}
          style={tabStyle(tab === "activity")}
        >
          Activity Log
        </button>
        <div style={{ marginLeft: "auto", position: "relative" }}>
          {tab === "details" && (
            <>
              <button className="hbtn" onClick={() => setFieldsOpen((v) => !v)} title="Show / hide fields">
                <Icon name="settings" size={13} /> Fields
              </button>
              {fieldsOpen && (
                <div
                  className="card"
                  style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 30, padding: 8, width: 220, maxHeight: 320, overflow: "auto" }}
                >
                  {FIELDS.map((f) => (
                    <label key={f.key} className="row" style={{ gap: 8, padding: "4px 6px", cursor: "pointer" }}>
                      <input type="checkbox" checked={!hidden.has(f.key)} onChange={() => toggleField(f.key)} />
                      <span>{f.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Details tab */}
      {tab === "details" && (
        <>
          <div className="card" style={{ padding: 18, marginBottom: 12 }}>
            <div className="form-grid">
              {FIELDS.filter((f) => !hidden.has(f.key)).map((f) => (
                <div className="form-field" key={f.key} style={f.wide ? { gridColumn: "1 / -1" } : undefined}>
                  <span className="lbl">{f.label}</span>
                  <span style={{ color: "var(--fg)" }}>{f.value(quote)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div style={{ overflow: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>#</th>
                    <th>Item</th>
                    <th>Spec</th>
                    <th className="num" style={{ textAlign: "right" }}>Qty</th>
                    <th className="num" style={{ textAlign: "right" }}>Rate</th>
                    <th className="num" style={{ textAlign: "right" }}>Disc %</th>
                    <th className="num" style={{ textAlign: "right" }}>Sub Total</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.lines.map((l, i) => {
                    const d = designs.find((x) => x.name === l.item);
                    const t = lineTotals(l);
                    return (
                      <tr key={i}>
                        <td className="mono muted">{i + 1}</td>
                        <td>{l.item}</td>
                        <td className="dim">{d ? `${d.size} · ${d.finish}` : "—"}</td>
                        <td className="num mono">{fmt(l.qty)}</td>
                        <td className="num mono">{l.rate.toFixed(2)}</td>
                        <td className="num mono">{l.discount || 0}</td>
                        <td className="num mono">{fmt(t.subTotal)}</td>
                      </tr>
                    );
                  })}
                  {quote.lines.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 18 }}>
                        No line items.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 24, padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
              <span className="dim">Net Total</span>
              <span className="mono" style={{ fontSize: "var(--t-lg)", color: "var(--fg)" }}>
                {quote.currency} {fmt(totals.net)}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Activity Log tab */}
      {tab === "activity" && (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Operation</th>
                  <th>Status</th>
                  <th>Actor</th>
                  <th>Detail / Error</th>
                </tr>
              </thead>
              <tbody>
                {acts.map((r) => {
                  const ok = str(r.status) === "success";
                  return (
                    <tr key={String(r.ROWID)}>
                      <td className="mono muted">{str(r.occurred_at) || str(r.CREATEDTIME)}</td>
                      <td>{str(r.operation)}</td>
                      <td>
                        <span className={`chip qstatus ${ok ? "q-converted" : "q-rejected"}`}>{str(r.status) || "—"}</span>
                      </td>
                      <td className="muted">{str(r.actor)}</td>
                      <td className="muted" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ok ? str(r.payload_summary) : <span style={{ color: "var(--c-red)" }}>{str(r.error_text)}</span>}
                      </td>
                    </tr>
                  );
                })}
                {!actsLoading && acts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 18 }}>
                      No activity recorded for this quote yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function tabStyle(active: boolean): CSSProperties {
  return {
    background: "none",
    border: 0,
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    color: active ? "var(--fg)" : "var(--muted)",
    fontWeight: active ? 600 : 400,
    padding: "8px 12px",
    cursor: "pointer",
    font: "inherit",
  };
}
