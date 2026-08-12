/*
=========================================================
NEYO — SMART COMPOSER EXPAND
Collision-safe final version

Important:
Uses ONLY:
.is-writing-expanded

It does NOT use legacy:
.is-expanded
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
       COMPACT TEXTAREA
       ===================================================== */

    function restoreCompactTextarea() {
      textarea.style.height = "auto";

      if (!textarea.value.trim()) {
        textarea.style.height = "38px";
        return;
      }

      textarea.style.height =
        `${Math.min(
          textarea.scrollHeight,
          132
        )}px`;
    }


    /* =====================================================
       SMART BUTTON VISIBILITY
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
       Icon + Tooltip + ARIA
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

      /*
      Native browser tooltip
      */
      button.title = label;

      /*
      NEYO custom tooltip system
      */
      button.dataset.tooltip = label;

      button.innerHTML =
        expanded
          ? '<i data-lucide="minimize-2" size="16"></i>'
          : '<i data-lucide="maximize-2" size="16"></i>';

      if (
        window.lucide &&
        typeof window.lucide.createIcons === "function"
      ) {
        try {
          window.lucide.createIcons();
        } catch {
          // Safe fallback.
        }
      }
    }


    /* =====================================================
       RENDER
       ===================================================== */

    function renderState() {
      composer.classList.toggle(
        "is-writing-expanded",
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
       EXPAND
       ===================================================== */

    function expandComposer() {
      if (expanded) {
        return;
      }

      expanded = true;

      composer.classList.add(
        "is-writing-expanded"
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
       COLLAPSE
       ===================================================== */

    function collapseComposer() {
      if (!expanded) {
        return;
      }

      expanded = false;

      composer.classList.remove(
        "is-writing-expanded"
      );

      restoreCompactTextarea();

      syncButtonState();
      syncVisibility();

      requestAnimationFrame(() => {
        textarea.focus({
          preventScroll: true
        });
      });
    }


    /* =====================================================
       TOGGLE
       ===================================================== */

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
      const isEmpty =
        !textarea.value.trim();

      /*
      Empty composer must always return
      to compact mode.
      */

      if (isEmpty) {
        expanded = false;

        composer.classList.remove(
          "is-writing-expanded"
        );

        restoreCompactTextarea();

        syncButtonState();
        syncVisibility();

        return;
      }

      /*
      Do not interfere with legacy
      textarea resizing while user types.
      */

      syncVisibility();
    }


    /* =====================================================
       BUTTON CLICK
       ===================================================== */

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        toggleComposer();
      }
    );


    /* =====================================================
       TEXTAREA INPUT
       ===================================================== */

    textarea.addEventListener(
      "input",
      () => {
        /*
        Allow neo.js to finish its own
        resize logic first.
        */

        requestAnimationFrame(
          syncAfterInput
        );
      }
    );


    /* =====================================================
       ESCAPE
       ===================================================== */

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
       PROGRAMMATIC CHANGES
       Covers:
       - Send
       - New chat
       - Clear
       - Draft restore
       ===================================================== */

    window.setInterval(() => {
      const currentValue =
        textarea.value;

      if (
        currentValue ===
        previousValue
      ) {
        return;
      }

      previousValue =
        currentValue;

      syncAfterInput();
    }, 180);


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    expanded = false;

    composer.classList.remove(
      "is-writing-expanded"
    );

    restoreCompactTextarea();

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
