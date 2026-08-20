/*
=========================================================
NEYO — VOICE MODE UI v3

Owns:
- voice mode open / close
- premium status transitions
- mic button
- speaker button
- camera button + preview
- end button
- keyboard escape
- focus handling
- UI-only state

Does NOT own:
- Gemini
- WebSocket
- VAD
- mascot mood logic
- mascot motion
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
    open:
      false,

    closing:
      false,

    phase:
      "idle",

    muted:
      false,

    speakerOn:
      true,

    cameraOn:
      false,

    cameraStream:
      null,

    lastFocusedElement:
      null,

    status:
      "Ready"
  };


  let statusTimer =
    0;

  let closeTimer =
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
        { detail }
      )
    );
  }


  function safeFocus(element) {
    try {
      element?.focus?.({
        preventScroll:
          true
      });
    } catch {}
  }


  /* =====================================================
     STATUS
     ===================================================== */

  const STATUS_MAP =
    Object.freeze({

      idle:
        "Ready",

      listening:
        "Listening…",

      thinking:
        "Thinking…",

      speaking:
        "NEYO is speaking",

      interrupted:
        "Listening…",

      error:
        "Something went wrong"
    });


  function setStatus(
    text,
    {
      immediate = false
    } = {}
  ) {

    const value =
      String(
        text || ""
      ).trim();

    if (!value) {
      return;
    }


    state.status =
      value;


    if (!statusEl) {
      return;
    }


    clearTimeout(
      statusTimer
    );


    if (
      immediate ||
      statusEl.textContent ===
        value
    ) {

      statusEl.classList.remove(
        "is-leaving",
        "is-entering"
      );

      statusEl.textContent =
        value;

      return;
    }


    statusEl.classList.add(
      "is-leaving"
    );


    statusTimer =
      setTimeout(
        () => {

          statusEl.textContent =
            value;

          statusEl.classList.remove(
            "is-leaving"
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
        90
      );
  }


  function syncStatus() {

    if (state.muted) {

      setStatus(
        "Microphone muted"
      );

      return;
    }


    if (!state.speakerOn) {

      setStatus(
        "Audio off"
      );

      return;
    }


    setStatus(
      STATUS_MAP[state.phase] ||
      "Ready"
    );
  }


  /* =====================================================
     ICONS
     ===================================================== */

  function renderMicIcon() {

    if (!micBtn) {
      return;
    }


    micBtn.innerHTML =
      state.muted
        ? `
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 9v3a3 3 0 0 0 4.2 2.75"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <path d="M15 9V5a3 3 0 0 0-6 0v1"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <path d="M5 5l14 14"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <path d="M5 11a7 7 0 0 0 11.2 5.6"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <path d="M12 19v3"
              stroke="currentColor"
              stroke-width="1.8"
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
              stroke-width="1.8"
            />
            <path
              d="M5 11a7 7 0 0 0 14 0"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <path
              d="M12 18v4"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        `;
  }


  function renderSpeakerIcon() {

    if (!speakerBtn) {
      return;
    }


    speakerBtn.innerHTML =
      state.speakerOn
        ? `
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 10v4h4l5 4V6l-5 4H5Z"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
            <path
              d="M17 9a4 4 0 0 1 0 6"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        `
        : `
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 10v4h4l5 4V6l-5 4H5Z"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
            <path
              d="M17 9l4 6"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <path
              d="M21 9l-4 6"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        `;
  }


  function renderCameraIcon() {

    if (!cameraBtn) {
      return;
    }


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
              stroke-width="1.8"
            />
            <path
              d="M16 10l5-3v10l-5-3"
              stroke="currentColor"
              stroke-width="1.8"
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
              stroke-width="1.8"
            />
            <path
              d="M16 10l5-3v10l-5-3"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
            <path
              d="M4 4l16 16"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        `;
  }


  function renderEndIcon() {

    if (!endBtn) {
      return;
    }


    endBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M7 7l10 10"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
        />
        <path
          d="M17 7L7 17"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
        />
      </svg>
    `;
  }


  /* =====================================================
     CONTROLS
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


    renderMicIcon();
    renderSpeakerIcon();
    renderCameraIcon();
    renderEndIcon();
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


    clearTimeout(
      closeTimer
    );


    state.open =
      true;

    state.phase =
      "idle";

    state.lastFocusedElement =
      document.activeElement;


    shell.classList.add(
      "is-open"
    );


    shell.classList.remove(
      "is-closing"
    );


    shell.setAttribute(
      "aria-hidden",
      "false"
    );


    document.documentElement
      .classList
      .add(
        "neyo-voice-mode-open"
      );


    setStatus(
      "Ready",
      {
        immediate:
          true
      }
    );


    syncControls();


    dispatch(
      "neyo:voice-open"
    );


    requestAnimationFrame(
      () => {

        shell.classList.add(
          "is-visible"
        );


        safeFocus(
          endBtn ||
          stage
        );
      }
    );


    console.log(
      "[NEYO Voice Mode] Open"
    );
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


      cameraPreview
        ?.classList
        .add(
          "is-visible"
        );


      cameraPreview
        ?.setAttribute(
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

      console.warn(
        "[NEYO Voice Mode] Camera failed:",
        error
      );


      state.cameraStream =
        null;

      state.cameraOn =
        false;


      cameraPreview
        ?.classList
        .remove(
          "is-visible"
        );


      cameraPreview
        ?.setAttribute(
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
        of state.cameraStream
          .getTracks()
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


    cameraPreview
      ?.classList
      .remove(
        "is-visible"
      );


    cameraPreview
      ?.setAttribute(
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
     MIC
     ===================================================== */

  function toggleMic() {

    state.muted =
      !state.muted;


    try {

      window
        .NeyoVoice
        ?.setMuted
        ?.(
          state.muted
        );

    } catch (error) {

      console.warn(
        "[NEYO Voice Mode] Mic hook failed:",
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

    syncStatus();
  }


  /* =====================================================
     SPEAKER
     ===================================================== */

  function toggleSpeaker() {

    state.speakerOn =
      !state.speakerOn;


    try {

      window
        .NeyoVoice
        ?.setSpeakerEnabled
        ?.(
          state.speakerOn
        );

    } catch (error) {

      console.warn(
        "[NEYO Voice Mode] Speaker hook failed:",
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

    syncStatus();
  }


  /* =====================================================
     CLOSE
     ===================================================== */

  async function close(
    {
      stopVoice = true,
      emitClose = true
    } = {}
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


    if (emitClose) {

      dispatch(
        "neyo:voice-close"
      );
    }


    if (stopVoice) {

      try {

        await window
          .NeyoVoice
          ?.stop
          ?.();

      } catch (error) {

        console.warn(
          "[NEYO Voice Mode] Voice stop failed:",
          error
        );
      }
    }


    shell.classList.add(
      "is-closing"
    );


    shell.classList.remove(
      "is-visible"
    );


    clearTimeout(
      closeTimer
    );


    closeTimer =
      setTimeout(
        () => {

          shell.classList.remove(
            "is-open",
            "is-closing"
          );


          shell.setAttribute(
            "aria-hidden",
            "true"
          );


          document.documentElement
            .classList
            .remove(
              "neyo-voice-mode-open"
            );


          state.open =
            false;

          state.closing =
            false;

          state.phase =
            "idle";

          state.muted =
            false;

          state.speakerOn =
            true;


          setStatus(
            "Ready",
            {
              immediate:
                true
            }
          );


          syncControls();


          safeFocus(
            state.lastFocusedElement
          );


          state.lastFocusedElement =
            null;

        },
        240
      );


    console.log(
      "[NEYO Voice Mode] Close"
    );
  }


  async function endSession() {

    await close({
      stopVoice:
        true
    });
  }


  /* =====================================================
     PHASE SYNC
     ===================================================== */

  function setPhase(
    phase
  ) {

    state.phase =
      phase;


    shell.dataset.phase =
      phase;


    syncStatus();
  }


  window.addEventListener(
    "neyo:voice-idle",
    () => {

      setPhase(
        "idle"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-listening",
    () => {

      setPhase(
        "listening"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-thinking",
    () => {

      setPhase(
        "thinking"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-speaking",
    () => {

      setPhase(
        "speaking"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-interrupted",
    () => {

      setPhase(
        "interrupted"
      );
    }
  );


  window.addEventListener(
    "neyo:voice-error",
    () => {

      setPhase(
        "error"
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

      event.stopPropagation();

      toggleMic();
    }
  );


  speakerBtn?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      event.stopPropagation();

      toggleSpeaker();
    }
  );


  cameraBtn?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      event.stopPropagation();

      toggleCamera();
    }
  );


  endBtn?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      event.stopPropagation();

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

      setPhase,

      isOpen:
        () =>
          state.open,

      getState:
        () => ({
          open:
            state.open,

          closing:
            state.closing,

          phase:
            state.phase,

          muted:
            state.muted,

          speakerOn:
            state.speakerOn,

          cameraOn:
            state.cameraOn,

          status:
            state.status
        })
    });


  /* =====================================================
     INIT
     ===================================================== */

  shell.setAttribute(
    "aria-hidden",
    "true"
  );


  shell.dataset.phase =
    "idle";


  cameraPreview
    ?.setAttribute(
      "aria-hidden",
      "true"
    );


  syncControls();


  setStatus(
    "Ready",
    {
      immediate:
        true
    }
  );


  console.log(
    "[NEYO Voice Mode] Premium UI v3 loaded"
  );

})();
