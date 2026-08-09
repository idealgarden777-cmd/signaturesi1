/* =========================================================
   NEYO REACT ENTRY
   File: src/main.tsx

   Purpose:
   - Mount React safely
   - Preserve current legacy UI
   - Avoid duplicate roots
   - Provide migration bridge for TSX features
   ========================================================= */

import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";


function ensureReactRoot(): HTMLElement {
  let root =
    document.getElementById(
      "neyo-react-root"
    );

  if (root) {
    return root;
  }

  root =
    document.createElement(
      "div"
    );

  root.id =
    "neyo-react-root";

  /*
   * Keep React isolated during migration.
   * New TSX features can later render portals
   * or full components from this root.
   */
  document.body.appendChild(
    root
  );

  return root;
}


function bootReactApp() {
  const rootElement =
    ensureReactRoot();

  /*
   * Prevent accidental double mount.
   */
  if (
    rootElement.dataset
      .reactMounted === "true"
  ) {
    return;
  }

  rootElement.dataset
    .reactMounted = "true";

  ReactDOM
    .createRoot(
      rootElement
    )
    .render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
}


if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    bootReactApp,
    {
      once: true,
    }
  );
} else {
  bootReactApp();
}
