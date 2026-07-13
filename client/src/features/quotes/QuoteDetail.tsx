/* ============================================================
   Quote detail — same split view as the Item (Design) detail page.

   Route: /quotes/:id. Left: resizable, searchable list of quotes.
   Right: header card with the quote number in big type + status chip,
   status-transition / Edit buttons, a More menu (Convert / Print /
   PDF / Share / Delete) and ✕ close. Tabs: Details (header fields
   + line items, with a Details|PDF preview toggle), Orders (Master
   Orders converted from this quote) and Activity. The shared
   ColumnPicker show/hides and reorders Details rows, persisted
   per-browser in localStorage.

   Reuses the existing QuoteForm / QuotePrint / ConvertDialog modals and
   the quotesApi cache — no new backend.
   ============================================================ */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { canDelete } from "@/lib/auth";
import { MoreMenu } from "@/features/common/DetailBits";
import { ActivityLog } from "@/features/common/RecordDetail";
import { fmt, fmtDateTime } from "@/lib/format";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { docTotals, lineTotals, type Quote, type QuoteStatus } from "@/data";
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
  ensureShareToken,
  invalidateQuotes,
  listQuotes,
  updateQuote,
  updateQuoteWithItems,
} from "./quotesApi";

/* Details rows, in display order. `key` is the localStorage toggle id.
   Extends ColumnDef so the shared ColumnPicker (same icon-only control as
   the list grids) drives show/hide + reorder. */
type FieldDef = ColumnDef<Quote> & { value: (q: Quote) => string; wide?: boolean };
const FIELDS: FieldDef[] = [
  { key: "quoteNo", label: "Quote Number", value: (q) => q.quoteNo },
  { key: "status", label: "Status", value: (q) => STATUS_LABEL[q.status] },
  { key: "quoteDate", label: "Quote Date", value: (q) => q.quoteDate || "—" },
  { key: "expiryDate", label: "Expiry Date", value: (q) => q.expiryDate || "—" },
  // #14: Reference No. removed from quotes (SO-only field).
  { key: "salesperson", label: "Salesperson", value: (q) => q.salesperson || "—" },
  { key: "paymentTerm", label: "Payment Term", value: (q) => q.paymentTerm || "—" },
  { key: "portOfDischarge", label: "Port of Discharge", value: (q) => q.portOfDischarge || "—" },
  { key: "currency", label: "Currency", value: (q) => q.currency },
  { key: "soNumber", label: "Master Order", value: (q) => q.soNumber || "—" },
  { key: "customer", label: "Customer", value: (q) => q.customer || "—" },
  { key: "created", label: "Created", value: (q) => fmtDateTime(q.createdTime) },
  { key: "modified", label: "Modified", value: (q) => fmtDateTime(q.modifiedTime) },
  { key: "address", label: "Billing Address", value: (q) => q.address || "—", wide: true },
  { key: "shippingAddress", label: "Shipping Address", value: (q) => q.shippingAddress || "—", wide: true },
  { key: "remarks", label: "Remarks", value: (q) => q.remarks || "—", wide: true },
  { key: "customerNotes", label: "Customer Notes", value: (q) => q.customerNotes || "—", wide: true },
  { key: "terms", label: "Terms & Conditions", value: (q) => q.terms || "—", wide: true },
];

/* #19: these render in a card BELOW the line-item table, not in the header grid. */
const NOTE_KEYS = new Set(["remarks", "customerNotes", "terms"]);

export function QuoteDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { designs } = useMasters();

  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [loading, setLoading] = useState(() => cachedQuotes() == null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"details" | "orders" | "activity">("details");
  // Details | PDF segmented toggle (Books-style inline document preview).
  const [view, setView] = useState<"details" | "pdf">("details");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  const [listQ, setListQ] = useState("");

  const [editing, setEditing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [converting, setConverting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  /* Same show/hide + reorder control as the list grids; legacy hidden-only
     arrays stored under this key migrate inside useColumns. */
  const fields = useColumns("quoteDetailFields", FIELDS);

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

  const onShare = async () => {
    if (!quote) return;
    setBusy("share");
    const res = await ensureShareToken(quote);
    setBusy(null);
    if (!res.ok || !res.token) {
      toast.error(res.error || "Could not create share link");
      return;
    }
    const url = `${location.origin}${location.pathname}#/share/quote/${res.token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied to clipboard");
    } catch {
      toast.info(url); // clipboard blocked — surface the URL instead
    }
    void load();
  };

  // #16: Zoho-Books-style status transitions from the top bar (no form open).
  const changeStatus = async (next: QuoteStatus, label: string) => {
    if (!quote) return;
    setBusy(`${label}…`);
    try {
      await updateQuote(quote.id, { status: next });
      await load();
      toast.success(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status update failed");
    } finally {
      setBusy(null);
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

  // PDF preview: pregenerate the real pdfmake document (same as Download
  // PDF) in the background as soon as a quote is selected, so the PDF
  // toggle shows an already-built blob instantly. Keyed by id+modifiedTime:
  // edits regenerate, toggling Details|PDF does not. The short debounce
  // keeps quick surfing through the left list from churning out PDFs; the
  // previous blob is revoked on replace, so at most one is ever live.
  useEffect(() => {
    if (!quote) return;
    let alive = true;
    setPdfErr(null);
    setPdfUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const [{ buildQuoteDoc }, { pdfBlobUrl }] = await Promise.all([
            import("./quotePdf"),
            import("@/lib/pdf"),
          ]);
          const url = await pdfBlobUrl(await buildQuoteDoc(quote));
          if (alive) setPdfUrl(url);
          else URL.revokeObjectURL(url);
        } catch (e) {
          if (alive) setPdfErr(e instanceof Error ? e.message : "PDF preview failed");
        }
      })();
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id, quote?.modifiedTime]);

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
    if (!(await confirmDialog({ message: `Are you sure you want to delete quote ${quote.quoteNo}? This cannot be undone.`, danger: true }))) return;
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

  const needle = listQ.trim().toLowerCase();
  const listed = needle
    ? quotes.filter((x) => `${x.quoteNo} ${x.customer}`.toLowerCase().includes(needle))
    : quotes;

  const moreItems = [
    ...(canConvert ? [{ label: "Convert to Master Order", onClick: () => setConverting(true) }] : []),
    { label: "Print Quote", onClick: () => setPrinting(true) },
    { label: "Download PDF", onClick: () => void onPdf() },
    { label: "Copy Share Link", onClick: () => void onShare() },
    ...(canDelete() ? [{ label: "Delete", danger: true, onClick: () => void onDelete() }] : []),
  ];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
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

      {/* Quote list — fixed viewport height with its OWN scroll, sticky while
          the detail scrolls. Drag the bottom-right corner to resize the width. */}
      <div
        className="card"
        style={{
          width: 300,
          minWidth: 220,
          maxWidth: 420,
          flexShrink: 0,
          padding: 0,
          resize: "horizontal",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - var(--header-h) - 46px)",
          position: "sticky",
          top: 0,
        }}
      >
        <div className="lp-search">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search quotes…" value={listQ} onChange={(e) => setListQ(e.target.value)} />
        </div>
        <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
          {listed.map((x) => {
            const cur = x.id === id;
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => navigate(`/quotes/${x.id}`)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 12px",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  background: cur ? "var(--accent-soft)" : "transparent",
                  cursor: "pointer",
                  font: "inherit",
                }}
                title={x.quoteNo}
              >
                <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {x.quoteNo}
                </div>
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                  {[x.customer, STATUS_LABEL[x.status]].filter(Boolean).join("  ·  ")}
                </div>
              </button>
            );
          })}
          {listed.length === 0 && <div className="dim" style={{ padding: 12 }}>No matching quotes</div>}
        </div>
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
      {/* Header inside a card so it top-aligns with the quote list (Zoho-style). */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div
            className="title"
            style={{ flex: 1, minWidth: 0, fontSize: 26, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}
            title={quote.quoteNo}
          >
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{quote.quoteNo}</span>
            <span className={`chip qstatus ${STATUS_CHIP[quote.status]}`}>{STATUS_LABEL[quote.status]}</span>
          </div>
          {/* #16: status transitions (Zoho Books style). */}
          {quote.status === "Draft" && (
            <button className="hbtn primary" disabled={!!busy} onClick={() => void changeStatus("Sent", "Marked as sent")} title="Mark as sent">
              <Icon name="check" size={13} /> Mark As Sent
            </button>
          )}
          {quote.status === "Sent" && (
            <>
              <button className="hbtn primary" disabled={!!busy} onClick={() => void changeStatus("Accepted", "Marked accepted")} title="Mark accepted">
                <Icon name="check" size={13} /> Accept
              </button>
              <button className="hbtn" disabled={!!busy} onClick={() => void changeStatus("Rejected", "Marked rejected")} title="Mark rejected" style={{ color: "var(--c-red)" }}>
                <Icon name="x" size={13} /> Reject
              </button>
            </>
          )}
          <button className="hbtn" disabled={!!busy} onClick={() => setEditing(true)} title="Edit quote">
            <Icon name="edit" size={13} /> Edit
          </button>
          <MoreMenu items={moreItems} />
          <button className="btn x" onClick={() => navigate("/quotes")} title="Close">
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
          <span
            style={{ color: "var(--accent)", cursor: "pointer" }}
            title="Open customer"
            onClick={() => navigate(`/parties/${encodeURIComponent(quote.partyCode)}`)}
          >
            {quote.customer}
          </span>
          {" "}· Total {quote.currency} {fmt(totals.net)}
          {busy && (
            <>
              {" · "}
              <span className="dim">{busy}</span>
            </>
          )}
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
          className={`tabish ${tab === "orders" ? "active" : ""}`}
          onClick={() => setTab("orders")}
          style={tabStyle(tab === "orders")}
        >
          Orders{quote.sos && quote.sos.length > 0 ? ` (${quote.sos.length})` : ""}
        </button>
        <button
          className={`tabish ${tab === "activity" ? "active" : ""}`}
          onClick={() => setTab("activity")}
          style={tabStyle(tab === "activity")}
        >
          Activity
        </button>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {tab === "details" && (
            <>
              {/* Details | PDF segmented toggle (Books-style). */}
              <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                <button type="button" style={segStyle(view === "details")} onClick={() => setView("details")}>
                  Details
                </button>
                <button type="button" style={segStyle(view === "pdf")} onClick={() => setView("pdf")}>
                  PDF
                </button>
              </div>
              {view === "details" && (
                <ColumnPicker columns={fields.ordered} hidden={fields.hidden} onToggle={fields.toggle} onMove={fields.move} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Details tab — PDF view: the real document, inline. */}
      {tab === "details" && view === "pdf" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {pdfUrl ? (
            <iframe
              src={pdfUrl}
              title={`${quote.quoteNo} PDF`}
              style={{ width: "100%", height: "calc(100vh - var(--header-h) - 220px)", minHeight: 480, border: 0, display: "block" }}
            />
          ) : pdfErr ? (
            <div style={{ padding: 24, color: "var(--c-red)" }}>{pdfErr}</div>
          ) : (
            <div className="muted mono" style={{ padding: 24 }}>Rendering PDF…</div>
          )}
        </div>
      )}

      {/* Details tab */}
      {tab === "details" && view === "details" && (
        <>
          <div className="card" style={{ padding: 18, marginBottom: 12 }}>
            <div className="form-grid">
              {fields.ordered.filter((f) => !fields.hidden.has(f.key) && !NOTE_KEYS.has(f.key)).map((f) => (
                <div className="form-field" key={f.key} style={f.wide ? { gridColumn: "1 / -1" } : undefined}>
                  <span className="lbl">{f.label}</span>
                  {f.key === "soNumber" && quote.soNumber && quote.soId ? (
                    <button
                      className="linkish"
                      style={{ color: "var(--accent)", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", textAlign: "left" }}
                      onClick={() => navigate(`/orders/${quote.soId}`)}
                      title="Open Master Order"
                    >
                      {quote.soNumber}
                    </button>
                  ) : (
                    <span style={{ color: "var(--fg)" }}>{f.value(quote)}</span>
                  )}
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
                        <td>
                          {l.item}
                          {l.description && <div className="dim" style={{ fontSize: "var(--t-sm)" }}>{l.description}</div>}
                        </td>
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

          {/* #19: Remarks / Customer Notes / Terms below the item table. */}
          {FIELDS.some((f) => NOTE_KEYS.has(f.key) && !fields.hidden.has(f.key)) && (
            <div className="card" style={{ padding: 18, marginTop: 12 }}>
              <div className="form-grid">
                {fields.ordered.filter((f) => NOTE_KEYS.has(f.key) && !fields.hidden.has(f.key)).map((f) => (
                  <div className="form-field" key={f.key} style={{ gridColumn: "1 / -1" }}>
                    <span className="lbl">{f.label}</span>
                    <span style={{ color: "var(--fg)", whiteSpace: "pre-wrap" }}>{f.value(quote)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Orders tab — Master Orders converted from this quote. */}
      {tab === "orders" && (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Order No</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="num" style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(quote.sos ?? []).map((so) => (
                  <tr
                    key={so.id}
                    tabIndex={0}
                    onClick={() => navigate(`/orders/${so.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/orders/${so.id}`);
                    }}
                    style={{ cursor: "pointer" }}
                    title="Open Master Order"
                  >
                    <td className="mono" style={{ color: "var(--accent)" }}>{so.number || "—"}</td>
                    <td className="mono muted">{so.date || "—"}</td>
                    <td>{so.status || "—"}</td>
                    <td className="num mono">{quote.currency} {fmt(so.total)}</td>
                  </tr>
                ))}
                {(quote.sos ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 18 }}>
                      Not converted yet — no Master Orders for this quote.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Activity tab — shared OperationLog view (same as the masters). */}
      {tab === "activity" && <ActivityLog table="Quote" entityId={id} />}
      </div>
    </div>
  );
}

function segStyle(active: boolean): CSSProperties {
  return {
    background: active ? "var(--accent-soft)" : "transparent",
    color: active ? "var(--fg)" : "var(--muted)",
    fontWeight: active ? 600 : 400,
    border: 0,
    padding: "4px 12px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "var(--t-sm)",
  };
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
