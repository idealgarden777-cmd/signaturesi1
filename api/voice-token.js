/*
=========================================================
NEYO — GEMINI LIVE VOICE ENGINE v6
HOT CHARACTER VOICE SWITCHING

Fixed identities:
- Neyo → Kore
- Zadi → Orus
- Wizi → Charon

Core behavior:
- No browser refresh on character change
- No voice-mode close/open
- Keep microphone alive
- Keep AudioContext alive
- Keep camera untouched
- Replace ONLY Gemini Live session/socket
- Fetch fresh character-locked ephemeral token
- Server returned character/voice is authoritative
- Prevent stale Neyo/Kore session race
- Natural VAD + interruption
- Real mic/output energy
- Hidden transcription for mascot intelligence

Requires:
- /api/voice-token
- characters/neyo.js
- characters/zadi.js
- characters/wizi.js
- mascot.js
- voice-mode.js

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     DOM
     ===================================================== */

  const micBtn =
    document.getElementById("micBtn");

  const stopRecBtn =
    document.getElementById("stopRecBtn");

  const composerInputRow =
    document.querySelector(
      ".composer-input-row"
    );

  const waveform =
    document.getElementById(
      "waveDotsBar"
    );


  if (
    !micBtn ||
    !composerInputRow
  ) {
    console.warn(
      "[NEYO Voice] Required DOM missing."
    );

    return;
  }


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG = Object.freeze({

    tokenEndpoint:
      "/api/voice-token",

    websocketEndpoint:
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",

    defaultCharacter:
      "neyo",

    defaultVoice:
      "Kore",

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

    debug:
      true
  });


  /* =====================================================
     FIXED CHARACTER VOICES

     Server is final authority.
     This map is also used locally for instant UI state.
     ===================================================== */

  const CHARACTER_VOICES =
    Object.freeze({

      neyo:
        "Kore",

      zadi:
        "Orus",

      wizi:
        "Charon"
    });


  /* =====================================================
     CONNECTION STATE
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

  let switchingCharacter =
    false;

  let setupTimer =
    0;

  let sessionTimer =
    0;


  /* =====================================================
     IDENTITY
     ===================================================== */

  let sessionCharacterId =
    CONFIG.defaultCharacter;

  let sessionVoiceName =
    CONFIG.defaultVoice;


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
     TRANSCRIPT STATE
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
     WAVEFORM
     ===================================================== */

  let waveRaf =
    0;

  let smoothMicLevel =
    0;


  /* =====================================================
     UTILS
     ===================================================== */

  function debug(...args) {
    if (!CONFIG.debug) return;

    console.log(
      "[NEYO Voice]",
      ...args
    );
  }


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


  function sleep(ms) {
    return new Promise(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    );
  }


  /* =====================================================
     CHARACTER HELPERS
     ===================================================== */

  function getCharacter(
    id
  ) {
    return (
      window
        .NeyoCharacters
        ?.[id] ||
      null
    );
  }


  function getActiveCharacterId() {

    return (
      window
        .NeyoCharacters
        ?.active ||
      window
        .NeyoMascot
        ?.getState
        ?.()
        ?.characterId ||
      CONFIG.defaultCharacter
    );
  }


  function getActiveCharacter() {

    const id =
      getActiveCharacterId();


    return (
      getCharacter(id) ||
      getCharacter(
        CONFIG.defaultCharacter
      )
    );
  }


  function getLocalVoiceForCharacter(
    id
  ) {

    return (
      CHARACTER_VOICES[id] ||
      getCharacter(id)
        ?.voice
        ?.preferredVoice ||
      CONFIG.defaultVoice
    );
  }


  function getActiveVoiceName() {

    return getLocalVoiceForCharacter(
      getActiveCharacterId()
    );
  }


  function setActiveCharacterLocally(
    id
  ) {

    if (
      !window.NeyoCharacters ||
      !getCharacter(id)
    ) {
      return false;
    }


    window.NeyoCharacters.active =
      id;


    return true;
  }


  /* =====================================================
     EVENTS
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


  function setPhase(
    phase,
    detail = {}
  ) {

    /*
    During a hot switch we don't want
    stale old-socket events changing UI.
    */

    if (
      lastPhase ===
      phase
    ) {
      return;
    }


    lastPhase =
      phase;


    emit(
      `neyo:voice-${phase}`,
      {
        character:
          sessionCharacterId,

        voice:
          sessionVoiceName,

        switching:
          switchingCharacter,

        ...detail
      }
    );
  }


  function emitUserText(
    text
  ) {

    const value =
      String(
        text || ""
      ).trim();


    if (!value) return;


    emit(
      "neyo:voice-user-text",
      {
        text:
          value,

        character:
          sessionCharacterId
      }
    );
  }


  function emitAssistantText(
    text
  ) {

    const value =
      String(
        text || ""
      ).trim();


    if (!value) return;


    emit(
      "neyo:voice-assistant-text",
      {
        text:
          value,

        character:
          sessionCharacterId
      }
    );
  }


  /* =====================================================
     UI
     ===================================================== */

  function syncUi() {

    composerInputRow
      .classList
      .toggle(
        "is-transcribing",
        connecting ||
        active ||
        switchingCharacter
      );


    composerInputRow
      .classList
      .toggle(
        "is-processing-transcription",
        connecting
      );


    micBtn.setAttribute(
      "aria-pressed",
      String(active)
    );


    if (switchingCharacter) {

      micBtn.dataset.tooltip =
        "Switching character";

      micBtn.setAttribute(
        "aria-label",
        "Switching voice character"
      );

    } else if (connecting) {

      micBtn.dataset.tooltip =
        "Connecting";

      micBtn.setAttribute(
        "aria-label",
        "Connecting voice"
      );

    } else if (active) {

      micBtn.dataset.tooltip =
        "End voice conversation";

      micBtn.setAttribute(
        "aria-label",
        "End voice conversation"
      );

    } else {

      micBtn.dataset.tooltip =
        "Voice conversation";

      micBtn.setAttribute(
        "aria-label",
        "Start voice conversation"
      );
    }


    if (stopRecBtn) {

      stopRecBtn.disabled =
        connecting ||
        switchingCharacter;

      stopRecBtn.setAttribute(
        "aria-busy",
        String(
          connecting ||
          switchingCharacter
        )
      );
    }
  }


  /* =====================================================
     WAVEFORM
     ===================================================== */

  function getWaveBars() {

    if (!waveform) {
      return [];
    }


    return Array.from(
      waveform.querySelectorAll(
        "span"
      )
    );
  }


  function resetWaveform() {

    smoothMicLevel =
      0;


    for (
      const bar
      of getWaveBars()
    ) {

      bar.style.height =
        "3px";

      bar.style.opacity =
        "0.32";
    }


    emit(
      "neyo:voice-mic-level",
      {
        level:
          0
      }
    );
  }


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
      i < analyserData.length;
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


  function animateWave(
    timestamp
  ) {

    /*
    Keep animation alive while the
    Gemini socket hot-switches.
    */

    if (
      !active &&
      !switchingCharacter
    ) {
      waveRaf =
        0;

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


    const bars =
      getWaveBars();


    const center =
      Math.max(
        1,
        (
          bars.length -
          1
        ) /
        2
      );


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
          center;


        const weight =
          1 -
          distance *
          0.45;


        const movement =
          0.84 +
          Math.sin(
            timestamp *
            0.005 +
            index *
            0.85
          ) *
          0.16;


        const energy =
          clamp(
            smoothMicLevel *
            weight *
            movement,
            0,
            1
          );


        bar.style.height =
          `${(
            3 +
            energy *
            21
          ).toFixed(2)}px`;


        bar.style.opacity =
          `${(
            0.32 +
            energy *
            0.63
          ).toFixed(3)}`;
      }
    );


    waveRaf =
      requestAnimationFrame(
        animateWave
      );
  }


  function ensureWaveLoop() {

    if (waveRaf) {
      return;
    }


    waveRaf =
      requestAnimationFrame(
        animateWave
      );
  }


  /* =====================================================
     RESAMPLE
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
      i < outputLength;
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
            input.length - 1
          )
        ] ||
        0;


      const b =
        input[
          Math.min(
            index + 1,
            input.length - 1
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


  /* =====================================================
     PCM
     ===================================================== */

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
      i < samples.length;
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
      i < count;
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
      i < bytes.length;
      i += chunkSize
    ) {

      const chunk =
        bytes.subarray(
          i,
          Math.min(
            i + chunkSize,
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
      atob(value);


    const output =
      new Uint8Array(
        binary.length
      );


    for (
      let i = 0;
      i < binary.length;
      i += 1
    ) {

      output[i] =
        binary.charCodeAt(i);
    }


    return output;
  }


  /* =====================================================
     OUTPUT CONTEXT
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


    playbackStarted =
      false;


    return outputContext;
  }


  /* =====================================================
     OUTPUT AUDIO
     ===================================================== */

  function getSampleRateFromMime(
    mimeType
  ) {

    const match =
      String(
        mimeType || ""
      ).match(
        /rate=(\d+)/i
      );


    const parsed =
      Number(
        match?.[1]
      );


    return (
      Number.isFinite(parsed) &&
      parsed > 0
    )
      ? parsed
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
      i < samples.length;
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

    /*
    Reject audio arriving late from
    an old character socket.
    */

    if (
      generation !==
      socketGeneration
    ) {
      return;
    }


    if (!base64) {
      return;
    }


    const context =
      await ensureOutputContext();


    if (
      generation !==
      socketGeneration
    ) {
      return;
    }


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


    if (!assistantSpeaking) {

      assistantSpeaking =
        true;

      responsePending =
        false;


      setPhase(
        "speaking"
      );
    }


    if (!playbackStarted) {

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
      Boolean(value);


    if (micTrack) {

      micTrack.enabled =
        !muted;
    }


    if (muted) {

      emit(
        "neyo:voice-mic-level",
        {
          level:
            0
        }
      );
    }


    emit(
      "neyo:voice-muted",
      {
        muted
      }
    );
  }


  function setSpeakerEnabled(
    value
  ) {

    speakerEnabled =
      Boolean(value);


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
  }


  /* =====================================================
     TOKEN

     IMPORTANT:
     character is explicitly sent to server.
     ===================================================== */

  async function fetchVoiceToken(
    characterId =
      getActiveCharacterId()
  ) {

    const response =
      await fetch(
        CONFIG.tokenEndpoint,
        {
          method:
            "POST",

          credentials:
            "same-origin",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          body:
            JSON.stringify({
              character:
                characterId
            })
        }
      );


    const raw =
      await response.text();


    let data =
      null;


    try {

      data =
        JSON.parse(raw);

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
      !data?.model ||
      !data?.character ||
      !data?.voice
    ) {

      throw new Error(
        "Invalid character voice token response."
      );
    }


    /*
    Verify server did not accidentally
    issue a token for another character.
    */

    if (
      data.character !==
      characterId
    ) {

      throw new Error(
        `Voice identity mismatch: requested ${characterId}, received ${data.character}.`
      );
    }


    debug(
      "Character token received",
      {
        character:
          data.character,

        voice:
          data.voice
      }
    );


    return data;
  }


  /* =====================================================
     MICROPHONE

     Created ONCE for the visible voice mode.
     Character switching does NOT call stopMicrophone().
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
        .getAudioTracks()
        [0] ||
      null;


    if (micTrack) {

      micTrack.enabled =
        !muted;
    }


    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;


    if (!AudioContextClass) {

      throw new Error(
        "Web Audio API unavailable."
      );
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

        /*
        During hot switch setupComplete=false,
        therefore microphone remains alive but
        no PCM is sent into an unready socket.
        */

        if (
          !active ||
          !setupComplete ||
          switchingCharacter ||
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


    debug(
      "Microphone pipeline ready",
      {
        browserRate:
          browserInputRate,

        liveRate:
          CONFIG.inputSampleRate
      }
    );
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


    if (silentGain) {

      try {
        silentGain.disconnect();
      } catch {}

      silentGain =
        null;
    }


    analyserData =
      null;


    if (micStream) {

      for (
        const track
        of micStream.getTracks()
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


    if (waveRaf) {

      cancelAnimationFrame(
        waveRaf
      );

      waveRaf =
        0;
    }


    resetWaveform();
  }


  /* =====================================================
     SOCKET MESSAGE DECODER
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


    if (
      ArrayBuffer.isView(
        data
      )
    ) {

      return new TextDecoder(
        "utf-8"
      ).decode(
        data
      );
    }


    throw new Error(
      "Unsupported Gemini message type."
    );
  }


  /* =====================================================
     TRANSCRIPTION
     ===================================================== */

  function appendTranscript(
    current,
    chunk
  ) {

    const value =
      String(
        chunk || ""
      ).trim();


    if (!value) {
      return current;
    }


    if (!current) {
      return value;
    }


    if (
      value ===
      current
    ) {
      return current;
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


  function handleTranscription(
    serverContent
  ) {

    const inputText =
      serverContent
        ?.inputTranscription
        ?.text;


    if (inputText) {

      userTranscriptBuffer =
        appendTranscript(
          userTranscriptBuffer,
          inputText
        );


      emitUserText(
        userTranscriptBuffer
      );
    }


    const outputText =
      serverContent
        ?.outputTranscription
        ?.text;


    if (outputText) {

      assistantTranscriptBuffer =
        appendTranscript(
          assistantTranscriptBuffer,
          outputText
        );


      emitAssistantText(
        assistantTranscriptBuffer
      );
    }
  }


  /* =====================================================
     SERVER MESSAGE
     ===================================================== */

  async function handleServerMessage(
    message,
    generation
  ) {

    /*
    This is critical.
    Old Neyo socket may still deliver one final packet
    after Zadi has been selected.
    Ignore it completely.
    */

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


      assistantSpeaking =
        false;

      responsePending =
        false;


      userTranscriptBuffer =
        "";

      assistantTranscriptBuffer =
        "";


      /*
      Hot switch is complete only after
      NEW Gemini session confirms setup.
      */

      const wasSwitching =
        switchingCharacter;


      switchingCharacter =
        false;


      syncUi();

      ensureWaveLoop();


      lastPhase =
        "";

      setPhase(
        "listening",
        {
          hotSwitched:
            wasSwitching
        }
      );


      emit(
        "neyo:voice-session-ready",
        {
          character:
            sessionCharacterId,

          voice:
            sessionVoiceName,

          hotSwitched:
            wasSwitching
        }
      );


      debug(
        "Live session ready",
        {
          character:
            sessionCharacterId,

          voice:
            sessionVoiceName,

          hotSwitched:
            wasSwitching
        }
      );


      return;
    }


    const serverContent =
      message?.serverContent;


    if (!serverContent) {
      return;
    }


    handleTranscription(
      serverContent
    );


    /* ---------------------------------------------
       INTERRUPTION
       --------------------------------------------- */

    if (
      serverContent.interrupted
    ) {

      stopPlayback();


      assistantTranscriptBuffer =
        "";


      lastPhase =
        "";

      setPhase(
        "interrupted"
      );


      setTimeout(
        () => {

          if (
            generation ===
              socketGeneration &&
            active &&
            !assistantSpeaking
          ) {

            setPhase(
              "listening"
            );
          }

        },
        120
      );


      return;
    }


    /* ---------------------------------------------
       MODEL TURN
       --------------------------------------------- */

    const parts =
      serverContent
        ?.modelTurn
        ?.parts ||
      [];


    if (
      serverContent.modelTurn
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


      let hasAudio =
        false;


      for (
        const part
        of parts
      ) {

        if (
          generation !==
          socketGeneration
        ) {
          return;
        }


        const inline =
          part?.inlineData;


        if (
          !inline?.data ||
          !String(
            inline.mimeType || ""
          ).startsWith(
            "audio/"
          )
        ) {
          continue;
        }


        hasAudio =
          true;


        await playAudioChunk(
          inline.data,
          inline.mimeType,
          generation
        );
      }


      if (
        hasAudio &&
        generation ===
          socketGeneration
      ) {

        responsePending =
          false;

        assistantSpeaking =
          true;


        setPhase(
          "speaking"
        );
      }
    }


    /* ---------------------------------------------
       TURN COMPLETE
       --------------------------------------------- */

    if (
      serverContent.turnComplete
    ) {

      responsePending =
        false;


      const waitForPlayback =
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
              waitForPlayback,
              25
            );

            return;
          }


          assistantSpeaking =
            false;


          emit(
            "neyo:voice-output-level",
            {
              level:
                0
            }
          );


          userTranscriptBuffer =
            "";

          assistantTranscriptBuffer =
            "";


          if (
            active &&
            !switchingCharacter
          ) {

            setPhase(
              "listening"
            );
          }
        };


      waitForPlayback();
    }
  }


  /* =====================================================
     SYSTEM INSTRUCTION
     ===================================================== */

  function buildSystemInstruction(
    characterId
  ) {

    const character =
      getCharacter(
        characterId
      );


    const name =
      character?.name ||
      "Neyo";


    const tone =
      character
        ?.voice
        ?.tone ||
      "natural";


    const style =
      character
        ?.behavior
        ?.responseStyle ||
      "balanced";


    return [
      `You are ${name}.`,
      `You are a natural conversational AI assistant.`,
      `Speak in a ${tone} manner.`,
      `Use a ${style} conversational style.`,
      `Respond naturally to the user's language.`,
      `Do not mention character metadata or voice configuration.`,
      `Do not introduce yourself repeatedly.`,
      `Keep normal spoken replies concise unless more detail is useful or requested.`,
      `Allow interruption naturally.`
    ].join(
      " "
    );
  }


  /* =====================================================
     SETUP MESSAGE

     credentials.character + credentials.voice
     come from SERVER and are authoritative.
     ===================================================== */

  function buildSetupMessage(
    credentials
  ) {

    return {

      setup: {

        model:
          `models/${credentials.model}`,


        generationConfig: {

          responseModalities: [
            "AUDIO"
          ],


          speechConfig: {

            voiceConfig: {

              prebuiltVoiceConfig: {

                voiceName:
                  credentials.voice
              }
            }
          }
        },


        systemInstruction: {

          parts: [
            {
              text:
                buildSystemInstruction(
                  credentials.character
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
     CLOSE SOCKET ONLY

     Hot switch calls THIS.
     Full stop does additional mic/UI cleanup.
     ===================================================== */

  function detachAndCloseSocket(
    reason =
      "Replacing voice session"
  ) {

    const oldSocket =
      socket;


    socket =
      null;


    /*
    Increment first so any in-flight
    old async handlers instantly become stale.
    */

    socketGeneration +=
      1;


    setupComplete =
      false;


    clearTimeout(
      setupTimer
    );


    setupTimer =
      0;


    stopPlayback();


    if (!oldSocket) {
      return;
    }


    try {

      oldSocket.onopen =
        null;

      oldSocket.onmessage =
        null;

      oldSocket.onerror =
        null;

      oldSocket.onclose =
        null;

    } catch {}


    try {

      if (
        oldSocket.readyState ===
          WebSocket.OPEN ||
        oldSocket.readyState ===
          WebSocket.CONNECTING
      ) {

        oldSocket.close(
          1000,
          reason
        );
      }

    } catch {}
  }


  /* =====================================================
     CONNECT LIVE SESSION

     reuseInfrastructure=true:
     microphone + output AudioContext remain alive.
     ===================================================== */

  async function connectLiveSession(
    credentials,
    {
      reuseInfrastructure = true
    } = {}
  ) {

    /*
    Server result becomes actual session identity.
    */

    sessionCharacterId =
      credentials.character;


    sessionVoiceName =
      credentials.voice;


    if (!reuseInfrastructure) {

      await ensureOutputContext();

      await ensureMicrophone();

    } else {

      /*
      Normally already present.
      Still defensive.
      */

      await ensureOutputContext();

      await ensureMicrophone();
    }


    const generation =
      ++socketGeneration;


    const url =
      `${CONFIG.websocketEndpoint}?access_token=${
        encodeURIComponent(
          credentials.token
        )
      }`;


    const newSocket =
      new WebSocket(
        url
      );


    newSocket.binaryType =
      "arraybuffer";


    socket =
      newSocket;


    return new Promise(
      (
        resolve,
        reject
      ) => {

        let resolved =
          false;


        const fail =
          error => {

            if (resolved) return;


            resolved =
              true;


            reject(
              error instanceof Error
                ? error
                : new Error(
                    "Voice connection failed."
                  )
            );
          };


        newSocket.onopen =
          () => {

            if (
              generation !==
              socketGeneration
            ) {

              try {
                newSocket.close();
              } catch {}

              return;
            }


            try {

              newSocket.send(
                JSON.stringify(
                  buildSetupMessage(
                    credentials
                  )
                )
              );


              debug(
                "Live setup sent",
                {
                  generation,

                  character:
                    credentials.character,

                  voice:
                    credentials.voice
                }
              );


              clearTimeout(
                setupTimer
              );


              setupTimer =
                setTimeout(
                  () => {

                    if (
                      generation ===
                        socketGeneration &&
                      !setupComplete
                    ) {

                      fail(
                        new Error(
                          "Gemini Live setup timed out."
                        )
                      );
                    }

                  },
                  CONFIG.setupTimeoutMs
                );

            } catch (error) {

              fail(error);
            }
          };


        newSocket.onmessage =
          async event => {

            if (
              generation !==
              socketGeneration
            ) {
              return;
            }


            try {

              const raw =
                await decodeSocketMessage(
                  event.data
                );


              if (
                generation !==
                socketGeneration
              ) {
                return;
              }


              const message =
                JSON.parse(raw);


              await handleServerMessage(
                message,
                generation
              );


              if (
                message?.setupComplete &&
                !resolved
              ) {

                resolved =
                  true;


                resolve({
                  character:
                    sessionCharacterId,

                  voice:
                    sessionVoiceName
                });
              }

            } catch (error) {

              console.error(
                "[NEYO Voice] Server message error:",
                error
              );
            }
          };


        newSocket.onerror =
          () => {

            if (
              generation !==
              socketGeneration
            ) {
              return;
            }


            fail(
              new Error(
                "Gemini Live socket error."
              )
            );
          };


        newSocket.onclose =
          event => {

            if (
              generation !==
              socketGeneration
            ) {

              return;
            }


            debug(
              "Live socket closed",
              {
                code:
                  event.code,

                reason:
                  event.reason ||
                  "(none)"
              }
            );


            if (
              socket ===
              newSocket
            ) {

              socket =
                null;
            }


            if (
              !stopping &&
              !switchingCharacter &&
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


              syncUi();


              lastPhase =
                "";

              setPhase(
                "error"
              );
            }
          };
      }
    );
  }


  /* =====================================================
     START CONVERSATION
     ===================================================== */

  async function startConversation() {

    if (
      active ||
      connecting ||
      stopping ||
      switchingCharacter
    ) {
      return;
    }


    connecting =
      true;

    setupComplete =
      false;


    userTranscriptBuffer =
      "";

    assistantTranscriptBuffer =
      "";


    /*
    Identity chosen BEFORE token request.
    */

    const characterId =
      getActiveCharacterId();


    sessionCharacterId =
      characterId;


    sessionVoiceName =
      getLocalVoiceForCharacter(
        characterId
      );


    syncUi();


    window
      .NeyoVoiceMode
      ?.open
      ?.();


    try {

      await ensureOutputContext();

      await ensureMicrophone();


      /*
      Keep mic UI alive even before
      Gemini has finished connecting.
      */

      active =
        true;


      ensureWaveLoop();


      const credentials =
        await fetchVoiceToken(
          characterId
        );


      /*
      SERVER authority.
      */

      sessionCharacterId =
        credentials.character;

      sessionVoiceName =
        credentials.voice;


      await connectLiveSession(
        credentials,
        {
          reuseInfrastructure:
            true
        }
      );


      connecting =
        false;

      active =
        true;


      syncUi();


      clearTimeout(
        sessionTimer
      );


      sessionTimer =
        setTimeout(
          () => {

            stopConversation();

          },
          CONFIG.maxSessionMs
        );


    } catch (error) {

      console.error(
        "[NEYO Voice] Start failed:",
        error
      );


      connecting =
        false;

      active =
        false;


      detachAndCloseSocket(
        "Start failed"
      );


      await destroyMicrophone();


      syncUi();


      lastPhase =
        "";

      setPhase(
        "error"
      );


      window
        .NeyoVoiceMode
        ?.close
        ?.({
          stopVoice:
            false
        });
    }
  }


  /* =====================================================
     HOT CHARACTER SWITCH

     THIS IS THE KEY FEATURE.

     Keeps:
     ✓ page
     ✓ voice-mode
     ✓ microphone
     ✓ camera
     ✓ input AudioContext
     ✓ output AudioContext

     Replaces:
     ✓ Gemini token
     ✓ Gemini socket
     ✓ configured character voice
     ===================================================== */

  async function switchCharacter(
    id
  ) {

    const characterId =
      String(
        id || ""
      )
        .trim()
        .toLowerCase();


    if (
      !characterId ||
      !getCharacter(
        characterId
      )
    ) {

      console.warn(
        "[NEYO Voice] Unknown character:",
        characterId
      );

      return false;
    }


    /*
    Update identity immediately BEFORE
    any async token request.
    */

    setActiveCharacterLocally(
      characterId
    );


    const expectedVoice =
      getLocalVoiceForCharacter(
        characterId
      );


    debug(
      "Character selected",
      {
        character:
          characterId,

        expectedVoice
      }
    );


    /*
    No running conversation:
    just store identity for next start.
    */

    if (
      !active &&
      !connecting
    ) {

      sessionCharacterId =
        characterId;

      sessionVoiceName =
        expectedVoice;


      emit(
        "neyo:voice-character-ready",
        {
          character:
            characterId,

          voice:
            expectedVoice,

          live:
            false
        }
      );


      return true;
    }


    /*
    Already switching.
    We still allow newest selection to win by
    invalidating previous socket/request generation.
    */

    switchingCharacter =
      true;


    syncUi();


    emit(
      "neyo:voice-character-switching",
      {
        character:
          characterId,

        voice:
          expectedVoice
      }
    );


    /*
    Stop any old Neyo speech immediately.
    Otherwise user may hear a short stale Kore tail.
    */

    stopPlayback();


    /*
    Disable outgoing PCM temporarily,
    but DO NOT destroy microphone.
    */

    setupComplete =
      false;


    assistantSpeaking =
      false;

    responsePending =
      false;


    userTranscriptBuffer =
      "";

    assistantTranscriptBuffer =
      "";


    /*
    Kill ONLY old Gemini session.
    */

    detachAndCloseSocket(
      `Switching to ${characterId}`
    );


    /*
    Keep active=true:
    voice screen/mic/wave remain alive.
    */

    active =
      true;


    ensureWaveLoop();


    try {

      /*
      Server creates a fresh token locked
      to this exact character voice.
      */

      const credentials =
        await fetchVoiceToken(
          characterId
        );


      /*
      User may have clicked another character
      while token request was loading.

      If so, discard this response.
      */

      if (
        getActiveCharacterId() !==
        characterId
      ) {

        debug(
          "Discarding stale character token",
          {
            receivedFor:
              characterId,

            current:
              getActiveCharacterId()
          }
        );


        return false;
      }


      /*
      Server is identity authority.
      */

      sessionCharacterId =
        credentials.character;

      sessionVoiceName =
        credentials.voice;


      await connectLiveSession(
        credentials,
        {
          reuseInfrastructure:
            true
        }
      );


      switchingCharacter =
        false;

      active =
        true;

      connecting =
        false;


      syncUi();


      emit(
        "neyo:voice-character-ready",
        {
          character:
            sessionCharacterId,

          voice:
            sessionVoiceName,

          live:
            true
        }
      );


      debug(
        "HOT SWITCH COMPLETE",
        {
          character:
            sessionCharacterId,

          voice:
            sessionVoiceName
        }
      );


      return true;

    } catch (error) {

      console.error(
        "[NEYO Voice] Hot switch failed:",
        error
      );


      switchingCharacter =
        false;


      /*
      Do not refresh or destroy microphone.
      Voice mode remains available.

      Try to recover using currently
      selected character.
      */

      syncUi();


      lastPhase =
        "";

      setPhase(
        "error",
        {
          character:
            characterId
        }
      );


      return false;
    }
  }


  /* =====================================================
     FULL STOP

     Unlike switchCharacter(), this actually
     destroys microphone and closes voice mode.
     ===================================================== */

  async function stopConversation({
    closeUi = true
  } = {}) {

    if (stopping) {
      return;
    }


    stopping =
      true;


    clearTimeout(
      setupTimer
    );


    setupTimer =
      0;


    clearTimeout(
      sessionTimer
    );


    sessionTimer =
      0;


    switchingCharacter =
      false;

    connecting =
      false;

    active =
      false;

    setupComplete =
      false;


    detachAndCloseSocket(
      "Voice conversation ended"
    );


    await destroyMicrophone();


    stopPlayback();


    userTranscriptBuffer =
      "";

    assistantTranscriptBuffer =
      "";


    lastPhase =
      "";


    stopping =
      false;


    syncUi();


    setPhase(
      "idle"
    );


    if (closeUi) {

      window
        .NeyoVoiceMode
        ?.close
        ?.({
          stopVoice:
            false,
          emitClose:
            true
        });
    }


    debug(
      "Conversation fully stopped"
    );
  }


  /* =====================================================
     CHARACTER EVENTS

     mascot.setCharacter() already dispatches
     neyo:character-change.

     This listener makes voice switch automatic.
     ===================================================== */

  let lastCharacterEventId =
    null;

  let characterSwitchQueued =
    false;


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


      /*
      Avoid accidental duplicate character-change
      events within same microtask.
      */

      if (
        characterSwitchQueued &&
        lastCharacterEventId ===
          id
      ) {
        return;
      }


      lastCharacterEventId =
        id;

      characterSwitchQueued =
        true;


      queueMicrotask(
        () => {

          characterSwitchQueued =
            false;


          switchCharacter(
            id
          );
        }
      );
    }
  );


  /* =====================================================
     MAIN MIC BUTTON
     ===================================================== */

  micBtn.addEventListener(
    "click",
    event => {

      event.preventDefault();


      if (
        stopping ||
        switchingCharacter
      ) {
        return;
      }


      if (
        active ||
        connecting
      ) {

        stopConversation();

      } else {

        startConversation();
      }
    }
  );


  stopRecBtn
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();

        stopConversation();
      }
    );


  /* =====================================================
     ESCAPE
     ===================================================== */

  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
          "Escape" &&
        (
          active ||
          connecting ||
          switchingCharacter
        )
      ) {

        stopConversation();
      }
    }
  );


  /* =====================================================
     PAGE CLEANUP
     ===================================================== */

  window.addEventListener(
    "pagehide",
    () => {

      stopConversation({
        closeUi:
          false
      });
    },
    {
      once:
        true
    }
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  window.NeyoVoice =
    Object.freeze({

      start:
        startConversation,

      stop:
        stopConversation,

      switchCharacter,

      setMuted,

      setSpeakerEnabled,

      getActiveVoiceName,

      isActive:
        () =>
          active,

      isConnecting:
        () =>
          connecting,

      isSwitchingCharacter:
        () =>
          switchingCharacter,

      getSessionInfo:
        () => ({

          active,

          connecting,

          switchingCharacter,

          setupComplete,

          selectedCharacter:
            getActiveCharacterId(),

          character:
            sessionCharacterId,

          voice:
            sessionVoiceName,

          muted,

          speakerEnabled,

          socketGeneration
        }),

      getVoiceMap:
        () => ({
          ...CHARACTER_VOICES
        }),

      engine:
        "gemini-live-hot-character-switch-v6"
    });


  /* =====================================================
     INIT
     ===================================================== */

  const initialCharacter =
    getActiveCharacterId();


  sessionCharacterId =
    initialCharacter;


  sessionVoiceName =
    getLocalVoiceForCharacter(
      initialCharacter
    );


  resetWaveform();

  syncUi();


  debug(
    "Hot-switch engine ready",
    {
      character:
        sessionCharacterId,

      voice:
        sessionVoiceName,

      voiceMap:
        CHARACTER_VOICES
    }
  );

})();
