/*
=========================================================
NEYO — THEME CONTROLLER
FULL MODULAR RUNTIME

FILE:
public/js/components/theme.js

OWNS
---------------------------------------------------------
✅ System / Light / Dark theme resolution
✅ document + body theme classes
✅ color-scheme metadata
✅ prefers-color-scheme listener
✅ top bar quick theme toggle
✅ sidebar quick appearance/theme toggle
✅ settings theme request bridge
✅ theme persistence compatibility
✅ public theme API

DOES NOT OWN
---------------------------------------------------------
❌ Settings modal
❌ Accent
❌ Interface style
❌ Text size
❌ Sidebar density
❌ Profile
❌ Chat
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-theme-modular-v1";


  if (
    window.NeyoTheme
      ?.__controller === true
  ) {
    return;
  }


  /* =====================================================
     LEGACY OWNERSHIP GATE
     ===================================================== */

  const legacyOwnerActive =
    Array
      .from(
        document.scripts || []
      )
      .some(
        script =>
          /(?:^|\/)neo\.js(?:\?|$)/
            .test(
              script.src || ""
            )
      );


  const active =
    !legacyOwnerActive;


  /* =====================================================
     DOM
     ===================================================== */

  const topBarDarkModeToggle =
    document.getElementById(
      "topBarDarkModeToggle"
    );


  const sidebarDarkModeToggle =
    document.getElementById(
      "sidebarDarkModeToggle"
    );


  const themeMeta =
    document.querySelector(
      'meta[name="theme-color"]'
    );


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({

      storageKey:
        "neo_theme",

      fallback:
        "system",

      lightColor:
        "#ffffff",

      darkColor:
        "#0b0b0b"
    });


  const ALLOWED =
    Object.freeze([
      "system",
      "light",
      "dark"
    ]);


  /* =====================================================
     STATE
     ===================================================== */

  const mediaQuery =
    window.matchMedia
      ? window.matchMedia(
          "(prefers-color-scheme: dark)"
        )
      : null;


  const state = {

    preference:
      CONFIG.fallback,

    resolved:
      "light"
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
     STORAGE
     ===================================================== */

  function readStoredTheme() {

    try {

      const value =
        localStorage.getItem(
          CONFIG.storageKey
        );


      return ALLOWED.includes(
        value
      )
        ? value
        : CONFIG.fallback;

    } catch {

      return CONFIG.fallback;
    }
  }


  function storeTheme(
    value
  ) {

    try {

      localStorage.setItem(
        CONFIG.storageKey,
        value
      );


      return true;

    } catch {

      return false;
    }
  }


  /* =====================================================
     NORMALIZE
     ===================================================== */

  function normalizeTheme(
    value
  ) {

    const theme =
      String(
        value || ""
      )
        .trim()
        .toLowerCase();


    return ALLOWED.includes(
      theme
    )
      ? theme
      : CONFIG.fallback;
  }


  /* =====================================================
     RESOLVE
     ===================================================== */

  function resolveTheme(
    preference =
      state.preference
  ) {

    if (
      preference ===
      "dark"
    ) {
      return "dark";
    }


    if (
      preference ===
      "light"
    ) {
      return "light";
    }


    return mediaQuery
      ?.matches
      ? "dark"
      : "light";
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


  function renderQuickToggleIcon(
    button
  ) {

    if (!button) {
      return;
    }


    const resolved =
      state.resolved;


    const icon =
      resolved ===
      "dark"
        ? "moon"
        : "sun";


    button.innerHTML = `
      <i
        data-lucide="${icon}"
        size="20"
        aria-hidden="true"
      ></i>
    `;


    button.setAttribute(
      "aria-label",
      resolved === "dark"
        ? "Switch to light theme"
        : "Switch to dark theme"
    );


    button.setAttribute(
      "title",
      resolved === "dark"
        ? "Switch to light theme"
        : "Switch to dark theme"
    );


    button.dataset.tooltip =
      resolved === "dark"
        ? "Light theme"
        : "Dark theme";


    refreshIcons();
  }


  /* =====================================================
     APPLY
     ===================================================== */

  function applyResolvedTheme() {

    const resolved =
      resolveTheme();


    state.resolved =
      resolved;


    const dark =
      resolved ===
      "dark";


    const root =
      document.documentElement;


    root.dataset.theme =
      resolved;


    root.dataset.neyoTheme =
      state.preference;


    root.classList.toggle(
      "dark",
      dark
    );


    root.classList.toggle(
      "dark-mode",
      dark
    );


    root.classList.toggle(
      "light",
      !dark
    );


    document.body
      ?.classList
      .toggle(
        "dark-mode",
        dark
      );


    document.body
      ?.classList
      .toggle(
        "light-mode",
        !dark
      );


    if (
      document.body
    ) {

      document.body.dataset
        .theme =
        resolved;


      document.body.dataset
        .neyoTheme =
        state.preference;
    }


    root.style
      .colorScheme =
      resolved;


    if (
      themeMeta
    ) {

      themeMeta.setAttribute(
        "content",
        dark
          ? CONFIG.darkColor
          : CONFIG.lightColor
      );
    }


    renderQuickToggleIcon(
      topBarDarkModeToggle
    );


    renderQuickToggleIcon(
      sidebarDarkModeToggle
    );


    emit(
      "neyo:theme-change",
      {
        preference:
          state.preference,

        resolved
      }
    );


    return resolved;
  }


  /* =====================================================
     SET THEME
     ===================================================== */

  function setTheme(
    value,
    {
      persist = true,
      notifySettings = false
    } = {}
  ) {

    const next =
      normalizeTheme(
        value
      );


    const previous =
      state.preference;


    state.preference =
      next;


    if (persist) {

      storeTheme(
        next
      );
    }


    const resolved =
      applyResolvedTheme();


    if (
      notifySettings &&
      previous !== next
    ) {

      emit(
        "neyo:settings-set",
        {
          key:
            "theme",

          value:
            next
        }
      );
    }


    return {
      preference:
        next,

      resolved
    };
  }


  /* =====================================================
     QUICK TOGGLE

     Quick controls intentionally switch only
     between light and dark.

     "System" remains available from Settings.
     ===================================================== */

  function toggleQuick() {

    const next =
      state.resolved ===
      "dark"
        ? "light"
        : "dark";


    return setTheme(
      next,
      {
        persist:
          true,

        notifySettings:
          true
      }
    );
  }


  /* =====================================================
     SYSTEM CHANGE
     ===================================================== */

  function handleSystemThemeChange() {

    if (
      state.preference !==
      "system"
    ) {
      return;
    }


    applyResolvedTheme();
  }


  /* =====================================================
     SETTINGS BRIDGE
     ===================================================== */

  function handleThemeRequest(
    event
  ) {

    const requested =
      event.detail
        ?.theme;


    if (!requested) {
      return;
    }


    setTheme(
      requested,
      {
        persist:
          true,

        notifySettings:
          false
      }
    );
  }


  /* =====================================================
     BUTTON HANDLERS
     ===================================================== */

  function handleQuickToggle(
    event
  ) {

    if (!active) {
      return;
    }


    event.preventDefault();

    event.stopPropagation();


    toggleQuick();
  }


  /* =====================================================
     BIND
     ===================================================== */

  function bind() {

    if (!active) {
      return false;
    }


    topBarDarkModeToggle
      ?.addEventListener(
        "click",
        handleQuickToggle
      );


    /*
     * Sidebar button currently represents
     * Appearance in the sidebar menu.
     *
     * If settings.js is available,
     * open Appearance instead of blindly toggling.
     */

    sidebarDarkModeToggle
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();

          event.stopPropagation();


          if (
            window.NeyoSettings
              ?.active === true
          ) {

            emit(
              "neyo:appearance-open-request"
            );


            return;
          }


          toggleQuick();
        }
      );


    window.addEventListener(
      "neyo:theme-change-request",
      handleThemeRequest
    );


    if (
      mediaQuery
    ) {

      if (
        typeof mediaQuery
          .addEventListener ===
        "function"
      ) {

        mediaQuery.addEventListener(
          "change",
          handleSystemThemeChange
        );

      } else if (
        typeof mediaQuery
          .addListener ===
        "function"
      ) {

        mediaQuery.addListener(
          handleSystemThemeChange
        );
      }
    }


    return true;
  }


  /* =====================================================
     INIT
     ===================================================== */

  state.preference =
    readStoredTheme();


  if (active) {

    bind();

    applyResolvedTheme();
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


      set:
        setTheme,


      toggle:
        toggleQuick,


      refresh:
        applyResolvedTheme,


      getPreference:
        () =>
          state.preference,


      getResolved:
        () =>
          state.resolved,


      isDark:
        () =>
          state.resolved ===
          "dark",


      isLight:
        () =>
          state.resolved ===
          "light",


      isSystem:
        () =>
          state.preference ===
          "system",


      getState() {

        return {

          version:
            VERSION,

          active,

          legacyOwnerActive,

          preference:
            state.preference,

          resolved:
            state.resolved,

          systemDark:
            Boolean(
              mediaQuery
                ?.matches
            )
        };
      }
    });


  Object.defineProperty(
    window,
    "NeyoTheme",
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
    "neyo:theme-ready",
    {
      version:
        VERSION,

      active,

      legacyOwnerActive,

      preference:
        state.preference,

      resolved:
        state.resolved
    }
  );

})();
