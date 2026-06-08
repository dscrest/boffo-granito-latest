/* Print-mode app — renders every view, one per page */

const VIEWS_TO_PRINT = [
  { id: 'dashboard', label: 'Dashboard',         Comp: window.Dashboard       },
  { id: 'kanban',    label: 'Pipeline · Kanban', Comp: window.Kanban          },
  { id: 'orders',    label: 'All Orders',        Comp: window.OrdersTable     },
  { id: 'po',        label: 'Purchase Orders',   Comp: window.PurchaseOrders  },
  { id: 'prod',      label: 'Production',        Comp: window.Production      },
  { id: 'packing',   label: 'Pallet Packing',    Comp: window.PalletPacking   },
  { id: 'loading',   label: 'Loading',           Comp: window.Loading         },
  { id: 'final',     label: 'Final Loading',     Comp: window.FinalLoading    },
  { id: 'design',    label: 'Design Master',     Comp: window.DesignMaster    },
];

function PrintApp() {
  return (
    <div className="print-root">
      {VIEWS_TO_PRINT.map(v => {
        const Comp = v.Comp;
        return (
          <section className="print-page" key={v.id}>
            <header className="print-header">
              <div className="print-brand">
                <div className="print-mark">B</div>
                <div className="print-name">BOFFO</div>
                <div className="print-ver">Order OS · v4.0</div>
              </div>
              <div className="print-section">{v.label}</div>
              <div className="print-page-no">{VIEWS_TO_PRINT.indexOf(v) + 1} / {VIEWS_TO_PRINT.length}</div>
            </header>
            <div className="print-body">
              <Comp/>
            </div>
          </section>
        );
      })}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PrintApp/>);

/* Auto-print once fonts + babel are settled */
(async () => {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch (_) {}
  await new Promise(r => setTimeout(r, 800));
  window.print();
})();
