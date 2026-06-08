/* ============================================================
   Card quick-view popover
   Shows only line items in a PO with their stage — no other panels
   ============================================================ */

function QuickView({ order, anchorRect, onClose, onOpenFull }) {
  const lineItems = useMemo(
    () => ORDERS.filter(o => o.poNumber === order.poNumber && o.partyCode === order.partyCode),
    [order.poNumber, order.partyCode]
  );

  // Position the popover next to the anchor card
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  useEffect(() => {
    const place = () => {
      const node = popRef.current;
      if (!node || !anchorRect) return;
      const PW = node.offsetWidth || 360;
      const PH = node.offsetHeight || 200;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Try right of card; if not enough space, place left
      let left = anchorRect.right + margin;
      if (left + PW > vw - 12) left = anchorRect.left - PW - margin;
      if (left < 12) left = Math.max(12, vw - PW - 12);

      // Vertically align top, clamp inside viewport
      let top = anchorRect.top;
      if (top + PH > vh - 12) top = Math.max(12, vh - PH - 12);
      if (top < 12) top = 12;

      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRect]);

  // Outside click + escape
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    const onDown = e => {
      if (popRef.current && !popRef.current.contains(e.target)) {
        // Ignore clicks on the quick-btn itself (it toggles)
        if (!e.target.closest('.quick-btn')) onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const totals = lineItems.reduce((a, o) => ({
    qty: a.qty + o.orderQty,
    items: a.items + 1,
  }), { qty: 0, items: 0 });

  // Stage distribution for footer
  const stageCounts = lineItems.reduce((m, o) => { m[o.stage] = (m[o.stage] || 0) + 1; return m; }, {});

  return (
    <div ref={popRef} className="qv-pop" style={{ top: pos.top, left: pos.left }} onClick={e => e.stopPropagation()}>
      <div className="qv-head">
        <div>
          <div className="lbl">Line items in PO</div>
          <div className="po">{order.poNumber} · {order.flag} {order.party}</div>
        </div>
        <div className="right">
          <span>{totals.items} items · {fmt(totals.qty)} sqm</span>
        </div>
      </div>

      <div className="qv-list">
        {lineItems.map((li, i) => {
          const progress = li.stage === 'po' ? 0 :
            li.stage === 'prod' ? pct(li.producedQty, li.orderQty) :
            li.stage === 'packing' ? pct(li.palletizedQty, li.orderQty) :
            li.stage === 'loading' ? pct(li.loadedQty, li.orderQty) :
            100;
          const barColor = li.stage === 'prod' ? 'var(--c-blue)'
                         : li.stage === 'packing' ? 'var(--c-violet)'
                         : li.stage === 'loading' ? 'var(--c-cyan)'
                         : li.stage === 'final' ? 'var(--c-green)'
                         : 'var(--c-amber)';
          return (
            <div
              key={li.id}
              className={`qv-item ${li.id === order.id ? 'current' : ''}`}
              onClick={() => { onOpenFull(li); }}
            >
              <div className="num">{i + 1}</div>
              <div className="body">
                <div className="design">{li.design}</div>
                <div className="specs">
                  <span className={`chip size ${li.size.startsWith('200') || li.size.startsWith('75') ? 'b' : ''}`}>{li.size}</span>
                  <span className={`chip finish ${finishClass(li.finish)}`}>{li.finish}</span>
                </div>
                <div className="qline">
                  <span className="mono">{fmt(li.orderQty)}</span>
                  <span>sqm ordered</span>
                  {li.stage !== 'po' && (
                    <>
                      <span>·</span>
                      <span className="mono">{progress}%</span>
                      <span>{li.stage === 'prod' ? 'produced' : li.stage === 'packing' ? 'packed' : li.stage === 'loading' ? 'loaded' : 'complete'}</span>
                    </>
                  )}
                </div>
                {li.stage !== 'po' && (
                  <div className="progress">
                    <ProgressBar value={progress} max={100} color={barColor} height={3}/>
                  </div>
                )}
              </div>
              <div className="stage-col">
                <span className={`stage xs ${STAGES.find(s => s.id === li.stage).color}`}>
                  <span className={`dot ${STAGES.find(s => s.id === li.stage).color}`}/>
                  {STAGES.find(s => s.id === li.stage).short}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="qv-foot">
        <span>{Object.entries(stageCounts).map(([id, n]) => {
          const s = STAGES.find(x => x.id === id);
          return <span key={id} style={{ marginRight: 8 }}><span className={`dot ${s.color}`} style={{ marginRight: 4 }}/>{n} {s.short}</span>;
        })}</span>
        <button className="btn" onClick={() => onOpenFull(order)}>
          Open full details <Icon name="arrow-r" size={11}/>
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { QuickView });
