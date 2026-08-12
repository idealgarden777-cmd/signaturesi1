/*
=========================================================
NEYO — COMPOSER EXPAND
Stable in-place expand / collapse
=========================================================
*/

(() => {
  "use strict";

  function initComposerExpand() {
    const button = document.getElementById("composerExpandBtn");
    const composer = document.getElementById("glassInputContainer");
    const textarea = document.getElementById("chatInput");

    if (!button || !composer) return;

    let expanded = false;

    function render() {
      composer.classList.toggle("is-expanded", expanded);

      button.setAttribute(
        "aria-expanded",
        String(expanded)
      );

      button.setAttribute(
        "aria-label",
        expanded
          ? "Collapse composer"
          : "Expand composer"
      );

      button.title = expanded
        ? "Collapse composer"
        : "Expand composer";

      button.innerHTML = expanded
        ? '<i data-lucide="minimize-2" size="16"></i>'
        : '<i data-lucide="maximize-2" size="16"></i>';

      if (
        window.lucide &&
        typeof window.lucide.createIcons === "function"
      ) {
        window.lucide.createIcons();
      }

      requestAnimationFrame(() => {
        if (!textarea) return;

        textarea.focus({
          preventScroll: true
        });
      });
    }

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      expanded = !expanded;
      render();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && expanded) {
        expanded = false;
        render();
      }
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initComposerExpand,
      { once: true }
    );
  } else {
    initComposerExpand();
  }
})();
