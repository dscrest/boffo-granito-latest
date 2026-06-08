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
    payment_term: "Advance",
    port_of_discharge: "Mundra",
    status: "Accepted",
    currency: "EUR",
    remarks: "smoke test",
    address: "test addr",
    lines: [
      { item: "Desert Beige", qty: 100, rate: 5, discount: 10 },
      { item: "Onyx Gris", qty: 50, rate: 6, discount: 0 },
    ],
  });
  console.log(JSON.stringify(ins));
  const quoteId = ins.d && ins.d.rowid;

  console.log("2) list quotes (count)");
  const ql = await j("GET", "Quote?order=ROWID desc&limit=5");
  console.log("status", ql.status, "rows", ql.d && ql.d.rows && ql.d.rows.length);

  if (quoteId) {
    console.log("3) convert quote (full)");
    const cv = await j("POST", `convert-quote/${quoteId}`, {
      mode: "Full",
      order_number: "SO/SMOKE/001",
      payment_term: "Advance",
      lines: [
        { item: "Desert Beige", qty: 100, rate: 5 },
        { item: "Onyx Gris", qty: 50, rate: 6 },
      ],
    });
    console.log(JSON.stringify(cv));
  }

  console.log("4) list order items (count)");
  const ol = await j("GET", "OrderItem?order=ROWID desc&limit=5");
  console.log("status", ol.status, "rows", ol.d && ol.d.rows && ol.d.rows.length);

  console.log("5) operation log (latest 5)");
  const lg = await j("GET", "OperationLog?order=ROWID desc&limit=5");
  if (lg.d && lg.d.rows)
    lg.d.rows.forEach((r) =>
      console.log(` ${r.occurred_at} ${r.table_name} ${r.operation} -> ${r.status} (${r.duration_ms}ms) ${r.error_text || ""}`),
    );
  else console.log(JSON.stringify(lg));
};

main().catch((e) => { console.error(e); process.exit(1); });
