/*
=========================================================
NEYO — GEMINI LIVE VOICE ENGINE v5
Character-aware production version

Fixed character voices:
- Neyo → Kore
- Zadi → Orus
- Wizi → Charon

Owns:
- Gemini Live connection
- ephemeral token auth
- microphone capture
- PCM conversion
- output playback
- server VAD
- interruption
- transcripts
- character voice selection
- mic / speaker control
- real mic + output energy events

Does NOT own:
- mascot geometry
- mood intelligence
- voice-mode visual UI
- character picker UI
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     DOM
     ===================================================== */

  const micBtn =
    document.getElementById(
      "micBtn"
    );

  const stopRecBtn =
    document.getElementById(
      "stopRecBtn"
    );

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

  const CONFIG =
    Object.freeze({

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
        0.08,

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
     FIXED VOICE POLICY

     Character profile remains the preferred source.
     This map protects identity if a profile is missing,
     stale, or accidentally edited.
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
     SESSION STATE
     ===================================================== */

  let socket =
    null;

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
    "idle";


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
     WAVEFORM STATE
     ===================================================== */

  let waveRaf =
    0;

  let smoothMicLevel =
    0;


  /* =====================================================
     LOG
     ===================================================== */

  function debug(
    ...args
  ) {

    if (!CONFIG.debug) {
      return;
    }


    console.log(
      "[NEYO Voice]",
      ...args
    );
  }


  /* =====================================================
     CHARACTER HELPERS
     ===================================================== */

  function getActiveCharacter() {

    const helper =
      window.NeyoCharacter;


    if (
      helper?.getActive
    ) {

      const character =
        helper.getActive();

      if (character) {
        return character;
      }
    }


    const id =
      window
        .NeyoCharacters
        ?.active ||
      CONFIG.defaultCharacter;


    return (
      window
        .NeyoCharacters
        ?.[id]
      ||
      window
        .NeyoCharacters
        ?.neyo
      ||
      null
    );
  }


  function getActiveCharacterId() {

    return (
      getActiveCharacter()
        ?.id ||
      window
        .NeyoCharacters
        ?.active ||
      CONFIG.defaultCharacter
    );
  }


  function getActiveVoiceName() {

    const character =
      getActiveCharacter();


    const id =
      character?.id ||
      CONFIG.defaultCharacter;


    /*
    Fixed voice policy wins for known
    production characters.
    */

    const fixedVoice =
      CHARACTER_VOICES[id];


    if (fixedVoice) {
      return fixedVoice;
    }


    const profileVoice =
      character
        ?.voice
        ?.preferredVoice;


    if (
      typeof profileVoice ===
        "string" &&
      profileVoice.trim()
    ) {

      return profileVoice.trim();
    }


    return CONFIG.defaultVoice;
  }


  function lockSessionIdentity() {

    sessionCharacterId =
      getActiveCharacterId();


    sessionVoiceName =
      getActiveVoiceName();


    debug(
      "Session identity locked",
      {
        character:
          sessionCharacterId,

        voice:
          sessionVoiceName
      }
    );
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


    if (!value) {
      return;
    }


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


    if (!value) {
      return;
    }


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
     UI SYNC
     ===================================================== */

  function syncUi() {

    composerInputRow
      .classList
      .toggle(
        "is-transcribing",
        connecting ||
        active
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


    if (connecting) {

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
        connecting;

      stopRecBtn.setAttribute(
        "aria-busy",
        String(connecting)
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


  function animateWave(
    timestamp
  ) {

    if (!active) {
      return;
    }


    const rms =
      calculateMicRms();


    const target =
      clamp(
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
          muted
            ? 0
            : smoothMicLevel
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
          muted
            ? 0
            : clamp(
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


  /* =====================================================
     MATH
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
      i <
      outputLength;
      i += 1
    ) {

      const sourcePosition =
        i *
        ratio;


      const index =
        Math.floor(
          sourcePosition
        );


      const fraction =
        sourcePosition -
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


  /* =====================================================
     FLOAT32 → PCM16
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


  /* =====================================================
     PCM16 → FLOAT32
     ===================================================== */

  function pcm16ToFloat32(
    bytes
  ) {

    const count =
      Math.floor(
        bytes.byteLength /
        2
      );


    const samples =
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

      const sample =
        view.getInt16(
          i * 2,
          true
        );


      samples[i] =
        sample /
        (
          sample < 0
            ? 32768
            : 32767
        );
    }


    return samples;
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
        String
          .fromCharCode(
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


    const bytes =
      new Uint8Array(
        binary.length
      );


    for (
      let i = 0;
      i <
      binary.length;
      i += 1
    ) {

      bytes[i] =
        binary.charCodeAt(i);
    }


    return bytes;
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
     OUTPUT RATE
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


    if (!match) {

      return CONFIG.outputSampleRate;
    }


    const rate =
      Number(
        match[1]
      );


    return (
      Number.isFinite(rate) &&
      rate > 0
    )
      ? rate
      : CONFIG.outputSampleRate;
  }


  /* =====================================================
     OUTPUT RMS
     ===================================================== */

  function calculateOutputLevel(
    samples
  ) {

    if (
      !samples.length
    ) {

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


  /* =====================================================
     PLAYBACK
     ===================================================== */

  async function playAudioChunk(
    base64,
    mimeType
  ) {

    if (!base64) {
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


    if (
      !samples.length
    ) {

      return;
    }


    const outputLevel =
      calculateOutputLevel(
        samples
      );


    emit(
      "neyo:voice-output-level",
      {
        level:
          outputLevel
      }
    );


    const sampleRate =
      getSampleRateFromMime(
        mimeType
      );


    const buffer =
      context.createBuffer(
        1,
        samples.length,
        sampleRate
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


    if (
      outputContext
    ) {

      nextPlaybackTime =
        outputContext.currentTime;
    }


    assistantSpeaking =
      false;

    responsePending =
      false;


    emit(
      "neyo:voice-output-level",
      {
        level:
          0
      }
    );
  }


  /* =====================================================
     MIC MUTE
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


  /* =====================================================
     SPEAKER
     ===================================================== */

  function setSpeakerEnabled(
    value
  ) {

    speakerEnabled =
      Boolean(
        value
      );


    if (
      masterGain
    ) {

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
     ===================================================== */

  async function fetchVoiceToken() {

    const response =
      await fetch(
        CONFIG.tokenEndpoint,
        {
          method:
            "POST",

          credentials:
            "same-origin",

          headers: {
            Accept:
              "application/json"
          }
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


    return data;
  }


  /* =====================================================
     MICROPHONE
     ===================================================== */

  async function startMicrophone() {

    if (micStream) {
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


    debug(
      "Microphone ready",
      {
        browserRate:
          browserInputRate,

        sentRate:
          CONFIG.inputSampleRate
      }
    );
  }


  async function stopMicrophone() {

    if (
      processorNode
    ) {

      processorNode.onaudioprocess =
        null;


      try {
        processorNode.disconnect();
      } catch {}


      processorNode =
        null;
    }


    if (
      micSource
    ) {

      try {
        micSource.disconnect();
      } catch {}


      micSource =
        null;
    }


    if (
      analyser
    ) {

      try {
        analyser.disconnect();
      } catch {}


      analyser =
        null;
    }


    if (
      silentGain
    ) {

      try {
        silentGain.disconnect();
      } catch {}


      silentGain =
        null;
    }


    analyserData =
      null;


    if (
      micStream
    ) {

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


    if (
      waveRaf
    ) {

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
     TRANSCRIPT
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


    /*
    Avoid obvious duplicate cumulative chunks.
    */

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
     MODEL AUDIO PARTS
     ===================================================== */

  async function handleModelParts(
    parts
  ) {

    let hasAudio =
      false;


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


      hasAudio =
        true;


      await playAudioChunk(
        inline.data,
        inline.mimeType
      );
    }


    return hasAudio;
  }


  /* =====================================================
     SERVER MESSAGE
     ===================================================== */

  async function handleServerMessage(
    message
  ) {

    if (
      message?.setupComplete
    ) {

      debug(
        "Gemini setup complete",
        {
          character:
            sessionCharacterId,

          voice:
            sessionVoiceName
        }
      );


      clearTimeout(
        setupTimer
      );


      setupTimer =
        0;

      setupComplete =
        true;


      await startMicrophone();


      active =
        true;

      connecting =
        false;


      assistantSpeaking =
        false;

      responsePending =
        false;


      userTranscriptBuffer =
        "";

      assistantTranscriptBuffer =
        "";


      syncUi();

      resetWaveform();


      waveRaf =
        requestAnimationFrame(
          animateWave
        );


      lastPhase =
        "";

      setPhase(
        "listening"
      );


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


      return;
    }


    const serverContent =
      message
        ?.serverContent;


    if (!serverContent) {

      return;
    }


    handleTranscription(
      serverContent
    );


    /* =================================================
       INTERRUPTION
       ================================================= */

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


    /* =================================================
       MODEL TURN
       ================================================= */

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


      const hasAudio =
        await handleModelParts(
          parts
        );


      if (
        hasAudio
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


    /* =================================================
       TURN COMPLETE
       ================================================= */

    if (
      serverContent.turnComplete
    ) {

      responsePending =
        false;


      const waitUntilPlaybackEnds =
        () => {

          if (
            playingSources.size >
            0
          ) {

            setTimeout(
              waitUntilPlaybackEnds,
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


          if (active) {

            setPhase(
              "listening"
            );
          }
        };


      waitUntilPlaybackEnds();
    }
  }


  /* =====================================================
     SYSTEM INSTRUCTION
     ===================================================== */

  function buildSystemInstruction() {

    const character =
      getActiveCharacter();


    const name =
      character
        ?.name ||
      "Neyo";


    const tone =
      character
        ?.voice
        ?.tone ||
      "natural";


    const responseStyle =
      character
        ?.behavior
        ?.responseStyle ||
      "balanced";


    return [
      `You are ${name}, a conversational AI assistant.`,
      `Speak naturally and fluidly.`,
      `Use a ${tone} vocal manner.`,
      `Your response style is ${responseStyle}.`,
      `Do not mention voice configuration or character metadata.`,
      `Keep spoken answers concise unless the user asks for depth.`,
      `Allow natural interruptions and continue conversationally.`
    ].join(
      " "
    );
  }


  /* =====================================================
     SETUP MESSAGE
     ===================================================== */

  function buildSetupMessage(
    credentials
  ) {

    lockSessionIdentity();


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
                  sessionVoiceName
              }
            }
          }
        },


        systemInstruction: {

          parts: [
            {
              text:
                buildSystemInstruction()
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
     SOCKET
     ===================================================== */

  function createSocket(
    token
  ) {

    const url =
      `${CONFIG.websocketEndpoint}?access_token=${
        encodeURIComponent(
          token
        )
      }`;


    return new WebSocket(
      url
    );
  }


  /* =====================================================
     START
     ===================================================== */

  async function startConversation() {

    if (
      connecting ||
      active ||
      stopping
    ) {

      return;
    }


    connecting =
      true;

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


    syncUi();


    window
      .NeyoVoiceMode
      ?.open
      ?.();


    try {

      await ensureOutputContext();


      const credentials =
        await fetchVoiceToken();


      socket =
        createSocket(
          credentials.token
        );


      socket.binaryType =
        "arraybuffer";


      socket.onopen =
        () => {

          const setupMessage =
            buildSetupMessage(
              credentials
            );


          socket.send(
            JSON.stringify(
              setupMessage
            )
          );


          debug(
            "Setup sent",
            {
              model:
                credentials.model,

              character:
                sessionCharacterId,

              voice:
                sessionVoiceName
            }
          );


          clearTimeout(
            setupTimer
          );


          setupTimer =
            setTimeout(
              () => {

                if (
                  !setupComplete
                ) {

                  console.error(
                    "[NEYO Voice] Setup timeout"
                  );


                  setPhase(
                    "error"
                  );


                  stopConversation();
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
              message
            );

          } catch (error) {

            console.error(
              "[NEYO Voice] Message error:",
              error
            );
          }
        };


      socket.onerror =
        error => {

          console.error(
            "[NEYO Voice] Socket error:",
            error
          );


          setPhase(
            "error"
          );
        };


      socket.onclose =
        event => {

          debug(
            "Socket closed",
            {
              code:
                event.code,

              reason:
                event.reason ||
                "(none)",

              clean:
                event.wasClean
            }
          );


          socket =
            null;


          if (
            !stopping &&
            (
              active ||
              connecting
            )
          ) {

            stopConversation({
              closeSocket:
                false
            });
          }
        };


    } catch (error) {

      console.error(
        "[NEYO Voice] Start failed:",
        error
      );


      setPhase(
        "error"
      );


      await cleanupSession();


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
     CLEANUP
     ===================================================== */

  async function cleanupSession() {

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


    active =
      false;

    connecting =
      false;

    setupComplete =
      false;


    assistantSpeaking =
      false;

    responsePending =
      false;


    await stopMicrophone();

    stopPlayback();


    userTranscriptBuffer =
      "";

    assistantTranscriptBuffer =
      "";


    syncUi();
  }


  /* =====================================================
     STOP
     ===================================================== */

  async function stopConversation({
    closeSocket = true,
    closeUi = true
  } = {}) {

    if (stopping) {
      return;
    }


    if (
      !active &&
      !connecting &&
      !socket
    ) {

      if (closeUi) {

        window
          .NeyoVoiceMode
          ?.close
          ?.({
            stopVoice:
              false
          });
      }


      return;
    }


    stopping =
      true;


    const currentSocket =
      socket;


    socket =
      null;


    await cleanupSession();


    if (
      closeSocket &&
      currentSocket
    ) {

      try {

        currentSocket.close(
          1000,
          "Voice session ended"
        );

      } catch {}
    }


    stopping =
      false;


    lastPhase =
      "";

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
      "Conversation stopped"
    );
  }


  /* =====================================================
     CHARACTER CHANGE

     Voice is session-scoped.
     Character changes during a running session
     require a fresh Live session.
     ===================================================== */

  async function restartForCharacter(
    characterId
  ) {

    const wasRunning =
      active ||
      connecting;


    if (!wasRunning) {
      return;
    }


    debug(
      "Restarting for character",
      characterId
    );


    await stopConversation({
      closeSocket:
        true,

      closeUi:
        false
    });


    /*
    Give previous socket a tiny moment
    to release audio/session resources.
    */

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          120
        )
    );


    await startConversation();
  }


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


      emit(
        "neyo:voice-character-changed",
        {
          character:
            id,

          voice:
            CHARACTER_VOICES[id] ||
            getActiveVoiceName()
        }
      );


      if (
        active ||
        connecting
      ) {

        restartForCharacter(
          id
        );
      }
    }
  );


  /* =====================================================
     MAIN BUTTON
     ===================================================== */

  micBtn.addEventListener(
    "click",
    event => {

      event.preventDefault();


      if (
        connecting ||
        stopping
      ) {

        return;
      }


      if (active) {

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
          connecting
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

      restartForCharacter,

      setMuted,

      setSpeakerEnabled,

      getActiveVoiceName,

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

          setupComplete,

          character:
            sessionCharacterId,

          voice:
            sessionVoiceName,

          muted,

          speakerEnabled
        }),

      getVoiceMap:
        () => ({
          ...CHARACTER_VOICES
        }),

      engine:
        "gemini-live-character-aware-v5"
    });


  /* =====================================================
     INIT
     ===================================================== */

  resetWaveform();

  syncUi();


  debug(
    "Engine ready",
    {
      selectedCharacter:
        getActiveCharacterId(),

      selectedVoice:
        getActiveVoiceName(),

      voiceMap:
        CHARACTER_VOICES
    }
  );

})();
