/* ============================================================
   Order Detail Drawer — opens when a PO / order is clicked
   Shows: stage timeline, line items, specs, packing, activity
   ============================================================ */

function OrderDrawer({ order, onClose }) {
  // Find all line items in the same PO
  const lineItems = useMemo(
    () => ORDERS.filter(o => o.poNumber === order.poNumber && o.partyCode === order.partyCode),
    [order.poNumber, order.partyCode]
  );

  const totals = useMemo(() => lineItems.reduce((a, o) => ({
    qty: a.qty + o.orderQty,
    produced: a.produced + o.producedQty,
    palletized: a.palletized + o.palletizedQty,
    loaded: a.loaded + o.loadedQty,
    boxes: a.boxes + o.totalBoxes,
    pallets: a.pallets + o.pallets,
  }), { qty: 0, produced: 0, palletized: 0, loaded: 0, boxes: 0, pallets: 0 }), [lineItems]);

  const stageIdx = STAGES.findIndex(s => s.id === order.stage);

  // Esc to close
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const [tab, setTab] = useState('overview');

  return (
    <>
      <div className="drawer-scrim" onClick={onClose}/>
      <aside className="drawer" role="dialog" aria-label="Order detail">
        <div className="drawer-head">
          <div className="meta">
            <div className="id">PO · {order.poNumber} <span style={{ marginLeft: 8 }}>{order.flag} {order.party}</span></div>
            <div className="title">
              {lineItems.length === 1
                ? order.design
                : <>{lineItems.length} line items · {fmt(totals.qty)} sqm total</>}
            </div>
          </div>
          <div className="actions">
            <span className="li-badge">
              <Icon name="docs" size={10}/> PI · PO {order.stage === 'final' && '· INV'}
            </span>
            <button className="iconbtn" title="Print"><Icon name="download" size={14}/></button>
            <button className="iconbtn" title="More"><Icon name="more" size={14}/></button>
            <button className="iconbtn" title="Close" onClick={onClose} style={{ fontSize: 16 }}>×</button>
          </div>
        </div>

        <div className="drawer-body">
          {/* Stage timeline */}
          <div className="stage-timeline">
            {STAGES.map((s, i) => {
              const cls = i < stageIdx ? 'done' : i === stageIdx ? 'curr' : '';
              const when = i < stageIdx ? ['24 Apr', '02 May', '15 May', '22 May', '24 May'][i]
                         : i === stageIdx ? 'In progress' : '—';
              return (
                <div className={`stage-step ${cls}`} key={s.id}>
                  <div className="ring">{i < stageIdx ? <Icon name="check" size={11}/> : i + 1}</div>
                  <div className="name">{s.label}</div>
                  <div className="when">{when}</div>
                </div>
              );
            })}
          </div>

          {/* Mini stats */}
          <div className="mini-stats">
            <div className="mini-stat">
              <div className="l">Order Qty</div>
              <div className="v">{fmt(totals.qty)}<small>sqm</small></div>
              <div className="sub">{totals.boxes} boxes · {totals.pallets} pallets</div>
            </div>
            <div className="mini-stat">
              <div className="l">Produced</div>
              <div className="v" style={{ color: 'var(--c-blue)' }}>{pct(totals.produced, totals.qty)}<small>%</small></div>
              <div className="sub">{fmt(totals.produced)} of {fmt(totals.qty)} sqm</div>
            </div>
            <div className="mini-stat">
              <div className="l">Palletized</div>
              <div className="v" style={{ color: 'var(--c-violet)' }}>{pct(totals.palletized, totals.qty)}<small>%</small></div>
              <div className="sub">{Math.ceil(totals.palletized / 60 / 32)} pallets packed</div>
            </div>
            <div className="mini-stat">
              <div className="l">Loaded</div>
              <div className="v" style={{ color: 'var(--c-green)' }}>{pct(totals.loaded, totals.qty)}<small>%</small></div>
              <div className="sub">{order.invoice || 'pending invoice'}</div>
            </div>
          </div>

          {/* Tabs */}
          <div className="dtabs">
            <div className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
              Line items <span className="ct">{lineItems.length}</span>
            </div>
            <div className={`tab ${tab === 'packing' ? 'active' : ''}`} onClick={() => setTab('packing')}>
              Packing & pallets
            </div>
            <div className={`tab ${tab === 'docs' ? 'active' : ''}`} onClick={() => setTab('docs')}>
              Documents <span className="ct">{order.stage === 'final' ? 3 : 2}</span>
            </div>
            <div className={`tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>
              Activity
            </div>
          </div>

          {tab === 'overview' && <OverviewTab order={order} lineItems={lineItems}/>}
          {tab === 'packing' && <PackingTab order={order} lineItems={lineItems} totals={totals}/>}
          {tab === 'docs' && <DocsTab order={order}/>}
          {tab === 'activity' && <ActivityTab order={order}/>}
        </div>
      </aside>
    </>
  );
}

/* ----- Tabs ----- */
function OverviewTab({ order, lineItems }) {
  return (
    <div className="dgrid">
      <div className="dpanel">
        <div className="head">
          <Icon name="tile" size={12}/>
          Line items
          <span className="right">Click a row to drill into the SKU</span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 28, textAlign: 'center' }}>#</th>
              <th>Design</th>
              <th>Size</th>
              <th>Finish</th>
              <th className="num" style={{ textAlign: 'right' }}>Ordered</th>
              <th className="num" style={{ textAlign: 'right' }}>Produced</th>
              <th>Progress</th>
              <th>Stage</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((li, i) => (
              <tr key={li.id} className={`li-row clickable ${li.id === order.id ? 'current' : ''}`}>
                <td className="muted mono" style={{ textAlign: 'center' }}>{i + 1}</td>
                <td><span className="design-name">{li.design}</span></td>
                <td><span className={`chip size ${li.size.startsWith('200') || li.size.startsWith('75') ? 'b' : ''}`}>{li.size}</span></td>
                <td><span className={`chip finish ${finishClass(li.finish)}`}>{li.finish}</span></td>
                <td className="num">{fmt(li.orderQty)}</td>
                <td className="num">{fmt(li.producedQty)}</td>
                <td style={{ width: 130 }}>
                  <SplitBar produced={li.producedQty} palletized={li.palletizedQty} loaded={li.loadedQty} total={li.orderQty}/>
                </td>
                <td><StageBadge stage={li.stage}/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dpanel">
        <div className="head">
          <Icon name="docs" size={12}/>
          Order specs
        </div>
        <div className="spec-grid">
          <Spec l="PO Number"      v={order.poNumber} mono/>
          <Spec l="PI Reference"   v={`PI-${order.poNumber.replace('/', '-')}`} mono/>
          <Spec l="Party"          v={`${order.flag} ${order.party}`}/>
          <Spec l="Country"        v={order.country}/>
          <Spec l="Order Date"     v={order.orderDate} mono/>
          <Spec l="Due Date"       v={order.dueDate} mono/>
          <Spec l="Days from PI"   v={`${order.daysFromPI} days`}/>
          <Spec l="Priority"       v={order.priority.toUpperCase()}/>
          <Spec l="Brand"          v={order.brand}/>
          <Spec l="Boxes / Pallet" v={order.boxesPerPallet}/>
          <Spec l="Incoterm"       v="FOB Mundra"/>
          <Spec l="Container"      v="40 HC"/>
        </div>
      </div>
    </div>
  );
}

function PackingTab({ order, lineItems, totals }) {
  const palletsTotal = Math.max(1, Math.ceil(totals.qty / 60 / order.boxesPerPallet));
  const packed       = Math.ceil(totals.palletized / 60 / order.boxesPerPallet);
  const loaded       = Math.ceil(totals.loaded     / 60 / order.boxesPerPallet);
  const cells = Array.from({ length: palletsTotal }, (_, i) => {
    if (i < loaded) return 'loaded';
    if (i < packed) return 'packed';
    return 'empty';
  });

  return (
    <div className="dgrid">
      <div className="dpanel">
        <div className="head">
          <Icon name="palette" size={12}/>
          Pallets <span className="right">{palletsTotal} pallets total · {order.boxesPerPallet} boxes each</span>
        </div>
        <div className="pallet-grid">
          {cells.map((c, i) => <div key={i} className={`pallet-cell ${c}`}>{i + 1}</div>)}
        </div>
        <div style={{ display: 'flex', gap: 14, padding: '6px 14px 14px', fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="pallet-cell loaded" style={{ width: 12, height: 12 }}></span> Loaded {loaded}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="pallet-cell packed" style={{ width: 12, height: 12 }}></span> Packed {packed - loaded}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="pallet-cell empty" style={{ width: 12, height: 12, border: '1px solid var(--border)' }}></span> Remaining {palletsTotal - packed}</span>
        </div>
      </div>

      <div className="dpanel">
        <div className="head">
          <Icon name="truck" size={12}/>
          Shipment
        </div>
        <div className="spec-grid">
          <Spec l="Truck No."         v={order.stage === 'loading' || order.stage === 'final' ? 'TR-MH-04 GH 2384' : '—'} mono/>
          <Spec l="Dock"              v={order.stage === 'loading' ? 'Dock 2' : order.stage === 'final' ? 'Departed' : '—'}/>
          <Spec l="Invoice No."       v={order.invoice || 'pending'} mono/>
          <Spec l="Container Seal"    v={order.stage === 'final' ? 'SEAL-88421' : '—'} mono/>
          <Spec l="Loaded Pallets"    v={`${loaded} of ${palletsTotal}`}/>
          <Spec l="Loaded Boxes"      v={fmt(loaded * order.boxesPerPallet)}/>
          <Spec l="Net Weight"        v={`${fmt(loaded * order.boxesPerPallet * 28)} kg`}/>
          <Spec l="ETA Port"          v={order.stage === 'final' ? '28 May · Mundra' : '—'}/>
        </div>
      </div>
    </div>
  );
}

function DocsTab({ order }) {
  const docs = [
    { kind: 'Proforma Invoice', no: `PI-${order.poNumber.replace('/', '-')}`, date: order.orderDate, status: 'signed', size: '142 KB' },
    { kind: 'Purchase Order',   no: order.poNumber,                            date: order.orderDate, status: 'received', size: '208 KB' },
    ...(order.stage === 'final' ? [{ kind: 'Commercial Invoice', no: order.invoice, date: order.dueDate, status: 'issued', size: '188 KB' }] : []),
    { kind: 'Packing List',     no: `PL-${order.poNumber.replace('/', '-')}`, date: order.dueDate, status: order.stage === 'final' ? 'final' : 'draft', size: '96 KB' },
  ];
  return (
    <div className="dpanel">
      <div className="head"><Icon name="docs" size={12}/>Documents</div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Type</th>
            <th>Number</th>
            <th>Date</th>
            <th>Status</th>
            <th>Size</th>
            <th style={{ width: 60 }}></th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d, i) => (
            <tr key={i}>
              <td>{d.kind}</td>
              <td className="mono" style={{ color: 'var(--fg)' }}>{d.no}</td>
              <td className="mono muted">{d.date}</td>
              <td>
                <span className="pill" style={{
                  color: d.status === 'final' || d.status === 'signed' || d.status === 'issued' ? 'var(--c-green)' : 'var(--muted)',
                  borderColor: d.status === 'final' || d.status === 'signed' || d.status === 'issued' ? 'oklch(0.55 0.16 150 / 0.35)' : 'var(--border-2)',
                  background: d.status === 'final' || d.status === 'signed' || d.status === 'issued' ? 'oklch(0.55 0.16 150 / 0.10)' : 'var(--panel-2)',
                }}>{d.status}</span>
              </td>
              <td className="muted mono">{d.size}</td>
              <td style={{ textAlign: 'right' }}>
                <button className="iconbtn" style={{ width: 26, height: 26, display: 'inline-grid' }}><Icon name="download" size={12}/></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityTab({ order }) {
  const timeline = [
    { time: order.orderDate,     who: 'Kavita', action: 'created PO',           detail: `${order.poNumber} · ${order.party}`, tag: 'po' },
    { time: '02 May · 11:24',    who: 'Kavita', action: 'confirmed PI',         detail: `PI-${order.poNumber.replace('/', '-')} · signed by buyer`, tag: 'po' },
    ...(order.stage !== 'po' ? [
      { time: '08 May · 07:30',  who: 'Ramesh', action: 'started production',   detail: `${order.design} · ${order.size}`, tag: 'production' },
      { time: '15 May · 14:32',  who: 'Ramesh', action: 'updated production',   detail: `${fmt(order.producedQty)} sqm produced`, tag: 'production' },
    ] : []),
    ...(['packing', 'loading', 'final'].includes(order.stage) ? [
      { time: '18 May · 09:10',  who: 'Priya',  action: 'started packing',      detail: `${order.boxesPerPallet} boxes/pallet · ${order.pallets} pallets planned`, tag: 'packing' },
      { time: '22 May · 16:48',  who: 'Priya',  action: 'closed pallet batch',  detail: `[${order.boxesPerPallet}x${order.pallets}] · 26-04-2026`, tag: 'packing' },
    ] : []),
    ...(['loading', 'final'].includes(order.stage) ? [
      { time: '24 May · 11:15',  who: 'Anil',   action: 'truck assigned',       detail: 'TR-MH-04 GH 2384 · Dock 2', tag: 'loading' },
      { time: '24 May · 13:50',  who: 'Anil',   action: 'loaded',               detail: `${order.invoice || 'EX pending'} · ${fmt(order.loadedQty)} sqm`, tag: 'loading' },
    ] : []),
    ...(order.stage === 'final' ? [
      { time: '25 May · 09:00',  who: 'Suresh', action: 'invoice issued',       detail: `${order.invoice} · sent to buyer`, tag: 'final' },
    ] : []),
  ].reverse();

  return (
    <div className="dpanel">
      <div className="head">
        <Icon name="clock" size={12}/>
        Timeline
        <span className="right">{timeline.length} events</span>
      </div>
      <div className="activity">
        {timeline.map((a, i) => {
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
  );
}

function Spec({ l, v, mono }) {
  return (
    <div className="item">
      <div className="l">{l}</div>
      <div className={`v ${mono ? 'mono' : ''}`}>{v}</div>
    </div>
  );
}

Object.assign(window, { OrderDrawer });
