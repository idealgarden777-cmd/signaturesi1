/*
=========================================================
NEYO — VOICE MODE
FINAL PRODUCTION MIXER v8

FILE:
public/js/components/voice-mode.js

OWNS
---------------------------------------------------------
- Composer #micBtn voice-session launch
- Fullscreen voice shell
- Fullscreen open / close
- Focus preservation / restoration
- Voice phase presentation
- Status text
- Real audio-energy waveform UI
- Fullscreen microphone control
- Fullscreen speaker control
- Camera preview / camera lifecycle
- End-session control
- Character-picker presentation coordination
- Character-change voice restart coordination
- Optional stable dictation UI bridge
- Dictation transcript insertion into composer
- Voice mode keyboard behavior
- Legacy neo.js voice-button interception

DOES NOT OWN
---------------------------------------------------------
- Gemini Live WebSocket
- /api/voice-token
- PCM transport
- Audio playback transport
- /api/transcribe
- Mascot face / eyes / mouth
- Character picker list / selection logic
- Chat send
- Conversation state
- History

ARCHITECTURE
---------------------------------------------------------

Composer #micBtn
      ↓
voice-mode.js
      ↓
open fullscreen immediately
      ↓
NeyoVoice.start()
      ↓
Gemini Live

Fullscreen controls
      ↓
voice-mode.js
      ↓
NeyoVoice transport APIs

Voice state events
      ↓
voice-mode.js → shell/status/waveform
      ↓
mascot.js     → face animation

Character picker
      ↓
character-picker.js
      ↓
neyo:character-change
      ↓
NeyoVoice.setCharacter()
      ↓
neyo:voice-restart-required
      ↓
voice-mode.js clean stop/start

DICTATION FALLBACK
---------------------------------------------------------
NeyoVoice.startDictation()
      ↓
MediaRecorder /api/transcribe
      ↓
neyo:voice-transcript
      ↓
voice-mode.js inserts transcript at captured caret

Dictation is preserved as an explicit fallback API.
Normal composer mic still launches Gemini Live.

MIGRATION RULE
---------------------------------------------------------
This controller owns #micBtn even while neo.js is loaded.

Document capture-phase interception prevents legacy
neo.js voice listeners from also firing.

After neo.js is removed this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-voice-mode-final-v8";

  if (
    window.NeyoVoiceMode
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      waveformBars:
        9,

      maxTranscriptLength:
        50_000,

      cameraWidth:
        1280,

      cameraHeight:
        720,

      /*
       * Character voice config is session-scoped.
       * Restart cleanly after character change.
       */

      restartDelayMs:
        60
    });

  /* =====================================================
     DOM
     ===================================================== */

  const $ =
    id =>
      document.getElementById(
        id
      );

  const shell =
    $("neyoVoiceMode");

  const stage =
    shell?.querySelector(
      ".voice-mode-stage"
    );

  const mascotSlot =
    shell?.querySelector(
      ".voice-mode-mascot-slot"
    );

  const status =
    $("neyoMascotStatus");

  /*
   * Composer control.
   */

  const composerMicBtn =
    $("micBtn");

  /*
   * Fullscreen controls.
   */

  const micBtn =
    $("voiceModeMicBtn");

  const cameraBtn =
    $("voiceModeCameraBtn");

  const speakerBtn =
    $("voiceModeSpeakerBtn");

  const characterBtn =
    $("characterPickerBtn");

  const endBtn =
    $("voiceModeEndBtn");

  /*
   * Camera.
   */

  const cameraPreview =
    $("neyoCameraPreview");

  const cameraVideo =
    $("neyoCameraVideo");

  /*
   * Character picker shell.
   */

  const characterPicker =
    $("characterPicker");

  if (
    !shell ||
    !stage
  ) {
    console.warn(
      "[NEYO Voice Mode] Required fullscreen DOM is missing."
    );

    return;
  }

  /* =====================================================
     STATES
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

  /* =====================================================
     STATE
     ===================================================== */

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

  let opening =
    false;

  let starting =
    false;

  let ending =
    false;

  let restarting =
    false;

  let lastError =
    null;

  /*
   * Dictation fallback state.
   */

  let dictationActive =
    false;

  let dictationPrefix =
    "";

  let dictationSuffix =
    "";

  let dictationInsertionCaptured =
    false;

  const metrics = {
    opens:
      0,

    closes:
      0,

    starts:
      0,

    ends:
      0,

    restarts:
      0,

    cameraStarts:
      0,

    cameraStops:
      0,

    dictations:
      0,

    transcriptInsertions:
      0,

    lastOpenedAt:
      null,

    lastClosedAt:
      null
  };

  /* =====================================================
     EVENT
     ===================================================== */

  function emit(
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
     BASIC HELPERS
     ===================================================== */

  function clamp(
    value,
    min = 0,
    max = 1
  ) {
    return Math.max(
      min,
      Math.min(
        max,
        value
      )
    );
  }

  function cleanText(
    value,
    max =
      CONFIG.maxTranscriptLength
  ) {
    return String(
      value ?? ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .replace(
        /\r\n?/g,
        "\n"
      )
      .slice(
        0,
        max
      );
  }

  function getVoice() {
    return (
      window.NeyoVoice &&
      typeof window.NeyoVoice ===
        "object"
    )
      ? window.NeyoVoice
      : null;
  }

  function voiceState() {
    try {
      return (
        getVoice()
          ?.getState
          ?.() ||
        getVoice()
          ?.getSessionInfo
          ?.() ||
        {}
      );

    } catch {
      return {};
    }
  }

  function voiceIsActive() {
    try {
      return (
        getVoice()
          ?.isActive
          ?.() ===
        true
      );

    } catch {
      return Boolean(
        voiceState()
          ?.active
      );
    }
  }

  function voiceIsConnecting() {
    try {
      return (
        getVoice()
          ?.isConnecting
          ?.() ===
        true
      );

    } catch {
      return Boolean(
        voiceState()
          ?.connecting
      );
    }
  }

  function voiceIsStopping() {
    try {
      return (
        getVoice()
          ?.isStopping
          ?.() ===
        true
      );

    } catch {
      return Boolean(
        voiceState()
          ?.stopping
      );
    }
  }

  /* =====================================================
     STATUS
     ===================================================== */

  function setStatus(
    value,
    {
      error =
        false
    } = {}
  ) {
    const text =
      cleanText(
        value,
        500
      ).trim();

    if (
      status
    ) {
      status.textContent =
        text ||
        LABELS[phase] ||
        "Ready";

      status.classList.toggle(
        "is-error",
        Boolean(
          error
        )
      );
    }

    if (
      error
    ) {
      lastError =
        text ||
        "Voice unavailable.";

    } else {
      lastError =
        null;
    }

    return text;
  }

  /* =====================================================
     WAVEFORM
     ===================================================== */

  function ensureWaveform() {
    let root =
      shell.querySelector(
        ".voice-mode-waveform"
      );

    if (
      root
    ) {
      shell.dataset
        .liveWaveform =
        "true";

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
      let index = 0;
      index <
        CONFIG.waveformBars;
      index += 1
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
     * Existing voice-mode CSS had a decorative
     * fallback waveform in the mascot slot.
     *
     * Hide that fallback only when real bars exist.
     */

    if (
      !document.getElementById(
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
        [
          ".voice-mode-shell[data-live-waveform='true']",
          " .voice-mode-mascot-slot::after",
          "{display:none!important}"
        ].join("");

      document.head
        .appendChild(
          style
        );
    }

    shell.dataset
      .liveWaveform =
      "true";

    return root;
  }

  const waveform =
    ensureWaveform();

  function waveBars() {
    return Array.from(
      waveform
        ?.querySelectorAll(
          "span"
        ) ||
      []
    );
  }

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

    if (
      !bars.length
    ) {
      return;
    }

    const hasMotion =
      phase ===
        "listening" ||
      phase ===
        "speaking";

    const base =
      phase ===
        "thinking"
        ? 0.08
        : hasMotion
          ? 0.14
          : 0;

    const level =
      Math.max(
        base,
        clamp(
          energy
        )
      );

    const center =
      (
        bars.length -
        1
      ) /
      2;

    const time =
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
            time *
              0.01 +
            index *
              0.82
          ) *
          0.1;

        const current =
          clamp(
            level *
            weight *
            motion
          );

        const scale =
          phase ===
            "idle"
            ? 0.45
            : 0.45 +
              current *
              2.4;

        bar.style.transform =
          `scaleY(${scale.toFixed(3)})`;

        bar.style.opacity =
          phase ===
            "idle"
            ? ".18"
            : (
                0.22 +
                current *
                0.68
              ).toFixed(3);
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
      return false;
    }

    const next =
      clamp(
        number
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
          : 0.20
      );

    if (
      !waveRaf
    ) {
      waveRaf =
        requestAnimationFrame(
          paintWaveform
        );
    }

    return true;
  }

  /* =====================================================
     PHASE

     IMPORTANT:
     No mascot data-tone / eye / mouth manipulation here.

     mascot.js owns face state.
     ===================================================== */

  function setState(
    value,
    options = {}
  ) {
    phase =
      STATES.has(
        value
      )
        ? value
        : "idle";

    shell.dataset
      .voiceState =
      phase;

    shell.setAttribute(
      "data-voice-state",
      phase
    );

    if (
      !options.preserveStatus
    ) {
      setStatus(
        LABELS[phase]
      );
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
     OPEN STATE
     ===================================================== */

  function isOpen() {
    return (
      shell.getAttribute(
        "aria-hidden"
      ) ===
      "false"
    );
  }

  /* =====================================================
     FOCUSABLE ELEMENTS
     ===================================================== */

  function focusableElements() {
    return Array
      .from(
        shell.querySelectorAll(
          [
            "button:not([disabled])",
            "[href]",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            '[tabindex]:not([tabindex="-1"])'
          ].join(",")
        )
      )
      .filter(
        element =>
          element instanceof
            HTMLElement &&
          !element.hidden &&
          element.offsetParent !==
            null
      );
  }

  /* =====================================================
     OPEN
     ===================================================== */

  function open() {
    if (
      isOpen()
    ) {
      return true;
    }

    if (
      opening
    ) {
      return true;
    }

    opening =
      true;

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

    metrics.opens +=
      1;

    metrics.lastOpenedAt =
      Date.now();

    requestAnimationFrame(
      () => {
        opening =
          false;

        try {
          micBtn
            ?.focus({
              preventScroll:
                true
            });

        } catch {
          try {
            micBtn?.focus();
          } catch {}
        }
      }
    );

    emit(
      "neyo:voice-mode-opened"
    );

    return true;
  }

  /* =====================================================
     CHARACTER PICKER STATE
     ===================================================== */

  function pickerOpen() {
    try {
      if (
        typeof window
          .NeyoCharacterPicker
          ?.isOpen ===
        "function"
      ) {
        return Boolean(
          window
            .NeyoCharacterPicker
            .isOpen()
        );
      }
    } catch {}

    return (
      characterPicker
        ?.getAttribute(
          "aria-hidden"
        ) ===
      "false"
    );
  }

  function syncCharacterPickerButton() {
    characterBtn
      ?.setAttribute(
        "aria-expanded",
        String(
          pickerOpen()
        )
      );

    return pickerOpen();
  }

  function closeCharacterPicker() {
    if (
      !characterPicker
    ) {
      return false;
    }

    try {
      if (
        typeof window
          .NeyoCharacterPicker
          ?.close ===
        "function"
      ) {
        window
          .NeyoCharacterPicker
          .close();

        syncCharacterPickerButton();

        return true;
      }
    } catch {}

    /*
     * Safe fallback only.
     * Selection/rendering remains picker ownership.
     */

    characterPicker
      .setAttribute(
        "aria-hidden",
        "true"
      );

    characterPicker
      .classList
      .remove(
        "is-open",
        "open",
        "show"
      );

    syncCharacterPickerButton();

    return true;
  }

  let characterObserver =
    null;

  if (
    characterPicker
  ) {
    characterObserver =
      new MutationObserver(
        syncCharacterPickerButton
      );

    characterObserver.observe(
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
     CAMERA UI
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

    cameraBtn
      ?.setAttribute(
        "aria-pressed",
        String(
          cameraEnabled
        )
      );

    cameraBtn
      ?.setAttribute(
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
      cameraPreview.style.display =
        cameraEnabled
          ? "block"
          : "none";
    }

    /*
     * Camera state is published as an event.
     * mascot.js may react if desired.
     */

    emit(
      "neyo:voice-camera",
      {
        enabled:
          cameraEnabled
      }
    );

    return cameraEnabled;
  }

  /* =====================================================
     STOP CAMERA
     ===================================================== */

  function stopCamera({
    emitEvent =
      true
  } = {}) {
    const wasActive =
      Boolean(
        cameraStream ||
        cameraEnabled ||
        cameraPending
      );

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

    cameraBtn
      ?.removeAttribute(
        "aria-busy"
      );

    syncCamera(
      false
    );

    if (
      wasActive
    ) {
      metrics.cameraStops +=
        1;
    }

    if (
      emitEvent
    ) {
      emit(
        "neyo:voice-camera-change",
        {
          enabled:
            false
        }
      );
    }

    return true;
  }

  /* =====================================================
     START CAMERA
     ===================================================== */

  async function startCamera() {
    if (
      cameraEnabled
    ) {
      return true;
    }

    if (
      cameraPending
    ) {
      return false;
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

    cameraBtn
      ?.setAttribute(
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
                  CONFIG
                    .cameraWidth
              },

              height: {
                ideal:
                  CONFIG
                    .cameraHeight
              }
            }
          });

      /*
       * Permission race protection.
       *
       * User might close voice mode while browser's
       * camera permission prompt is still open.
       */

      if (
        !isOpen()
      ) {
        stream
          .getTracks()
          .forEach(
            track => {
              try {
                track.stop();
              } catch {}
            }
          );

        return false;
      }

      /*
       * Another start may have somehow won the race.
       */

      if (
        cameraStream
      ) {
        stream
          .getTracks()
          .forEach(
            track => {
              try {
                track.stop();
              } catch {}
            }
          );

        return cameraEnabled;
      }

      cameraStream =
        stream;

      const track =
        stream
          .getVideoTracks()[0] ||
        null;

      track
        ?.addEventListener(
          "ended",
          () => {
            stopCamera();
          },
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
          await cameraVideo.play();
        } catch {}
      }

      syncCamera(
        true
      );

      metrics.cameraStarts +=
        1;

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

      stopCamera({
        emitEvent:
          false
      });

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

  /* =====================================================
     TOGGLE CAMERA
     ===================================================== */

  async function toggleCamera() {
    if (
      cameraEnabled
    ) {
      stopCamera();

      return false;
    }

    if (
      cameraPending
    ) {
      return false;
    }

    return startCamera();
  }

  /* =====================================================
     MIC UI
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

    micBtn
      ?.setAttribute(
        "aria-pressed",
        String(
          !micMuted
        )
      );

    micBtn
      ?.setAttribute(
        "aria-label",
        micMuted
          ? "Unmute microphone"
          : "Mute microphone"
      );

    emit(
      "neyo:voice-mode-mic-state",
      {
        muted:
          micMuted
      }
    );

    return micMuted;
  }

  function setMuted(
    value
  ) {
    const next =
      Boolean(
        value
      );

    try {
      getVoice()
        ?.setMuted
        ?.(next);

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Voice Mode] Mic update failed:",
        error
      );

      return false;
    }

    syncMic(
      next
    );

    return next;
  }

  function toggleMic() {
    const next =
      !micMuted;

    const result =
      setMuted(
        next
      );

    emit(
      "neyo:voice-mic-toggle",
      {
        muted:
          next
      }
    );

    return result;
  }

  /* =====================================================
     SPEAKER UI
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

    speakerBtn
      ?.setAttribute(
        "aria-pressed",
        String(
          speakerEnabled
        )
      );

    speakerBtn
      ?.setAttribute(
        "aria-label",
        speakerEnabled
          ? "Turn speaker off"
          : "Turn speaker on"
      );

    emit(
      "neyo:voice-mode-speaker-state",
      {
        enabled:
          speakerEnabled
      }
    );

    return speakerEnabled;
  }

  function setSpeakerEnabled(
    value
  ) {
    const next =
      Boolean(
        value
      );

    try {
      getVoice()
        ?.setSpeakerEnabled
        ?.(next);

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Voice Mode] Speaker update failed:",
        error
      );

      return false;
    }

    syncSpeaker(
      next
    );

    return next;
  }

  function toggleSpeaker() {
    const next =
      !speakerEnabled;

    const result =
      setSpeakerEnabled(
        next
      );

    emit(
      "neyo:voice-speaker-toggle",
      {
        enabled:
          next
      }
    );

    return result;
  }

  /* =====================================================
     COMPOSER MIC BUTTON PRESENTATION
     ===================================================== */

  function syncComposerMicButton() {
    if (
      !composerMicBtn
    ) {
      return false;
    }

    const busy =
      starting ||
      voiceIsConnecting();

    const live =
      voiceIsActive();

    composerMicBtn
      .setAttribute(
        "aria-pressed",
        String(
          busy ||
          live ||
          isOpen()
        )
      );

    if (
      busy
    ) {
      composerMicBtn
        .setAttribute(
          "aria-busy",
          "true"
        );

      composerMicBtn
        .setAttribute(
          "aria-label",
          "Connecting voice conversation"
        );

      composerMicBtn
        .dataset.tooltip =
        "Connecting";

      return true;
    }

    composerMicBtn
      .removeAttribute(
        "aria-busy"
      );

    if (
      live
    ) {
      composerMicBtn
        .setAttribute(
          "aria-label",
          "Open voice conversation"
        );

      composerMicBtn
        .dataset.tooltip =
        "Voice conversation active";

      return true;
    }

    composerMicBtn
      .setAttribute(
        "aria-label",
        "Start voice conversation"
      );

    composerMicBtn
      .dataset.tooltip =
      "Voice conversation";

    return true;
  }

  /* =====================================================
     START SESSION
     ===================================================== */

  async function startSession({
    character =
      null
  } = {}) {
    if (
      ending ||
      restarting
    ) {
      return false;
    }

    /*
     * Existing active session:
     * composer mic simply reopens fullscreen.
     */

    if (
      voiceIsActive() ||
      voiceIsConnecting()
    ) {
      open();
      syncComposerMicButton();

      return true;
    }

    if (
      starting
    ) {
      open();

      return false;
    }

    const voice =
      getVoice();

    if (
      typeof voice?.start !==
      "function"
    ) {
      open();

      setState(
        "idle"
      );

      setStatus(
        "Voice engine is unavailable.",
        {
          error:
            true
        }
      );

      emit(
        "neyo:voice-mode-error",
        {
          message:
            "Voice engine is unavailable."
        }
      );

      return false;
    }

    /*
     * Fullscreen appears immediately,
     * before permissions/network/token awaits.
     */

    open();

    starting =
      true;

    metrics.starts +=
      1;

    setState(
      "thinking"
    );

    setStatus(
      "Connecting…"
    );

    syncComposerMicButton();

    emit(
      "neyo:voice-mode-starting",
      {
        character
      }
    );

    try {
      const started =
        await voice.start({
          ...(character
            ? {
                character
              }
            : {})
        });

      if (
        started
      ) {
        /*
         * Reapply current UI preferences.
         *
         * Mic/output nodes may have been created during
         * engine startup.
         */

        voice.setMuted
          ?.(micMuted);

        voice.setSpeakerEnabled
          ?.(speakerEnabled);

        return true;
      }

      /*
       * voice.js already emits a specific error when
       * startup fails. Keep shell open so user can see it.
       */

      if (
        !lastError
      ) {
        setState(
          "idle"
        );

        setStatus(
          "Voice connection could not start.",
          {
            error:
              true
          }
        );
      }

      return false;

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Voice Mode] Start failed:",
        error
      );

      setState(
        "idle"
      );

      setStatus(
        error?.message ||
        "Voice connection could not start.",
        {
          error:
            true
        }
      );

      emit(
        "neyo:voice-mode-error",
        {
          message:
            error?.message ||
            "Voice connection could not start."
        }
      );

      return false;

    } finally {
      starting =
        false;

      syncComposerMicButton();
    }
  }

  /* =====================================================
     CLOSE

     close() hides UI.
     endSession() stops engine + hides UI.

     This separation prevents recursive stop/close loops.
     ===================================================== */

  async function close({
    stopVoice =
      false,

    restoreFocus =
      true
  } = {}) {
    if (
      stopVoice
    ) {
      try {
        await getVoice()
          ?.stop
          ?.({
            reason:
              "voice-mode-close"
          });

      } catch (
        error
      ) {
        console.warn(
          "[NEYO Voice Mode] Voice stop during close failed:",
          error
        );
      }
    }

    stopCamera();

    closeCharacterPicker();

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

    metrics.closes +=
      1;

    metrics.lastClosedAt =
      Date.now();

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

      } catch {
        try {
          previousFocus
            .focus();
        } catch {}
      }
    }

    previousFocus =
      null;

    syncComposerMicButton();

    emit(
      "neyo:voice-mode-closed"
    );

    return true;
  }

  /* =====================================================
     END SESSION
     ===================================================== */

  async function endSession({
    reason =
      "user"
  } = {}) {
    if (
      ending
    ) {
      return false;
    }

    ending =
      true;

    metrics.ends +=
      1;

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

      await getVoice()
        ?.stop
        ?.({
          reason
        });

      return true;

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Voice Mode] End failed:",
        error
      );

      return false;

    } finally {
      /*
       * Engine has already stopped.
       * Do not ask close() to stop it again.
       */

      await close({
        stopVoice:
          false
      });

      ending =
        false;

      if (
        endBtn
      ) {
        endBtn.disabled =
          false;

        endBtn.removeAttribute(
          "aria-busy"
        );
      }

      syncComposerMicButton();
    }
  }

  /* =====================================================
     CHARACTER RESTART

     voice.js intentionally does NOT hot-restart itself.
     UI coordinator owns the user-visible continuity.
     ===================================================== */

  async function restartForCharacter(
    character
  ) {
    if (
      restarting
    ) {
      return false;
    }

    const voice =
      getVoice();

    if (
      !voice ||
      (
        !voiceIsActive() &&
        !voiceIsConnecting()
      )
    ) {
      return false;
    }

    restarting =
      true;

    metrics.restarts +=
      1;

    open();

    setState(
      "thinking"
    );

    setStatus(
      "Switching character…"
    );

    try {
      await voice.stop({
        reason:
          "character-change"
      });

      await new Promise(
        resolve =>
          window.setTimeout(
            resolve,
            CONFIG
              .restartDelayMs
          )
      );

      /*
       * Character may have changed again during stop.
       * NeyoVoice.getCharacter() is canonical selection.
       */

      const selected =
        voice.getCharacter
          ?.() ||
        character;

      const result =
        await voice.start({
          character:
            selected
        });

      if (
        result
      ) {
        voice.setMuted
          ?.(micMuted);

        voice
          .setSpeakerEnabled
          ?.(speakerEnabled);
      }

      return Boolean(
        result
      );

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Voice Mode] Character restart failed:",
        error
      );

      setState(
        "idle"
      );

      setStatus(
        error?.message ||
        "Could not switch character.",
        {
          error:
            true
        }
      );

      return false;

    } finally {
      restarting =
        false;

      syncComposerMicButton();
    }
  }

  /* =====================================================
     DICTATION INSERTION POINT
     ===================================================== */

  function getChatInput() {
    return document
      .getElementById(
        "chatInput"
      );
  }

  function captureDictationInsertionPoint() {
    const input =
      getChatInput();

    if (
      !input
    ) {
      dictationPrefix =
        "";

      dictationSuffix =
        "";

      dictationInsertionCaptured =
        false;

      return false;
    }

    const value =
      String(
        input.value ||
        ""
      );

    const start =
      Number.isFinite(
        input.selectionStart
      )
        ? input.selectionStart
        : value.length;

    const end =
      Number.isFinite(
        input.selectionEnd
      )
        ? input.selectionEnd
        : start;

    dictationPrefix =
      value.slice(
        0,
        start
      );

    dictationSuffix =
      value.slice(
        end
      );

    dictationInsertionCaptured =
      true;

    return true;
  }

  /* =====================================================
     INSERT DICTATION TRANSCRIPT

     Preserves old production behavior:
     transcript is inserted at captured caret/selection,
     not blindly appended.
     ===================================================== */

  function insertTranscript(
    transcript
  ) {
    const input =
      getChatInput();

    const text =
      cleanText(
        transcript
      ).trim();

    if (
      !input ||
      !text
    ) {
      return false;
    }

    if (
      !dictationInsertionCaptured
    ) {
      captureDictationInsertionPoint();
    }

    let before =
      dictationPrefix;

    let after =
      dictationSuffix;

    if (
      before &&
      !/\s$/.test(
        before
      )
    ) {
      before +=
        " ";
    }

    let middle =
      text;

    if (
      after &&
      !/^\s/.test(
        after
      )
    ) {
      middle +=
        " ";
    }

    input.value =
      `${before}${middle}${after}`
        .slice(
          0,
          CONFIG
            .maxTranscriptLength
        );

    const caret =
      Math.min(
        input.value.length,
        before.length +
          middle.length
      );

    try {
      input.setSelectionRange(
        caret,
        caret
      );
    } catch {}

    input.dispatchEvent(
      new Event(
        "input",
        {
          bubbles:
            true
        }
      )
    );

    try {
      window
        .NeyoComposerScrollbar
        ?.refresh
        ?.();
    } catch {}

    try {
      window.NeyoComposer
        ?.refresh
        ?.();
    } catch {}

    try {
      input.focus({
        preventScroll:
          true
      });
    } catch {}

    metrics.transcriptInsertions +=
      1;

    dictationInsertionCaptured =
      false;

    dictationPrefix =
      "";

    dictationSuffix =
      "";

    emit(
      "neyo:voice-transcript-inserted",
      {
        transcript:
          text
      }
    );

    return true;
  }

  /* =====================================================
     START DICTATION FALLBACK

     Explicit API only.
     Normal mic button remains Gemini Live.
     ===================================================== */

  async function startDictation() {
    const voice =
      getVoice();

    if (
      typeof voice
        ?.startDictation !==
      "function"
    ) {
      return false;
    }

    if (
      voiceIsActive() ||
      voiceIsConnecting()
    ) {
      return false;
    }

    captureDictationInsertionPoint();

    const started =
      await voice
        .startDictation();

    dictationActive =
      Boolean(
        started
      );

    if (
      dictationActive
    ) {
      metrics.dictations +=
        1;

      emit(
        "neyo:voice-mode-dictation-start"
      );
    }

    return dictationActive;
  }

  /* =====================================================
     STOP DICTATION FALLBACK
     ===================================================== */

  async function stopDictation({
    transcribe =
      true
  } = {}) {
    const voice =
      getVoice();

    if (
      typeof voice
        ?.stopDictation !==
      "function"
    ) {
      return null;
    }

    const result =
      await voice
        .stopDictation({
          transcribe
        });

    dictationActive =
      false;

    return result;
  }

  /* =====================================================
     CANCEL DICTATION
     ===================================================== */

  async function cancelDictation() {
    dictationActive =
      false;

    dictationInsertionCaptured =
      false;

    dictationPrefix =
      "";

    dictationSuffix =
      "";

    try {
      return await getVoice()
        ?.cancelDictation
        ?.();

    } catch {
      return false;
    }
  }

  /* =====================================================
     BUTTON EVENT CONSUMER
     ===================================================== */

  function consume(
    event
  ) {
    event.preventDefault();

    event.stopPropagation();

    event.stopImmediatePropagation();
  }

  /* =====================================================
     COMPOSER MIC — AUTHORITATIVE CAPTURE OWNER

     This blocks old neo.js mic behavior without cloning
     or replacing the DOM button.
     ===================================================== */

  document.addEventListener(
    "click",
    event => {
      const target =
        event.target;

      if (
        !(
          target instanceof
          Element
        )
      ) {
        return;
      }

      const button =
        target.closest(
          "#micBtn"
        );

      if (
        !button
      ) {
        return;
      }

      consume(
        event
      );

      /*
       * Existing voice conversation:
       * reopen fullscreen rather than stop.
       */

      if (
        voiceIsActive() ||
        voiceIsConnecting() ||
        starting
      ) {
        open();

        return;
      }

      void startSession();
    },
    true
  );

  /* =====================================================
     FULLSCREEN MIC BUTTON
     ===================================================== */

  micBtn
    ?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        toggleMic();
      }
    );

  /* =====================================================
     CAMERA BUTTON
     ===================================================== */

  cameraBtn
    ?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        void toggleCamera();
      }
    );

  /* =====================================================
     SPEAKER BUTTON
     ===================================================== */

  speakerBtn
    ?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        toggleSpeaker();
      }
    );

  /* =====================================================
     END BUTTON
     ===================================================== */

  endBtn
    ?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        void endSession();
      }
    );

  /*
   * Character button intentionally has NO click owner
   * here. character-picker.js remains sole picker owner.
   */

  /* =====================================================
     KEYBOARD — ESCAPE + FOCUS TRAP
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {
      if (
        !isOpen()
      ) {
        return;
      }

      /* -------------------------------------------------
         CHARACTER PICKER OWNS ESCAPE WHILE OPEN
         ------------------------------------------------- */

      if (
        event.key ===
          "Escape"
      ) {
        if (
          pickerOpen()
        ) {
          return;
        }

        event.preventDefault();

        void endSession({
          reason:
            "escape"
        });

        return;
      }

      /* -------------------------------------------------
         SIMPLE DIALOG FOCUS TRAP
         ------------------------------------------------- */

      if (
        event.key !==
        "Tab"
      ) {
        return;
      }

      const items =
        focusableElements();

      if (
        items.length ===
        0
      ) {
        event.preventDefault();

        return;
      }

      const first =
        items[0];

      const last =
        items[
          items.length -
          1
        ];

      if (
        event.shiftKey &&
        document.activeElement ===
          first
      ) {
        event.preventDefault();

        last.focus();

        return;
      }

      if (
        !event.shiftKey &&
        document.activeElement ===
          last
      ) {
        event.preventDefault();

        first.focus();
      }
    }
  );

  /* =====================================================
     CURRENT VOICE PHASE EVENTS
     ===================================================== */

  for (
    const voicePhase
    of [
      "idle",
      "listening",
      "thinking",
      "speaking"
    ]
  ) {
    window.addEventListener(
      `neyo:voice-${voicePhase}`,
      event => {
        setState(
          voicePhase
        );

        /*
         * Engine event may arrive after a programmatic
         * start from somewhere other than composer button.
         */

        if (
          voicePhase !==
            "idle" &&
          !isOpen()
        ) {
          open();
        }

        if (
          voicePhase ===
          "listening"
        ) {
          /*
           * Ensure preferences survive transport setup.
           */

          getVoice()
            ?.setMuted
            ?.(micMuted);

          getVoice()
            ?.setSpeakerEnabled
            ?.(speakerEnabled);

        } else if (
          voicePhase ===
          "speaking"
        ) {
          getVoice()
            ?.setSpeakerEnabled
            ?.(speakerEnabled);
        }

        syncComposerMicButton();

        emit(
          "neyo:voice-mode-engine-phase",
          {
            phase:
              voicePhase,

            detail:
              event.detail
          }
        );
      }
    );
  }

  /* =====================================================
     INTERRUPTION
     ===================================================== */

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

  /* =====================================================
     ENGINE MIC STATE
     ===================================================== */

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

  /* =====================================================
     ENGINE SPEAKER STATE
     ===================================================== */

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

  /* =====================================================
     MIC ENERGY
     ===================================================== */

  window.addEventListener(
    "neyo:voice-mic-level",
    event => {
      if (
        phase !==
        "listening"
      ) {
        return;
      }

      setEnergy(
        event.detail
          ?.level
      );
    }
  );

  /* =====================================================
     OUTPUT ENERGY
     ===================================================== */

  window.addEventListener(
    "neyo:voice-output-level",
    event => {
      if (
        phase !==
        "speaking"
      ) {
        return;
      }

      setEnergy(
        event.detail
          ?.level
      );
    }
  );

  /* =====================================================
     ENGINE ERROR
     ===================================================== */

  window.addEventListener(
    "neyo:voice-error",
    event => {
      const message =
        cleanText(
          event.detail
            ?.message ||
          "Voice unavailable.",
          500
        ).trim();

      setState(
        "idle",
        {
          preserveStatus:
            true
        }
      );

      setStatus(
        message,
        {
          error:
            true
        }
      );

      syncComposerMicButton();
    }
  );

  /* =====================================================
     SESSION STARTING
     ===================================================== */

  window.addEventListener(
    "neyo:voice-session-starting",
    () => {
      open();

      setState(
        "thinking"
      );

      setStatus(
        "Connecting…"
      );

      syncComposerMicButton();
    }
  );

  /* =====================================================
     SESSION READY
     ===================================================== */

  window.addEventListener(
    "neyo:voice-session-ready",
    () => {
      setStatus(
        LABELS.listening
      );

      syncComposerMicButton();
    }
  );

  /* =====================================================
     SESSION ENDED

     If user explicitly ended externally, close UI.
     For transport/start failures, keep UI visible long
     enough to display the error state.
     ===================================================== */

  window.addEventListener(
    "neyo:voice-session-ended",
    event => {
      const reason =
        event.detail
          ?.reason ||
        "";

      syncComposerMicButton();

      if (
        [
          "user",
          "escape",
          "voice-mode-close",
          "session-limit"
        ].includes(
          reason
        )
      ) {
        if (
          isOpen() &&
          !ending &&
          !restarting
        ) {
          void close({
            stopVoice:
              false
          });
        }
      }
    }
  );

  /* =====================================================
     CHARACTER RESTART REQUIRED
     ===================================================== */

  window.addEventListener(
    "neyo:voice-restart-required",
    event => {
      const reason =
        event.detail
          ?.reason;

      if (
        reason !==
        "character-change"
      ) {
        return;
      }

      void restartForCharacter(
        event.detail
          ?.character
      );
    }
  );

  /* =====================================================
     DICTATION TRANSCRIPT

     Insert exactly once.
     ===================================================== */

  window.addEventListener(
    "neyo:voice-transcript",
    event => {
      const text =
        event.detail
          ?.transcript ||
        event.detail
          ?.text;

      if (
        !text
      ) {
        return;
      }

      dictationActive =
        false;

      insertTranscript(
        text
      );
    }
  );

  /* =====================================================
     DICTATION STATE
     ===================================================== */

  window.addEventListener(
    "neyo:voice-dictation-start",
    () => {
      dictationActive =
        true;
    }
  );

  window.addEventListener(
    "neyo:voice-dictation-stop",
    () => {
      dictationActive =
        false;
    }
  );

  window.addEventListener(
    "neyo:voice-dictation-cancelled",
    () => {
      dictationActive =
        false;

      dictationInsertionCaptured =
        false;

      dictationPrefix =
        "";

      dictationSuffix =
        "";
    }
  );

  /* =====================================================
     OLDER VOICE ENGINE COMPATIBILITY

     New voice.js emits these too, but setState() is
     idempotent. This preserves old consumers while
     neo.js is being removed.
     ===================================================== */

  document.addEventListener(
    "voice:state-change",
    event => {
      const value =
        event.detail
          ?.state;

      if (
        !STATES.has(
          value
        )
      ) {
        return;
      }

      setState(
        value
      );

      if (
        value !==
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

      /*
       * Only use compatibility energy if current engine
       * isn't already delivering normalized levels.
       */

      if (
        phase !==
          "listening"
      ) {
        return;
      }

      setEnergy(
        clamp(
          (rms - 0.01) / 0.12
        )
      );
    }
  );

  /* =====================================================
     CAMERA PAGE CLEANUP
     ===================================================== */

  window.addEventListener(
    "pagehide",
    () => {
      stopCamera({
        emitEvent:
          false
      });
    },
    {
      once:
        true
    }
  );

  /* =====================================================
     INITIAL VOICE PREFERENCES FROM ENGINE
     ===================================================== */

  function hydrateFromVoice() {
    const current =
      voiceState();

    syncMic(
      Boolean(
        current.muted
      )
    );

    syncSpeaker(
      current
        .speakerEnabled !==
      false
    );

    if (
      STATES.has(
        current.phase
      )
    ) {
      setState(
        current.phase
      );
    }

    return current;
  }

  /* =====================================================
     INITIAL DOM
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

  syncCamera(
    false
  );

  hydrateFromVoice();

  resetWaveform();

  syncComposerMicButton();

  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller:
        true,

      version:
        VERSION,

      active:
        true,

      /*
       * Shell
       */

      open,

      close,

      isOpen,

      /*
       * Session
       */

      start:
        startSession,

      startSession,

      end:
        endSession,

      endSession,

      restartForCharacter,

      /*
       * Presentation
       */

      setState,

      setEnergy,

      setStatus,

      /*
       * Mic
       */

      setMuted,

      toggleMic,

      /*
       * Speaker
       */

      setSpeakerEnabled,

      toggleSpeaker,

      /*
       * Camera
       */

      startCamera,

      stopCamera,

      toggleCamera,

      /*
       * Character picker coordination
       */

      pickerOpen,

      closeCharacterPicker,

      /*
       * Dictation fallback
       */

      startDictation,

      stopDictation,

      cancelDictation,

      insertTranscript,

      captureDictationInsertionPoint,

      /*
       * State
       */

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          open:
            isOpen(),

          phase,

          starting,

          ending,

          restarting,

          micMuted,

          speakerEnabled,

          cameraEnabled,

          cameraPending,

          energy,

          dictationActive,

          characterPickerOpen:
            pickerOpen(),

          voiceActive:
            voiceIsActive(),

          voiceConnecting:
            voiceIsConnecting(),

          voiceStopping:
            voiceIsStopping(),

          lastError,

          metrics: {
            ...metrics
          }
        };
      }
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

  /* =====================================================
     READY
     ===================================================== */

  emit(
    "neyo:voice-mode-ready",
    {
      version:
        VERSION,

      active:
        true,

      liveVoice:
        true,

      camera:
        true,

      dictationFallback:
        Boolean(
          getVoice()
            ?.startDictation
        )
    }
  );
})();
