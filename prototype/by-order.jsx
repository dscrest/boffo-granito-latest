/* ============================================================
   By Order — grouped view
   Each PO = one group with summary rail + nested line items table
   ============================================================ */

function ByOrderView() {
  const [openDrawer, setOpenDrawer] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [partyFilter, setPartyFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [sortBy, setSortBy] = useState('progress'); // progress | date | qty | party

  // Group ORDERS by (poNumber + party)
  const groups = useMemo(() => {
    const m = {};
    ORDERS.forEach(o => {
      const key = `${o.poNumber}__${o.partyCode}`;
      if (!m[key]) {
        m[key] = {
          key,
          poNumber: o.poNumber,
          partyCode: o.partyCode,
          party: o.party,
          country: o.country,
          flag: o.flag,
          orderDate: o.orderDate,
          dueDate: o.dueDate,
          items: [],
        };
      }
      m[key].items.push(o);
    });
    return Object.values(m).map(g => {
      const totals = g.items.reduce((a, o) => ({
        qty: a.qty + o.orderQty,
        produced: a.produced + o.producedQty,
        palletized: a.palletized + o.palletizedQty,
        loaded: a.loaded + o.loadedQty,
      }), { qty: 0, produced: 0, palletized: 0, loaded: 0 });

      const stageDist = {};
      STAGES.forEach(s => stageDist[s.id] = 0);
      g.items.forEach(o => { stageDist[o.stage]++; });

      // earliest stage = bottleneck
      const minStageIdx = Math.min(...g.items.map(o => STAGES.findIndex(s => s.id === o.stage)));

      return { ...g, totals, stageDist, minStageIdx, progress: pct(totals.loaded, totals.qty) };
    });
  }, []);

  // Filter + sort
  const visible = useMemo(() => {
    let arr = groups;
    if (partyFilter !== 'all') arr = arr.filter(g => g.partyCode === partyFilter);
    if (stageFilter !== 'all') arr = arr.filter(g => g.items.some(o => o.stage === stageFilter));
    arr = [...arr].sort((a, b) => {
      if (sortBy === 'progress') return a.progress - b.progress;
      if (sortBy === 'qty')      return b.totals.qty - a.totals.qty;
      if (sortBy === 'party')    return a.party.localeCompare(b.party);
      return 0;
    });
    return arr;
  }, [groups, partyFilter, stageFilter, sortBy]);

  const toggle = key => setCollapsed(s => ({ ...s, [key]: !s[key] }));
  const allCollapsed = visible.every(g => collapsed[g.key]);
  const toggleAll = () => {
    const next = {};
    if (!allCollapsed) visible.forEach(g => { next[g.key] = true; });
    setCollapsed(next);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Orders — by PO</div>
          <div className="sub">{visible.length} POs · {visible.reduce((s, g) => s + g.items.length, 0)} line items · grouped view of the pipeline</div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={toggleAll}>
            <Icon name="kanban" size={13}/>
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
          <button className="hbtn"><Icon name="download" size={13}/>Export</button>
          <button className="hbtn primary"><Icon name="plus" size={13}/>New PO</button>
        </div>
      </div>

      <div className="fbar">
        <button className={`btn ${partyFilter === 'all' ? 'active' : ''}`} onClick={() => setPartyFilter('all')}>All parties</button>
        {PARTIES.map(p => (
          <button key={p.code} className={`btn ${partyFilter === p.code ? 'active' : ''}`} onClick={() => setPartyFilter(p.code)}>
            {p.name}
          </button>
        ))}
        <div style={{ width: 1, height: 18, background: 'var(--border)' }}/>
        <button className={`btn ${stageFilter === 'all' ? 'active' : ''}`} onClick={() => setStageFilter('all')}>Any stage</button>
        {STAGES.map(s => (
          <button key={s.id} className={`btn ${stageFilter === s.id ? 'active' : ''}`} onClick={() => setStageFilter(s.id)}>
            <span className={`dot ${s.color}`}/>{s.short}
          </button>
        ))}
        <div style={{ flex: 1 }}/>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          style={{
            height: 26, padding: '0 8px', borderRadius: 5,
            border: '1px solid var(--border-2)', background: 'var(--panel-2)',
            color: 'var(--fg-2)', fontSize: 11.5, outline: 'none',
          }}>
          <option value="progress">Sort: Least progress first</option>
          <option value="qty">Sort: Largest qty</option>
          <option value="party">Sort: Party A-Z</option>
        </select>
      </div>

      <div className="bypo-list">
        {visible.map(g => (
          <ByOrderGroup
            key={g.key}
            group={g}
            collapsed={!!collapsed[g.key]}
            onToggle={() => toggle(g.key)}
            onOpenLineItem={setOpenDrawer}
          />
        ))}
      </div>

      {openDrawer && <OrderDrawer order={openDrawer} onClose={() => setOpenDrawer(null)}/>}
    </div>
  );
}

function ByOrderGroup({ group, collapsed, onToggle, onOpenLineItem }) {
  const { totals, stageDist, items } = group;
  const bottleneckStage = STAGES[group.minStageIdx];

  return (
    <div className={`bypo-group ${collapsed ? 'collapsed' : ''}`}>
      <div className="bypo-rail">
        {!collapsed && <div className="po-lbl">Purchase Order</div>}
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <button className="bypo-toggle" onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'}>
            <Icon name={collapsed ? 'chev-r' : 'arrow-down'} size={11}/>
          </button>
          <div className="po-num">{group.poNumber}</div>
          {!collapsed && <span className="li-badge" style={{ marginLeft: 'auto' }}>{items.length} items</span>}
        </div>
        <div className="party-name">
          <span>{group.flag}</span>
          <span>{group.party}</span>
          <span className="country">· {group.country}</span>
        </div>

        {!collapsed && (
          <>
            <div className="rail-stats">
              <div className="stat">
                <div className="l">Order Qty</div>
                <div className="v">{fmt(totals.qty)} <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-sans)' }}>sqm</span></div>
              </div>
              <div className="stat">
                <div className="l">Line items</div>
                <div className="v">{items.length}</div>
              </div>
              <div className="stat">
                <div className="l">Produced</div>
                <div className="v" style={{ color: 'var(--c-blue)' }}>{pct(totals.produced, totals.qty)}%</div>
              </div>
              <div className="stat">
                <div className="l">Loaded</div>
                <div className="v" style={{ color: 'var(--c-green)' }}>{pct(totals.loaded, totals.qty)}%</div>
              </div>
            </div>

            <div className="rail-progress">
              <SplitBar produced={totals.produced} palletized={totals.palletized} loaded={totals.loaded} total={totals.qty}/>
            </div>

            <div className="rail-stage-dist">
              {STAGES.map(s => stageDist[s.id] > 0 && (
                <div className="row" key={s.id}>
                  <span className={`dot ${s.color}`}/>
                  <span>{s.label}</span>
                  <span className="ct">{stageDist[s.id]}</span>
                </div>
              ))}
            </div>

            <div className="rail-footer">
              <Icon name="calendar" size={10}/>
              <span>Due</span>
              <span className="mono">{group.dueDate}</span>
              <span style={{ marginLeft: 'auto' }}>
                <span className={`stage xs ${bottleneckStage.color}`}>
                  <span className={`dot ${bottleneckStage.color}`}/>
                  at {bottleneckStage.short}
                </span>
              </span>
            </div>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="bypo-items">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}>#</th>
                <th>Design</th>
                <th>Size</th>
                <th>Finish</th>
                <th>Brand</th>
                <th className="num" style={{ textAlign: 'right' }}>Ordered</th>
                <th className="num" style={{ textAlign: 'right' }}>Produced</th>
                <th className="num" style={{ textAlign: 'right' }}>Loaded</th>
                <th>Progress</th>
                <th>Stage</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((li, i) => (
                <tr
                  key={li.id}
                  className="clickable"
                  onClick={() => onOpenLineItem(li)}
                >
                  <td className="li-num">{i + 1}</td>
                  <td className="li-design">
                    {li.design}
                    <small>{li.id}</small>
                  </td>
                  <td><span className={`chip size ${li.size.startsWith('200') || li.size.startsWith('75') ? 'b' : ''}`}>{li.size}</span></td>
                  <td><span className={`chip finish ${finishClass(li.finish)}`}>{li.finish}</span></td>
                  <td><span className={`chip brand ${li.brand === 'BIG' ? 'big' : ''}`}>{li.brand}</span></td>
                  <td className="num">{fmt(li.orderQty)}</td>
                  <td className="num" style={{ color: li.producedQty > 0 ? 'var(--c-blue)' : 'var(--dim)' }}>{li.producedQty > 0 ? fmt(li.producedQty) : '—'}</td>
                  <td className="num" style={{ color: li.loadedQty > 0 ? 'var(--c-green)' : 'var(--dim)' }}>{li.loadedQty > 0 ? fmt(li.loadedQty) : '—'}</td>
                  <td style={{ width: 130 }}>
                    <SplitBar produced={li.producedQty} palletized={li.palletizedQty} loaded={li.loadedQty} total={li.orderQty}/>
                  </td>
                  <td><StageBadge stage={li.stage}/></td>
                  <td className="expand-cell"><Icon name="chev-r" size={12}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ByOrderView });
