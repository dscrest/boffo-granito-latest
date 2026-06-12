/* ============================================================
   Invoices — Phase 5 list + generate (one export invoice per
   container). Generation runs the data-ops saga, which numbers the
   invoice from TransactionSeries and totals the loaded batch lines.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { listContainers, type ContainerRow } from "@/features/masters/containersApi";
import {
  deleteInvoice,
  generateInvoice,
  listInvoices,
  type InvoiceRow,
} from "./invoicesApi";

export function Invoices() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGen, setShowGen] = useState(false);
  const [query, setQuery] = useState("");

  const load = () => {
    setLoading(true);
    void listInvoices().then((res) => {
      setLoading(false);
      if (!res.ok) {
        setError(res.error || "Failed to load invoices");
        return;
      }
      setError(null);
      setInvoices(res.invoices);
    });
  };
  useEffect(load, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(
      (r) =>
        r.invoiceNumber.toLowerCase().includes(q) ||
        r.containerNumber.toLowerCase().includes(q) ||
        r.orderNumber.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q),
    );
  }, [invoices, query]);

  const onPdf = async (row: InvoiceRow) => {
    try {
      const { downloadInvoicePdf } = await import("./invoicePdf");
      await downloadInvoicePdf(row);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF generation failed");
    }
  };

  const onGenerate = async (containerId: string) => {
    const res = await generateInvoice(containerId);
    if (!res.ok) {
      toast.error(res.error || "Invoice generation failed");
      return;
    }
    setShowGen(false);
    toast.success(`Invoice ${res.data?.invoice_number ?? ""} issued`);
    load();
  };

  const onDelete = async (row: InvoiceRow) => {
    if (!window.confirm(`Delete invoice ${row.invoiceNumber}? This cannot be undone.`)) return;
    const res = await deleteInvoice(row.id);
    if (!res.ok) {
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Invoice deleted");
    load();
  };

  const total = invoices.reduce((s, r) => s + r.totalAmount, 0);

  return (
    <div>
      {showGen && <GenerateDialog invoiced={invoices} onConfirm={onGenerate} onClose={() => setShowGen(false)} />}

      <div className="page-head">
        <div>
          <div className="title">Invoices</div>
          <div className="sub">
            {invoices.length} invoice{invoices.length === 1 ? "" : "s"} · {fmt(total)} total
          </div>
        </div>
        <div className="right" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            placeholder="Search invoice / container / order…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 240 }}
          />
          <button className="hbtn primary" onClick={() => setShowGen(true)}>
            <Icon name="plus" size={13} />
            Generate
          </button>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={load} />}

      {loading && invoices.length === 0 ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Container</th>
                  <th>Master Order</th>
                  <th>Customer</th>
                  <th className="num" style={{ textAlign: "right" }}>Amount</th>
                  <th>Status</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono" style={{ color: "var(--fg)" }}>{r.invoiceNumber}</td>
                    <td className="mono muted">{r.invoiceDate || "—"}</td>
                    <td className="mono">{r.containerNumber || "—"}</td>
                    <td className="mono muted">{r.orderNumber || "multi"}</td>
                    <td>{r.customerName || "—"}</td>
                    <td className="num mono">
                      {r.currency} {fmt(r.totalAmount)}
                    </td>
                    <td>
                      <span className="chip">{r.status}</span>
                    </td>
                    <td>
                      <button className="btn" onClick={() => void onPdf(r)} title="Download PDF">
                        <Icon name="download" size={12} />
                      </button>
                      <button className="btn" onClick={() => onDelete(r)} title="Delete invoice">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <EmptyState
                        icon="invoice"
                        title={query ? "No invoices match the search" : "No invoices yet"}
                        hint={query ? "Try a different term." : "Generate the first invoice from a loaded container."}
                      />
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

/* Pick a loaded, not-yet-invoiced container and run the invoice saga. */
function GenerateDialog({
  invoiced,
  onConfirm,
  onClose,
}: {
  invoiced: InvoiceRow[];
  onConfirm: (containerId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerId, setContainerId] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const invoicedIds = useMemo(() => new Set(invoiced.map((i) => i.containerId)), [invoiced]);

  useEffect(() => {
    void (async () => {
      const c = await listContainers();
      setLoading(false);
      if (!c.ok) {
        setError(c.error || "Failed to load containers");
        return;
      }
      // Containers with cargo on board (loading and beyond), not yet invoiced.
      setContainers(
        c.containers.filter(
          (x) => ["loading", "sealed", "dispatched"].includes(x.status) && !invoicedIds.has(x.id),
        ),
      );
    })();
  }, [invoicedIds]);

  const containerErr = showErrors && !containerId ? "Container is required" : null;

  const submit = async () => {
    if (!containerId) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      await onConfirm(containerId);
    } finally {
      setSaving(false);
    }
  };

  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="invoice" size={18} />
          </div>
          <div>
            <div className="ttl">Generate Invoice</div>
            <div className="sub2">One export invoice per container · numbered EX-NN/FY</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          {loading && <div className="muted" style={{ padding: 8 }}>Loading containers…</div>}
          {error && (
            <div style={{ borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "8px 12px", marginBottom: 10 }}>
              {error}
            </div>
          )}
          {!loading && !error && containers.length === 0 && (
            <div className="muted" style={{ padding: 8 }}>
              No uninvoiced loaded containers. Load a container first.
            </div>
          )}

          {!loading && containers.length > 0 && (
            <div className="form-section">
              <div className="form-grid">
                <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                  <span className="lbl">
                    Container<span className="req"> *</span>
                  </span>
                  <select className={containerErr ? "error" : ""} value={containerId} onChange={(e) => setContainerId(e.target.value)}>
                    <option value="">— select —</option>
                    {containers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.containerNumber} · {c.status}
                        {c.vesselName ? ` · ${c.vesselName}` : ""}
                      </option>
                    ))}
                  </select>
                  {containerErr && <span className="field-err">{containerErr}</span>}
                </label>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                The invoice totals every loaded batch line (boxes × order rate, less line discount).
              </div>
            </div>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && !containerId ? <span className="field-err">Select a container</span> : "* required"}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={saving} onClick={submit}>
            <Icon name="check" size={13} />
            {saving ? "Generating…" : "Generate invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}
