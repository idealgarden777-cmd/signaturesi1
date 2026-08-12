/*
=========================================================
NEYO — COMPOSER EXPAND COMPONENT

Purpose:
Handles composer expand / collapse state.

Owns:
- Expand button
- Expanded state
- Escape-to-collapse
- Accessibility state
- Lucide icon switching

Does not own:
- Sending
- Attachments
- Voice
- Suggestions
=========================================================
*/

(() => {
  "use strict";

  function initComposerExpand() {
    const expandBtn = document.getElementById("composerExpandBtn");
    const composer = document.getElementById("glassInputContainer");
    const composerWrapper = document.getElementById("composerWrapper");
    const textarea = document.getElementById("chatInput");

    if (!expandBtn || !composer) {
      return;
    }

    let isExpanded = false;

    function renderIcon() {
      expandBtn.innerHTML = isExpanded
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
    }

    function applyState() {
      composer.classList.toggle(
        "is-expanded",
        isExpanded
      );

      if (composerWrapper) {
        composerWrapper.classList.toggle(
          "composer-expanded",
          isExpanded
        );
      }

      document.body.classList.toggle(
        "composer-expanded",
        isExpanded
      );

      syncAccessibility();
      renderIcon();

      window.dispatchEvent(
        new CustomEvent("neyo:composer-expand-change", {
          detail: {
            expanded: isExpanded
          }
        })
      );
    }

    function expandComposer() {
      if (isExpanded) return;

      isExpanded = true;
      applyState();

      requestAnimationFrame(() => {
        if (textarea) {
          textarea.focus({
            preventScroll: true
          });
        }
      });
    }

    function collapseComposer() {
      if (!isExpanded) return;

      isExpanded = false;
      applyState();

      requestAnimationFrame(() => {
        if (textarea) {
          textarea.focus({
            preventScroll: true
          });
        }
      });
    }

    function toggleComposer() {
      if (isExpanded) {
        collapseComposer();
      } else {
        expandComposer();
      }
    }

    expandBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      toggleComposer();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isExpanded) {
        collapseComposer();
      }
    });

    applyState();
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
