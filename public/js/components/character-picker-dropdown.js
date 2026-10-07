/*
=========================================================
NEYO — CHARACTER PICKER DROPDOWN POSITION v1
Anchors the character picker card to #characterPickerBtn
like the model menu dropdown. Position only; all picker
logic stays in character-picker.js.
=========================================================
*/
(() => {
  "use strict";

  const GAP = 8;
  const EDGE = 12;

  function place() {
    const shell = document.getElementById("characterPicker");
    const trigger = document.getElementById("characterPickerBtn");
    if (!shell || !trigger) return;

    const rect = trigger.getBoundingClientRect();
    const panel = shell.querySelector(".character-picker-panel");
    const panelWidth = panel ? panel.offsetWidth || 240 : 240;
    const panelHeight = panel ? panel.offsetHeight || 0 : 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const half = panelWidth / 2;
    const center = Math.min(
      Math.max(rect.left + rect.width / 2, EDGE + half),
      vw - EDGE - half
    );
    shell.style.setProperty("--cp-left", `${Math.round(center)}px`);

    const spaceAbove = rect.top - GAP - EDGE;
    const spaceBelow = vh - rect.bottom - GAP - EDGE;

    if (spaceAbove >= panelHeight || spaceAbove >= spaceBelow) {
      shell.style.setProperty("--cp-top", "auto");
      shell.style.setProperty("--cp-bottom", `${Math.round(vh - rect.top + GAP)}px`);
    } else {
      shell.style.setProperty("--cp-bottom", "auto");
      shell.style.setProperty("--cp-top", `${Math.round(rect.bottom + GAP)}px`);
    }
  }

  function init() {
    const shell = document.getElementById("characterPicker");
    if (!shell) return;

    new MutationObserver(() => {
      if (shell.classList.contains("is-open")) {
        place();
        requestAnimationFrame(place);
      }
    }).observe(shell, { attributes: true, attributeFilter: ["class"] });

    const refresh = () => {
      if (shell.classList.contains("is-open")) place();
    };
    window.addEventListener("resize", refresh, { passive: true });
    window.addEventListener("orientationchange", refresh, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
