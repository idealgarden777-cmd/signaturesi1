/*
=========================================================
NEYO — TOOLTIP REGISTRY

Purpose:
- Central tooltip labels for the whole UI
- Works with public/js/components/tooltips.js
- Keeps legacy neo.js untouched
- Supports dynamically-created buttons
- Does NOT use native title tooltips
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     STATIC TOOLTIP MAP
     ===================================================== */

  const STATIC_TOOLTIPS = [
    {
      selector: "#collapseSidebarBtn",
      text: "Close sidebar",
      position: "right"
    },
    {
      selector: "#sidebarToggleBtn",
      text: "Toggle sidebar",
      position: "bottom"
    },
    {
      selector: "#topBarDarkModeToggle",
      text: "Change theme",
      position: "bottom"
    },
    {
      selector: "#modelBadgeBtn",
      text: "Choose model",
      position: "bottom"
    },

    {
      selector: "#composerExpandBtn",
      text: "Expand",
      position: "top"
    },
    {
      selector: "#attachBtn",
      text: "Attach files",
      position: "top"
    },
    {
      selector: "#micBtn",
      text: "Voice input",
      position: "top"
    },
    {
      selector: "#stopRecBtn",
      text: "Stop listening",
      position: "top"
    },

    {
      selector: "#neoSettingsCloseBtn",
      text: "Close settings",
      position: "right"
    },

    {
      selector: "#modalCloseBtn",
      text: "Close",
      position: "left"
    }
  ];


  /* =====================================================
     DYNAMIC TOOLTIP RULES
     ===================================================== */

  const DYNAMIC_TOOLTIPS = [
    {
      selector: ".history-action-btn",
      text: "Conversation options",
      position: "left"
    },

    {
      selector: ".copy-msg-btn",
      text: "Copy",
      position: "top"
    },
    {
      selector: ".share-msg-btn",
      text: "Share",
      position: "top"
    },
    {
      selector: ".regen-msg-btn",
      text: "Regenerate",
      position: "top"
    },

    {
      selector: ".user-edit-btn",
      text: "Edit message",
      position: "top"
    },
    {
      selector: ".user-copy-btn",
      text: "Copy",
      position: "top"
    },

    {
      selector: ".chip-remove-btn",
      text: "Remove attachment",
      position: "top"
    },
    {
      selector: ".file-chip-remove",
      text: "Remove attachment",
      position: "top"
    },

    {
      selector: ".attachment-remove-btn",
      text: "Remove attachment",
      position: "top"
    }
  ];


  /* =====================================================
     APPLY TOOLTIP
     ===================================================== */

  function applyTooltip(
    element,
    text,
    position = "top"
  ) {
    if (!(element instanceof Element)) {
      return;
    }

    if (!text) {
      return;
    }

    element.setAttribute(
      "data-tooltip",
      text
    );

    element.setAttribute(
      "data-tooltip-position",
      position
    );

    /*
    Native browser tooltip must never return.
    */
    element.removeAttribute(
      "title"
    );


    /*
    Only add aria-label when element is
    an icon-only interactive control and
    has no accessible label already.
    */

    const isInteractive =
      element.matches(
        "button, [role='button'], a"
      );

    const hasVisibleText =
      element.textContent
        ?.trim()
        .length > 0;

    const hasAriaLabel =
      element.hasAttribute(
        "aria-label"
      );

    if (
      isInteractive &&
      !hasVisibleText &&
      !hasAriaLabel
    ) {
      element.setAttribute(
        "aria-label",
        text
      );
    }
  }


  /* =====================================================
     APPLY STATIC REGISTRY
     ===================================================== */

  function applyStaticTooltips() {
    for (
      const rule
      of STATIC_TOOLTIPS
    ) {
      document
        .querySelectorAll(
          rule.selector
        )
        .forEach(
          element => {
            applyTooltip(
              element,
              rule.text,
              rule.position
            );
          }
        );
    }
  }


  /* =====================================================
     APPLY DYNAMIC REGISTRY
     ===================================================== */

  function applyDynamicTooltips(
    root = document
  ) {
    if (!root) {
      return;
    }

    for (
      const rule
      of DYNAMIC_TOOLTIPS
    ) {
      /*
      Root itself may match.
      */

      if (
        root instanceof Element &&
        root.matches(
          rule.selector
        )
      ) {
        applyTooltip(
          root,
          rule.text,
          rule.position
        );
      }


      /*
      Descendants may match.
      */

      root
        .querySelectorAll?.(
          rule.selector
        )
        .forEach(
          element => {
            applyTooltip(
              element,
              rule.text,
              rule.position
            );
          }
        );
    }
  }


  /* =====================================================
     SEND / STOP SPECIAL STATE

     send-state.js owns the live label:
     Send <-> Stop

     We only enforce native title removal.
     ===================================================== */

  function syncSendButton() {
    const sendBtn =
      document.getElementById(
        "sendBtn"
      );

    if (!sendBtn) {
      return;
    }

    sendBtn.removeAttribute(
      "title"
    );

    /*
    Do not overwrite data-tooltip here.
    send-state.js controls it dynamically.
    */
  }


  /* =====================================================
     EXPAND / COLLAPSE SPECIAL STATE

     composer-expand.js owns the live label:
     Expand <-> Collapse
     ===================================================== */

  function syncExpandButton() {
    const button =
      document.getElementById(
        "composerExpandBtn"
      );

    if (!button) {
      return;
    }

    button.removeAttribute(
      "title"
    );

    const expanded =
      button.getAttribute(
        "aria-expanded"
      ) === "true";

    button.setAttribute(
      "data-tooltip",
      expanded
        ? "Collapse"
        : "Expand"
    );

    button.setAttribute(
      "data-tooltip-position",
      "top"
    );
  }


  /* =====================================================
     OBSERVE SPECIAL STATE CHANGES
     ===================================================== */

  function observeSpecialButtons() {
    const sendBtn =
      document.getElementById(
        "sendBtn"
      );

    if (sendBtn) {
      const observer =
        new MutationObserver(
          () => {
            syncSendButton();
          }
        );

      observer.observe(
        sendBtn,
        {
          attributes: true,
          childList: true,
          subtree: true
        }
      );
    }


    const expandBtn =
      document.getElementById(
        "composerExpandBtn"
      );

    if (expandBtn) {
      const observer =
        new MutationObserver(
          () => {
            syncExpandButton();
          }
        );

      observer.observe(
        expandBtn,
        {
          attributes: true,
          attributeFilter: [
            "aria-expanded",
            "title"
          ]
        }
      );
    }
  }


  /* =====================================================
     WATCH DYNAMIC UI

     Covers:
     - new messages
     - response actions
     - chat history items
     - attachments
     ===================================================== */

  function startDynamicObserver() {
    if (!document.body) {
      return;
    }

    const observer =
      new MutationObserver(
        mutations => {
          for (
            const mutation
            of mutations
          ) {
            if (
              mutation.type !==
              "childList"
            ) {
              continue;
            }

            mutation
              .addedNodes
              .forEach(
                node => {
                  if (
                    node instanceof
                    Element
                  ) {
                    applyDynamicTooltips(
                      node
                    );
                  }
                }
              );
          }

          syncSendButton();
          syncExpandButton();
        }
      );


    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }


  /* =====================================================
     CLEAN REMAINING NATIVE TITLES

     native-tooltips.js already does this globally.
     This is only a defensive fallback.
     ===================================================== */

  function removeExistingTitles() {
    document
      .querySelectorAll(
        "[title]"
      )
      .forEach(
        element => {
          element.removeAttribute(
            "title"
          );
        }
      );
  }


  /* =====================================================
     INIT
     ===================================================== */

  function init() {
    removeExistingTitles();

    applyStaticTooltips();

    applyDynamicTooltips(
      document
    );

    syncSendButton();
    syncExpandButton();

    observeSpecialButtons();

    startDynamicObserver();
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
