/*
=========================================================
NEYO — VOICE MODE UI v4
ERROR SAFE + HOT CHARACTER SWITCH AWARE

Owns:
- voice mode open / close
- status transitions
- mic control
- speaker control
- camera control
- character switch status
- connection error status
- end button
- keyboard escape
- focus handling

Does NOT own:
- Gemini connection
- character voice selection
- VAD
- mascot mood intelligence
- mascot rendering

Important:
- Voice errors DO NOT auto-close screen
- Character hot switch DOES NOT close screen
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     DOM
     ===================================================== */

  const shell =
    document.getElementById(
      "neyoVoiceMode"
    );

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

    switchingCharacter:
      false,

    character:
      "neyo",

    voice:
      "Kore",

    error:
      null,

    status:
      "Ready",

    lastFocusedElement:
      null
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
        {
          detail
        }
      )
    );
  }


  function safeFocus(
    element
  ) {

    try {

      element?.focus?.({
        preventScroll:
          true
      });

    } catch {}
  }


  function capitalize(
    value
  ) {

    const text =
      String(
        value || ""
      );


    if (!text) {
      return "";
    }


    return (
      text.charAt(0)
        .toUpperCase() +
      text.slice(1)
    );
  }


  /* =====================================================
     STATUS MAP
     ===================================================== */

  const STATUS_MAP =
    Object.freeze({

      idle:
        "Ready",

      connecting:
        "Connecting…",

      listening:
        "Listening…",

      thinking:
        "Thinking…",

      speaking:
        "Speaking…",

      interrupted:
        "Listening…",

      switching:
        "Switching character…",

      error:
        "Couldn't connect"
    });


  /* =====================================================
     STATUS RENDER
     ===================================================== */

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


  /* =====================================================
     STATUS RESOLUTION
     ===================================================== */

  function syncStatus() {

    if (state.error) {

      setStatus(
        state.error
      );

      return;
    }


    if (
      state.switchingCharacter
    ) {

      setStatus(
        `Switching to ${capitalize(
          state.character
        )}…`
      );

      return;
    }


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


    if (
      state.phase ===
      "speaking"
    ) {

      setStatus(
        `${
          capitalize(
            state.character
          ) ||
          "NEYO"
        } is speaking`
      );

      return;
    }


    setStatus(
      STATUS_MAP[
        state.phase
      ] ||
      "Ready"
    );
  }


  /* =====================================================
     PHASE
     ===================================================== */

  function setPhase(
    phase,
    detail = {}
  ) {

    state.phase =
      phase;


    shell.dataset.phase =
      phase;


    if (
      phase !==
      "error"
    ) {

      state.error =
        null;
    }


    if (
      detail.character
    ) {

      state.character =
        detail.character;
    }


    if (
      detail.voice
    ) {

      state.voice =
        detail.voice;
    }


    syncStatus();
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
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M9 9v3a3 3 0 0 0 4.2 2.75"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />

            <path
              d="M15 9V5a3 3 0 0 0-6 0v1"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />

            <path
              d="M5 5l14 14"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />

            <path
              d="M5 11a7 7 0 0 0 11.2 5.6"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />

            <path
              d="M12 19v3"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        `

        : `
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
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
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
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
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
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
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
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
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
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
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
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
        String(
          !state.muted
        )
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
        String(
          state.speakerOn
        )
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
        String(
          state.cameraOn
        )
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
      "connecting";


    state.error =
      null;


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


    shell.dataset.phase =
      "connecting";


    document
      .documentElement
      .classList
      .add(
        "neyo-voice-mode-open"
      );


    setStatus(
      "Connecting…",
      {
        immediate:
          true
      }
    );


    syncControls();


    dispatch(
      "neyo:voice-mode-open"
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


      syncStatus();


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
        of state
          .cameraStream
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
        "[NEYO Voice Mode] Mic control failed:",
        error
      );
    }


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
        "[NEYO Voice Mode] Speaker control failed:",
        error
      );
    }


    syncControls();

    syncStatus();
  }


  /* =====================================================
     CLOSE

     Only USER ending conversation should
     normally call this.

     Errors and character switches do NOT.
     ===================================================== */

  async function close({
    stopVoice = true,
    emitClose = true
  } = {}) {

    if (
      !state.open ||
      state.closing
    ) {
      return;
    }


    state.closing =
      true;


    /*
    Full voice-mode exit:
    camera should stop.
    */

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
          ?.({
            closeUi:
              false
          });

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


          shell.dataset.phase =
            "idle";


          document
            .documentElement
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


          state.error =
            null;


          state.switchingCharacter =
            false;


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
  }


  async function endSession() {

    await close({
      stopVoice:
        true,

      emitClose:
        true
    });
  }


  /* =====================================================
     VOICE STATE EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:voice-idle",
    event => {

      state.switchingCharacter =
        false;


      setPhase(
        "idle",
        event.detail
      );
    }
  );


  window.addEventListener(
    "neyo:voice-listening",
    event => {

      state.switchingCharacter =
        false;


      setPhase(
        "listening",
        event.detail
      );
    }
  );


  window.addEventListener(
    "neyo:voice-thinking",
    event => {

      if (
        event
          ?.detail
          ?.switching
      ) {

        state.switchingCharacter =
          true;
      }


      setPhase(
        "thinking",
        event.detail
      );
    }
  );


  window.addEventListener(
    "neyo:voice-speaking",
    event => {

      state.switchingCharacter =
        false;


      setPhase(
        "speaking",
        event.detail
      );
    }
  );


  window.addEventListener(
    "neyo:voice-interrupted",
    event => {

      setPhase(
        "interrupted",
        event.detail
      );
    }
  );


  /* =====================================================
     CONNECTION ERROR

     IMPORTANT:
     NEVER close voice mode here.
     ===================================================== */

  window.addEventListener(
    "neyo:voice-error",
    event => {

      state.phase =
        "error";


      state.switchingCharacter =
        false;


      state.error =
        String(
          event
            ?.detail
            ?.message ||
          "Couldn't connect"
        );


      shell.dataset.phase =
        "error";


      setStatus(
        state.error
      );


      syncControls();
    }
  );


  window.addEventListener(
    "neyo:voice-start-error",
    event => {

      state.phase =
        "error";


      state.error =
        String(
          event
            ?.detail
            ?.message ||
          "Couldn't connect"
        );


      shell.dataset.phase =
        "error";


      setStatus(
        state.error
      );
    }
  );


  /* =====================================================
     HOT CHARACTER SWITCH
     ===================================================== */

  window.addEventListener(
    "neyo:voice-character-switching",
    event => {

      state.switchingCharacter =
        true;


      state.error =
        null;


      if (
        event
          ?.detail
          ?.character
      ) {

        state.character =
          event.detail.character;
      }


      if (
        event
          ?.detail
          ?.voice
      ) {

        state.voice =
          event.detail.voice;
      }


      shell.dataset.phase =
        "switching";


      shell.dataset.character =
        state.character;


      setStatus(
        `Switching to ${
          capitalize(
            state.character
          )
        }…`
      );
    }
  );


  window.addEventListener(
    "neyo:voice-character-ready",
    event => {

      state.switchingCharacter =
        false;


      state.error =
        null;


      if (
        event
          ?.detail
          ?.character
      ) {

        state.character =
          event.detail.character;
      }


      if (
        event
          ?.detail
          ?.voice
      ) {

        state.voice =
          event.detail.voice;
      }


      shell.dataset.character =
        state.character;


      if (
        event
          ?.detail
          ?.live
      ) {

        setPhase(
          "listening",
          event.detail
        );

      } else {

        syncStatus();
      }
    }
  );


  window.addEventListener(
    "neyo:voice-character-error",
    event => {

      state.switchingCharacter =
        false;


      state.phase =
        "error";


      state.error =
        String(
          event
            ?.detail
            ?.message ||
          "Couldn't switch character"
        );


      shell.dataset.phase =
        "error";


      setStatus(
        state.error
      );
    }
  );


  /* =====================================================
     GENERAL CHARACTER CHANGE

     Instantly update visible identity.
     Actual audio switching remains voice.js job.
     ===================================================== */

  window.addEventListener(
    "neyo:character-change",
    event => {

      const id =
        event
          ?.detail
          ?.id;


      if (!id) {
        return;
      }


      state.character =
        id;


      shell.dataset.character =
        id;
    }
  );


  /* =====================================================
     CONTROL EVENTS
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
     ESCAPE

     Let voice-mode own UI exit.
     voice.js also hears Escape, so stopping
     functions must remain idempotent.
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {

      if (!state.open) {
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

          character:
            state.character,

          voice:
            state.voice,

          switchingCharacter:
            state.switchingCharacter,

          muted:
            state.muted,

          speakerOn:
            state.speakerOn,

          cameraOn:
            state.cameraOn,

          error:
            state.error,

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


  shell.dataset.character =
    window
      .NeyoCharacters
      ?.active ||
    "neyo";


  state.character =
    shell.dataset.character;


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
    "[NEYO Voice Mode] Error-safe hot-switch UI v4 ready"
  );

})();
