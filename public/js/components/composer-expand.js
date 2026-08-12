/*
=========================================================
NEYO — SMART COMPOSER EXPAND
Final stable UX behavior
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

    if (!button || !composer || !textarea) {
      return;
    }

    let expanded = false;
    let previousValue = textarea.value;


    /* =====================================================
       COMPACT RESET
       ===================================================== */

    function restoreCompactState() {
      expanded = false;

      composer.classList.remove("is-expanded");

      textarea.style.height = "auto";

      if (!textarea.value.trim()) {
        textarea.style.height = "38px";
      } else {
        textarea.style.height =
          `${Math.min(
            textarea.scrollHeight,
            132
          )}px`;
      }
    }


    /* =====================================================
       SMART VISIBILITY
       ===================================================== */

    function shouldShowExpand() {
      if (expanded) {
        return true;
      }

      const value =
        textarea.value || "";

      if (!value.trim()) {
        return false;
      }

      const explicitLines =
        value.split("\n").length;

      const visuallyLong =
        textarea.scrollHeight > 108;

      return (
        explicitLines >= 4 ||
        visuallyLong
      );
    }


    function syncVisibility() {
      const visible =
        shouldShowExpand();

      button.classList.toggle(
        "is-visible",
        visible
      );

      button.tabIndex =
        visible ? 0 : -1;

      button.setAttribute(
        "aria-hidden",
        String(!visible)
      );
    }


    /* =====================================================
       BUTTON STATE
       Single source of truth
       ===================================================== */

    function syncButtonState() {
      const label =
        expanded
          ? "Collapse"
          : "Expand";

      button.setAttribute(
        "aria-expanded",
        String(expanded)
      );

      button.setAttribute(
        "aria-label",
        `${label} composer`
      );

      button.title = label;

      /*
      Keep custom tooltip system
      synchronized with native title.
      */
      button.dataset.tooltip = label;

      button.innerHTML = expanded
        ? '<i data-lucide="minimize-2" size="16"></i>'
        : '<i data-lucide="maximize-2" size="16"></i>';

      if (
        window.lucide &&
        typeof window.lucide.createIcons ===
          "function"
      ) {
        window.lucide.createIcons();
      }
    }


    /* =====================================================
       STATE RENDER
       ===================================================== */

    function renderState() {
      composer.classList.toggle(
        "is-expanded",
        expanded
      );

      syncButtonState();
      syncVisibility();

      requestAnimationFrame(() => {
        textarea.focus({
          preventScroll: true
        });
      });
    }


    /* =====================================================
       ACTIONS
       ===================================================== */

    function expandComposer() {
      if (expanded) {
        return;
      }

      expanded = true;

      renderState();
    }


    function collapseComposer() {
      if (!expanded) {
        return;
      }

      restoreCompactState();

      syncButtonState();
      syncVisibility();

      requestAnimationFrame(() => {
        textarea.focus({
          preventScroll: true
        });
      });
    }


    function toggleComposer() {
      if (expanded) {
        collapseComposer();
      } else {
        expandComposer();
      }
    }


    /* =====================================================
       INPUT SYNC
       ===================================================== */

    function syncAfterInput() {
      const empty =
        !textarea.value.trim();

      if (empty) {
        restoreCompactState();

        syncButtonState();
        syncVisibility();

        return;
      }

      syncVisibility();
    }


    /* =====================================================
       EVENTS
       ===================================================== */

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        toggleComposer();
      }
    );


    textarea.addEventListener(
      "input",
      () => {
        /*
        Wait one frame so legacy neo.js
        finishes its own textarea resize.
        */

        requestAnimationFrame(
          syncAfterInput
        );
      }
    );


    document.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Escape" &&
          expanded
        ) {
          collapseComposer();
        }
      }
    );


    /* =====================================================
       PROGRAMMATIC TEXT CHANGES

       Covers:
       - send
       - new conversation
       - draft restore
       - programmatic clear
       ===================================================== */

    window.setInterval(() => {
      if (
        textarea.value ===
        previousValue
      ) {
        return;
      }

      previousValue =
        textarea.value;

      syncAfterInput();
    }, 180);


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    restoreCompactState();

    syncButtonState();
    syncVisibility();
  }


  /* =======================================================
     INIT
     ======================================================= */

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initComposerExpand,
      {
        once: true
      }
    );
  } else {
    initComposerExpand();
  }
})();
