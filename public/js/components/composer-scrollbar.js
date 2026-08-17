/*
=========================================================
NEYO — COMPOSER SCROLLBAR / TYPING CONTROL
STABLE PRODUCTION VERSION

Owns:
- reliable multiline detection
- textarea height control
- max-height behavior
- internal scrolling after max-height
- custom scrollbar sync

Does NOT own:
- composer width, shape, controls, voice, expand

CSS REQUIREMENT:
#glassInputContainer textarea#chatInput should NOT have
a height or max-height transition. Only padding transitions
are safe for stable typing.
=========================================================
*/

(() => {
  "use strict";

  const composer = document.getElementById("glassInputContainer");
  const textarea = document.getElementById("chatInput");
  if (!composer || !textarea) return;

  // ---- config ----
  const CONFIG = {
    desktopMaxHeight: 132,
    mobileMaxHeight: 112,
    landscapeMaxHeight: 92,
    compactHeight: 40,
    multilineTolerance: 1.35,
    overflowTolerance: 2,
  };

  // ---- scrollbar ----
  let rail = composer.querySelector(".composer-custom-scrollbar");
  let thumb = null;
  if (!rail) {
    rail = document.createElement("div");
    rail.className = "composer-custom-scrollbar";
    rail.setAttribute("aria-hidden", "true");
    thumb = document.createElement("div");
    thumb.className = "composer-custom-scrollbar-thumb";
    rail.appendChild(thumb);
    composer.appendChild(rail);
  } else {
    thumb = rail.querySelector(".composer-custom-scrollbar-thumb");
  }
  if (!thumb) return;

  // ---- state ----
  let rafId = 0;
  let hideTimer = 0;
  let pollTimer = 0;
  let resizeTimer = 0;
  let lastValue = textarea.value;

  // ---- helpers ----
  const isExpanded = () => composer.classList.contains("is-writing-expanded");
  const hasContent = () => textarea.value.trim().length > 0;
  const isMobile = () => window.matchMedia("(max-width: 767px)").matches;
  const isLandscapePhone = () =>
    window.matchMedia("(max-height: 520px) and (orientation: landscape)").matches;

  function getMaxHeight() {
    if (isLandscapePhone()) return CONFIG.landscapeMaxHeight;
    if (isMobile()) return CONFIG.mobileMaxHeight;
    return CONFIG.desktopMaxHeight;
  }

  function getMetrics() {
    const style = window.getComputedStyle(textarea);
    return {
      lineHeight: parseFloat(style.lineHeight) || 22,
      paddingTop: parseFloat(style.paddingTop) || 0,
      paddingBottom: parseFloat(style.paddingBottom) || 0,
    };
  }

  // ---- multiline detection ----
  function detectMultiline() {
    if (!hasContent() || isExpanded()) return false;
    const value = textarea.value || "";
    if (value.includes("\n")) return true;
    const { lineHeight, paddingTop, paddingBottom } = getMetrics();
    const textHeight = Math.max(0, textarea.scrollHeight - paddingTop - paddingBottom);
    return textHeight > lineHeight * CONFIG.multilineTolerance;
  }

  // ---- autosize (stable, no transition manipulation) ----
  function resizeTextarea() {
    if (isExpanded()) return;

    if (!hasContent()) {
      textarea.style.height = CONFIG.compactHeight + "px";
      textarea.style.overflowY = "hidden";
      return;
    }

    const maxH = getMaxHeight();

    // Set height to auto to get the natural scrollHeight.
    // No transition overrides – CSS must NOT have height transition.
    textarea.style.height = "auto";
    const requiredHeight = textarea.scrollHeight;

    const targetHeight = Math.min(Math.max(CONFIG.compactHeight, requiredHeight), maxH);
    textarea.style.height = targetHeight + "px";
    textarea.style.overflowY = requiredHeight > maxH + CONFIG.overflowTolerance ? "auto" : "hidden";
  }

  // ---- state classes ----
  function syncClasses() {
    const content = hasContent();
    const multiline = content && !isExpanded() && detectMultiline();
    const overflow = textarea.scrollHeight > textarea.clientHeight + CONFIG.overflowTolerance;

    composer.classList.toggle("composer-has-content", content);
    composer.classList.toggle("composer-multiline", multiline);
    composer.classList.toggle("composer-overflow", overflow);
    rail.classList.toggle("is-visible", overflow);
    return { content, multiline, overflow };
  }

  // ---- thumb update (takes optional state to avoid double sync) ----
  function updateThumb(state) {
    if (!state) {
      state = {
        overflow: composer.classList.contains("composer-overflow"),
      };
    }
    if (!state.overflow) {
      thumb.style.height = "";
      thumb.style.transform = "";
      rail.classList.remove("is-active");
      return;
    }

    const railH = rail.clientHeight;
    const scrollH = textarea.scrollHeight;
    const clientH = textarea.clientHeight;
    if (railH <= 0 || scrollH <= clientH) return;

    const minThumb = isExpanded() ? 24 : 20;
    const thumbH = Math.max(minThumb, railH * (clientH / scrollH));
    const maxTravel = Math.max(0, railH - thumbH);
    const maxScroll = Math.max(1, scrollH - clientH);
    const progress = Math.min(1, Math.max(0, textarea.scrollTop / maxScroll));

    thumb.style.height = thumbH + "px";
    thumb.style.transform = `translateY(${maxTravel * progress}px)`;
  }

  // ---- main update (single RAF) ----
  function updateComposer() {
    resizeTextarea();
    const state = syncClasses();
    updateThumb(state);
  }

  function scheduleUpdate() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      updateComposer();
    });
  }

  // ---- debounced resize ----
  function handleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(scheduleUpdate, 80);
  }

  // ---- input ----
  textarea.addEventListener("input", () => {
    lastValue = textarea.value;
    scheduleUpdate();
  });

  // ---- scroll (thumb) ----
  textarea.addEventListener(
    "scroll",
    () => {
      rail.classList.add("is-active");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        rail.classList.remove("is-active");
      }, 800);

      // Only update thumb, no need to sync classes again
      updateThumb({
        overflow: composer.classList.contains("composer-overflow"),
      });
    },
    { passive: true }
  );

  // ---- focus ----
  textarea.addEventListener("focus", scheduleUpdate);

  // ---- resize / orientation (debounced) ----
  window.addEventListener("resize", handleResize, { passive: true });
  window.addEventListener(
    "orientationchange",
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(scheduleUpdate, 140);
    },
    { passive: true }
  );

  // ---- programmatic value changes (lightweight poll) ----
  function pollValue() {
    const current = textarea.value;
    if (current !== lastValue) {
      lastValue = current;
      scheduleUpdate();
    }
    pollTimer = setTimeout(pollValue, 300);
  }
  pollValue();

  // ---- page cleanup ----
  window.addEventListener(
    "pagehide",
    () => {
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(hideTimer);
      clearTimeout(pollTimer);
      clearTimeout(resizeTimer);
    },
    { once: true }
  );

  // ---- public API ----
  window.NeyoComposerScrollbar = Object.freeze({
    refresh: scheduleUpdate,
    getState: () => ({
      expanded: isExpanded(),
      multiline: composer.classList.contains("composer-multiline"),
      overflow: composer.classList.contains("composer-overflow"),
    }),
  });

  // ---- init ----
  scheduleUpdate();
  setTimeout(scheduleUpdate, 100);
})();
