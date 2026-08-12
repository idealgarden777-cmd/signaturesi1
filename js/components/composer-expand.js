/*
=========================================================
NEYO — COMPOSER EXPAND COMPONENT

Purpose:
Handles composer expand / collapse behavior.

Owns:
- Expand button
- Expanded state
- Escape-to-collapse
- Button accessibility state
- Lucide icon switching

Does NOT own:
- Textarea auto-resize
- Sending messages
- Attachments
- Voice
- Suggestions
=========================================================
*/

(() => {
  "use strict";

  const initComposerExpand = () => {
    const expandBtn = document.getElementById("composerExpandBtn");
    const composer = document.getElementById("glassInputContainer");
    const composerWrapper = document.getElementById("composerWrapper");
    const textarea = document.getElementById("chatInput");

    // Safe exit if this feature is not present.
    if (!expandBtn || !composer) {
      return;
    }

    let isExpanded = false;


    /* =====================================================
       ICON
       ===================================================== */

    const renderIcon = () => {
      expandBtn.innerHTML = isExpanded
        ? '<i data-lucide="minimize-2" size="16"></i>'
        : '<i data-lucide="maximize-2" size="16"></i>';

      if (
        window.lucide &&
        typeof window.lucide.createIcons === "function"
      ) {
        window.lucide.createIcons();
      }
    };


    /* =====================================================
       ACCESSIBILITY
       ===================================================== */

    const syncAccessibility = () => {
      expandBtn.setAttribute(
        "aria-expanded",
        String(isExpanded)
      );

      expandBtn.setAttribute(
        "aria-label",
        isExpanded
          ? "Collapse composer"
          : "Expand composer"
      );

      expandBtn.title = isExpanded
        ? "Collapse composer"
        : "Expand composer";
    };


    /* =====================================================
       STATE
       ===================================================== */

    const applyState = () => {
      composer.classList.toggle(
        "is-expanded",
        isExpanded
      );

      composerWrapper?.classList.toggle(
        "composer-expanded",
        isExpanded
      );

      document.body.classList.toggle(
        "composer-expanded",
        isExpanded
      );

      syncAccessibility();
      renderIcon();

      /*
      Tell future modular components that
      composer state changed.
      */

      window.dispatchEvent(
        new CustomEvent(
          "neyo:composer-expand-change",
          {
            detail: {
              expanded: isExpanded
            }
          }
        )
      );
    };


    /* =====================================================
       OPEN / CLOSE
       ===================================================== */

    const expand = () => {
      if (isExpanded) return;

      isExpanded = true;

      applyState();

      requestAnimationFrame(() => {
        textarea?.focus({
          preventScroll: true
        });
      });
    };


    const collapse = () => {
      if (!isExpanded) return;

      isExpanded = false;

      applyState();

      requestAnimationFrame(() => {
        textarea?.focus({
          preventScroll: true
        });
      });
    };


    const toggle = () => {
      if (isExpanded) {
        collapse();
      } else {
        expand();
      }
    };


    /* =====================================================
       EVENTS
       ===================================================== */

    expandBtn.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        toggle();
      }
    );


    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Escape" &&
          isExpanded
        ) {
          collapse();
        }
      }
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    applyState();
  };


  /* =======================================================
     INIT
     ======================================================= */

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
