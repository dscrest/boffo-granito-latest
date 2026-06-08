import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { AuthGate } from "./AuthGate";
import App from "./App";
import "./styles/styles.css";

// HashRouter: routes live in the URL fragment (e.g. /app/index.html#/pipeline),
// so deep links and refreshes work on Catalyst static hosting without any
// server-side rewrite — the host only ever serves /app/index.html.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      <HashRouter>
        <App />
      </HashRouter>
    </AuthGate>
  </StrictMode>,
);
