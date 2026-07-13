/* ============================================================
   Currencies (Settings) — master of the currencies offered on
   customers / quotations / orders, with the exchange rate to the
   base currency (INR per 1 unit; INR = 1). Rates auto-refresh
   daily via cron (frankfurter.dev); editing a rate here marks the
   row manual-override so the cron leaves it alone. Follows the
   master-page UI convention: row-click edits.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { fmtDateTime } from "@/lib/format";
import {
  listCurrencies,
  createCurrency,
  updateCurrency,
  deleteCurrency,
  refreshRatesNow,
  type CurrencyRow,
} from "@/features/masters/currenciesApi";

interface Draft {
  rowid: string | null; // null = new
  code: string;
  name: string;
  symbol: string;
  rate: string; // input text; parsed on save
  manualOverride: boolean;
}

const EMPTY: Draft = { rowid: null, code: "", name: "", symbol: "", rate: "", manualOverride: false };

const dash = <span className="dim">—</span>;

export function CurrenciesAdmin() {
  const [rows, setRows] = useState<CurrencyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await listCurrencies();
      if (!res.ok) throw new Error(res.error || "Failed to load currencies");
      setRows(res.currencies);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const columns = useMemo<ColumnDef<CurrencyRow>[]>(
    () => [
      { key: "code", label: "Code", render: (c) => <span style={{ color: "var(--fg)" }}>{c.code}</span> },
      { key: "name", label: "Name", render: (c) => c.name || dash },
      { key: "symbol", label: "Symbol", render: (c) => c.symbol || dash },
      {
        key: "rate",
        label: "Rate (INR per 1)",
        className: "mono",
        render: (c) => (c.exchangeRate ? c.exchangeRate.toFixed(4) : dash),
      },
      {
        key: "source",
        label: "Rate source",
        render: (c) =>
          c.code === "INR" ? (
            <span className="chip">base</span>
          ) : c.manualOverride ? (
            <span className="chip" style={{ color: "var(--c-amber, var(--fg))" }}>manual</span>
          ) : (
            <span className="chip" style={{ color: "var(--c-green)" }}>auto</span>
          ),
      },
      { key: "rateUpdated", label: "Rate updated", className: "muted mono", render: (c) => (c.rateUpdatedAt ? fmtDateTime(c.rateUpdatedAt) : dash) },
      { key: "created", label: "Created", className: "muted mono", render: (c) => fmtDateTime(c.createdTime) },
      { key: "modified", label: "Modified", className: "muted mono", render: (c) => fmtDateTime(c.modifiedTime) },
    ],
    [],
  );
  const { ordered, visible, hidden, toggle, move } = useColumns("currenciesTableColumns", columns, ["created", "modified"]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => `${c.code} ${c.name} ${c.symbol}`.toLowerCase().includes(q));
  }, [rows, query]);
  const pager = usePagination(filtered.length, "currenciesPageSize", query);

  const onRefreshRates = async () => {
    setRefreshing(true);
    try {
      const res = await refreshRatesNow();
      toast.success(
        res.updated.length ? `Rates updated: ${res.updated.join(", ")}` : "No rows to update (all manual/base)",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rate refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const onSave = async () => {
    if (!draft) return;
    const code = draft.code.trim().toUpperCase();
    if (!code) {
      toast.error("Code is required");
      return;
    }
    const rate = Number(draft.rate);
    if (draft.rate.trim() !== "" && (!Number.isFinite(rate) || rate < 0)) {
      toast.error("Rate must be a non-negative number");
      return;
    }
    setBusy(true);
    try {
      const input = {
        code,
        name: draft.name,
        symbol: draft.symbol,
        exchange_rate: draft.rate.trim() === "" ? 0 : rate,
        manual_override: draft.manualOverride,
      };
      if (draft.rowid) {
        await updateCurrency(draft.rowid, input);
        toast.success("Currency updated");
      } else {
        await createCurrency(input);
        toast.success("Currency added — rate fills on the next refresh unless set manually");
      }
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!draft?.rowid) return;
    if (!(await confirmDialog({ message: `Are you sure you want to delete currency "${draft.code}"? This cannot be undone.`, danger: true }))) return;
    setBusy(true);
    try {
      await deleteCurrency(draft.rowid);
      toast.success("Currency removed");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const editDraft = (c: CurrencyRow): Draft => ({
    rowid: c.id,
    code: c.code,
    name: c.name,
    symbol: c.symbol,
    rate: c.exchangeRate ? String(c.exchangeRate) : "",
    manualOverride: c.manualOverride,
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Currencies</div>
          <div className="sub">{loading ? "Loading…" : "Base INR · rates auto-refresh daily (frankfurter.dev)"}</div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void onRefreshRates()} disabled={refreshing} title="Fetch live rates now">
            <Icon name="clock" size={13} />
            {refreshing ? "Refreshing…" : "Refresh rates now"}
          </button>
          <button className="hbtn primary" onClick={() => setDraft({ ...EMPTY })}>
            <Icon name="plus" size={13} />
            New currency
          </button>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={() => void load()} />}

      {draft && (
        <div className="card form-section" style={{ marginBottom: 12, padding: 16, borderLeft: "3px solid var(--accent)" }}>
          <div className="form-section-title" style={{ marginBottom: 14 }}>
            <Icon name={draft.rowid ? "settings" : "plus"} size={13} className="ic" />
            {draft.rowid ? `Edit ${draft.code}` : "New currency"}
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span className="lbl">
                Code<span className="req"> *</span>
              </span>
              <input
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                placeholder="ISO code, e.g. USD"
                maxLength={10}
                disabled={!!draft.rowid}
              />
            </label>
            <label className="form-field">
              <span className="lbl">Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="US Dollar" />
            </label>
            <label className="form-field">
              <span className="lbl">Symbol</span>
              <input value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value })} placeholder="$" maxLength={10} />
            </label>
            <label className="form-field">
              <span className="lbl">Exchange rate (INR per 1)</span>
              <input
                type="number"
                min={0}
                step="0.0001"
                value={draft.rate}
                // Typing a rate implies you want to keep it — tick manual override.
                onChange={(e) => setDraft({ ...draft, rate: e.target.value, manualOverride: e.target.value.trim() !== "" ? true : draft.manualOverride })}
                placeholder="auto-filled by daily refresh"
                disabled={draft.code === "INR"}
              />
            </label>
            <label className="form-field" style={{ justifyContent: "flex-end" }}>
              <span className="lbl">Rate source</span>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={draft.manualOverride}
                  onChange={(e) => setDraft({ ...draft, manualOverride: e.target.checked })}
                  disabled={draft.code === "INR"}
                />
                <span>Manual override (daily refresh skips this currency)</span>
              </label>
            </label>
          </div>
          <div className="right" style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <span className="df-req-note">* Indicates a mandatory field</span>
            {draft.rowid && draft.code !== "INR" && (
              <button className="btn" style={{ color: "var(--c-red)" }} disabled={busy} onClick={() => void onDelete()}>
                Delete
              </button>
            )}
            <button className="btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="hbtn primary" disabled={busy} onClick={() => void onSave()}>
              <Icon name="check" size={13} />
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <div className="fbar">
        <div style={{ flex: 1 }} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search code, name…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && rows.length === 0 ? (
            <SkeletonRows rows={4} />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 36, textAlign: "center" }}>#</th>
                  {visible.map((c) => (
                    <th key={c.key} style={c.style}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pager.slice(filtered).map((c, i) => (
                  <tr key={c.id} tabIndex={0} onClick={() => setDraft(editDraft(c))} style={{ cursor: "pointer" }} title="Edit currency">
                    <td className="muted mono" style={{ textAlign: "center" }}>{pager.from + i}</td>
                    {visible.map((col) => (
                      <td key={col.key} className={col.className} style={col.style}>
                        {col.render!(c)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={visible.length + 1}>
                      <EmptyState icon="chart" title="No currencies" hint="Click New currency to add one." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {!(loading && rows.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
