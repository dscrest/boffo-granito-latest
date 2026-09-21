/* ============================================================
   Loading Plan · step 1 — Item selection (CR-227, trial beside the
   Loading Session). The spreadsheet layout of the Plan.dc.html mock on
   today's rules: ONE customer, ONE container per save. Toolbar → ruled sheet
   (CR-228: band per CUSTOMER, Customer column first then a gap, row per
   batch, "Qty to load" the only typed cell — no subtotals, no Fill /
   Load-all buttons; text columns show/hide via ColumnPicker, Size hidden
   by default) → totals. Selection + Save are SessionItemsStep's
   (useSessionPick). No vehicle fields and no fill indicators here (user
   2026-09-19) — the vehicle is step 2.
   ============================================================ */
import { useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { Combobox } from "@/ui/Combobox";
import { fmt } from "@/lib/format";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import type { DesignRow, SoBand } from "./newLoadingRows";
import { useSessionPick, type SessionPickProps } from "./SessionItemsStep";
import { walk } from "./SessionSheetView";
import type { PalPlanLine } from "./palPlansApi";

type Cell = { band: SoBand; row: DesignRow; l: PalPlanLine };

const palletsOf = (l: PalPlanLine, q: number) => (q > 0 && l.boxesPerPallet > 0 ? Math.ceil(q / l.boxesPerPallet) : 0);

export function PlanSheetStep({ onCancel, ...pickProps }: SessionPickProps & { onCancel: () => void }) {
  const { box, presetSalesOrderId } = pickProps;
  const { brandName, customers, customerId, showRail, pickCustomer, bands, allBands, qty, setLine, picked, totalBoxes, totalPallets, busy, onSave } =
    useSessionPick(pickProps);

  // All customers' stock, or the selected customer's only. One customer per container
  // still holds: once a quantity is typed, other customers' rows lock until it is cleared.
  const [scope, setScope] = useState<"all" | "selected">("all");
  const showAll = showRail && scope === "all";
  const [query, setQuery] = useState("");
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const q = (l: PalPlanLine) => qty.get(l.id) || 0;

  // ponytail: only the text columns are pickable — Customer, Ready / Qty / Pallets and Status stay
  // fixed so the blocked-row colSpan and the Qty key-walk need no bookkeeping.
  const COLS = useMemo<ColumnDef<Cell>[]>(() => [
    { key: "design", label: "Design", render: ({ row }) => <span className="design-name">{row.designLabel}</span> },
    { key: "so", label: "SO No.", className: "mono so nw", render: ({ band }) => band.soNumber },
    { key: "size", label: "Size", className: "nw", render: ({ l }) => l.sizeCode || "—" },
    { key: "brand", label: "Box Brand", className: "nw", render: ({ row }) => brandName(row.brandId) || "—" },
    { key: "batch", label: "Batch", className: "mono nw", render: ({ l }) => l.batchNumber || "—" },
    { key: "pallet", label: "Pallet type", className: "nw", render: ({ l }) => l.palletName || "—" },
  ], [brandName]);
  const cols = useColumns("loadingPlanSheetColumns", COLS, ["size"]);

  // Filters narrow what is SHOWN only — totals and Save read the full `bands`.
  const needle = query.trim().toLowerCase();
  const shown = (showAll ? allBands : bands)
    .map((b) => ({
      ...b,
      designs: b.designs
        .map((r) => ({
          ...r,
          lines: r.lines.filter(
            ({ line: l }) =>
              (!onlyPicked || q(l) > 0) &&
              (!needle || [b.soNumber, r.designLabel, l.customerName, l.batchNumber, l.sizeCode].some((s) => (s || "").toLowerCase().includes(needle))),
          ),
        }))
        .filter((r) => r.lines.length > 0),
    }))
    .filter((b) => b.designs.length > 0);

  const lockedOut = (cid: string) => totalBoxes > 0 && cid !== customerId;
  // Typing on another customer's row (nothing picked yet) makes them the container's customer.
  const claim = (cid: string) => {
    if (cid !== customerId) pickCustomer(cid);
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const head = bands[0]?.designs[0]?.lines[0]?.line;
  const customerName = head?.customerName || customers.find((c) => c.id === customerId)?.name || "";
  const emptyNote = customerId || presetSalesOrderId ? `No palletized stock ready for this ${presetSalesOrderId ? "order" : "customer"}.` : "Pick a customer to list their orders.";
  let n = 0;

  // Customer bands (CR-228) — a view-only regroup of the SO bands, order kept.
  const groups = new Map<string, { customerId: string; customerName: string; bands: SoBand[] }>();
  for (const band of shown) {
    const l = band.designs[0].lines[0].line;
    const g = groups.get(l.customerId) ?? groups.set(l.customerId, { customerId: l.customerId, customerName: l.customerName, bands: [] }).get(l.customerId)!;
    g.bands.push(band);
  }

  const rows = [...groups.values()].map((g) => {
    const designs = g.bands.flatMap((b) => b.designs);
    const ready = designs.reduce((s, r) => s + r.ready, 0);
    const lineCount = designs.reduce((s, r) => s + r.lines.length, 0);
    const shut = collapsed.has(g.customerId);
    const locked = lockedOut(g.customerId);
    return [
      <tr key={g.customerId} className="band">
        <td colSpan={cols.visible.length + 7}>
          <div className="band-in">
            <button className="fold" onClick={() => toggle(g.customerId)} aria-expanded={!shut} aria-label={`${shut ? "Expand" : "Collapse"} ${g.customerName}`}>{shut ? "+" : "−"}</button>
            <span style={{ fontWeight: 700 }}>{g.customerName || "—"}</span>
            <span className="dim">{lineCount} line{lineCount === 1 ? "" : "s"} · <span className="mono">{fmt(ready)}</span> boxes ready</span>
          </div>
        </td>
      </tr>,
      ...g.bands.flatMap((band) => band.designs.flatMap((row) =>
        row.lines.map(({ line: l, blocked }) => {
          n += 1;
          if (shut) return null;
          const v = q(l);
          const status = blocked ? "Not loadable" : v === 0 ? "Not planned" : v < l.boxes ? "Partial" : "Full";
          return (
            <tr key={l.id} className={blocked ? "blocked" : v > 0 ? "on" : undefined}>
              <td className="rn mono">{n}</td>
              <td className="cust nw">{l.customerName || "—"}</td>
              <td className="gapc" />
              {cols.visible.map((c) => <td key={c.key} className={c.className}>{c.render!({ band, row, l })}</td>)}
              {blocked ? (
                <td colSpan={3} className="num dim nw">{fmt(blocked.done)}/{fmt(blocked.total)} palletized — not loadable yet</td>
              ) : (
                <>
                  <td className="num mono">{fmt(l.boxes)}</td>
                  <td className="qty">
                    <NumberInput
                      maxDecimals={0}
                      value={v || ""}
                      placeholder="0"
                      disabled={locked}
                      title={locked ? "One customer per container — clear the picked quantities first" : undefined}
                      aria-label={`Boxes to load, ${band.soNumber} ${row.designLabel} batch ${l.batchNumber || "—"}`}
                      onChange={(e) => { claim(l.customerId); setLine(l, Number(e.target.value)); }}
                    />
                  </td>
                  <td className={`num mono ${v ? "" : "dim"}`}>{palletsOf(l, v) || "—"}</td>
                </>
              )}
              <td><span className={`st ${status === "Full" ? "ok" : status === "Partial" ? "warn" : ""}`}>{status}</span></td>
            </tr>
          );
        }),
      )),
    ];
  });

  return (
    <>
      <div className="card session-fill psheet">
        {/* toolbar */}
        <div className="psheet-bar tools">
          {showRail && (
            <div className="seg" role="group" aria-label="Customers shown">
              <button className={`seg-btn ${scope === "all" ? "active" : ""}`} onClick={() => setScope("all")}>All customers</button>
              <button className={`seg-btn ${scope === "selected" ? "active" : ""}`} onClick={() => setScope("selected")}>Selected customer</button>
            </div>
          )}
          {!showAll && <div style={{ flex: "0 1 300px", minWidth: 200 }}>
            {showRail ? (
              <Combobox
                value={customerId}
                options={customers.map((c) => ({ value: c.id, label: c.name, badge: `${fmt(c.ready)} bx ready` }))}
                onChange={pickCustomer}
                placeholder="Customer…"
                ariaLabel="Customer"
                clearable={false}
              />
            ) : (
              <div style={{ fontWeight: 700 }} className="clip">{customerName || "—"}</div>
            )}
          </div>}
          <input type="search" className="set-search" style={{ margin: 0, flex: "0 1 260px" }} placeholder="Search design, batch, SO…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className={`seg-btn ${onlyPicked ? "active" : ""}`} aria-pressed={onlyPicked} onClick={() => setOnlyPicked((x) => !x)}>Only picked</button>
          <span style={{ flex: 1 }} />
          <ColumnPicker columns={cols.ordered} hidden={cols.hidden} onToggle={cols.toggle} onMove={cols.move} />
        </div>

        {/* sheet */}
        <div className="pane-scroll" style={{ overflowX: "auto" }}>
          {shown.length > 0 ? (
            <table className="psheet-tbl">
              <thead>
                <tr>
                  <th className="rn" />
                  <th className="cust">Customer</th>
                  <th className="gapc" />
                  {cols.visible.map((c) => <th key={c.key}>{c.label}</th>)}
                  <th className="num">Ready</th>
                  <th className="num qtyh">Qty to load</th>
                  <th className="num">Pallets</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody onKeyDown={walk}>{rows}</tbody>
              <tfoot>
                <tr>
                  <td className="rn" />
                  <td className="cust">Total <span className="dim" style={{ fontWeight: 400 }}>· {picked.length} line{picked.length === 1 ? "" : "s"} picked</span></td>
                  <td colSpan={cols.visible.length + 2} />
                  <td className="num mono">{fmt(totalBoxes)}</td>
                  <td className="num mono">{fmt(totalPallets)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          ) : (
            <div className="dim" style={{ padding: "14px 16px" }}>{(showAll ? allBands : bands).length > 0 ? "No rows match." : showAll ? "No stock is ready for loading." : emptyNote}</div>
          )}
        </div>
      </div>

      <div className="session-foot">
        <div className="psheet-stats">
          <span><i>Lines</i><b className="mono">{picked.length}</b></span>
          <span><i>Boxes</i><b className="mono">{fmt(totalBoxes)}</b></span>
          <span><i>Pallets</i><b className="mono">{fmt(totalPallets)}</b></span>
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="hbtn primary" disabled={busy || (!box && totalBoxes === 0)} onClick={() => void onSave()}>
          <Icon name="check" size={13} />
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}
