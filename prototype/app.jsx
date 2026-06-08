/* ============================================================
   BOFFO Order OS — main app shell
   ============================================================ */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "oklch(0.55 0.16 150)",
  "density": "compact"
}/*EDITMODE-END*/;

function applyAccent(color) {
  const r = document.documentElement;
  r.style.setProperty('--accent', color);
  // build soft variant — for oklch, append alpha
  const soft = color.startsWith('oklch(') ? color.replace(/\)$/, ' / 0.12)') : color;
  r.style.setProperty('--accent-soft', soft);
}

const NAV_GROUPS = [
  {
    title: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard',   icon: 'dashboard' },
      { id: 'kanban',    label: 'Pipeline',    icon: 'kanban'    },
      { id: 'byorder',   label: 'By Order',    icon: 'orders'    },
      { id: 'orders',    label: 'All Orders',  icon: 'docs'      },
    ],
  },
  {
    title: 'Stages',
    items: [
      { id: 'po',       label: 'Purchase Orders', icon: 'docs'    },
      { id: 'prod',     label: 'Production',      icon: 'factory' },
      { id: 'packing',  label: 'Pallet Packing',  icon: 'palette' },
      { id: 'loading',  label: 'Loading',         icon: 'truck'   },
      { id: 'final',    label: 'Final Loading',   icon: 'invoice' },
    ],
  },
  {
    title: 'Masters',
    items: [
      { id: 'design',   label: 'Design Master',   icon: 'tile' },
      { id: 'parties',  label: 'Parties',         icon: 'flag' },
    ],
  },
];

const VIEW_LABELS = {
  dashboard: ['Workspace', 'Dashboard'],
  kanban:    ['Orders', 'Pipeline'],
  byorder:   ['Orders', 'By Order'],
  orders:    ['Orders', 'All Orders'],
  po:        ['Stages', 'Purchase Orders'],
  prod:      ['Stages', 'Production'],
  packing:   ['Stages', 'Pallet Packing'],
  loading:   ['Stages', 'Loading'],
  final:     ['Stages', 'Final Loading'],
  design:    ['Masters', 'Design Master'],
  parties:   ['Masters', 'Parties'],
};

function App() {
  const [view, setView] = useState('dashboard');
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  useEffect(() => { applyAccent(t.accent); }, [t.accent]);
  useEffect(() => {
    const d = t.density;
    document.documentElement.style.setProperty('--t-md', d === 'spacious' ? '13.5px' : '12.5px');
    document.documentElement.style.setProperty('--t-sm', d === 'spacious' ? '12px'   : '11.5px');
  }, [t.density]);

  // Counts for sidebar
  const counts = useMemo(() => {
    const c = { dashboard: '', kanban: ORDERS.length, orders: ORDERS.length };
    // Distinct POs for byorder
    const distinctPOs = new Set();
    ORDERS.forEach(o => distinctPOs.add(`${o.poNumber}__${o.partyCode}`));
    c.byorder = distinctPOs.size;
    STAGES.forEach(s => { c[s.id] = ORDERS.filter(o => o.stage === s.id).length; });
    c.design = DESIGNS.length;
    c.parties = PARTIES.length;
    return c;
  }, []);

  const crumbs = VIEW_LABELS[view] || ['', ''];

  const renderView = () => {
    switch (view) {
      case 'dashboard': return <Dashboard/>;
      case 'kanban':    return <Kanban/>;
      case 'byorder':   return <ByOrderView/>;
      case 'orders':    return <OrdersTable/>;
      case 'po':        return <PurchaseOrders/>;
      case 'prod':      return <Production/>;
      case 'packing':   return <PalletPacking/>;
      case 'loading':   return <Loading/>;
      case 'final':     return <FinalLoading/>;
      case 'design':    return <DesignMaster/>;
      case 'parties':   return <PartiesView/>;
      default: return <Dashboard/>;
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">B</div>
          <div className="name">BOFFO</div>
          <div className="ver">v4.0</div>
        </div>

        {NAV_GROUPS.map(g => (
          <div className="group" key={g.title}>
            <div className="group-title">{g.title}</div>
            {g.items.map(it => (
              <div key={it.id}
                className={`item ${view === it.id ? 'active' : ''}`}
                onClick={() => setView(it.id)}>
                <Icon name={it.icon} size={14} className="ic"/>
                <span>{it.label}</span>
                {counts[it.id] != null && counts[it.id] !== '' && <span className="count">{counts[it.id]}</span>}
              </div>
            ))}
          </div>
        ))}

        <div className="foot">
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="dot"/>
            <span style={{ color: 'var(--fg-2)' }}>Synced</span>
            <span style={{ marginLeft: 'auto', color: 'var(--dim)' }} className="mono">3s ago</span>
          </div>
          <div className="row" style={{ color: 'var(--dim)' }}>
            <Icon name="clock" size={11}/>
            <span>Plant Morbi · Shift A</span>
          </div>
        </div>
      </aside>

      <header className="header">
        <div className="crumbs">
          <Icon name="chev-r" size={12} style={{ opacity: 0.4 }}/>
          <span>{crumbs[0]}</span>
          <Icon name="chev-r" size={12} style={{ opacity: 0.4 }}/>
          <span className="cur">{crumbs[1]}</span>
        </div>
        <div className="search">
          <Icon name="search" size={13} className="icon"/>
          <input placeholder="Search PO, design, party, invoice…"/>
          <span className="kbd">⌘K</span>
        </div>
        <button className="hbtn" title="Notifications">
          <Icon name="bell" size={13}/>
          <span className="dot red" style={{ width: 5, height: 5, marginLeft: -3 }}/>
        </button>
        <button className="hbtn"><Icon name="settings" size={13}/></button>
        <div className="avatar">BG</div>
      </header>

      <main className="main">{renderView()}</main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Accent">
          <TweakColor
            label="Theme"
            value={t.accent}
            onChange={v => setTweak('accent', v)}
            options={[
              'oklch(0.55 0.16 150)',
              'oklch(0.55 0.13 210)',
              'oklch(0.55 0.20 295)',
              'oklch(0.62 0.16 70)',
              'oklch(0.58 0.20 25)',
            ]}
          />
        </TweakSection>
        <TweakSection label="Layout">
          <TweakRadio
            label="Density"
            value={t.density}
            options={['compact', 'spacious']}
            onChange={v => setTweak('density', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

/* ---------------- Parties view (small, simple) ---------------- */
function PartiesView() {
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Parties</div>
          <div className="sub">{PARTIES.length} active buyers across {new Set(PARTIES.map(p => p.country)).size} countries</div>
        </div>
        <div className="right">
          <button className="hbtn primary"><Icon name="plus" size={13}/>Add party</button>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {PARTIES.map(p => {
          const open = ORDERS.filter(o => o.partyCode === p.code);
          const qty = open.reduce((s, o) => s + o.orderQty, 0);
          const loaded = open.reduce((s, o) => s + o.loadedQty, 0);
          return (
            <div className="kpi" key={p.code}>
              <div className="label">{p.flag} {p.name} <span className="muted">· {p.country}</span></div>
              <div className="value">{open.length}<span className="unit">orders</span></div>
              <div className="delta">
                <span className="mono" style={{ color: 'var(--fg-2)' }}>{fmt(qty)}</span>
                <span className="muted">sqm total</span>
                <span className="muted">·</span>
                <span className="mono" style={{ color: 'var(--c-green)' }}>{pct(loaded, qty)}%</span>
                <span className="muted">loaded</span>
              </div>
              <div style={{ marginTop: 6 }}>
                <ProgressBar value={loaded} max={qty} color="var(--c-green)" height={4}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- mount ---------- */
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
