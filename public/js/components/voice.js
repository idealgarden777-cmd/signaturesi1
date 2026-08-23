(() => {
  "use strict";

  const VERSION = "neyo-live-voice-v2";

  if (window.NeyoVoice?.__controller === true) return;

  const CONFIG = Object.freeze({
    tokenEndpoint: "/api/voice-token",

    websocketEndpoint:
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",

    inputSampleRate: 16000,
    outputSampleRate: 24000,

    processorBufferSize: 4096,
    analyserFftSize: 256,

    setupTimeoutMs: 12000,
    maxSessionMs: 28 * 60 * 1000,

    playbackLeadSeconds: 0.06,

    vadPrefixPaddingMs: 90,
    vadSilenceDurationMs: 760,

    vadStartSensitivity:
      "START_SENSITIVITY_HIGH",

    vadEndSensitivity:
      "END_SENSITIVITY_LOW",

    defaultCharacter: "neyo",
    defaultVoice: "Kore"
  });

  let socket = null;
  let socketGeneration = 0;

  let connecting = false;
  let active = false;
  let stopping = false;
  let setupComplete = false;

  let setupTimer = 0;
  let sessionTimer = 0;

  let selectedCharacter =
    getInitialCharacter();

  let sessionCharacter =
    selectedCharacter;

  let sessionVoice =
    CONFIG.defaultVoice;

  let muted = false;
  let speakerEnabled = true;

  let assistantSpeaking = false;
  let responsePending = false;
  let phase = "idle";

  let userTranscript = "";
  let assistantTranscript = "";

  let micStream = null;
  let micTrack = null;

  let inputContext = null;
  let micSource = null;
  let processorNode = null;
  let silentGain = null;

  let analyser = null;
  let analyserData = null;
  let browserInputRate = 48000;

  let micAnimationFrame = 0;
  let smoothMicLevel = 0;

  let outputContext = null;
  let masterGain = null;

  let nextPlaybackTime = 0;
  let playbackStarted = false;

  const playingSources =
    new Set();

  function emit(name, detail = {}) {
    window.dispatchEvent(
      new CustomEvent(name, {
        detail
      })
    );
  }

  function clamp(value, min, max) {
    return Math.max(
      min,
      Math.min(max, value)
    );
  }

  function cleanId(value) {
    return (
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 40) ||
      CONFIG.defaultCharacter
    );
  }

  function getInitialCharacter() {
    const value =
      window.NeyoCharacters?.active;

    return typeof value === "string" &&
      value.trim()
      ? cleanId(value)
      : CONFIG.defaultCharacter;
  }

  function setPhase(next, detail = {}) {
    if (
      phase === next &&
      !detail.force
    ) {
      return;
    }

    phase = next;

    emit(
      `neyo:voice-${next}`,
      {
        character:
          sessionCharacter,

        voice:
          sessionVoice,

        ...detail
      }
    );

    emit(
      "neyo:voice-state",
      {
        state:
          next,

        character:
          sessionCharacter,

        voice:
          sessionVoice,

        ...detail
      }
    );
  }

  function reportError(message, error = null) {
    const value =
      String(
        message ||
          "Voice connection failed."
      );

    emit(
      "neyo:voice-error",
      {
        message:
          value,

        error,

        character:
          sessionCharacter,

        voice:
          sessionVoice
      }
    );
  }

  function setCharacter(value) {
    selectedCharacter =
      cleanId(value);

    emit(
      "neyo:voice-character",
      {
        character:
          selectedCharacter
      }
    );

    return selectedCharacter;
  }

  function appendTranscript(
    current,
    chunk
  ) {
    const value =
      String(chunk || "")
        .trim();

    if (!value) {
      return current;
    }

    if (!current) {
      return value;
    }

    if (value.startsWith(current)) {
      return value;
    }

    if (current.endsWith(value)) {
      return current;
    }

    return `${current} ${value}`
      .replace(/\s+/g, " ")
      .trim();
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const size = 32768;

    for (
      let index = 0;
      index < bytes.length;
      index += size
    ) {
      binary +=
        String.fromCharCode(
          ...bytes.subarray(
            index,
            Math.min(
              index + size,
              bytes.length
            )
          )
        );
    }

    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary =
      atob(value);

    const output =
      new Uint8Array(
        binary.length
      );

    for (
      let index = 0;
      index < binary.length;
      index++
    ) {
      output[index] =
        binary.charCodeAt(index);
    }

    return output;
  }

  function resampleFloat32(
    input,
    sourceRate,
    targetRate
  ) {
    if (
      sourceRate === targetRate
    ) {
      return new Float32Array(input);
    }

    const ratio =
      sourceRate / targetRate;

    const outputLength =
      Math.max(
        1,
        Math.floor(
          input.length / ratio
        )
      );

    const output =
      new Float32Array(
        outputLength
      );

    for (
      let index = 0;
      index < outputLength;
      index++
    ) {
      const position =
        index * ratio;

      const left =
        Math.floor(position);

      const fraction =
        position - left;

      const a =
        input[
          Math.min(
            left,
            input.length - 1
          )
        ] || 0;

      const b =
        input[
          Math.min(
            left + 1,
            input.length - 1
          )
        ] || a;

      output[index] =
        a + (b - a) * fraction;
    }

    return output;
  }

  function float32ToPcm16(samples) {
    const bytes =
      new Uint8Array(
        samples.length * 2
      );

    const view =
      new DataView(
        bytes.buffer
      );

    for (
      let index = 0;
      index < samples.length;
      index++
    ) {
      const sample =
        clamp(
          samples[index],
          -1,
          1
        );

      const integer =
        sample < 0
          ? sample * 32768
          : sample * 32767;

      view.setInt16(
        index * 2,
        integer,
        true
      );
    }

    return bytes;
  }

  function pcm16ToFloat32(bytes) {
    const length =
      Math.floor(
        bytes.byteLength / 2
      );

    const output =
      new Float32Array(length);

    const view =
      new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength
      );

    for (
      let index = 0;
      index < length;
      index++
    ) {
      const value =
        view.getInt16(
          index * 2,
          true
        );

      output[index] =
        value /
        (
          value < 0
            ? 32768
            : 32767
        );
    }

    return output;
  }

  async function fetchVoiceToken(
    character
  ) {
    const requestedCharacter =
      cleanId(character);

    const response =
      await fetch(
        CONFIG.tokenEndpoint,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",

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

    let data = null;

    try {
      data =
        JSON.parse(raw);
    } catch {}

    if (!response.ok) {
      throw new Error(
        data?.error ||
          raw ||
          `Voice token failed (${response.status}).`
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

    return {
      ...data,

      character:
        cleanId(
          data.character ||
            requestedCharacter
        ),

      voice:
        String(
          data.voice ||
            CONFIG.defaultVoice
        ).trim() ||
        CONFIG.defaultVoice
    };
  }

  async function ensureOutputContext() {
    if (
      outputContext &&
      outputContext.state !== "closed"
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
      speakerEnabled ? 1 : 0;

    masterGain.connect(
      outputContext.destination
    );

    nextPlaybackTime =
      outputContext.currentTime;

    return outputContext;
  }

  function getSampleRate(
    mimeType
  ) {
    const match =
      String(mimeType || "")
        .match(
          /rate=(\d+)/i
        );

    const value =
      Number(match?.[1]);

    return Number.isFinite(value) &&
      value > 0
      ? value
      : CONFIG.outputSampleRate;
  }

  function outputLevel(samples) {
    if (!samples.length) {
      return 0;
    }

    let sum = 0;

    for (
      let index = 0;
      index < samples.length;
      index++
    ) {
      sum +=
        samples[index] *
        samples[index];
    }

    const rms =
      Math.sqrt(
        sum / samples.length
      );

    return clamp(
      (rms - 0.008) / 0.16,
      0,
      1
    );
  }

  async function playAudio(
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

    const samples =
      pcm16ToFloat32(
        base64ToBytes(base64)
      );

    if (!samples.length) return;

    emit(
      "neyo:voice-output-level",
      {
        level:
          outputLevel(samples)
      }
    );

    const buffer =
      context.createBuffer(
        1,
        samples.length,
        getSampleRate(mimeType)
      );

    buffer
      .getChannelData(0)
      .set(samples);

    const source =
      context.createBufferSource();

    source.buffer =
      buffer;

    source.connect(
      masterGain ||
        context.destination
    );

    if (!assistantSpeaking) {
      assistantSpeaking = true;
      responsePending = false;

      setPhase("speaking");
    }

    if (!playbackStarted) {
      nextPlaybackTime =
        Math.max(
          context.currentTime +
            CONFIG.playbackLeadSeconds,
          nextPlaybackTime
        );

      playbackStarted = true;

    } else if (
      nextPlaybackTime <
      context.currentTime + 0.01
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

    playingSources.add(source);

    source.addEventListener(
      "ended",
      () => {
        playingSources.delete(source);
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

    playbackStarted = false;
    assistantSpeaking = false;
    responsePending = false;

    if (outputContext) {
      nextPlaybackTime =
        outputContext.currentTime;
    }

    emit(
      "neyo:voice-output-level",
      {
        level: 0
      }
    );
  }

  function calculateMicLevel() {
    if (
      !analyser ||
      !analyserData
    ) {
      return 0;
    }

    analyser.getByteTimeDomainData(
      analyserData
    );

    let sum = 0;

    for (
      let index = 0;
      index < analyserData.length;
      index++
    ) {
      const sample =
        (
          analyserData[index] -
          128
        ) /
        128;

      sum +=
        sample * sample;
    }

    return Math.sqrt(
      sum /
        analyserData.length
    );
  }

  function updateMicLevel() {
    if (
      !active &&
      !connecting
    ) {
      micAnimationFrame = 0;
      smoothMicLevel = 0;

      emit(
        "neyo:voice-mic-level",
        {
          level: 0
        }
      );

      return;
    }

    const rms =
      calculateMicLevel();

    const target =
      muted
        ? 0
        : clamp(
            (rms - 0.012) /
              0.11,
            0,
            1
          );

    const smoothing =
      target > smoothMicLevel
        ? 0.3
        : 0.1;

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

    micAnimationFrame =
      requestAnimationFrame(
        updateMicLevel
      );
  }

  function startMicLevel() {
    if (micAnimationFrame) return;

    micAnimationFrame =
      requestAnimationFrame(
        updateMicLevel
      );
  }

  function stopMicLevel() {
    if (micAnimationFrame) {
      cancelAnimationFrame(
        micAnimationFrame
      );

      micAnimationFrame = 0;
    }

    smoothMicLevel = 0;

    emit(
      "neyo:voice-mic-level",
      {
        level: 0
      }
    );
  }

  async function ensureMicrophone() {
    if (
      micStream &&
      inputContext &&
      processorNode
    ) {
      return;
    }

    if (
      !navigator.mediaDevices
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
      await navigator.mediaDevices
        .getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },

          video: false
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
      inputContext.createAnalyser();

    analyser.fftSize =
      CONFIG.analyserFftSize;

    analyser.smoothingTimeConstant =
      0.82;

    analyserData =
      new Uint8Array(
        analyser.fftSize
      );

    micSource.connect(analyser);

    processorNode =
      inputContext
        .createScriptProcessor(
          CONFIG.processorBufferSize,
          1,
          1
        );

    silentGain =
      inputContext.createGain();

    silentGain.gain.value = 0;

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

    startMicLevel();
  }

  async function destroyMicrophone() {
    if (processorNode) {
      processorNode.onaudioprocess =
        null;

      try {
        processorNode.disconnect();
      } catch {}

      processorNode = null;
    }

    if (micSource) {
      try {
        micSource.disconnect();
      } catch {}

      micSource = null;
    }

    if (analyser) {
      try {
        analyser.disconnect();
      } catch {}

      analyser = null;
    }

    analyserData = null;

    if (silentGain) {
      try {
        silentGain.disconnect();
      } catch {}

      silentGain = null;
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

    micStream = null;
    micTrack = null;

    if (
      inputContext &&
      inputContext.state !==
        "closed"
    ) {
      try {
        await inputContext.close();
      } catch {}
    }

    inputContext = null;

    stopMicLevel();
  }

  async function decodeSocketMessage(
    data
  ) {
    if (
      typeof data === "string"
    ) {
      return data;
    }

    if (data instanceof Blob) {
      return data.text();
    }

    if (
      data instanceof ArrayBuffer
    ) {
      return new TextDecoder()
        .decode(data);
    }

    return new TextDecoder()
      .decode(data);
  }

  function buildSystemInstruction(
    credentials
  ) {
    const provided =
      credentials?.systemInstruction ||
      credentials?.system_instruction ||
      credentials?.instructions;

    if (
      typeof provided === "string" &&
      provided.trim()
    ) {
      return provided.trim();
    }

    const name =
      String(
        credentials?.characterName ||
          credentials?.character ||
          sessionCharacter ||
          "Neyo"
      ).trim();

    return (
      `You are ${name}, a natural conversational AI assistant. ` +
      "Respond naturally in the user's language. " +
      "Keep spoken responses concise unless more detail is useful."
    );
  }

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
                  sessionVoice
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
            disabled: false,

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

    if (message?.setupComplete) {
      clearTimeout(setupTimer);
      setupTimer = 0;

      setupComplete = true;
      connecting = false;
      active = true;

      startMicLevel();

      setPhase(
        "listening",
        {
          force: true
        }
      );

      emit(
        "neyo:voice-session-ready",
        {
          character:
            sessionCharacter,

          voice:
            sessionVoice
        }
      );

      return;
    }

    const content =
      message?.serverContent;

    if (!content) return;

    const userText =
      content
        ?.inputTranscription
        ?.text;

    if (userText) {
      userTranscript =
        appendTranscript(
          userTranscript,
          userText
        );

      emit(
        "neyo:voice-user-text",
        {
          text:
            userTranscript,

          character:
            sessionCharacter
        }
      );
    }

    const assistantText =
      content
        ?.outputTranscription
        ?.text;

    if (assistantText) {
      assistantTranscript =
        appendTranscript(
          assistantTranscript,
          assistantText
        );

      emit(
        "neyo:voice-assistant-text",
        {
          text:
            assistantTranscript,

          character:
            sessionCharacter
        }
      );
    }

    if (content.interrupted) {
      stopPlayback();

      setPhase(
        "listening",
        {
          interrupted: true,
          force: true
        }
      );

      emit(
        "neyo:voice-interrupted",
        {
          character:
            sessionCharacter
        }
      );

      return;
    }

    const parts =
      content?.modelTurn?.parts ||
      [];

    if (content.modelTurn) {
      if (!assistantSpeaking) {
        responsePending = true;

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
          ).startsWith("audio/")
        ) {
          continue;
        }

        await playAudio(
          inline.data,
          inline.mimeType,
          generation
        );
      }
    }

    if (content.turnComplete) {
      const finish =
        () => {
          if (
            generation !==
            socketGeneration
          ) {
            return;
          }

          if (
            playingSources.size > 0
          ) {
            setTimeout(
              finish,
              25
            );

            return;
          }

          assistantSpeaking = false;
          responsePending = false;

          userTranscript = "";
          assistantTranscript = "";

          emit(
            "neyo:voice-output-level",
            {
              level: 0
            }
          );

          if (active) {
            setPhase(
              "listening",
              {
                force: true
              }
            );
          }
        };

      finish();
    }
  }

  async function start({
    character
  } = {}) {
    if (
      active ||
      connecting ||
      stopping
    ) {
      return false;
    }

    selectedCharacter =
      cleanId(
        character ||
          selectedCharacter
      );

    sessionCharacter =
      selectedCharacter;

    sessionVoice =
      CONFIG.defaultVoice;

    connecting = true;
    setupComplete = false;

    userTranscript = "";
    assistantTranscript = "";

    setPhase(
      "thinking",
      {
        connecting: true,
        force: true
      }
    );

    emit(
      "neyo:voice-connecting",
      {
        character:
          sessionCharacter
      }
    );

    try {
      await ensureOutputContext();
      await ensureMicrophone();

      const credentials =
        await fetchVoiceToken(
          sessionCharacter
        );

      if (
        !connecting ||
        stopping
      ) {
        return false;
      }

      sessionCharacter =
        cleanId(
          credentials.character ||
            sessionCharacter
        );

      sessionVoice =
        credentials.voice ||
        CONFIG.defaultVoice;

      const generation =
        ++socketGeneration;

      socket =
        new WebSocket(
          `${CONFIG.websocketEndpoint}?access_token=${
            encodeURIComponent(
              credentials.token
            )
          }`
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
            window.setTimeout(
              () => {
                if (
                  !setupComplete &&
                  generation ===
                    socketGeneration
                ) {
                  reportError(
                    "Voice setup timed out."
                  );

                  void stop({
                    reason:
                      "setup-timeout"
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
          if (
            generation !==
            socketGeneration
          ) {
            return;
          }

          reportError(
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

          socket = null;

          if (
            !stopping &&
            (
              active ||
              connecting
            )
          ) {
            active = false;
            connecting = false;
            setupComplete = false;

            setPhase(
              "idle",
              {
                force: true
              }
            );

            reportError(
              "Voice connection lost."
            );
          }
        };

      clearTimeout(
        sessionTimer
      );

      sessionTimer =
        window.setTimeout(
          () => {
            void stop({
              reason:
                "session-limit"
            });
          },
          CONFIG.maxSessionMs
        );

      return true;

    } catch (error) {
      connecting = false;
      active = false;
      setupComplete = false;

      ++socketGeneration;

      if (socket) {
        try {
          socket.onclose =
            null;

          socket.close();
        } catch {}

        socket = null;
      }

      stopPlayback();
      await destroyMicrophone();

      setPhase(
        "idle",
        {
          force: true
        }
      );

      reportError(
        error?.message ||
          "Couldn't connect voice.",
        error
      );

      return false;
    }
  }

  async function stop({
    reason = "user"
  } = {}) {
    if (stopping) {
      return false;
    }

    if (
      !active &&
      !connecting &&
      !socket &&
      !micStream
    ) {
      return true;
    }

    stopping = true;

    clearTimeout(setupTimer);
    clearTimeout(sessionTimer);

    setupTimer = 0;
    sessionTimer = 0;

    active = false;
    connecting = false;
    setupComplete = false;

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

      socket = null;
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

    outputContext = null;
    masterGain = null;

    nextPlaybackTime = 0;
    playbackStarted = false;

    userTranscript = "";
    assistantTranscript = "";

    stopping = false;

    setPhase(
      "idle",
      {
        reason,
        force: true
      }
    );

    emit(
      "neyo:voice-session-ended",
      {
        reason
      }
    );

    return true;
  }

  function setMuted(value) {
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

    return muted;
  }

  function setSpeakerEnabled(
    value
  ) {
    speakerEnabled =
      Boolean(value);

    if (masterGain) {
      masterGain.gain.value =
        speakerEnabled ? 1 : 0;
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

  window.addEventListener(
    "neyo:character-change",
    event => {
      const next =
        cleanId(
          event.detail?.id ||
          event.detail
            ?.character
        );

      selectedCharacter =
        next;

      emit(
        "neyo:voice-character",
        {
          character:
            next
        }
      );

      if (
        active ||
        connecting
      ) {
        emit(
          "neyo:voice-restart-required",
          {
            character:
              next
          }
        );
      }
    }
  );

  const api =
    Object.freeze({
      __controller: true,
      version: VERSION,

      start,
      stop,

      setMuted,
      setSpeakerEnabled,
      setCharacter,

      getCharacter() {
        return selectedCharacter;
      },

      getActiveVoiceName() {
        return sessionVoice;
      },

      isActive() {
        return active;
      },

      isConnecting() {
        return connecting;
      },

      getSessionInfo() {
        return {
          version:
            VERSION,

          active,
          connecting,
          stopping,
          setupComplete,

          phase,

          character:
            sessionCharacter,

          selectedCharacter,

          voice:
            sessionVoice,

          muted,
          speakerEnabled,

          assistantSpeaking,
          responsePending
        };
      },

      engine:
        "gemini-live"
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

  emit(
    "neyo:voice-ready",
    {
      version:
        VERSION,

      character:
        selectedCharacter
    }
  );
})();
