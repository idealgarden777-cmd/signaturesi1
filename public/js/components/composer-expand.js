/*
=========================================================
NEO — COMPOSER EXPAND
Production v3 — Baseline Safe

Baseline:
- Existing #composerExpandBtn HTML
- Existing composer-expand.css
- Existing .is-writing-expanded contract
- Current NeyoComposer autosize/layout owner
- Current NeyoComposerScrollbar owner

Owns:
- Expand / collapse state
- #composerExpandBtn
- .is-writing-expanded class
- Expand / collapse icon
- aria-expanded / label / tooltip
- Expanded-height calculation
- Viewport resize reaction
- Escape-to-collapse
- Focus preservation
- Expand lifecycle events

Does NOT own:
- Textarea autosize
- Send / Enter
- Attachments
- Voice
- Custom scrollbar DOM
- Composer width
- Topbar
- Chat API
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-composer-expand-production-v3";

  if (
    window.NeyoComposerExpand
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     DOM
     ===================================================== */

  const container =
    document.getElementById(
      "glassInputContainer"
    );

  const composerWrapper =
    document.getElementById(
      "composerWrapper"
    );

  const chatInput =
    document.getElementById(
      "chatInput"
    );

  const expandButton =
    document.getElementById(
      "composerExpandBtn"
    );

  if (
    !container ||
    !chatInput ||
    !expandButton
  ) {
    console.warn(
      "[NEO Composer Expand] Required composer DOM is missing."
    );

    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      mobileBreakpoint:
        767,

      /*
       * Keep enough viewport space for topbar/chat context.
       */

      desktopViewportRatio:
        0.48,

      mobileViewportRatio:
        0.42,

      landscapeViewportRatio:
        0.5,

      desktopMinHeight:
        260,

      desktopMaxHeight:
        520,

      mobileMinHeight:
        220,

      mobileMaxHeight:
        420,

      landscapeMinHeight:
        180,

      landscapeMaxHeight:
        300,

      viewportGap:
        20,

      resizeDebounceMs:
        60
    });

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    expanded:
      container.classList
        .contains(
          "is-writing-expanded"
        ),

    height:
      0,

    resizing:
      false,

    lastExpandedAt:
      null,

    lastCollapsedAt:
      null,

    resizeTimer:
      null,

    destroyed:
      false
  };

  /* =====================================================
     EVENTS
     ===================================================== */

  function emit(
    name,
    detail = {}
  ) {
    window.dispatchEvent(
      new CustomEvent(
        name,
        {
          detail
        }
      )
    );
  }

  /* =====================================================
     VIEWPORT HELPERS
     ===================================================== */

  function isMobile() {
    return (
      window.innerWidth <=
      CONFIG.mobileBreakpoint
    );
  }

  function isLandscapePhone() {
    return (
      window.innerHeight <=
        520 &&
      window.innerWidth >
        window.innerHeight
    );
  }

  /* =====================================================
     CLAMP
     ===================================================== */

  function clamp(
    value,
    min,
    max
  ) {
    return Math.min(
      max,
      Math.max(
        min,
        value
      )
    );
  }

  /* =====================================================
     TARGET HEIGHT

     CSS remains geometry owner.
     JS only supplies the expanded shell height.

     Important:
     width is NEVER touched.
     ===================================================== */

  function calculateExpandedHeight() {
    const viewportHeight =
      window.visualViewport
        ?.height ||
      window.innerHeight;

    let ratio =
      CONFIG
        .desktopViewportRatio;

    let min =
      CONFIG
        .desktopMinHeight;

    let max =
      CONFIG
        .desktopMaxHeight;

    if (
      isLandscapePhone()
    ) {
      ratio =
        CONFIG
          .landscapeViewportRatio;

      min =
        CONFIG
          .landscapeMinHeight;

      max =
        CONFIG
          .landscapeMaxHeight;

    } else if (
      isMobile()
    ) {
      ratio =
        CONFIG
          .mobileViewportRatio;

      min =
        CONFIG
          .mobileMinHeight;

      max =
        CONFIG
          .mobileMaxHeight;
    }

    const available =
      Math.max(
        min,
        viewportHeight -
          CONFIG.viewportGap
      );

    const calculated =
      viewportHeight *
      ratio;

    return Math.round(
      clamp(
        calculated,
        min,
        Math.min(
          max,
          available
        )
      )
    );
  }

  /* =====================================================
     ICON
     ===================================================== */

  function refreshIcons() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }

  function renderButton() {
    const expanded =
      state.expanded;

    expandButton
      .replaceChildren();

    const icon =
      document.createElement(
        "i"
      );

    icon.setAttribute(
      "data-lucide",
      expanded
        ? "minimize-2"
        : "maximize-2"
    );

    icon.setAttribute(
      "size",
      "16"
    );

    icon.setAttribute(
      "aria-hidden",
      "true"
    );

    expandButton.appendChild(
      icon
    );

    expandButton.setAttribute(
      "aria-expanded",
      String(expanded)
    );

    expandButton.setAttribute(
      "aria-label",
      expanded
        ? "Collapse composer"
        : "Expand composer"
    );

    /*
     * Preserve existing old HTML tooltip contract.
     */

    expandButton.dataset.tooltip =
      expanded
        ? "Collapse"
        : "Expand";

    expandButton.title =
      expanded
        ? "Collapse composer"
        : "Expand composer";

    refreshIcons();
  }

  /* =====================================================
     HEIGHT
     ===================================================== */

  function applyExpandedHeight() {
    if (
      !state.expanded
    ) {
      return false;
    }

    const height =
      calculateExpandedHeight();

    state.height =
      height;

    /*
     * Existing CSS contains !important height rules.
     * Expanded controller is the explicit expanded-size
     * owner, so inline important is intentional.
     */

    container.style.setProperty(
      "height",
      `${height}px`,
      "important"
    );

    container.style.setProperty(
      "min-height",
      `${height}px`,
      "important"
    );

    container.style.setProperty(
      "max-height",
      `${height}px`,
      "important"
    );

    return true;
  }

  function clearExpandedHeight() {
    container.style.removeProperty(
      "height"
    );

    container.style.removeProperty(
      "min-height"
    );

    container.style.removeProperty(
      "max-height"
    );

    state.height =
      0;
  }

  /* =====================================================
     REFRESH OWNED DEPENDENCIES
     ===================================================== */

  function refreshComposer() {
    try {
      window.NeyoComposer
        ?.refresh
        ?.({
          reason:
            "composer-expand-change"
        });
    } catch {}

    try {
      window
        .NeyoComposerScrollbar
        ?.refresh
        ?.();
    } catch {}
  }

  /* =====================================================
     FOCUS PRESERVATION
     ===================================================== */

  function restoreInputFocus({
    preserveCaret = true
  } = {}) {
    if (
      !chatInput.isConnected
    ) {
      return false;
    }

    const start =
      chatInput.selectionStart;

    const end =
      chatInput.selectionEnd;

    requestAnimationFrame(
      () => {
        try {
          chatInput.focus({
            preventScroll: true
          });
        } catch {
          chatInput.focus();
        }

        if (
          preserveCaret &&
          Number.isInteger(
            start
          ) &&
          Number.isInteger(
            end
          )
        ) {
          try {
            chatInput
              .setSelectionRange(
                start,
                end
              );
          } catch {}
        }
      }
    );

    return true;
  }

  /* =====================================================
     APPLY STATE
     ===================================================== */

  function applyState({
    focus = true,
    emitEvent = true,
    reason = "state-change"
  } = {}) {
    container.classList.toggle(
      "is-writing-expanded",
      state.expanded
    );

    composerWrapper
      ?.classList
      .toggle(
        "is-writing-expanded",
        state.expanded
      );

    if (
      state.expanded
    ) {
      applyExpandedHeight();

    } else {
      clearExpandedHeight();
    }

    renderButton();

    /*
     * Refresh only after class + height are applied.
     */

    requestAnimationFrame(
      () => {
        refreshComposer();
      }
    );

    if (focus) {
      restoreInputFocus();
    }

    if (emitEvent) {
      emit(
        state.expanded
          ? "neyo:composer-expanded"
          : "neyo:composer-collapsed",
        {
          reason,

          expanded:
            state.expanded,

          height:
            state.height
        }
      );

      emit(
        "neyo:composer-expand-change",
        {
          reason,

          expanded:
            state.expanded,

          height:
            state.height
        }
      );
    }

    return true;
  }

  /* =====================================================
     EXPAND
     ===================================================== */

  function expand({
    focus = true,
    reason = "user"
  } = {}) {
    if (
      state.destroyed
    ) {
      return false;
    }

    if (
      state.expanded
    ) {
      if (focus) {
        restoreInputFocus();
      }

      return true;
    }

    state.expanded =
      true;

    state.lastExpandedAt =
      Date.now();

    return applyState({
      focus,
      reason
    });
  }

  /* =====================================================
     COLLAPSE
     ===================================================== */

  function collapse({
    focus = true,
    reason = "user"
  } = {}) {
    if (
      state.destroyed
    ) {
      return false;
    }

    if (
      !state.expanded
    ) {
      return true;
    }

    state.expanded =
      false;

    state.lastCollapsedAt =
      Date.now();

    return applyState({
      focus,
      reason
    });
  }

  /* =====================================================
     TOGGLE
     ===================================================== */

  function toggle(
    options = {}
  ) {
    return state.expanded
      ? collapse(options)
      : expand(options);
  }

  /* =====================================================
     REFRESH

     Called after:
     - viewport resize
     - mobile keyboard
     - attachments
     - composer layout change

     Does not change expanded/collapsed decision.
     ===================================================== */

  function refresh({
    reason = "refresh"
  } = {}) {
    if (
      state.destroyed
    ) {
      return false;
    }

    if (
      state.expanded
    ) {
      applyExpandedHeight();
    }

    renderButton();

    try {
      window
        .NeyoComposerScrollbar
        ?.refresh
        ?.();
    } catch {}

    emit(
      "neyo:composer-expand-layout",
      {
        reason,

        expanded:
          state.expanded,

        height:
          state.height
      }
    );

    return true;
  }

  /* =====================================================
     BUTTON

     Capture phase prevents old neo.js from also toggling
     the same class while legacy code remains loaded.
     ===================================================== */

  expandButton.addEventListener(
    "click",
    event => {
      event.preventDefault();

      event.stopPropagation();

      event.stopImmediatePropagation();

      toggle({
        focus: true,

        reason:
          "expand-button"
      });
    },
    true
  );

  /* =====================================================
     ESCAPE

     ChatGPT-style:
     Escape collapses expanded writing canvas.

     Important:
     - does NOT clear text
     - does NOT send
     - does NOT stop generation
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {
      if (
        !state.expanded ||
        event.key !==
          "Escape"
      ) {
        return;
      }

      /*
       * Don't steal Escape from an actual dialog/modal.
       */

      const target =
        event.target;

      if (
        target instanceof
          Element &&
        target.closest(
          [
            "[role='dialog']",
            ".modal",
            ".overlay-dialog",
            ".history-dialog"
          ].join(",")
        )
      ) {
        return;
      }

      event.preventDefault();

      event.stopPropagation();

      collapse({
        focus: true,

        reason:
          "escape"
      });
    },
    true
  );

  /* =====================================================
     EXTERNAL EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:composer-expand-request",
    event => {
      expand({
        focus:
          event.detail
            ?.focus !== false,

        reason:
          event.detail
            ?.reason ||
          "external"
      });
    }
  );

  window.addEventListener(
    "neyo:composer-collapse-request",
    event => {
      collapse({
        focus:
          event.detail
            ?.focus !== false,

        reason:
          event.detail
            ?.reason ||
          "external"
      });
    }
  );

  window.addEventListener(
    "neyo:composer-toggle-expand-request",
    event => {
      toggle({
        focus:
          event.detail
            ?.focus !== false,

        reason:
          event.detail
            ?.reason ||
          "external"
      });
    }
  );

  /* =====================================================
     NEW CHAT

     New Chat returns composer to compact state.
     Text/attachments themselves are owned elsewhere.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      collapse({
        focus: false,

        reason:
          "new-chat"
      });
    }
  );

  /* =====================================================
     CONVERSATION LOAD

     Prevent a previous draft's expanded shell from leaking
     into a newly opened history conversation.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-state-loaded",
    () => {
      collapse({
        focus: false,

        reason:
          "conversation-load"
      });
    }
  );

  /* =====================================================
     COMPOSER RESET
     ===================================================== */

  window.addEventListener(
    "neyo:composer-reset-request",
    () => {
      collapse({
        focus: false,

        reason:
          "composer-reset"
      });
    }
  );

  /* =====================================================
     VIEWPORT

     visualViewport matters for iPhone/Android keyboard.
     ===================================================== */

  function scheduleViewportRefresh(
    reason
  ) {
    if (
      state.resizeTimer !==
      null
    ) {
      clearTimeout(
        state.resizeTimer
      );
    }

    state.resizeTimer =
      window.setTimeout(
        () => {
          state.resizeTimer =
            null;

          state.resizing =
            true;

          refresh({
            reason
          });

          state.resizing =
            false;
        },
        CONFIG.resizeDebounceMs
      );
  }

  window.addEventListener(
    "resize",
    () => {
      scheduleViewportRefresh(
        "window-resize"
      );
    },
    {
      passive: true
    }
  );

  window.addEventListener(
    "orientationchange",
    () => {
      scheduleViewportRefresh(
        "orientation-change"
      );
    },
    {
      passive: true
    }
  );

  if (
    window.visualViewport
  ) {
    window.visualViewport
      .addEventListener(
        "resize",
        () => {
          scheduleViewportRefresh(
            "visual-viewport-resize"
          );
        },
        {
          passive: true
        }
      );
  }

  /* =====================================================
     ATTACHMENTS

     Attachment shelf can alter top position around expand
     button, but this controller does not own attachments.
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-change",
    () => {
      if (
        state.expanded
      ) {
        refresh({
          reason:
            "attachments-change"
        });
      }
    }
  );

  /* =====================================================
     COMPOSER LAYOUT

     Avoid recursive composer→expand→composer loops.
     Only recalculate shell height if viewport-derived size
     actually changed.
     ===================================================== */

  window.addEventListener(
    "neyo:composer-layout",
    () => {
      if (
        !state.expanded
      ) {
        return;
      }

      const next =
        calculateExpandedHeight();

      if (
        Math.abs(
          next -
          state.height
        ) < 1
      ) {
        return;
      }

      state.height =
        next;

      container.style.setProperty(
        "height",
        `${next}px`,
        "important"
      );

      container.style.setProperty(
        "min-height",
        `${next}px`,
        "important"
      );

      container.style.setProperty(
        "max-height",
        `${next}px`,
        "important"
      );

      try {
        window
          .NeyoComposerScrollbar
          ?.refresh
          ?.();
      } catch {}
    }
  );

  /* =====================================================
     STATE REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:composer-expand-state-request",
    () => {
      emit(
        "neyo:composer-expand-state",
        getState()
      );
    }
  );

  /* =====================================================
     GET STATE
     ===================================================== */

  function getState() {
    return {
      version:
        VERSION,

      active:
        true,

      expanded:
        state.expanded,

      height:
        state.height,

      resizing:
        state.resizing,

      lastExpandedAt:
        state.lastExpandedAt,

      lastCollapsedAt:
        state.lastCollapsedAt
    };
  }

  /* =====================================================
     DESTROY
     ===================================================== */

  function destroy() {
    if (
      state.destroyed
    ) {
      return false;
    }

    state.destroyed =
      true;

    if (
      state.resizeTimer !==
      null
    ) {
      clearTimeout(
        state.resizeTimer
      );

      state.resizeTimer =
        null;
    }

    clearExpandedHeight();

    return true;
  }

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller:
        true,

      version:
        VERSION,

      active:
        true,

      expand,

      collapse,

      toggle,

      refresh,

      isExpanded() {
        return state.expanded;
      },

      getHeight() {
        return state.height;
      },

      getState,

      destroy
    });

  Object.defineProperty(
    window,
    "NeyoComposerExpand",
    {
      value:
        api,

      writable:
        false,

      configurable:
        true,

      enumerable:
        true
    }
  );

  /* =====================================================
     INIT

     Preserve whichever class HTML/legacy CSS currently has,
     then synchronize icon + aria state.
     ===================================================== */

  if (
    state.expanded
  ) {
    applyExpandedHeight();
  }

  renderButton();

  requestAnimationFrame(
    () => {
      refreshComposer();
    }
  );

  emit(
    "neyo:composer-expand-ready",
    {
      version:
        VERSION,

      active:
        true,

      expanded:
        state.expanded,

      stateClass:
        "is-writing-expanded"
    }
  );
})();
