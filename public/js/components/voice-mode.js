(() => {
  "use strict";

  const VERSION = "neyo-voice-mode-v5";
  if (window.NeyoVoiceMode?.__controller === true) return;

  const $ = id => document.getElementById(id);

  const shell = $("neyoVoiceMode");
  const stage = shell?.querySelector(".voice-mode-stage");

  if (!shell || !stage) {
    console.warn("[NEYO Voice Mode] Required DOM missing.");
    return;
  }

  const composerMicBtn = $("micBtn");
  const status = $("neyoMascotStatus");

  const micBtn = $("voiceModeMicBtn");
  const cameraBtn = $("voiceModeCameraBtn");
  const speakerBtn = $("voiceModeSpeakerBtn");
  const characterBtn = $("characterPickerBtn");
  const endBtn = $("voiceModeEndBtn");

  const cameraPreview = $("neyoCameraPreview");
  const cameraVideo = $("neyoCameraVideo");
  const characterPicker = $("characterPicker");

  const STATES = new Set([
    "idle",
    "listening",
    "thinking",
    "speaking"
  ]);

  const LABELS = Object.freeze({
    idle: "Ready",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking…"
  });

  let phase = "idle";
  let micMuted = false;
  let speakerEnabled = true;

  let cameraEnabled = false;
  let cameraPending = false;
  let cameraStream = null;

  let energy = 0;
  let waveFrame = 0;

  let previousFocus = null;

  function emit(name, detail = {}) {
    window.dispatchEvent(
      new CustomEvent(name, { detail })
    );
  }

  function isOpen() {
    return (
      shell.getAttribute("aria-hidden") ===
      "false"
    );
  }

  function createWaveform() {
    let waveform =
      shell.querySelector(
        ".voice-mode-waveform"
      );

    if (waveform) return waveform;

    waveform =
      document.createElement("div");

    waveform.className =
      "voice-mode-waveform";

    waveform.setAttribute(
      "aria-hidden",
      "true"
    );

    for (let i = 0; i < 9; i++) {
      waveform.appendChild(
        document.createElement("span")
      );
    }

    if (
      status &&
      status.parentNode === stage
    ) {
      stage.insertBefore(
        waveform,
        status
      );
    } else {
      stage.appendChild(waveform);
    }

    return waveform;
  }

  const waveform = createWaveform();

  function bars() {
    return Array.from(
      waveform.querySelectorAll("span")
    );
  }

  function resetWaveform() {
    energy = 0;

    for (const bar of bars()) {
      bar.style.transform =
        "scaleY(.45)";

      bar.style.opacity =
        ".2";
    }
  }

  function paintWaveform() {
    waveFrame = 0;

    const elements = bars();

    if (!elements.length) return;

    const base =
      phase === "thinking"
        ? 0.08
        : phase === "listening" ||
          phase === "speaking"
          ? 0.14
          : 0;

    const level =
      Math.max(
        base,
        Math.min(1, energy)
      );

    const center =
      (elements.length - 1) / 2;

    const now =
      performance.now();

    elements.forEach(
      (bar, index) => {
        const distance =
          Math.abs(
            index - center
          ) /
          Math.max(
            1,
            center
          );

        const weight =
          1 -
          distance * 0.42;

        const movement =
          0.9 +
          Math.sin(
            now * 0.01 +
            index * 0.82
          ) *
          0.1;

        const value =
          Math.max(
            0,
            Math.min(
              1,
              level *
                weight *
                movement
            )
          );

        const scale =
          phase === "idle"
            ? 0.45
            : 0.45 +
              value * 2.4;

        bar.style.transform =
          `scaleY(${scale.toFixed(3)})`;

        bar.style.opacity =
          phase === "idle"
            ? ".18"
            : (
                0.22 +
                value * 0.68
              ).toFixed(3);
      }
    );
  }

  function setEnergy(value) {
    const next =
      Number(value);

    if (!Number.isFinite(next)) {
      return false;
    }

    const normalized =
      Math.max(
        0,
        Math.min(1, next)
      );

    energy +=
      (
        normalized -
        energy
      ) *
      (
        normalized > energy
          ? 0.48
          : 0.2
      );

    if (!waveFrame) {
      waveFrame =
        requestAnimationFrame(
          paintWaveform
        );
    }

    return true;
  }

  function setState(value) {
    phase =
      STATES.has(value)
        ? value
        : "idle";

    shell.dataset.voiceState =
      phase;

    if (status) {
      status.textContent =
        LABELS[phase];
    }

    if (phase === "idle") {
      resetWaveform();
    } else {
      setEnergy(
        phase === "thinking"
          ? 0.08
          : 0.14
      );
    }

    emit(
      "neyo:voice-mode-state",
      {
        state: phase
      }
    );

    return phase;
  }

  function open() {
    if (isOpen()) return true;

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

    document.body.classList.add(
      "neyo-voice-mode-open"
    );

    requestAnimationFrame(() => {
      try {
        micBtn?.focus({
          preventScroll: true
        });
      } catch {}
    });

    emit(
      "neyo:voice-mode-opened"
    );

    return true;
  }

  async function close({
    stopVoice = false,
    restoreFocus = true
  } = {}) {
    if (stopVoice) {
      try {
        await window.NeyoVoice
          ?.stop?.();
      } catch {}
    }

    stopCamera();

    shell.setAttribute(
      "aria-hidden",
      "true"
    );

    shell.style.display =
      "none";

    document.body.classList.remove(
      "neyo-voice-mode-open"
    );

    setState("idle");

    if (
      restoreFocus &&
      previousFocus?.isConnected
    ) {
      try {
        previousFocus.focus({
          preventScroll: true
        });
      } catch {}
    }

    previousFocus = null;

    emit(
      "neyo:voice-mode-closed"
    );

    return true;
  }

  function syncMic(muted) {
    micMuted =
      Boolean(muted);

    micBtn?.classList.toggle(
      "is-active",
      !micMuted
    );

    micBtn?.setAttribute(
      "aria-pressed",
      String(!micMuted)
    );

    micBtn?.setAttribute(
      "aria-label",
      micMuted
        ? "Unmute microphone"
        : "Mute microphone"
    );
  }

  function toggleMic() {
    const next =
      !micMuted;

    window.NeyoVoice
      ?.setMuted?.(next);

    syncMic(next);

    return true;
  }

  function syncSpeaker(enabled) {
    speakerEnabled =
      Boolean(enabled);

    speakerBtn?.classList.toggle(
      "is-active",
      speakerEnabled
    );

    speakerBtn?.setAttribute(
      "aria-pressed",
      String(speakerEnabled)
    );

    speakerBtn?.setAttribute(
      "aria-label",
      speakerEnabled
        ? "Turn speaker off"
        : "Turn speaker on"
    );
  }

  function toggleSpeaker() {
    const next =
      !speakerEnabled;

    window.NeyoVoice
      ?.setSpeakerEnabled?.(next);

    syncSpeaker(next);

    return true;
  }

  function syncCamera(enabled) {
    cameraEnabled =
      Boolean(enabled);

    cameraBtn?.classList.toggle(
      "is-active",
      cameraEnabled
    );

    cameraBtn?.setAttribute(
      "aria-pressed",
      String(cameraEnabled)
    );

    cameraBtn?.setAttribute(
      "aria-label",
      cameraEnabled
        ? "Turn camera off"
        : "Turn camera on"
    );

    cameraPreview?.setAttribute(
      "aria-hidden",
      String(!cameraEnabled)
    );

    if (cameraPreview) {
      cameraPreview.style.display =
        cameraEnabled
          ? "block"
          : "none";
    }
  }

  function stopCamera() {
    cameraPending = false;

    if (cameraStream) {
      for (
        const track
        of cameraStream.getTracks()
      ) {
        try {
          track.stop();
        } catch {}
      }
    }

    cameraStream = null;

    if (cameraVideo) {
      try {
        cameraVideo.pause();
      } catch {}

      cameraVideo.srcObject =
        null;
    }

    syncCamera(false);

    emit(
      "neyo:voice-camera-change",
      {
        enabled: false
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
      !navigator.mediaDevices
        ?.getUserMedia
    ) {
      emit(
        "neyo:voice-camera-error",
        {
          error:
            "Camera is not available."
        }
      );

      return false;
    }

    cameraPending = true;

    cameraBtn?.setAttribute(
      "aria-busy",
      "true"
    );

    try {
      const stream =
        await navigator.mediaDevices
          .getUserMedia({
            audio: false,

            video: {
              facingMode: "user",

              width: {
                ideal: 1280
              },

              height: {
                ideal: 720
              }
            }
          });

      if (!isOpen()) {
        for (
          const track
          of stream.getTracks()
        ) {
          track.stop();
        }

        return false;
      }

      cameraStream =
        stream;

      const videoTrack =
        stream.getVideoTracks()[0];

      videoTrack?.addEventListener(
        "ended",
        stopCamera,
        {
          once: true
        }
      );

      if (cameraVideo) {
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

      syncCamera(true);

      emit(
        "neyo:voice-camera-change",
        {
          enabled: true
        }
      );

      return true;

    } catch (error) {
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
      cameraPending = false;

      cameraBtn?.removeAttribute(
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

  function pickerOpen() {
    return (
      characterPicker
        ?.getAttribute(
          "aria-hidden"
        ) ===
      "false"
    );
  }

  function syncCharacterButton() {
    characterBtn?.setAttribute(
      "aria-expanded",
      String(
        pickerOpen()
      )
    );
  }

  async function startSession() {
    open();

    const voice =
      window.NeyoVoice;

    if (!voice?.start) {
      setState("idle");

      emit(
        "neyo:voice-error",
        {
          message:
            "Voice engine unavailable."
        }
      );

      return false;
    }

    if (
      voice.isActive?.() ||
      voice.isConnecting?.()
    ) {
      return true;
    }

    setState("thinking");

    const started =
      await voice.start();

    if (!started) {
      setState("idle");
    }

    return Boolean(started);
  }

  async function endSession() {
    if (endBtn) {
      endBtn.disabled = true;

      endBtn.setAttribute(
        "aria-busy",
        "true"
      );
    }

    try {
      stopCamera();

      await window.NeyoVoice
        ?.stop?.();

    } finally {
      await close({
        stopVoice: false
      });

      if (endBtn) {
        endBtn.disabled =
          false;

        endBtn.removeAttribute(
          "aria-busy"
        );
      }
    }

    return true;
  }

  composerMicBtn?.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      void startSession();
    },
    true
  );

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
      void toggleCamera();
    }
  );

  endBtn?.addEventListener(
    "click",
    event => {
      event.preventDefault();
      void endSession();
    }
  );

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key !== "Escape" ||
        !isOpen() ||
        pickerOpen()
      ) {
        return;
      }

      event.preventDefault();

      void endSession();
    }
  );

  [
    "idle",
    "listening",
    "thinking",
    "speaking"
  ].forEach(state => {
    window.addEventListener(
      `neyo:voice-${state}`,
      () => {
        setState(state);

        if (
          state !== "idle" &&
          !isOpen()
        ) {
          open();
        }
      }
    );
  });

  window.addEventListener(
    "neyo:voice-interrupted",
    () => {
      setState("listening");
      setEnergy(0.12);
    }
  );

  window.addEventListener(
    "neyo:voice-muted",
    event => {
      syncMic(
        Boolean(
          event.detail?.muted
        )
      );
    }
  );

  window.addEventListener(
    "neyo:voice-speaker",
    event => {
      syncSpeaker(
        event.detail?.enabled !==
          false
      );
    }
  );

  window.addEventListener(
    "neyo:voice-mic-level",
    event => {
      if (
        phase === "listening"
      ) {
        setEnergy(
          event.detail?.level
        );
      }
    }
  );

  window.addEventListener(
    "neyo:voice-output-level",
    event => {
      if (
        phase === "speaking"
      ) {
        setEnergy(
          event.detail?.level
        );
      }
    }
  );

  window.addEventListener(
    "neyo:voice-error",
    event => {
      setState("idle");

      if (status) {
        status.textContent =
          event.detail?.message ||
          "Voice unavailable";
      }
    }
  );

  window.addEventListener(
    "neyo:voice-session-ended",
    () => {
      setState("idle");
    }
  );

  if (characterPicker) {
    new MutationObserver(
      syncCharacterButton
    ).observe(
      characterPicker,
      {
        attributes: true,
        attributeFilter: [
          "aria-hidden",
          "class"
        ]
      }
    );
  }

  shell.setAttribute(
    "aria-hidden",
    "true"
  );

  shell.style.display =
    "none";

  syncMic(false);
  syncSpeaker(true);
  syncCamera(false);
  syncCharacterButton();
  setState("idle");
  resetWaveform();

  const api = Object.freeze({
    __controller: true,
    version: VERSION,

    open,
    close,
    isOpen,

    start:
      startSession,

    end:
      endSession,

    setState,
    setEnergy,

    setMuted(value) {
      const muted =
        Boolean(value);

      window.NeyoVoice
        ?.setMuted?.(muted);

      syncMic(muted);

      return muted;
    },

    setSpeakerEnabled(value) {
      const enabled =
        Boolean(value);

      window.NeyoVoice
        ?.setSpeakerEnabled?.(
          enabled
        );

      syncSpeaker(enabled);

      return enabled;
    },

    startCamera,
    stopCamera,
    toggleCamera,

    getState() {
      return {
        version: VERSION,
        open: isOpen(),
        phase,
        micMuted,
        speakerEnabled,
        cameraEnabled,
        cameraPending,
        energy,
        characterPickerOpen:
          pickerOpen()
      };
    }
  });

  Object.defineProperty(
    window,
    "NeyoVoiceMode",
    {
      value: api,
      writable: false,
      configurable: true,
      enumerable: true
    }
  );

  emit(
    "neyo:voice-mode-ready",
    {
      version: VERSION
    }
  );
})();
