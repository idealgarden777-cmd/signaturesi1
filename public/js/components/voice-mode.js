/*
=========================================================
NEYO — VOICE MODE CONTROLLER
Production UI Controller

Owns:
- open / close voice screen
- status text
- mic button UI
- speaker button UI
- camera toggle + preview
- end button
- mascot UI events
- graceful engine hooks

Does NOT own:
- Gemini WebSocket
- PCM microphone streaming
- native audio playback
- VAD logic
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
    shell?.querySelector(".voice-mode-stage");

  const statusEl =
    document.getElementById("neyoMascotStatus");

  const micBtn =
    document.getElementById("voiceModeMicBtn");

  const cameraBtn =
    document.getElementById("voiceModeCameraBtn");

  const speakerBtn =
    document.getElementById("voiceModeSpeakerBtn");

  const endBtn =
    document.getElementById("voiceModeEndBtn");

  const cameraPreview =
    document.getElementById("neyoCameraPreview");

  const cameraVideo =
    document.getElementById("neyoCameraVideo");


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
    closing: false,

    muted: false,
    speakerOn: true,

    cameraOn: false,
    cameraStream: null,

    currentPhase: "idle",
    currentStatus: "Ready"
  };


  let statusTimer = 0;


  /* =====================================================
     EVENT HELPER
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


  /* =====================================================
     STATUS
     ===================================================== */

  function setStatus(
    text,
    options = {}
  ) {
    if (!text) return;


    state.currentStatus =
      text;


    if (!statusEl) {
      return;
    }


    clearTimeout(
      statusTimer
    );


    if (
      options.immediate ||
      statusEl.textContent === text
    ) {
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
        110
      );
  }


  /* =====================================================
     STATUS FROM PHASE
     ===================================================== */

  function syncStatusFromPhase() {
    if (state.muted) {
      setStatus(
        "Microphone muted"
      );

      return;
    }


    switch (state.currentPhase) {
      case "listening":
        setStatus(
          "Listening…"
        );
        break;


      case "thinking":
        setStatus(
          "Thinking…"
        );
        break;


      case "speaking":
        setStatus(
          "NEYO is speaking"
        );
        break;


      case "interrupted":
        setStatus(
          "Listening…"
        );
        break;


      case "error":
        setStatus(
          "Something went wrong"
        );
        break;


      case "idle":
      default:
        setStatus(
          "Ready"
        );
    }
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
              <path d="M9 9v3a3 3 0 0 0 4.8 2.4"
                stroke="currentColor"
                stroke-linecap="round"
              />
              <path d="M15 9V5a3 3 0 0 0-6 0v1"
                stroke="currentColor"
                stroke-linecap="round"
              />
              <path d="M5 5l14 14"
                stroke="currentColor"
                stroke-linecap="round"
              />
              <path d="M5 11a7 7 0 0 0 11 5.7"
                stroke="currentColor"
                stroke-linecap="round"
              />
              <path d="M12 19v3"
                stroke="currentColor"
                stroke-linecap="round"
              />
            </svg>
          `
          : `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="9"
                y="3"
                width="6"
                height="11"
                rx="3"
                stroke="currentColor"
              />
              <path
                d="M5 11a7 7 0 0 0 14 0"
                stroke="currentColor"
                stroke-linecap="round"
              />
              <path
                d="M12 18v4"
                stroke="currentColor"
                stroke-linecap="round"
              />
            </svg>
          `;
    }


    if (cameraBtn) {
      cameraBtn.innerHTML =
        state.cameraOn
          ? `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="3"
                y="6"
                width="13"
                height="12"
                rx="3"
                stroke="currentColor"
              />
              <path
                d="M16 10l5-3v10l-5-3"
                stroke="currentColor"
                stroke-linejoin="round"
              />
            </svg>
          `
          : `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="3"
                y="6"
                width="13"
                height="12"
                rx="3"
                stroke="currentColor"
              />
              <path
                d="M16 10l5-3v10l-5-3"
                stroke="currentColor"
                stroke-linejoin="round"
              />
              <path
                d="M4 4l16 16"
                stroke="currentColor"
                stroke-linecap="round"
              />
            </svg>
          `;
    }


    if (speakerBtn) {
      speakerBtn.innerHTML =
        state.speakerOn
          ? `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 10v4h4l5 4V6l-5 4H5Z"
                stroke="currentColor"
                stroke-linejoin="round"
              />
              <path
                d="M17 9a4 4 0 0 1 0 6"
                stroke="currentColor"
                stroke-linecap="round"
              />
            </svg>
          `
          : `
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 10v4h4l5 4V6l-5 4H5Z"
                stroke="currentColor"
                stroke-linejoin="round"
              />
              <path
                d="M17 9l4 6"
                stroke="currentColor"
                stroke-linecap="round"
              />
              <path
                d="M21 9l-4 6"
                stroke="currentColor"
                stroke-linecap="round"
              />
            </svg>
          `;
    }


    if (endBtn) {
      endBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 7l14 14"
            stroke="currentColor"
            stroke-linecap="round"
          />
          <path
            d="M19 7L5 21"
            stroke="currentColor"
            stroke-linecap="round"
          />
        </svg>
      `;
    }
  }


  /* =====================================================
     CONTROL UI
     ===================================================== */

  function syncControls() {

    if (micBtn) {
      micBtn.classList.toggle(
        "is-active",
        !state.muted
      );

      micBtn.classList.toggle(
        "is-muted",
        state.muted
      );

      micBtn.setAttribute(
        "aria-pressed",
        String(!state.muted)
      );

      micBtn.setAttribute(
        "aria-label",
        state.muted
          ? "Unmute microphone"
          : "Mute microphone"
      );
    }


    if (speakerBtn) {
      speakerBtn.classList.toggle(
        "is-active",
        state.speakerOn
      );

      speakerBtn.classList.toggle(
        "is-muted",
        !state.speakerOn
      );

      speakerBtn.setAttribute(
        "aria-pressed",
        String(state.speakerOn)
      );

      speakerBtn.setAttribute(
        "aria-label",
        state.speakerOn
          ? "Turn speaker off"
          : "Turn speaker on"
      );
    }


    if (cameraBtn) {
      cameraBtn.classList.toggle(
        "is-active",
        state.cameraOn
      );

      cameraBtn.setAttribute(
        "aria-pressed",
        String(state.cameraOn)
      );

      cameraBtn.setAttribute(
        "aria-label",
        state.cameraOn
          ? "Turn camera off"
          : "Turn camera on"
      );
    }


    renderIcons();
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


    state.currentPhase =
      "idle";


    setStatus(
      "Ready",
      {
        immediate: true
      }
    );


    syncControls();


    dispatch(
      "neyo:voice-open"
    );


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


    if (
      options.emitClose !==
      false
    ) {
      dispatch(
        "neyo:voice-close"
      );
    }


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

        state.currentPhase =
          "idle";


        syncControls();


        setStatus(
          "Ready",
          {
            immediate: true
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
     MIC
     ===================================================== */

  function toggleMic() {

    state.muted =
      !state.muted;


    /*
    Actual engine integration hook.
    voice.js may expose setMuted() later.
    */

    try {
      window
        .NeyoVoice
        ?.setMuted
        ?.(
          state.muted
        );
    } catch (error) {
      console.warn(
        "[NEYO Voice Mode] Mic toggle hook failed:",
        error
      );
    }


    dispatch(
      "neyo:voice-muted",
      {
        muted:
          state.muted
      }
    );


    syncControls();

    syncStatusFromPhase();
  }


  /* =====================================================
     SPEAKER
     ===================================================== */

  function toggleSpeaker() {

    state.speakerOn =
      !state.speakerOn;


    /*
    Actual engine integration hook.
    voice.js may expose setSpeakerEnabled() later.
    */

    try {
      window
        .NeyoVoice
        ?.setSpeakerEnabled
        ?.(
          state.speakerOn
        );
    } catch (error) {
      console.warn(
        "[NEYO Voice Mode] Speaker toggle hook failed:",
        error
      );
    }


    dispatch(
      "neyo:voice-speaker",
      {
        enabled:
          state.speakerOn
      }
    );


    syncControls();


    if (!state.speakerOn) {
      setStatus(
        "Audio off"
      );

    } else {
      syncStatusFromPhase();
    }
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


    if (
      !navigator
        .mediaDevices
        ?.getUserMedia
    ) {
      setStatus(
        "Camera unavailable"
      );

      return false;
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


      cameraPreview?.setAttribute(
        "aria-hidden",
        "false"
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

      state.cameraStream =
        null;


      cameraPreview?.classList.remove(
        "is-visible"
      );


      cameraPreview?.setAttribute(
        "aria-hidden",
        "true"
      );


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


    cameraPreview?.setAttribute(
      "aria-hidden",
      "true"
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
     END SESSION
     ===================================================== */

  async function endSession() {

    await close({
      stopVoice:
        true
    });
  }


  /* =====================================================
     VOICE STATE EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:voice-idle",
    () => {
      state.currentPhase =
        "idle";

      syncStatusFromPhase();
    }
  );


  window.addEventListener(
    "neyo:voice-listening",
    () => {
      state.currentPhase =
        "listening";

      syncStatusFromPhase();
    }
  );


  window.addEventListener(
    "neyo:voice-thinking",
    () => {
      state.currentPhase =
        "thinking";

      syncStatusFromPhase();
    }
  );


  window.addEventListener(
    "neyo:voice-speaking",
    () => {
      state.currentPhase =
        "speaking";

      syncStatusFromPhase();
    }
  );


  window.addEventListener(
    "neyo:voice-interrupted",
    () => {
      state.currentPhase =
        "interrupted";

      syncStatusFromPhase();
    }
  );


  window.addEventListener(
    "neyo:voice-error",
    () => {
      state.currentPhase =
        "error";

      syncStatusFromPhase();
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


  speakerBtn?.addEventListener(
    "click",
    event => {
      event.preventDefault();

      toggleSpeaker();
    }
  );


  cameraBtn?.addEventListener(
    "click",
    event => {
      event.preventDefault();

      toggleCamera();
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
     ESCAPE
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {

      if (
        !state.open ||
        event.key !==
          "Escape"
      ) {
        return;
      }


      event.preventDefault();

      endSession();
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
      once: true
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
          open:
            state.open,

          closing:
            state.closing,

          muted:
            state.muted,

          speakerOn:
            state.speakerOn,

          cameraOn:
            state.cameraOn,

          currentPhase:
            state.currentPhase,

          currentStatus:
            state.currentStatus
        })
    });


  /* =====================================================
     INIT
     ===================================================== */

  shell.setAttribute(
    "aria-hidden",
    "true"
  );


  cameraPreview?.setAttribute(
    "aria-hidden",
    "true"
  );


  syncControls();


  console.log(
    "[NEYO Voice Mode] Production controller loaded"
  );

})();
