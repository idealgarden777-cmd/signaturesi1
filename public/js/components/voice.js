/*
=========================================================
NEYO — LIVE VOICE
STABLE BASELINE

Gemini Live + Ephemeral Token

Flow:
Mic
→ /api/voice-token
→ BidiGenerateContentConstrained
→ setupComplete
→ microphone PCM 16 kHz
→ Gemini native audio
→ smooth browser playback

NO:
- SpeechRecognition
- MediaRecorder
- /api/transcribe
- AudioWorklet
- custom VAD
- Search grounding
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     BUTTON ISOLATION
     ===================================================== */

  function isolateButton(element) {
    if (!element) return null;

    const clone =
      element.cloneNode(true);

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

      /*
      IMPORTANT:
      Ephemeral tokens use the Constrained endpoint.
      */

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
        0.08
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


  /* =====================================================
     MICROPHONE STATE
     ===================================================== */

  let micStream =
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
    "[NEYO Voice] Stable Live baseline loaded"
  );


  /* =====================================================
     UI
     ===================================================== */

  function syncUi() {

    composerInputRow.classList.toggle(
      "is-transcribing",
      connecting || active
    );


    composerInputRow.classList.toggle(
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


    analyser.getByteTimeDomainData(
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
     FLOAT32 → PCM16 LE
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
      context.createBufferSource();


    source.buffer =
      buffer;


    source.connect(
      context.destination
    );


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
            "Accept":
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


    /*
    Stable baseline.
    ScriptProcessor warning is acceptable for now.
    */

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


  /* =====================================================
     STOP MICROPHONE
     ===================================================== */

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


      micStream =
        null;
    }


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


    if (
      ArrayBuffer.isView(data)
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
     SERVER MESSAGE
     ===================================================== */

  async function handleServerMessage(
    message
  ) {

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


      await startMicrophone();


      active =
        true;

      connecting =
        false;


      syncUi();


      resetWaveform();


      waveRaf =
        requestAnimationFrame(
          animateWave
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


    if (
      serverContent.interrupted
    ) {

      stopPlayback();
    }


    /*
    Gemini 3.1 may return multiple parts.
    Process all of them.
    */

    const parts =
      serverContent
        ?.modelTurn
        ?.parts ||
      [];


    for (
      const part
      of parts
    ) {

      const inline =
        part?.inlineData;


      if (!inline?.data) {
        continue;
      }


      if (
        String(
          inline.mimeType ||
          ""
        ).startsWith(
          "audio/"
        )
      ) {

        await playAudioChunk(
          inline.data,
          inline.mimeType
        );
      }
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


    connecting =
      true;


    setupComplete =
      false;


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


      /*
      Unlock output on user gesture.
      */

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
          Constrained token setup.

          Keep this minimal until baseline
          is confirmed working.
          */

          const setupMessage = {

            setup: {

              model:
                `models/${credentials.model}`,

              generationConfig: {

                responseModalities: [
                  "AUDIO"
                ]
              }
            }
          };


          socket.send(
            JSON.stringify(
              setupMessage
            )
          );


          console.log(
            "[NEYO Voice] Setup sent"
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


      syncUi();
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


    syncUi();


    stopping =
      false;


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


  stopRecBtn?.addEventListener(
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
      once: true
    }
  );


  /* =====================================================
     INIT
     ===================================================== */

  resetWaveform();

  syncUi();


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

      engine:
        "gemini-live-stable-constrained"
    });

})();
