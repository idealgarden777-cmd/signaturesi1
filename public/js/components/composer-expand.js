/*
=========================================================
NEYO — COMPOSER EXPAND
Production v5.1 — Smart Visibility / Baseline Safe

Owns:
- Expand / collapse state
- #composerExpandBtn
- .is-writing-expanded class
- Expand / collapse icon
- aria-expanded / label / tooltip
- Expanded-height calculation
- Smart expand-button visibility
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
    "neyo-composer-expand-production-v5.1";

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
      "[NEYO Composer Expand] Required composer DOM is missing."
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
        60,

      visibilityOverflowTolerance:
        2,

      visibilityMinScrollHeight:
        104
    });

  /* =====================================================
     STATE

     Important:
     Composer always starts collapsed.

     A stale class must never make a fresh page load
     start in expanded writing mode.
     ===================================================== */

  const state = {
    expanded:
      false,

    buttonVisible:
      false,

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

    visibilityFrame:
      null
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
     VIEWPORT
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
     EXPANDED HEIGHT
     ===================================================== */

  function calculateExpandedHeight() {
    const viewportHeight =
      window.visualViewport
        ?.height ||
      window.innerHeight;

    let ratio =
      CONFIG.desktopViewportRatio;

    let min =
      CONFIG.desktopMinHeight;

    let max =
      CONFIG.desktopMaxHeight;

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
     ICONS
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
     SMART BUTTON VISIBILITY
     ===================================================== */

  function shouldShowExpandButton() {
    /*
     * Expanded composer must always expose
     * the collapse control.
     */

    if (
      state.expanded
    ) {
      return true;
    }

    /*
     * Prefer canonical Composer overflow state when
     * that controller is available.
     */

    try {
      if (
        window.NeyoComposer
          ?.isOverflowing
          ?.() === true
      ) {
        return true;
      }
    } catch {}

    const scrollHeight =
      Math.ceil(
        chatInput.scrollHeight ||
        0
      );

    const clientHeight =
      Math.ceil(
        chatInput.clientHeight ||
        0
      );

    const overflow =
      clientHeight > 0 &&
      scrollHeight >
        clientHeight +
        CONFIG
          .visibilityOverflowTolerance;

    const tallEnough =
      scrollHeight >=
      CONFIG
        .visibilityMinScrollHeight;

    return (
      overflow ||
      tallEnough
    );
  }

  function applyButtonVisibility() {
    const visible =
      shouldShowExpandButton();

    /*
     * Always synchronize the actual DOM class.
     *
     * Do not rely only on cached JS state because another
     * layout pass, CSS reload or external class mutation
     * could otherwise leave the button visually stale.
     */

    expandButton
      .classList
      .toggle(
        "is-visible",
        visible
      );

    const changed =
      state.buttonVisible !==
      visible;

    state.buttonVisible =
      visible;

    if (changed) {
      emit(
        "neyo:composer-expand-visibility",
        {
          visible,

          expanded:
            state.expanded,

          scrollHeight:
            chatInput.scrollHeight,

          clientHeight:
            chatInput.clientHeight
        }
      );
    }

    return visible;
  }

  function scheduleButtonVisibility() {
    if (
      state.visibilityFrame !==
      null
    ) {
      cancelAnimationFrame(
        state.visibilityFrame
      );
    }

    state.visibilityFrame =
      requestAnimationFrame(
        () => {
          state.visibilityFrame =
            null;

          applyButtonVisibility();
        }
      );
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
     REFRESH DEPENDENCIES
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

    scheduleButtonVisibility();
  }

  /* =====================================================
     FOCUS
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
          Number.isInteger(start) &&
          Number.isInteger(end)
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

    scheduleButtonVisibility();

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
      state.expanded
    ) {
      /*
       * Keep state and DOM synchronized even if an
       * external stylesheet/layout operation occurred.
       */

      container.classList.add(
        "is-writing-expanded"
      );

      composerWrapper
        ?.classList
        .add(
          "is-writing-expanded"
        );

      applyExpandedHeight();

      renderButton();

      scheduleButtonVisibility();

      requestAnimationFrame(
        () => {
          refreshComposer();
        }
      );

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
    /*
     * Always make collapsed JS state authoritative.
     *
     * This also repairs a stale class if DOM and state
     * somehow become unsynchronized.
     */

    const wasExpanded =
      state.expanded;

    state.expanded =
      false;

    container.classList.remove(
      "is-writing-expanded"
    );

    composerWrapper
      ?.classList
      .remove(
        "is-writing-expanded"
      );

    clearExpandedHeight();

    renderButton();

    scheduleButtonVisibility();

    requestAnimationFrame(
      () => {
        refreshComposer();
      }
    );

    if (focus) {
      restoreInputFocus();
    }

    if (wasExpanded) {
      state.lastCollapsedAt =
        Date.now();

      emit(
        "neyo:composer-collapsed",
        {
          reason,

          expanded:
            false,

          height:
            0
        }
      );

      emit(
        "neyo:composer-expand-change",
        {
          reason,

          expanded:
            false,

          height:
            0
        }
      );
    }

    return true;
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
     ===================================================== */

  function refresh({
    reason = "refresh"
  } = {}) {
    /*
     * JS state is authoritative.
     * Repair DOM class if anything external changed it.
     */

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

    scheduleButtonVisibility();

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
          state.height,

        buttonVisible:
          state.buttonVisible
      }
    );

    return true;
  }

  /* =====================================================
     BUTTON
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
     INPUT VISIBILITY WATCH
     ===================================================== */

  chatInput.addEventListener(
    "input",
    () => {
      scheduleButtonVisibility();
    },
    {
      passive: true
    }
  );

  chatInput.addEventListener(
    "change",
    () => {
      scheduleButtonVisibility();
    },
    {
      passive: true
    }
  );

  /* =====================================================
     RESIZE OBSERVER

     Textarea autosize belongs to NeyoComposer.
     This controller only watches resulting geometry.
     ===================================================== */

  let textareaResizeObserver =
    null;

  if (
    typeof ResizeObserver !==
    "undefined"
  ) {
    textareaResizeObserver =
      new ResizeObserver(
        () => {
          scheduleButtonVisibility();
        }
      );

    textareaResizeObserver.observe(
      chatInput
    );
  }

  /* =====================================================
     ESCAPE
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {
      if (
        !state.expanded ||
        event.key !== "Escape"
      ) {
        return;
      }

      const target =
        event.target;

      if (
        target instanceof Element &&
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

      } else {
        scheduleButtonVisibility();
      }
    }
  );

  /* =====================================================
     COMPOSER LAYOUT
     ===================================================== */

  window.addEventListener(
    "neyo:composer-layout",
    () => {
      /*
       * This event comes from composer.js.
       *
       * Never infer expanded state from textarea size.
       * Expansion remains explicit-user-action only.
       */

      if (
        !state.expanded
      ) {
        clearExpandedHeight();

        container.classList.remove(
          "is-writing-expanded"
        );

        composerWrapper
          ?.classList
          .remove(
            "is-writing-expanded"
          );

        scheduleButtonVisibility();

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
        scheduleButtonVisibility();

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

      scheduleButtonVisibility();
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

      buttonVisible:
        state.buttonVisible,

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

      refreshVisibility:
        applyButtonVisibility,

      isExpanded() {
        return state.expanded;
      },

      isButtonVisible() {
        return state.buttonVisible;
      },

      getHeight() {
        return state.height;
      },

      getState
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

     Critical bug fix:
     every fresh page starts collapsed.

     Do not inherit accidental/stale DOM classes.
     ===================================================== */

  state.expanded =
    false;

  container.classList.remove(
    "is-writing-expanded"
  );

  composerWrapper
    ?.classList
    .remove(
      "is-writing-expanded"
    );

  clearExpandedHeight();

  expandButton.classList.remove(
    "is-visible"
  );

  state.buttonVisible =
    false;

  renderButton();

  /*
   * Wait until composer.js / CSS have completed initial
   * geometry before deciding if expand control is useful.
   */

  requestAnimationFrame(
    () => {
      refreshComposer();

      requestAnimationFrame(
        () => {
          applyButtonVisibility();
        }
      );
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
        false,

      buttonVisible:
        state.buttonVisible,

      stateClass:
        "is-writing-expanded"
    }
  );

})();
