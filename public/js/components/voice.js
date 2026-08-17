/*
=========================================================
NEYO — LIVE VOICE CONVERSATION
STEP 1: Stable minimal implementation

Flow:
Mic click
→ /api/voice-token
→ Gemini Live connection
→ microphone PCM stream
→ Gemini native audio reply
→ browser playback

NO:
- browser SpeechRecognition
- MediaRecorder
- /api/transcribe
- dictation
- chat history integration
=========================================================
*/

import {
    GoogleGenAI,
    Modality
} from "https://cdn.jsdelivr.net/npm/@google/genai/+esm";


(() => {
    "use strict";


    /* =====================================================
       LEGACY LISTENER ISOLATION

       neo.js remains untouched.
       Replacing these buttons removes listeners previously
       attached directly to the original DOM nodes.
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
        return;
    }


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG = Object.freeze({

        tokenEndpoint:
            "/api/voice-token",

        inputSampleRate:
            16000,

        outputSampleRate:
            24000,

        processorBufferSize:
            4096,

        analyserFftSize:
            256,

        maxSessionMs:
            30 * 60 * 1000

    });


    /* =====================================================
       SESSION STATE
       ===================================================== */

    let liveSession =
        null;

    let connecting =
        false;

    let active =
        false;

    let sessionTimer =
        0;


    /* =====================================================
       MICROPHONE STATE
       ===================================================== */

    let micStream =
        null;

    let inputContext =
        null;

    let inputSource =
        null;

    let processor =
        null;

    let silentGain =
        null;

    let inputSampleRate =
        48000;


    /* =====================================================
       WAVEFORM STATE
       ===================================================== */

    let analyser =
        null;

    let analyserData =
        null;

    let waveRaf =
        0;

    let smoothLevel =
        0;


    /* =====================================================
       OUTPUT STATE
       ===================================================== */

    let outputContext =
        null;

    let nextPlaybackTime =
        0;

    const playbackSources =
        new Set();


    console.log(
        "[NEYO Voice] Live voice module loaded"
    );


    /* =====================================================
       UI STATE
       ===================================================== */

    function syncUi() {

        composerInputRow.classList.toggle(
            "is-transcribing",
            active ||
            connecting
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
                "Connecting voice conversation"
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
            target >
            smoothLevel
                ? 0.32
                : 0.12;


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
                (bars.length - 1) /
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
                    0.46;


                const movement =
                    0.82 +
                    Math.sin(
                        timestamp *
                        0.005 +
                        index *
                        0.85
                    ) *
                    0.18;


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
       RESAMPLE FLOAT32
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
                    i *
                    ratio
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
       FLOAT32 → PCM16 LITTLE-ENDIAN
       ===================================================== */

    function floatToPcm16(
        input
    ) {

        const output =
            new Uint8Array(
                input.length *
                2
            );


        const view =
            new DataView(
                output.buffer
            );


        for (
            let i = 0;
            i < input.length;
            i += 1
        ) {

            const sample =
                Math.max(
                    -1,
                    Math.min(
                        1,
                        input[i]
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
                binary.charCodeAt(
                    i
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

        const sampleCount =
            Math.floor(
                bytes.byteLength /
                2
            );


        const output =
            new Float32Array(
                sampleCount
            );


        const view =
            new DataView(
                bytes.buffer,
                bytes.byteOffset,
                bytes.byteLength
            );


        for (
            let i = 0;
            i < sampleCount;
            i += 1
        ) {

            const sample =
                view.getInt16(
                    i * 2,
                    true
                );


            output[i] =
                sample /
                (
                    sample < 0
                        ? 32768
                        : 32767
                );
        }


        return output;
    }


    /* =====================================================
       OUTPUT AUDIO CONTEXT
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

                await outputContext
                    .resume();
            }


            return outputContext;
        }


        const AudioContextClass =
            window.AudioContext ||
            window.webkitAudioContext;


        if (!AudioContextClass) {

            throw new Error(
                "Audio playback is not supported."
            );
        }


        outputContext =
            new AudioContextClass();


        if (
            outputContext.state ===
            "suspended"
        ) {

            await outputContext
                .resume();
        }


        nextPlaybackTime =
            outputContext.currentTime;


        return outputContext;
    }


    /* =====================================================
       PLAY GEMINI PCM 24kHz
       ===================================================== */

    async function playAudioChunk(
        base64
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


        const audioBuffer =
            context.createBuffer(
                1,
                samples.length,
                CONFIG.outputSampleRate
            );


        audioBuffer
            .getChannelData(0)
            .set(samples);


        const source =
            context.createBufferSource();


        source.buffer =
            audioBuffer;


        source.connect(
            context.destination
        );


        const startAt =
            Math.max(
                context.currentTime +
                0.01,
                nextPlaybackTime
            );


        source.start(
            startAt
        );


        nextPlaybackTime =
            startAt +
            audioBuffer.duration;


        playbackSources.add(
            source
        );


        source.addEventListener(
            "ended",
            () => {

                playbackSources.delete(
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
            of playbackSources
        ) {

            try {
                source.stop();
            } catch {}
        }


        playbackSources.clear();


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

                    headers: {
                        "Accept":
                            "application/json"
                    },

                    credentials:
                        "same-origin"
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
                `Token request failed (${response.status})`
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
       START MICROPHONE STREAM
       ===================================================== */

    async function startMicrophone() {

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
                "Web Audio API is unavailable."
            );
        }


        inputContext =
            new AudioContextClass();


        if (
            inputContext.state ===
            "suspended"
        ) {

            await inputContext
                .resume();
        }


        inputSampleRate =
            inputContext.sampleRate;


        inputSource =
            inputContext
                .createMediaStreamSource(
                    micStream
                );


        /* ------------------------------
           Wave analyser
           ------------------------------ */

        analyser =
            inputContext
                .createAnalyser();


        analyser.fftSize =
            CONFIG.analyserFftSize;


        analyserData =
            new Uint8Array(
                analyser.fftSize
            );


        inputSource.connect(
            analyser
        );


        /* ------------------------------
           PCM capture
           ------------------------------ */

        processor =
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


        inputSource.connect(
            processor
        );


        processor.connect(
            silentGain
        );


        silentGain.connect(
            inputContext.destination
        );


        processor.onaudioprocess =
            event => {

                if (
                    !active ||
                    !liveSession
                ) {
                    return;
                }


                const input =
                    event.inputBuffer
                        .getChannelData(0);


                const resampled =
                    resampleFloat32(
                        input,
                        inputSampleRate,
                        CONFIG.inputSampleRate
                    );


                const pcm =
                    floatToPcm16(
                        resampled
                    );


                const encoded =
                    bytesToBase64(
                        pcm
                    );


                try {

                    liveSession
                        .sendRealtimeInput({

                            audio: {

                                data:
                                    encoded,

                                mimeType:
                                    "audio/pcm;rate=16000"
                            }
                        });

                } catch (error) {

                    console.warn(
                        "[NEYO Voice] realtime audio send failed:",
                        error
                    );
                }
            };
    }


    /* =====================================================
       STOP MICROPHONE
       ===================================================== */

    async function stopMicrophone() {

        if (processor) {

            processor.onaudioprocess =
                null;


            try {
                processor.disconnect();
            } catch {}


            processor =
                null;
        }


        if (inputSource) {

            try {
                inputSource.disconnect();
            } catch {}


            inputSource =
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

                await inputContext
                    .close();

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
       HANDLE LIVE MESSAGE
       ===================================================== */

    function handleServerMessage(
        message
    ) {

        const serverContent =
            message?.serverContent;


        if (!serverContent) {
            return;
        }


        /*
        Gemini can signal interruption.
        Immediately discard queued assistant audio.
        */

        if (
            serverContent.interrupted
        ) {

            stopPlayback();
        }


        const parts =
            serverContent
                ?.modelTurn
                ?.parts ||
            [];


        for (
            const part
            of parts
        ) {

            const audio =
                part?.inlineData;


            if (
                !audio?.data
            ) {
                continue;
            }


            if (
                String(
                    audio.mimeType ||
                    ""
                ).startsWith(
                    "audio/pcm"
                )
            ) {

                playAudioChunk(
                    audio.data
                ).catch(
                    error => {

                        console.error(
                            "[NEYO Voice] playback error:",
                            error
                        );
                    }
                );
            }
        }
    }


    /* =====================================================
       START CONVERSATION
       ===================================================== */

    async function startConversation() {

        if (
            active ||
            connecting
        ) {
            return;
        }


        connecting =
            true;


        syncUi();


        try {

            if (
                !navigator
                    .mediaDevices
                    ?.getUserMedia
            ) {

                throw new Error(
                    "Microphone is unavailable."
                );
            }


            /*
            1. Get ephemeral credential.
            */

            const credentials =
                await fetchVoiceToken();


            console.log(
                "[NEYO Voice] token ready"
            );


            /*
            2. Create browser-side Gemini client.

            Ephemeral token works only for Live API v1beta.
            */

            const ai =
                new GoogleGenAI({

                    apiKey:
                        credentials.token,

                    httpOptions: {

                        apiVersion:
                            "v1beta"
                    }
                });


            /*
            3. Open Live connection.
            */

            liveSession =
                await ai.live.connect({

                    model:
                        credentials.model,

                    config: {

                        responseModalities: [
                            Modality.AUDIO
                        ]
                    },

                    callbacks: {

                        onopen:
                            () => {

                                console.log(
                                    "[NEYO Voice] Live connection opened"
                                );
                            },


                        onmessage:
                            message => {

                                handleServerMessage(
                                    message
                                );
                            },


                        onerror:
                            event => {

                                console.error(
                                    "[NEYO Voice] Live error:",
                                    event
                                );


                                window.dispatchEvent(
                                    new CustomEvent(
                                        "neyo:voice-error",
                                        {
                                            detail: {

                                                message:
                                                    event?.message ||
                                                    "Voice connection failed."
                                            }
                                        }
                                    )
                                );
                            },


                        onclose:
                            event => {

                                console.log(
                                    "[NEYO Voice] Live connection closed",
                                    event?.reason ||
                                    ""
                                );


                                if (active) {

                                    stopConversation({
                                        closeSession:
                                            false
                                    });
                                }
                            }
                    }
                });


            /*
            4. Start browser audio output while still
            inside the user-initiated interaction flow.
            */

            await ensureOutputContext();


            /*
            5. Start microphone.
            */

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


            window.clearTimeout(
                sessionTimer
            );


            sessionTimer =
                window.setTimeout(
                    () => {

                        stopConversation();

                    },
                    CONFIG.maxSessionMs
                );


            console.log(
                "[NEYO Voice] conversation active"
            );


        } catch (error) {

            console.error(
                "[NEYO Voice] start failed:",
                error
            );


            connecting =
                false;

            active =
                false;


            await stopMicrophone();


            if (liveSession) {

                try {
                    liveSession.close();
                } catch {}


                liveSession =
                    null;
            }


            stopPlayback();


            syncUi();


            window.dispatchEvent(
                new CustomEvent(
                    "neyo:voice-error",
                    {
                        detail: {

                            message:
                                error?.message ||
                                "Could not start voice conversation."
                        }
                    }
                )
            );
        }
    }


    /* =====================================================
       STOP CONVERSATION
       ===================================================== */

    async function stopConversation({
        closeSession = true
    } = {}) {

        if (
            !active &&
            !connecting &&
            !liveSession
        ) {
            return;
        }


        active =
            false;

        connecting =
            false;


        window.clearTimeout(
            sessionTimer
        );


        sessionTimer =
            0;


        await stopMicrophone();


        stopPlayback();


        if (
            closeSession &&
            liveSession
        ) {

            try {

                liveSession.close();

            } catch {}
        }


        liveSession =
            null;


        syncUi();


        console.log(
            "[NEYO Voice] conversation stopped"
        );
    }


    /* =====================================================
       MIC BUTTON
       ===================================================== */

    micBtn.addEventListener(
        "click",
        event => {

            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation();


            if (connecting) {
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


    /* =====================================================
       STOP BUTTON
       ===================================================== */

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


    /* =====================================================
       ESC
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
       CLEANUP
       ===================================================== */

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


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoVoice =
        Object.freeze({

            start:
                startConversation,

            stop:
                stopConversation,

            isActive:
                () =>
                    active,

            isConnecting:
                () =>
                    connecting,

            engine:
                "gemini-live-native-audio"
        });

})();
