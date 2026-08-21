/*
=========================================================
NEYO — GEMINI LIVE VOICE ENGINE v7
HOT SWITCH + ERROR SAFE

Fixed character voices:
- Neyo → Kore
- Zadi → Orus
- Wizi → Charon

Goals:
- No page refresh
- No voice-mode close during character switch
- No microphone restart during character switch
- No camera restart
- No stale previous-character audio
- Server-authoritative character + voice
- Voice screen stays open on connection error
- Natural interruption + VAD
- Real mic/output energy
- Hidden transcription for mascot intelligence
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
     LOCAL VOICE MAP

     Server remains final authority.
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

  let switchRequestId =
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
     SESSION IDENTITY
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
        active ||
        connecting ||
        switchingCharacter
      );


    composerInputRow
      .classList
      .toggle(
        "is-processing-transcription",
        connecting ||
        switchingCharacter
      );


    micBtn.setAttribute(
      "aria-pressed",
      String(
        active ||
        connecting
      )
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
      !connecting &&
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
     PCM HELPERS
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


    if (
      !samples.length
    ) {
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
     MIC / SPEAKER CONTROLS
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
     ===================================================== */

  async function fetchVoiceToken(
    characterId
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
        "Invalid voice token response."
      );
    }


    if (
      data.character !==
      characterId
    ) {

      throw new Error(
        `Voice identity mismatch: expected ${characterId}, got ${data.character}.`
      );
    }


    return data;
  }


  /* =====================================================
     MICROPHONE PIPELINE
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
        .getAudioTracks()[0] ||
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
      "Microphone pipeline ready"
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
     MESSAGE DECODER
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


      const wasSwitching =
        switchingCharacter;


      switchingCharacter =
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
        "Session ready",
        {
          character:
            sessionCharacterId,

          voice:
            sessionVoiceName
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
      `Respond naturally in the user's language.`,
      `Do not mention voice configuration or internal character metadata.`,
      `Do not repeatedly introduce yourself.`,
      `Keep normal spoken replies concise unless detail is useful.`,
      `Allow natural interruption.`
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
     SOCKET CLEANUP
     ===================================================== */

  function detachAndCloseSocket(
    reason =
      "Replacing voice session"
  ) {

    const oldSocket =
      socket;


    socket =
      null;


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
     CONNECT
     ===================================================== */

  async function connectLiveSession(
    credentials
  ) {

    sessionCharacterId =
      credentials.character;


    sessionVoiceName =
      credentials.voice;


    await ensureOutputContext();

    await ensureMicrophone();


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

        let settled =
          false;


        const fail =
          error => {

            if (settled) {
              return;
            }


            settled =
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
                !settled
              ) {

                settled =
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


            if (
              socket ===
              newSocket
            ) {

              socket =
                null;
            }


            debug(
              "Socket closed",
              {
                code:
                  event.code,

                reason:
                  event.reason ||
                  "(none)"
              }
            );


            if (
              !stopping &&
              !switchingCharacter &&
              active
            ) {

              active =
                false;

              setupComplete =
                false;


              syncUi();


              lastPhase =
                "";


              setPhase(
                "error",
                {
                  message:
                    "Voice connection lost."
                }
              );
            }
          };
      }
    );
  }


  /* =====================================================
     START
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


    const characterId =
      getActiveCharacterId();


    sessionCharacterId =
      characterId;


    sessionVoiceName =
      getLocalVoiceForCharacter(
        characterId
      );


    userTranscriptBuffer =
      "";

    assistantTranscriptBuffer =
      "";


    syncUi();


    /*
    OPEN UI ONCE.
    Do not close it automatically on error.
    */

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
        await fetchVoiceToken(
          characterId
        );


      sessionCharacterId =
        credentials.character;

      sessionVoiceName =
        credentials.voice;


      await connectLiveSession(
        credentials
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

      setupComplete =
        false;

      switchingCharacter =
        false;


      detachAndCloseSocket(
        "Start failed"
      );


      /*
      IMPORTANT:
      KEEP microphone + voice-mode alive.
      User can retry without refresh.
      */


      syncUi();


      lastPhase =
        "";


      setPhase(
        "error",
        {
          message:
            error?.message ||
            "Couldn't connect."
        }
      );


      emit(
        "neyo:voice-start-error",
        {
          message:
            error?.message ||
            "Couldn't connect."
        }
      );
    }
  }


  /* =====================================================
     HOT CHARACTER SWITCH
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


    setActiveCharacterLocally(
      characterId
    );


    const expectedVoice =
      getLocalVoiceForCharacter(
        characterId
      );


    /*
    If voice mode is not live,
    only update next-session identity.
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


    const requestId =
      ++switchRequestId;


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
    Stop OLD character speech immediately.
    */

    stopPlayback();


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
    Replace socket only.
    Do not destroy mic/audio context.
    */

    detachAndCloseSocket(
      `Switching to ${characterId}`
    );


    /*
    Keep voice mode alive.
    */

    active =
      true;


    ensureWaveLoop();


    lastPhase =
      "";


    setPhase(
      "thinking",
      {
        switching:
          true
      }
    );


    try {

      const credentials =
        await fetchVoiceToken(
          characterId
        );


      /*
      Newer selection wins.
      */

      if (
        requestId !==
        switchRequestId ||
        getActiveCharacterId() !==
          characterId
      ) {

        debug(
          "Discarded stale character switch",
          characterId
        );


        return false;
      }


      sessionCharacterId =
        credentials.character;

      sessionVoiceName =
        credentials.voice;


      await connectLiveSession(
        credentials
      );


      if (
        requestId !==
        switchRequestId
      ) {
        return false;
      }


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
        "Hot switch complete",
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


      if (
        requestId !==
        switchRequestId
      ) {

        return false;
      }


      switchingCharacter =
        false;

      active =
        false;

      setupComplete =
        false;


      syncUi();


      /*
      KEEP voice-mode open.
      KEEP microphone alive.
      */

      lastPhase =
        "";


      setPhase(
        "error",
        {
          message:
            error?.message ||
            "Couldn't switch character."
        }
      );


      emit(
        "neyo:voice-character-error",
        {
          character:
            characterId,

          message:
            error?.message ||
            "Couldn't switch character."
        }
      );


      return false;
    }
  }


  /* =====================================================
     FULL STOP
     ===================================================== */

  async function stopConversation({
    closeUi = true
  } = {}) {

    if (stopping) {
      return;
    }


    stopping =
      true;


    ++switchRequestId;


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


    connecting =
      false;

    active =
      false;

    setupComplete =
      false;

    switchingCharacter =
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
     CHARACTER CHANGE EVENT
     ===================================================== */

  let lastCharacterEventId =
    null;

  let characterEventQueued =
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


      if (
        characterEventQueued &&
        lastCharacterEventId ===
          id
      ) {
        return;
      }


      lastCharacterEventId =
        id;

      characterEventQueued =
        true;


      queueMicrotask(
        () => {

          characterEventQueued =
            false;


          switchCharacter(
            id
          );
        }
      );
    }
  );


  /* =====================================================
     BUTTON EVENTS
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


      getActiveVoiceName:
        () =>
          getLocalVoiceForCharacter(
            getActiveCharacterId()
          ),


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
        "gemini-live-hot-switch-v7"
    });


  /* =====================================================
     INIT
     ===================================================== */

  sessionCharacterId =
    getActiveCharacterId();


  sessionVoiceName =
    getLocalVoiceForCharacter(
      sessionCharacterId
    );


  resetWaveform();

  syncUi();


  debug(
    "Engine ready",
    {
      character:
        sessionCharacterId,

      voice:
        sessionVoiceName,

      voices:
        CHARACTER_VOICES
    }
  );

})();
