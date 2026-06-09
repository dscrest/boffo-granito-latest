/* End-to-end smoke of the data-ops slice against the deployed dev domain.
   Inserts a quote, lists quotes, converts it, lists orders, reads the op log. */
const BASE =
  (process.env.SEED_HOST ||
    "https://boffo-latest-project-926227227.development.catalystserverless.com") + "/server/data-ops";

const j = async (method, path, body) => {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  let d;
  try { d = JSON.parse(t); } catch { d = t; }
  return { status: res.status, d };
};

const main = async () => {
  console.log("1) insert quote");
  const ins = await j("POST", "quote-with-items", {
    customer: "Merkury Market",
    quote_number: "QT/SMOKE/001",
    quote_date: "2026-06-08",
    expiry_date: "2026-07-08",
    payment_term: "Advance",
    port_of_discharge: "Mundra",
    status: "Accepted",
    currency: "EUR",
    remarks: "smoke test",
    address: "test addr",
    salesperson: "Smoke Bot",
    reference_no: "REF-SMOKE-1",
    customer_notes: "smoke customer note",
    terms: "Net 30; smoke terms",
    lines: [
      { item: "Desert Beige", qty: 100, rate: 5, discount: 10 },
      { item: "Onyx Gris", qty: 50, rate: 6, discount: 0 },
    ],
  });
  console.log(JSON.stringify(ins));
  const quoteId = ins.d && ins.d.rowid;

  console.log("2) read back quote — new Books-parity fields");
  const ql = await j("GET", `Quote/${quoteId}`);
  const qr = ql.d && ql.d.row;
  console.log("status", ql.status, "fields", JSON.stringify(qr && {
    expiry_date: qr.expiry_date, salesperson: qr.salesperson, reference_no: qr.reference_no,
    customer_notes: qr.customer_notes, terms: qr.terms, total_amount: qr.total_amount,
  }));

  if (quoteId) {
    console.log("3) convert quote (full)");
    const cv = await j("POST", `convert-quote/${quoteId}`, {
      mode: "Full",
      order_number: "SO/SMOKE/001",
      payment_term: "Advance",
      salesperson: "Smoke Bot",
      customer_notes: "so smoke note",
      terms: "so smoke terms",
      shipment_date: "2026-07-15",
      lines: [
        { item: "Desert Beige", qty: 100, rate: 5, discount: 10 },
        { item: "Onyx Gris", qty: 50, rate: 6, discount: 0 },
      ],
    });
    console.log(JSON.stringify(cv));
    const soId = cv.d && cv.d.rowid;
    if (soId) {
      const so = await j("GET", `SalesOrder/${soId}`);
      const sr = so.d && so.d.row;
      console.log(" SO fields", JSON.stringify(sr && {
        shipment_date: sr.shipment_date, salesperson: sr.salesperson,
        customer_notes: sr.customer_notes, terms: sr.terms, total_amount: sr.total_amount,
      }));
    }
  }

  console.log("4) list order items — new per-line amount fields");
  const ol = await j("GET", "OrderItem?order=ROWID desc&limit=2");
  console.log("status", ol.status);
  (ol.d && ol.d.rows ? ol.d.rows : []).forEach((r) =>
    console.log(` OrderItem rate=${r.rate} disc=${r.discount_pct} sub=${r.sub_total} final=${r.final_total}`),
  );

  console.log("5) operation log (latest 5)");
  const lg = await j("GET", "OperationLog?order=ROWID desc&limit=5");
  if (lg.d && lg.d.rows)
    lg.d.rows.forEach((r) =>
      console.log(` ${r.occurred_at} ${r.table_name} ${r.operation} -> ${r.status} (${r.duration_ms}ms) ${r.error_text || ""}`),
    );
  else console.log(JSON.stringify(lg));
};

main().catch((e) => { console.error(e); process.exit(1); });
