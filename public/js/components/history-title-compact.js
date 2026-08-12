/*
=========================================================
NEYO — HISTORY TITLE COMPACT

Purpose:
- Compact long sidebar chat titles
- Preserve original full title
- Keep legacy neo.js untouched
- Support dynamically loaded history items
- Prevent title/action overlap
=========================================================
*/

(() => {
  "use strict";

  const TITLE_SELECTOR =
    ".history-item-title";

  const MAX_LENGTH = 23;


  /* =====================================================
     COMPACT TEXT
     ===================================================== */

  function compactText(text) {
    const value =
      String(text || "").trim();

    if (
      value.length <=
      MAX_LENGTH
    ) {
      return value;
    }

    return (
      value
        .slice(
          0,
          MAX_LENGTH
        )
        .trimEnd() +
      "…"
    );
  }


  /* =====================================================
     APPLY TO ONE TITLE
     ===================================================== */

  function processTitle(
    element
  ) {
    if (
      !(element instanceof Element)
    ) {
      return;
    }

    if (
      !element.matches(
        TITLE_SELECTOR
      )
    ) {
      return;
    }


    /*
    Preserve original title only once.
    */

    if (
      !element.dataset.fullTitle
    ) {
      const original =
        element.textContent
          ?.trim() || "";

      if (!original) {
        return;
      }

      element.dataset.fullTitle =
        original;
    }


    const fullTitle =
      element.dataset.fullTitle;

    const compact =
      compactText(
        fullTitle
      );


    /*
    Only update when required.
    */

    if (
      element.textContent !==
      compact
    ) {
      element.textContent =
        compact;
    }


    /*
    Accessibility + custom tooltip.
    */

    element.setAttribute(
      "aria-label",
      fullTitle
    );

    element.setAttribute(
      "data-tooltip",
      fullTitle
    );

    element.setAttribute(
      "data-tooltip-position",
      "right"
    );

    /*
    Never use browser native tooltip.
    */

    element.removeAttribute(
      "title"
    );
  }


  /* =====================================================
     PROCESS TREE
     ===================================================== */

  function processTree(
    root
  ) {
    if (!root) {
      return;
    }

    if (
      root instanceof Element &&
      root.matches(
        TITLE_SELECTOR
      )
    ) {
      processTitle(
        root
      );
    }

    root
      .querySelectorAll?.(
        TITLE_SELECTOR
      )
      .forEach(
        processTitle
      );
  }


  /* =====================================================
     INITIAL HISTORY
     ===================================================== */

  function processExisting() {
    processTree(
      document
    );
  }


  /* =====================================================
     WATCH DYNAMIC HISTORY
     ===================================================== */

  function startObserver() {
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
          for (
            const mutation
            of mutations
          ) {

            if (
              mutation.type ===
              "childList"
            ) {
              mutation
                .addedNodes
                .forEach(
                  node => {
                    if (
                      node instanceof
                      Element
                    ) {
                      processTree(
                        node
                      );
                    }
                  }
                );
            }


            /*
            If legacy code rewrites
            a title's textContent.
            */

            if (
              mutation.type ===
              "characterData"
            ) {
              const parent =
                mutation.target
                  .parentElement;

              if (
                parent?.matches(
                  TITLE_SELECTOR
                )
              ) {
                /*
                New title from legacy code.
                Replace stored original.
                */

                const current =
                  parent.textContent
                    ?.trim() || "";

                if (
                  current &&
                  current !==
                    compactText(
                      parent.dataset
                        .fullTitle ||
                      ""
                    )
                ) {
                  parent.dataset
                    .fullTitle =
                    current;

                  processTitle(
                    parent
                  );
                }
              }
            }
          }
        }
      );


    observer.observe(
      historyList,
      {
        childList: true,
        subtree: true,
        characterData: true
      }
    );
  }


  /* =====================================================
     INIT
     ===================================================== */

  function init() {
    processExisting();
    startObserver();
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
