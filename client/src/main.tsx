import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { AuthGate } from "./AuthGate";
import { SharedQuote } from "./features/quotes/SharedQuote";
import { SharedPallet } from "./features/stages/SharedPallet";
import { SharedBatch } from "./features/stages/SharedBatch";
import App from "./App";
import "./styles/styles.css";

// HashRouter: routes live in the URL fragment (e.g. /app/index.html#/pipeline),
// so deep links and refreshes work on Catalyst static hosting without any
// server-side rewrite — the host only ever serves /app/index.html.
//
// #/share/quote/<token> (customer quote), #/share/box/<token> (pallet QR
// label) and #/share/batch/<token> (batch QR slip) are public views — they
// must render OUTSIDE AuthGate so anyone can open them without a sign-in.
const isPublicShare = window.location.hash.startsWith("#/share/quote/");
const isPublicPallet = window.location.hash.startsWith("#/share/box/");
const isPublicBatch = window.location.hash.startsWith("#/share/batch/");

// After a deploy, a tab opened on the previous build may lazy-load a chunk
// whose hashed filename no longer exists — the click then appears to break
// or reload the page. Recover by reloading once onto the new build.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPublicShare ? (
      <SharedQuote />
    ) : isPublicPallet ? (
      <SharedPallet />
    ) : isPublicBatch ? (
      <SharedBatch />
    ) : (
      <AuthGate>
        <HashRouter>
          <App />
        </HashRouter>
      </AuthGate>
    )}
  </StrictMode>,
);
