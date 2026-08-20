/*
=========================================================
NEYO — CHARACTER PICKER v1

Purpose:
- Open / close character picker popup
- Read available characters from window.NeyoCharacters
- Show only registered characters
- Highlight active character
- Select character
- Sync with mascot engine
- Prepare architecture for Zadi / Wizi / Tarco / Buddy / Lify

Does NOT own:
- Gemini
- voice session
- mascot rendering
- character profiles
=========================================================
*/

(() => {
  "use strict";


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

  const list =
    document.getElementById(
      "characterPickerList"
    );

  const closeBtn =
    document.getElementById(
      "characterPickerCloseBtn"
    );


  if (
    !shell ||
    !list
  ) {
    console.warn(
      "[NEYO Character Picker] Required DOM missing."
    );

    return;
  }


  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    open:
      false,

    closing:
      false,

    activeCharacterId:
      "neyo",

    lastFocusedElement:
      null
  };


  let closeTimer =
    0;


  /* =====================================================
     HELPERS
     ===================================================== */

  function safeFocus(element) {
    try {
      element?.focus?.({
        preventScroll:
          true
      });
    } catch {}
  }


  function dispatch(
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


  function getRegistry() {
    return (
      window.NeyoCharacters ||
      {}
    );
  }


  function getCharacter(
    id
  ) {
    return (
      getRegistry()?.[id] ||
      null
    );
  }


  function getActiveCharacterId() {
    return (
      window
        .NeyoCharacters
        ?.active ||
      window
        .NeyoMascot
        ?.getState
        ?.()
        ?.characterId ||
      "neyo"
    );
  }


  /* =====================================================
     CHARACTER ORDER

     Only registered characters render.
     Future additions keep stable order.
     ===================================================== */

  const CHARACTER_ORDER =
    Object.freeze([
      "neyo",
      "zadi",
      "wizi",
      "tarco",
      "buddy",
      "lify"
    ]);


  /* =====================================================
     CHARACTER META
     ===================================================== */

  const FALLBACK_META =
    Object.freeze({

      neyo: {
        description:
          "Balanced, thoughtful and intelligent."
      },

      zadi: {
        description:
          "Confident, energetic and expressive."
      },

      wizi: {
        description:
          "Curious, imaginative and clever."
      },

      tarco: {
        description:
          "Focused, precise and technical."
      },

      buddy: {
        description:
          "Casual, friendly and easy-going."
      },

      lify: {
        description:
          "Calm, thoughtful and supportive."
      }
    });


  /* =====================================================
     PREVIEW MARKUP

     Uses lightweight face preview.
     Future characters can override via CSS
     using data-character attribute.
     ===================================================== */

  function createPreviewMarkup(
    character
  ) {
    const id =
      character?.id ||
      "neyo";


    return `
      <div
        class="character-picker-preview"
        data-character="${id}"
        aria-hidden="true"
      >
        <div class="character-picker-face">

          <div
            class="character-picker-eye character-picker-eye-left"
          ></div>

          <div
            class="character-picker-eye character-picker-eye-right"
          ></div>

          <div class="character-picker-mouth">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>

        </div>
      </div>
    `;
  }


  /* =====================================================
     CARD
     ===================================================== */

  function createCard(
    character
  ) {

    const id =
      character.id;


    const name =
      character.name ||
      id;


    const description =
      character.description ||
      FALLBACK_META[id]
        ?.description ||
      "AI character";


    const selected =
      id ===
      state.activeCharacterId;


    const button =
      document.createElement(
        "button"
      );


    button.type =
      "button";


    button.className =
      "character-picker-card";


    button.dataset.character =
      id;


    button.dataset.selected =
      String(
        selected
      );


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
      `Select ${name}`
    );


    button.innerHTML = `
      <div class="character-picker-card-preview">
        ${createPreviewMarkup(character)}
      </div>

      <div class="character-picker-card-copy">

        <div class="character-picker-card-heading">

          <span class="character-picker-card-name">
            ${name}
          </span>

          <span
            class="character-picker-check"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
            >
              <path
                d="M5 10.3l3.1 3.1L15 6.7"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>

        </div>

        <div class="character-picker-card-description">
          ${description}
        </div>

      </div>
    `;


    button.addEventListener(
      "click",
      () => {

        selectCharacter(
          id
        );
      }
    );


    return button;
  }


  /* =====================================================
     RENDER
     ===================================================== */

  function render() {

    state.activeCharacterId =
      getActiveCharacterId();


    list.innerHTML =
      "";


    const registry =
      getRegistry();


    const available =
      CHARACTER_ORDER
        .map(
          id =>
            registry[id]
        )
        .filter(Boolean);


    /*
    Include any future registered
    characters not yet in order.
    */

    for (
      const [
        id,
        character
      ]
      of Object.entries(
        registry
      )
    ) {

      if (
        id === "active" ||
        !character ||
        typeof character !==
          "object"
      ) {
        continue;
      }


      if (
        available.some(
          item =>
            item.id ===
            character.id
        )
      ) {
        continue;
      }


      available.push(
        character
      );
    }


    if (
      available.length ===
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


      return;
    }


    for (
      const character
      of available
    ) {

      list.appendChild(
        createCard(
          character
        )
      );
    }
  }


  /* =====================================================
     SYNC SELECTION
     ===================================================== */

  function syncSelection() {

    state.activeCharacterId =
      getActiveCharacterId();


    const cards =
      list.querySelectorAll(
        ".character-picker-card"
      );


    cards.forEach(
      card => {

        const selected =
          card.dataset.character ===
          state.activeCharacterId;


        card.dataset.selected =
          String(
            selected
          );


        card.setAttribute(
          "aria-selected",
          String(
            selected
          )
        );
      }
    );
  }


  /* =====================================================
     SELECT CHARACTER
     ===================================================== */

  function selectCharacter(
    id
  ) {

    const character =
      getCharacter(
        id
      );


    if (!character) {

      console.warn(
        "[NEYO Character Picker] Character unavailable:",
        id
      );

      return false;
    }


    const previousId =
      getActiveCharacterId();


    /*
    Main mascot engine becomes
    the character selection authority.
    */

    const changed =
      window
        .NeyoMascot
        ?.setCharacter
        ?.(
          id
        );


    /*
    Fallback if mascot engine
    isn't loaded for some reason.
    */

    if (
      changed === undefined &&
      window.NeyoCharacters
    ) {

      window.NeyoCharacters.active =
        id;


      dispatch(
        "neyo:character-change",
        {
          id,
          character
        }
      );
    }


    state.activeCharacterId =
      id;


    syncSelection();


    dispatch(
      "neyo:character-selected",
      {
        id,
        previousId,
        character
      }
    );


    /*
    If voice session is currently running,
    voice.js will emit its restart-required
    event because voice identity is fixed
    per Live session.

    Do NOT auto-reconnect here yet.
    Keep v1 simple.
    */


    setTimeout(
      () => {
        close();
      },
      90
    );


    console.log(
      "[NEYO Character Picker] Selected:",
      id
    );


    return true;
  }


  /* =====================================================
     OPEN
     ===================================================== */

  function open() {

    if (
      state.open ||
      state.closing
    ) {
      return;
    }


    clearTimeout(
      closeTimer
    );


    state.lastFocusedElement =
      document.activeElement;


    state.open =
      true;


    render();


    shell.classList.add(
      "is-open"
    );


    shell.classList.remove(
      "is-closing"
    );


    shell.setAttribute(
      "aria-hidden",
      "false"
    );


    document.documentElement
      .classList
      .add(
        "neyo-character-picker-open"
      );


    requestAnimationFrame(
      () => {

        shell.classList.add(
          "is-visible"
        );


        const selectedCard =
          list.querySelector(
            '.character-picker-card[data-selected="true"]'
          );


        safeFocus(
          selectedCard ||
          closeBtn ||
          panel
        );
      }
    );


    dispatch(
      "neyo:character-picker-open"
    );


    console.log(
      "[NEYO Character Picker] Open"
    );
  }


  /* =====================================================
     CLOSE
     ===================================================== */

  function close() {

    if (
      !state.open ||
      state.closing
    ) {
      return;
    }


    state.closing =
      true;


    shell.classList.add(
      "is-closing"
    );


    shell.classList.remove(
      "is-visible"
    );


    clearTimeout(
      closeTimer
    );


    closeTimer =
      setTimeout(
        () => {

          shell.classList.remove(
            "is-open",
            "is-closing"
          );


          shell.setAttribute(
            "aria-hidden",
            "true"
          );


          document.documentElement
            .classList
            .remove(
              "neyo-character-picker-open"
            );


          state.open =
            false;

          state.closing =
            false;


          safeFocus(
            state.lastFocusedElement
          );


          state.lastFocusedElement =
            null;


          dispatch(
            "neyo:character-picker-close"
          );

        },
        220
      );
  }


  /* =====================================================
     TOGGLE
     ===================================================== */

  function toggle() {

    if (state.open) {

      close();

    } else {

      open();
    }
  }


  /* =====================================================
     OUTSIDE CLICK
     ===================================================== */

  shell.addEventListener(
    "pointerdown",
    event => {

      if (
        event.target ===
        shell
      ) {

        close();
      }
    }
  );


  /* =====================================================
     TRIGGER
     ===================================================== */

  trigger?.addEventListener(
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

  closeBtn?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      event.stopPropagation();

      close();
    }
  );


  /* =====================================================
     KEYBOARD
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {

      if (!state.open) {
        return;
      }


      if (
        event.key ===
        "Escape"
      ) {

        event.preventDefault();

        close();

        return;
      }


      /*
      Simple arrow navigation
      between available character cards.
      */

      if (
        event.key !==
          "ArrowRight" &&
        event.key !==
          "ArrowLeft" &&
        event.key !==
          "ArrowDown" &&
        event.key !==
          "ArrowUp"
      ) {
        return;
      }


      const cards =
        Array.from(
          list.querySelectorAll(
            ".character-picker-card"
          )
        );


      if (
        !cards.length
      ) {
        return;
      }


      const currentIndex =
        cards.indexOf(
          document.activeElement
        );


      const forward =
        event.key ===
          "ArrowRight" ||
        event.key ===
          "ArrowDown";


      let nextIndex =
        currentIndex;


      if (
        currentIndex === -1
      ) {

        nextIndex =
          0;

      } else {

        nextIndex =
          (
            currentIndex +
            (
              forward
                ? 1
                : -1
            ) +
            cards.length
          ) %
          cards.length;
      }


      event.preventDefault();


      safeFocus(
        cards[nextIndex]
      );
    }
  );


  /* =====================================================
     EXTERNAL CHARACTER CHANGE
     ===================================================== */

  window.addEventListener(
    "neyo:character-change",
    () => {

      if (
        state.open
      ) {

        syncSelection();
      }
    }
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  window.NeyoCharacterPicker =
    Object.freeze({

      open,

      close,

      toggle,

      render,

      select:
        selectCharacter,

      getState:
        () => ({
          open:
            state.open,

          closing:
            state.closing,

          activeCharacterId:
            state.activeCharacterId
        })
    });


  /* =====================================================
     INIT
     ===================================================== */

  shell.setAttribute(
    "aria-hidden",
    "true"
  );


  state.activeCharacterId =
    getActiveCharacterId();


  console.log(
    "[NEYO Character Picker] Ready",
    {
      active:
        state.activeCharacterId
    }
  );

})();
