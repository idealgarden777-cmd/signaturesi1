/*
=========================================================
NEYO — COMPOSER SCROLLBAR CONTROLLER
Isolated / conflict-safe version

Owns:
- multiline detection
- overflow detection
- custom scrollbar thumb
- state classes

Does NOT own:
- textarea autosize
- composer shape
- attach / mic / send positioning
- expand / collapse logic
- neo.js
=========================================================
*/

(() => {
  "use strict";

  const composer =
    document.getElementById("glassInputContainer");

  const textarea =
    document.getElementById("chatInput");

  if (!composer || !textarea) {
    return;
  }

  let rail =
    composer.querySelector(
      ".composer-custom-scrollbar"
    );

  let thumb = null;

  if (!rail) {
    rail =
      document.createElement("div");

    rail.className =
      "composer-custom-scrollbar";

    rail.setAttribute(
      "aria-hidden",
      "true"
    );

    thumb =
      document.createElement("div");

    thumb.className =
      "composer-custom-scrollbar-thumb";

    rail.appendChild(thumb);
    composer.appendChild(rail);
  } else {
    thumb =
      rail.querySelector(
        ".composer-custom-scrollbar-thumb"
      );
  }

  if (!thumb) {
    return;
  }

  let rafId = 0;
  let hideTimer = 0;

  function isExpanded() {
    return composer.classList.contains(
      "is-writing-expanded"
    );
  }

  function hasContent() {
    return textarea.value.trim().length > 0;
  }

  function getLineHeight() {
    const styles =
      window.getComputedStyle(textarea);

    const parsed =
      parseFloat(styles.lineHeight);

    return Number.isFinite(parsed)
      ? parsed
      : 22;
  }

  function detectMultiline() {
    if (!hasContent()) {
      return false;
    }

    const lineHeight =
      getLineHeight();

    const explicitLines =
      textarea.value.split("\n").length;

    const visualLines =
      textarea.scrollHeight /
      Math.max(lineHeight, 1);

    return (
      explicitLines > 1 ||
      visualLines > 1.55
    );
  }

  function detectOverflow() {
    if (isExpanded()) {
      return false;
    }

    return (
      textarea.scrollHeight >
      textarea.clientHeight + 2
    );
  }

  function syncClasses() {
    const expanded =
      isExpanded();

    const content =
      hasContent();

    const multiline =
      !expanded &&
      detectMultiline();

    const overflow =
      !expanded &&
      detectOverflow();

    composer.classList.toggle(
      "composer-has-content",
      content
    );

    composer.classList.toggle(
      "composer-multiline",
      multiline
    );

    composer.classList.toggle(
      "composer-overflow",
      overflow
    );

    rail.classList.toggle(
      "is-visible",
      overflow
    );

    return {
      expanded,
      content,
      multiline,
      overflow
    };
  }

  function updateThumb() {
    const state =
      syncClasses();

    if (
      state.expanded ||
      !state.overflow
    ) {
      thumb.style.height = "";
      thumb.style.transform = "";
      rail.classList.remove(
        "is-active"
      );
      return;
    }

    const railHeight =
      rail.clientHeight;

    const scrollHeight =
      textarea.scrollHeight;

    const clientHeight =
      textarea.clientHeight;

    const scrollTop =
      textarea.scrollTop;

    if (
      railHeight <= 0 ||
      scrollHeight <= clientHeight
    ) {
      return;
    }

    const viewportRatio =
      clientHeight / scrollHeight;

    const thumbHeight =
      Math.max(
        20,
        railHeight * viewportRatio
      );

    const maxThumbTravel =
      Math.max(
        0,
        railHeight - thumbHeight
      );

    const maxScroll =
      Math.max(
        1,
        scrollHeight - clientHeight
      );

    const progress =
      Math.min(
        1,
        Math.max(
          0,
          scrollTop / maxScroll
        )
      );

    thumb.style.height =
      `${thumbHeight}px`;

    thumb.style.transform =
      `translateY(${maxThumbTravel * progress}px)`;
  }

  function scheduleUpdate() {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }

    rafId =
      requestAnimationFrame(() => {
        rafId = 0;
        updateThumb();
      });
  }

  function showBriefly() {
    if (
      !composer.classList.contains(
        "composer-overflow"
      )
    ) {
      return;
    }

    rail.classList.add(
      "is-active"
    );

    clearTimeout(hideTimer);

    hideTimer =
      window.setTimeout(() => {
        rail.classList.remove(
          "is-active"
        );
      }, 900);
  }

  textarea.addEventListener(
    "input",
    () => {
      requestAnimationFrame(
        scheduleUpdate
      );
    }
  );

  textarea.addEventListener(
    "scroll",
    () => {
      showBriefly();
      scheduleUpdate();
    },
    {
      passive: true
    }
  );

  textarea.addEventListener(
    "focus",
    scheduleUpdate
  );

  textarea.addEventListener(
    "blur",
    scheduleUpdate
  );

  const resizeObserver =
    new ResizeObserver(() => {
      scheduleUpdate();
    });

  resizeObserver.observe(
    textarea
  );

  resizeObserver.observe(
    composer
  );

  const classObserver =
    new MutationObserver(
      mutations => {
        for (const mutation of mutations) {
          if (
            mutation.type === "attributes" &&
            mutation.attributeName === "class"
          ) {
            scheduleUpdate();
            break;
          }
        }
      }
    );

  classObserver.observe(
    composer,
    {
      attributes: true,
      attributeFilter: ["class"]
    }
  );

  if (window.visualViewport) {
    window.visualViewport.addEventListener(
      "resize",
      scheduleUpdate,
      {
        passive: true
      }
    );
  }

  window.addEventListener(
    "resize",
    scheduleUpdate,
    {
      passive: true
    }
  );

  window.NeyoComposerScrollbar =
    Object.freeze({
      refresh:
        scheduleUpdate,

      getState:
        () => ({
          expanded:
            isExpanded(),

          hasContent:
            composer.classList.contains(
              "composer-has-content"
            ),

          multiline:
            composer.classList.contains(
              "composer-multiline"
            ),

          overflow:
            composer.classList.contains(
              "composer-overflow"
            )
        })
    });

  scheduleUpdate();

  setTimeout(
    scheduleUpdate,
    120
  );

  setTimeout(
    scheduleUpdate,
    500
  );
})();
