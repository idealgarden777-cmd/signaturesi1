/*
=========================================================
NEYO — GEMINI LIVE VOICE ENGINE
NEYO-ONLY DEBUG LOCK

Temporary validation build

Hard lock:
- Character: neyo
- Voice: Kore

Goal:
- Prove Neyo always starts with Kore
- Remove stale character state
- Remove hot-switch complexity temporarily
- Keep voice mode open on errors
- No page refresh required

After Neyo is verified repeatedly,
we will re-enable Zadi, then Wizi.
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
     HARD LOCK
     ===================================================== */

  const FORCE_NEYO_ONLY =
    true;

  const LOCKED_CHARACTER =
    "neyo";

  const LOCKED_VOICE =
    "Kore";


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

      debug:
        true
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


  let sessionCharacterId =
    LOCKED_CHARACTER;

  let sessionVoiceName =
    LOCKED_VOICE;


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
     MICROPHONE
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
     OUTPUT
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
     HELPERS
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


  function setPhase(
    phase,
    detail = {}
  ) {

    if (
      phase ===
      lastPhase
    ) {
      return;
    }


    lastPhase =
      phase;


    emit(
      `neyo:voice-${phase}`,
      {
        character:
          LOCKED_CHARACTER,

        voice:
          LOCKED_VOICE,

        ...detail
      }
    );
  }


  /* =====================================================
     HARD CHARACTER ENFORCEMENT
     ===================================================== */

  function forceNeyoIdentity() {

    if (
      window.NeyoCharacters
    ) {

      window.NeyoCharacters.active =
        LOCKED_CHARACTER;
    }


    sessionCharacterId =
      LOCKED_CHARACTER;


    sessionVoiceName =
      LOCKED_VOICE;


    try {

      window
        .NeyoMascot
        ?.setCharacter
        ?.(
          LOCKED_CHARACTER,
          {
            resetMood:
              false
          }
        );

    } catch {}


    debug(
      "Identity forced",
      {
        character:
          sessionCharacterId,

        voice:
          sessionVoiceName
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
        active ||
        connecting
      );


    composerInputRow
      .classList
      .toggle(
        "is-processing-transcription",
        connecting
      );


    micBtn.setAttribute(
      "aria-pressed",
      String(
        active ||
        connecting
      )
    );


    if (connecting) {

      micBtn.dataset.tooltip =
        "Connecting";

      micBtn.setAttribute(
        "aria-label",
        "Connecting Neyo voice"
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
        String(
          connecting
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

    if (
      !active &&
      !connecting
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
     RESAMPLING
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
      atob(value);


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
        binary.charCodeAt(i);
    }


    return output;
  }


  /* =====================================================
     AUDIO OUTPUT
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
        mimeType || ""
      ).match(
        /rate=(\d+)/i
      );


    const rate =
      Number(
        match?.[1]
      );


    return (
      Number.isFinite(rate) &&
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
     CONTROLS
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

     ALWAYS request NEYO.
     ===================================================== */

  async function fetchVoiceToken() {

    const character =
      FORCE_NEYO_ONLY
        ? LOCKED_CHARACTER
        : LOCKED_CHARACTER;


    debug(
      "Requesting token",
      {
        character,
        expectedVoice:
          LOCKED_VOICE
      }
    );


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
              character
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


    debug(
      "Token response",
      data
    );


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


    /*
    HARD VERIFICATION.
    */

    if (
      data.character !==
      LOCKED_CHARACTER
    ) {

      throw new Error(
        `Expected character neyo, received ${data.character}.`
      );
    }


    if (
      data.voice !==
      LOCKED_VOICE
    ) {

      throw new Error(
        `Expected Kore voice, received ${data.voice}.`
      );
    }


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


    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;


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


      setupComplete =
        true;

      connecting =
        false;

      active =
        true;


      lastPhase =
        "";


      setPhase(
        "listening"
      );


      syncUi();

      ensureWaveLoop();


      debug(
        "NEYO SESSION CONFIRMED",
        {
          character:
            LOCKED_CHARACTER,

          voice:
            LOCKED_VOICE
        }
      );


      return;
    }


    const content =
      message?.serverContent;


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
            LOCKED_CHARACTER
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
            LOCKED_CHARACTER
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
        "interrupted"
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
            inline.mimeType || ""
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
     SETUP

     VOICE HARD LOCKED HERE TOO.
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
                  LOCKED_VOICE
              }
            }
          }
        },


        systemInstruction: {

          parts: [
            {
              text:
                "You are Neyo, a natural, intelligent and friendly conversational AI assistant. Respond naturally in the user's language. Keep spoken replies concise unless more detail is useful. Do not mention internal voice configuration."
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

  async function startConversation() {

    if (
      active ||
      connecting ||
      stopping
    ) {
      return;
    }


    forceNeyoIdentity();


    connecting =
      true;

    setupComplete =
      false;


    syncUi();


    window
      .NeyoVoiceMode
      ?.open
      ?.();


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


      ensureWaveLoop();


      const credentials =
        await fetchVoiceToken();


      /*
      HARD CHECK AGAIN.
      */

      if (
        credentials.character !==
          LOCKED_CHARACTER ||
        credentials.voice !==
          LOCKED_VOICE
      ) {

        throw new Error(
          "Neyo voice identity mismatch."
        );
      }


      sessionCharacterId =
        LOCKED_CHARACTER;

      sessionVoiceName =
        LOCKED_VOICE;


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

          socket.send(
            JSON.stringify(
              buildSetupMessage(
                credentials
              )
            )
          );


          debug(
            "SETUP SENT",
            {
              character:
                LOCKED_CHARACTER,

              voice:
                LOCKED_VOICE
            }
          );


          setupTimer =
            setTimeout(
              () => {

                if (
                  !setupComplete
                ) {

                  setPhase(
                    "error",
                    {
                      message:
                        "Voice setup timed out."
                    }
                  );
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
              JSON.parse(raw);


            await handleServerMessage(
              message,
              generation
            );

          } catch (error) {

            console.error(
              "[NEYO Voice] Message error:",
              error
            );
          }
        };


      socket.onerror =
        () => {

          setPhase(
            "error",
            {
              message:
                "Voice connection error."
            }
          );
        };


      socket.onclose =
        event => {

          debug(
            "Socket closed",
            event.code,
            event.reason
          );


          socket =
            null;


          if (
            !stopping &&
            active
          ) {

            active =
              false;

            setupComplete =
              false;


            syncUi();


            setPhase(
              "error",
              {
                message:
                  "Voice connection lost."
              }
            );
          }
        };


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

      setupComplete =
        false;


      syncUi();


      /*
      DO NOT CLOSE UI.
      */

      lastPhase =
        "";


      setPhase(
        "error",
        {
          message:
            error?.message ||
            "Couldn't connect Neyo voice."
        }
      );
    }
  }


  /* =====================================================
     STOP
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


    clearTimeout(
      sessionTimer
    );


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


    stopping =
      false;


    syncUi();


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
  }


  /* =====================================================
     CHARACTER CHANGE

     TEMPORARY DEBUG:
     Ignore Zadi/Wizi and restore Neyo.
     ===================================================== */

  window.addEventListener(
    "neyo:character-change",
    event => {

      const requested =
        event
          ?.detail
          ?.id;


      if (
        requested ===
        LOCKED_CHARACTER
      ) {
        return;
      }


      debug(
        "Ignoring character during Neyo-only test:",
        requested
      );


      forceNeyoIdentity();
    }
  );


  /* =====================================================
     BUTTONS
     ===================================================== */

  micBtn.addEventListener(
    "click",
    event => {

      event.preventDefault();


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
     PUBLIC API
     ===================================================== */

  window.NeyoVoice =
    Object.freeze({

      start:
        startConversation,

      stop:
        stopConversation,

      setMuted,

      setSpeakerEnabled,


      getActiveVoiceName:
        () =>
          LOCKED_VOICE,


      isActive:
        () =>
          active,


      isConnecting:
        () =>
          connecting,


      getSessionInfo:
        () => ({

          forceNeyoOnly:
            FORCE_NEYO_ONLY,

          active,

          connecting,

          setupComplete,

          character:
            LOCKED_CHARACTER,

          voice:
            LOCKED_VOICE,

          muted,

          speakerEnabled
        }),


      engine:
        "gemini-live-neyo-only-debug"
    });


  /* =====================================================
     INIT
     ===================================================== */

  forceNeyoIdentity();

  resetWaveform();

  syncUi();


  console.log(
    "[NEYO Voice] NEYO-ONLY LOCK ACTIVE",
    {
      character:
        LOCKED_CHARACTER,

      voice:
        LOCKED_VOICE
    }
  );

})();
