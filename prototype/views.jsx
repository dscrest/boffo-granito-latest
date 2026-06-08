/* ============================================================
   BOFFO Order OS — views
   Dashboard, Kanban, Orders table, PO, Production, Packing, Loading
   ============================================================ */

/* ---------------- Dashboard ---------------- */
function Dashboard() {
  // Aggregate counts per stage
  const byStage = useMemo(() => {
    const m = {};
    STAGES.forEach(s => m[s.id] = { count: 0, qty: 0 });
    ORDERS.forEach(o => { m[o.stage].count++; m[o.stage].qty += o.orderQty; });
    return m;
  }, []);

  const totalQty   = ORDERS.reduce((s, o) => s + o.orderQty, 0);
  const totalProd  = ORDERS.reduce((s, o) => s + o.producedQty, 0);
  const totalPal   = ORDERS.reduce((s, o) => s + o.palletizedQty, 0);
  const totalLoad  = ORDERS.reduce((s, o) => s + o.loadedQty, 0);

  // Remaining qty by design (top 6)
  const byDesign = useMemo(() => {
    const m = {};
    ORDERS.forEach(o => {
      const k = o.design;
      if (!m[k]) m[k] = { design: k, size: o.size, finish: o.finish, ordered: 0, produced: 0 };
      m[k].ordered += o.orderQty;
      m[k].produced += o.producedQty;
    });
    return Object.values(m).map(d => ({ ...d, remaining: d.ordered - d.produced }))
      .sort((a, b) => b.remaining - a.remaining)
      .slice(0, 7);
  }, []);

  // Production progress sample (today's production)
  const todayProd = useMemo(() => ORDERS.filter(o => o.stage === 'prod' || o.stage === 'packing').slice(0, 6), []);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Today, 26 May 2026 · Tuesday</div>
          <div className="sub row">
            <span className="live-dot"/>Live
            <span className="dim">·</span>
            <span>Last refresh 3s ago</span>
            <span className="dim">·</span>
            <span>Plant: Morbi · Shift A</span>
          </div>
        </div>
        <div className="right">
          <button className="hbtn"><Icon name="download" size={13}/>Export</button>
          <button className="hbtn"><Icon name="calendar" size={13}/>This week</button>
          <button className="hbtn primary"><Icon name="plus" size={13}/>New Order</button>
        </div>
      </div>

      {/* KPI grid */}
      <div className="kpi-grid">
        <KPI label="Total Order Qty" value={fmt(totalQty)} unit="sqm" delta="+12,724 this week" trend="up" spark={[6,8,7,10,9,11,12]}/>
        <KPI label="In Production"   value={fmt(totalProd)} unit="sqm" delta="60.4k of 170.6k target" spark={[3,4,5,7,8,9,11]} color="var(--c-blue)"/>
        <KPI label="Pallets Packed"  value={fmt(totalPal/60)} unit="pallets" delta="6,284 boxes total" spark={[2,4,5,8,9,10,12]} color="var(--c-violet)"/>
        <KPI label="Ready to Load"   value="1,625" unit="pallets" delta="58,140 boxes ready" spark={[7,9,10,12,11,13,14]} color="var(--c-cyan)"/>
        <KPI label="Loaded Today"    value="347" unit="pallets" delta="EX-14/2026-27 · 8 trucks" spark={[5,6,4,9,8,11,12]} color="var(--c-green)"/>
        <KPI label="Invoiced (May)"  value="22" unit="invoices" delta="₹4.62 Cr · +18% MoM" trend="up" spark={[3,5,4,6,7,8,9]} color="var(--c-amber)"/>
      </div>

      {/* Stage strip */}
      <div className="sec-title">
        <h2>Pipeline</h2>
        <span className="meta">{ORDERS.length} active orders · {fmt(totalQty)} sqm in flight</span>
        <div className="right row" style={{gap:14}}>
          <span className="row"><span className="dot blue"/><span className="muted">Produced</span></span>
          <span className="row"><span className="dot violet"/><span className="muted">Palletized</span></span>
          <span className="row"><span className="dot green"/><span className="muted">Loaded</span></span>
        </div>
      </div>

      <div className="stage-strip">
        {STAGES.map((s, i) => (
          <div className="stage-tile" key={s.id}>
            <div className="lbl"><span className={`dot ${s.color}`}/>{s.label}</div>
            <div className="val">{byStage[s.id].count}</div>
            <div className="sub">{fmt(byStage[s.id].qty)} sqm</div>
            {i < STAGES.length - 1 && (
              <Icon name="chev-r" size={16} className="arrow"/>
            )}
          </div>
        ))}
      </div>

      {/* Split: Ready to Load + Production progress */}
      <div className="split" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <Icon name="truck" size={13}/>
            <span className="title">Ready to Load Today</span>
            <span className="muted">· 7 shipments · 4 trucks at dock</span>
            <div className="right">
              <span className="pill"><span className="dot green"/>Dock 2 active</span>
              <button className="hbtn" style={{ height: 26, padding: '0 8px' }}>View all</button>
            </div>
          </div>
          <div style={{ maxHeight: 326, overflow: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>PO / Invoice</th>
                  <th>Party</th>
                  <th>Design</th>
                  <th>Size</th>
                  <th className="num" style={{textAlign:'right'}}>Pallets</th>
                  <th className="num" style={{textAlign:'right'}}>Boxes</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {READY_TO_LOAD.map(o => (
                  <tr key={o.id}>
                    <td>
                      <div className="mono" style={{ color: 'var(--fg)' }}>{o.poNumber}</div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{o.invoice || 'pending invoice'}</div>
                    </td>
                    <td>
                      <div>{o.party}</div>
                      <div className="muted" style={{ fontSize: 10.5 }}>{o.country}</div>
                    </td>
                    <td><span className="design-name">{o.design}</span></td>
                    <td><span className={`chip size ${o.size.startsWith('200') || o.size.startsWith('75') ? 'b' : ''}`}>{o.size}</span></td>
                    <td className="num">{Math.ceil(o.palletizedQty / o.boxesPerPallet)}</td>
                    <td className="num">{fmt(o.palletizedQty)}</td>
                    <td><StageBadge stage={o.stage}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <Icon name="factory" size={13}/>
            <span className="title">Production Progress</span>
            <div className="right"><span className="muted">Today · Plant Morbi</span></div>
          </div>
          <div>
            {todayProd.map(o => {
              const p = pct(o.producedQty, o.orderQty);
              return (
                <div className="prod-progress" key={o.id}>
                  <div className="name">
                    <span>{o.design}</span>
                    <small>{o.size} · {o.finish}</small>
                  </div>
                  <ProgressBar value={o.producedQty} max={o.orderQty} color="var(--c-blue)" height={5}/>
                  <div className="pct" style={{ color: p > 80 ? 'var(--c-green)' : 'var(--fg-2)' }}>{p}%</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom split: remaining qty by design + activity */}
      <div className="split" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="card-head">
            <Icon name="tile" size={13}/>
            <span className="title">Remaining Qty by Design</span>
            <span className="muted">· Top 7 outstanding</span>
            <div className="right">
              <button className="hbtn" style={{ height: 26, padding: '0 8px' }}>By party</button>
              <button className="hbtn" style={{ height: 26, padding: '0 8px', background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' }}>By design</button>
            </div>
          </div>
          <div>
            {byDesign.map(d => {
              const p = pct(d.produced, d.ordered);
              return (
                <div className="design-row" key={d.design}>
                  <div className="label">
                    {d.design}
                    <small>{d.size} · {d.finish}</small>
                  </div>
                  <div className="barwrap" style={{ width: 180 }}>
                    <ProgressBar value={d.produced} max={d.ordered}
                      color={p > 75 ? 'var(--c-green)' : p > 40 ? 'var(--c-amber)' : 'var(--c-red)'}
                      height={5}/>
                  </div>
                  <div className="qty">{fmt(d.remaining)}</div>
                  <div className="qty muted" style={{ fontSize: 11 }}>{p}%</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <Icon name="bell" size={13}/>
            <span className="title">Activity</span>
            <div className="right"><span className="muted">Live</span><span className="live-dot"/></div>
          </div>
          <div className="activity">
            {ACTIVITY.map((a, i) => {
              const stageColor = { production: 'blue', packing: 'violet', loading: 'cyan', po: 'amber', final: 'green' }[a.tag] || 'blue';
              return (
                <div className="item" key={i}>
                  <div className="time">{a.time}</div>
                  <div className="indicator"><span className={`dot ${stageColor}`}/></div>
                  <div className="body">
                    <div><span className="who">{a.who}</span> <span className="action">{a.action}</span></div>
                    <div className="detail">{a.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, unit, delta, trend, spark, color = 'var(--accent)' }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}<span className="unit">{unit}</span></div>
      <div className="delta">
        {trend === 'up' && <Icon name="arrow-up" size={11} style={{ color: 'var(--c-green)' }}/>}
        {trend === 'down' && <Icon name="arrow-down" size={11} style={{ color: 'var(--c-red)' }}/>}
        <span>{delta}</span>
      </div>
      <div className="spark"><Spark points={spark} color={color} w={62} h={20}/></div>
    </div>
  );
}

/* ---------------- Kanban ---------------- */
function Kanban() {
  const [filter, setFilter] = useState('all');
  const [openOrder, setOpenOrder] = useState(null);
  const [quickView, setQuickView] = useState(null); // { order, rect }

  const byStage = useMemo(() => {
    const m = {};
    STAGES.forEach(s => m[s.id] = []);
    ORDERS.forEach(o => { if (filter === 'all' || o.partyCode === filter) m[o.stage].push(o); });
    return m;
  }, [filter]);

  const handleOpenFull = order => {
    setQuickView(null);
    setOpenOrder(order);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Orders Pipeline</div>
          <div className="sub">Click the <Icon name="chev-r" size={11} style={{ verticalAlign: 'middle' }}/> arrow on a card for quick line-items view · click the card for full details. {ORDERS.length} orders in flight.</div>
        </div>
        <div className="right">
          <button className="hbtn"><Icon name="filter" size={13}/>Filters</button>
          <button className="hbtn primary"><Icon name="plus" size={13}/>New Order</button>
        </div>
      </div>

      <div className="fbar">
        <button className={`btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All parties</button>
        {PARTIES.map(p => (
          <button key={p.code} className={`btn ${filter === p.code ? 'active' : ''}`} onClick={() => setFilter(p.code)}>
            {p.name}
          </button>
        ))}
        <div style={{ flex: 1 }}/>
        <input type="text" placeholder="Search PO, design, party…"/>
        <button className="btn"><Icon name="settings" size={12}/>Fields</button>
      </div>

      <div className="kanban-grid">
        {STAGES.map(s => (
          <KanbanColumn
            key={s.id}
            stage={s}
            orders={byStage[s.id]}
            onOpen={setOpenOrder}
            onQuickView={setQuickView}
            quickViewId={quickView?.order?.id}
          />
        ))}
      </div>

      {quickView && (
        <QuickView
          order={quickView.order}
          anchorRect={quickView.rect}
          onClose={() => setQuickView(null)}
          onOpenFull={handleOpenFull}
        />
      )}

      {openOrder && <OrderDrawer order={openOrder} onClose={() => setOpenOrder(null)}/>}
    </div>
  );
}

function KanbanColumn({ stage, orders, onOpen, onQuickView, quickViewId }) {
  const totalQty = orders.reduce((sum, o) => sum + o.orderQty, 0);
  return (
    <div className="col">
      <div className="col-head">
        <span className={`dot ${stage.color}`}/>
        <span className="name">{stage.label}</span>
        <span className="count">{orders.length}</span>
      </div>
      <div style={{ padding: '6px 12px 4px', fontSize: 10.5, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
        <span>{fmt(totalQty)} sqm</span>
        <span className="mono">{orders.length > 0 ? `avg ${fmt(totalQty / orders.length)}` : '—'}</span>
      </div>
      <div className="col-list">
        {orders.map(o => (
          <KanbanCard
            key={o.id}
            order={o}
            onOpen={onOpen}
            onQuickView={onQuickView}
            quickViewActive={quickViewId === o.id}
          />
        ))}
        {orders.length === 0 && <div className="muted" style={{ padding: 16, textAlign: 'center', fontSize: 11.5 }}>—</div>}
      </div>
    </div>
  );
}

function KanbanCard({ order, onOpen, onQuickView, quickViewActive }) {
  const progress = order.stage === 'po' ? 0 :
    order.stage === 'prod' ? pct(order.producedQty, order.orderQty) :
    order.stage === 'packing' ? pct(order.palletizedQty, order.orderQty) :
    order.stage === 'loading' ? pct(order.loadedQty, order.orderQty) :
    100;

  // How many line items in the same PO
  const siblings = ORDERS.filter(o => o.poNumber === order.poNumber && o.partyCode === order.partyCode);
  const isMulti = siblings.length > 1;

  const cardRef = useRef(null);

  const handleQuickView = e => {
    e.stopPropagation();
    if (!cardRef.current) return;
    if (quickViewActive) { onQuickView(null); return; }
    const rect = cardRef.current.getBoundingClientRect();
    onQuickView({ order, rect });
  };

  return (
    <div ref={cardRef} className="kcard" onClick={() => onOpen && onOpen(order)}>
      <button
        className={`quick-btn ${quickViewActive ? 'open' : ''}`}
        onClick={handleQuickView}
        title={`Quick view${isMulti ? ` · ${siblings.length} items` : ''}`}
      >
        <Icon name="chev-r" size={13}/>
      </button>

      <div className="top">
        <span className="po">{order.poNumber}</span>
        <span>·</span>
        <span>{order.flag}</span>
        {isMulti && <span className="li-badge" title={`${siblings.length} line items in this PO`}>{siblings.length} items</span>}
        <span className={`pri-dot pri ${order.priority}`} title={order.priority} style={{ marginLeft: 'auto', marginRight: 26 }}/>
      </div>
      <div className="design">{order.design}</div>
      <div className="party">{order.party}</div>
      <div className="chips">
        <span className={`chip size ${order.size.startsWith('200') || order.size.startsWith('75') ? 'b' : ''}`}>{order.size}</span>
        <span className={`chip finish ${finishClass(order.finish)}`}>{order.finish}</span>
        <span className={`chip brand ${order.brand === 'BIG' ? 'big' : ''}`}>{order.brand}</span>
      </div>
      {order.stage !== 'po' && order.stage !== 'final' && (
        <ProgressBar value={progress} max={100}
          color={order.stage === 'prod' ? 'var(--c-blue)' : order.stage === 'packing' ? 'var(--c-violet)' : 'var(--c-cyan)'}
        />
      )}
      <div className="meta">
        <span className="qty">{fmt(order.orderQty)}<span className="muted"> sqm</span></span>
        <span style={{ marginLeft: 'auto' }} className="muted mono">{order.dueDate}</span>
      </div>
    </div>
  );
}

/* ---------------- Orders Table (Airtable-like, clean) ---------------- */
function OrdersTable() {
  const [tab, setTab] = useState('all');
  const filtered = useMemo(() => {
    if (tab === 'all') return ORDERS;
    return ORDERS.filter(o => o.stage === tab);
  }, [tab]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">All Orders</div>
          <div className="sub">{filtered.length} of {ORDERS.length} orders · grouped by stage</div>
        </div>
        <div className="right">
          <button className="hbtn"><Icon name="download" size={13}/>Export CSV</button>
          <button className="hbtn primary"><Icon name="plus" size={13}/>New Order</button>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>All <span className="muted mono" style={{ marginLeft: 4 }}>{ORDERS.length}</span></div>
        {STAGES.map(s => (
          <div key={s.id} className={`tab ${tab === s.id ? 'active' : ''}`} onClick={() => setTab(s.id)}>
            {s.label} <span className="muted mono" style={{ marginLeft: 4 }}>{ORDERS.filter(o => o.stage === s.id).length}</span>
          </div>
        ))}
      </div>

      <div className="fbar">
        <button className="btn"><Icon name="filter" size={12}/>Filters · 0</button>
        <button className="btn">Group: Stage</button>
        <button className="btn">Sort: Due date</button>
        <button className="btn">Color</button>
        <div style={{ flex: 1 }}/>
        <input type="text" placeholder="Find any order, design, party…"/>
        <button className="btn">Save view</button>
      </div>

      <div className="card">
        <div style={{ overflow: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: 'center' }}>#</th>
                <th>ID</th>
                <th>PO Number</th>
                <th>Party</th>
                <th>Design</th>
                <th>Size</th>
                <th>Finish</th>
                <th>Brand</th>
                <th className="num" style={{ textAlign: 'right' }}>Order Qty</th>
                <th>Progress</th>
                <th className="num" style={{ textAlign: 'right' }}>Remaining</th>
                <th>Stage</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => {
                const remaining = o.orderQty - o.loadedQty;
                return (
                  <tr key={o.id}>
                    <td className="muted mono" style={{ textAlign: 'center' }}>{i + 1}</td>
                    <td className="mono muted">{o.id}</td>
                    <td className="mono" style={{ color: 'var(--fg)' }}>{o.poNumber}</td>
                    <td>
                      <span style={{ marginRight: 6 }}>{o.flag}</span>
                      {o.party}
                    </td>
                    <td><span className="design-name">{o.design}</span></td>
                    <td><span className={`chip size ${o.size.startsWith('200') || o.size.startsWith('75') ? 'b' : ''}`}>{o.size}</span></td>
                    <td><span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span></td>
                    <td><span className={`chip brand ${o.brand === 'BIG' ? 'big' : ''}`}>{o.brand}</span></td>
                    <td className="num">{fmt(o.orderQty)}</td>
                    <td style={{ width: 140 }}>
                      <SplitBar produced={o.producedQty} palletized={o.palletizedQty} loaded={o.loadedQty} total={o.orderQty}/>
                    </td>
                    <td className="num">{fmt(remaining)}</td>
                    <td><StageBadge stage={o.stage}/></td>
                    <td className="mono muted">{o.dueDate}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Production view ---------------- */
function Production() {
  const prodOrders = ORDERS.filter(o => o.stage === 'prod' || o.stage === 'packing');
  // Group by size
  const grouped = {};
  prodOrders.forEach(o => { (grouped[o.size] ||= []).push(o); });
  const sizes = Object.keys(grouped);

  const totalProd = prodOrders.reduce((s, o) => s + o.producedQty, 0);
  const totalRem  = prodOrders.reduce((s, o) => s + (o.orderQty - o.producedQty), 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Production</div>
          <div className="sub">{prodOrders.length} active jobs · Plant Morbi · Shift A (07:00–15:00)</div>
        </div>
        <div className="right">
          <button className="hbtn"><Icon name="calendar" size={13}/>26 May 2026</button>
          <button className="hbtn primary"><Icon name="plus" size={13}/>Log Production</button>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KPI label="Produced Today"   value={fmt(totalProd / 1000) + 'k'} unit="sqm" delta="+4.2k vs target" trend="up" spark={[5,6,7,9,8,10,12]} color="var(--c-blue)"/>
        <KPI label="Remaining"        value={fmt(totalRem / 1000) + 'k'}  unit="sqm" delta="across 25 SKUs" spark={[12,10,9,8,7,6,5]} color="var(--c-amber)"/>
        <KPI label="On-Time %"        value="94"     unit="%"   delta="+2.1% MoM" trend="up" spark={[6,7,8,9,8,9,10]} color="var(--c-green)"/>
        <KPI label="Yield (Premium)"  value="88.4"   unit="%"   delta="-0.8% vs avg" trend="down" spark={[9,8,9,7,8,7,8]} color="var(--c-violet)"/>
      </div>

      <div className="sec-title">
        <h2>Active jobs</h2>
        <span className="meta">Grouped by size</span>
      </div>

      {sizes.map(size => (
        <div key={size} className="card" style={{ marginBottom: 12 }}>
          <div className="card-head">
            <span className={`chip size ${size.startsWith('200') || size.startsWith('75') ? 'b' : ''}`}>{size}</span>
            <span className="muted">· {grouped[size].length} jobs · {fmt(grouped[size].reduce((s, o) => s + o.orderQty, 0))} sqm</span>
            <div className="right muted">Tap a row to log production</div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Design</th>
                <th>Finish</th>
                <th>Party</th>
                <th>PO</th>
                <th className="num" style={{ textAlign: 'right' }}>Ordered</th>
                <th className="num" style={{ textAlign: 'right' }}>Produced</th>
                <th className="num" style={{ textAlign: 'right' }}>Today</th>
                <th>Progress</th>
                <th>Last update</th>
              </tr>
            </thead>
            <tbody>
              {grouped[size].slice(0, 8).map(o => (
                <tr key={o.id}>
                  <td><span className="design-name">{o.design}</span></td>
                  <td><span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span></td>
                  <td>{o.flag} {o.party}</td>
                  <td className="mono">{o.poNumber}</td>
                  <td className="num">{fmt(o.orderQty)}</td>
                  <td className="num" style={{ color: 'var(--c-blue)' }}>{fmt(o.producedQty)}</td>
                  <td className="num" style={{ color: 'var(--c-green)' }}>+{fmt(Math.round(o.producedQty * 0.12))}</td>
                  <td style={{ width: 160 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <ProgressBar value={o.producedQty} max={o.orderQty} color="var(--c-blue)" height={5}/>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{pct(o.producedQty, o.orderQty)}%</span>
                    </div>
                  </td>
                  <td className="muted mono">26/4 · 14:32</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { Dashboard, Kanban, OrdersTable, Production, KPI });
