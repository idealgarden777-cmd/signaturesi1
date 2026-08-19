/*
=========================================================
NEYO — VOICE MODE CONTROLLER
Production Voice UI Shell

Owns:
- voice mode open / close
- mic toggle UI
- speaker toggle UI
- camera toggle UI
- camera preview
- end session button
- status transitions
- mascot event bridge

Does NOT own:
- Gemini connection
- microphone PCM streaming
- assistant playback engine
- mascot visual styling
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     DOM
     ===================================================== */

  const shell =
    document.getElementById("neyoVoiceMode");

  const stage =
    shell?.querySelector(
      ".voice-mode-stage"
    );

  const statusEl =
    document.getElementById(
      "neyoMascotStatus"
    );

  const micBtn =
    document.getElementById(
      "voiceModeMicBtn"
    );

  const cameraBtn =
    document.getElementById(
      "voiceModeCameraBtn"
    );

  const speakerBtn =
    document.getElementById(
      "voiceModeSpeakerBtn"
    );

  const endBtn =
    document.getElementById(
      "voiceModeEndBtn"
    );

  const cameraPreview =
    document.getElementById(
      "neyoCameraPreview"
    );

  const cameraVideo =
    document.getElementById(
      "neyoCameraVideo"
    );


  if (!shell) {
    console.warn(
      "[NEYO Voice Mode] Shell missing."
    );

    return;
  }


  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    open: false,

    muted: false,

    speakerOn: true,

    cameraOn: false,

    cameraStream: null,

    closing: false,

    currentStatus: "Ready"
  };


  let statusTimer =
    0;


  /* =====================================================
     HELPERS
     ===================================================== */

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


  function setButtonPressed(
    button,
    pressed
  ) {
    if (!button) return;


    button.setAttribute(
      "aria-pressed",
      String(Boolean(pressed))
    );


    button.classList.toggle(
      "is-active",
      Boolean(pressed)
    );
  }


  function setButtonMuted(
    button,
    muted
  ) {
    if (!button) return;


    button.classList.toggle(
      "is-muted",
      Boolean(muted)
    );
  }


  /* =====================================================
     STATUS
     ===================================================== */

  function setStatus(
    text,
    options = {}
  ) {
    if (!statusEl) {
      state.currentStatus =
        text;

      return;
    }


    if (
      !text ||
      text === state.currentStatus
    ) {
      return;
    }


    clearTimeout(
      statusTimer
    );


    const immediate =
      Boolean(
        options.immediate
      );


    state.currentStatus =
      text;


    if (immediate) {
      statusEl.classList.remove(
        "is-changing",
        "is-entering"
      );

      statusEl.textContent =
        text;

      return;
    }


    statusEl.classList.add(
      "is-changing"
    );


    statusTimer =
      setTimeout(
        () => {
          statusEl.textContent =
            text;


          statusEl.classList.remove(
            "is-changing"
          );


          statusEl.classList.add(
            "is-entering"
          );


          requestAnimationFrame(
            () => {
              requestAnimationFrame(
                () => {
                  statusEl.classList.remove(
                    "is-entering"
                  );
                }
              );
            }
          );

        },
        120
      );
  }


  /* =====================================================
     ICONS
     ===================================================== */

  function renderIcons() {

    if (micBtn) {
      micBtn.innerHTML =
        state.muted
          ? `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 9v3a3 3 0 0 0 4.8 2.4" stroke="currentColor" stroke-linecap="round"/>
              <path d="M15 9V5a3 3 0 0 0-6 0v1" stroke="currentColor" stroke-linecap="round"/>
              <path d="M5 5l14 14" stroke="currentColor" stroke-linecap="round"/>
              <path d="M5 11a7 7 0 0 0 11 5.7" stroke="currentColor" stroke-linecap="round"/>
              <path d="M12 19v3" stroke="currentColor" stroke-linecap="round"/>
            </svg>
          `
          : `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor"/>
              <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" stroke-linecap="round"/>
              <path d="M12 18v4" stroke="currentColor" stroke-linecap="round"/>
            </svg>
          `;
    }


    if (cameraBtn) {
      cameraBtn.innerHTML =
        state.cameraOn
          ? `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="6" width="13" height="12" rx="3" stroke="currentColor"/>
              <path d="M16 10l5-3v10l-5-3" stroke="currentColor" stroke-linejoin="round"/>
            </svg>
          `
          : `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="6" width="13" height="12" rx="3" stroke="currentColor"/>
              <path d="M16 10l5-3v10l-5-3" stroke="currentColor" stroke-linejoin="round"/>
              <path d="M4 4l16 16" stroke="currentColor" stroke-linecap="round"/>
            </svg>
          `;
    }


    if (speakerBtn) {
      speakerBtn.innerHTML =
        state.speakerOn
          ? `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 10v4h4l5 4V6l-5 4H5Z" stroke="currentColor" stroke-linejoin="round"/>
              <path d="M17 9a4 4 0 0 1 0 6" stroke="currentColor" stroke-linecap="round"/>
            </svg>
          `
          : `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 10v4h4l5 4V6l-5 4H5Z" stroke="currentColor" stroke-linejoin="round"/>
              <path d="M17 9l4 6" stroke="currentColor" stroke-linecap="round"/>
              <path d="M21 9l-4 6" stroke="currentColor" stroke-linecap="round"/>
            </svg>
          `;
    }


    if (endBtn) {
      endBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 7l14 14" stroke="currentColor" stroke-linecap="round"/>
          <path d="M19 7L5 21" stroke="currentColor" stroke-linecap="round"/>
        </svg>
      `;
    }
  }


  /* =====================================================
     BUTTON LABELS
     ===================================================== */

  function syncButtonLabels() {

    if (micBtn) {
      micBtn.setAttribute(
        "aria-label",
        state.muted
          ? "Unmute microphone"
          : "Mute microphone"
      );
    }


    if (cameraBtn) {
      cameraBtn.setAttribute(
        "aria-label",
        state.cameraOn
          ? "Turn camera off"
          : "Turn camera on"
      );
    }


    if (speakerBtn) {
      speakerBtn.setAttribute(
        "aria-label",
        state.speakerOn
          ? "Turn speaker off"
          : "Turn speaker on"
      );
    }


    if (endBtn) {
      endBtn.setAttribute(
        "aria-label",
        "End voice conversation"
      );
    }
  }


  function syncControls() {

    setButtonPressed(
      micBtn,
      !state.muted
    );


    setButtonMuted(
      micBtn,
      state.muted
    );


    setButtonPressed(
      cameraBtn,
      state.cameraOn
    );


    setButtonPressed(
      speakerBtn,
      state.speakerOn
    );


    setButtonMuted(
      speakerBtn,
      !state.speakerOn
    );


    renderIcons();

    syncButtonLabels();
  }


  /* =====================================================
     CAMERA
     ===================================================== */

  async function startCamera() {

    if (
      state.cameraOn &&
      state.cameraStream
    ) {
      return true;
    }


    try {

      const stream =
        await navigator
          .mediaDevices
          .getUserMedia({
            video: {
              facingMode:
                "user"
            },

            audio:
              false
          });


      state.cameraStream =
        stream;

      state.cameraOn =
        true;


      if (cameraVideo) {
        cameraVideo.srcObject =
          stream;


        try {
          await cameraVideo.play();
        } catch {}
      }


      cameraPreview?.classList.add(
        "is-visible"
      );


      dispatch(
        "neyo:voice-camera",
        {
          enabled:
            true
        }
      );


      syncControls();


      return true;


    } catch (error) {

      console.error(
        "[NEYO Voice Mode] Camera failed:",
        error
      );


      state.cameraOn =
        false;


      dispatch(
        "neyo:voice-camera",
        {
          enabled:
            false
        }
      );


      setStatus(
        "Camera unavailable"
      );


      syncControls();


      return false;
    }
  }


  function stopCamera() {

    if (
      state.cameraStream
    ) {

      for (
        const track
        of state.cameraStream.getTracks()
      ) {

        try {
          track.stop();
        } catch {}
      }
    }


    state.cameraStream =
      null;

    state.cameraOn =
      false;


    if (cameraVideo) {
      cameraVideo.srcObject =
        null;
    }


    cameraPreview?.classList.remove(
      "is-visible"
    );


    dispatch(
      "neyo:voice-camera",
      {
        enabled:
          false
      }
    );


    syncControls();
  }


  async function toggleCamera() {

    if (state.cameraOn) {
      stopCamera();
      return;
    }


    await startCamera();
  }


  /* =====================================================
     MICROPHONE TOGGLE
     ===================================================== */

  function toggleMic() {

    state.muted =
      !state.muted;


    dispatch(
      "neyo:voice-muted",
      {
        muted:
          state.muted
      }
    );


    if (state.muted) {

      setStatus(
        "Microphone muted"
      );

    } else {

      setStatus(
        "Listening…"
      );
    }


    syncControls();
  }


  /* =====================================================
     SPEAKER TOGGLE
     ===================================================== */

  function toggleSpeaker() {

    state.speakerOn =
      !state.speakerOn;


    dispatch(
      "neyo:voice-speaker",
      {
        enabled:
          state.speakerOn
      }
    );


    if (!state.speakerOn) {

      setStatus(
        "Audio off"
      );

    } else {

      setStatus(
        "Ready"
      );
    }


    syncControls();
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


    state.open =
      true;


    shell.classList.add(
      "is-open"
    );


    shell.setAttribute(
      "aria-hidden",
      "false"
    );


    setStatus(
      "Ready",
      {
        immediate:
          true
      }
    );


    dispatch(
      "neyo:voice-open"
    );


    syncControls();


    requestAnimationFrame(
      () => {
        stage?.focus?.();
      }
    );


    console.log(
      "[NEYO Voice Mode] Open"
    );
  }


  /* =====================================================
     CLOSE
     ===================================================== */

  async function close(
    options = {}
  ) {

    if (
      !state.open ||
      state.closing
    ) {
      return;
    }


    state.closing =
      true;


    stopCamera();


    dispatch(
      "neyo:voice-close"
    );


    if (
      options.stopVoice !==
      false
    ) {

      try {

        await window
          .NeyoVoice
          ?.stop?.();

      } catch (error) {

        console.warn(
          "[NEYO Voice Mode] Voice stop failed:",
          error
        );
      }
    }


    shell.classList.remove(
      "is-open"
    );


    shell.setAttribute(
      "aria-hidden",
      "true"
    );


    setTimeout(
      () => {

        state.open =
          false;

        state.closing =
          false;

        state.muted =
          false;

        state.speakerOn =
          true;


        syncControls();


        setStatus(
          "Ready",
          {
            immediate:
              true
          }
        );

      },
      240
    );


    console.log(
      "[NEYO Voice Mode] Closed"
    );
  }


  /* =====================================================
     END SESSION
     ===================================================== */

  async function endSession() {

    await close({
      stopVoice:
        true
    });
  }


  /* =====================================================
     VOICE STATE BRIDGE
     ===================================================== */

  window.addEventListener(
    "neyo:voice-listening",
    () => {
      if (!state.open) return;

      setStatus(
        state.muted
          ? "Microphone muted"
          : "Listening…"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-thinking",
    () => {
      if (!state.open) return;

      setStatus(
        "Thinking…"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-speaking",
    () => {
      if (!state.open) return;

      setStatus(
        "NEYO is speaking"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-interrupted",
    () => {
      if (!state.open) return;

      setStatus(
        "Listening…"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-error",
    () => {
      if (!state.open) return;

      setStatus(
        "Something went wrong"
      );
    }
  );


  /* =====================================================
     BUTTON EVENTS
     ===================================================== */

  micBtn?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      toggleMic();
    }
  );


  cameraBtn?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      toggleCamera();
    }
  );


  speakerBtn?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      toggleSpeaker();
    }
  );


  endBtn?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      endSession();
    }
  );


  /* =====================================================
     KEYBOARD
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {

      if (
        !state.open
      ) {
        return;
      }


      if (
        event.key ===
        "Escape"
      ) {

        event.preventDefault();

        endSession();
      }
    }
  );


  /* =====================================================
     PAGE CLEANUP
     ===================================================== */

  window.addEventListener(
    "pagehide",
    () => {

      stopCamera();

    },
    {
      once:
        true
    }
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  window.NeyoVoiceMode =
    Object.freeze({

      open,

      close,

      end:
        endSession,

      toggleMic,

      toggleSpeaker,

      toggleCamera,

      setStatus,

      isOpen:
        () => state.open,

      getState:
        () => ({
          ...state,
          cameraStream:
            undefined
        })
    });


  /* =====================================================
     INIT
     ===================================================== */

  syncControls();


  shell.setAttribute(
    "aria-hidden",
    "true"
  );


  console.log(
    "[NEYO Voice Mode] Controller loaded"
  );

})();
