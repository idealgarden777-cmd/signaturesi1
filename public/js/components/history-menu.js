/*
=========================================================
NEYO — HISTORY MENU CONTROLLER

Purpose:
- Keep legacy neo.js untouched
- Stabilize conversation three-dot menu
- Fix reopen after legacy display:none
- Toggle same button open / close
- Keep popup inside viewport
- Right-align popup with trigger
- Close on Escape
- Support dynamically rendered history items

IMPORTANT:
Legacy neo.js still owns:
- activePopupChatId
- Rename
- Pin
- Share
- Delete

This module only controls menu UI behavior.
=========================================================
*/

(() => {
  "use strict";

  const MENU_ID = "historyPopupMenu";
  const BUTTON_SELECTOR = ".history-action-btn";
  const BOUND_ATTR = "data-neyo-history-menu-bound";

  const VIEWPORT_GAP = 10;
  const BUTTON_MENU_GAP = 6;

  let activeButton = null;
  let wasOpenBeforeClick = false;


  /* =====================================================
     ELEMENT HELPERS
     ===================================================== */

  function getMenu() {
    return document.getElementById(MENU_ID);
  }

  function isMenuVisible() {
    const menu = getMenu();

    if (!menu) {
      return false;
    }

    return (
      menu.classList.contains("show") &&
      menu.style.display !== "none"
    );
  }


  /* =====================================================
     CLOSE
     ===================================================== */

  function closeMenu() {
    const menu = getMenu();

    if (!menu) {
      return;
    }

    menu.classList.remove("show");

    menu.style.display = "none";
    menu.style.left = "";
    menu.style.top = "";
    menu.style.right = "";
    menu.style.visibility = "";

    activeButton = null;
    wasOpenBeforeClick = false;
  }


  /* =====================================================
     POSITION
     ===================================================== */

  function positionMenu(button) {
    const menu = getMenu();

    if (!menu || !button) {
      return;
    }

    /*
    Legacy code may leave inline display:none.
    Restore it before measuring.
    */
    menu.style.display = "block";
    menu.style.visibility = "hidden";
    menu.classList.add("show");

    const buttonRect =
      button.getBoundingClientRect();

    const menuRect =
      menu.getBoundingClientRect();


    /*
    Align menu right edge with trigger.
    */
    let left =
      buttonRect.right -
      menuRect.width;

    let top =
      buttonRect.bottom +
      BUTTON_MENU_GAP;


    /*
    Horizontal viewport protection.
    */
    const maxLeft =
      window.innerWidth -
      menuRect.width -
      VIEWPORT_GAP;

    left = Math.max(
      VIEWPORT_GAP,
      Math.min(left, maxLeft)
    );


    /*
    Open above if there isn't enough
    room below.
    */
    const wouldOverflowBottom =
      top +
        menuRect.height +
        VIEWPORT_GAP >
      window.innerHeight;

    if (wouldOverflowBottom) {
      top =
        buttonRect.top -
        menuRect.height -
        BUTTON_MENU_GAP;
    }


    /*
    Vertical viewport protection.
    */
    const maxTop =
      window.innerHeight -
      menuRect.height -
      VIEWPORT_GAP;

    top = Math.max(
      VIEWPORT_GAP,
      Math.min(top, maxTop)
    );


    menu.style.left =
      `${Math.round(left)}px`;

    menu.style.top =
      `${Math.round(top)}px`;

    menu.style.right = "auto";
    menu.style.visibility = "visible";
  }


  /* =====================================================
     BEFORE LEGACY CLICK
     ===================================================== */

  function handlePointerDown(event) {
    const button = event.currentTarget;

    /*
    Remember whether this exact button
    already owns the open menu.
    */
    wasOpenBeforeClick =
      activeButton === button &&
      isMenuVisible();
  }


  /* =====================================================
     AFTER LEGACY CLICK
     ===================================================== */

  function handleButtonClick(event) {
    const button = event.currentTarget;

    /*
    Do not stop propagation here.
    Legacy neo.js must still run so that
    activePopupChatId remains correct.
    */

    if (
      wasOpenBeforeClick &&
      activeButton === button
    ) {
      closeMenu();
      return;
    }

    activeButton = button;
    wasOpenBeforeClick = false;

    /*
    Run after legacy onclick:
    - chat ID selected
    - .show applied
    - legacy position attempted
    */
    window.requestAnimationFrame(() => {
      if (activeButton !== button) {
        return;
      }

      positionMenu(button);
    });
  }


  /* =====================================================
     BIND BUTTON
     ===================================================== */

  function bindButton(button) {
    if (!(button instanceof HTMLElement)) {
      return;
    }

    if (
      button.getAttribute(BOUND_ATTR) ===
      "true"
    ) {
      return;
    }

    button.setAttribute(
      BOUND_ATTR,
      "true"
    );

    button.addEventListener(
      "pointerdown",
      handlePointerDown
    );

    button.addEventListener(
      "click",
      handleButtonClick
    );
  }


  /* =====================================================
     SCAN
     ===================================================== */

  function bindExistingButtons(
    root = document
  ) {
    if (
      root instanceof Element &&
      root.matches(BUTTON_SELECTOR)
    ) {
      bindButton(root);
    }

    root
      .querySelectorAll?.(
        BUTTON_SELECTOR
      )
      .forEach(bindButton);
  }


  /* =====================================================
     DYNAMIC HISTORY OBSERVER
     ===================================================== */

  function observeHistory() {
    const historyList =
      document.getElementById(
        "historyList"
      );

    if (!historyList) {
      return;
    }

    const observer =
      new MutationObserver(
        mutations => {
          for (const mutation of mutations) {
            for (
              const node
              of mutation.addedNodes
            ) {
              if (
                node instanceof Element
              ) {
                bindExistingButtons(node);
              }
            }
          }
        }
      );

    observer.observe(
      historyList,
      {
        childList: true,
        subtree: true
      }
    );
  }


  /* =====================================================
     MENU STATE OBSERVER
     ===================================================== */

  function observeMenuState() {
    const menu = getMenu();

    if (!menu) {
      return;
    }

    const observer =
      new MutationObserver(() => {
        if (
          !menu.classList.contains(
            "show"
          )
        ) {
          activeButton = null;
          wasOpenBeforeClick = false;
        }
      });

    observer.observe(
      menu,
      {
        attributes: true,
        attributeFilter: ["class"]
      }
    );
  }


  /* =====================================================
     ESCAPE
     ===================================================== */

  function handleKeyboard(event) {
    if (event.key !== "Escape") {
      return;
    }

    if (!isMenuVisible()) {
      return;
    }

    const button = activeButton;

    closeMenu();

    button?.focus?.();
  }


  /* =====================================================
     VIEWPORT CHANGES
     ===================================================== */

  function repositionOpenMenu() {
    if (
      !activeButton ||
      !isMenuVisible()
    ) {
      return;
    }

    positionMenu(activeButton);
  }


  /* =====================================================
     INIT
     ===================================================== */

  function init() {
    bindExistingButtons();

    observeHistory();

    observeMenuState();

    document.addEventListener(
      "keydown",
      handleKeyboard
    );

    window.addEventListener(
      "resize",
      repositionOpenMenu,
      {
        passive: true
      }
    );

    window.addEventListener(
      "scroll",
      repositionOpenMenu,
      {
        passive: true,
        capture: true
      }
    );
  }


  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once: true
      }
    );
  } else {
    init();
  }
})();
