/*
=========================================================
NEYO — COMPOSER EXPAND
Stable in-place expand / collapse
=========================================================
*/

(() => {
  "use strict";

  function initComposerExpand() {
    const button =
      document.getElementById("composerExpandBtn");

    const composer =
      document.getElementById("glassInputContainer");

    const textarea =
      document.getElementById("chatInput");

    if (!button || !composer) return;

    let expanded = false;

    function restoreCompactTextarea() {
      if (!textarea) return;

      textarea.style.height = "auto";

      if (!textarea.value.trim()) {
        textarea.style.height = "38px";
        return;
      }

      textarea.style.height =
        `${Math.min(textarea.scrollHeight, 132)}px`;
    }

    function renderIcon() {
      button.innerHTML = expanded
        ? '<i data-lucide="minimize-2" size="16"></i>'
        : '<i data-lucide="maximize-2" size="16"></i>';

      if (
        window.lucide &&
        typeof window.lucide.createIcons === "function"
      ) {
        window.lucide.createIcons();
      }
    }

    function render() {
      composer.classList.toggle(
        "is-expanded",
        expanded
      );

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

      /* shorter premium tooltip */
      button.title =
        expanded ? "Collapse" : "Expand";

      renderIcon();

      if (!expanded) {
        requestAnimationFrame(() => {
          restoreCompactTextarea();
        });
      }

      requestAnimationFrame(() => {
        textarea?.focus({
          preventScroll: true
        });
      });
    }

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        expanded = !expanded;
        render();
      }
    );

    document.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Escape" &&
          expanded
        ) {
          expanded = false;
          render();
        }
      }
    );

    restoreCompactTextarea();
    renderIcon();
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
