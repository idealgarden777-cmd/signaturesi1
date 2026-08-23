/*
=========================================================
NEYO — VOICE ENGINE
FINAL PRODUCTION MIXER v12

FILE:
public/js/components/voice.js

PRIMARY ENGINE
---------------------------------------------------------
Gemini Live conversational voice

/api/voice-token
    ↓
Gemini Live WebSocket
    ↓
16 kHz PCM microphone
    ↓
native Gemini audio
    ↓
24 kHz browser playback

PRESERVED FALLBACK ENGINE
---------------------------------------------------------
Stable transcription / dictation

MediaRecorder
    ↓
audio Blob
    ↓
POST /api/transcribe
    ↓
transcript event

OWNS
---------------------------------------------------------
- Gemini Live transport
- Ephemeral voice-token request
- Microphone audio transport
- PCM conversion / resampling
- WebSocket lifecycle
- Gemini setup message
- VAD configuration
- Native audio playback
- Input/output transcription events
- Interruption handling
- Mic mute transport state
- Speaker transport state
- Character voice-session selection
- Session cleanup
- Unexpected socket cleanup
- Stable MediaRecorder transcription API
- Audio-level events
- Voice lifecycle events

DOES NOT OWN
---------------------------------------------------------
- Composer mic button
- Fullscreen voice shell
- Camera
- Waveform DOM
- Status DOM
- Mascot DOM / face
- Character picker DOM
- Composer transcript insertion
- Chat sending
- History

IMPORTANT
---------------------------------------------------------
voice-mode.js owns the visible voice experience.

mascot.js owns face animation.

character-picker.js owns character picker UI.

A transcription fallback emits transcript events; the
consumer decides where the transcript is inserted.

MIGRATION RULE
---------------------------------------------------------
This module is independent of neo.js.

No button cloning.
No legacy DOM takeover.
No direct voice-mode manipulation.

After neo.js removal this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-voice-final-v12";

  if (
    window.NeyoVoice
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      tokenEndpoint:
        "/api/voice-token",

      transcribeEndpoint:
        "/api/transcribe",

      websocketEndpoint:
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",

      inputSampleRate:
        16_000,

      outputSampleRate:
        24_000,

      processorBufferSize:
        4096,

      analyserFftSize:
        256,

      setupTimeoutMs:
        12_000,

      tokenTimeoutMs:
        15_000,

      transcribeTimeoutMs:
        90_000,

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
        "Kore",

      dictationMaxMs:
        120_000,

      dictationMinimumMs:
        350
    });

  /* =====================================================
     TELEMETRY ONLY
     ===================================================== */

  const legacyScriptPresent =
    Array
      .from(
        document.scripts || []
      )
      .some(
        script =>
          /(?:^|\/)neo\.js(?:\?|$)/
            .test(
              script.src || ""
            )
      );

  /* =====================================================
     LIVE SESSION STATE
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

  let lastPhase =
    "idle";

  let setupTimer =
    0;

  let sessionTimer =
    0;

  let tokenController =
    null;

  let selectedCharacterId =
    getInitialCharacter();

  let sessionCharacterId =
    selectedCharacterId;

  let sessionVoiceName =
    CONFIG.defaultVoice;

  /* =====================================================
     TURN STATE
     ===================================================== */

  let assistantSpeaking =
    false;

  let responsePending =
    false;

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
    48_000;

  let muted =
    false;

  let micRaf =
    0;

  let smoothMicLevel =
    0;

  /* =====================================================
     OUTPUT AUDIO
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
     DICTATION FALLBACK
     ===================================================== */

  let dictationRecorder =
    null;

  let dictationStream =
    null;

  let dictationChunks =
    [];

  let dictationStartedAt =
    0;

  let dictationTimer =
    0;

  let dictating =
    false;

  let transcribing =
    false;

  let transcribeController =
    null;

  /* =====================================================
     METRICS
     ===================================================== */

  const metrics = {
    sessionsStarted:
      0,

    sessionsCompleted:
      0,

    unexpectedCloses:
      0,

    interruptions:
      0,

    userTranscripts:
      0,

    assistantTranscripts:
      0,

    dictations:
      0,

    transcriptions:
      0,

    lastStartedAt:
      null,

    lastEndedAt:
      null,

    lastError:
      null
  };

  /* =====================================================
     HELPERS
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

  function cleanId(
    value
  ) {
    return (
      String(
        value || ""
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
        ) ||
      CONFIG.defaultCharacter
    );
  }

  function cleanText(
    value,
    max = 20_000
  ) {
    return String(
      value ?? ""
    )
      .replace(
        /\u0000/g,
        ""
      )
      .trim()
      .slice(
        0,
        max
      );
  }

  function getInitialCharacter() {
    const registry =
      window.NeyoCharacters;

    if (
      typeof registry?.active ===
        "string" &&
      registry.active.trim()
    ) {
      return cleanId(
        registry.active
      );
    }

    return CONFIG
      .defaultCharacter;
  }

  /* =====================================================
     CHARACTER
     ===================================================== */

  function setSelectedCharacter(
    id
  ) {
    selectedCharacterId =
      cleanId(
        id
      );

    return selectedCharacterId;
  }

  function setCharacter(
    id
  ) {
    const next =
      setSelectedCharacter(
        id
      );

    /*
     * Live Gemini voice configuration belongs to
     * the session setup.
     *
     * Do not silently destroy/restart transport from
     * this low-level engine.
     */

    if (
      active ||
      connecting
    ) {
      emit(
        "neyo:voice-restart-required",
        {
          reason:
            "character-change",

          character:
            next,

          currentCharacter:
            sessionCharacterId
        }
      );

    } else {
      sessionCharacterId =
        next;
    }

    emit(
      "neyo:voice-character",
      {
        character:
          next
      }
    );

    return next;
  }

  /* =====================================================
     PHASE
     ===================================================== */

  function setPhase(
    phase,
    detail = {}
  ) {
    const allowed =
      new Set([
        "idle",
        "listening",
        "thinking",
        "speaking"
      ]);

    const next =
      allowed.has(
        phase
      )
        ? phase
        : "idle";

    if (
      next ===
        lastPhase &&
      !detail.force
    ) {
      return next;
    }

    lastPhase =
      next;

    const eventDetail =
      {
        phase:
          next,

        character:
          sessionCharacterId ||
          selectedCharacterId,

        voice:
          sessionVoiceName,

        active,

        connecting,

        ...detail
      };

    emit(
      `neyo:voice-${next}`,
      eventDetail
    );

    emit(
      "neyo:voice-state",
      eventDetail
    );

    /*
     * Compatibility event for older consumers.
     */

    document.dispatchEvent(
      new CustomEvent(
        "voice:state-change",
        {
          detail: {
            state:
              next,

            ...eventDetail
          }
        }
      )
    );

    return next;
  }

  /* =====================================================
     ERROR
     ===================================================== */

  function reportError(
    error,
    detail = {}
  ) {
    const message =
      cleanText(
        error?.message ||
        error ||
        "Voice connection failed.",
        1500
      );

    metrics.lastError =
      message;

    console.error(
      "[NEYO Voice]",
      message
    );

    emit(
      "neyo:voice-error",
      {
        message,

        character:
          sessionCharacterId,

        voice:
          sessionVoiceName,

        ...detail
      }
    );

    return message;
  }

  /* =====================================================
     FETCH WITH TIMEOUT
     ===================================================== */

  async function fetchWithTimeout(
    url,
    options,
    timeoutMs,
    externalController =
      null
  ) {
    const controller =
      externalController ||
      new AbortController();

    const timer =
      window.setTimeout(
        () => {
          try {
            controller.abort(
              "timeout"
            );

          } catch {
            try {
              controller.abort();
            } catch {}
          }
        },
        timeoutMs
      );

    try {
      return await fetch(
        url,
        {
          ...options,

          signal:
            controller.signal
        }
      );

    } finally {
      window.clearTimeout(
        timer
      );
    }
  }

  /* =====================================================
     PCM — RESAMPLE
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
      let index = 0;
      index <
        outputLength;
      index += 1
    ) {
      const position =
        index *
        ratio;

      const sourceIndex =
        Math.floor(
          position
        );

      const fraction =
        position -
        sourceIndex;

      const a =
        input[
          Math.min(
            sourceIndex,
            input.length - 1
          )
        ] ||
        0;

      const b =
        input[
          Math.min(
            sourceIndex + 1,
            input.length - 1
          )
        ] ||
        a;

      output[index] =
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
     FLOAT32 -> PCM16
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
      let index = 0;
      index <
        samples.length;
      index += 1
    ) {
      const sample =
        clamp(
          samples[index],
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
        index * 2,
        integer,
        true
      );
    }

    return bytes;
  }

  /* =====================================================
     PCM16 -> FLOAT32
     ===================================================== */

  function pcm16ToFloat32(
    bytes
  ) {
    const count =
      Math.floor(
        bytes.byteLength /
        2
      );

    const result =
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
      let index = 0;
      index <
        count;
      index += 1
    ) {
      const value =
        view.getInt16(
          index * 2,
          true
        );

      result[index] =
        value /
        (
          value < 0
            ? 32768
            : 32767
        );
    }

    return result;
  }

  /* =====================================================
     BASE64
     ===================================================== */

  function bytesToBase64(
    bytes
  ) {
    let binary =
      "";

    const size =
      32_768;

    for (
      let index = 0;
      index <
        bytes.length;
      index += size
    ) {
      const chunk =
        bytes.subarray(
          index,
          Math.min(
            index + size,
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

    const bytes =
      new Uint8Array(
        binary.length
      );

    for (
      let index = 0;
      index <
        binary.length;
      index += 1
    ) {
      bytes[index] =
        binary.charCodeAt(
          index
        );
    }

    return bytes;
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
      let index = 0;
      index <
        analyserData.length;
      index += 1
    ) {
      const sample =
        (
          analyserData[index] -
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
          smoothMicLevel,

        rms
      }
    );

    /*
     * Compatibility energy event.
     */

    document.dispatchEvent(
      new CustomEvent(
        "voice:energy",
        {
          detail: {
            rms
          }
        }
      )
    );

    micRaf =
      requestAnimationFrame(
        animateMicLevel
      );
  }

  function ensureMicLevelLoop() {
    if (
      micRaf
    ) {
      return;
    }

    micRaf =
      requestAnimationFrame(
        animateMicLevel
      );
  }

  function stopMicLevelLoop() {
    if (
      micRaf
    ) {
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
     MICROPHONE
     ===================================================== */

  async function ensureMicrophone() {
    if (
      micStream &&
      inputContext &&
      processorNode
    ) {
      return true;
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

    if (
      !AudioContextClass
    ) {
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

    if (
      micTrack
    ) {
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

    analyser
      .smoothingTimeConstant =
      0.82;

    analyserData =
      new Uint8Array(
        analyser.fftSize
      );

    micSource.connect(
      analyser
    );

    /*
     * ScriptProcessor remains intentionally used here
     * because this is the proven production baseline and
     * does not require an additional worklet file.
     */

    processorNode =
      inputContext
        .createScriptProcessor(
          CONFIG
            .processorBufferSize,
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

    processorNode
      .onaudioprocess =
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
            CONFIG
              .inputSampleRate
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

    return true;
  }

  /* =====================================================
     DESTROY MICROPHONE
     ===================================================== */

  async function destroyMicrophone() {
    if (
      processorNode
    ) {
      processorNode
        .onaudioprocess =
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

    analyserData =
      null;

    if (
      silentGain
    ) {
      try {
        silentGain.disconnect();
      } catch {}

      silentGain =
        null;
    }

    if (
      micStream
    ) {
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

    if (
      !AudioContextClass
    ) {
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

  /* =====================================================
     OUTPUT LEVEL
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
      let index = 0;
      index <
        samples.length;
      index += 1
    ) {
      sum +=
        samples[index] *
        samples[index];
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

  function getSampleRateFromMime(
    mime
  ) {
    const match =
      String(
        mime || ""
      )
        .match(
          /rate=(\d+)/i
        );

    const value =
      Number(
        match?.[1]
      );

    return (
      Number.isFinite(
        value
      ) &&
      value >
        0
    )
      ? value
      : CONFIG
          .outputSampleRate;
  }

  /* =====================================================
     PLAY AUDIO CHUNK
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
      return false;
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
      samples.length ===
      0
    ) {
      return false;
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
            CONFIG
              .playbackLeadSeconds,

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
        CONFIG
          .playbackLeadSeconds;
    }

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

    source.start(
      nextPlaybackTime
    );

    nextPlaybackTime +=
      buffer.duration;

    return true;
  }

  /* =====================================================
     STOP PLAYBACK
     ===================================================== */

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

    if (
      outputContext
    ) {
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
     DESTROY OUTPUT
     ===================================================== */

  async function destroyOutput() {
    stopPlayback();

    if (
      masterGain
    ) {
      try {
        masterGain.disconnect();
      } catch {}

      masterGain =
        null;
    }

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

    nextPlaybackTime =
      0;

    playbackStarted =
      false;
  }

  /* =====================================================
     MUTE
     ===================================================== */

  function setMuted(
    value
  ) {
    muted =
      Boolean(
        value
      );

    if (
      micTrack
    ) {
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

    return speakerEnabled;
  }

  /* =====================================================
     TOKEN
     ===================================================== */

  async function fetchVoiceToken(
    character
  ) {
    const requestedCharacter =
      cleanId(
        character
      );

    if (
      tokenController
    ) {
      try {
        tokenController.abort(
          "superseded"
        );
      } catch {}
    }

    tokenController =
      new AbortController();

    try {
      const response =
        await fetchWithTimeout(
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
                "application/json",

              "X-Neyo-Voice-Client":
                VERSION
            },

            body:
              JSON.stringify({
                character:
                  requestedCharacter
              })
          },
          CONFIG.tokenTimeoutMs,
          tokenController
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

      if (
        !response.ok
      ) {
        throw new Error(
          data?.error ||
          data?.message ||
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
          cleanText(
            data.voice ||
            CONFIG.defaultVoice,
            80
          ) ||
          CONFIG.defaultVoice
      };

    } finally {
      tokenController =
        null;
    }
  }

  /* =====================================================
     TRANSCRIPT MERGE
     ===================================================== */

  function appendTranscript(
    current,
    chunk
  ) {
    const value =
      cleanText(
        chunk
      );

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
      )
        .decode(
          data
        );
    }

    return new TextDecoder(
      "utf-8"
    )
      .decode(
        data
      );
  }

  /* =====================================================
     TURN COMPLETE
     ===================================================== */

  function finishTurnWhenPlaybackEnds(
    generation
  ) {
    const check =
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
          window.setTimeout(
            check,
            25
          );

          return;
        }

        assistantSpeaking =
          false;

        responsePending =
          false;

        const userText =
          userTranscriptBuffer;

        const assistantText =
          assistantTranscriptBuffer;

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

        emit(
          "neyo:voice-turn-complete",
          {
            userText,

            assistantText,

            character:
              sessionCharacterId
          }
        );

        if (
          active
        ) {
          setPhase(
            "listening"
          );
        }
      };

    check();
  }

  /* =====================================================
     HANDLE GEMINI MESSAGE
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

    if (
      userText
    ) {
      userTranscriptBuffer =
        appendTranscript(
          userTranscriptBuffer,
          userText
        );

      metrics.userTranscripts +=
        1;

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

    if (
      assistantText
    ) {
      assistantTranscriptBuffer =
        appendTranscript(
          assistantTranscriptBuffer,
          assistantText
        );

      metrics.assistantTranscripts +=
        1;

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

    /* =================================================
       INTERRUPTION
       ================================================= */

    if (
      content.interrupted
    ) {
      metrics.interruptions +=
        1;

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

    /* =================================================
       MODEL TURN
       ================================================= */

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
          )
            .startsWith(
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
      finishTurnWhenPlaybackEnds(
        generation
      );
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
      return provided
        .trim();
    }

    const name =
      cleanText(
        credentials
          ?.characterName ||
        credentials
          ?.character ||
        sessionCharacterId ||
        "Neyo",
        80
      ) ||
      "Neyo";

    return (
      `You are ${name}, a natural, intelligent and friendly conversational AI assistant. ` +
      "Respond naturally in the user's language. Keep spoken replies concise unless more detail is useful. " +
      "Do not mention internal voice configuration."
    );
  }

  /* =====================================================
     GEMINI SETUP
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

        /*
         * Preserve production input + output transcripts.
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
     ===================================================== */

  function closeSocket(
    reason =
      "Voice ended"
  ) {
    socketGeneration +=
      1;

    const current =
      socket;

    socket =
      null;

    if (!current) {
      return;
    }

    current.onopen =
      null;

    current.onmessage =
      null;

    current.onerror =
      null;

    current.onclose =
      null;

    try {
      if (
        current.readyState ===
          WebSocket.OPEN ||
        current.readyState ===
          WebSocket.CONNECTING
      ) {
        current.close(
          1000,
          reason
        );
      }
    } catch {}
  }

  /* =====================================================
     RESOURCE CLEANUP
     ===================================================== */

  async function cleanupLiveResources({
    closeWebSocket =
      true
  } = {}) {
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

    if (
      tokenController
    ) {
      try {
        tokenController.abort(
          "voice-cleanup"
        );
      } catch {}

      tokenController =
        null;
    }

    if (
      closeWebSocket
    ) {
      closeSocket();
    }

    stopPlayback();

    await Promise.allSettled([
      destroyMicrophone(),
      destroyOutput()
    ]);

    userTranscriptBuffer =
      "";

    assistantTranscriptBuffer =
      "";

    assistantSpeaking =
      false;

    responsePending =
      false;
  }

  /* =====================================================
     UNEXPECTED SOCKET CLOSE

     Critical production fix:
     old live engine changed flags but could leave the
     microphone/audio context alive after connection loss.
     ===================================================== */

  async function handleUnexpectedClose(
    generation
  ) {
    if (
      generation !==
      socketGeneration
    ) {
      return;
    }

    socket =
      null;

    if (
      stopping
    ) {
      return;
    }

    const wasRunning =
      active ||
      connecting ||
      setupComplete;

    if (
      !wasRunning
    ) {
      return;
    }

    metrics.unexpectedCloses +=
      1;

    active =
      false;

    connecting =
      false;

    setupComplete =
      false;

    await cleanupLiveResources({
      closeWebSocket:
        false
    });

    lastPhase =
      "";

    setPhase(
      "idle",
      {
        reason:
          "connection-lost"
      }
    );

    reportError(
      "Voice connection lost.",
      {
        reason:
          "socket-close"
      }
    );

    emit(
      "neyo:voice-session-ended",
      {
        reason:
          "connection-lost"
      }
    );
  }

  /* =====================================================
     START GEMINI LIVE
     ===================================================== */

  async function startConversation({
    character
  } = {}) {
    if (
      active
    ) {
      return true;
    }

    if (
      connecting ||
      stopping
    ) {
      return false;
    }

    /*
     * Dictation and Gemini Live never compete for mic.
     */

    if (
      dictating ||
      transcribing
    ) {
      return false;
    }

    sessionCharacterId =
      cleanId(
        character ||
        selectedCharacterId ||
        getInitialCharacter()
      );

    selectedCharacterId =
      sessionCharacterId;

    sessionVoiceName =
      CONFIG.defaultVoice;

    connecting =
      true;

    active =
      false;

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

    metrics.sessionsStarted +=
      1;

    metrics.lastStartedAt =
      Date.now();

    metrics.lastError =
      null;

    lastPhase =
      "";

    setPhase(
      "thinking",
      {
        connecting:
          true
      }
    );

    emit(
      "neyo:voice-session-starting",
      {
        character:
          sessionCharacterId
      }
    );

    try {
      /*
       * User gesture generally triggered voice-mode.start,
       * therefore create/resume output context early.
       */

      await ensureOutputContext();

      await ensureMicrophone();

      const credentials =
        await fetchVoiceToken(
          sessionCharacterId
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
          sessionCharacterId
        );

      sessionVoiceName =
        cleanText(
          credentials.voice ||
          CONFIG.defaultVoice,
          80
        ) ||
        CONFIG.defaultVoice;

      const generation =
        ++socketGeneration;

      const url =
        `${CONFIG.websocketEndpoint}?access_token=${
          encodeURIComponent(
            credentials.token
          )
        }`;

      const ws =
        new WebSocket(
          url
        );

      socket =
        ws;

      ws.binaryType =
        "arraybuffer";

      /*
       * start() resolves TRUE only after setupComplete,
       * not merely after WebSocket construction.
       */

      const setupResult =
        await new Promise(
          (
            resolve,
            reject
          ) => {
            let settled =
              false;

            const finishResolve =
              value => {
                if (
                  settled
                ) {
                  return;
                }

                settled =
                  true;

                resolve(
                  value
                );
              };

            const finishReject =
              error => {
                if (
                  settled
                ) {
                  return;
                }

                settled =
                  true;

                reject(
                  error
                );
              };

            ws.onopen =
              () => {
                if (
                  generation !==
                  socketGeneration
                ) {
                  return;
                }

                try {
                  ws.send(
                    JSON.stringify(
                      buildSetupMessage(
                        credentials
                      )
                    )
                  );

                } catch (
                  error
                ) {
                  finishReject(
                    error
                  );
                }

                clearTimeout(
                  setupTimer
                );

                setupTimer =
                  window.setTimeout(
                    () => {
                      if (
                        generation !==
                          socketGeneration ||
                        setupComplete
                      ) {
                        return;
                      }

                      finishReject(
                        new Error(
                          "Voice setup timed out."
                        )
                      );
                    },
                    CONFIG
                      .setupTimeoutMs
                  );
              };

            ws.onmessage =
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

                  const hadSetup =
                    setupComplete;

                  await handleServerMessage(
                    message,
                    generation
                  );

                  if (
                    !hadSetup &&
                    setupComplete
                  ) {
                    finishResolve(
                      true
                    );
                  }

                } catch (
                  error
                ) {
                  console.warn(
                    "[NEYO Voice] Server message failed:",
                    error
                  );
                }
              };

            ws.onerror =
              () => {
                if (
                  generation !==
                  socketGeneration
                ) {
                  return;
                }

                if (
                  !setupComplete
                ) {
                  finishReject(
                    new Error(
                      "Voice connection error."
                    )
                  );

                } else {
                  emit(
                    "neyo:voice-transport-error",
                    {
                      character:
                        sessionCharacterId
                    }
                  );
                }
              };

            ws.onclose =
              () => {
                if (
                  generation !==
                  socketGeneration
                ) {
                  return;
                }

                if (
                  !setupComplete
                ) {
                  finishReject(
                    new Error(
                      "Voice connection closed during setup."
                    )
                  );

                  return;
                }

                void handleUnexpectedClose(
                  generation
                );
              };
          }
        );

      if (
        !setupResult ||
        !active
      ) {
        throw new Error(
          "Voice setup did not complete."
        );
      }

      clearTimeout(
        sessionTimer
      );

      sessionTimer =
        window.setTimeout(
          () => {
            void stopConversation({
              reason:
                "session-limit"
            });
          },
          CONFIG.maxSessionMs
        );

      return true;

    } catch (
      error
    ) {
      connecting =
        false;

      active =
        false;

      setupComplete =
        false;

      await cleanupLiveResources();

      lastPhase =
        "";

      setPhase(
        "idle",
        {
          failed:
            true
        }
      );

      reportError(
        error,
        {
          operation:
            "start"
        }
      );

      emit(
        "neyo:voice-session-ended",
        {
          reason:
            "start-failed",

          error:
            error?.message ||
            String(error)
        }
      );

      return false;
    }
  }

  /* =====================================================
     STOP LIVE SESSION
     ===================================================== */

  async function stopConversation({
    reason =
      "user"
  } = {}) {
    if (
      stopping
    ) {
      return false;
    }

    if (
      !active &&
      !connecting &&
      !socket &&
      !micStream &&
      !outputContext
    ) {
      lastPhase =
        "";

      setPhase(
        "idle",
        {
          reason
        }
      );

      return true;
    }

    stopping =
      true;

    const hadSession =
      active ||
      setupComplete;

    active =
      false;

    connecting =
      false;

    setupComplete =
      false;

    try {
      await cleanupLiveResources();

    } finally {
      stopping =
        false;
    }

    if (
      hadSession
    ) {
      metrics.sessionsCompleted +=
        1;
    }

    metrics.lastEndedAt =
      Date.now();

    lastPhase =
      "";

    setPhase(
      "idle",
      {
        reason
      }
    );

    emit(
      "neyo:voice-session-ended",
      {
        reason,

        character:
          sessionCharacterId,

        voice:
          sessionVoiceName
      }
    );

    return true;
  }

  /* =====================================================
     DICTATION MIME
     ===================================================== */

  function getSupportedDictationMimeType() {
    if (
      typeof MediaRecorder ===
      "undefined"
    ) {
      return "";
    }

    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4"
    ];

    for (
      const mime
      of candidates
    ) {
      try {
        if (
          MediaRecorder
            .isTypeSupported
            ?.(mime)
        ) {
          return mime;
        }

      } catch {}
    }

    return "";
  }

  /* =====================================================
     TRANSCRIBE BLOB
     ===================================================== */

  async function transcribeBlob(
    blob
  ) {
    if (
      !(blob instanceof Blob) ||
      blob.size === 0
    ) {
      throw new Error(
        "No voice recording available."
      );
    }

    if (
      transcribeController
    ) {
      try {
        transcribeController.abort(
          "superseded"
        );
      } catch {}
    }

    transcribeController =
      new AbortController();

    transcribing =
      true;

    emit(
      "neyo:voice-transcribing",
      {
        active:
          true
      }
    );

    try {
      const form =
        new FormData();

      const extension =
        blob.type.includes(
          "mp4"
        )
          ? "m4a"
          : blob.type.includes(
              "ogg"
            )
            ? "ogg"
            : "webm";

      form.append(
        "audio",
        blob,
        `voice-input.${extension}`
      );

      const response =
        await fetchWithTimeout(
          CONFIG
            .transcribeEndpoint,
          {
            method:
              "POST",

            credentials:
              "include",

            cache:
              "no-store",

            headers: {
              Accept:
                "application/json",

              "X-Neyo-Voice-Client":
                VERSION
            },

            body:
              form
          },
          CONFIG
            .transcribeTimeoutMs,
          transcribeController
        );

      const raw =
        await response.text();

      let data =
        {};

      try {
        data =
          JSON.parse(
            raw
          );

      } catch {}

      if (
        !response.ok
      ) {
        throw new Error(
          data?.error ||
          data?.message ||
          raw ||
          `Transcription failed (${response.status}).`
        );
      }

      const transcript =
        cleanText(
          data?.transcript ||
          data?.text ||
          ""
        );

      if (
        !transcript
      ) {
        throw new Error(
          "No transcript returned."
        );
      }

      metrics.transcriptions +=
        1;

      emit(
        "neyo:voice-transcript",
        {
          transcript,

          text:
            transcript,

          source:
            "dictation"
        }
      );

      emit(
        "neyo:voice-transcript-ready",
        {
          transcript,

          text:
            transcript,

          source:
            "dictation"
        }
      );

      return transcript;

    } finally {
      transcribeController =
        null;

      transcribing =
        false;

      emit(
        "neyo:voice-transcribing",
        {
          active:
            false
        }
      );
    }
  }

  /* =====================================================
     CLEANUP DICTATION STREAM
     ===================================================== */

  async function cleanupDictation() {
    clearTimeout(
      dictationTimer
    );

    dictationTimer =
      0;

    if (
      dictationStream
    ) {
      for (
        const track
        of dictationStream
          .getTracks()
      ) {
        try {
          track.stop();
        } catch {}
      }
    }

    dictationStream =
      null;

    dictationRecorder =
      null;
  }

  /* =====================================================
     START DICTATION
     ===================================================== */

  async function startDictation() {
    if (
      active ||
      connecting ||
      stopping ||
      dictating ||
      transcribing
    ) {
      return false;
    }

    if (
      !navigator
        .mediaDevices
        ?.getUserMedia
    ) {
      reportError(
        "Microphone unavailable.",
        {
          engine:
            "dictation"
        }
      );

      return false;
    }

    if (
      typeof MediaRecorder ===
      "undefined"
    ) {
      reportError(
        "Voice recording is unavailable in this browser.",
        {
          engine:
            "dictation"
        }
      );

      return false;
    }

    try {
      dictationStream =
        await navigator
          .mediaDevices
          .getUserMedia({
            audio: {
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

      const mime =
        getSupportedDictationMimeType();

      dictationRecorder =
        mime
          ? new MediaRecorder(
              dictationStream,
              {
                mimeType:
                  mime
              }
            )
          : new MediaRecorder(
              dictationStream
            );

      dictationChunks =
        [];

      dictationStartedAt =
        Date.now();

      dictating =
        true;

      metrics.dictations +=
        1;

      dictationRecorder
        .addEventListener(
          "dataavailable",
          event => {
            if (
              event.data &&
              event.data.size >
                0
            ) {
              dictationChunks.push(
                event.data
              );
            }
          }
        );

      const stopped =
        new Promise(
          resolve => {
            dictationRecorder
              .addEventListener(
                "stop",
                resolve,
                {
                  once:
                    true
                }
              );
          }
        );

      dictationRecorder.start();

      clearTimeout(
        dictationTimer
      );

      dictationTimer =
        window.setTimeout(
          () => {
            void stopDictation();
          },
          CONFIG
            .dictationMaxMs
        );

      emit(
        "neyo:voice-dictation-start",
        {
          mimeType:
            dictationRecorder
              .mimeType ||
            mime
        }
      );

      /*
       * Keep a safe reference for stopDictation.
       */

      dictationRecorder
        .__neyoStoppedPromise =
        stopped;

      return true;

    } catch (
      error
    ) {
      dictating =
        false;

      await cleanupDictation();

      reportError(
        error,
        {
          engine:
            "dictation"
        }
      );

      return false;
    }
  }

  /* =====================================================
     STOP DICTATION
     ===================================================== */

  async function stopDictation({
    transcribe =
      true
  } = {}) {
    if (
      !dictating ||
      !dictationRecorder
    ) {
      return null;
    }

    const recorder =
      dictationRecorder;

    const stoppedPromise =
      recorder
        .__neyoStoppedPromise ||
      Promise.resolve();

    const duration =
      Date.now() -
      dictationStartedAt;

    dictating =
      false;

    clearTimeout(
      dictationTimer
    );

    dictationTimer =
      0;

    try {
      if (
        recorder.state !==
        "inactive"
      ) {
        recorder.stop();
      }

      await stoppedPromise;

    } catch {}

    const chunks =
      [
        ...dictationChunks
      ];

    dictationChunks =
      [];

    const type =
      recorder.mimeType ||
      getSupportedDictationMimeType() ||
      "audio/webm";

    await cleanupDictation();

    emit(
      "neyo:voice-dictation-stop",
      {
        duration
      }
    );

    if (
      duration <
        CONFIG
          .dictationMinimumMs ||
      chunks.length ===
        0
    ) {
      return null;
    }

    const blob =
      new Blob(
        chunks,
        {
          type
        }
      );

    if (
      blob.size ===
      0
    ) {
      return null;
    }

    if (
      !transcribe
    ) {
      return blob;
    }

    try {
      return await transcribeBlob(
        blob
      );

    } catch (
      error
    ) {
      reportError(
        error,
        {
          engine:
            "dictation-transcription"
        }
      );

      return null;
    }
  }

  /* =====================================================
     CANCEL DICTATION
     ===================================================== */

  async function cancelDictation() {
    if (
      transcribeController
    ) {
      try {
        transcribeController.abort(
          "cancelled"
        );
      } catch {}

      transcribeController =
        null;
    }

    transcribing =
      false;

    if (
      dictationRecorder &&
      dictationRecorder.state !==
        "inactive"
    ) {
      try {
        dictationRecorder.stop();
      } catch {}
    }

    dictating =
      false;

    dictationChunks =
      [];

    await cleanupDictation();

    emit(
      "neyo:voice-dictation-cancelled"
    );

    return true;
  }

  /* =====================================================
     CHARACTER CHANGE EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:character-change",
    event => {
      const id =
        event.detail?.id ||
        event.detail?.character;

      if (
        id
      ) {
        setCharacter(
          id
        );
      }
    }
  );

  /* =====================================================
     EXPLICIT ENGINE REQUEST EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:voice-start-request",
    event => {
      void startConversation({
        character:
          event.detail
            ?.character
      });
    }
  );

  window.addEventListener(
    "neyo:voice-stop-request",
    event => {
      void stopConversation({
        reason:
          event.detail
            ?.reason ||
          "request"
      });
    }
  );

  window.addEventListener(
    "neyo:voice-dictation-start-request",
    () => {
      void startDictation();
    }
  );

  window.addEventListener(
    "neyo:voice-dictation-stop-request",
    () => {
      void stopDictation();
    }
  );

  /* =====================================================
     PAGE CLEANUP
     ===================================================== */

  window.addEventListener(
    "pagehide",
    () => {
      /*
       * pagehide cannot await, but tracks/socket are
       * stopped synchronously before close promises.
       */

      active =
        false;

      connecting =
        false;

      setupComplete =
        false;

      closeSocket(
        "Page hidden"
      );

      stopPlayback();

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

      if (
        dictationStream
      ) {
        for (
          const track
          of dictationStream
            .getTracks()
        ) {
          try {
            track.stop();
          } catch {}
        }
      }
    },
    {
      once:
        true
    }
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

      active:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      /*
       * Gemini Live
       */

      start:
        startConversation,

      stop:
        stopConversation,

      /*
       * Audio controls
       */

      setMuted,

      setSpeakerEnabled,

      /*
       * Character
       */

      setCharacter,

      getCharacter() {
        return selectedCharacterId;
      },

      getActiveVoiceName() {
        return sessionVoiceName;
      },

      /*
       * Stable transcription fallback
       */

      startDictation,

      stopDictation,

      cancelDictation,

      transcribeBlob,

      /*
       * Status
       */

      isActive() {
        return active;
      },

      isConnecting() {
        return connecting;
      },

      isStopping() {
        return stopping;
      },

      isDictating() {
        return dictating;
      },

      isTranscribing() {
        return transcribing;
      },

      getSessionInfo() {
        return {
          version:
            VERSION,

          engine:
            "gemini-live",

          active,

          connecting,

          stopping,

          setupComplete,

          phase:
            lastPhase,

          character:
            sessionCharacterId,

          selectedCharacter:
            selectedCharacterId,

          voice:
            sessionVoiceName,

          muted,

          speakerEnabled,

          assistantSpeaking,

          responsePending,

          dictating,

          transcribing,

          userTranscript:
            userTranscriptBuffer,

          assistantTranscript:
            assistantTranscriptBuffer
        };
      },

      getState() {
        return {
          version:
            VERSION,

          active,

          connecting,

          stopping,

          setupComplete,

          phase:
            lastPhase,

          selectedCharacter:
            selectedCharacterId,

          sessionCharacter:
            sessionCharacterId,

          voice:
            sessionVoiceName,

          muted,

          speakerEnabled,

          micAcquired:
            Boolean(
              micStream
            ),

          outputContext:
            Boolean(
              outputContext
            ),

          playingSources:
            playingSources
              .size,

          dictating,

          transcribing,

          legacyScriptPresent,

          legacyOwnerActive:
            false,

          metrics: {
            ...metrics
          }
        };
      },

      engine:
        "gemini-live-with-transcription-fallback"
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
     READY
     ===================================================== */

  emit(
    "neyo:voice-ready",
    {
      version:
        VERSION,

      engine:
        api.engine,

      character:
        selectedCharacterId,

      live:
        true,

      dictationFallback:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false
    }
  );
})();
