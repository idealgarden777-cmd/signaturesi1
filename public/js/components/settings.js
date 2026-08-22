/*
=========================================================
NEYO — SETTINGS CONTROLLER
FULL MODULAR RUNTIME

FILE:
public/js/components/settings.js

OWNS
---------------------------------------------------------
✅ Settings modal open / close
✅ Settings navigation tabs
✅ General settings UI
✅ Appearance settings UI state
✅ Language selector
✅ Default personality selector
✅ Open-on selector
✅ Private Chat toggle
✅ Auto-save Drafts toggle
✅ Preference persistence
✅ Settings → chat preference bridge
✅ Settings → theme/interface bridge
✅ Accessibility attributes
✅ Escape / outside modal behavior
✅ Settings state synchronization

DOES NOT OWN
---------------------------------------------------------
❌ Theme implementation
❌ Profile save/upload implementation
❌ Authentication/logout
❌ Chat transport
❌ Personality picker UI
❌ Composer implementation
❌ Sidebar implementation

EVENT CONTRACT
---------------------------------------------------------
settings.js
   ↓
neyo:chat-preferences-set
   ↓
chat.js

settings.js
   ↓
neyo:theme-change-request
neyo:interface-change
neyo:appearance-change

settings.js
   ↓
neyo:autosave-drafts-change
   ↓
composer.js
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-settings-modular-v1";


  if (
    window.NeyoSettings
      ?.__controller === true
  ) {
    return;
  }


  /* =====================================================
     ROOT DOM
     ===================================================== */

  const overlay =
    document.getElementById(
      "neoSettingsOverlay"
    );


  const modal =
    overlay?.querySelector(
      ".neo-settings-modal"
    ) || null;


  const closeBtn =
    document.getElementById(
      "neoSettingsCloseBtn"
    );


  const settingsTabs =
    Array.from(
      document.querySelectorAll(
        ".neo-settings-tab[data-settings-tab]"
      )
    );


  const settingsPanels =
    Array.from(
      document.querySelectorAll(
        ".neo-settings-panel"
      )
    );


  if (
    !overlay ||
    !modal
  ) {
    console.warn(
      "[NEYO Settings] Settings DOM missing."
    );

    return;
  }


  /* =====================================================
     LEGACY OWNERSHIP GATE
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
     GENERAL DOM
     ===================================================== */

  const settingsThemeControl =
    document.getElementById(
      "settingsThemeControl"
    );


  const settingsIntelligenceControl =
    document.getElementById(
      "settingsIntelligenceControl"
    );


  const settingsPrivateChatToggle =
    document.getElementById(
      "settingsPrivateChatToggle"
    );


  const settingsInterfaceControl =
    document.getElementById(
      "settingsInterfaceControl"
    );


  const settingsLanguageBtn =
    document.getElementById(
      "settingsLanguageBtn"
    );


  const settingsLanguageMenu =
    document.getElementById(
      "settingsLanguageMenu"
    );


  const settingsLanguageValue =
    document.getElementById(
      "settingsLanguageValue"
    );


  const settingsDefaultPersonalityBtn =
    document.getElementById(
      "settingsDefaultPersonalityBtn"
    );


  const settingsDefaultPersonalityMenu =
    document.getElementById(
      "settingsDefaultPersonalityMenu"
    );


  const settingsDefaultPersonalityValue =
    document.getElementById(
      "settingsDefaultPersonalityValue"
    );


  const settingsOpenOnBtn =
    document.getElementById(
      "settingsOpenOnBtn"
    );


  const settingsOpenOnMenu =
    document.getElementById(
      "settingsOpenOnMenu"
    );


  const settingsOpenOnValue =
    document.getElementById(
      "settingsOpenOnValue"
    );


  const settingsAutoSaveToggle =
    document.getElementById(
      "settingsAutoSaveToggle"
    );


  /* =====================================================
     APPEARANCE DOM
     ===================================================== */

  const appearanceInterfaceControl =
    document.getElementById(
      "appearanceInterfaceControl"
    );


  const appearanceThemeControl =
    document.getElementById(
      "appearanceThemeControl"
    );


  const appearanceAccentControl =
    document.getElementById(
      "appearanceAccentControl"
    );


  const appearanceTextSizeControl =
    document.getElementById(
      "appearanceTextSizeControl"
    );


  const appearanceContentWidthControl =
    document.getElementById(
      "appearanceContentWidthControl"
    );


  const appearanceSidebarDensityControl =
    document.getElementById(
      "appearanceSidebarDensityControl"
    );


  const appearanceMotionControl =
    document.getElementById(
      "appearanceMotionControl"
    );


  /* =====================================================
     CONFIG
     ===================================================== */

  const DEFAULTS =
    Object.freeze({

      theme:
        "system",

      interface:
        "minimal",

      intelligence:
        "standard",

      privateChat:
        false,

      language:
        "auto",

      defaultPersonality:
        "neyo",

      openOn:
        "new-chat",

      autoSaveDrafts:
        true,

      accent:
        "neutral",

      textSize:
        "default",

      contentWidth:
        "balanced",

      sidebarDensity:
        "comfortable",

      motion:
        "on"
    });


  /*
   * Keep historical storage names.
   *
   * This means removing neo.js does NOT erase
   * existing user preferences.
   */

  const STORAGE_KEYS =
    Object.freeze({

      theme:
        "neo_theme",

      interface:
        "neo_interface",

      intelligence:
        "neo_intelligence",

      privateChat:
        "neo_private_chat",

      language:
        "neo_language",

      defaultPersonality:
        "neo_default_personality",

      openOn:
        "neo_open_on",

      autoSaveDrafts:
        "neo_auto_save_drafts",

      accent:
        "neo_accent",

      textSize:
        "neo_text_size",

      contentWidth:
        "neo_content_width",

      sidebarDensity:
        "neo_sidebar_density",

      motion:
        "neo_motion"
    });


  const ALLOWED_VALUES =
    Object.freeze({

      theme:
        [
          "system",
          "light",
          "dark"
        ],

      interface:
        [
          "minimal",
          "warm",
          "glass"
        ],

      intelligence:
        [
          "standard",
          "maximum"
        ],

      language:
        [
          "auto",
          "english",
          "urdu",
          "roman-urdu"
        ],

      defaultPersonality:
        [
          "neyo",
          "zadi",
          "wizi"
        ],

      openOn:
        [
          "new-chat",
          "last-chat"
        ],

      accent:
        [
          "neutral",
          "emerald",
          "violet",
          "blue"
        ],

      textSize:
        [
          "small",
          "default",
          "large"
        ],

      contentWidth:
        [
          "compact",
          "balanced",
          "wide"
        ],

      sidebarDensity:
        [
          "compact",
          "comfortable"
        ],

      motion:
        [
          "on",
          "reduced"
        ]
    });


  const LABELS =
    Object.freeze({

      language: {
        auto:
          "Auto-detect",

        english:
          "English",

        urdu:
          "Urdu",

        "roman-urdu":
          "Roman Urdu"
      },


      defaultPersonality: {
        neyo:
          "Neyo",

        zadi:
          "Zadi",

        wizi:
          "Wizi"
      },


      openOn: {
        "new-chat":
          "New chat",

        "last-chat":
          "Last chat"
      }
    });


  /* =====================================================
     STATE
     ===================================================== */

  const state = {

    open:
      false,

    activeTab:
      "general",

    lastFocused:
      null,

    selectMenu:
      null,

    preferences:
      {
        ...DEFAULTS
      }
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
     SAFE STORAGE
     ===================================================== */

  function readStorage(
    key
  ) {

    try {

      return localStorage
        .getItem(
          key
        );

    } catch {

      return null;
    }
  }


  function writeStorage(
    key,
    value
  ) {

    try {

      localStorage.setItem(
        key,
        String(
          value
        )
      );


      return true;

    } catch {

      return false;
    }
  }


  /* =====================================================
     BOOLEAN STORAGE
     ===================================================== */

  function parseBoolean(
    value,
    fallback
  ) {

    if (
      value === null ||
      value === undefined
    ) {
      return fallback;
    }


    if (
      value === true ||
      value === "true" ||
      value === "on" ||
      value === "1"
    ) {
      return true;
    }


    if (
      value === false ||
      value === "false" ||
      value === "off" ||
      value === "0"
    ) {
      return false;
    }


    return fallback;
  }


  /* =====================================================
     VALIDATION
     ===================================================== */

  function normalizePreference(
    key,
    value
  ) {

    if (
      key ===
        "privateChat" ||
      key ===
        "autoSaveDrafts"
    ) {

      return Boolean(
        value
      );
    }


    const allowed =
      ALLOWED_VALUES[
        key
      ];


    if (
      Array.isArray(
        allowed
      ) &&
      allowed.includes(
        value
      )
    ) {

      return value;
    }


    return DEFAULTS[
      key
    ];
  }


  /* =====================================================
     LOAD PREFERENCES
     ===================================================== */

  function loadPreference(
    key
  ) {

    const storageKey =
      STORAGE_KEYS[
        key
      ];


    if (!storageKey) {

      return DEFAULTS[
        key
      ];
    }


    const stored =
      readStorage(
        storageKey
      );


    if (
      key ===
        "privateChat" ||
      key ===
        "autoSaveDrafts"
    ) {

      return parseBoolean(
        stored,
        DEFAULTS[
          key
        ]
      );
    }


    return normalizePreference(
      key,
      stored ??
        DEFAULTS[
          key
        ]
    );
  }


  function loadPreferences() {

    for (
      const key
      of Object.keys(
        DEFAULTS
      )
    ) {

      state.preferences[
        key
      ] =
        loadPreference(
          key
        );
    }


    return {
      ...state.preferences
    };
  }


  /* =====================================================
     WRITE PREFERENCE
     ===================================================== */

  function persistPreference(
    key,
    value
  ) {

    const storageKey =
      STORAGE_KEYS[
        key
      ];


    if (!storageKey) {
      return false;
    }


    let storedValue =
      value;


    /*
     * Preserve old neo.js boolean format.
     */

    if (
      key ===
        "privateChat" ||
      key ===
        "autoSaveDrafts"
    ) {

      storedValue =
        value
          ? "on"
          : "off";
    }


    return writeStorage(
      storageKey,
      storedValue
    );
  }


  /* =====================================================
     CHAT PREFERENCES BRIDGE
     ===================================================== */

  function syncChatPreferences() {

    emit(
      "neyo:chat-preferences-set",
      {
        intelligence:
          state.preferences
            .intelligence,

        language:
          state.preferences
            .language,

        personality:
          state.preferences
            .defaultPersonality,

        privateChat:
          Boolean(
            state.preferences
              .privateChat
          )
      }
    );
  }


  /* =====================================================
     APPEARANCE DATA ATTRIBUTES
     ===================================================== */

  function applyBodyPreferenceState() {

    const prefs =
      state.preferences;


    document.body.dataset
      .neyoTheme =
      prefs.theme;


    document.body.dataset
      .neyoInterface =
      prefs.interface;


    document.body.dataset
      .neyoAccent =
      prefs.accent;


    document.body.dataset
      .neyoTextSize =
      prefs.textSize;


    document.body.dataset
      .neyoContentWidth =
      prefs.contentWidth;


    document.body.dataset
      .neyoSidebarDensity =
      prefs.sidebarDensity;


    document.body.dataset
      .neyoMotion =
      prefs.motion;


    document.body.classList
      .toggle(
        "neo-private-chat",
        Boolean(
          prefs.privateChat
        )
      );


    document.documentElement
      .dataset
      .neyoTheme =
      prefs.theme;


    document.documentElement
      .dataset
      .neyoInterface =
      prefs.interface;
  }


  /* =====================================================
     DOMAIN EVENTS
     ===================================================== */

  function dispatchPreferenceEffects(
    key,
    value
  ) {

    if (
      key ===
      "theme"
    ) {

      emit(
        "neyo:theme-change-request",
        {
          theme:
            value,

          source:
            "settings"
        }
      );
    }


    if (
      key ===
      "interface"
    ) {

      emit(
        "neyo:interface-change",
        {
          interface:
            value,

          source:
            "settings"
        }
      );
    }


    if (
      key ===
      "intelligence"
    ) {

      emit(
        "neyo:intelligence-change",
        {
          intelligence:
            value
        }
      );
    }


    if (
      key ===
      "privateChat"
    ) {

      emit(
        "neyo:private-chat-change",
        {
          enabled:
            Boolean(
              value
            )
        }
      );
    }


    if (
      key ===
      "language"
    ) {

      emit(
        "neyo:language-change",
        {
          language:
            value
        }
      );
    }


    if (
      key ===
      "defaultPersonality"
    ) {

      emit(
        "neyo:personality-change",
        {
          personality:
            value,

          source:
            "settings"
        }
      );
    }


    if (
      key ===
      "autoSaveDrafts"
    ) {

      emit(
        "neyo:autosave-drafts-change",
        {
          enabled:
            Boolean(
              value
            )
        }
      );
    }


    if (
      [
        "accent",
        "textSize",
        "contentWidth",
        "sidebarDensity",
        "motion"
      ].includes(
        key
      )
    ) {

      emit(
        "neyo:appearance-change",
        {
          key,

          value,

          preferences: {
            ...state.preferences
          }
        }
      );
    }
  }


  /* =====================================================
     SET PREFERENCE
     ===================================================== */

  function setPreference(
    key,
    value,
    {
      persist = true,
      emitChange = true
    } = {}
  ) {

    if (
      !Object.prototype
        .hasOwnProperty
        .call(
          DEFAULTS,
          key
        )
    ) {

      console.warn(
        `[NEYO Settings] Unknown preference: ${key}`
      );


      return false;
    }


    const normalized =
      normalizePreference(
        key,
        value
      );


    const previous =
      state.preferences[
        key
      ];


    state.preferences[
      key
    ] =
      normalized;


    if (persist) {

      persistPreference(
        key,
        normalized
      );
    }


    applyBodyPreferenceState();

    syncControls();


    if (
      [
        "intelligence",
        "language",
        "defaultPersonality",
        "privateChat"
      ].includes(
        key
      )
    ) {

      syncChatPreferences();
    }


    if (
      emitChange &&
      previous !==
        normalized
    ) {

      dispatchPreferenceEffects(
        key,
        normalized
      );


      emit(
        "neyo:settings-change",
        {
          key,

          value:
            normalized,

          previous,

          preferences: {
            ...state.preferences
          }
        }
      );
    }


    return normalized;
  }


  /* =====================================================
     SEGMENTED CONTROLS
     ===================================================== */

  function syncSegmentedControl(
    container,
    value
  ) {

    if (!container) {
      return;
    }


    const buttons =
      container
        .querySelectorAll(
          "button[data-value]"
        );


    for (
      const button
      of buttons
    ) {

      const selected =
        button.dataset
          .value ===
        value;


      button.classList
        .toggle(
          "active",
          selected
        );


      button.setAttribute(
        "aria-pressed",
        String(
          selected
        )
      );
    }
  }


  function bindSegmentedControl(
    container,
    key
  ) {

    if (!container) {
      return;
    }


    container.addEventListener(
      "click",
      event => {

        if (!active) {
          return;
        }


        const button =
          event.target
            ?.closest
            ?.(
              "button[data-value]"
            );


        if (
          !button ||
          !container.contains(
            button
          )
        ) {
          return;
        }


        event.preventDefault();


        setPreference(
          key,
          button.dataset
            .value
        );
      }
    );
  }


  /* =====================================================
     TOGGLE CONTROL
     ===================================================== */

  function syncSwitch(
    button,
    enabled
  ) {

    if (!button) {
      return;
    }


    const value =
      Boolean(
        enabled
      );


    button.classList
      .toggle(
        "active",
        value
      );


    button.setAttribute(
      "aria-checked",
      String(
        value
      )
    );
  }


  /* =====================================================
     SELECT MENUS
     ===================================================== */

  function isMenuOpen(
    menu
  ) {

    return (
      menu &&
      menu.hidden ===
        false
    );
  }


  function closeSelectMenu(
    menu,
    button
  ) {

    if (!menu) {
      return;
    }


    menu.hidden =
      true;


    menu.classList
      .remove(
        "active",
        "open"
      );


    button
      ?.setAttribute(
        "aria-expanded",
        "false"
      );


    if (
      state.selectMenu ===
      menu
    ) {

      state.selectMenu =
        null;
    }
  }


  function closeAllSelectMenus() {

    closeSelectMenu(
      settingsLanguageMenu,
      settingsLanguageBtn
    );


    closeSelectMenu(
      settingsDefaultPersonalityMenu,
      settingsDefaultPersonalityBtn
    );


    closeSelectMenu(
      settingsOpenOnMenu,
      settingsOpenOnBtn
    );
  }


  function openSelectMenu(
    menu,
    button
  ) {

    if (!menu) {
      return false;
    }


    closeAllSelectMenus();


    menu.hidden =
      false;


    menu.classList
      .add(
        "active",
        "open"
      );


    button
      ?.setAttribute(
        "aria-expanded",
        "true"
      );


    state.selectMenu =
      menu;


    const selected =
      menu.querySelector(
        '[aria-selected="true"]'
      );


    selected
      ?.focus
      ?.();


    return true;
  }


  function toggleSelectMenu(
    menu,
    button
  ) {

    if (
      isMenuOpen(
        menu
      )
    ) {

      closeSelectMenu(
        menu,
        button
      );


      return false;
    }


    return openSelectMenu(
      menu,
      button
    );
  }


  function syncSelect(
    menu,
    valueElement,
    value,
    labels
  ) {

    if (
      valueElement
    ) {

      valueElement.textContent =
        labels?.[
          value
        ] ||
        value;
    }


    if (!menu) {
      return;
    }


    for (
      const option
      of menu.querySelectorAll(
        ".settings-select-option[data-value]"
      )
    ) {

      const selected =
        option.dataset
          .value ===
        value;


      option.classList
        .toggle(
          "active",
          selected
        );


      option.setAttribute(
        "aria-selected",
        String(
          selected
        )
      );
    }
  }


  function bindSelect(
    button,
    menu,
    key
  ) {

    if (
      !button ||
      !menu
    ) {
      return;
    }


    button.addEventListener(
      "click",
      event => {

        if (!active) {
          return;
        }


        event.preventDefault();

        event.stopPropagation();


        toggleSelectMenu(
          menu,
          button
        );
      }
    );


    menu.addEventListener(
      "click",
      event => {

        if (!active) {
          return;
        }


        const option =
          event.target
            ?.closest
            ?.(
              ".settings-select-option[data-value]"
            );


        if (
          !option ||
          !menu.contains(
            option
          )
        ) {
          return;
        }


        event.preventDefault();


        setPreference(
          key,
          option.dataset
            .value
        );


        closeSelectMenu(
          menu,
          button
        );


        button.focus();
      }
    );


    menu.addEventListener(
      "keydown",
      event => {

        const options =
          Array.from(
            menu.querySelectorAll(
              ".settings-select-option[data-value]"
            )
          );


        if (!options.length) {
          return;
        }


        const index =
          options.indexOf(
            document.activeElement
          );


        if (
          event.key ===
          "ArrowDown"
        ) {

          event.preventDefault();


          const next =
            index < 0
              ? 0
              : (
                  index + 1
                ) %
                options.length;


          options[
            next
          ].focus();


          return;
        }


        if (
          event.key ===
          "ArrowUp"
        ) {

          event.preventDefault();


          const next =
            index <= 0
              ? options.length -
                1
              : index - 1;


          options[
            next
          ].focus();


          return;
        }


        if (
          event.key ===
          "Escape"
        ) {

          event.preventDefault();


          closeSelectMenu(
            menu,
            button
          );


          button.focus();
        }
      }
    );
  }


  /* =====================================================
     SYNC CONTROLS
     ===================================================== */

  function syncControls() {

    const prefs =
      state.preferences;


    syncSegmentedControl(
      settingsThemeControl,
      prefs.theme
    );


    syncSegmentedControl(
      appearanceThemeControl,
      prefs.theme
    );


    syncSegmentedControl(
      settingsInterfaceControl,
      prefs.interface
    );


    syncSegmentedControl(
      appearanceInterfaceControl,
      prefs.interface
    );


    syncSegmentedControl(
      settingsIntelligenceControl,
      prefs.intelligence
    );


    syncSegmentedControl(
      appearanceAccentControl,
      prefs.accent
    );


    syncSegmentedControl(
      appearanceTextSizeControl,
      prefs.textSize
    );


    syncSegmentedControl(
      appearanceContentWidthControl,
      prefs.contentWidth
    );


    syncSegmentedControl(
      appearanceSidebarDensityControl,
      prefs.sidebarDensity
    );


    syncSegmentedControl(
      appearanceMotionControl,
      prefs.motion
    );


    syncSwitch(
      settingsPrivateChatToggle,
      prefs.privateChat
    );


    syncSwitch(
      settingsAutoSaveToggle,
      prefs.autoSaveDrafts
    );


    syncSelect(
      settingsLanguageMenu,
      settingsLanguageValue,
      prefs.language,
      LABELS.language
    );


    syncSelect(
      settingsDefaultPersonalityMenu,
      settingsDefaultPersonalityValue,
      prefs.defaultPersonality,
      LABELS.defaultPersonality
    );


    syncSelect(
      settingsOpenOnMenu,
      settingsOpenOnValue,
      prefs.openOn,
      LABELS.openOn
    );
  }


  /* =====================================================
     TAB PANEL LOOKUP
     ===================================================== */

  function panelForTab(
    name
  ) {

    const normalized =
      String(
        name ||
        ""
      )
        .trim()
        .toLowerCase();


    if (!normalized) {
      return null;
    }


    const id =
      "settingsPanel" +
      normalized
        .charAt(0)
        .toUpperCase() +
      normalized
        .slice(1);


    return document
      .getElementById(
        id
      );
  }


  /* =====================================================
     SETTINGS TABS
     ===================================================== */

  function selectTab(
    name,
    {
      focus = false
    } = {}
  ) {

    const normalized =
      String(
        name ||
        "general"
      )
        .trim()
        .toLowerCase();


    const panel =
      panelForTab(
        normalized
      );


    if (!panel) {
      return false;
    }


    state.activeTab =
      normalized;


    for (
      const tab
      of settingsTabs
    ) {

      const selected =
        tab.dataset
          .settingsTab ===
        normalized;


      tab.classList
        .toggle(
          "active",
          selected
        );


      tab.setAttribute(
        "aria-selected",
        String(
          selected
        )
      );


      tab.setAttribute(
        "tabindex",
        selected
          ? "0"
          : "-1"
      );


      if (
        selected &&
        focus
      ) {

        tab.focus();
      }
    }


    for (
      const item
      of settingsPanels
    ) {

      const selected =
        item ===
        panel;


      item.classList
        .toggle(
          "active",
          selected
        );


      item.hidden =
        !selected;


      item.setAttribute(
        "aria-hidden",
        String(
          !selected
        )
      );
    }


    closeAllSelectMenus();


    emit(
      "neyo:settings-tab-change",
      {
        tab:
          normalized
      }
    );


    /*
     * Profile module can populate profile fields
     * when Profile becomes visible.
     */

    if (
      normalized ===
      "profile"
    ) {

      emit(
        "neyo:profile-settings-open-request"
      );
    }


    return true;
  }


  /* =====================================================
     OPEN
     ===================================================== */

  function open(
    tab = "general"
  ) {

    if (!active) {
      return false;
    }


    state.lastFocused =
      document.activeElement instanceof
      HTMLElement
        ? document.activeElement
        : null;


    state.open =
      true;


    overlay.setAttribute(
      "aria-hidden",
      "false"
    );


    overlay.classList.add(
      "active",
      "open"
    );


    document.body.classList.add(
      "neyo-settings-open"
    );


    selectTab(
      tab
    );


    requestAnimationFrame(
      () => {

        closeBtn
          ?.focus
          ?.();
      }
    );


    emit(
      "neyo:settings-opened",
      {
        tab:
          state.activeTab
      }
    );


    return true;
  }


  /* =====================================================
     CLOSE
     ===================================================== */

  function close({
    restoreFocus = true
  } = {}) {

    const wasOpen =
      state.open;


    state.open =
      false;


    closeAllSelectMenus();


    overlay.setAttribute(
      "aria-hidden",
      "true"
    );


    overlay.classList.remove(
      "active",
      "open"
    );


    document.body.classList.remove(
      "neyo-settings-open"
    );


    if (
      restoreFocus &&
      state.lastFocused &&
      document.contains(
        state.lastFocused
      )
    ) {

      try {
        state.lastFocused.focus();
      } catch {}
    }


    state.lastFocused =
      null;


    if (wasOpen) {

      emit(
        "neyo:settings-closed"
      );
    }


    return true;
  }


  function toggle() {

    return state.open
      ? (
          close(),
          false
        )
      : (
          open(),
          true
        );
  }


  /* =====================================================
     SETTINGS REQUESTS
     ===================================================== */

  function handleSettingsOpenRequest(
    event
  ) {

    const tab =
      event.detail
        ?.tab ||
      "general";


    open(
      tab
    );
  }


  function handleAppearanceOpenRequest() {

    open(
      "appearance"
    );
  }


  function handlePersonalitiesOpenRequest() {

    open(
      "personalities"
    );
  }


  /* =====================================================
     OVERLAY CLICK
     ===================================================== */

  function handleOverlayClick(
    event
  ) {

    if (
      !active ||
      !state.open
    ) {
      return;
    }


    if (
      event.target ===
      overlay
    ) {

      close();
    }
  }


  /* =====================================================
     DOCUMENT CLICK
     ===================================================== */

  function handleDocumentClick(
    event
  ) {

    if (
      !active ||
      !state.open ||
      !state.selectMenu
    ) {
      return;
    }


    const target =
      event.target;


    const pairs = [
      [
        settingsLanguageMenu,
        settingsLanguageBtn
      ],

      [
        settingsDefaultPersonalityMenu,
        settingsDefaultPersonalityBtn
      ],

      [
        settingsOpenOnMenu,
        settingsOpenOnBtn
      ]
    ];


    for (
      const [
        menu,
        button
      ]
      of pairs
    ) {

      if (
        menu ===
        state.selectMenu
      ) {

        if (
          menu
            ?.contains(
              target
            ) ||
          button
            ?.contains(
              target
            )
        ) {
          return;
        }


        closeSelectMenu(
          menu,
          button
        );


        return;
      }
    }
  }


  /* =====================================================
     ESCAPE
     ===================================================== */

  function handleKeydown(
    event
  ) {

    if (
      !active ||
      !state.open
    ) {
      return;
    }


    if (
      event.key !==
      "Escape"
    ) {
      return;
    }


    if (
      state.selectMenu
    ) {

      closeAllSelectMenus();

      return;
    }


    event.preventDefault();


    close();
  }


  /* =====================================================
     PRIVATE CHAT
     ===================================================== */

  function togglePrivateChat() {

    const next =
      !Boolean(
        state.preferences
          .privateChat
      );


    setPreference(
      "privateChat",
      next
    );


    return next;
  }


  /* =====================================================
     AUTO SAVE
     ===================================================== */

  function toggleAutoSave() {

    const next =
      !Boolean(
        state.preferences
          .autoSaveDrafts
      );


    setPreference(
      "autoSaveDrafts",
      next
    );


    return next;
  }


  /* =====================================================
     APPLY INITIAL STATE

     We emit initial domain events after modules
     have had one microtask to initialize.
     ===================================================== */

  function applyInitialState() {

    loadPreferences();

    applyBodyPreferenceState();

    syncControls();


    queueMicrotask(
      () => {

        syncChatPreferences();


        emit(
          "neyo:theme-change-request",
          {
            theme:
              state.preferences
                .theme,

            source:
              "settings-init"
          }
        );


        emit(
          "neyo:interface-change",
          {
            interface:
              state.preferences
                .interface,

            source:
              "settings-init"
          }
        );


        emit(
          "neyo:appearance-change",
          {
            preferences: {
              ...state.preferences
            },

            source:
              "settings-init"
          }
        );


        emit(
          "neyo:autosave-drafts-change",
          {
            enabled:
              Boolean(
                state.preferences
                  .autoSaveDrafts
              )
          }
        );
      }
    );
  }


  /* =====================================================
     BIND
     ===================================================== */

  function bind() {

    if (!active) {
      return false;
    }


    /* -------------------------------------------------
       CLOSE
       ------------------------------------------------- */

    closeBtn
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();

          close();
        }
      );


    overlay.addEventListener(
      "click",
      handleOverlayClick
    );


    /* -------------------------------------------------
       NAVIGATION
       ------------------------------------------------- */

    for (
      const tab
      of settingsTabs
    ) {

      tab.addEventListener(
        "click",
        event => {

          event.preventDefault();


          selectTab(
            tab.dataset
              .settingsTab
          );
        }
      );
    }


    /* -------------------------------------------------
       GENERAL SEGMENTED CONTROLS
       ------------------------------------------------- */

    bindSegmentedControl(
      settingsThemeControl,
      "theme"
    );


    bindSegmentedControl(
      settingsIntelligenceControl,
      "intelligence"
    );


    bindSegmentedControl(
      settingsInterfaceControl,
      "interface"
    );


    /* -------------------------------------------------
       APPEARANCE SEGMENTED CONTROLS
       ------------------------------------------------- */

    bindSegmentedControl(
      appearanceThemeControl,
      "theme"
    );


    bindSegmentedControl(
      appearanceInterfaceControl,
      "interface"
    );


    bindSegmentedControl(
      appearanceAccentControl,
      "accent"
    );


    bindSegmentedControl(
      appearanceTextSizeControl,
      "textSize"
    );


    bindSegmentedControl(
      appearanceContentWidthControl,
      "contentWidth"
    );


    bindSegmentedControl(
      appearanceSidebarDensityControl,
      "sidebarDensity"
    );


    bindSegmentedControl(
      appearanceMotionControl,
      "motion"
    );


    /* -------------------------------------------------
       SWITCHES
       ------------------------------------------------- */

    settingsPrivateChatToggle
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();


          togglePrivateChat();
        }
      );


    settingsAutoSaveToggle
      ?.addEventListener(
        "click",
        event => {

          event.preventDefault();


          toggleAutoSave();
        }
      );


    /* -------------------------------------------------
       SELECTS
       ------------------------------------------------- */

    bindSelect(
      settingsLanguageBtn,
      settingsLanguageMenu,
      "language"
    );


    bindSelect(
      settingsDefaultPersonalityBtn,
      settingsDefaultPersonalityMenu,
      "defaultPersonality"
    );


    bindSelect(
      settingsOpenOnBtn,
      settingsOpenOnMenu,
      "openOn"
    );


    /* -------------------------------------------------
       GLOBAL REQUEST EVENTS
       ------------------------------------------------- */

    window.addEventListener(
      "neyo:settings-open-request",
      handleSettingsOpenRequest
    );


    window.addEventListener(
      "neyo:appearance-open-request",
      handleAppearanceOpenRequest
    );


    window.addEventListener(
      "neyo:personalities-open-request",
      handlePersonalitiesOpenRequest
    );


    window.addEventListener(
      "neyo:settings-close-request",
      () => {

        close();
      }
    );


    /* -------------------------------------------------
       EXTERNAL PREFERENCE UPDATE
       ------------------------------------------------- */

    window.addEventListener(
      "neyo:settings-set",
      event => {

        const key =
          event.detail
            ?.key;


        if (!key) {
          return;
        }


        setPreference(
          key,
          event.detail
            ?.value
        );
      }
    );


    /* -------------------------------------------------
       DOCUMENT
       ------------------------------------------------- */

    document.addEventListener(
      "click",
      handleDocumentClick
    );


    document.addEventListener(
      "keydown",
      handleKeydown
    );


    return true;
  }


  /* =====================================================
     INIT
     ===================================================== */

  if (active) {

    /*
     * Correct initial hidden state.
     */

    overlay.setAttribute(
      "aria-hidden",
      "true"
    );


    overlay.classList.remove(
      "active",
      "open"
    );


    settingsTabs.forEach(
      tab => {

        tab.setAttribute(
          "role",
          "tab"
        );
      }
    );


    settingsPanels.forEach(
      panel => {

        panel.setAttribute(
          "role",
          "tabpanel"
        );
      }
    );


    bind();

    applyInitialState();


    /*
     * Ensure first panel state matches markup.
     */

    selectTab(
      "general"
    );
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


      open,


      close,


      toggle,


      selectTab,


      set:
        setPreference,


      get(
        key
      ) {

        if (
          !Object.prototype
            .hasOwnProperty
            .call(
              state.preferences,
              key
            )
        ) {

          return undefined;
        }


        return state.preferences[
          key
        ];
      },


      getAll() {

        return {
          ...state.preferences
        };
      },


      reload() {

        loadPreferences();

        applyBodyPreferenceState();

        syncControls();

        syncChatPreferences();


        return {
          ...state.preferences
        };
      },


      reset(
        key = null
      ) {

        if (key) {

          if (
            !Object.prototype
              .hasOwnProperty
              .call(
                DEFAULTS,
                key
              )
          ) {

            return false;
          }


          return setPreference(
            key,
            DEFAULTS[
              key
            ]
          );
        }


        for (
          const [
            name,
            value
          ]
          of Object.entries(
            DEFAULTS
          )
        ) {

          setPreference(
            name,
            value
          );
        }


        return true;
      },


      isOpen:
        () =>
          state.open,


      getActiveTab:
        () =>
          state.activeTab,


      getState() {

        return {

          version:
            VERSION,


          active,


          legacyOwnerActive,


          open:
            state.open,


          activeTab:
            state.activeTab,


          selectMenuOpen:
            Boolean(
              state.selectMenu
            ),


          preferences: {
            ...state.preferences
          }
        };
      }
    });


  Object.defineProperty(
    window,
    "NeyoSettings",
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
    "neyo:settings-ready",
    {
      version:
        VERSION,

      active,

      legacyOwnerActive,

      preferences: {
        ...state.preferences
      }
    }
  );

})();
