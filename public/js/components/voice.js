/*
=========================================================
NEYO — GEMINI LIVE VOICE ENGINE
PRODUCTION FULLSCREEN VOICE

Flow:
Composer #micBtn
→ Fullscreen NeyoVoiceMode immediately
→ /api/voice-token
→ Gemini Live
→ microphone PCM 16 kHz
→ native audio playback

Ownership:
- voice.js owns Gemini Live transport/audio only
- voice-mode.js owns fullscreen UI controls/camera/waveform
- mascot.js owns face animation
- character-picker.js owns picker UI
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-live-voice-production-v1";

  if (
    window.NeyoVoice
      ?.__controller
  ) {
    return;
  }


  /* =====================================================
     BUTTON ISOLATION

     Removes legacy neo.js voice listeners
     without touching neo.js itself.
     ===================================================== */

  function isolateButton(
    element
  ) {
    if (!element) {
      return null;
    }

    const clone =
      element.cloneNode(
        true
      );

    element.replaceWith(
      clone
    );

    return clone;
  }


  const micBtn =
    isolateButton(
      document.getElementById(
        "micBtn"
      )
    );


  const stopRecBtn =
    isolateButton(
      document.getElementById(
        "stopRecBtn"
      )
    );


  const composerInputRow =
    document.querySelector(
      ".composer-input-row"
    );


  const legacyWaveform =
    document.getElementById(
      "waveDotsBar"
    );


  if (!micBtn) {
    console.warn(
      "[NEYO Voice] Composer voice button is missing."
    );

    return;
  }


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({

      tokenEndpoint:
        "/api/voice-token",

      websocketEndpoint:
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",

      inputSampleRate:
        16000,

      outputSampleRate:
        24000,

      processorBufferSize:
        4096,

      analyserFftSize:
        256,

      setupTimeoutMs:
        12000,

      maxSessionMs:
        28 * 60 * 1000,

      playbackLeadSeconds:
        0.06,

      vadPrefixPaddingMs:
        90,

      vadSilenceDurationMs:
        760,

      vadStartSensitivity:
        "START_SENSITIVITY_HIGH",

      vadEndSensitivity:
        "END_SENSITIVITY_LOW",

      defaultCharacter:
        "neyo",

      defaultVoice:
        "Kore"
    });


  /* =====================================================
     SESSION STATE
     ===================================================== */

  let socket =
    null;

  let socketGeneration =
    0;

  let connecting =
    false;

  let active =
    false;

  let setupComplete =
    false;

  let stopping =
    false;

  let setupTimer =
    0;

  let sessionTimer =
    0;


  let selectedCharacterId =
    getInitialCharacter();


  let sessionCharacterId =
    selectedCharacterId;


  let sessionVoiceName =
    CONFIG.defaultVoice;


  let restartAfterCharacterChange =
    false;


  /* =====================================================
     TURN STATE
     ===================================================== */

  let assistantSpeaking =
    false;

  let responsePending =
    false;

  let lastPhase =
    "";


  /* =====================================================
     TRANSCRIPTS
     ===================================================== */

  let userTranscriptBuffer =
    "";

  let assistantTranscriptBuffer =
    "";


  /* =====================================================
     MICROPHONE STATE
     ===================================================== */

  let micStream =
    null;

  let micTrack =
    null;

  let inputContext =
    null;

  let micSource =
    null;

  let processorNode =
    null;

  let silentGain =
    null;

  let analyser =
    null;

  let analyserData =
    null;

  let browserInputRate =
    48000;

  let muted =
    false;

  let micRaf =
    0;

  let smoothMicLevel =
    0;


  /* =====================================================
     OUTPUT STATE
     ===================================================== */

  let outputContext =
    null;

  let masterGain =
    null;

  let nextPlaybackTime =
    0;

  let playbackStarted =
    false;

  let speakerEnabled =
    true;


  const playingSources =
    new Set();


  /* =====================================================
     HELPERS
     ===================================================== */

  function clamp(
    value,
    min,
    max
  ) {
    return Math.max(
      min,
      Math.min(
        max,
        value
      )
    );
  }


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


  function cleanId(
    value
  ) {
    const id =
      String(
        value ||
        ""
      )
        .trim()
        .toLowerCase()
        .replace(
          /[^a-z0-9_-]/g,
          ""
        )
        .slice(
          0,
          40
        );


    return (
      id ||
      CONFIG.defaultCharacter
    );
  }


  function getInitialCharacter() {
    const fromRegistry =
      window
        .NeyoCharacters
        ?.active;


    if (
      typeof fromRegistry ===
        "string" &&
      fromRegistry.trim()
    ) {
      return cleanId(
        fromRegistry
      );
    }


    return CONFIG
      .defaultCharacter;
  }


  function setSelectedCharacter(
    id,
    {
      updateMascot = true
    } = {}
  ) {

    const next =
      cleanId(
        id
      );


    selectedCharacterId =
      next;


    if (
      window.NeyoCharacters &&
      typeof window
        .NeyoCharacters ===
        "object"
    ) {

      try {
        window
          .NeyoCharacters
          .active =
          next;

      } catch {}
    }


    if (updateMascot) {

      try {

        window
          .NeyoMascot
          ?.setCharacter
          ?.(
            next,
            {
              resetMood:
                false
            }
          );

      } catch {}
    }


    return next;
  }


  /* =====================================================
     FULLSCREEN VOICE UI
     ===================================================== */

  function openVoiceMode() {

    const mode =
      window.NeyoVoiceMode;


    if (
      typeof mode
        ?.open ===
      "function"
    ) {

      mode.open();

      return true;
    }


    /*
     * Fallback only.
     */

    const shell =
      document.getElementById(
        "neyoVoiceMode"
      );


    if (!shell) {
      return false;
    }


    shell.setAttribute(
      "aria-hidden",
      "false"
    );


    shell.style.display =
      "flex";


    return true;
  }


  function setPhase(
    phase,
    detail = {}
  ) {

    if (
      phase ===
        lastPhase &&
      !detail.force
    ) {
      return;
    }


    lastPhase =
      phase;


    const eventDetail = {

      character:
        sessionCharacterId ||
        selectedCharacterId,

      voice:
        sessionVoiceName,

      ...detail
    };


    if (
      [
        "idle",
        "listening",
        "thinking",
        "speaking"
      ].includes(
        phase
      )
    ) {

      try {

        window
          .NeyoVoiceMode
          ?.setState
          ?.(phase);

      } catch {}
    }


    emit(
      `neyo:voice-${phase}`,
      eventDetail
    );
  }


  function showVoiceError(
    message
  ) {

    const value =
      String(
        message ||
        "Voice connection failed."
      );


    try {

      window
        .NeyoVoiceMode
        ?.setState
        ?.("idle");

    } catch {}


    const status =
      document.getElementById(
        "neyoMascotStatus"
      );


    if (status) {
      status.textContent =
        value;
    }


    emit(
      "neyo:voice-error",
      {
        message:
          value,

        character:
          sessionCharacterId,

        voice:
          sessionVoiceName
      }
    );
  }


  /* =====================================================
     REMOVE OLD COMPOSER VOICE UI
     ===================================================== */

  function disableLegacyComposerVoiceUi() {

    composerInputRow
      ?.classList
      .remove(
        "is-transcribing",
        "is-processing-transcription"
      );


    if (
      legacyWaveform
    ) {

      legacyWaveform
        .setAttribute(
          "aria-hidden",
          "true"
        );


      legacyWaveform
        .style
        .display =
        "none";
    }


    if (
      stopRecBtn
    ) {

      stopRecBtn.hidden =
        true;


      stopRecBtn
        .style
        .display =
        "none";


      stopRecBtn
        .setAttribute(
          "aria-hidden",
          "true"
        );
    }
  }


  function syncComposerButton() {

    disableLegacyComposerVoiceUi();


    const busy =
      connecting ||
      active;


    micBtn.setAttribute(
      "aria-pressed",
      String(
        busy
      )
    );


    if (connecting) {

      micBtn.dataset.tooltip =
        "Connecting";


      micBtn.setAttribute(
        "aria-label",
        "Connecting voice conversation"
      );


      micBtn.setAttribute(
        "aria-busy",
        "true"
      );

    } else if (active) {

      micBtn.dataset.tooltip =
        "Voice conversation active";


      micBtn.setAttribute(
        "aria-label",
        "Open voice conversation"
      );


      micBtn.removeAttribute(
        "aria-busy"
      );

    } else {

      micBtn.dataset.tooltip =
        "Voice conversation";


      micBtn.setAttribute(
        "aria-label",
        "Start voice conversation"
      );


      micBtn.removeAttribute(
        "aria-busy"
      );
    }
  }


  /* =====================================================
     MIC LEVEL
     ===================================================== */

  function calculateMicRms() {

    if (
      !analyser ||
      !analyserData
    ) {
      return 0;
    }


    analyser
      .getByteTimeDomainData(
        analyserData
      );


    let sum =
      0;


    for (
      let i = 0;
      i <
      analyserData.length;
      i += 1
    ) {

      const sample =
        (
          analyserData[i] -
          128
        ) /
        128;


      sum +=
        sample *
        sample;
    }


    return Math.sqrt(
      sum /
      analyserData.length
    );
  }


  function animateMicLevel() {

    if (
      !active &&
      !connecting
    ) {

      micRaf =
        0;


      smoothMicLevel =
        0;


      emit(
        "neyo:voice-mic-level",
        {
          level:
            0
        }
      );


      return;
    }


    const rms =
      calculateMicRms();


    const target =
      muted
        ? 0
        : clamp(
            (
              rms -
              0.012
            ) /
            0.11,
            0,
            1
          );


    const smoothing =
      target >
      smoothMicLevel
        ? 0.30
        : 0.10;


    smoothMicLevel +=
      (
        target -
        smoothMicLevel
      ) *
      smoothing;


    emit(
      "neyo:voice-mic-level",
      {
        level:
          smoothMicLevel
      }
    );


    micRaf =
      requestAnimationFrame(
        animateMicLevel
      );
  }


  function ensureMicLevelLoop() {

    if (micRaf) {
      return;
    }


    micRaf =
      requestAnimationFrame(
        animateMicLevel
      );
  }


  function stopMicLevelLoop() {

    if (micRaf) {

      cancelAnimationFrame(
        micRaf
      );


      micRaf =
        0;
    }


    smoothMicLevel =
      0;


    emit(
      "neyo:voice-mic-level",
      {
        level:
          0
      }
    );
  }


  /* =====================================================
     PCM RESAMPLING
     ===================================================== */

  function resampleFloat32(
    input,
    sourceRate,
    targetRate
  ) {

    if (
      sourceRate ===
      targetRate
    ) {

      return new Float32Array(
        input
      );
    }


    const ratio =
      sourceRate /
      targetRate;


    const outputLength =
      Math.max(
        1,
        Math.floor(
          input.length /
          ratio
        )
      );


    const output =
      new Float32Array(
        outputLength
      );


    for (
      let i = 0;
      i <
      outputLength;
      i += 1
    ) {

      const position =
        i *
        ratio;


      const index =
        Math.floor(
          position
        );


      const fraction =
        position -
        index;


      const a =
        input[
          Math.min(
            index,
            input.length -
            1
          )
        ] ||
        0;


      const b =
        input[
          Math.min(
            index + 1,
            input.length -
            1
          )
        ] ||
        a;


      output[i] =
        a +
        (
          b -
          a
        ) *
        fraction;
    }


    return output;
  }


  function float32ToPcm16(
    samples
  ) {

    const bytes =
      new Uint8Array(
        samples.length *
        2
      );


    const view =
      new DataView(
        bytes.buffer
      );


    for (
      let i = 0;
      i <
      samples.length;
      i += 1
    ) {

      const sample =
        clamp(
          samples[i],
          -1,
          1
        );


      const integer =
        sample < 0
          ? sample *
            32768
          : sample *
            32767;


      view.setInt16(
        i * 2,
        integer,
        true
      );
    }


    return bytes;
  }


  function pcm16ToFloat32(
    bytes
  ) {

    const count =
      Math.floor(
        bytes.byteLength /
        2
      );


    const output =
      new Float32Array(
        count
      );


    const view =
      new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength
      );


    for (
      let i = 0;
      i <
      count;
      i += 1
    ) {

      const value =
        view.getInt16(
          i * 2,
          true
        );


      output[i] =
        value /
        (
          value < 0
            ? 32768
            : 32767
        );
    }


    return output;
  }


  /* =====================================================
     BASE64
     ===================================================== */

  function bytesToBase64(
    bytes
  ) {

    let binary =
      "";


    const chunkSize =
      32768;


    for (
      let i = 0;
      i <
      bytes.length;
      i += chunkSize
    ) {

      const chunk =
        bytes.subarray(
          i,
          Math.min(
            i +
            chunkSize,
            bytes.length
          )
        );


      binary +=
        String.fromCharCode(
          ...chunk
        );
    }


    return btoa(
      binary
    );
  }


  function base64ToBytes(
    value
  ) {

    const binary =
      atob(
        value
      );


    const output =
      new Uint8Array(
        binary.length
      );


    for (
      let i = 0;
      i <
      binary.length;
      i += 1
    ) {

      output[i] =
        binary.charCodeAt(
          i
        );
    }


    return output;
  }


  /* =====================================================
     OUTPUT AUDIO
     ===================================================== */

  async function ensureOutputContext() {

    if (
      outputContext &&
      outputContext.state !==
        "closed"
    ) {

      if (
        outputContext.state ===
        "suspended"
      ) {

        await outputContext.resume();
      }


      return outputContext;
    }


    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;


    if (!AudioContextClass) {

      throw new Error(
        "Audio playback unavailable."
      );
    }


    outputContext =
      new AudioContextClass();


    if (
      outputContext.state ===
      "suspended"
    ) {

      await outputContext.resume();
    }


    masterGain =
      outputContext
        .createGain();


    masterGain.gain.value =
      speakerEnabled
        ? 1
        : 0;


    masterGain.connect(
      outputContext.destination
    );


    nextPlaybackTime =
      outputContext.currentTime;


    return outputContext;
  }


  function getSampleRateFromMime(
    mimeType
  ) {

    const match =
      String(
        mimeType ||
        ""
      ).match(
        /rate=(\d+)/i
      );


    const rate =
      Number(
        match?.[1]
      );


    return (
      Number.isFinite(
        rate
      ) &&
      rate > 0
    )
      ? rate
      : CONFIG.outputSampleRate;
  }


  function calculateOutputLevel(
    samples
  ) {

    if (!samples.length) {
      return 0;
    }


    let sum =
      0;


    for (
      let i = 0;
      i <
      samples.length;
      i += 1
    ) {

      sum +=
        samples[i] *
        samples[i];
    }


    const rms =
      Math.sqrt(
        sum /
        samples.length
      );


    return clamp(
      (
        rms -
        0.008
      ) /
      0.16,
      0,
      1
    );
  }


  async function playAudioChunk(
    base64,
    mimeType,
    generation
  ) {

    if (
      generation !==
      socketGeneration
    ) {
      return;
    }


    const context =
      await ensureOutputContext();


    const bytes =
      base64ToBytes(
        base64
      );


    const samples =
      pcm16ToFloat32(
        bytes
      );


    if (!samples.length) {
      return;
    }


    emit(
      "neyo:voice-output-level",
      {
        level:
          calculateOutputLevel(
            samples
          )
      }
    );


    const buffer =
      context.createBuffer(
        1,
        samples.length,
        getSampleRateFromMime(
          mimeType
        )
      );


    buffer
      .getChannelData(0)
      .set(
        samples
      );


    const source =
      context
        .createBufferSource();


    source.buffer =
      buffer;


    source.connect(
      masterGain ||
      context.destination
    );


    if (
      !assistantSpeaking
    ) {

      assistantSpeaking =
        true;


      responsePending =
        false;


      setPhase(
        "speaking"
      );
    }


    if (
      !playbackStarted
    ) {

      nextPlaybackTime =
        Math.max(
          context.currentTime +
          CONFIG.playbackLeadSeconds,
          nextPlaybackTime
        );


      playbackStarted =
        true;

    } else if (
      nextPlaybackTime <
      context.currentTime +
      0.01
    ) {

      nextPlaybackTime =
        context.currentTime +
        CONFIG.playbackLeadSeconds;
    }


    source.start(
      nextPlaybackTime
    );


    nextPlaybackTime +=
      buffer.duration;


    playingSources.add(
      source
    );


    source.addEventListener(
      "ended",
      () => {

        playingSources.delete(
          source
        );

      },
      {
        once:
          true
      }
    );
  }


  function stopPlayback() {

    for (
      const source
      of playingSources
    ) {

      try {
        source.stop();
      } catch {}
    }


    playingSources.clear();


    playbackStarted =
      false;


    assistantSpeaking =
      false;


    responsePending =
      false;


    if (outputContext) {

      nextPlaybackTime =
        outputContext.currentTime;
    }


    emit(
      "neyo:voice-output-level",
      {
        level:
          0
      }
    );
  }


  /* =====================================================
     MIC / SPEAKER
     ===================================================== */

  function setMuted(
    value
  ) {

    muted =
      Boolean(
        value
      );


    if (micTrack) {

      micTrack.enabled =
        !muted;
    }


    emit(
      "neyo:voice-muted",
      {
        muted
      }
    );


    return muted;
  }


  function setSpeakerEnabled(
    value
  ) {

    speakerEnabled =
      Boolean(
        value
      );


    if (masterGain) {

      masterGain.gain.value =
        speakerEnabled
          ? 1
          : 0;
    }


    emit(
      "neyo:voice-speaker",
      {
        enabled:
          speakerEnabled
      }
    );


    return speakerEnabled;
  }


  /* =====================================================
     TOKEN

     Server remains source of truth
     for character voice mapping.
     ===================================================== */

  async function fetchVoiceToken(
    character
  ) {

    const requestedCharacter =
      cleanId(
        character
      );


    const response =
      await fetch(
        CONFIG.tokenEndpoint,
        {
          method:
            "POST",

          credentials:
            "same-origin",

          cache:
            "no-store",

          headers: {

            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          body:
            JSON.stringify({
              character:
                requestedCharacter
            })
        }
      );


    const raw =
      await response.text();


    let data =
      null;


    try {

      data =
        JSON.parse(
          raw
        );

    } catch {}


    if (!response.ok) {

      throw new Error(
        data?.error ||
        raw ||
        `Voice token failed (${response.status})`
      );
    }


    if (
      !data?.token ||
      !data?.model
    ) {

      throw new Error(
        "Invalid voice token response."
      );
    }


    data.character =
      cleanId(
        data.character ||
        requestedCharacter
      );


    data.voice =
      String(
        data.voice ||
        CONFIG.defaultVoice
      ).trim() ||
      CONFIG.defaultVoice;


    return data;
  }


  /* =====================================================
     MICROPHONE
     ===================================================== */

  async function ensureMicrophone() {

    if (
      micStream &&
      inputContext &&
      processorNode
    ) {
      return;
    }


    if (
      !navigator
        .mediaDevices
        ?.getUserMedia
    ) {

      throw new Error(
        "Microphone unavailable."
      );
    }


    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;


    if (!AudioContextClass) {

      throw new Error(
        "Web Audio API unavailable."
      );
    }


    micStream =
      await navigator
        .mediaDevices
        .getUserMedia({

          audio: {

            channelCount:
              1,

            echoCancellation:
              true,

            noiseSuppression:
              true,

            autoGainControl:
              true
          },

          video:
            false
        });


    micTrack =
      micStream
        .getAudioTracks()[0] ||
      null;


    if (micTrack) {

      micTrack.enabled =
        !muted;
    }


    inputContext =
      new AudioContextClass();


    if (
      inputContext.state ===
      "suspended"
    ) {

      await inputContext.resume();
    }


    browserInputRate =
      inputContext.sampleRate;


    micSource =
      inputContext
        .createMediaStreamSource(
          micStream
        );


    analyser =
      inputContext
        .createAnalyser();


    analyser.fftSize =
      CONFIG.analyserFftSize;


    analyser.smoothingTimeConstant =
      0.82;


    analyserData =
      new Uint8Array(
        analyser.fftSize
      );


    micSource.connect(
      analyser
    );


    processorNode =
      inputContext
        .createScriptProcessor(
          CONFIG.processorBufferSize,
          1,
          1
        );


    silentGain =
      inputContext
        .createGain();


    silentGain.gain.value =
      0;


    micSource.connect(
      processorNode
    );


    processorNode.connect(
      silentGain
    );


    silentGain.connect(
      inputContext.destination
    );


    processorNode.onaudioprocess =
      event => {

        if (
          !active ||
          !setupComplete ||
          muted ||
          !socket ||
          socket.readyState !==
            WebSocket.OPEN
        ) {
          return;
        }


        const input =
          event
            .inputBuffer
            .getChannelData(0);


        const resampled =
          resampleFloat32(
            input,
            browserInputRate,
            CONFIG.inputSampleRate
          );


        const pcm =
          float32ToPcm16(
            resampled
          );


        try {

          socket.send(
            JSON.stringify({

              realtimeInput: {

                audio: {

                  data:
                    bytesToBase64(
                      pcm
                    ),

                  mimeType:
                    "audio/pcm;rate=16000"
                }
              }
            })
          );

        } catch {}
      };


    ensureMicLevelLoop();
  }


  async function destroyMicrophone() {

    if (processorNode) {

      processorNode.onaudioprocess =
        null;


      try {
        processorNode.disconnect();
      } catch {}


      processorNode =
        null;
    }


    if (micSource) {

      try {
        micSource.disconnect();
      } catch {}


      micSource =
        null;
    }


    if (analyser) {

      try {
        analyser.disconnect();
      } catch {}


      analyser =
        null;
    }


    analyserData =
      null;


    if (silentGain) {

      try {
        silentGain.disconnect();
      } catch {}


      silentGain =
        null;
    }


    if (micStream) {

      for (
        const track
        of micStream
          .getTracks()
      ) {

        try {
          track.stop();
        } catch {}
      }
    }


    micStream =
      null;


    micTrack =
      null;


    if (
      inputContext &&
      inputContext.state !==
        "closed"
    ) {

      try {
        await inputContext.close();
      } catch {}
    }


    inputContext =
      null;


    stopMicLevelLoop();
  }


  /* =====================================================
     SOCKET DECODER
     ===================================================== */

  async function decodeSocketMessage(
    data
  ) {

    if (
      typeof data ===
      "string"
    ) {

      return data;
    }


    if (
      data instanceof Blob
    ) {

      return data.text();
    }


    if (
      data instanceof ArrayBuffer
    ) {

      return new TextDecoder(
        "utf-8"
      ).decode(
        data
      );
    }


    return new TextDecoder(
      "utf-8"
    ).decode(
      data
    );
  }


  /* =====================================================
     TRANSCRIPTS
     ===================================================== */

  function appendTranscript(
    current,
    chunk
  ) {

    const value =
      String(
        chunk ||
        ""
      ).trim();


    if (!value) {
      return current;
    }


    if (!current) {
      return value;
    }


    if (
      value.startsWith(
        current
      )
    ) {
      return value;
    }


    if (
      current.endsWith(
        value
      )
    ) {
      return current;
    }


    return `${current} ${value}`
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }


  /* =====================================================
     SERVER MESSAGE
     ===================================================== */

  async function handleServerMessage(
    message,
    generation
  ) {

    if (
      generation !==
      socketGeneration
    ) {
      return;
    }


    if (
      message?.setupComplete
    ) {

      clearTimeout(
        setupTimer
      );


      setupTimer =
        0;


      setupComplete =
        true;


      connecting =
        false;


      active =
        true;


      lastPhase =
        "";


      syncComposerButton();


      ensureMicLevelLoop();


      setPhase(
        "listening"
      );


      emit(
        "neyo:voice-session-ready",
        {
          character:
            sessionCharacterId,

          voice:
            sessionVoiceName
        }
      );


      return;
    }


    const content =
      message
        ?.serverContent;


    if (!content) {
      return;
    }


    const userText =
      content
        ?.inputTranscription
        ?.text;


    if (userText) {

      userTranscriptBuffer =
        appendTranscript(
          userTranscriptBuffer,
          userText
        );


      emit(
        "neyo:voice-user-text",
        {
          text:
            userTranscriptBuffer,

          character:
            sessionCharacterId
        }
      );
    }


    const assistantText =
      content
        ?.outputTranscription
        ?.text;


    if (assistantText) {

      assistantTranscriptBuffer =
        appendTranscript(
          assistantTranscriptBuffer,
          assistantText
        );


      emit(
        "neyo:voice-assistant-text",
        {
          text:
            assistantTranscriptBuffer,

          character:
            sessionCharacterId
        }
      );
    }


    if (
      content.interrupted
    ) {

      stopPlayback();


      lastPhase =
        "";


      setPhase(
        "listening",
        {
          interrupted:
            true
        }
      );


      emit(
        "neyo:voice-interrupted",
        {
          character:
            sessionCharacterId
        }
      );


      return;
    }


    const parts =
      content
        ?.modelTurn
        ?.parts ||
      [];


    if (
      content.modelTurn
    ) {

      if (
        !assistantSpeaking
      ) {

        responsePending =
          true;


        setPhase(
          "thinking"
        );
      }


      for (
        const part
        of parts
      ) {

        const inline =
          part?.inlineData;


        if (
          !inline?.data ||
          !String(
            inline.mimeType ||
            ""
          ).startsWith(
            "audio/"
          )
        ) {
          continue;
        }


        await playAudioChunk(
          inline.data,
          inline.mimeType,
          generation
        );
      }
    }


    if (
      content.turnComplete
    ) {

      const wait =
        () => {

          if (
            generation !==
            socketGeneration
          ) {
            return;
          }


          if (
            playingSources.size >
            0
          ) {

            setTimeout(
              wait,
              25
            );


            return;
          }


          assistantSpeaking =
            false;


          responsePending =
            false;


          userTranscriptBuffer =
            "";


          assistantTranscriptBuffer =
            "";


          emit(
            "neyo:voice-output-level",
            {
              level:
                0
            }
          );


          if (active) {

            setPhase(
              "listening"
            );
          }
        };


      wait();
    }
  }


  /* =====================================================
     SYSTEM INSTRUCTION
     ===================================================== */

  function buildSystemInstruction(
    credentials
  ) {

    const provided =
      credentials
        ?.systemInstruction ||
      credentials
        ?.system_instruction ||
      credentials
        ?.instructions;


    if (
      typeof provided ===
        "string" &&
      provided.trim()
    ) {

      return provided.trim();
    }


    const name =
      String(
        credentials
          ?.characterName ||
        credentials
          ?.character ||
        sessionCharacterId ||
        "Neyo"
      )
        .trim();


    return (
      `You are ${name}, a natural, intelligent and friendly conversational AI assistant. ` +
      "Respond naturally in the user's language. Keep spoken replies concise unless more detail is useful. " +
      "Do not mention internal voice configuration."
    );
  }


  /* =====================================================
     GEMINI LIVE SETUP
     ===================================================== */

  function buildSetupMessage(
    credentials
  ) {

    return {

      setup: {

        model:
          `models/${
            credentials.model
          }`,


        generationConfig: {

          responseModalities: [
            "AUDIO"
          ],


          speechConfig: {

            voiceConfig: {

              prebuiltVoiceConfig: {

                voiceName:
                  sessionVoiceName
              }
            }
          }
        },


        systemInstruction: {

          parts: [
            {
              text:
                buildSystemInstruction(
                  credentials
                )
            }
          ]
        },


        inputAudioTranscription:
          {},


        outputAudioTranscription:
          {},


        realtimeInputConfig: {

          automaticActivityDetection: {

            disabled:
              false,


            startOfSpeechSensitivity:
              CONFIG
                .vadStartSensitivity,


            endOfSpeechSensitivity:
              CONFIG
                .vadEndSensitivity,


            prefixPaddingMs:
              CONFIG
                .vadPrefixPaddingMs,


            silenceDurationMs:
              CONFIG
                .vadSilenceDurationMs
          }
        }
      }
    };
  }


  /* =====================================================
     START
     ===================================================== */

  async function startConversation({
    character
  } = {}) {

    /*
     * Already live:
     * composer button just reopens fullscreen.
     */

    if (
      active ||
      connecting
    ) {

      openVoiceMode();

      return true;
    }


    if (stopping) {
      return false;
    }


    const requestedCharacter =
      setSelectedCharacter(
        character ||
        selectedCharacterId ||
        getInitialCharacter()
      );


    sessionCharacterId =
      requestedCharacter;


    sessionVoiceName =
      CONFIG.defaultVoice;


    connecting =
      true;


    setupComplete =
      false;


    userTranscriptBuffer =
      "";


    assistantTranscriptBuffer =
      "";


    syncComposerButton();


    /*
     * IMPORTANT:
     * Open fullscreen immediately,
     * before token/mic/network awaits.
     */

    openVoiceMode();


    try {

      window
        .NeyoVoiceMode
        ?.setState
        ?.("thinking");

    } catch {}


    lastPhase =
      "";


    setPhase(
      "thinking",
      {
        connecting:
          true
      }
    );


    try {

      await ensureOutputContext();


      await ensureMicrophone();


      const credentials =
        await fetchVoiceToken(
          requestedCharacter
        );


      if (
        !connecting ||
        stopping
      ) {
        return false;
      }


      sessionCharacterId =
        cleanId(
          credentials.character ||
          requestedCharacter
        );


      sessionVoiceName =
        String(
          credentials.voice ||
          CONFIG.defaultVoice
        )
          .trim() ||
        CONFIG.defaultVoice;


      setSelectedCharacter(
        sessionCharacterId
      );


      const generation =
        ++socketGeneration;


      const url =
        `${CONFIG.websocketEndpoint}?access_token=${
          encodeURIComponent(
            credentials.token
          )
        }`;


      socket =
        new WebSocket(
          url
        );


      socket.binaryType =
        "arraybuffer";


      socket.onopen =
        () => {

          if (
            generation !==
            socketGeneration
          ) {
            return;
          }


          socket.send(
            JSON.stringify(
              buildSetupMessage(
                credentials
              )
            )
          );


          setupTimer =
            setTimeout(
              () => {

                if (
                  !setupComplete &&
                  generation ===
                    socketGeneration
                ) {

                  showVoiceError(
                    "Voice setup timed out."
                  );


                  void stopConversation({
                    closeUi:
                      false
                  });
                }

              },
              CONFIG.setupTimeoutMs
            );
        };


      socket.onmessage =
        async event => {

          try {

            const raw =
              await decodeSocketMessage(
                event.data
              );


            const message =
              JSON.parse(
                raw
              );


            await handleServerMessage(
              message,
              generation
            );

          } catch (
            error
          ) {

            console.error(
              "[NEYO Voice] Message error:",
              error
            );
          }
        };


      socket.onerror =
        () => {

          if (
            generation !==
            socketGeneration
          ) {
            return;
          }


          showVoiceError(
            "Voice connection error."
          );
        };


      socket.onclose =
        () => {

          if (
            generation !==
            socketGeneration
          ) {
            return;
          }


          socket =
            null;


          if (
            !stopping &&
            (
              active ||
              connecting
            )
          ) {

            active =
              false;


            connecting =
              false;


            setupComplete =
              false;


            syncComposerButton();


            showVoiceError(
              "Voice connection lost."
            );
          }
        };


      clearTimeout(
        sessionTimer
      );


      sessionTimer =
        setTimeout(
          () => {

            void stopConversation();

          },
          CONFIG.maxSessionMs
        );


      return true;

    } catch (
      error
    ) {

      console.error(
        "[NEYO Voice] Start failed:",
        error
      );


      connecting =
        false;


      active =
        false;


      setupComplete =
        false;


      ++socketGeneration;


      if (socket) {

        try {

          socket.onclose =
            null;


          socket.close();

        } catch {}


        socket =
          null;
      }


      stopPlayback();


      await destroyMicrophone();


      syncComposerButton();


      showVoiceError(
        error?.message ||
        "Couldn't connect voice."
      );


      /*
       * Keep fullscreen screen open.
       */

      return false;
    }
  }


  /* =====================================================
     STOP
     ===================================================== */

  async function stopConversation({
    closeUi = true
  } = {}) {

    if (stopping) {
      return false;
    }


    stopping =
      true;


    clearTimeout(
      setupTimer
    );


    clearTimeout(
      sessionTimer
    );


    setupTimer =
      0;


    sessionTimer =
      0;


    active =
      false;


    connecting =
      false;


    setupComplete =
      false;


    ++socketGeneration;


    stopPlayback();


    if (socket) {

      try {

        socket.onclose =
          null;


        socket.close(
          1000,
          "Voice ended"
        );

      } catch {}


      socket =
        null;
    }


    await destroyMicrophone();


    if (
      outputContext &&
      outputContext.state !==
        "closed"
    ) {

      try {
        await outputContext.close();
      } catch {}
    }


    outputContext =
      null;


    masterGain =
      null;


    nextPlaybackTime =
      0;


    playbackStarted =
      false;


    userTranscriptBuffer =
      "";


    assistantTranscriptBuffer =
      "";


    stopping =
      false;


    syncComposerButton();


    lastPhase =
      "";


    setPhase(
      "idle"
    );


    if (closeUi) {

      try {

        await window
          .NeyoVoiceMode
          ?.close
          ?.({
            stopVoice:
              false
          });

      } catch {}
    }


    /*
     * Character switched while live:
     * restart with same fullscreen screen.
     */

    if (
      restartAfterCharacterChange
    ) {

      restartAfterCharacterChange =
        false;


      openVoiceMode();


      return startConversation({
        character:
          selectedCharacterId
      });
    }


    return true;
  }


  /* =====================================================
     CHARACTER CHANGE
     ===================================================== */

  window.addEventListener(
    "neyo:character-change",
    event => {

      const requested =
        cleanId(
          event
            ?.detail
            ?.id ||
          event
            ?.detail
            ?.character
        );


      if (
        requested ===
        selectedCharacterId
      ) {
        return;
      }


      setSelectedCharacter(
        requested
      );


      /*
       * Gemini voice config belongs
       * to a session.
       *
       * Restart cleanly instead of
       * hot-mutating active socket.
       */

      if (
        active ||
        connecting
      ) {

        restartAfterCharacterChange =
          true;


        void stopConversation({
          closeUi:
            false
        });

      } else {

        sessionCharacterId =
          requested;
      }
    }
  );


  /* =====================================================
     COMPOSER VOICE BUTTON
     ===================================================== */

  micBtn.addEventListener(
    "click",
    event => {

      event.preventDefault();

      event.stopPropagation();

      event.stopImmediatePropagation();


      /*
       * Active session:
       * reopen fullscreen instead of stopping.
       */

      if (
        active ||
        connecting
      ) {

        openVoiceMode();

        return;
      }


      void startConversation();

    },
    true
  );


  /*
   * Legacy inline stop is hidden.
   * Compatibility only.
   */

  stopRecBtn
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();

        event.stopPropagation();

        event.stopImmediatePropagation();


        void stopConversation();

      },
      true
    );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({

      __controller:
        true,

      version:
        VERSION,


      start:
        startConversation,


      stop:
        stopConversation,


      setMuted,


      setSpeakerEnabled,


      setCharacter(
        id
      ) {

        const next =
          setSelectedCharacter(
            id
          );


        if (
          active ||
          connecting
        ) {

          restartAfterCharacterChange =
            true;


          void stopConversation({
            closeUi:
              false
          });
        }


        return next;
      },


      getCharacter:
        () =>
          selectedCharacterId,


      getActiveVoiceName:
        () =>
          sessionVoiceName,


      isActive:
        () =>
          active,


      isConnecting:
        () =>
          connecting,


      getSessionInfo:
        () => ({

          active,

          connecting,

          stopping,

          setupComplete,


          character:
            sessionCharacterId,


          selectedCharacter:
            selectedCharacterId,


          voice:
            sessionVoiceName,


          muted,


          speakerEnabled,


          engine:
            VERSION
        }),


      engine:
        "gemini-live-fullscreen"
    });


  Object.defineProperty(
    window,
    "NeyoVoice",
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
     INIT
     ===================================================== */

  setSelectedCharacter(
    selectedCharacterId
  );


  disableLegacyComposerVoiceUi();


  syncComposerButton();


  emit(
    "neyo:voice-ready",
    {
      version:
        VERSION,

      character:
        selectedCharacterId
    }
  );

})();
