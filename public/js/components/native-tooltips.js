/*
=========================================================
NEYO — NATIVE TOOLTIP GUARD

Purpose:
- Remove browser-native title tooltips
- Keep custom data-tooltip system untouched
- Handle dynamically added elements
- Handle title attributes added later by legacy code
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     REMOVE TITLE FROM ONE ELEMENT
     ===================================================== */

  function removeNativeTitle(element) {
    if (!(element instanceof Element)) {
      return;
    }

    if (element.hasAttribute("title")) {
      element.removeAttribute("title");
    }
  }


  /* =====================================================
     CLEAN AN ELEMENT + ITS CHILDREN
     ===================================================== */

  function cleanTree(root) {
    if (!root) {
      return;
    }

    if (root instanceof Element) {
      removeNativeTitle(root);
    }

    if (
      root instanceof Element ||
      root === document
    ) {
      root
        .querySelectorAll?.("[title]")
        .forEach(removeNativeTitle);
    }
  }


  /* =====================================================
     INITIAL CLEANUP
     ===================================================== */

  function cleanExistingTitles() {
    cleanTree(document);
  }


  /* =====================================================
     WATCH FUTURE DOM CHANGES
     ===================================================== */

  function startObserver() {
    if (!document.documentElement) {
      return;
    }

    const observer =
      new MutationObserver(
        mutations => {
          for (const mutation of mutations) {

            /*
            Legacy JS may add/change title
            after page load.
            */

            if (
              mutation.type === "attributes" &&
              mutation.attributeName === "title"
            ) {
              removeNativeTitle(
                mutation.target
              );

              continue;
            }


            /*
            New buttons / menus / dynamic UI
            may be inserted later.
            */

            if (
              mutation.type === "childList"
            ) {
              mutation.addedNodes.forEach(
                node => {
                  if (
                    node instanceof Element
                  ) {
                    cleanTree(node);
                  }
                }
              );
            }
          }
        }
      );


    observer.observe(
      document.documentElement,
      {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "title"
        ]
      }
    );
  }


  /* =====================================================
     SAFETY FOR HOVER

     If some script adds title just before
     mouse hover, remove it immediately.
     ===================================================== */

  document.addEventListener(
    "pointerover",
    event => {
      const target =
        event.target instanceof Element
          ? event.target.closest("[title]")
          : null;

      if (target) {
        removeNativeTitle(target);
      }
    },
    true
  );


  document.addEventListener(
    "focusin",
    event => {
      const target =
        event.target instanceof Element
          ? event.target.closest("[title]")
          : null;

      if (target) {
        removeNativeTitle(target);
      }
    },
    true
  );


  /* =====================================================
     INIT
     ===================================================== */

  function init() {
    cleanExistingTitles();
    startObserver();
  }


  if (
    document.readyState === "loading"
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
