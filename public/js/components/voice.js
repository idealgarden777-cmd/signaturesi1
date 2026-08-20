/*
=========================================================
NEYO — LIVE VOICE
FINAL PRODUCTION BASELINE

Features:
- Gemini 3.1 Flash Live
- Ephemeral token
- BidiGenerateContentConstrained
- Fixed Kore voice
- Continuous microphone
- Server-side VAD
- Natural 850ms silence window
- Deterministic listening / thinking / speaking
- Interruption / barge-in
- Real mic RMS
- Real output RMS
- Hidden input transcription
- Hidden output transcription
- Mascot tone events
- Mic mute
- Speaker mute

NO:
- Browser SpeechRecognition
- MediaRecorder transcription
- Mock responses
- Transcript injection into chat
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     BUTTON ISOLATION
     ===================================================== */

  function isolateButton(element) {
    if (!element) return null;

    const clone = element.cloneNode(true);
    element.replaceWith(clone);

    return clone;
  }


  const micBtn =
    isolateButton(
      document.getElementById("micBtn")
    );

  const stopRecBtn =
    isolateButton(
      document.getElementById("stopRecBtn")
    );


  /* =====================================================
     DOM
     ===================================================== */

  const composerInputRow =
    document.querySelector(
      ".composer-input-row"
    );

  const waveform =
    document.getElementById(
      "waveDotsBar"
    );


  if (!micBtn || !composerInputRow) {
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

      inputSampleRate:
        16000,

      outputSampleRate:
        24000,

      processorBufferSize:
        4096,

      analyserFftSize:
        256,

      setupTimeoutMs:
        10000,

      maxSessionMs:
        30 * 60 * 1000,

      playbackLeadSeconds:
        0.08,

      vadPrefixPaddingMs:
        80,

      vadSilenceDurationMs:
        850,

      vadStartSensitivity:
        "START_SENSITIVITY_HIGH",

      vadEndSensitivity:
        "END_SENSITIVITY_LOW",

      voiceName:
        "Kore"
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


  let assistantSpeaking =
    false;

  let assistantResponsePending =
    false;


  /* =====================================================
     TRANSCRIPTION STATE
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

  const playingSources =
    new Set();


  /* =====================================================
     WAVEFORM STATE
     ===================================================== */

  let waveRaf =
    0;

  let smoothLevel =
    0;


  console.log(
    `[NEYO Voice] Production engine loaded (${CONFIG.voiceName})`
  );


  /* =====================================================
     EVENT BRIDGE
     ===================================================== */

  function setVoiceState(
    state,
    detail = {}
  ) {
    window.dispatchEvent(
      new CustomEvent(
        `neyo:voice-${state}`,
        {
          detail
        }
      )
    );
  }


  function emitUserText(text) {
    const value =
      String(text || "")
        .trim();

    if (!value) return;


    window.dispatchEvent(
      new CustomEvent(
        "neyo:voice-user-text",
        {
          detail: {
            text:
              value
          }
        }
      )
    );
  }


  function emitAssistantText(text) {
    const value =
      String(text || "")
        .trim();

    if (!value) return;


    window.dispatchEvent(
      new CustomEvent(
        "neyo:voice-assistant-text",
        {
          detail: {
            text:
              value
          }
        }
      )
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
        connecting || active
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

    smoothLevel =
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
  }


  function calculateRms() {

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
        ) / 128;


      sum +=
        sample * sample;
    }


    return Math.sqrt(
      sum /
      analyserData.length
    );
  }


  function animateWave(timestamp) {

    if (!active) {
      return;
    }


    const rms =
      calculateRms();


    const target =
      Math.max(
        0,
        Math.min(
          1,
          (rms - 0.012) /
          0.11
        )
      );


    const smoothing =
      target > smoothLevel
        ? 0.30
        : 0.10;


    smoothLevel +=
      (
        target -
        smoothLevel
      ) *
      smoothing;


    /*
    Mascot listening energy
    */

    window.dispatchEvent(
      new CustomEvent(
        "neyo:voice-mic-level",
        {
          detail: {
            level:
              smoothLevel
          }
        }
      )
    );


    const bars =
      getWaveBars();


    const center =
      Math.max(
        1,
        (bars.length - 1) / 2
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
          distance * 0.45;


        const movement =
          0.84 +
          Math.sin(
            timestamp * 0.005 +
            index * 0.85
          ) *
          0.16;


        const energy =
          Math.max(
            0,
            Math.min(
              1,
              smoothLevel *
              weight *
              movement
            )
          );


        bar.style.height =
          `${(
            3 +
            energy * 21
          ).toFixed(2)}px`;


        bar.style.opacity =
          `${(
            0.32 +
            energy * 0.63
          ).toFixed(3)}`;
      }
    );


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
      i < outputLength;
      i += 1
    ) {

      const start =
        Math.floor(
          i * ratio
        );


      const end =
        Math.max(
          start + 1,
          Math.min(
            input.length,
            Math.floor(
              (i + 1) *
              ratio
            )
          )
        );


      let sum =
        0;

      let count =
        0;


      for (
        let j = start;
        j < end;
        j += 1
      ) {

        sum +=
          input[j];

        count +=
          1;
      }


      output[i] =
        count
          ? sum / count
          : 0;
    }


    return output;
  }


  /* =====================================================
     FLOAT32 → PCM16
     ===================================================== */

  function float32ToPcm16(samples) {

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
        Math.max(
          -1,
          Math.min(
            1,
            samples[i]
          )
        );


      const integer =
        sample < 0
          ? sample * 32768
          : sample * 32767;


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

  function pcm16ToFloat32(bytes) {

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
      i < count;
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

  function bytesToBase64(bytes) {

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


  function base64ToBytes(value) {

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
      i < binary.length;
      i += 1
    ) {

      bytes[i] =
        binary.charCodeAt(i);
    }


    return bytes;
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
      outputContext.createGain();


    masterGain.gain.value =
      1;


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


    if (!samples.length) {
      return;
    }


    /*
    Real assistant output RMS
    */

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


    const outputRms =
      Math.sqrt(
        sum /
        samples.length
      );


    const outputLevel =
      Math.max(
        0,
        Math.min(
          1,
          (outputRms - 0.01) /
          0.16
        )
      );


    window.dispatchEvent(
      new CustomEvent(
        "neyo:voice-output-level",
        {
          detail: {
            level:
              outputLevel
          }
        }
      )
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
      .set(samples);


    const source =
      context
        .createBufferSource();


    source.buffer =
      buffer;


    source.connect(
      masterGain ||
      context.destination
    );


    /*
    First real audio chunk
    = Speaking
    */

    if (!assistantSpeaking) {

      assistantSpeaking =
        true;

      assistantResponsePending =
        false;

      setVoiceState(
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
        once: true
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


    if (outputContext) {

      nextPlaybackTime =
        outputContext.currentTime;
    }


    assistantSpeaking =
      false;

    assistantResponsePending =
      false;


    window.dispatchEvent(
      new CustomEvent(
        "neyo:voice-output-level",
        {
          detail: {
            level: 0
          }
        }
      )
    );
  }


  /* =====================================================
     MIC MUTE
     ===================================================== */

  function setMuted(muted) {

    const value =
      Boolean(muted);


    if (micTrack) {

      micTrack.enabled =
        !value;
    }


    window.dispatchEvent(
      new CustomEvent(
        "neyo:voice-muted",
        {
          detail: {
            muted:
              value
          }
        }
      )
    );
  }


  /* =====================================================
     SPEAKER MUTE
     ===================================================== */

  function setSpeakerEnabled(enabled) {

    const value =
      Boolean(enabled);


    if (masterGain) {

      masterGain.gain.value =
        value
          ? 1
          : 0;
    }


    window.dispatchEvent(
      new CustomEvent(
        "neyo:voice-speaker",
        {
          detail: {
            enabled:
              value
          }
        }
      )
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


    const tracks =
      micStream
        .getAudioTracks();


    micTrack =
      tracks[0] ||
      null;


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
          !socket ||
          socket.readyState !==
            WebSocket.OPEN
        ) {
          return;
        }


        if (
          micTrack &&
          !micTrack.enabled
        ) {
          return;
        }


        const input =
          event.inputBuffer
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
      };


    console.log(
      "[NEYO Voice] Microphone active",
      {
        browserRate:
          browserInputRate,

        liveRate:
          CONFIG.inputSampleRate
      }
    );
  }


  async function stopMicrophone() {

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
      ).decode(data);
    }


    if (
      ArrayBuffer.isView(data)
    ) {

      return new TextDecoder(
        "utf-8"
      ).decode(data);
    }


    throw new Error(
      "Unsupported Gemini message type."
    );
  }


  /* =====================================================
     TRANSCRIPTION
     ===================================================== */

  function handleTranscription(
    serverContent
  ) {

    const inputText =
      serverContent
        ?.inputTranscription
        ?.text;


    if (inputText) {

      userTranscriptBuffer +=
        (
          userTranscriptBuffer
            ? " "
            : ""
        ) +
        inputText;


      emitUserText(
        userTranscriptBuffer
      );
    }


    const outputText =
      serverContent
        ?.outputTranscription
        ?.text;


    if (outputText) {

      assistantTranscriptBuffer +=
        (
          assistantTranscriptBuffer
            ? " "
            : ""
        ) +
        outputText;


      emitAssistantText(
        assistantTranscriptBuffer
      );
    }
  }


  /* =====================================================
     SERVER MESSAGE
     ===================================================== */

  async function handleServerMessage(
    message
  ) {

    /* ---------------------------------------------
       SETUP COMPLETE
       --------------------------------------------- */

    if (
      message?.setupComplete
    ) {

      console.log(
        "[NEYO Voice] Gemini setup complete"
      );


      clearTimeout(
        setupTimer
      );


      setupTimer =
        0;


      setupComplete =
        true;


      userTranscriptBuffer =
        "";

      assistantTranscriptBuffer =
        "";


      await startMicrophone();


      active =
        true;

      connecting =
        false;


      assistantSpeaking =
        false;

      assistantResponsePending =
        false;


      syncUi();


      resetWaveform();


      waveRaf =
        requestAnimationFrame(
          animateWave
        );


      setVoiceState(
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


      console.log(
        "[NEYO Voice] Conversation active"
      );


      return;
    }


    const serverContent =
      message?.serverContent;


    if (!serverContent) {
      return;
    }


    /*
    Hidden transcription for tone engine.
    Never rendered into chat UI.
    */

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


      assistantSpeaking =
        false;

      assistantResponsePending =
        false;


      assistantTranscriptBuffer =
        "";


      setVoiceState(
        "interrupted"
      );


      setTimeout(
        () => {

          if (
            active &&
            !assistantSpeaking
          ) {

            setVoiceState(
              "listening"
            );
          }

        },
        140
      );


      return;
    }


    /* ---------------------------------------------
       MODEL AUDIO
       --------------------------------------------- */

    const parts =
      serverContent
        ?.modelTurn
        ?.parts ||
      [];


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
          inline.mimeType || ""
        ).startsWith(
          "audio/"
        )
      ) {
        continue;
      }


      hasAudio =
        true;


      if (!assistantSpeaking) {

        assistantSpeaking =
          true;

        assistantResponsePending =
          false;


        setVoiceState(
          "speaking"
        );
      }


      await playAudioChunk(
        inline.data,
        inline.mimeType
      );
    }


    /* ---------------------------------------------
       THINKING
       --------------------------------------------- */

    if (
      serverContent.modelTurn &&
      !hasAudio &&
      !assistantSpeaking
    ) {

      assistantResponsePending =
        true;


      setVoiceState(
        "thinking"
      );
    }


    /* ---------------------------------------------
       TURN COMPLETE
       --------------------------------------------- */

    if (
      serverContent.turnComplete
    ) {

      assistantResponsePending =
        false;


      const waitForPlayback =
        () => {

          if (
            playingSources.size > 0
          ) {

            setTimeout(
              waitForPlayback,
              30
            );

            return;
          }


          assistantSpeaking =
            false;


          userTranscriptBuffer =
            "";

          assistantTranscriptBuffer =
            "";


          window.dispatchEvent(
            new CustomEvent(
              "neyo:voice-output-level",
              {
                detail: {
                  level: 0
                }
              }
            )
          );


          if (active) {

            setVoiceState(
              "listening"
            );
          }
        };


      waitForPlayback();
    }
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


    window
      .NeyoVoiceMode
      ?.open
      ?.();


    setVoiceState(
      "listening"
    );


    connecting =
      true;

    setupComplete =
      false;


    userTranscriptBuffer =
      "";

    assistantTranscriptBuffer =
      "";


    syncUi();


    try {

      if (
        !navigator
          .mediaDevices
          ?.getUserMedia
      ) {

        throw new Error(
          "Microphone unavailable."
        );
      }


      await ensureOutputContext();


      const credentials =
        await fetchVoiceToken();


      console.log(
        "[NEYO Voice] Token received",
        credentials.model
      );


      const socketUrl =
        `${CONFIG.websocketEndpoint}?access_token=${
          encodeURIComponent(
            credentials.token
          )
        }`;


      socket =
        new WebSocket(
          socketUrl
        );


      socket.binaryType =
        "arraybuffer";


      socket.onopen =
        () => {

          console.log(
            "[NEYO Voice] WebSocket opened"
          );


          /*
          IMPORTANT:
          inputAudioTranscription and
          outputAudioTranscription are
          setup-level fields.
          */

          const setupMessage = {

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
                        CONFIG.voiceName
                    }
                  }
                }
              },


              /*
              Hidden transcription.

              These are NOT inside
              generationConfig.
              */

              inputAudioTranscription:
                {},


              outputAudioTranscription:
                {},


              realtimeInputConfig: {

                automaticActivityDetection: {

                  disabled:
                    false,


                  startOfSpeechSensitivity:
                    CONFIG.vadStartSensitivity,


                  endOfSpeechSensitivity:
                    CONFIG.vadEndSensitivity,


                  prefixPaddingMs:
                    CONFIG.vadPrefixPaddingMs,


                  silenceDurationMs:
                    CONFIG.vadSilenceDurationMs
                }
              }
            }
          };


          socket.send(
            JSON.stringify(
              setupMessage
            )
          );


          console.log(
            "[NEYO Voice] Setup sent",
            {
              voice:
                CONFIG.voiceName,

              transcription:
                true,

              vadSilenceMs:
                CONFIG.vadSilenceDurationMs
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
                    "[NEYO Voice] Setup timed out"
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
              "[NEYO Voice] Invalid server message:",
              error
            );
          }
        };


      socket.onerror =
        event => {

          console.error(
            "[NEYO Voice] WebSocket error:",
            event
          );


          setVoiceState(
            "error"
          );
        };


      socket.onclose =
        event => {

          console.log(
            "[NEYO Voice] SOCKET CLOSED",
            {
              code:
                event.code,

              reason:
                event.reason ||
                "(no reason)",

              clean:
                event.wasClean
            }
          );


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


      connecting =
        false;

      active =
        false;

      setupComplete =
        false;


      clearTimeout(
        setupTimer
      );


      setupTimer =
        0;


      await stopMicrophone();


      stopPlayback();


      if (socket) {

        try {
          socket.close();
        } catch {}


        socket =
          null;
      }


      userTranscriptBuffer =
        "";

      assistantTranscriptBuffer =
        "";


      syncUi();


      window
        .NeyoVoiceMode
        ?.close
        ?.({
          stopVoice:
            false
        });


      setVoiceState(
        "error"
      );
    }
  }


  /* =====================================================
     STOP
     ===================================================== */

  async function stopConversation({
    closeSocket = true
  } = {}) {

    if (stopping) {
      return;
    }


    if (
      !active &&
      !connecting &&
      !socket
    ) {
      return;
    }


    stopping =
      true;


    active =
      false;

    connecting =
      false;

    setupComplete =
      false;


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


    await stopMicrophone();


    stopPlayback();


    if (
      closeSocket &&
      socket
    ) {

      try {

        socket.close(
          1000,
          "User ended voice conversation"
        );

      } catch {}
    }


    socket =
      null;


    userTranscriptBuffer =
      "";

    assistantTranscriptBuffer =
      "";


    syncUi();


    stopping =
      false;


    window
      .NeyoVoiceMode
      ?.close
      ?.({
        stopVoice:
          false
      });


    setVoiceState(
      "idle"
    );


    console.log(
      "[NEYO Voice] Conversation stopped"
    );
  }


  /* =====================================================
     EVENTS
     ===================================================== */

  micBtn.addEventListener(
    "click",
    event => {

      event.preventDefault();

      event.stopPropagation();

      event.stopImmediatePropagation();


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
    },
    true
  );


  stopRecBtn
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();

        event.stopPropagation();

        event.stopImmediatePropagation();


        stopConversation();
      },
      true
    );


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


  window.addEventListener(
    "pagehide",
    () => {

      stopConversation();

    },
    {
      once:
        true
    }
  );


  /* =====================================================
     INIT
     ===================================================== */

  resetWaveform();

  syncUi();

  setVoiceState(
    "idle"
  );


  window.NeyoVoice =
    Object.freeze({

      start:
        startConversation,

      stop:
        stopConversation,

      isActive:
        () => active,

      isConnecting:
        () => connecting,

      setMuted,

      setSpeakerEnabled,

      engine:
        "gemini-live-natural-vad-tone"
    });


  console.log(
    "[NEYO Voice] Ready"
  );

})();
