/*
=========================================================
NEYO — CUSTOM TOOLTIP SYSTEM

Purpose:
- One consistent tooltip system for the entire UI
- Uses data-tooltip attributes only
- No browser-native title tooltips
- Hover + keyboard focus support
- Smart viewport positioning
- Delayed appearance
- Immediate hide
- One tooltip visible at a time
- Disabled on touch-first mobile devices
=========================================================
*/

(() => {
  "use strict";

  const TOOLTIP_SELECTOR = "[data-tooltip]";

  const SHOW_DELAY = 500;
  const HIDE_DELAY = 40;
  const EDGE_GAP = 10;
  const TARGET_GAP = 8;

  let tooltipEl = null;
  let activeTarget = null;

  let showTimer = null;
  let hideTimer = null;

  let lastPointerType = "mouse";


  /* =====================================================
     DEVICE / INPUT DETECTION
     ===================================================== */

  function isTouchFirstDevice() {
    return (
      window.matchMedia?.(
        "(hover: none), (pointer: coarse)"
      ).matches === true
    );
  }


  /* =====================================================
     TOOLTIP ELEMENT
     ===================================================== */

  function createTooltip() {
    if (tooltipEl) {
      return tooltipEl;
    }

    const element =
      document.createElement("div");

    element.className =
      "neo-tooltip";

    element.setAttribute(
      "role",
      "tooltip"
    );

    element.setAttribute(
      "aria-hidden",
      "true"
    );

    document.body.appendChild(
      element
    );

    tooltipEl = element;

    return tooltipEl;
  }


  /* =====================================================
     TIMERS
     ===================================================== */

  function clearShowTimer() {
    if (showTimer) {
      window.clearTimeout(
        showTimer
      );

      showTimer = null;
    }
  }


  function clearHideTimer() {
    if (hideTimer) {
      window.clearTimeout(
        hideTimer
      );

      hideTimer = null;
    }
  }


  function clearTimers() {
    clearShowTimer();
    clearHideTimer();
  }


  /* =====================================================
     TOOLTIP TEXT
     ===================================================== */

  function getTooltipText(
    target
  ) {
    if (!target) {
      return "";
    }

    return (
      target
        .getAttribute(
          "data-tooltip"
        )
        ?.trim() || ""
    );
  }


  /* =====================================================
     POSITION PREFERENCE
     ===================================================== */

  function getPreferredPlacement(
    target
  ) {
    const placement =
      target.getAttribute(
        "data-tooltip-position"
      );

    switch (placement) {
      case "top":
      case "bottom":
      case "left":
      case "right":
        return placement;

      default:
        return "top";
    }
  }


  /* =====================================================
     POSITION TOOLTIP
     ===================================================== */

  function positionTooltip(
    target
  ) {
    if (
      !tooltipEl ||
      !target
    ) {
      return;
    }

    const targetRect =
      target.getBoundingClientRect();

    const tooltipRect =
      tooltipEl.getBoundingClientRect();

    const viewportWidth =
      document.documentElement
        .clientWidth;

    const viewportHeight =
      document.documentElement
        .clientHeight;

    let placement =
      getPreferredPlacement(
        target
      );

    let top = 0;
    let left = 0;


    /* ===================================================
       FIRST PASS
       =================================================== */

    function calculate(
      position
    ) {
      let nextTop = 0;
      let nextLeft = 0;

      switch (position) {

        case "bottom":
          nextTop =
            targetRect.bottom +
            TARGET_GAP;

          nextLeft =
            targetRect.left +
            (
              targetRect.width -
              tooltipRect.width
            ) / 2;

          break;


        case "left":
          nextTop =
            targetRect.top +
            (
              targetRect.height -
              tooltipRect.height
            ) / 2;

          nextLeft =
            targetRect.left -
            tooltipRect.width -
            TARGET_GAP;

          break;


        case "right":
          nextTop =
            targetRect.top +
            (
              targetRect.height -
              tooltipRect.height
            ) / 2;

          nextLeft =
            targetRect.right +
            TARGET_GAP;

          break;


        case "top":
        default:
          nextTop =
            targetRect.top -
            tooltipRect.height -
            TARGET_GAP;

          nextLeft =
            targetRect.left +
            (
              targetRect.width -
              tooltipRect.width
            ) / 2;

          break;
      }

      return {
        top: nextTop,
        left: nextLeft
      };
    }


    let position =
      calculate(
        placement
      );


    /* ===================================================
       AUTO-FLIP
       =================================================== */

    if (
      placement === "top" &&
      position.top <
        EDGE_GAP
    ) {
      placement =
        "bottom";

      position =
        calculate(
          placement
        );
    }


    if (
      placement === "bottom" &&
      position.top +
        tooltipRect.height >
        viewportHeight -
          EDGE_GAP
    ) {
      placement =
        "top";

      position =
        calculate(
          placement
        );
    }


    if (
      placement === "left" &&
      position.left <
        EDGE_GAP
    ) {
      placement =
        "right";

      position =
        calculate(
          placement
        );
    }


    if (
      placement === "right" &&
      position.left +
        tooltipRect.width >
        viewportWidth -
          EDGE_GAP
    ) {
      placement =
        "left";

      position =
        calculate(
          placement
        );
    }


    top =
      position.top;

    left =
      position.left;


    /* ===================================================
       VIEWPORT CLAMP
       =================================================== */

    left =
      Math.max(
        EDGE_GAP,
        Math.min(
          left,
          viewportWidth -
            tooltipRect.width -
            EDGE_GAP
        )
      );


    top =
      Math.max(
        EDGE_GAP,
        Math.min(
          top,
          viewportHeight -
            tooltipRect.height -
            EDGE_GAP
        )
      );


    tooltipEl.style.left =
      `${Math.round(left)}px`;

    tooltipEl.style.top =
      `${Math.round(top)}px`;

    tooltipEl.dataset.placement =
      placement;
  }


  /* =====================================================
     SHOW
     ===================================================== */

  function showTooltip(
    target
  ) {
    const text =
      getTooltipText(
        target
      );

    if (!text) {
      return;
    }

    if (
      !document.body.contains(
        target
      )
    ) {
      return;
    }

    clearTimers();

    const tooltip =
      createTooltip();

    activeTarget =
      target;

    tooltip.textContent =
      text;

    tooltip.setAttribute(
      "aria-hidden",
      "false"
    );

    tooltip.classList.remove(
      "is-visible"
    );

    tooltip.style.visibility =
      "hidden";

    /*
    Make tooltip measurable
    without showing it visually.
    */

    requestAnimationFrame(
      () => {
        if (
          activeTarget !==
          target
        ) {
          return;
        }

        positionTooltip(
          target
        );

        tooltip.style.visibility =
          "";

        requestAnimationFrame(
          () => {
            if (
              activeTarget !==
              target
            ) {
              return;
            }

            tooltip.classList.add(
              "is-visible"
            );
          }
        );
      }
    );
  }


  /* =====================================================
     SCHEDULE SHOW
     ===================================================== */

  function scheduleShow(
    target,
    immediate = false
  ) {
    if (!target) {
      return;
    }

    if (
      isTouchFirstDevice() &&
      lastPointerType !==
        "mouse"
    ) {
      return;
    }

    clearHideTimer();
    clearShowTimer();

    const delay =
      immediate
        ? 0
        : SHOW_DELAY;

    showTimer =
      window.setTimeout(
        () => {
          showTimer = null;

          showTooltip(
            target
          );
        },
        delay
      );
  }


  /* =====================================================
     HIDE
     ===================================================== */

  function hideTooltip() {
    clearShowTimer();

    if (!tooltipEl) {
      activeTarget = null;
      return;
    }

    tooltipEl.classList.remove(
      "is-visible"
    );

    tooltipEl.setAttribute(
      "aria-hidden",
      "true"
    );

    activeTarget = null;
  }


  function scheduleHide(
    immediate = false
  ) {
    clearShowTimer();
    clearHideTimer();

    if (immediate) {
      hideTooltip();
      return;
    }

    hideTimer =
      window.setTimeout(
        () => {
          hideTimer = null;

          hideTooltip();
        },
        HIDE_DELAY
      );
  }


  /* =====================================================
     RESOLVE TARGET
     ===================================================== */

  function getTooltipTarget(
    node
  ) {
    if (
      !(node instanceof Element)
    ) {
      return null;
    }

    return node.closest(
      TOOLTIP_SELECTOR
    );
  }


  /* =====================================================
     POINTER EVENTS
     ===================================================== */

  document.addEventListener(
    "pointerover",
    event => {
      lastPointerType =
        event.pointerType ||
        "mouse";

      if (
        event.pointerType ===
        "touch"
      ) {
        return;
      }

      const target =
        getTooltipTarget(
          event.target
        );

      if (!target) {
        return;
      }

      const related =
        event.relatedTarget;

      if (
        related instanceof Node &&
        target.contains(
          related
        )
      ) {
        return;
      }

      scheduleShow(
        target
      );
    },
    true
  );


  document.addEventListener(
    "pointerout",
    event => {
      if (
        event.pointerType ===
        "touch"
      ) {
        return;
      }

      const target =
        getTooltipTarget(
          event.target
        );

      if (!target) {
        return;
      }

      const related =
        event.relatedTarget;

      if (
        related instanceof Node &&
        target.contains(
          related
        )
      ) {
        return;
      }

      if (
        activeTarget ===
          target ||
        showTimer
      ) {
        scheduleHide();
      }
    },
    true
  );


  /* =====================================================
     KEYBOARD ACCESSIBILITY
     ===================================================== */

  document.addEventListener(
    "focusin",
    event => {
      const target =
        getTooltipTarget(
          event.target
        );

      if (!target) {
        return;
      }

      scheduleShow(
        target,
        true
      );
    },
    true
  );


  document.addEventListener(
    "focusout",
    event => {
      const target =
        getTooltipTarget(
          event.target
        );

      if (!target) {
        return;
      }

      scheduleHide(
        true
      );
    },
    true
  );


  /* =====================================================
     ESCAPE
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
        "Escape"
      ) {
        scheduleHide(
          true
        );
      }
    },
    true
  );


  /* =====================================================
     CLICK
     Hide tooltip when action is executed
     ===================================================== */

  document.addEventListener(
    "pointerdown",
    event => {
      if (
        event.pointerType ===
        "touch"
      ) {
        lastPointerType =
          "touch";
      }

      if (
        activeTarget
      ) {
        scheduleHide(
          true
        );
      }
    },
    true
  );


  /* =====================================================
     SCROLL / RESIZE
     ===================================================== */

  window.addEventListener(
    "resize",
    () => {
      if (
        activeTarget &&
        tooltipEl?.classList.contains(
          "is-visible"
        )
      ) {
        positionTooltip(
          activeTarget
        );
      }
    },
    {
      passive: true
    }
  );


  document.addEventListener(
    "scroll",
    () => {
      if (
        activeTarget &&
        tooltipEl?.classList.contains(
          "is-visible"
        )
      ) {
        scheduleHide(
          true
        );
      }
    },
    {
      capture: true,
      passive: true
    }
  );


  /* =====================================================
     DOM MUTATION SAFETY
     Hide if active element disappears
     ===================================================== */

  const observer =
    new MutationObserver(
      () => {
        if (
          activeTarget &&
          !document.body.contains(
            activeTarget
          )
        ) {
          scheduleHide(
            true
          );
        }
      }
    );


  function startObserver() {
    if (!document.body) {
      return;
    }

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }


  /* =====================================================
     INIT
     ===================================================== */

  function init() {
    createTooltip();
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
