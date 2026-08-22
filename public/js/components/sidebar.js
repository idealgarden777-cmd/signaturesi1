/*
=========================================================
NEYO — SIDEBAR CONTROLLER
FULL MODULAR RUNTIME

FILE:
public/js/components/sidebar.js

OWNS
---------------------------------------------------------
✅ sidebar open / close
✅ desktop collapse
✅ mobile drawer
✅ sidebar scrim
✅ top-bar sidebar toggle
✅ internal collapse button
✅ brand/home action
✅ New Conversation trigger
✅ Personalities trigger
✅ user account popup open/close
✅ popup dismissal
✅ responsive sidebar state
✅ accessibility aria state
✅ keyboard Escape handling
✅ persisted desktop collapsed preference

DOES NOT OWN
---------------------------------------------------------
❌ history rendering
❌ history API
❌ conversation loading
❌ chat state
❌ settings UI
❌ profile data
❌ logout implementation
❌ theme implementation
❌ personality picker implementation

EVENT CONTRACT
---------------------------------------------------------
sidebar.js
   ├── neyo:chat-new-request
   ├── neyo:personalities-open-request
   ├── neyo:settings-open-request
   ├── neyo:appearance-open-request
   └── neyo:logout-request

history.js
   └── #historyList

chat.js
   └── conversation state
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-sidebar-modular-v1";


  if (
    window.NeyoSidebar
      ?.__controller === true
  ) {

    console.warn(
      "[NEYO Sidebar] Already initialized."
    );


    return;
  }


  /* =====================================================
     DOM
     ===================================================== */

  const sidebar =
    document.getElementById(
      "sidebar"
    );


  const sidebarScrim =
    document.getElementById(
      "sidebarScrim"
    );


  const sidebarToggleBtn =
    document.getElementById(
      "sidebarToggleBtn"
    );


  const collapseSidebarBtn =
    document.getElementById(
      "collapseSidebarBtn"
    );


  const brandBtn =
    document.getElementById(
      "brandBtn"
    );


  const newChatBtn =
    document.getElementById(
      "newChatBtn"
    );


  const sidebarPersonalitiesBtn =
    document.getElementById(
      "sidebarPersonalitiesBtn"
    );


  const userProfileBtn =
    document.getElementById(
      "userProfileBtn"
    );


  const userPopupMenu =
    document.getElementById(
      "userPopupMenu"
    );


  const settingsBtn =
    document.getElementById(
      "settingsBtn"
    );


  const sidebarDarkModeToggle =
    document.getElementById(
      "sidebarDarkModeToggle"
    );


  const logoutBtn =
    document.getElementById(
      "logoutBtn"
    );


  if (!sidebar) {

    console.warn(
      "[NEYO Sidebar] Sidebar DOM missing."
    );


    return;
  }


  /* =====================================================
     LEGACY OWNERSHIP GATE

     As long as neo.js exists:
     expose API only,
     do not create duplicate listeners.

     Remove neo.js:
     this becomes active owner automatically.
     ===================================================== */

  const legacyOwnerActive =
    Array
      .from(
        document.scripts ||
        []
      )
      .some(
        script =>
          /(?:^|\/)neo\.js(?:\?|$)/
            .test(
              script.src ||
              ""
            )
      );


  const active =
    !legacyOwnerActive;


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({

      desktopBreakpoint:
        900,

      collapsedStorageKey:
        "neyo:sidebar-collapsed",

      mobileOpenClass:
        "sidebar-mobile-open",

      collapsedBodyClass:
        "sidebar-collapsed",

      collapsedSidebarClass:
        "collapsed",

      popupOpenClass:
        "active"
    });


  /* =====================================================
     STATE
     ===================================================== */

  const state = {

    collapsed:
      false,

    mobileOpen:
      false,

    accountPopupOpen:
      false,

    initialized:
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
     MEDIA
     ===================================================== */

  function isMobile() {

    return (
      window.innerWidth <
      CONFIG.desktopBreakpoint
    );
  }


  /* =====================================================
     STORAGE
     ===================================================== */

  function readCollapsedPreference() {

    try {

      return (
        localStorage.getItem(
          CONFIG.collapsedStorageKey
        ) ===
        "true"
      );

    } catch {

      return false;
    }
  }


  function saveCollapsedPreference(
    collapsed
  ) {

    try {

      localStorage.setItem(
        CONFIG.collapsedStorageKey,
        String(
          Boolean(
            collapsed
          )
        )
      );

    } catch {}
  }


  /* =====================================================
     SCRIM
     ===================================================== */

  function syncScrim() {

    if (!sidebarScrim) {
      return;
    }


    const visible =
      isMobile() &&
      state.mobileOpen;


    sidebarScrim.classList
      .toggle(
        "active",
        visible
      );


    sidebarScrim.setAttribute(
      "aria-hidden",
      String(
        !visible
      )
    );


    sidebarScrim.style.pointerEvents =
      visible
        ? "auto"
        : "";
  }


  /* =====================================================
     ARIA
     ===================================================== */

  function syncAccessibility() {

    const expanded =
      isMobile()
        ? state.mobileOpen
        : !state.collapsed;


    sidebarToggleBtn
      ?.setAttribute(
        "aria-expanded",
        String(
          expanded
        )
      );


    sidebarToggleBtn
      ?.setAttribute(
        "aria-controls",
        "sidebar"
      );


    collapseSidebarBtn
      ?.setAttribute(
        "aria-expanded",
        String(
          expanded
        )
      );


    collapseSidebarBtn
      ?.setAttribute(
        "aria-controls",
        "sidebar"
      );


    sidebar.setAttribute(
      "aria-hidden",
      String(
        isMobile() &&
        !state.mobileOpen
      )
    );
  }


  /* =====================================================
     ACCOUNT POPUP
     ===================================================== */

  function syncAccountPopup() {

    if (!userPopupMenu) {
      return false;
    }


    userPopupMenu.setAttribute(
      "aria-hidden",
      String(
        !state.accountPopupOpen
      )
    );


    userPopupMenu.classList.toggle(
      CONFIG.popupOpenClass,
      state.accountPopupOpen
    );


    userPopupMenu.classList.toggle(
      "open",
      state.accountPopupOpen
    );


    userProfileBtn
      ?.setAttribute(
        "aria-expanded",
        String(
          state.accountPopupOpen
        )
      );


    return state.accountPopupOpen;
  }


  function openAccountPopup() {

    if (
      !active ||
      !userPopupMenu
    ) {
      return false;
    }


    state.accountPopupOpen =
      true;


    syncAccountPopup();


    emit(
      "neyo:account-menu-opened"
    );


    return true;
  }


  function closeAccountPopup() {

    if (!userPopupMenu) {
      return false;
    }


    const wasOpen =
      state.accountPopupOpen;


    state.accountPopupOpen =
      false;


    syncAccountPopup();


    if (wasOpen) {

      emit(
        "neyo:account-menu-closed"
      );
    }


    return true;
  }


  function toggleAccountPopup() {

    if (
      state.accountPopupOpen
    ) {

      closeAccountPopup();

      return false;
    }


    openAccountPopup();

    return true;
  }


  /* =====================================================
     DESKTOP SIDEBAR
     ===================================================== */

  function setCollapsed(
    collapsed,
    {
      persist = true
    } = {}
  ) {

    state.collapsed =
      Boolean(
        collapsed
      );


    if (
      isMobile()
    ) {

      syncAccessibility();

      return state.collapsed;
    }


    sidebar.classList.toggle(
      CONFIG.collapsedSidebarClass,
      state.collapsed
    );


    document.body.classList.toggle(
      CONFIG.collapsedBodyClass,
      state.collapsed
    );


    sidebar.dataset.state =
      state.collapsed
        ? "collapsed"
        : "open";


    if (persist) {

      saveCollapsedPreference(
        state.collapsed
      );
    }


    syncAccessibility();


    emit(
      "neyo:sidebar-change",
      {
        mode:
          "desktop",

        collapsed:
          state.collapsed,

        open:
          !state.collapsed
      }
    );


    return state.collapsed;
  }


  function collapse() {

    if (
      isMobile()
    ) {

      closeMobile();

      return true;
    }


    return setCollapsed(
      true
    );
  }


  function expand() {

    if (
      isMobile()
    ) {

      openMobile();

      return true;
    }


    return setCollapsed(
      false
    );
  }


  function toggleDesktop() {

    return setCollapsed(
      !state.collapsed
    );
  }


  /* =====================================================
     MOBILE DRAWER
     ===================================================== */

  function openMobile() {

    if (
      !active ||
      !isMobile()
    ) {
      return false;
    }


    state.mobileOpen =
      true;


    sidebar.classList.add(
      "open",
      "mobile-open"
    );


    sidebar.classList.remove(
      CONFIG.collapsedSidebarClass
    );


    document.body.classList.add(
      CONFIG.mobileOpenClass
    );


    document.body.classList.remove(
      CONFIG.collapsedBodyClass
    );


    sidebar.dataset.state =
      "mobile-open";


    syncScrim();

    syncAccessibility();


    emit(
      "neyo:sidebar-change",
      {
        mode:
          "mobile",

        open:
          true,

        collapsed:
          false
      }
    );


    return true;
  }


  function closeMobile() {

    const wasOpen =
      state.mobileOpen;


    state.mobileOpen =
      false;


    sidebar.classList.remove(
      "open",
      "mobile-open"
    );


    document.body.classList.remove(
      CONFIG.mobileOpenClass
    );


    sidebar.dataset.state =
      "mobile-closed";


    closeAccountPopup();

    syncScrim();

    syncAccessibility();


    if (wasOpen) {

      emit(
        "neyo:sidebar-change",
        {
          mode:
            "mobile",

          open:
            false,

          collapsed:
            false
        }
      );
    }


    return true;
  }


  function toggleMobile() {

    if (
      state.mobileOpen
    ) {

      closeMobile();

      return false;
    }


    openMobile();

    return true;
  }


  /* =====================================================
     GENERAL TOGGLE
     ===================================================== */

  function toggle() {

    closeAccountPopup();


    return isMobile()
      ? toggleMobile()
      : toggleDesktop();
  }


  /* =====================================================
     NEW CHAT
     ===================================================== */

  function requestNewChat() {

    if (!active) {
      return false;
    }


    closeAccountPopup();


    if (
      isMobile()
    ) {

      closeMobile();
    }


    /*
     * chat.js owns actual conversation reset.
     */

    emit(
      "neyo:chat-new-request"
    );


    /*
     * Composer owns its own text/draft cleanup,
     * but calling its public API gives immediate UI reset
     * if available.
     */

    try {

      window.NeyoComposer
        ?.clear
        ?.({
          focus:
            !isMobile(),

          clearSavedDraft:
            true
        });

    } catch {}


    emit(
      "neyo:sidebar-new-chat-requested"
    );


    return true;
  }


  /* =====================================================
     BRAND / HOME
     ===================================================== */

  function requestHome() {

    if (!active) {
      return false;
    }


    closeAccountPopup();


    if (
      isMobile()
    ) {

      closeMobile();
    }


    /*
     * In current NEYO architecture,
     * brand/home returns to a fresh chat.
     */

    emit(
      "neyo:chat-new-request",
      {
        source:
          "brand"
      }
    );


    try {

      window.NeyoComposer
        ?.clear
        ?.({
          focus:
            !isMobile(),

          clearSavedDraft:
            true
        });

    } catch {}


    emit(
      "neyo:home-request"
    );


    return true;
  }


  /* =====================================================
     PERSONALITIES
     ===================================================== */

  function requestPersonalities() {

    if (!active) {
      return false;
    }


    closeAccountPopup();


    if (
      isMobile()
    ) {

      closeMobile();
    }


    emit(
      "neyo:personalities-open-request",
      {
        source:
          "sidebar"
      }
    );


    return true;
  }


  /* =====================================================
     SETTINGS / APPEARANCE / LOGOUT
     ===================================================== */

  function requestSettings() {

    if (!active) {
      return false;
    }


    closeAccountPopup();


    emit(
      "neyo:settings-open-request",
      {
        source:
          "sidebar"
      }
    );


    return true;
  }


  function requestAppearance() {

    if (!active) {
      return false;
    }


    closeAccountPopup();


    emit(
      "neyo:appearance-open-request",
      {
        source:
          "sidebar"
      }
    );


    return true;
  }


  function requestLogout() {

    if (!active) {
      return false;
    }


    closeAccountPopup();


    emit(
      "neyo:logout-request",
      {
        source:
          "sidebar"
      }
    );


    return true;
  }


  /* =====================================================
     DOCUMENT OUTSIDE CLICK
     ===================================================== */

  function handleDocumentClick(
    event
  ) {

    if (
      !active ||
      !state.accountPopupOpen
    ) {
      return;
    }


    const target =
      event.target;


    if (
      userPopupMenu
        ?.contains(
          target
        ) ||
      userProfileBtn
        ?.contains(
          target
        )
    ) {

      return;
    }


    closeAccountPopup();
  }


  /* =====================================================
     ESCAPE
     ===================================================== */

  function handleEscape(
    event
  ) {

    if (
      !active ||
      event.key !==
        "Escape"
    ) {
      return;
    }


    /*
     * Highest local priority:
     * account popup.
     */

    if (
      state.accountPopupOpen
    ) {

      event.preventDefault();


      closeAccountPopup();


      try {
        userProfileBtn?.focus();
      } catch {}


      return;
    }


    /*
     * Then mobile sidebar.
     */

    if (
      isMobile() &&
      state.mobileOpen
    ) {

      event.preventDefault();


      closeMobile();


      try {
        sidebarToggleBtn?.focus();
      } catch {}
    }
  }


  /* =====================================================
     RESPONSIVE CHANGE
     ===================================================== */

  let resizeRaf =
    0;


  function handleResize() {

    if (resizeRaf) {
      return;
    }


    resizeRaf =
      requestAnimationFrame(
        () => {

          resizeRaf =
            0;


          if (
            isMobile()
          ) {

            /*
             * Desktop collapse state is preserved
             * but not visually applied on mobile.
             */

            sidebar.classList.remove(
              CONFIG.collapsedSidebarClass
            );


            document.body.classList.remove(
              CONFIG.collapsedBodyClass
            );


            if (
              !state.mobileOpen
            ) {

              sidebar.classList.remove(
                "open",
                "mobile-open"
              );
            }

          } else {

            /*
             * Leaving mobile:
             * close drawer and restore persisted
             * desktop collapse state.
             */

            state.mobileOpen =
              false;


            sidebar.classList.remove(
              "open",
              "mobile-open"
            );


            document.body.classList.remove(
              CONFIG.mobileOpenClass
            );


            setCollapsed(
              state.collapsed,
              {
                persist:
                  false
              }
            );
          }


          closeAccountPopup();

          syncScrim();

          syncAccessibility();
        }
      );
  }


  /* =====================================================
     BUTTON HANDLERS
     ===================================================== */

  function handleSidebarToggle(
    event
  ) {

    if (!active) {
      return;
    }


    event.preventDefault();


    toggle();
  }


  function handleCollapse(
    event
  ) {

    if (!active) {
      return;
    }


    event.preventDefault();


    if (
      isMobile()
    ) {

      closeMobile();

    } else {

      collapse();
    }
  }


  function handleProfileClick(
    event
  ) {

    if (!active) {
      return;
    }


    event.preventDefault();

    event.stopPropagation();


    toggleAccountPopup();
  }


  /* =====================================================
     HISTORY INTERACTION

     history.js owns all history item clicks.
     Sidebar only closes mobile drawer after a
     conversation is successfully loaded.
     ===================================================== */

  function handleConversationLoaded() {

    closeAccountPopup();


    if (
      isMobile()
    ) {

      closeMobile();
    }
  }


  /* =====================================================
     INITIAL STATE
     ===================================================== */

  function initializeState() {

    state.collapsed =
      readCollapsedPreference();


    state.mobileOpen =
      false;


    state.accountPopupOpen =
      false;


    if (
      isMobile()
    ) {

      sidebar.classList.remove(
        CONFIG.collapsedSidebarClass
      );


      sidebar.classList.remove(
        "open",
        "mobile-open"
      );


      document.body.classList.remove(
        CONFIG.collapsedBodyClass,
        CONFIG.mobileOpenClass
      );


      sidebar.dataset.state =
        "mobile-closed";

    } else {

      setCollapsed(
        state.collapsed,
        {
          persist:
            false
        }
      );
    }


    closeAccountPopup();

    syncScrim();

    syncAccessibility();


    state.initialized =
      true;
  }


  /* =====================================================
     ACTIVE BINDINGS
     ===================================================== */

  function bind() {

    if (!active) {
      return false;
    }


    sidebarToggleBtn
      ?.addEventListener(
        "click",
        handleSidebarToggle
      );


    collapseSidebarBtn
      ?.addEventListener(
        "click",
        handleCollapse
      );


    sidebarScrim
      ?.addEventListener(
        "click",
        () => {

          closeMobile();
        }
      );


    brandBtn
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();


          requestHome();
        }
      );


    newChatBtn
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();


          requestNewChat();
        }
      );


    sidebarPersonalitiesBtn
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();


          requestPersonalities();
        }
      );


    userProfileBtn
      ?.addEventListener(
        "click",
        handleProfileClick
      );


    settingsBtn
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();


          requestSettings();
        }
      );


    sidebarDarkModeToggle
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();


          requestAppearance();
        }
      );


    logoutBtn
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();


          requestLogout();
        }
      );


    document.addEventListener(
      "click",
      handleDocumentClick
    );


    document.addEventListener(
      "keydown",
      handleEscape
    );


    window.addEventListener(
      "resize",
      handleResize,
      {
        passive:
          true
      }
    );


    window.addEventListener(
      "neyo:conversation-loaded",
      handleConversationLoaded
    );


    window.addEventListener(
      "neyo:sidebar-open-request",
      () => {

        expand();
      }
    );


    window.addEventListener(
      "neyo:sidebar-close-request",
      () => {

        if (
          isMobile()
        ) {

          closeMobile();

        } else {

          collapse();
        }
      }
    );


    window.addEventListener(
      "neyo:sidebar-toggle-request",
      () => {

        toggle();
      }
    );


    return true;
  }


  /* =====================================================
     INITIALIZE
     ===================================================== */

  if (active) {

    initializeState();

    bind();
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


      active,


      legacyOwnerActive,


      open:
        expand,


      close:
        collapse,


      toggle,


      collapse,


      expand,


      openMobile,


      closeMobile,


      toggleMobile,


      openAccountPopup,


      closeAccountPopup,


      toggleAccountPopup,


      newChat:
        requestNewChat,


      home:
        requestHome,


      openPersonalities:
        requestPersonalities,


      openSettings:
        requestSettings,


      openAppearance:
        requestAppearance,


      requestLogout,


      refresh() {

        handleResize();


        return true;
      },


      getState() {

        return {

          version:
            VERSION,


          active,


          legacyOwnerActive,


          initialized:
            state.initialized,


          mobile:
            isMobile(),


          collapsed:
            state.collapsed,


          mobileOpen:
            state.mobileOpen,


          open:
            isMobile()
              ? state.mobileOpen
              : !state.collapsed,


          accountPopupOpen:
            state.accountPopupOpen
        };
      }
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


  emit(
    "neyo:sidebar-ready",
    {
      version:
        VERSION,

      active,

      legacyOwnerActive
    }
  );

})();
