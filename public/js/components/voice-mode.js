(() => {
  "use strict";

  const VERSION = "neyo-voice-mode-clean-v4";
  if (window.NeyoVoiceMode?.__controller) return;

  const $ = id => document.getElementById(id);

  const shell = $("neyoVoiceMode");
  const stage =
    shell?.querySelector(".voice-mode-stage");

  const mascotSlot =
    shell?.querySelector(".voice-mode-mascot-slot");

  const mascot = $("neyoMascot");
  const status = $("neyoMascotStatus");

  const micBtn = $("voiceModeMicBtn");
  const cameraBtn = $("voiceModeCameraBtn");
  const speakerBtn = $("voiceModeSpeakerBtn");
  const characterBtn = $("characterPickerBtn");
  const endBtn = $("voiceModeEndBtn");

  const cameraPreview =
    $("neyoCameraPreview");

  const cameraVideo =
    $("neyoCameraVideo");

  const characterPicker =
    $("characterPicker");


  if (!shell || !stage) {
    console.warn(
      "[NEYO Voice Mode] Required DOM is missing."
    );

    return;
  }


  /* =====================================================
     STATE
     ===================================================== */

  const STATES =
    new Set([
      "idle",
      "listening",
      "thinking",
      "speaking"
    ]);


  const LABELS =
    Object.freeze({
      idle:
        "Ready",

      listening:
        "Listening…",

      thinking:
        "Thinking…",

      speaking:
        "Speaking…"
    });


  let phase =
    "idle";

  let micMuted =
    false;

  let speakerEnabled =
    true;

  let cameraEnabled =
    false;

  let cameraPending =
    false;

  let cameraStream =
    null;

  let energy =
    0;

  let waveRaf =
    0;

  let previousFocus =
    null;


  const emit =
    (
      name,
      detail = {}
    ) =>

      window.dispatchEvent(
        new CustomEvent(
          name,
          {
            detail
          }
        )
      );


  /* =====================================================
     WAVEFORM
     ===================================================== */

  function ensureWaveform() {

    let root =
      shell.querySelector(
        ".voice-mode-waveform"
      );


    if (root) {
      return root;
    }


    root =
      document.createElement(
        "div"
      );


    root.className =
      "voice-mode-waveform";


    root.setAttribute(
      "aria-hidden",
      "true"
    );


    for (
      let i = 0;
      i < 9;
      i += 1
    ) {

      root.appendChild(
        document.createElement(
          "span"
        )
      );
    }


    if (
      status?.parentNode ===
      stage
    ) {

      stage.insertBefore(
        root,
        status
      );

    } else if (
      mascotSlot
    ) {

      mascotSlot.after(
        root
      );

    } else {

      stage.prepend(
        root
      );
    }


    /*
     * voice-mode.css already contains
     * a fallback waveform.
     *
     * Once real audio-energy bars exist,
     * hide only that fallback.
     */

    if (
      !$(
        "neyoVoiceLiveWaveCompat"
      )
    ) {

      const style =
        document.createElement(
          "style"
        );


      style.id =
        "neyoVoiceLiveWaveCompat";


      style.textContent =
        ".voice-mode-shell[data-live-waveform='true'] .voice-mode-mascot-slot::after{display:none!important}";


      document.head.appendChild(
        style
      );
    }


    shell.dataset.liveWaveform =
      "true";


    return root;
  }


  const waveform =
    ensureWaveform();


  const waveBars =
    () =>
      Array.from(
        waveform
          ?.querySelectorAll(
            "span"
          ) ||
        []
      );


  function resetWaveform() {

    energy =
      0;


    for (
      const bar
      of waveBars()
    ) {

      bar.style.transform =
        "scaleY(.45)";


      bar.style.opacity =
        ".2";
    }
  }


  function paintWaveform() {

    waveRaf =
      0;


    const bars =
      waveBars();


    if (!bars.length) {
      return;
    }


    const active =
      phase === "listening" ||
      phase === "speaking";


    const base =
      phase === "thinking"
        ? 0.08
        : active
          ? 0.14
          : 0;


    const level =
      Math.max(
        base,
        Math.min(
          1,
          energy
        )
      );


    const center =
      (
        bars.length -
        1
      ) / 2;


    const now =
      performance.now();


    bars.forEach(
      (
        bar,
        index
      ) => {

        const distance =
          Math.abs(
            index -
            center
          ) /
          Math.max(
            1,
            center
          );


        const weight =
          1 -
          distance *
          0.42;


        const motion =
          0.9 +
          Math.sin(
            now *
              0.01 +
            index *
              0.82
          ) *
          0.1;


        const currentEnergy =
          Math.max(
            0,
            Math.min(
              1,
              level *
              weight *
              motion
            )
          );


        const scale =
          phase === "idle"
            ? 0.45
            : 0.45 +
              currentEnergy *
              2.4;


        bar.style.transform =
          `scaleY(${
            scale.toFixed(3)
          })`;


        bar.style.opacity =
          phase === "idle"
            ? ".18"
            : `${
                (
                  0.22 +
                  currentEnergy *
                  0.68
                )
                  .toFixed(3)
              }`;
      }
    );
  }


  function setEnergy(
    value
  ) {

    const number =
      Number(
        value
      );


    if (
      !Number.isFinite(
        number
      )
    ) {
      return;
    }


    const next =
      Math.max(
        0,
        Math.min(
          1,
          number
        )
      );


    energy +=
      (
        next -
        energy
      ) *
      (
        next >
        energy
          ? 0.48
          : 0.2
      );


    if (!waveRaf) {

      waveRaf =
        requestAnimationFrame(
          paintWaveform
        );
    }
  }


  /* =====================================================
     PHASE / MASCOT
     ===================================================== */

  function setState(
    value
  ) {

    phase =
      STATES.has(
        value
      )
        ? value
        : "idle";


    shell.dataset.voiceState =
      phase;


    if (mascot) {

      mascot.dataset.phase =
        phase;


      const visual =
        {
          idle: [
            "friendly",
            "arc",
            "smile"
          ],

          listening: [
            "attentive",
            "open",
            "neutral"
          ],

          thinking: [
            "thinking",
            "half",
            "neutral"
          ],

          speaking: [
            "speaking",
            "open",
            "talk"
          ]
        }[
          phase
        ];


      [
        mascot.dataset.tone,
        mascot.dataset.eye,
        mascot.dataset.mouth
      ] =
        visual;
    }


    if (status) {

      status.textContent =
        LABELS[
          phase
        ];
    }


    if (
      phase ===
      "idle"
    ) {

      resetWaveform();

    } else {

      setEnergy(
        phase ===
          "thinking"
          ? 0.08
          : 0.14
      );
    }


    emit(
      "neyo:voice-mode-state",
      {
        state:
          phase
      }
    );


    return phase;
  }


  /* =====================================================
     OPEN / CLOSE
     ===================================================== */

  const isOpen =
    () =>
      shell.getAttribute(
        "aria-hidden"
      ) ===
      "false";


  function open() {

    if (
      isOpen()
    ) {
      return true;
    }


    previousFocus =
      document.activeElement
        instanceof HTMLElement

        ? document.activeElement

        : null;


    shell.setAttribute(
      "aria-hidden",
      "false"
    );


    shell.style.display =
      "flex";


    document.body
      .classList
      .add(
        "neyo-voice-mode-open"
      );


    requestAnimationFrame(
      () => {

        try {

          micBtn?.focus({
            preventScroll:
              true
          });

        } catch {}
      }
    );


    emit(
      "neyo:voice-mode-opened"
    );


    return true;
  }


  async function close({
    stopVoice = false,
    restoreFocus = true
  } = {}) {

    if (
      stopVoice
    ) {

      try {

        await window
          .NeyoVoice
          ?.stop
          ?.();

      } catch (
        error
      ) {

        console.warn(
          "[NEYO Voice Mode] Voice stop failed:",
          error
        );
      }
    }


    stopCamera();

    closeCharacterPickerVisual();


    shell.setAttribute(
      "aria-hidden",
      "true"
    );


    shell.style.display =
      "none";


    document.body
      .classList
      .remove(
        "neyo-voice-mode-open"
      );


    setState(
      "idle"
    );


    if (
      restoreFocus &&
      previousFocus
        ?.isConnected
    ) {

      try {

        previousFocus
          .focus({
            preventScroll:
              true
          });

      } catch {}
    }


    previousFocus =
      null;


    emit(
      "neyo:voice-mode-closed"
    );


    return true;
  }


  /* =====================================================
     MIC
     ===================================================== */

  function syncMic(
    muted
  ) {

    micMuted =
      Boolean(
        muted
      );


    micBtn
      ?.classList
      .toggle(
        "is-active",
        !micMuted
      );


    micBtn?.setAttribute(
      "aria-pressed",
      String(
        !micMuted
      )
    );


    micBtn?.setAttribute(
      "aria-label",
      micMuted
        ? "Unmute microphone"
        : "Mute microphone"
    );


    if (mascot) {

      mascot.dataset.muted =
        String(
          micMuted
        );
    }
  }


  function toggleMic() {

    const muted =
      !micMuted;


    try {

      window
        .NeyoVoice
        ?.setMuted
        ?.(muted);


      /*
       * Engine also emits
       * neyo:voice-muted.
       *
       * Immediate local sync keeps
       * the control responsive.
       */

      syncMic(
        muted
      );


      emit(
        "neyo:voice-mic-toggle",
        {
          muted
        }
      );


      return true;

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Voice Mode] Mic toggle failed:",
        error
      );


      return false;
    }
  }


  /* =====================================================
     SPEAKER
     ===================================================== */

  function syncSpeaker(
    enabled
  ) {

    speakerEnabled =
      Boolean(
        enabled
      );


    speakerBtn
      ?.classList
      .toggle(
        "is-active",
        speakerEnabled
      );


    speakerBtn?.setAttribute(
      "aria-pressed",
      String(
        speakerEnabled
      )
    );


    speakerBtn?.setAttribute(
      "aria-label",
      speakerEnabled
        ? "Turn speaker off"
        : "Turn speaker on"
    );


    if (mascot) {

      mascot.dataset.speaker =
        speakerEnabled
          ? "on"
          : "off";
    }
  }


  function toggleSpeaker() {

    const enabled =
      !speakerEnabled;


    try {

      window
        .NeyoVoice
        ?.setSpeakerEnabled
        ?.(enabled);


      syncSpeaker(
        enabled
      );


      emit(
        "neyo:voice-speaker-toggle",
        {
          enabled
        }
      );


      return true;

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Voice Mode] Speaker toggle failed:",
        error
      );


      return false;
    }
  }


  /* =====================================================
     CAMERA
     ===================================================== */

  function syncCamera(
    enabled
  ) {

    cameraEnabled =
      Boolean(
        enabled
      );


    cameraBtn
      ?.classList
      .toggle(
        "is-active",
        cameraEnabled
      );


    cameraBtn?.setAttribute(
      "aria-pressed",
      String(
        cameraEnabled
      )
    );


    cameraBtn?.setAttribute(
      "aria-label",
      cameraEnabled
        ? "Turn camera off"
        : "Turn camera on"
    );


    cameraPreview
      ?.setAttribute(
        "aria-hidden",
        String(
          !cameraEnabled
        )
      );


    if (
      cameraPreview
    ) {

      cameraPreview
        .style
        .display =
          cameraEnabled
            ? "block"
            : "none";
    }


    if (mascot) {

      mascot.dataset.camera =
        cameraEnabled
          ? "on"
          : "off";
    }
  }


  function stopCamera() {

    cameraPending =
      false;


    if (
      cameraStream
    ) {

      for (
        const track
        of cameraStream
          .getTracks()
      ) {

        try {
          track.stop();
        } catch {}
      }
    }


    cameraStream =
      null;


    if (
      cameraVideo
    ) {

      try {
        cameraVideo.pause();
      } catch {}


      cameraVideo.srcObject =
        null;
    }


    syncCamera(
      false
    );


    emit(
      "neyo:voice-camera-change",
      {
        enabled:
          false
      }
    );


    return true;
  }


  async function startCamera() {

    if (
      cameraEnabled ||
      cameraPending
    ) {

      return cameraEnabled;
    }


    if (
      !navigator
        .mediaDevices
        ?.getUserMedia
    ) {

      emit(
        "neyo:voice-camera-error",
        {
          error:
            "Camera is not available on this device."
        }
      );


      return false;
    }


    cameraPending =
      true;


    cameraBtn?.setAttribute(
      "aria-busy",
      "true"
    );


    try {

      const stream =
        await navigator
          .mediaDevices
          .getUserMedia({
            audio:
              false,

            video: {
              facingMode:
                "user",

              width: {
                ideal:
                  1280
              },

              height: {
                ideal:
                  720
              }
            }
          });


      /*
       * User may close voice mode
       * while permission dialog is open.
       */

      if (
        !isOpen()
      ) {

        stream
          .getTracks()
          .forEach(
            track =>
              track.stop()
          );


        return false;
      }


      cameraStream =
        stream;


      stream
        .getVideoTracks()[0]
        ?.addEventListener(
          "ended",
          stopCamera,
          {
            once:
              true
          }
        );


      if (
        cameraVideo
      ) {

        cameraVideo.srcObject =
          stream;


        cameraVideo.muted =
          true;


        cameraVideo.playsInline =
          true;


        try {

          await cameraVideo
            .play();

        } catch {}
      }


      syncCamera(
        true
      );


      emit(
        "neyo:voice-camera-change",
        {
          enabled:
            true
        }
      );


      return true;

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Voice Mode] Camera unavailable:",
        error
      );


      stopCamera();


      emit(
        "neyo:voice-camera-error",
        {
          error:
            error?.message ||
            "Camera access failed."
        }
      );


      return false;

    } finally {

      cameraPending =
        false;


      cameraBtn
        ?.removeAttribute(
          "aria-busy"
        );
    }
  }


  async function toggleCamera() {

    if (
      cameraEnabled ||
      cameraPending
    ) {

      stopCamera();

      return false;
    }


    return startCamera();
  }


  /* =====================================================
     CHARACTER PICKER

     IMPORTANT:
     character-picker.js remains the
     sole click/open/selection owner.

     This file only synchronizes UI state.
     ===================================================== */

  const pickerOpen =
    () =>
      characterPicker
        ?.getAttribute(
          "aria-hidden"
        ) ===
      "false";


  function syncCharacterPickerButton() {

    characterBtn
      ?.setAttribute(
        "aria-expanded",
        String(
          pickerOpen()
        )
      );
  }


  function closeCharacterPickerVisual() {

    if (
      !characterPicker
    ) {
      return false;
    }


    /*
     * Prefer picker owner's public API
     * if it exists.
     */

    if (
      typeof window
        .NeyoCharacterPicker
        ?.close ===
      "function"
    ) {

      try {

        window
          .NeyoCharacterPicker
          .close();

        syncCharacterPickerButton();

        return true;

      } catch {}
    }


    /*
     * Safe cleanup fallback.
     */

    characterPicker
      .setAttribute(
        "aria-hidden",
        "true"
      );


    syncCharacterPickerButton();


    return true;
  }


  if (
    characterPicker
  ) {

    new MutationObserver(
      syncCharacterPickerButton
    )
      .observe(
        characterPicker,
        {
          attributes:
            true,

          attributeFilter: [
            "aria-hidden",
            "class"
          ]
        }
      );


    syncCharacterPickerButton();
  }


  /* =====================================================
     END SESSION
     ===================================================== */

  async function endSession() {

    if (
      endBtn
    ) {

      endBtn.disabled =
        true;


      endBtn.setAttribute(
        "aria-busy",
        "true"
      );
    }


    try {

      stopCamera();


      await window
        .NeyoVoice
        ?.stop
        ?.();

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Voice Mode] End failed:",
        error
      );

    } finally {

      await close({
        stopVoice:
          false
      });


      if (
        endBtn
      ) {

        endBtn.disabled =
          false;


        endBtn.removeAttribute(
          "aria-busy"
        );
      }
    }
  }


  /* =====================================================
     BUTTON OWNERSHIP
     ===================================================== */

  micBtn
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();

        toggleMic();
      }
    );


  cameraBtn
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();

        void toggleCamera();
      }
    );


  speakerBtn
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();

        toggleSpeaker();
      }
    );


  endBtn
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();

        void endSession();
      }
    );


  /*
   * Character button intentionally
   * has NO listener here.
   *
   * character-picker.js owns it.
   */


  /* =====================================================
     ESCAPE
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key !==
          "Escape" ||
        !isOpen() ||
        pickerOpen()
      ) {
        return;
      }


      event.preventDefault();


      void endSession();
    }
  );


  /* =====================================================
     CURRENT VOICE ENGINE EVENTS
     ===================================================== */

  [
    "idle",
    "listening",
    "thinking",
    "speaking"
  ]
    .forEach(
      state => {

        window.addEventListener(
          `neyo:voice-${state}`,
          () => {

            setState(
              state
            );


            if (
              state !== "idle" &&
              !isOpen()
            ) {

              open();
            }


            /*
             * Voice mode can open before
             * Gemini setup / mic track /
             * output gain are ready.
             *
             * Re-applying preferences when
             * listening begins guarantees
             * mute/speaker state survives
             * connection setup.
             */

            if (
              state ===
              "listening"
            ) {

              window
                .NeyoVoice
                ?.setMuted
                ?.(micMuted);


              window
                .NeyoVoice
                ?.setSpeakerEnabled
                ?.(speakerEnabled);

            } else if (
              state ===
              "speaking"
            ) {

              window
                .NeyoVoice
                ?.setSpeakerEnabled
                ?.(speakerEnabled);
            }
          }
        );
      }
    );


  /*
   * Gemini interruption:
   * immediately return visual state
   * to listening.
   */

  window.addEventListener(
    "neyo:voice-interrupted",
    () => {

      setState(
        "listening"
      );


      setEnergy(
        0.12
      );
    }
  );


  window.addEventListener(
    "neyo:voice-muted",
    event => {

      syncMic(
        Boolean(
          event.detail
            ?.muted
        )
      );
    }
  );


  window.addEventListener(
    "neyo:voice-speaker",
    event => {

      syncSpeaker(
        event.detail
          ?.enabled !==
        false
      );
    }
  );


  /*
   * Actual microphone energy.
   */

  window.addEventListener(
    "neyo:voice-mic-level",
    event => {

      if (
        phase ===
        "listening"
      ) {

        setEnergy(
          event.detail
            ?.level
        );
      }
    }
  );


  /*
   * Actual assistant audio energy.
   */

  window.addEventListener(
    "neyo:voice-output-level",
    event => {

      if (
        phase ===
        "speaking"
      ) {

        setEnergy(
          event.detail
            ?.level
        );
      }
    }
  );


  /* =====================================================
     OLDER VOICE ENGINE COMPATIBILITY
     ===================================================== */

  document.addEventListener(
    "voice:state-change",
    event => {

      const state =
        event.detail
          ?.state;


      if (
        !STATES.has(
          state
        )
      ) {
        return;
      }


      setState(
        state
      );


      if (
        state !==
          "idle" &&
        !isOpen()
      ) {

        open();
      }
    }
  );


  document.addEventListener(
    "voice:energy",
    event => {

      const rms =
        Number(
          event.detail
            ?.rms
        );


      if (
        !Number.isFinite(
          rms
        )
      ) {
        return;
      }


      setEnergy(
        Math.max(
          0,
          Math.min(
            1,
            (
              rms -
              0.01
            ) /
            0.12
          )
        )
      );
    }
  );


  /* =====================================================
     INITIAL STATE
     ===================================================== */

  if (
    shell.getAttribute(
      "aria-hidden"
    ) !==
    "false"
  ) {

    shell.setAttribute(
      "aria-hidden",
      "true"
    );


    shell.style.display =
      "none";
  }


  syncMic(
    false
  );


  syncSpeaker(
    true
  );


  syncCamera(
    false
  );


  setState(
    "idle"
  );


  resetWaveform();


  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({

      __controller:
        true,

      version:
        VERSION,

      open,
      close,
      isOpen,

      setState,
      setEnergy,


      setMuted(
        muted
      ) {

        const value =
          Boolean(
            muted
          );


        window
          .NeyoVoice
          ?.setMuted
          ?.(value);


        syncMic(
          value
        );


        return value;
      },


      setSpeakerEnabled(
        enabled
      ) {

        const value =
          Boolean(
            enabled
          );


        window
          .NeyoVoice
          ?.setSpeakerEnabled
          ?.(value);


        syncSpeaker(
          value
        );


        return value;
      },


      startCamera,
      stopCamera,
      toggleCamera,

      end:
        endSession,


      getState:
        () => ({

          version:
            VERSION,

          open:
            isOpen(),

          phase,

          micMuted,

          speakerEnabled,

          cameraEnabled,

          cameraPending,

          energy,

          characterPickerOpen:
            pickerOpen()
        })
    });


  Object.defineProperty(
    window,
    "NeyoVoiceMode",
    {
      value:
        api,

      writable:
        false,

      configurable:
        true,

      enumerable:
        true
    }
  );


  emit(
    "neyo:voice-mode-ready",
    {
      version:
        VERSION
    }
  );

})();
