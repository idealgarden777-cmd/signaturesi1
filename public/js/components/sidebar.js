/*
=========================================================
NEO — SIDEBAR
Production v4 — neo.js Baseline Modular Owner

Baseline:
- Old working neo.js sidebar behavior
- Existing #sidebar DOM
- Existing #sidebarToggleBtn
- Existing #collapseSidebarBtn
- Existing #sidebarScrim
- Existing .collapsed class
- Existing body.sidebar-collapsed contract
- Existing desktop persistence key

Owns:
- Sidebar open / collapse state
- Desktop sidebar persistence
- Mobile drawer state
- Sidebar scrim
- Sidebar toggle buttons
- Responsive mode switching
- Body sidebar state
- ARIA state
- Sidebar open / close request events

Does NOT own:
- History rendering
- New Chat
- Topbar layout
- Profile menu
- Theme
- Chat state
- Sidebar visual CSS
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-sidebar-production-v4";

  if (
    window.NeyoSidebar
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      mobileQuery:
        "(max-width: 767px)",

      desktopQuery:
        "(min-width: 768px)",

      storageKey:
        "neo_desktop_sidebar",

      collapsedValue:
        "collapsed",

      openValue:
        "open"
    });

  /* =====================================================
     DOM
     ===================================================== */

  const sidebar =
    document.getElementById(
      "sidebar"
    );

  const sidebarToggleBtn =
    document.getElementById(
      "sidebarToggleBtn"
    );

  const collapseSidebarBtn =
    document.getElementById(
      "collapseSidebarBtn"
    );

  const sidebarScrim =
    document.getElementById(
      "sidebarScrim"
    );

  if (!sidebar) {
    console.warn(
      "[NEO Sidebar] #sidebar is missing."
    );

    return;
  }

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    initialized:
      false,

    mobile:
      window.matchMedia(
        CONFIG.mobileQuery
      ).matches,

    collapsed:
      sidebar.classList
        .contains(
          "collapsed"
        ),

    lastResponsiveMode:
      null,

    lastChangedAt:
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
     DEVICE MODE
     ===================================================== */

  function isMobile() {
    return window
      .matchMedia(
        CONFIG.mobileQuery
      )
      .matches;
  }

  function isDesktop() {
    return window
      .matchMedia(
        CONFIG.desktopQuery
      )
      .matches;
  }

  /* =====================================================
     STORAGE
     ===================================================== */

  function getSavedDesktopState() {
    try {
      return localStorage
        .getItem(
          CONFIG.storageKey
        );
    } catch {
      return null;
    }
  }

  function saveDesktopState(
    collapsed
  ) {
    if (!isDesktop()) {
      return;
    }

    try {
      localStorage.setItem(
        CONFIG.storageKey,
        collapsed
          ? CONFIG.collapsedValue
          : CONFIG.openValue
      );
    } catch {}
  }

  /* =====================================================
     BODY STATE

     Exact old neo.js contract:
     body.sidebar-collapsed
     ===================================================== */

  function updateBodySidebarState() {
    const collapsed =
      sidebar.classList
        .contains(
          "collapsed"
        );

    document.body
      .classList
      .toggle(
        "sidebar-collapsed",
        collapsed
      );

    saveDesktopState(
      collapsed
    );

    return collapsed;
  }

  /* =====================================================
     SCRIM

     Exact old neo.js behavior:
     mobile + open = visible
     desktop = never visible
     ===================================================== */

  function updateScrim() {
    if (!sidebarScrim) {
      return;
    }

    const mobile =
      isMobile();

    const open =
      !sidebar.classList
        .contains(
          "collapsed"
        );

    sidebarScrim
      .classList
      .toggle(
        "visible",
        mobile && open
      );

    /*
     * Compatibility with alternate CSS builds that used
     * .show instead of .visible.
     */

    sidebarScrim
      .classList
      .toggle(
        "show",
        mobile && open
      );

    sidebarScrim.setAttribute(
      "aria-hidden",
      String(
        !(mobile && open)
      )
    );
  }

  /* =====================================================
     BUTTON ARIA
     ===================================================== */

  function updateButtons() {
    const collapsed =
      sidebar.classList
        .contains(
          "collapsed"
        );

    const open =
      !collapsed;

    /*
     * Topbar toggle represents opening the navigation.
     */

    sidebarToggleBtn
      ?.setAttribute(
        "aria-expanded",
        String(open)
      );

    sidebarToggleBtn
      ?.setAttribute(
        "aria-label",
        open
          ? "Close sidebar"
          : "Open sidebar"
      );

    /*
     * Internal collapse button always means close/collapse.
     */

    collapseSidebarBtn
      ?.setAttribute(
        "aria-expanded",
        String(open)
      );

    collapseSidebarBtn
      ?.setAttribute(
        "aria-label",
        "Collapse sidebar"
      );
  }

  /* =====================================================
     STATE EMIT
     ===================================================== */

  function emitState(
    reason = "state-change"
  ) {
    const collapsed =
      sidebar.classList
        .contains(
          "collapsed"
        );

    state.mobile =
      isMobile();

    state.collapsed =
      collapsed;

    state.lastChangedAt =
      Date.now();

    emit(
      "neyo:sidebar-state",
      {
        version:
          VERSION,

        reason,

        mobile:
          state.mobile,

        collapsed,

        open:
          !collapsed
      }
    );
  }

  /* =====================================================
     SYNC ALL
     ===================================================== */

  function sync(
    reason = "sync"
  ) {
    state.mobile =
      isMobile();

    state.collapsed =
      sidebar.classList
        .contains(
          "collapsed"
        );

    updateScrim();

    updateButtons();

    updateBodySidebarState();

    emitState(
      reason
    );

    return true;
  }

  /* =====================================================
     SET COLLAPSED
     ===================================================== */

  function setCollapsed(
    collapsed,
    {
      reason = "set",
      focus = false
    } = {}
  ) {
    const next =
      Boolean(
        collapsed
      );

    const current =
      sidebar.classList
        .contains(
          "collapsed"
        );

    if (
      current === next
    ) {
      sync(
        reason
      );

      return true;
    }

    sidebar.classList
      .toggle(
        "collapsed",
        next
      );

    sync(
      reason
    );

    if (
      focus &&
      !next
    ) {
      requestAnimationFrame(
        () => {
          collapseSidebarBtn
            ?.focus?.();
        }
      );
    }

    return true;
  }

  /* =====================================================
     OPEN
     ===================================================== */

  function open(
    options = {}
  ) {
    return setCollapsed(
      false,
      {
        reason:
          options.reason ||
          "open",

        focus:
          options.focus ===
          true
      }
    );
  }

  /* =====================================================
     CLOSE / COLLAPSE
     ===================================================== */

  function close(
    options = {}
  ) {
    return setCollapsed(
      true,
      {
        reason:
          options.reason ||
          "close",

        focus:
          false
      }
    );
  }

  function collapse(
    options = {}
  ) {
    return close(
      options
    );
  }

  /* =====================================================
     TOGGLE

     Exact old neo.js behavior:
     sidebar.classList.toggle("collapsed")
     ===================================================== */

  function toggle(
    options = {}
  ) {
    const collapsed =
      sidebar.classList
        .contains(
          "collapsed"
        );

    return setCollapsed(
      !collapsed,
      {
        reason:
          options.reason ||
          "toggle",

        focus:
          options.focus ===
          true
      }
    );
  }

  /* =====================================================
     INITIAL STATE

     Exact old neo.js behavior:

     Mobile:
     - always collapsed
     - scrim hidden

     Desktop:
     - restore neo_desktop_sidebar
     - default open
     - scrim hidden
     ===================================================== */

  function initializeSidebarState() {
    const mobile =
      isMobile();

    state.mobile =
      mobile;

    state.lastResponsiveMode =
      mobile;

    if (mobile) {
      sidebar.classList.add(
        "collapsed"
      );

      sidebarScrim
        ?.classList
        .remove(
          "visible",
          "show"
        );

    } else {
      const saved =
        getSavedDesktopState();

      sidebar.classList.toggle(
        "collapsed",
        saved ===
          CONFIG.collapsedValue
      );

      sidebarScrim
        ?.classList
        .remove(
          "visible",
          "show"
        );
    }

    state.initialized =
      true;

    sync(
      "initialize"
    );

    return true;
  }

  /* =====================================================
     BUTTON OWNERSHIP

     Capture phase is intentional while neo.js remains
     physically loaded.

     This prevents:
     modular toggle
     +
     old neo.js toggle
     =
     double toggle / no visible change
     ===================================================== */

  function handleToggleClick(
    event,
    reason
  ) {
    event.preventDefault();

    event.stopPropagation();

    event.stopImmediatePropagation();

    toggle({
      reason
    });
  }

  sidebarToggleBtn
    ?.addEventListener(
      "click",
      event => {
        handleToggleClick(
          event,
          "topbar-toggle"
        );
      },
      true
    );

  collapseSidebarBtn
    ?.addEventListener(
      "click",
      event => {
        handleToggleClick(
          event,
          "sidebar-collapse-button"
        );
      },
      true
    );

  /* =====================================================
     SCRIM

     Old neo.js toggled sidebar through same toggle function.
     In modular version we close explicitly to avoid any
     race where the drawer somehow changed state first.
     ===================================================== */

  sidebarScrim
    ?.addEventListener(
      "click",
      event => {
        event.preventDefault();

        event.stopPropagation();

        event.stopImmediatePropagation();

        if (!isMobile()) {
          updateScrim();

          return;
        }

        close({
          reason:
            "scrim"
        });
      },
      true
    );

  /* =====================================================
     MOBILE NEW CHAT

     Old neo.js closed sidebar after New Chat on mobile.

     We preserve behavior by responding to canonical
     neyo:chat-new instead of owning newChatBtn.
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new",
    () => {
      if (!isMobile()) {
        return;
      }

      close({
        reason:
          "new-chat"
      });
    }
  );

  /* =====================================================
     MOBILE HISTORY OPEN

     Old working UX collapses drawer after selecting a
     conversation.
     ===================================================== */

  window.addEventListener(
    "neyo:history-opened",
    () => {
      if (!isMobile()) {
        return;
      }

      close({
        reason:
          "history-opened"
      });
    }
  );

  /* =====================================================
     REQUEST EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:sidebar-open-request",
    event => {
      open({
        reason:
          event.detail
            ?.reason ||
          "external-open",

        focus:
          event.detail
            ?.focus ===
          true
      });
    }
  );

  window.addEventListener(
    "neyo:sidebar-close-request",
    event => {
      close({
        reason:
          event.detail
            ?.reason ||
          "external-close"
      });
    }
  );

  window.addEventListener(
    "neyo:sidebar-collapse-request",
    event => {
      close({
        reason:
          event.detail
            ?.reason ||
          "external-collapse"
      });
    }
  );

  window.addEventListener(
    "neyo:sidebar-toggle-request",
    event => {
      toggle({
        reason:
          event.detail
            ?.reason ||
          "external-toggle"
      });
    }
  );

  /* =====================================================
     RESPONSIVE MODE SWITCH

     Exact neo.js concept:
     only reinitialize when crossing 767px boundary.

     Desktop resize inside desktop:
     preserve state.

     Mobile resize inside mobile:
     preserve drawer state.
     ===================================================== */

  function handleResponsiveChange() {
    const mobile =
      isMobile();

    if (
      mobile ===
      state.lastResponsiveMode
    ) {
      /*
       * Width changed but mode did not.
       * Only keep scrim/body synchronized.
       */

      updateScrim();

      updateButtons();

      return;
    }

    state.lastResponsiveMode =
      mobile;

    initializeSidebarState();

    emit(
      "neyo:sidebar-responsive-change",
      {
        mobile
      }
    );
  }

  window.addEventListener(
    "resize",
    handleResponsiveChange,
    {
      passive: true
    }
  );

  window.addEventListener(
    "orientationchange",
    handleResponsiveChange,
    {
      passive: true
    }
  );

  /* =====================================================
     ESCAPE — MOBILE DRAWER

     Desktop collapse remains explicit button behavior.
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key !==
        "Escape" ||
        !isMobile() ||
        sidebar.classList
          .contains(
            "collapsed"
          )
      ) {
        return;
      }

      const target =
        event.target;

      /*
       * Let dialogs consume Escape first.
       */

      if (
        target instanceof
          Element &&
        target.closest(
          [
            "[role='dialog']",
            ".modal",
            ".history-dialog"
          ].join(",")
        )
      ) {
        return;
      }

      event.preventDefault();

      close({
        reason:
          "escape"
      });

      requestAnimationFrame(
        () => {
          sidebarToggleBtn
            ?.focus?.();
        }
      );
    },
    true
  );

  /* =====================================================
     EXTERNAL CLASS MUTATIONS

     During migration old CSS/legacy modules may still
     mutate sidebar class directly.

     Observe and re-sync supporting state without fighting
     the class itself.
     ===================================================== */

  let internalMutationFrame =
    null;

  const observer =
    new MutationObserver(
      mutations => {
        const changed =
          mutations.some(
            mutation =>
              mutation.type ===
                "attributes" &&
              mutation.attributeName ===
                "class"
          );

        if (!changed) {
          return;
        }

        if (
          internalMutationFrame !==
          null
        ) {
          return;
        }

        internalMutationFrame =
          requestAnimationFrame(
            () => {
              internalMutationFrame =
                null;

              sync(
                "class-mutation"
              );
            }
          );
      }
    );

  observer.observe(
    sidebar,
    {
      attributes: true,

      attributeFilter: [
        "class"
      ]
    }
  );

  /* =====================================================
     STATE REQUEST
     ===================================================== */

  window.addEventListener(
    "neyo:sidebar-state-request",
    () => {
      emit(
        "neyo:sidebar-state",
        getState()
      );
    }
  );

  /* =====================================================
     STATE
     ===================================================== */

  function getState() {
    const collapsed =
      sidebar.classList
        .contains(
          "collapsed"
        );

    return {
      version:
        VERSION,

      active:
        true,

      initialized:
        state.initialized,

      mobile:
        isMobile(),

      collapsed,

      open:
        !collapsed,

      scrimVisible:
        Boolean(
          sidebarScrim &&
          (
            sidebarScrim
              .classList
              .contains(
                "visible"
              ) ||
            sidebarScrim
              .classList
              .contains(
                "show"
              )
          )
        ),

      persistedDesktopState:
        getSavedDesktopState(),

      lastChangedAt:
        state.lastChangedAt
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

      open,

      close,

      collapse,

      toggle,

      setCollapsed,

      initialize:
        initializeSidebarState,

      refresh(
        reason =
          "manual-refresh"
      ) {
        return sync(
          reason
        );
      },

      isOpen() {
        return !sidebar
          .classList
          .contains(
            "collapsed"
          );
      },

      isCollapsed() {
        return sidebar
          .classList
          .contains(
            "collapsed"
          );
      },

      isMobile,

      getState
    });

  Object.defineProperty(
    window,
    "NeyoSidebar",
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

  initializeSidebarState();

  emit(
    "neyo:sidebar-ready",
    {
      version:
        VERSION,

      active:
        true,

      baseline:
        "neo.js",

      ...getState()
    }
  );
})();
