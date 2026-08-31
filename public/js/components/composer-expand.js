/*
=========================================================
NEYO — COMPOSER EXPAND
Production v6.1 — Lifecycle Safe

Owns ONLY:
- Explicit expand / collapse state
- .is-writing-expanded
- Expand / collapse button
- Expanded height
- Expand button visibility
- Escape collapse
- Viewport resize while expanded
- Empty-input auto collapse
- State synchronization

Does NOT own:
- Textarea autosize
- Normal multiline composer growth
- Send / Enter behavior
- Attachments
- Voice
- Custom scrollbar DOM
- Chat API
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     SINGLETON GUARD
     ===================================================== */

  if (
    window.NeyoComposerExpand
      ?.__controller === true
  ) {
    return;
  }


  const VERSION =
    "neyo-composer-expand-production-v6.1";


  /* =====================================================
     DOM
     ===================================================== */

  const container =
    document.getElementById(
      "glassInputContainer"
    );

  const wrapper =
    document.getElementById(
      "composerWrapper"
    );

  const input =
    document.getElementById(
      "chatInput"
    );

  const button =
    document.getElementById(
      "composerExpandBtn"
    );


  if (
    !container ||
    !input ||
    !button
  ) {
    console.warn(
      "[NEYO Composer Expand] Required DOM missing."
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

      desktopRatio:
        0.48,

      desktopMin:
        260,

      desktopMax:
        520,

      mobileRatio:
        0.42,

      mobileMin:
        220,

      mobileMax:
        420,

      landscapeRatio:
        0.50,

      landscapeMin:
        180,

      landscapeMax:
        300,

      viewportGap:
        20,

      resizeDebounce:
        60,

      overflowTolerance:
        2,

      visibilityMinScrollHeight:
        104
    });


  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    expanded:
      false,

    buttonVisible:
      false,

    height:
      0,

    lastExpandedAt:
      null,

    lastCollapsedAt:
      null,

    visibilityFrame:
      null,

    resizeTimer:
      null,

    destroyed:
      false
  };


  /* =====================================================
     EVENT
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
     HELPERS
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


  function hasInputText() {
    return (
      String(
        input.value ?? ""
      )
        .trim()
        .length > 0
    );
  }


  /* =====================================================
     HEIGHT
     ===================================================== */

  function calculateExpandedHeight() {
    const viewportHeight =
      window.visualViewport
        ?.height ||
      window.innerHeight;


    let ratio =
      CONFIG.desktopRatio;

    let min =
      CONFIG.desktopMin;

    let max =
      CONFIG.desktopMax;


    if (
      isLandscapePhone()
    ) {
      ratio =
        CONFIG.landscapeRatio;

      min =
        CONFIG.landscapeMin;

      max =
        CONFIG.landscapeMax;

    } else if (
      isMobile()
    ) {
      ratio =
        CONFIG.mobileRatio;

      min =
        CONFIG.mobileMin;

      max =
        CONFIG.mobileMax;
    }


    const usableMax =
      Math.max(
        min,
        viewportHeight -
          CONFIG.viewportGap
      );


    return Math.round(
      clamp(
        viewportHeight *
          ratio,
        min,
        Math.min(
          max,
          usableMax
        )
      )
    );
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


  function applyExpandedHeight() {
    if (
      !state.expanded
    ) {
      clearExpandedHeight();

      return;
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
  }


  /* =====================================================
     ICON
     ===================================================== */

  function refreshLucide() {
    try {
      window.lucide
        ?.createIcons
        ?.();
    } catch {}
  }


  function renderButton() {
    button.replaceChildren();


    const icon =
      document.createElement(
        "i"
      );


    icon.setAttribute(
      "data-lucide",
      state.expanded
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


    button.appendChild(
      icon
    );


    button.setAttribute(
      "aria-expanded",
      String(
        state.expanded
      )
    );


    button.setAttribute(
      "aria-label",
      state.expanded
        ? "Collapse composer"
        : "Expand composer"
    );


    button.title =
      state.expanded
        ? "Collapse composer"
        : "Expand composer";


    button.dataset.tooltip =
      state.expanded
        ? "Collapse"
        : "Expand";


    refreshLucide();
  }


  /* =====================================================
     BUTTON VISIBILITY
     ===================================================== */

  function shouldShowButton() {

    /*
     * Expanded mode always shows collapse button.
     */

    if (
      state.expanded
    ) {
      return true;
    }


    /*
     * Prefer composer.js canonical overflow state.
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
        input.scrollHeight ||
        0
      );


    const clientHeight =
      Math.ceil(
        input.clientHeight ||
        0
      );


    const overflowing =
      clientHeight > 0 &&
      scrollHeight >
        clientHeight +
        CONFIG.overflowTolerance;


    const tallEnough =
      scrollHeight >=
      CONFIG.visibilityMinScrollHeight;


    return (
      overflowing ||
      tallEnough
    );
  }


  function applyButtonVisibility() {
    const visible =
      shouldShowButton();


    button.classList.toggle(
      "is-visible",
      visible
    );


    const changed =
      state.buttonVisible !==
      visible;


    state.buttonVisible =
      visible;


    if (
      changed
    ) {
      emit(
        "neyo:composer-expand-visibility",
        {
          visible,

          expanded:
            state.expanded,

          scrollHeight:
            input.scrollHeight,

          clientHeight:
            input.clientHeight
        }
      );
    }


    return visible;
  }


  function scheduleButtonVisibility() {
    if (
      state.destroyed
    ) {
      return;
    }


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
     CLASS SYNC
     ===================================================== */

  function syncClasses() {
    container.classList.toggle(
      "is-writing-expanded",
      state.expanded
    );


    wrapper
      ?.classList
      .toggle(
        "is-writing-expanded",
        state.expanded
      );
  }


  /* =====================================================
     DEPENDENCY REFRESH
     ===================================================== */

  function refreshDependencies() {
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

  function restoreFocus() {
    if (
      !input.isConnected
    ) {
      return;
    }


    const start =
      input.selectionStart;

    const end =
      input.selectionEnd;


    requestAnimationFrame(
      () => {
        try {
          input.focus({
            preventScroll: true
          });

        } catch {
          input.focus();
        }


        if (
          Number.isInteger(start) &&
          Number.isInteger(end)
        ) {
          try {
            input.setSelectionRange(
              start,
              end
            );
          } catch {}
        }
      }
    );
  }


  /* =====================================================
     APPLY STATE
     ===================================================== */

  function applyState({
    focus = true,
    reason = "state-change",
    emitEvents = true
  } = {}) {

    if (
      state.destroyed
    ) {
      return false;
    }


    syncClasses();


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
        refreshDependencies();
      }
    );


    if (
      focus
    ) {
      restoreFocus();
    }


    if (
      emitEvents
    ) {
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


    /*
     * Empty composer should never open
     * large writing mode.
     */

    if (
      !hasInputText()
    ) {
      collapse({
        focus,
        reason:
          "empty-expand-guard"
      });

      return false;
    }


    /*
     * Already expanded:
     * repair geometry only.
     */

    if (
      state.expanded
    ) {
      syncClasses();

      applyExpandedHeight();

      renderButton();

      scheduleButtonVisibility();

      refreshDependencies();


      if (
        focus
      ) {
        restoreFocus();
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


    const wasExpanded =
      state.expanded;


    state.expanded =
      false;


    /*
     * Always clean expanded classes
     * and all inline expanded geometry.
     */

    syncClasses();

    clearExpandedHeight();

    renderButton();

    scheduleButtonVisibility();


    requestAnimationFrame(
      () => {
        refreshDependencies();
      }
    );


    if (
      focus
    ) {
      restoreFocus();
    }


    if (
      wasExpanded
    ) {
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

    if (
      state.destroyed
    ) {
      return false;
    }


    /*
     * Critical lifecycle repair:
     * expanded + empty must immediately collapse.
     */

    if (
      state.expanded &&
      !hasInputText()
    ) {
      collapse({
        focus: false,
        reason:
          "empty-input"
      });

      return true;
    }


    /*
     * JS state remains authoritative.
     */

    syncClasses();


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
     BUTTON CLICK
     ===================================================== */

  button.addEventListener(
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
     INPUT LIFECYCLE

     Critical fix:
     if expanded composer becomes completely empty,
     collapse immediately.

     Partial deletion does NOT collapse.
     ===================================================== */

  function handleInputChange() {

    if (
      state.expanded &&
      !hasInputText()
    ) {
      collapse({
        focus: false,

        reason:
          "empty-input"
      });

      return;
    }


    scheduleButtonVisibility();
  }


  input.addEventListener(
    "input",
    handleInputChange,
    {
      passive: true
    }
  );


  input.addEventListener(
    "change",
    handleInputChange,
    {
      passive: true
    }
  );


  /* =====================================================
     TEXTAREA RESIZE WATCH
     ===================================================== */

  let inputResizeObserver =
    null;


  if (
    typeof ResizeObserver ===
    "function"
  ) {
    inputResizeObserver =
      new ResizeObserver(
        () => {

          /*
           * Resize must never create expanded mode.
           */

          if (
            state.expanded &&
            !hasInputText()
          ) {
            collapse({
              focus: false,

              reason:
                "empty-resize"
            });

            return;
          }


          scheduleButtonVisibility();
        }
      );


    inputResizeObserver.observe(
      input
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
     EXTERNAL EXPAND
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


  /* =====================================================
     EXTERNAL COLLAPSE
     ===================================================== */

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


  /* =====================================================
     EXTERNAL TOGGLE
     ===================================================== */

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
     COMPOSER LAYOUT EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:composer-layout",
    () => {

      /*
       * Expanded composer with empty text
       * must never remain expanded.
       */

      if (
        state.expanded &&
        !hasInputText()
      ) {
        collapse({
          focus: false,

          reason:
            "empty-layout"
        });

        return;
      }


      /*
       * Normal composer layout must NEVER auto-expand.
       */

      if (
        !state.expanded
      ) {
        syncClasses();

        clearExpandedHeight();

        scheduleButtonVisibility();

        return;
      }


      const nextHeight =
        calculateExpandedHeight();


      if (
        Math.abs(
          nextHeight -
          state.height
        ) >= 1
      ) {
        state.height =
          nextHeight;


        container.style.setProperty(
          "height",
          `${nextHeight}px`,
          "important"
        );


        container.style.setProperty(
          "min-height",
          `${nextHeight}px`,
          "important"
        );


        container.style.setProperty(
          "max-height",
          `${nextHeight}px`,
          "important"
        );
      }


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
     VIEWPORT RESIZE
     ===================================================== */

  function scheduleResize(
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


          if (
            state.expanded &&
            !hasInputText()
          ) {
            collapse({
              focus: false,

              reason:
                "empty-resize"
            });

            return;
          }


          if (
            state.expanded
          ) {
            refresh({
              reason
            });

          } else {
            scheduleButtonVisibility();
          }
        },
        CONFIG.resizeDebounce
      );
  }


  window.addEventListener(
    "resize",
    () => {
      scheduleResize(
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
      scheduleResize(
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
          scheduleResize(
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
        state.expanded &&
        !hasInputText()
      ) {
        collapse({
          focus: false,

          reason:
            "empty-attachments-change"
        });

        return;
      }


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
     STATE
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

      lastExpandedAt:
        state.lastExpandedAt,

      lastCollapsedAt:
        state.lastCollapsedAt
    };
  }


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
      state.visibilityFrame !==
      null
    ) {
      cancelAnimationFrame(
        state.visibilityFrame
      );
    }


    if (
      state.resizeTimer !==
      null
    ) {
      clearTimeout(
        state.resizeTimer
      );
    }


    inputResizeObserver
      ?.disconnect();


    clearExpandedHeight();


    container.classList.remove(
      "is-writing-expanded"
    );


    wrapper
      ?.classList
      .remove(
        "is-writing-expanded"
      );


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
     ===================================================== */

  /*
   * Fresh page/load always starts collapsed.
   */

  state.expanded =
    false;


  container.classList.remove(
    "is-writing-expanded"
  );


  wrapper
    ?.classList
    .remove(
      "is-writing-expanded"
    );


  clearExpandedHeight();


  button.classList.remove(
    "is-visible"
  );


  state.buttonVisible =
    false;


  renderButton();


  requestAnimationFrame(
    () => {

      try {
        window.NeyoComposer
          ?.refresh
          ?.({
            reason:
              "composer-expand-init"
          });
      } catch {}


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
        false,

      stateClass:
        "is-writing-expanded"
    }
  );

})();
