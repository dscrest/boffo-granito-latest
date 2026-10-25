/* ============================================================
   Settings → Zoho (CR-325/356/358/359). One org-wide connection to the
   active customer source (ZOHO in zohoApi.ts — Zoho CRM Accounts since
   CR-359; Books hidden, its connection kept). Customers sync in: changes
   arrive via the webhook / URL cron hitting the server's incremental pull
   ("Refresh now" runs the same pull), a one-time "Import all" pages through
   every record, and a per-customer Push from the customer page (needs the
   write scope — an older consent shows Reconnect).
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { BoffoLoader } from "@/ui/BoffoLoader";
import { BackToSettings } from "@/ui/primitives";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { Note } from "@/ui/States";
import {
  connectZoho,
  dedupeCustomers,
  disconnectZoho,
  importZohoPage,
  isReauth,
  REAUTH_HINT,
  syncZoho,
  ZOHO,
  zohoStatus,
  type DedupePlan,
  type SyncSummary,
  type ZohoStatus,
} from "@/features/masters/zohoApi";
import { invalidateCustomers } from "@/features/masters/customersApi";

const errMsg = (e: unknown, fallback: string) => (isReauth(e) ? REAUTH_HINT : e instanceof Error ? e.message : fallback);
const EMPTY: ZohoStatus = { provider: ZOHO.provider, active: true, connected: false, orgName: "", orgId: "", configured: false, canWrite: false, lastSync: null };

export function ZohoSyncSettings() {
  const [status, setStatus] = useState<ZohoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null); // import page counter
  const [plan, setPlan] = useState<DedupePlan | null>(null); // CR-373: last duplicate check
  const load = () => zohoStatus().then(setStatus).catch(() => setStatus(EMPTY));
  useEffect(() => {
    void load();
  }, []);

  const onConnect = async () => {
    setBusy(true);
    try {
      await connectZoho(); // navigates away
    } catch (e) {
      toast.error(errMsg(e, "Could not start the Zoho connection"));
      setBusy(false);
    }
  };
  const onDisconnect = async () => {
    const ok = await confirmDialog({
      title: `Disconnect ${ZOHO.label}?`,
      message: "Customer sync and mapping stop until an Admin connects again. Existing customers keep their details.",
      confirmLabel: "Yes, disconnect",
      cancelLabel: "No, keep it",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await disconnectZoho();
      toast.success(`${ZOHO.label} disconnected`);
      await load();
    } catch (e) {
      toast.error(errMsg(e, "Disconnect failed"));
    } finally {
      setBusy(false);
    }
  };

  const onRefresh = async () => {
    setBusy(true);
    try {
      const r = await syncZoho();
      invalidateCustomers();
      if (r.note) toast.info(r.note);
      else toast.success(`Refreshed — ${r.created} new, ${r.updated} updated, ${r.linked} linked`);
      await load();
    } catch (e) {
      toast.error(errMsg(e, "Refresh failed"));
    } finally {
      setBusy(false);
    }
  };

  /* CR-373: duplicate customers — report, then merge on confirmation. */
  const dupCount = (p: DedupePlan) => p.groups.reduce((n, g) => n + g.drop.length, 0);
  const onFind = async (): Promise<DedupePlan | null> => {
    setBusy(true);
    setProgress("Checking for duplicates…");
    try {
      const p = await dedupeCustomers(false);
      setPlan(p);
      return p;
    } catch (e) {
      toast.error(errMsg(e, "Could not check for duplicates"));
      return null;
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };
  const onMerge = async () => {
    if (!plan) return;
    const n = dupCount(plan);
    const ok = await confirmDialog({
      title: `Merge ${n} duplicate customer${n === 1 ? "" : "s"}?`,
      message: `Each duplicate is removed and its quotations, sales orders, panel orders and sample orders move to the customer that stays (the one synced in ${ZOHO.label} & Zoho Books). ${plan.recodes.length ? `${plan.recodes.length} customer${plan.recodes.length === 1 ? "" : "s"} sharing a code with another customer get a new code. ` : ""}This cannot be undone.`,
      confirmLabel: "Yes, merge",
      cancelLabel: "No",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setProgress("Merging duplicates…");
    try {
      const r = await dedupeCustomers(true);
      invalidateCustomers();
      toast.success(`Merged ${r.merged ?? 0} duplicates — ${r.repointed ?? 0} orders moved, ${r.recoded ?? 0} codes renewed`);
      setPlan(await dedupeCustomers(false));
    } catch (e) {
      invalidateCustomers();
      toast.error(errMsg(e, "Merge failed"));
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  /* One page per request (the server caps a page so a call stays inside its timeout). */
  const onImport = async () => {
    // CR-387: the import is never gated on duplicates. The server skips a duplicate name per record
    // (CR-372, summary.duplicates + errors); the Duplicate customers check runs AFTER the pull.
    const ok = await confirmDialog({
      title: `Import all ${ZOHO.label} customers?`,
      message: `Every customer ${ZOHO.noun} in ${ZOHO.label} is pulled in: existing customers with the same name are linked, the rest are created. One ${ZOHO.label} call per ${ZOHO.noun}${ZOHO.provider === "crm" ? " plus one for its contacts and one Zoho Books check (the CRM & Books status)" : ""}. Safe to run again — ${ZOHO.noun}s already imported and unchanged are skipped, only their Zoho Books link is re-checked. Duplicates are skipped and listed under Duplicate customers once the import finishes.`,
      confirmLabel: "Yes, import",
      cancelLabel: "No",
    });
    if (!ok) return;
    setBusy(true);
    const total = { created: 0, updated: 0, linked: 0, skipped: 0, duplicates: 0, errors: [] as string[] };
    let page = 1;
    // After the pull (complete or stopped): the Duplicate customers card shows what is left to merge.
    const dupNote = (p: DedupePlan | null) => {
      const n = (p && p.groups.length ? dupCount(p) : 0) || total.duplicates;
      return n ? `, ${n} duplicate${n === 1 ? "" : "s"} skipped — see Duplicate customers below` : "";
    };
    try {
      for (; ; page++) {
        setProgress(`Importing page ${page}…`);
        const r = await importZohoPage(page);
        total.created += r.created;
        total.updated += r.updated;
        total.linked += r.linked;
        total.skipped += Math.max(0, r.skipped);
        total.duplicates += r.duplicates ?? 0;
        total.errors.push(...r.errors);
        if (r.done) break;
      }
      invalidateCustomers();
      const p = await onFind();
      const errs = total.errors.length - total.duplicates;
      toast.success(`Imported — ${total.created} new, ${total.updated} updated, ${total.linked} linked${total.skipped ? `, ${total.skipped} already up to date` : ""}${dupNote(p)}${errs > 0 ? `, ${errs} errors` : ""}`);
      await load();
    } catch (e) {
      // CR-362: a page can still time out — what landed is kept, a re-run skips it.
      invalidateCustomers();
      const p = await onFind();
      toast.error(`${errMsg(e, "Import failed")} — stopped at page ${page} after ${total.created + total.updated + total.linked} ${ZOHO.noun}s${dupNote(p)}. Run Import all again; imported ${ZOHO.noun}s are skipped.`);
      await load();
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const last: SyncSummary | null = status?.lastSync ?? null;

  return (
    <div>
      <div className="page-head">
        <div>
          <BackToSettings />
          <div className="title">{ZOHO.label}</div>
          <div className="sub">Customers sync from this organisation as they change in {ZOHO.label}; new add-on customers are pushed by hand</div>
        </div>
      </div>

      <div className="settings-grid">
        <div className="card">
          <div className="card-head">
            <Icon name="refresh" size={13} className="ic" />
            <div className="title">Connection</div>
          </div>
          <div className="card-body" style={{ padding: 16 }}>
            {!status || busy ? (
              <BoffoLoader size="sm" label={progress ?? (busy ? "Working…" : "Loading…")} />
            ) : status.connected ? (
              <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Connected to {status.orgName || ZOHO.label}</div>
                  <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                    {status.canWrite ? "Reads and writes customers." : "Read-only connection — reconnect to allow writes."}
                  </div>
                </div>
                <div className="row" style={{ gap: 8, marginLeft: "auto" }}>
                  {!status.canWrite && (
                    <button className="hbtn primary" onClick={() => void onConnect()}>
                      Reconnect
                    </button>
                  )}
                  <button className="hbtn" onClick={() => void onDisconnect()}>
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Not connected</div>
                  <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                    {status.configured
                      ? `Sign in with the Zoho account that can see your ${ZOHO.label} organisation.`
                      : "Zoho sign-in is not set up on the server yet."}
                  </div>
                </div>
                <button className="hbtn primary" style={{ marginLeft: "auto" }} onClick={() => void onConnect()} disabled={!status.configured}>
                  Connect {ZOHO.label}
                </button>
              </div>
            )}
          </div>
        </div>

        {status?.connected && !busy && (
          <div className="card">
            <div className="card-head">
              <Icon name="refresh" size={13} className="ic" />
              <div className="title">Customer sync</div>
            </div>
            <div className="card-body" style={{ padding: 16 }}>
              <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  {last ? (
                    <>
                      <div style={{ fontWeight: 600 }}>
                        Last {last.mode === "import" ? "import" : "refresh"}: {last.at}
                      </div>
                      <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                        {last.note ??
                          `${last.created} new · ${last.updated} updated · ${last.linked} linked${last.duplicates ? ` · ${last.duplicates} duplicates` : ""}${last.errors.length - (last.duplicates ?? 0) > 0 ? ` · ${last.errors.length - (last.duplicates ?? 0)} errors` : ""}`}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600 }}>Never synced</div>
                      <div className="dim" style={{ fontSize: "var(--t-sm)" }}>Run Import all customers once to start.</div>
                    </>
                  )}
                </div>
                <div className="row" style={{ gap: 8, marginLeft: "auto" }}>
                  <button className="hbtn" onClick={() => void onRefresh()}>
                    Refresh now
                  </button>
                  <button className="hbtn primary" onClick={() => void onImport()}>
                    Import all customers
                  </button>
                </div>
              </div>
              {last && last.errors.length > 0 && (
                <Note tone="warn" style={{ marginTop: 12 }}>
                  <div>Skipped on the last run (duplicates stay skipped until merged here or in {ZOHO.label}; other errors retry next time):</div>
                  <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                    {last.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </Note>
              )}
            </div>
          </div>
        )}

        {status?.connected && !busy && (
          <div className="card">
            <div className="card-head">
              <Icon name="refresh" size={13} className="ic" />
              <div className="title">Duplicate customers</div>
            </div>
            <div className="card-body" style={{ padding: 16 }}>
              <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  {plan ? (
                    <>
                      <div style={{ fontWeight: 600 }}>
                        {plan.groups.length ? `${dupCount(plan)} duplicate customer${dupCount(plan) === 1 ? "" : "s"} in ${plan.groups.length} group${plan.groups.length === 1 ? "" : "s"}` : "No duplicates"}
                      </div>
                      <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                        {plan.groups.length
                          ? `The customer synced in ${ZOHO.label} stays; the others merge into it.`
                          : `Every ${ZOHO.label} ${ZOHO.noun} has one customer here${plan.recodes.length ? `, but ${plan.recodes.length} share a code` : ""}.`}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600 }}>Not checked yet</div>
                      <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                        Finds customers created twice for one {ZOHO.label} {ZOHO.noun}, codes used twice, and names shared by different {ZOHO.noun}s.
                      </div>
                    </>
                  )}
                </div>
                <div className="row" style={{ gap: 8, marginLeft: "auto" }}>
                  <button className="hbtn" onClick={() => void onFind()}>
                    Find duplicates
                  </button>
                  {plan && (plan.groups.length > 0 || plan.recodes.length > 0) && (
                    <button className="hbtn primary" onClick={() => void onMerge()}>
                      Merge {dupCount(plan)} duplicates
                    </button>
                  )}
                </div>
              </div>
              {plan && plan.groups.length > 0 && (
                <table className="tbl" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Stays</th>
                      <th>Merged into it</th>
                      <th>{ZOHO.label} {ZOHO.noun}</th>
                      <th style={{ textAlign: "right" }}>Orders moved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.groups.map((g) => (
                      <tr key={g.crm_account_id}>
                        <td>{g.keep.name}</td>
                        <td>{g.keep.code}</td>
                        <td>{g.drop.map((d) => d.code).join(", ")}</td>
                        <td className="dim">{g.crm_account_id}</td>
                        <td style={{ textAlign: "right" }}>{Object.values(g.moves ?? {}).reduce((a, b) => a + b, 0) || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {plan && plan.recodes.length > 0 && (
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 12 }}>
                  Codes used twice — renewed on merge: {plan.recodes.map((r) => `${r.name} ${r.from} → ${r.to}`).join("; ")}
                </div>
              )}
              {plan && plan.conflicts.length > 0 && (
                <Note tone="warn" style={{ marginTop: 12 }}>
                  <div>
                    Not merged — different {ZOHO.label} {ZOHO.noun}s share these names. Merge them in {ZOHO.label}, or map the add-on customer by hand:
                  </div>
                  <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                    {plan.conflicts.map((c) => (
                      <li key={c.name}>
                        {c.name} — {c.rows.map((r) => `${r.code}${r.crm_account_id ? ` (${ZOHO.label} ${r.crm_account_id})` : " (not linked)"}`).join(", ")}
                      </li>
                    ))}
                  </ul>
                </Note>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
