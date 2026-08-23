/*
=========================================================
NEYO — CHARACTER PICKER
FINAL PRODUCTION MIXER v4

FILE:
public/js/components/character-picker.js

OWNS
---------------------------------------------------------
- Character-picker open / close
- #characterPickerBtn click
- #characterPickerCloseBtn click
- Character list rendering
- Character selection
- Selected / active character UI
- Listbox semantics
- Keyboard navigation
- Escape behavior while picker is open
- Backdrop close
- Focus entry / restoration
- Character registry discovery
- Picker lifecycle events
- Public picker API

DOES NOT OWN
---------------------------------------------------------
- Mascot expression
- Mascot animation
- Gemini Live
- Voice restart
- Voice shell open / close
- Character definition objects
- Camera
- Chat
- Settings

EVENT FLOW
---------------------------------------------------------

#characterPickerBtn
      ↓
character-picker.js
      ↓
picker open
      ↓
select character
      ↓
neyo:character-select
      ↓
mascot.js
      ↓
neyo:character-change
      ↓
voice.js
      ↓
restart-required if Live is active
      ↓
voice-mode.js

IMPORTANT
---------------------------------------------------------
Character definitions are discovered dynamically from:

window.NeyoCharacter helper
window.NeyoCharacters registry

This means future characters can be added without
rewriting this picker.

MIGRATION RULE
---------------------------------------------------------
No dependency on neo.js.

After neo.js removal this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-character-picker-final-v4";

  if (
    window.NeyoCharacterPicker
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     DOM
     ===================================================== */

  const trigger =
    document.getElementById(
      "characterPickerBtn"
    );

  const shell =
    document.getElementById(
      "characterPicker"
    );

  const panel =
    shell?.querySelector(
      ".character-picker-panel"
    );

  const closeBtn =
    document.getElementById(
      "characterPickerCloseBtn"
    );

  const list =
    document.getElementById(
      "characterPickerList"
    );

  const active =
    Boolean(
      trigger &&
      shell &&
      panel &&
      closeBtn &&
      list
    );

  if (
    !active
  ) {
    console.warn(
      "[NEYO Character Picker] Required DOM is missing."
    );

    return;
  }

  /* =====================================================
     LEGACY TELEMETRY ONLY
     ===================================================== */

  const legacyScriptPresent =
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

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      defaultCharacter:
        "neyo",

      maxCharacters:
        32,

      maxNameLength:
        80,

      maxDescriptionLength:
        220,

      selectionCloseDelayMs:
        90
    });

  /* =====================================================
     STATE
     ===================================================== */

  let opened =
    false;

  let previousFocus =
    null;

  let characters =
    [];

  let activeCharacterId =
    CONFIG.defaultCharacter;

  let highlightedIndex =
    -1;

  let renderGeneration =
    0;

  let closeTimer =
    0;

  const metrics = {
    opens:
      0,

    closes:
      0,

    renders:
      0,

    selections:
      0,

    keyboardMoves:
      0,

    lastOpenedAt:
      null,

    lastClosedAt:
      null,

    lastSelectedAt:
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
     HELPERS
     ===================================================== */

  function cleanId(
    value
  ) {
    return String(
      value || ""
    )
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9_-]/g,
        ""
      )
      .slice(
        0,
        60
      );
  }

  function cleanText(
    value,
    max
  ) {
    return String(
      value ?? ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim()
      .slice(
        0,
        max
      );
  }

  function cloneValue(
    value
  ) {
    if (
      value === undefined ||
      value === null
    ) {
      return value;
    }

    if (
      typeof structuredClone ===
      "function"
    ) {
      try {
        return structuredClone(
          value
        );
      } catch {}
    }

    try {
      return JSON.parse(
        JSON.stringify(
          value
        )
      );

    } catch {
      return value;
    }
  }

  /* =====================================================
     CHARACTER NORMALIZATION
     ===================================================== */

  function normalizeCharacter(
    raw,
    fallbackId = ""
  ) {
    if (
      !raw ||
      typeof raw !==
        "object"
    ) {
      return null;
    }

    const id =
      cleanId(
        raw.id ||
        fallbackId
      );

    if (!id) {
      return null;
    }

    /*
     * Ignore registry metadata entries.
     */

    if (
      [
        "active",
        "current",
        "selected"
      ].includes(
        id
      )
    ) {
      return null;
    }

    const name =
      cleanText(
        raw.name ||
        raw.label ||
        raw.displayName ||
        id
          .replace(
            /[-_]+/g,
            " "
          )
          .replace(
            /\b\w/g,
            character =>
              character
                .toUpperCase()
          ),
        CONFIG
          .maxNameLength
      ) ||
      id;

    const description =
      cleanText(
        raw.description ||
        raw.subtitle ||
        raw.tagline ||
        raw.personality
          ?.description ||
        raw.personality
          ?.summary ||
        "",
        CONFIG
          .maxDescriptionLength
      );

    const visual =
      raw.visual &&
      typeof raw.visual ===
        "object"
        ? raw.visual
        : {};

    const expression =
      raw.defaultExpression &&
      typeof raw
        .defaultExpression ===
        "object"
        ? raw.defaultExpression
        : {};

    return {
      ...raw,

      id,

      name,

      description,

      visual,

      defaultExpression:
        expression
    };
  }

  /* =====================================================
     DISCOVER VIA HELPER
     ===================================================== */

  function discoverFromHelper() {
    const helper =
      window.NeyoCharacter;

    if (!helper) {
      return [];
    }

    const candidates = [
      "getAll",
      "list",
      "all",
      "values"
    ];

    for (
      const methodName
      of candidates
    ) {
      try {
        const method =
          helper[
            methodName
          ];

        if (
          typeof method !==
          "function"
        ) {
          continue;
        }

        const result =
          method.call(
            helper
          );

        if (
          Array.isArray(
            result
          )
        ) {
          return result;
        }

        if (
          result &&
          typeof result ===
            "object"
        ) {
          return Object
            .entries(
              result
            )
            .map(
              ([id, value]) => ({
                ...value,
                id:
                  value?.id ||
                  id
              })
            );
        }

      } catch {}
    }

    return [];
  }

  /* =====================================================
     DISCOVER VIA REGISTRY
     ===================================================== */

  function discoverFromRegistry() {
    const registry =
      window.NeyoCharacters;

    if (
      !registry ||
      typeof registry !==
        "object"
    ) {
      return [];
    }

    const result =
      [];

    for (
      const [
        key,
        value
      ]
      of Object.entries(
        registry
      )
    ) {
      if (
        typeof value ===
        "function"
      ) {
        continue;
      }

      if (
        !value ||
        typeof value !==
          "object" ||
        Array.isArray(
          value
        )
      ) {
        continue;
      }

      const character =
        normalizeCharacter(
          value,
          key
        );

      if (
        character
      ) {
        result.push(
          character
        );
      }
    }

    return result;
  }

  /* =====================================================
     DISCOVER CHARACTERS
     ===================================================== */

  function discoverCharacters() {
    const discovered =
      [
        ...discoverFromHelper(),
        ...discoverFromRegistry()
      ];

    const output =
      [];

    const seen =
      new Set();

    for (
      const candidate
      of discovered
    ) {
      if (
        output.length >=
        CONFIG.maxCharacters
      ) {
        break;
      }

      const normalized =
        normalizeCharacter(
          candidate,
          candidate?.id
        );

      if (
        !normalized ||
        seen.has(
          normalized.id
        )
      ) {
        continue;
      }

      seen.add(
        normalized.id
      );

      output.push(
        normalized
      );
    }

    /*
     * Ensure NEYO remains available when registry
     * helper exposes it through .get() only.
     */

    if (
      !seen.has(
        CONFIG
          .defaultCharacter
      )
    ) {
      try {
        const fallback =
          window.NeyoCharacter
            ?.get
            ?.(
              CONFIG
                .defaultCharacter
            ) ||
          window.NeyoCharacters
            ?.[
              CONFIG
                .defaultCharacter
            ];

        const normalized =
          normalizeCharacter(
            fallback,
            CONFIG
              .defaultCharacter
          );

        if (
          normalized
        ) {
          output.unshift(
            normalized
          );
        }

      } catch {}
    }

    characters =
      output;

    return getCharacters();
  }

  /* =====================================================
     ACTIVE CHARACTER
     ===================================================== */

  function resolveActiveCharacterId() {
    /* -------------------------------------------------
       Mascot = strongest current UI source
       ------------------------------------------------- */

    try {
      const mascotId =
        window.NeyoMascot
          ?.getCharacterId
          ?.();

      if (
        mascotId
      ) {
        return cleanId(
          mascotId
        );
      }
    } catch {}

    try {
      const mascotCharacter =
        window.NeyoMascot
          ?.getCharacter
          ?.();

      if (
        mascotCharacter
          ?.id
      ) {
        return cleanId(
          mascotCharacter.id
        );
      }
    } catch {}

    /* -------------------------------------------------
       Character helper
       ------------------------------------------------- */

    try {
      const helperActive =
        window.NeyoCharacter
          ?.getActive
          ?.();

      if (
        typeof helperActive ===
          "string"
      ) {
        return cleanId(
          helperActive
        );
      }

      if (
        helperActive
          ?.id
      ) {
        return cleanId(
          helperActive.id
        );
      }
    } catch {}

    /* -------------------------------------------------
       Registry active
       ------------------------------------------------- */

    try {
      const registryActive =
        window.NeyoCharacters
          ?.active;

      if (
        typeof registryActive ===
          "string"
      ) {
        return cleanId(
          registryActive
        );
      }
    } catch {}

    /* -------------------------------------------------
       Voice selected character
       ------------------------------------------------- */

    try {
      const voiceCharacter =
        window.NeyoVoice
          ?.getCharacter
          ?.();

      if (
        voiceCharacter
      ) {
        return cleanId(
          voiceCharacter
        );
      }
    } catch {}

    return CONFIG
      .defaultCharacter;
  }

  /* =====================================================
     CHARACTER FIND
     ===================================================== */

  function getCharacterById(
    id
  ) {
    const key =
      cleanId(
        id
      );

    if (!key) {
      return null;
    }

    const cached =
      characters.find(
        character =>
          character.id ===
          key
      );

    if (
      cached
    ) {
      return cloneValue(
        cached
      );
    }

    try {
      const direct =
        window.NeyoCharacter
          ?.get
          ?.(key) ||
        window.NeyoCharacters
          ?.[key];

      return normalizeCharacter(
        direct,
        key
      );

    } catch {
      return null;
    }
  }

  /* =====================================================
     CARD SELECTOR
     ===================================================== */

  function getCards() {
    return Array
      .from(
        list.querySelectorAll(
          "[data-character-id]"
        )
      );
  }

  /* =====================================================
     VISUAL PREVIEW
     ===================================================== */

  function createPreview(
    character
  ) {
    const preview =
      document.createElement(
        "div"
      );

    preview.className =
      [
        "character-picker-preview",
        "character-card-preview"
      ].join(" ");

    preview.dataset.character =
      character.id;

    preview.dataset.bodyShape =
      character
        ?.visual
        ?.bodyShape ||
      "rounded-square";

    preview.dataset.surface =
      character
        ?.visual
        ?.surface ||
      "light";

    /*
     * Generic preview markup intentionally mirrors
     * mascot geometry without duplicating mascot logic.
     *
     * character-picker.css can style by data-character.
     */

    const face =
      document.createElement(
        "div"
      );

    face.className =
      "character-picker-preview-face";

    face.dataset.character =
      character.id;

    const features =
      document.createElement(
        "div"
      );

    features.className =
      "character-picker-preview-features";

    const leftEye =
      document.createElement(
        "span"
      );

    leftEye.className =
      "character-picker-preview-eye character-picker-preview-eye-left";

    const rightEye =
      document.createElement(
        "span"
      );

    rightEye.className =
      "character-picker-preview-eye character-picker-preview-eye-right";

    const mouth =
      document.createElement(
        "span"
      );

    mouth.className =
      "character-picker-preview-mouth";

    features.append(
      leftEye,
      rightEye,
      mouth
    );

    face.appendChild(
      features
    );

    preview.appendChild(
      face
    );

    return preview;
  }

  /* =====================================================
     CREATE CHARACTER CARD
     ===================================================== */

  function createCard(
    character,
    index
  ) {
    const selected =
      character.id ===
      activeCharacterId;

    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    /*
     * Preserve broad CSS compatibility naming.
     */

    button.className =
      [
        "character-picker-item",
        "character-card"
      ].join(" ");

    button.dataset
      .characterId =
      character.id;

    button.dataset.character =
      character.id;

    button.setAttribute(
      "role",
      "option"
    );

    button.setAttribute(
      "aria-selected",
      String(
        selected
      )
    );

    button.setAttribute(
      "aria-label",
      selected
        ? `${character.name}, selected`
        : `Choose ${character.name}`
    );

    button.tabIndex =
      index ===
        highlightedIndex
        ? 0
        : -1;

    button.classList.toggle(
      "is-selected",
      selected
    );

    button.classList.toggle(
      "active",
      selected
    );

    /* =================================================
       PREVIEW
       ================================================= */

    button.appendChild(
      createPreview(
        character
      )
    );

    /* =================================================
       CONTENT
       ================================================= */

    const body =
      document.createElement(
        "div"
      );

    body.className =
      "character-picker-item-body character-card-body";

    const name =
      document.createElement(
        "div"
      );

    name.className =
      "character-picker-item-name character-card-name";

    name.textContent =
      character.name;

    body.appendChild(
      name
    );

    if (
      character.description
    ) {
      const description =
        document.createElement(
          "div"
        );

      description.className =
        "character-picker-item-description character-card-description";

      description.textContent =
        character.description;

      body.appendChild(
        description
      );
    }

    button.appendChild(
      body
    );

    /* =================================================
       SELECTED MARK
       ================================================= */

    const mark =
      document.createElement(
        "span"
      );

    mark.className =
      "character-picker-selected-mark";

    mark.setAttribute(
      "aria-hidden",
      "true"
    );

    mark.innerHTML = `
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6.5 12.5l3.4 3.4 7.6-8"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    `;

    button.appendChild(
      mark
    );

    /* =================================================
       CLICK
       ================================================= */

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        selectCharacter(
          character.id,
          {
            source:
              "picker-click"
          }
        );
      }
    );

    return button;
  }

  /* =====================================================
     RENDER
     ===================================================== */

  function render({
    preserveFocus =
      false
  } = {}) {
    renderGeneration +=
      1;

    activeCharacterId =
      resolveActiveCharacterId();

    discoverCharacters();

    list.replaceChildren();

    if (
      characters.length ===
      0
    ) {
      const empty =
        document.createElement(
          "div"
        );

      empty.className =
        "character-picker-empty";

      empty.textContent =
        "No characters available.";

      list.appendChild(
        empty
      );

      highlightedIndex =
        -1;

      return false;
    }

    const selectedIndex =
      characters.findIndex(
        character =>
          character.id ===
          activeCharacterId
      );

    if (
      !preserveFocus ||
      highlightedIndex <
        0 ||
      highlightedIndex >=
        characters.length
    ) {
      highlightedIndex =
        selectedIndex >=
          0
          ? selectedIndex
          : 0;
    }

    const fragment =
      document
        .createDocumentFragment();

    characters.forEach(
      (
        character,
        index
      ) => {
        fragment.appendChild(
          createCard(
            character,
            index
          )
        );
      }
    );

    list.appendChild(
      fragment
    );

    metrics.renders +=
      1;

    emit(
      "neyo:character-picker-rendered",
      {
        generation:
          renderGeneration,

        count:
          characters.length,

        activeCharacterId
      }
    );

    return true;
  }

  /* =====================================================
     REFRESH SELECTION ONLY
     ===================================================== */

  function refreshSelection() {
    activeCharacterId =
      resolveActiveCharacterId();

    const cards =
      getCards();

    cards.forEach(
      (
        card,
        index
      ) => {
        const selected =
          card.dataset
            .characterId ===
          activeCharacterId;

        card.classList.toggle(
          "is-selected",
          selected
        );

        card.classList.toggle(
          "active",
          selected
        );

        card.setAttribute(
          "aria-selected",
          String(
            selected
          )
        );

        const character =
          getCharacterById(
            card.dataset
              .characterId
          );

        card.setAttribute(
          "aria-label",
          selected
            ? `${
                character?.name ||
                "Character"
              }, selected`
            : `Choose ${
                character?.name ||
                "character"
              }`
        );

        card.tabIndex =
          index ===
            highlightedIndex
            ? 0
            : -1;
      }
    );

    return activeCharacterId;
  }

  /* =====================================================
     OPEN
     ===================================================== */

  function open() {
    if (
      opened
    ) {
      return true;
    }

    previousFocus =
      document.activeElement
        instanceof HTMLElement
        ? document.activeElement
        : trigger;

    activeCharacterId =
      resolveActiveCharacterId();

    render();

    opened =
      true;

    shell.setAttribute(
      "aria-hidden",
      "false"
    );

    shell.classList.add(
      "is-open"
    );

    trigger.setAttribute(
      "aria-expanded",
      "true"
    );

    document.body
      .classList
      .add(
        "neyo-character-picker-open"
      );

    metrics.opens +=
      1;

    metrics.lastOpenedAt =
      Date.now();

    requestAnimationFrame(
      () => {
        const cards =
          getCards();

        const target =
          cards[
            highlightedIndex
          ] ||
          cards[0] ||
          closeBtn;

        try {
          target.focus({
            preventScroll:
              true
          });

        } catch {
          try {
            target.focus();
          } catch {}
        }
      }
    );

    emit(
      "neyo:character-picker-opened",
      {
        activeCharacterId,

        count:
          characters.length
      }
    );

    return true;
  }

  /* =====================================================
     CLOSE
     ===================================================== */

  function close({
    restoreFocus =
      true
  } = {}) {
    window.clearTimeout(
      closeTimer
    );

    closeTimer =
      0;

    if (
      !opened &&
      shell.getAttribute(
        "aria-hidden"
      ) !==
      "false"
    ) {
      trigger.setAttribute(
        "aria-expanded",
        "false"
      );

      return true;
    }

    opened =
      false;

    shell.setAttribute(
      "aria-hidden",
      "true"
    );

    shell.classList.remove(
      "is-open",
      "open",
      "show"
    );

    trigger.setAttribute(
      "aria-expanded",
      "false"
    );

    document.body
      .classList
      .remove(
        "neyo-character-picker-open"
      );

    metrics.closes +=
      1;

    metrics.lastClosedAt =
      Date.now();

    if (
      restoreFocus
    ) {
      const focusTarget =
        previousFocus
          ?.isConnected
          ? previousFocus
          : trigger;

      requestAnimationFrame(
        () => {
          try {
            focusTarget
              ?.focus({
                preventScroll:
                  true
              });

          } catch {
            try {
              focusTarget
                ?.focus();
            } catch {}
          }
        }
      );
    }

    previousFocus =
      null;

    emit(
      "neyo:character-picker-closed"
    );

    return true;
  }

  /* =====================================================
     TOGGLE
     ===================================================== */

  function toggle() {
    return isOpen()
      ? close()
      : open();
  }

  /* =====================================================
     IS OPEN
     ===================================================== */

  function isOpen() {
    return (
      opened ||
      shell.getAttribute(
        "aria-hidden"
      ) ===
      "false"
    );
  }

  /* =====================================================
     SELECT
     ===================================================== */

  function selectCharacter(
    id,
    {
      source =
        "character-picker",
      closeAfter =
        true
    } = {}
  ) {
    const character =
      getCharacterById(
        id
      );

    if (
      !character
    ) {
      console.warn(
        "[NEYO Character Picker] Unknown character:",
        id
      );

      return false;
    }

    activeCharacterId =
      character.id;

    const index =
      characters.findIndex(
        item =>
          item.id ===
          character.id
      );

    if (
      index >= 0
    ) {
      highlightedIndex =
        index;
    }

    refreshSelection();

    metrics.selections +=
      1;

    metrics.lastSelectedAt =
      Date.now();

    /*
     * Picker does NOT call mascot/voice directly.
     *
     * Mascot is the canonical visual character owner.
     */

    emit(
      "neyo:character-select",
      {
        id:
          character.id,

        character:
          cloneValue(
            character
          ),

        source
      }
    );

    emit(
      "neyo:character-picker-selected",
      {
        id:
          character.id,

        character:
          cloneValue(
            character
          ),

        source
      }
    );

    if (
      closeAfter
    ) {
      window.clearTimeout(
        closeTimer
      );

      closeTimer =
        window.setTimeout(
          () => {
            close();
          },
          CONFIG
            .selectionCloseDelayMs
        );
    }

    return true;
  }

  /* =====================================================
     KEYBOARD HIGHLIGHT
     ===================================================== */

  function focusIndex(
    index
  ) {
    const cards =
      getCards();

    if (
      cards.length ===
      0
    ) {
      return false;
    }

    const normalized =
      (
        index %
          cards.length +
        cards.length
      ) %
      cards.length;

    highlightedIndex =
      normalized;

    cards.forEach(
      (
        card,
        cardIndex
      ) => {
        card.tabIndex =
          cardIndex ===
            normalized
            ? 0
            : -1;
      }
    );

    const target =
      cards[
        normalized
      ];

    try {
      target.focus({
        preventScroll:
          true
      });

    } catch {
      target.focus();
    }

    try {
      target.scrollIntoView({
        block:
          "nearest",

        inline:
          "nearest"
      });

    } catch {}

    metrics.keyboardMoves +=
      1;

    return true;
  }

  /* =====================================================
     KEYBOARD
     ===================================================== */

  function handleKeydown(
    event
  ) {
    if (
      !isOpen()
    ) {
      return;
    }

    const cards =
      getCards();

    /* -------------------------------------------------
       ESCAPE

       voice-mode.js explicitly leaves Escape to picker
       while picker is open.
       ------------------------------------------------- */

    if (
      event.key ===
      "Escape"
    ) {
      event.preventDefault();
      event.stopPropagation();

      close();

      return;
    }

    /* -------------------------------------------------
       ARROWS
       ------------------------------------------------- */

    if (
      event.key ===
        "ArrowDown" ||
      event.key ===
        "ArrowRight"
    ) {
      event.preventDefault();

      focusIndex(
        highlightedIndex +
        1
      );

      return;
    }

    if (
      event.key ===
        "ArrowUp" ||
      event.key ===
        "ArrowLeft"
    ) {
      event.preventDefault();

      focusIndex(
        highlightedIndex -
        1
      );

      return;
    }

    /* -------------------------------------------------
       HOME / END
       ------------------------------------------------- */

    if (
      event.key ===
      "Home"
    ) {
      event.preventDefault();

      focusIndex(
        0
      );

      return;
    }

    if (
      event.key ===
      "End"
    ) {
      event.preventDefault();

      focusIndex(
        cards.length -
        1
      );

      return;
    }

    /* -------------------------------------------------
       ENTER / SPACE
       ------------------------------------------------- */

    if (
      event.key ===
        "Enter" ||
      event.key ===
        " "
    ) {
      const activeElement =
        document.activeElement;

      if (
        !(
          activeElement
            instanceof
          HTMLElement
        )
      ) {
        return;
      }

      const id =
        activeElement
          .dataset
          ?.characterId;

      if (
        !id
      ) {
        return;
      }

      event.preventDefault();

      selectCharacter(
        id,
        {
          source:
            "picker-keyboard"
        }
      );

      return;
    }

    /* -------------------------------------------------
       TAB FOCUS TRAP
       ------------------------------------------------- */

    if (
      event.key ===
      "Tab"
    ) {
      const focusables =
        [
          ...getCards(),
          closeBtn
        ].filter(
          item =>
            item &&
            !item.disabled
        );

      if (
        focusables.length ===
        0
      ) {
        event.preventDefault();

        return;
      }

      const first =
        focusables[0];

      const last =
        focusables[
          focusables.length -
          1
        ];

      if (
        event.shiftKey &&
        document.activeElement ===
          first
      ) {
        event.preventDefault();

        last.focus();

        return;
      }

      if (
        !event.shiftKey &&
        document.activeElement ===
          last
      ) {
        event.preventDefault();

        first.focus();
      }
    }
  }

  /* =====================================================
     TRIGGER
     ===================================================== */

  trigger.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopPropagation();

      toggle();
    }
  );

  /* =====================================================
     CLOSE BUTTON
     ===================================================== */

  closeBtn.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopPropagation();

      close();
    }
  );

  /* =====================================================
     BACKDROP
     ===================================================== */

  shell.addEventListener(
    "pointerdown",
    event => {
      if (
        event.target !==
        shell
      ) {
        return;
      }

      event.preventDefault();

      close();
    }
  );

  /* =====================================================
     KEYBOARD
     ===================================================== */

  document.addEventListener(
    "keydown",
    handleKeydown,
    true
  );

  /* =====================================================
     CHARACTER CHANGED EXTERNALLY
     ===================================================== */

  window.addEventListener(
    "neyo:character-change",
    event => {
      const id =
        event.detail
          ?.id ||
        event.detail
          ?.character
          ?.id;

      if (
        !id
      ) {
        return;
      }

      activeCharacterId =
        cleanId(
          id
        );

      const index =
        characters.findIndex(
          item =>
            item.id ===
            activeCharacterId
        );

      if (
        index >= 0
      ) {
        highlightedIndex =
          index;
      }

      refreshSelection();
    }
  );

  /* =====================================================
     CHARACTER DEFINITIONS CHANGED / REGISTERED
     ===================================================== */

  for (
    const eventName
    of [
      "neyo:character-registered",
      "neyo:characters-ready",
      "neyo:character-registry-change"
    ]
  ) {
    window.addEventListener(
      eventName,
      () => {
        render({
          preserveFocus:
            isOpen()
        });
      }
    );
  }

  /* =====================================================
     VOICE MODE CLOSED

     Picker cannot remain floating after fullscreen ends.
     ===================================================== */

  window.addEventListener(
    "neyo:voice-mode-closed",
    () => {
      if (
        isOpen()
      ) {
        close({
          restoreFocus:
            false
        });
      }
    }
  );

  /* =====================================================
     PAGE HIDE
     ===================================================== */

  window.addEventListener(
    "pagehide",
    () => {
      window.clearTimeout(
        closeTimer
      );

      closeTimer =
        0;
    },
    {
      once:
        true
    }
  );

  /* =====================================================
     GETTERS
     ===================================================== */

  function getCharacters() {
    return characters.map(
      item =>
        cloneValue(
          item
        )
    );
  }

  function getSelected() {
    return (
      getCharacterById(
        activeCharacterId
      ) ||
      null
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

      active:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      /*
       * Dialog
       */

      open,

      close,

      toggle,

      isOpen,

      /*
       * Characters
       */

      render,

      refresh:
        render,

      discoverCharacters,

      getCharacters,

      getById:
        getCharacterById,

      getSelected,

      getSelectedId() {
        return activeCharacterId;
      },

      /*
       * Selection
       */

      select:
        selectCharacter,

      selectCharacter,

      /*
       * Keyboard
       */

      focusIndex,

      /*
       * State
       */

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          legacyScriptPresent,

          legacyOwnerActive:
            false,

          open:
            isOpen(),

          selectedId:
            activeCharacterId,

          highlightedIndex,

          count:
            characters.length,

          renderGeneration,

          metrics: {
            ...metrics
          }
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoCharacterPicker",
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

  activeCharacterId =
    resolveActiveCharacterId();

  discoverCharacters();

  render();

  shell.setAttribute(
    "aria-hidden",
    "true"
  );

  shell.classList.remove(
    "is-open",
    "open",
    "show"
  );

  trigger.setAttribute(
    "aria-haspopup",
    "dialog"
  );

  trigger.setAttribute(
    "aria-controls",
    "characterPicker"
  );

  trigger.setAttribute(
    "aria-expanded",
    "false"
  );

  emit(
    "neyo:character-picker-ready",
    {
      version:
        VERSION,

      active:
        true,

      count:
        characters.length,

      selectedId:
        activeCharacterId,

      legacyScriptPresent,

      legacyOwnerActive:
        false
    }
  );
})();
