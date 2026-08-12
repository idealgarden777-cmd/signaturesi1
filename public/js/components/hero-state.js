/*
=========================================================
NEYO — HERO STATE GUARD

Purpose:
- Keep legacy neo.js untouched
- Preserve hero CSS layout after New Conversation
- Allow hero to hide normally during active chats
=========================================================
*/

(() => {
  "use strict";

  const hero =
    document.getElementById("heroSection");

  if (!hero) {
    return;
  }

  function normalizeHeroDisplay() {
    /*
    neo.js uses:
    display:none  -> hide hero
    display:block -> show hero

    We keep "none", but remove "block"
    so hero.css controls its normal layout.
    */

    if (
      hero.style.display === "block"
    ) {
      hero.style.removeProperty(
        "display"
      );
    }
  }

  const observer =
    new MutationObserver(
      mutations => {
        for (const mutation of mutations) {
          if (
            mutation.type === "attributes" &&
            mutation.attributeName === "style"
          ) {
            normalizeHeroDisplay();
          }
        }
      }
    );

  observer.observe(
    hero,
    {
      attributes: true,
      attributeFilter: ["style"]
    }
  );

  normalizeHeroDisplay();
})();
