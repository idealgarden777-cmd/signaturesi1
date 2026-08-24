/*
=========================================================
NEO — COMPOSER
Production v3 — Baseline Safe

Baseline:
- Old working neo.js composer behavior
- Existing composer.css geometry
- Existing composer-scrollbar.css contract
- Current NeyoSendState ownership
- Current NeyoAttachments ownership

Owns:
- #chatInput textarea layout state
- Textarea autosize
- One-line / multiline detection
- Overflow detection
- Content/focus/composition state classes
- Composer refresh API
- Programmatic text setting
- Composer state events
- Resize / font / viewport refresh

Does NOT own:
- Enter to send
- Shift+Enter
- Send / Stop
- #sendBtn
- Attachment upload
- Attachment picker
- Voice
- Expand / collapse button
- Custom scrollbar DOM
- Suggestions
- Chat API
- Draft persistence
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-composer-production-v3";

  if (
    window.NeyoComposer
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     DOM
     ===================================================== */

  const chatInput =
    document.getElementById(
      "chatInput"
    );

  const composerWrapper =
    document.getElementById(
      "composerWrapper"
    );

  const glassInputContainer =
    document.getElementById(
      "glassInputContainer"
    ) ||
    composerWrapper;

  const inputRow =
    glassInputContainer
      ?.querySelector(
        ".composer-input-row"
      ) ||
    document.querySelector(
      ".composer-input-row"
    );

  if (
    !chatInput ||
    !glassInputContainer
  ) {
    console.warn(
      "[NEO Composer] Required composer DOM is missing."
    );

    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      maxLength:
        50_000,

      /*
       * Existing compact composer CSS uses a 40px textarea.
       */

      compactHeight:
        40,

      /*
       * Safety fallback only.
       * CSS remains the visual max-height owner.
       */

      desktopMaxHeight:
        160,

      mobileMaxHeight:
        118,

      mobileBreakpoint:
        767,

      resizeDebounceMs:
        40
    });

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    focused:
      document.activeElement ===
      chatInput,

    composing:
      false,

    hasContent:
      false,

    multiline:
      false,

    overflowing:
      false,

    lineCount:
      1,

    naturalHeight:
      CONFIG.compactHeight,

    appliedHeight:
      CONFIG.compactHeight,

    lastValue:
      "",

    lastWidth:
      0,

    resizeTimer:
      null,

    refreshFrame:
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
     TEXT
     ===================================================== */

  function normalizeText(
    value
  ) {
    return String(
      value ?? ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .replace(
        /\r\n?/g,
        "\n"
      )
      .slice(
        0,
        CONFIG.maxLength
      );
  }

  function getValue() {
    return normalizeText(
      chatInput.value
    );
  }

  function getText() {
    return getValue()
      .trim();
  }

  function hasText() {
    return (
      getText().length >
      0
    );
  }

  /* =====================================================
     EXPANDED STATE

     composer-expand.js owns the actual class.
     Composer only reads it.
     ===================================================== */

  function isExpanded() {
    return (
      glassInputContainer
        .classList
        .contains(
          "is-writing-expanded"
        )
    );
  }

  /* =====================================================
     MOBILE
     ===================================================== */

  function isMobile() {
    return (
      window.innerWidth <=
      CONFIG.mobileBreakpoint
    );
  }

  /* =====================================================
     STYLE MEASUREMENT
     ===================================================== */

  function getComputedNumber(
    element,
    property
  ) {
    if (!element) {
      return 0;
    }

    const value =
      window.getComputedStyle(
        element
      )
        .getPropertyValue(
          property
        );

    const parsed =
      parseFloat(value);

    return Number.isFinite(
      parsed
    )
      ? parsed
      : 0;
  }

  function getLineHeight() {
    const style =
      window.getComputedStyle(
        chatInput
      );

    const parsed =
      parseFloat(
        style.lineHeight
      );

    if (
      Number.isFinite(
        parsed
      ) &&
      parsed > 0
    ) {
      return parsed;
    }

    const fontSize =
      parseFloat(
        style.fontSize
      ) ||
      16;

    return (
      fontSize * 1.5
    );
  }

  function getVerticalPadding() {
    return (
      getComputedNumber(
        chatInput,
        "padding-top"
      ) +
      getComputedNumber(
        chatInput,
        "padding-bottom"
      )
    );
  }

  /* =====================================================
     LINE ESTIMATE

     scrollHeight remains primary source.
     This count is diagnostic/UI state only.
     ===================================================== */

  function estimateLineCount(
    naturalHeight
  ) {
    const lineHeight =
      getLineHeight();

    if (
      !lineHeight ||
      lineHeight <= 0
    ) {
      return 1;
    }

    const padding =
      getVerticalPadding();

    const contentHeight =
      Math.max(
        lineHeight,
        naturalHeight -
          padding
      );

    return Math.max(
      1,
      Math.round(
        contentHeight /
        lineHeight
      )
    );
  }

  /* =====================================================
     CSS MAX HEIGHT

     Existing CSS may provide a stricter responsive
     max-height. Respect that first.

     If CSS says "none", use safety fallback.
     ===================================================== */

  function getAllowedMaxHeight() {
    if (isExpanded()) {
      /*
       * Expanded mode's own component/CSS decides height.
       * Do not impose compact composer limits.
       */

      const computed =
        window.getComputedStyle(
          chatInput
        );

      const value =
        parseFloat(
          computed.maxHeight
        );

      if (
        Number.isFinite(
          value
        ) &&
        value > 0
      ) {
        return value;
      }

      return Math.max(
        240,
        window.innerHeight *
          0.55
      );
    }

    const computed =
      window.getComputedStyle(
        chatInput
      );

    const cssMax =
      parseFloat(
        computed.maxHeight
      );

    /*
     * In compact state existing CSS can intentionally
     * report 40px. We need multiline measurement before
     * the multiline class is applied, so don't treat
     * compact 40px as the multiline ceiling.
     */

    if (
      state.multiline &&
      Number.isFinite(
        cssMax
      ) &&
      cssMax >
        CONFIG.compactHeight
    ) {
      return cssMax;
    }

    return isMobile()
      ? CONFIG.mobileMaxHeight
      : CONFIG.desktopMaxHeight;
  }

  /* =====================================================
     NATURAL HEIGHT

     Critical:
     Width never changes here.
     Only textarea height is measured.
     ===================================================== */

  function measureNaturalHeight() {
    const previousHeight =
      chatInput.style.height;

    const previousOverflow =
      chatInput.style.overflowY;

    /*
     * Temporarily remove inline height so scrollHeight
     * represents full content.
     */

    chatInput.style.height =
      "auto";

    chatInput.style.overflowY =
      "hidden";

    const measured =
      Math.max(
        CONFIG.compactHeight,
        chatInput.scrollHeight ||
          CONFIG.compactHeight
      );

    chatInput.style.height =
      previousHeight;

    chatInput.style.overflowY =
      previousOverflow;

    return measured;
  }

  /* =====================================================
     MULTILINE DETECTION

     A textarea becomes multiline when:
     - it contains an explicit newline, OR
     - wrapped content needs more than compact height.

     Small tolerance avoids 1px browser rounding flicker.
     ===================================================== */

  function detectMultiline(
    value,
    naturalHeight
  ) {
    if (
      value.includes("\n")
    ) {
      return true;
    }

    return (
      naturalHeight >
      CONFIG.compactHeight +
        3
    );
  }

  /* =====================================================
     APPLY CLASSES
     ===================================================== */

  function applyClasses() {
    const containers =
      [
        glassInputContainer,
        composerWrapper
      ].filter(Boolean);

    for (
      const container
      of containers
    ) {
      container.classList.toggle(
        "composer-has-content",
        state.hasContent
      );

      container.classList.toggle(
        "composer-multiline",
        state.multiline
      );

      container.classList.toggle(
        "composer-overflow",
        state.overflowing
      );

      container.classList.toggle(
        "composer-focused",
        state.focused
      );

      container.classList.toggle(
        "composer-composing",
        state.composing
      );
    }

    chatInput.classList.toggle(
      "is-multiline",
      state.multiline
    );

    chatInput.classList.toggle(
      "is-overflowing",
      state.overflowing
    );
  }

  /* =====================================================
     APPLY HEIGHT

     Existing CSS owns geometry.
     JS only supplies content-driven textarea height.

     Expanded mode:
     leave major canvas sizing to composer-expand.js.
     ===================================================== */

  function applyHeight(
    naturalHeight
  ) {
    /* -----------------------------------------------
       EMPTY / ONE LINE
       ----------------------------------------------- */

    if (
      !state.multiline &&
      !isExpanded()
    ) {
      chatInput.style.removeProperty(
        "height"
      );

      chatInput.style.removeProperty(
        "overflow-y"
      );

      state.appliedHeight =
        CONFIG.compactHeight;

      state.overflowing =
        false;

      return;
    }

    const maxHeight =
      getAllowedMaxHeight();

    const targetHeight =
      Math.min(
        naturalHeight,
        maxHeight
      );

    state.overflowing =
      naturalHeight >
      maxHeight + 1;

    /*
     * Existing styles contain !important layout rules.
     * setProperty(..., "important") ensures autosize can
     * coexist with those rules without editing CSS now.
     */

    chatInput.style.setProperty(
      "height",
      `${Math.round(
        targetHeight
      )}px`,
      "important"
    );

    chatInput.style.setProperty(
      "overflow-y",
      state.overflowing
        ? "auto"
        : "hidden",
      "important"
    );

    state.appliedHeight =
      targetHeight;
  }

  /* =====================================================
     SCROLLBAR REFRESH

     composer-scrollbar.js remains owner.
     ===================================================== */

  function refreshScrollbar() {
    try {
      window
        .NeyoComposerScrollbar
        ?.refresh
        ?.();
    } catch {}
  }

  /* =====================================================
     EXPAND REFRESH

     composer-expand.js remains owner.
     ===================================================== */

  function notifyExpandController() {
    try {
      window
        .NeyoComposerExpand
        ?.refresh
        ?.();
    } catch {}
  }

  /* =====================================================
     STATE SNAPSHOT
     ===================================================== */

  function snapshot() {
    return {
      version:
        VERSION,

      valueLength:
        chatInput.value
          .length,

      hasContent:
        state.hasContent,

      focused:
        state.focused,

      composing:
        state.composing,

      multiline:
        state.multiline,

      overflowing:
        state.overflowing,

      expanded:
        isExpanded(),

      lineCount:
        state.lineCount,

      naturalHeight:
        Math.round(
          state.naturalHeight
        ),

      appliedHeight:
        Math.round(
          state.appliedHeight
        ),

      width:
        Math.round(
          chatInput
            .getBoundingClientRect()
            .width
        )
    };
  }

  /* =====================================================
     REFRESH

     Single canonical composer layout pass.
     ===================================================== */

  function refresh({
    reason = "refresh",
    emitChange = true
  } = {}) {
    if (
      state.destroyed ||
      !chatInput.isConnected
    ) {
      return false;
    }

    const value =
      getValue();

    /*
     * Keep maxLength as a real DOM guard too.
     */

    if (
      chatInput.maxLength !==
      CONFIG.maxLength
    ) {
      chatInput.maxLength =
        CONFIG.maxLength;
    }

    if (
      chatInput.value !==
      value
    ) {
      const selectionStart =
        chatInput.selectionStart;

      const selectionEnd =
        chatInput.selectionEnd;

      chatInput.value =
        value;

      try {
        chatInput.setSelectionRange(
          Math.min(
            selectionStart,
            value.length
          ),
          Math.min(
            selectionEnd,
            value.length
          )
        );
      } catch {}
    }

    state.hasContent =
      Boolean(
        value.trim()
      );

    /*
     * First measure with current class state.
     */

    let naturalHeight =
      measureNaturalHeight();

    const multiline =
      detectMultiline(
        value,
        naturalHeight
      );

    /*
     * If state changes to multiline, CSS itself changes
     * textarea geometry/padding. Apply class then remeasure.
     */

    if (
      multiline !==
      state.multiline
    ) {
      state.multiline =
        multiline;

      applyClasses();

      naturalHeight =
        measureNaturalHeight();
    }

    state.naturalHeight =
      naturalHeight;

    state.lineCount =
      estimateLineCount(
        naturalHeight
      );

    applyHeight(
      naturalHeight
    );

    /*
     * overflow state is determined in applyHeight().
     */

    applyClasses();

    state.lastValue =
      value;

    state.lastWidth =
      chatInput
        .getBoundingClientRect()
        .width;

    refreshScrollbar();

    emit(
      "neyo:composer-layout",
      {
        reason,

        ...snapshot()
      }
    );

    if (emitChange) {
      emit(
        "neyo:composer-change",
        {
          reason,

          text:
            value,

          hasContent:
            state.hasContent,

          multiline:
            state.multiline,

          overflowing:
            state.overflowing
        }
      );
    }

    return true;
  }

  /* =====================================================
     FRAME REFRESH

     Coalesces several synchronous input/layout events.
     ===================================================== */

  function scheduleRefresh(
    reason = "scheduled"
  ) {
    if (
      state.refreshFrame !==
      null
    ) {
      return;
    }

    state.refreshFrame =
      requestAnimationFrame(
        () => {
          state.refreshFrame =
            null;

          refresh({
            reason
          });
        }
      );
  }

  /* =====================================================
     SET VALUE

     Useful for starter prompts, voice transcription,
     draft restore and future tools.

     Does NOT send.
     ===================================================== */

  function setValue(
    value,
    {
      focus = false,
      moveCaretToEnd = true,
      dispatchInput = true
    } = {}
  ) {
    const next =
      normalizeText(value);

    chatInput.value =
      next;

    if (
      moveCaretToEnd
    ) {
      try {
        const end =
          next.length;

        chatInput.setSelectionRange(
          end,
          end
        );
      } catch {}
    }

    if (
      dispatchInput
    ) {
      chatInput.dispatchEvent(
        new Event(
          "input",
          {
            bubbles: true
          }
        )
      );

    } else {
      refresh({
        reason:
          "set-value"
      });
    }

    if (focus) {
      focusInput();
    }

    return true;
  }

  /* =====================================================
     INSERT TEXT AT CARET

     Future-safe for voice, prompts and tool insertions.
     No send ownership.
     ===================================================== */

  function insertText(
    value,
    {
      focus = true
    } = {}
  ) {
    const text =
      normalizeText(value);

    if (!text) {
      return false;
    }

    const current =
      getValue();

    const start =
      Number.isInteger(
        chatInput.selectionStart
      )
        ? chatInput.selectionStart
        : current.length;

    const end =
      Number.isInteger(
        chatInput.selectionEnd
      )
        ? chatInput.selectionEnd
        : start;

    const next =
      normalizeText(
        current.slice(
          0,
          start
        ) +
        text +
        current.slice(end)
      );

    chatInput.value =
      next;

    const caret =
      Math.min(
        start +
          text.length,
        next.length
      );

    try {
      chatInput.setSelectionRange(
        caret,
        caret
      );
    } catch {}

    chatInput.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );

    if (focus) {
      focusInput();
    }

    return true;
  }

  /* =====================================================
     CLEAR
     ===================================================== */

  function clear({
    focus = false
  } = {}) {
    if (
      chatInput.value !==
      ""
    ) {
      chatInput.value =
        "";

      chatInput.dispatchEvent(
        new Event(
          "input",
          {
            bubbles: true
          }
        )
      );

    } else {
      refresh({
        reason:
          "clear"
      });
    }

    if (focus) {
      focusInput();
    }

    return true;
  }

  /* =====================================================
     FOCUS
     ===================================================== */

  function focusInput() {
    if (
      !chatInput.isConnected
    ) {
      return false;
    }

    try {
      chatInput.focus({
        preventScroll:
          true
      });

    } catch {
      chatInput.focus();
    }

    return true;
  }

  /* =====================================================
     INPUT
     ===================================================== */

  chatInput.addEventListener(
    "input",
    () => {
      scheduleRefresh(
        "input"
      );
    }
  );

  /* =====================================================
     BEFORE INPUT

     maxLength protects most input automatically, but
     programmatic/paste edge cases can still reach here.
     Composer does NOT block normal editing.
     ===================================================== */

  chatInput.addEventListener(
    "beforeinput",
    event => {
      if (
        event.isComposing ||
        state.composing
      ) {
        return;
      }

      /*
       * Browser handles maxLength for normal text insertion.
       * No custom key ownership here.
       */
    }
  );

  /* =====================================================
     COMPOSITION
     ===================================================== */

  chatInput.addEventListener(
    "compositionstart",
    () => {
      state.composing =
        true;

      applyClasses();

      emit(
        "neyo:composer-composition-start"
      );
    }
  );

  chatInput.addEventListener(
    "compositionend",
    () => {
      state.composing =
        false;

      applyClasses();

      scheduleRefresh(
        "composition-end"
      );

      emit(
        "neyo:composer-composition-end"
      );
    }
  );

  /* =====================================================
     FOCUS
     ===================================================== */

  chatInput.addEventListener(
    "focus",
    () => {
      state.focused =
        true;

      applyClasses();

      emit(
        "neyo:composer-focus"
      );
    }
  );

  chatInput.addEventListener(
    "blur",
    () => {
      state.focused =
        false;

      applyClasses();

      emit(
        "neyo:composer-blur"
      );
    }
  );

  /* =====================================================
     PASTE

     Attachments.js owns pasted files.

     Composer only refreshes after normal pasted text has
     been inserted by the browser.
     ===================================================== */

  chatInput.addEventListener(
    "paste",
    event => {
      const hasFiles =
        Array.from(
          event.clipboardData
            ?.items ||
          []
        )
          .some(
            item =>
              item.kind ===
              "file"
          );

      if (hasFiles) {
        return;
      }

      requestAnimationFrame(
        () => {
          scheduleRefresh(
            "paste"
          );
        }
      );
    }
  );

  /* =====================================================
     CUT
     ===================================================== */

  chatInput.addEventListener(
    "cut",
    () => {
      requestAnimationFrame(
        () => {
          scheduleRefresh(
            "cut"
          );
        }
      );
    }
  );

  /* =====================================================
     DROP

     Attachments.js owns file drop.
     Text drop still needs composer resize.
     ===================================================== */

  chatInput.addEventListener(
    "drop",
    event => {
      const hasFiles =
        Array.from(
          event.dataTransfer
            ?.files ||
          []
        ).length > 0;

      if (hasFiles) {
        return;
      }

      requestAnimationFrame(
        () => {
          scheduleRefresh(
            "text-drop"
          );
        }
      );
    }
  );

  /* =====================================================
     EXPAND STATE OBSERVER

     composer-expand.js owns .is-writing-expanded.
     Composer responds when that owner changes it.
     ===================================================== */

  const classObserver =
    new MutationObserver(
      mutations => {
        const relevant =
          mutations.some(
            mutation =>
              mutation.type ===
                "attributes" &&
              mutation.attributeName ===
                "class"
          );

        if (!relevant) {
          return;
        }

        scheduleRefresh(
          "composer-class-change"
        );
      }
    );

  classObserver.observe(
    glassInputContainer,
    {
      attributes: true,

      attributeFilter: [
        "class"
      ]
    }
  );

  /* =====================================================
     RESIZE OBSERVER

     Important for:
     - sidebar collapse/expand
     - responsive width
     - font/UI scaling
     - mobile rotation
     ===================================================== */

  let resizeObserver = null;

  if (
    typeof ResizeObserver ===
    "function"
  ) {
    resizeObserver =
      new ResizeObserver(
        entries => {
          const entry =
            entries[0];

          const width =
            entry?.contentRect
              ?.width ||
            chatInput
              .getBoundingClientRect()
              .width;

          if (
            Math.abs(
              width -
              state.lastWidth
            ) < 1
          ) {
            return;
          }

          scheduleRefresh(
            "resize-observer"
          );
        }
      );

    resizeObserver.observe(
      glassInputContainer
    );
  }

  /* =====================================================
     WINDOW RESIZE

     Fallback + mobile orientation.
     ===================================================== */

  function handleWindowResize() {
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

          refresh({
            reason:
              "window-resize"
          });
        },
        CONFIG.resizeDebounceMs
      );
  }

  window.addEventListener(
    "resize",
    handleWindowResize,
    {
      passive: true
    }
  );

  window.addEventListener(
    "orientationchange",
    handleWindowResize,
    {
      passive: true
    }
  );

  /* =====================================================
     FONT READY

     Text wrapping can change after web fonts load.
     ===================================================== */

  try {
    document.fonts
      ?.ready
      ?.then(
        () => {
          if (
            !state.destroyed
          ) {
            refresh({
              reason:
                "fonts-ready"
            });
          }
        }
      )
      .catch(
        () => {}
      );
  } catch {}

  /* =====================================================
     ATTACHMENT STATE

     Attachment chips can alter composer geometry even
     though Composer does not own those chips.
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-change",
    () => {
      scheduleRefresh(
        "attachments-change"
      );
    }
  );

  /* =====================================================
     NEW CHAT / RESET
     ===================================================== */

  window.addEventListener(
    "neyo:composer-reset-request",
    () => {
      /*
       * new-chat.js already clears text.
       * This event guarantees geometry resets too.
       */

      scheduleRefresh(
        "composer-reset"
      );
    }
  );

  /* =====================================================
     EXTERNAL SET
     ===================================================== */

  window.addEventListener(
    "neyo:composer-set-text",
    event => {
      setValue(
        event.detail?.text ??
        "",
        {
          focus:
            Boolean(
              event.detail
                ?.focus
            )
        }
      );
    }
  );

  /* =====================================================
     EXTERNAL INSERT
     ===================================================== */

  window.addEventListener(
    "neyo:composer-insert-text",
    event => {
      insertText(
        event.detail?.text ??
        "",
        {
          focus:
            event.detail
              ?.focus !== false
        }
      );
    }
  );

  /* =====================================================
     REFRESH REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:composer-refresh-request",
    event => {
      refresh({
        reason:
          event.detail
            ?.reason ||
          "external-refresh"
      });
    }
  );

  /* =====================================================
     STATE REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:composer-state-request",
    () => {
      emit(
        "neyo:composer-state",
        snapshot()
      );
    }
  );

  /* =====================================================
     DESTROY

     Primarily diagnostics/tests.
     App normally keeps composer for page lifetime.
     ===================================================== */

  function destroy() {
    if (state.destroyed) {
      return false;
    }

    state.destroyed =
      true;

    if (
      state.refreshFrame !==
      null
    ) {
      cancelAnimationFrame(
        state.refreshFrame
      );

      state.refreshFrame =
        null;
    }

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

    classObserver.disconnect();

    resizeObserver
      ?.disconnect();

    window.removeEventListener(
      "resize",
      handleWindowResize
    );

    window.removeEventListener(
      "orientationchange",
      handleWindowResize
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

      refresh,

      scheduleRefresh,

      setValue,

      setText:
        setValue,

      insertText,

      clear,

      focus:
        focusInput,

      getValue,

      getText,

      hasText,

      isExpanded,

      isMultiline() {
        return state.multiline;
      },

      isOverflowing() {
        return state.overflowing;
      },

      getInput() {
        return chatInput;
      },

      getContainer() {
        return glassInputContainer;
      },

      getWrapper() {
        return composerWrapper;
      },

      getState:
        snapshot,

      destroy
    });

  Object.defineProperty(
    window,
    "NeyoComposer",
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

  chatInput.maxLength =
    CONFIG.maxLength;

  chatInput.setAttribute(
    "aria-multiline",
    "true"
  );

  /*
   * Never bind Enter here.
   * send-state.js is authoritative.
   */

  refresh({
    reason:
      "init",
    emitChange:
      false
  });

  emit(
    "neyo:composer-ready",
    {
      version:
        VERSION,

      active:
        true,

      autosize:
        true,

      sendOwnership:
        false,

      enterOwnership:
        false,

      attachmentOwnership:
        false,

      expandOwnership:
        false
    }
  );
})();
