/*
=========================================================
NEYO — SMART COMPOSER EXPAND
UX-first behavior
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


    /* =====================================================
       COMPACT TEXTAREA RESTORE
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


    function syncExpandVisibility() {
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
       ICON + ACCESSIBILITY
       ===================================================== */

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


    function syncAccessibility() {
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

      /*
      Keep native title short.
      Custom tooltip system can handle
      delayed tooltip later.
      */

      button.title =
        expanded
          ? "Collapse"
          : "Expand";
    }


    /* =====================================================
       STATE
       ===================================================== */

    function renderState() {
      composer.classList.toggle(
        "is-expanded",
        expanded
      );

      syncAccessibility();
      renderIcon();
      syncExpandVisibility();

      if (!expanded) {
        requestAnimationFrame(() => {
          restoreCompactTextarea();
        });
      }

      requestAnimationFrame(() => {
        textarea.focus({
          preventScroll: true
        });
      });
    }


    /* =====================================================
       EXPAND / COLLAPSE
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

      expanded = false;

      renderState();
    }


    function toggleComposer() {
      if (expanded) {
        collapseComposer();
      } else {
        expandComposer();
      }
    }


    /* =====================================================
       TEXT INPUT UX
       ===================================================== */

    function handleTextareaInput() {
      /*
      Existing neo.js still owns normal
      textarea auto-resize.

      This component only controls
      expand button visibility.
      */

      syncExpandVisibility();
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
      handleTextareaInput
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


    /*
    If message is sent and textarea
    becomes empty, return to compact
    state automatically.
    */

    const textareaObserver =
      new MutationObserver(() => {
        syncExpandVisibility();
      });

    textareaObserver.observe(
      textarea,
      {
        attributes: true,
        attributeFilter: [
          "style"
        ]
      }
    );


    /*
    Detect programmatic clearing such as
    send/new conversation.
    */

    let previousValue =
      textarea.value;

    window.setInterval(() => {
      if (
        textarea.value ===
        previousValue
      ) {
        return;
      }

      previousValue =
        textarea.value;

      if (
        expanded &&
        !textarea.value.trim()
      ) {
        expanded = false;

        renderState();

        return;
      }

      syncExpandVisibility();
    }, 250);


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    expanded = false;

    restoreCompactTextarea();

    syncAccessibility();
    renderIcon();
    syncExpandVisibility();
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
