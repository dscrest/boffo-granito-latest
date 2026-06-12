import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { AuthGate } from "./AuthGate";
import { SharedQuote } from "./features/quotes/SharedQuote";
import App from "./App";
import "./styles/styles.css";

// HashRouter: routes live in the URL fragment (e.g. /app/index.html#/pipeline),
// so deep links and refreshes work on Catalyst static hosting without any
// server-side rewrite — the host only ever serves /app/index.html.
//
// #/share/quote/<token> is the public quote view — it must render OUTSIDE
// AuthGate so customers can open it without a Zoho sign-in.
const isPublicShare = window.location.hash.startsWith("#/share/quote/");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPublicShare ? (
      <SharedQuote />
    ) : (
      <AuthGate>
        <HashRouter>
          <App />
        </HashRouter>
      </AuthGate>
    )}
  </StrictMode>,
);
