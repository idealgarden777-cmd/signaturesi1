/* =========================================================
   NEYO APP SHELL
   File: src/App.tsx

   Purpose:
   - Safe React migration entry
   - Does NOT replace current NEYO UI yet
   - Provides isolated mount area for new TSX features
   ========================================================= */

import { useEffect } from "react";

function App() {
  useEffect(() => {
    /*
     * Migration marker.
     * Useful for debugging during the transition.
     */
    document.documentElement.dataset.neyoReact = "ready";

    return () => {
      delete document.documentElement.dataset.neyoReact;
    };
  }, []);

  return (
    <div
      id="neyoReactBridge"
      aria-hidden="true"
      style={{
        display: "none",
      }}
    />
  );
}

export default App;
