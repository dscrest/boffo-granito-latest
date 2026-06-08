/* ============================================================
   BOFFO Order OS — additional views
   PurchaseOrders, PalletPacking, Loading, FinalLoading, DesignMaster
   ============================================================ */

/* ---------------- Purchase Orders ---------------- */
function PurchaseOrders() {
  const groups = {};
  ORDERS.forEach(o => { (groups[o.poNumber] ||= []).push(o); });
  const pos = Object.entries(groups).map(([po, items]) => ({
    po,
    items,
    party: items[0].party,
    flag: items[0].flag,
    country: items[0].country,
    totalQty: items.reduce((s, o) => s + o.orderQty, 0),
    skus: items.length,
    date: items[0].orderDate,
    dueDate: items[0].dueDate,
    daysFromPI: items[0].daysFromPI,
    stage: items[0].stage,
    progress: pct(items.reduce((s, o) => s + o.producedQty, 0), items.reduce((s, o) => s + o.orderQty, 0)),
  })).sort((a, b) => b.totalQty - a.totalQty);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Purchase Orders</div>
          <div className="sub">{pos.length} POs · {fmt(pos.reduce((s, p) => s + p.totalQty, 0))} sqm total</div>
        </div>
        <div className="right">
          <button className="hbtn"><Icon name="download" size={13}/>Export</button>
          <button className="hbtn primary"><Icon name="plus" size={13}/>Create PO</button>
        </div>
      </div>

      <div className="fbar">
        <button className="btn active">All POs</button>
        <button className="btn">Open</button>
        <button className="btn">Partially shipped</button>
        <button className="btn">Closed</button>
        <div style={{ flex: 1 }}/>
        <input type="text" placeholder="Search PO number, party…"/>
        <button className="btn"><Icon name="filter" size={12}/>Filter</button>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: 'center' }}>#</th>
              <th>PO Number</th>
              <th>Party</th>
              <th>Date</th>
              <th className="num" style={{ textAlign: 'right' }}>Days from PI</th>
              <th className="num" style={{ textAlign: 'right' }}>Order Qty</th>
              <th className="num" style={{ textAlign: 'right' }}>SKUs</th>
              <th>Progress</th>
              <th>Stage</th>
              <th>Docs</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {pos.map((p, i) => (
              <tr key={p.po + i}>
                <td className="muted mono" style={{ textAlign: 'center' }}>{i + 1}</td>
                <td className="mono" style={{ color: 'var(--fg)' }}>{p.po}</td>
                <td>{p.flag} {p.party} <span className="muted" style={{ fontSize: 10.5 }}>({p.country})</span></td>
                <td className="mono muted">{p.date}</td>
                <td className="num">{p.daysFromPI}</td>
                <td className="num">{fmt(p.totalQty)}</td>
                <td className="num">{p.skus}</td>
                <td style={{ width: 160 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <ProgressBar value={p.progress} max={100}
                      color={p.progress > 75 ? 'var(--c-green)' : p.progress > 30 ? 'var(--c-amber)' : 'var(--c-blue)'}
                      height={5}/>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', minWidth: 32 }}>{p.progress}%</span>
                  </div>
                </td>
                <td><StageBadge stage={p.stage}/></td>
                <td>
                  <span className="row" style={{ gap: 4 }}>
                    <span title="PI" className="pill" style={{ height: 16, padding: '0 4px', fontSize: 10 }}>PI</span>
                    <span title="PO" className="pill" style={{ height: 16, padding: '0 4px', fontSize: 10 }}>PO</span>
                    {p.stage === 'final' && <span title="Invoice" className="pill" style={{ height: 16, padding: '0 4px', fontSize: 10, color: 'var(--c-green)', borderColor: 'oklch(0.78 0.16 145 / 0.4)' }}>INV</span>}
                  </span>
                </td>
                <td className="mono muted">{p.dueDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Pallet Packing ---------------- */
function PalletPacking() {
  const items = ORDERS.filter(o => o.stage === 'packing' || o.stage === 'loading' || o.stage === 'final');

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Pallet Packing</div>
          <div className="sub">{items.length} active packing jobs · 6,284 boxes total · 173 updates today</div>
        </div>
        <div className="right">
          <button className="hbtn"><Icon name="download" size={13}/>Print labels</button>
          <button className="hbtn primary"><Icon name="plus" size={13}/>New Pallet</button>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KPI label="Pallets In Progress" value="3,142" unit="pallets" delta="+128 today" trend="up" spark={[5,6,7,8,9,10,11]} color="var(--c-violet)"/>
        <KPI label="Boxes Palletized"    value="112,108" delta="6,284 boxes today" spark={[4,6,7,9,10,11,12]} color="var(--c-violet)"/>
        <KPI label="Remaining to Pack"   value="58,140" delta="across 173 SKUs" spark={[14,12,11,10,9,8,7]} color="var(--c-amber)"/>
        <KPI label="Error Rate"          value="0.02" unit="%" delta="3 mispacks this week" spark={[2,1,2,1,2,1,1]} color="var(--c-red)"/>
      </div>

      <div className="fbar" style={{ marginTop: 14 }}>
        <button className="btn active">600x1200</button>
        <button className="btn">600x600</button>
        <button className="btn">200x1200</button>
        <button className="btn">800x1600</button>
        <button className="btn">75x600</button>
        <div style={{ flex: 1 }}/>
        <input type="text" placeholder="Search pallet code…"/>
        <button className="btn">Group: Party</button>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Pallet ID</th>
              <th>PO Number</th>
              <th>Design</th>
              <th>Size</th>
              <th>Finish</th>
              <th className="num" style={{ textAlign: 'right' }}>Box/Pallet</th>
              <th className="num" style={{ textAlign: 'right' }}>Pallet Qty</th>
              <th className="num" style={{ textAlign: 'right' }}>Total Boxes</th>
              <th className="num" style={{ textAlign: 'right' }}>Loaded</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 16).map((o, i) => {
              const palletId = `[${o.boxesPerPallet}x${Math.ceil(o.orderQty / 60 / o.boxesPerPallet)}] · 26-04-2026`;
              const loaded = Math.floor(o.loadedQty / 60);
              const total = Math.ceil(o.orderQty / 60);
              const palletQty = Math.ceil(total / o.boxesPerPallet);
              const status = o.loadedQty >= o.orderQty ? 'final' : o.palletizedQty >= o.orderQty * 0.85 ? 'loading' : 'packing';
              return (
                <tr key={o.id + i}>
                  <td className="mono" style={{ color: 'var(--fg)' }}>{palletId.split(' · ')[0]}<span className="muted" style={{ fontSize: 10, marginLeft: 6 }}>26-04-2026</span></td>
                  <td className="mono">{o.poNumber}</td>
                  <td><span className="design-name">{o.design}</span></td>
                  <td><span className={`chip size ${o.size.startsWith('200') || o.size.startsWith('75') ? 'b' : ''}`}>{o.size}</span></td>
                  <td><span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span></td>
                  <td className="num">{o.boxesPerPallet}</td>
                  <td className="num">{palletQty}</td>
                  <td className="num">{total}</td>
                  <td className="num" style={{ color: loaded > 0 ? 'var(--c-green)' : 'var(--dim)' }}>{loaded || '—'}</td>
                  <td><StageBadge stage={status}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Loading ---------------- */
function Loading() {
  const items = ORDERS.filter(o => o.stage === 'loading' || o.stage === 'packing');

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Loading</div>
          <div className="sub">4 trucks at dock · 7 shipments queued · next loading 14:30</div>
        </div>
        <div className="right">
          <button className="hbtn"><Icon name="docs" size={13}/>Loading list</button>
          <button className="hbtn primary"><Icon name="truck" size={13}/>Schedule truck</button>
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: '1fr 1fr 1fr', display: 'grid', gap: 10 }}>
        {['Dock 1', 'Dock 2', 'Dock 3'].map((dock, i) => (
          <div className="card" key={dock}>
            <div className="card-head">
              <span className={`dot ${i === 1 ? 'green' : i === 0 ? 'amber' : 'blue'}`}/>
              <span className="title">{dock}</span>
              <span className="muted">· {['Idle since 12:10', 'Loading EX-14/2026-27', 'Truck arriving 14:30'][i]}</span>
              <div className="right muted">{['—', '38%', 'queued'][i]}</div>
            </div>
            <div style={{ padding: '12px 14px' }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <span className="muted" style={{ fontSize: 11 }}>{['Awaiting next shipment', 'Merkury Market', 'AB Specializuota'][i]}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--fg)' }}>{['—', 'TR-MH-04 GH 2384', 'TR-MH-04 GH 2391'][i]}</span>
              </div>
              <div className="row" style={{ gap: 8, fontSize: 11 }}>
                <span className="inline-stat"><span className="l">Pallets</span><span className="v">{['—', '13/34', '0/22'][i]}</span></span>
                <span className="inline-stat"><span className="l">Boxes</span><span className="v">{['—', '494/1,292', '0/836'][i]}</span></span>
                <span className="inline-stat"><span className="l">ETA done</span><span className="v">{['—', '13:50', '15:20'][i]}</span></span>
              </div>
              {i === 1 && <div style={{ marginTop: 10 }}><ProgressBar value={38} max={100} color="var(--c-cyan)" height={5}/></div>}
            </div>
          </div>
        ))}
      </div>

      <div className="sec-title">
        <h2>Loading Queue</h2>
        <span className="meta">Ready to load · sorted by priority</span>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Sequence</th>
              <th>PO / Invoice</th>
              <th>Party</th>
              <th>Design</th>
              <th>Size</th>
              <th className="num" style={{ textAlign: 'right' }}>Pallets</th>
              <th className="num" style={{ textAlign: 'right' }}>Boxes</th>
              <th>Truck</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 12).map((o, i) => {
              const pallets = Math.ceil(o.palletizedQty / 60 / o.boxesPerPallet);
              const truck = `TR-MH-04 GH ${2380 + i}`;
              const status = i === 0 ? 'loading' : i < 3 ? 'packing' : 'packing';
              return (
                <tr key={o.id}>
                  <td className="mono muted">#{(i + 1).toString().padStart(2, '0')}</td>
                  <td>
                    <div className="mono">{o.poNumber}</div>
                    <div className="mono muted" style={{ fontSize: 10 }}>{o.invoice || 'pending'}</div>
                  </td>
                  <td>{o.flag} {o.party}</td>
                  <td><span className="design-name">{o.design}</span></td>
                  <td><span className={`chip size ${o.size.startsWith('200') || o.size.startsWith('75') ? 'b' : ''}`}>{o.size}</span></td>
                  <td className="num">{pallets}</td>
                  <td className="num">{fmt(o.palletizedQty)}</td>
                  <td className="mono muted">{i < 4 ? truck : '—'}</td>
                  <td><StageBadge stage={status}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Final Loading ---------------- */
function FinalLoading() {
  const finals = ORDERS.filter(o => o.stage === 'final');
  const invoices = {};
  finals.forEach(o => { (invoices[o.invoice] ||= []).push(o); });
  const inv = Object.entries(invoices).map(([inv, list]) => ({
    invoice: inv,
    party: list[0].party,
    flag: list[0].flag,
    country: list[0].country,
    pallets: list.reduce((s, o) => s + Math.ceil(o.orderQty / 60 / o.boxesPerPallet), 0),
    boxes: list.reduce((s, o) => s + Math.ceil(o.orderQty / 60), 0),
    qty: list.reduce((s, o) => s + o.orderQty, 0),
    items: list.length,
    date: list[0].dueDate,
  }));

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Final Loading & Invoicing</div>
          <div className="sub">{inv.length} active invoices · 22 issued this month · ₹4.62 Cr</div>
        </div>
        <div className="right">
          <button className="hbtn"><Icon name="invoice" size={13}/>Generate invoice</button>
          <button className="hbtn primary"><Icon name="download" size={13}/>Export packing list</button>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KPI label="Invoices (May)"   value="22" delta="+4 vs April" trend="up" spark={[3,4,5,4,6,7,8]} color="var(--c-green)"/>
        <KPI label="Pallets Loaded"   value="347" unit="pallets" delta="EX-14/2026-27" spark={[5,6,7,8,9,10,11]} color="var(--c-green)"/>
        <KPI label="Boxes Loaded"     value="12,664" delta="818 boxes today" spark={[6,8,9,10,11,12,13]} color="var(--c-green)"/>
        <KPI label="Avg Days to Ship" value="42" unit="days" delta="-3 days vs Q1" trend="up" spark={[10,9,8,8,7,7,6]} color="var(--c-cyan)"/>
      </div>

      <div className="sec-title">
        <h2>Active Invoices</h2>
        <span className="meta">Grouped by invoice number</span>
        <div className="right">
          <span className="muted">Sorted by: Invoice date</span>
        </div>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Invoice No.</th>
              <th>Party</th>
              <th>Country</th>
              <th className="num" style={{ textAlign: 'right' }}>Line Items</th>
              <th className="num" style={{ textAlign: 'right' }}>Pallets</th>
              <th className="num" style={{ textAlign: 'right' }}>Boxes</th>
              <th className="num" style={{ textAlign: 'right' }}>Qty (sqm)</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {inv.map(i => (
              <tr key={i.invoice}>
                <td className="mono" style={{ color: 'var(--fg)' }}>{i.invoice}</td>
                <td>{i.party}</td>
                <td>{i.flag} {i.country}</td>
                <td className="num">{i.items}</td>
                <td className="num">{i.pallets}</td>
                <td className="num">{fmt(i.boxes)}</td>
                <td className="num">{fmt(i.qty)}</td>
                <td className="mono muted">{i.date}</td>
                <td><span className="stage green"><Icon name="check" size={11}/>Loaded</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sec-title">
        <h2>Recent Invoices · Batch detail</h2>
        <span className="meta">Master view · Master - For Printing</span>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: 'center' }}>Sr.</th>
              <th>PO Number</th>
              <th>Party</th>
              <th>Batch / Shade</th>
              <th className="num" style={{ textAlign: 'right' }}>Pallets - Rem.</th>
              <th className="num" style={{ textAlign: 'right' }}>Pallets Loaded</th>
              <th className="num" style={{ textAlign: 'right' }}>Boxes / Pallet</th>
              <th className="num" style={{ textAlign: 'right' }}>Loaded Boxes</th>
            </tr>
          </thead>
          <tbody>
            {finals.slice(0, 9).map((o, i) => {
              const pal = Math.ceil(o.orderQty / 60 / o.boxesPerPallet);
              const batch = `0${500 + i * 3}/${i % 2 ? 2 : 1}`;
              return (
                <tr key={o.id}>
                  <td className="muted mono" style={{ textAlign: 'center' }}>{419 + i}</td>
                  <td className="mono">{o.poNumber}</td>
                  <td>{o.flag} {o.party}</td>
                  <td className="mono">{batch}</td>
                  <td className="num">{i === 1 ? 3 : 0}</td>
                  <td className="num">{pal - (i === 1 ? 3 : 0)}</td>
                  <td className="num">{o.boxesPerPallet}</td>
                  <td className="num">{fmt(Math.ceil(o.orderQty / 60))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Design Master ---------------- */
function DesignMaster() {
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Design Master</div>
          <div className="sub">{DESIGNS.length} designs · {SIZES.length} sizes · {FINISHES.length} finishes</div>
        </div>
        <div className="right">
          <button className="hbtn"><Icon name="download" size={13}/>Export</button>
          <button className="hbtn primary"><Icon name="plus" size={13}/>New design</button>
        </div>
      </div>

      <div className="fbar">
        <button className="btn active">All</button>
        <button className="btn">600x1200</button>
        <button className="btn">200x1200</button>
        <button className="btn">600x600</button>
        <button className="btn">75x600</button>
        <div style={{ flex: 1 }}/>
        <input type="text" placeholder="Search design…"/>
        <button className="btn">Group by Brand</button>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: 'center' }}>#</th>
              <th>Design Name</th>
              <th>Base Design</th>
              <th>Size</th>
              <th>Finish</th>
              <th>Brand</th>
              <th>Glaze</th>
              <th className="num" style={{ textAlign: 'right' }}>Active POs</th>
              <th className="num" style={{ textAlign: 'right' }}>Open Qty</th>
            </tr>
          </thead>
          <tbody>
            {DESIGNS.map((d, i) => {
              const open = ORDERS.filter(o => o.design === d.name).reduce((s, o) => s + (o.orderQty - o.loadedQty), 0);
              const pos = ORDERS.filter(o => o.design === d.name).length;
              return (
                <tr key={d.name}>
                  <td className="muted mono" style={{ textAlign: 'center' }}>{i + 1}</td>
                  <td><span className="design-name">{d.name}</span></td>
                  <td className="muted">{d.name}</td>
                  <td><span className={`chip size ${d.size.startsWith('200') || d.size.startsWith('75') ? 'b' : ''}`}>{d.size}</span></td>
                  <td><span className={`chip finish ${finishClass(d.finish)}`}>{d.finish}</span></td>
                  <td><span className={`chip brand ${d.brand === 'BIG' ? 'big' : ''}`}>{d.brand}</span></td>
                  <td><span className={`chip finish ${finishClass(d.finish)}`}>{d.finish}</span></td>
                  <td className="num">{pos}</td>
                  <td className="num">{open > 0 ? fmt(open) : <span className="dim">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

Object.assign(window, { PurchaseOrders, PalletPacking, Loading, FinalLoading, DesignMaster });
