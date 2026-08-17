/*
=========================================================
NEYO — LIVE VOICE CONVERSATION
Gemini 2.5 Flash Native Audio

Flow:
Mic
→ POST /api/voice-token
→ ephemeral token
→ Gemini Live API
→ mic PCM 16 kHz
→ Gemini native audio
→ speaker PCM 24 kHz

NO:
- SpeechRecognition
- MediaRecorder
- /api/transcribe
- FFmpeg
- dictation mode
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

       Keeps neo.js untouched.
       Clone removes old listeners from mic/stop controls.
       ===================================================== */

    function isolateButton(original) {
        if (!original) {
            return null;
        }

        const clean =
            original.cloneNode(true);

        original.replaceWith(clean);

        return clean;
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

    const CONFIG =
        Object.freeze({

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

            analyserSmoothing:
                0.82,

            maxSessionMs:
                30 * 60 * 1000,

            minimumBarHeight:
                3,

            maximumBarHeight:
                24,

            idleOpacity:
                0.32,

            activeOpacity:
                0.95
        });


    /* =====================================================
       STATE
       ===================================================== */

    let session =
        null;

    let sessionStarting =
        false;

    let sessionActive =
        false;

    let sessionTimer =
        0;


    /* Mic audio */

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

    let inputSampleRate =
        48000;


    /* Output audio */

    let outputContext =
        null;

    let nextPlaybackTime =
        0;

    const playingSources =
        new Set();


    /* Wave animation */

    let waveRaf =
        0;

    let smoothLevel =
        0;


    console.log(
        "[NEYO Voice] Gemini Live engine loaded"
    );


    /* =====================================================
       HELPERS
       ===================================================== */

    function setVoiceState(
        active,
        connecting = false
    ) {

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


        getWaveBars()
            .forEach(
                bar => {

                    bar.style.height =
                        `${CONFIG.minimumBarHeight}px`;

                    bar.style.opacity =
                        String(
                            CONFIG.idleOpacity
                        );
                }
            );
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

        if (!sessionActive) {
            return;
        }


        const rms =
            calculateRms();


        const target =
            Math.min(
                1,
                Math.max(
                    0,
                    (rms - 0.012) /
                    0.12
                )
            );


        const speed =
            target >
            smoothLevel
                ? 0.32
                : 0.12;


        smoothLevel +=
            (
                target -
                smoothLevel
            ) *
            speed;


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
                    0.45;


                const motion =
                    0.82 +
                    Math.sin(
                        timestamp *
                        0.005 +
                        index *
                        0.9
                    ) *
                    0.18;


                const energy =
                    Math.max(
                        0,
                        Math.min(
                            1,
                            smoothLevel *
                            weight *
                            motion
                        )
                    );


                const height =
                    CONFIG.minimumBarHeight +
                    energy *
                    (
                        CONFIG.maximumBarHeight -
                        CONFIG.minimumBarHeight
                    );


                const opacity =
                    CONFIG.idleOpacity +
                    energy *
                    (
                        CONFIG.activeOpacity -
                        CONFIG.idleOpacity
                    );


                bar.style.height =
                    `${height.toFixed(2)}px`;

                bar.style.opacity =
                    opacity.toFixed(3);
            }
        );


        waveRaf =
            requestAnimationFrame(
                animateWave
            );
    }


    /* =====================================================
       FLOAT32 → PCM16
       ===================================================== */

    function float32ToPcm16(
        input
    ) {

        const buffer =
            new ArrayBuffer(
                input.length *
                2
            );


        const view =
            new DataView(
                buffer
            );


        let offset =
            0;


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


            const value =
                sample < 0
                    ? sample *
                        0x8000
                    : sample *
                        0x7fff;


            view.setInt16(
                offset,
                value,
                true
            );


            offset +=
                2;
        }


        return new Uint8Array(
            buffer
        );
    }


    /* =====================================================
       SIMPLE DOWNSAMPLER

       Browser AudioContext commonly = 48 kHz.
       Gemini Live input requires 16 kHz PCM.
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
                Math.min(
                    input.length,
                    Math.floor(
                        (i + 1) *
                        ratio
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
                    : input[
                        Math.min(
                            start,
                            input.length - 1
                        )
                    ] || 0;
        }


        return output;
    }


    /* =====================================================
       BASE64 HELPERS
       ===================================================== */

    function uint8ToBase64(
        bytes
    ) {

        const CHUNK =
            0x8000;


        let binary =
            "";


        for (
            let i = 0;
            i < bytes.length;
            i += CHUNK
        ) {

            const chunk =
                bytes.subarray(
                    i,
                    Math.min(
                        i + CHUNK,
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


    function base64ToUint8(
        base64
    ) {

        const binary =
            atob(
                base64
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

        const view =
            new DataView(
                bytes.buffer,
                bytes.byteOffset,
                bytes.byteLength
            );


        const samples =
            new Float32Array(
                Math.floor(
                    bytes.byteLength /
                    2
                )
            );


        for (
            let i = 0;
            i < samples.length;
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
       OUTPUT AUDIO
       Gemini Live native audio = PCM 24 kHz.
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


        outputContext =
            new AudioContextClass({
                sampleRate:
                    CONFIG.outputSampleRate
            });


        if (
            outputContext.state ===
                "suspended"
        ) {
            await outputContext.resume();
        }


        nextPlaybackTime =
            outputContext.currentTime;


        return outputContext;
    }


    async function playPcmAudio(
        base64
    ) {

        if (!base64) {
            return;
        }


        const context =
            await ensureOutputContext();


        const bytes =
            base64ToUint8(
                base64
            );


        const floatSamples =
            pcm16ToFloat32(
                bytes
            );


        const audioBuffer =
            context.createBuffer(
                1,
                floatSamples.length,
                CONFIG.outputSampleRate
            );


        audioBuffer
            .getChannelData(0)
            .set(
                floatSamples
            );


        const source =
            context.createBufferSource();


        source.buffer =
            audioBuffer;


        source.connect(
            context.destination
        );


        const startTime =
            Math.max(
                context.currentTime +
                0.01,
                nextPlaybackTime
            );


        source.start(
            startTime
        );


        nextPlaybackTime =
            startTime +
            audioBuffer.duration;


        playingSources.add(
            source
        );


        source.onended =
            () => {

                playingSources.delete(
                    source
                );
            };
    }


    /* =====================================================
       INTERRUPTION

       When user begins speaking again, clear queued
       Gemini playback so conversation feels natural.
       ===================================================== */

    function stopCurrentPlayback() {

        for (
            const source
            of playingSources
        ) {

            try {
                source.stop();
            } catch {}
        }


        playingSources.clear();


        if (outputContext) {

            nextPlaybackTime =
                outputContext.currentTime;
        }
    }


    /* =====================================================
       TOKEN
       ===================================================== */

    async function getVoiceToken() {

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
       MIC STREAM
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


        inputContext =
            new AudioContextClass();


        if (
            inputContext.state ===
                "suspended"
        ) {
            await inputContext.resume();
        }


        inputSampleRate =
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
            CONFIG.analyserSmoothing;


        analyserData =
            new Uint8Array(
                analyser.fftSize
            );


        micSource.connect(
            analyser
        );


        /*
        ScriptProcessor is deprecated but broadly supported
        and keeps this implementation dependency-free.

        Later it can be migrated to AudioWorklet without
        changing Live API architecture.
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
                    !sessionActive ||
                    !session
                ) {
                    return;
                }


                const original =
                    event.inputBuffer
                        .getChannelData(
                            0
                        );


                const resampled =
                    resampleFloat32(
                        original,
                        inputSampleRate,
                        CONFIG.inputSampleRate
                    );


                const pcm =
                    float32ToPcm16(
                        resampled
                    );


                const base64 =
                    uint8ToBase64(
                        pcm
                    );


                try {

                    session.sendRealtimeInput({

                        audio: {

                            data:
                                base64,

                            mimeType:
                                "audio/pcm;rate=16000"
                        }
                    });

                } catch (error) {

                    console.warn(
                        "[NEYO Voice] audio send failed:",
                        error
                    );
                }
            };
    }


    /* =====================================================
       STOP MIC
       ===================================================== */

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

            micStream
                .getTracks()
                .forEach(
                    track => {

                        try {
                            track.stop();
                        } catch {}
                    }
                );


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
       LIVE MESSAGE
       ===================================================== */

    function handleLiveMessage(
        message
    ) {

        const content =
            message?.serverContent;


        if (!content) {
            return;
        }


        /*
        If Gemini signals interruption,
        throw away queued assistant audio.
        */

        if (
            content.interrupted
        ) {

            stopCurrentPlayback();
        }


        /*
        Native audio output.
        */

        const parts =
            content
                ?.modelTurn
                ?.parts ||
            [];


        for (
            const part
            of parts
        ) {

            const inline =
                part?.inlineData;


            if (
                inline?.data &&
                String(
                    inline.mimeType ||
                    ""
                ).startsWith(
                    "audio/pcm"
                )
            ) {

                playPcmAudio(
                    inline.data
                ).catch(
                    error => {

                        console.error(
                            "[NEYO Voice] playback failed:",
                            error
                        );
                    }
                );
            }
        }


        /*
        Optional input/output transcriptions.

        We do NOT use these for dictation.
        They are only useful later for chat history/captions.
        */

        if (
            content.inputTranscription
                ?.text
        ) {

            window.dispatchEvent(
                new CustomEvent(
                    "neyo:voice-user-transcript",
                    {
                        detail: {
                            text:
                                content
                                    .inputTranscription
                                    .text
                        }
                    }
                )
            );
        }


        if (
            content.outputTranscription
                ?.text
        ) {

            window.dispatchEvent(
                new CustomEvent(
                    "neyo:voice-model-transcript",
                    {
                        detail: {
                            text:
                                content
                                    .outputTranscription
                                    .text
                        }
                    }
                )
            );
        }
    }


    /* =====================================================
       START LIVE SESSION
       ===================================================== */

    async function startVoiceConversation() {

        if (
            sessionActive ||
            sessionStarting
        ) {
            return;
        }


        sessionStarting =
            true;


        setVoiceState(
            false,
            true
        );


        try {

            if (
                !navigator
                    .mediaDevices
                    ?.getUserMedia
            ) {

                throw new Error(
                    "Microphone is not supported in this browser."
                );
            }


            /*
            Get ephemeral credential from NEYO backend.
            */

            const credentials =
                await getVoiceToken();


            console.log(
                "[NEYO Voice] token received",
                credentials.model
            );


            /*
            Ephemeral token is used like an API key,
            and Live API must use v1beta.
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


            session =
                await ai.live.connect({

                    model:
                        credentials.model,

                    config: {

                        responseModalities: [
                            Modality.AUDIO
                        ],


                        /*
                        These transcriptions are optional metadata.
                        They do NOT create a second AI request.
                        */

                        inputAudioTranscription:
                            {},

                        outputAudioTranscription:
                            {},


                        /*
                        Native automatic turn detection.
                        User can speak naturally and pause.
                        */

                        realtimeInputConfig: {

                            automaticActivityDetection: {

                                disabled:
                                    false,

                                prefixPaddingMs:
                                    120,

                                silenceDurationMs:
                                    650
                            }
                        },


                        /*
                        NEYO voice behavior.
                        No hardcoded topic vocabulary.
                        */

                        systemInstruction: {
                            parts: [
                                {
                                    text:
`You are NEYO in a live voice conversation.

Listen carefully and respond naturally to the user's spoken request.

Rules:
- Be concise unless more detail is useful.
- Preserve the user's language naturally.
- If the user mixes languages, respond naturally in that style when appropriate.
- Do not behave like a dictation engine.
- Do not merely repeat what the user said.
- Answer and converse normally.
- Avoid unnecessary filler.
- If the request is unclear, ask a short clarification question.`
                                }
                            ]
                        }
                    },


                    callbacks: {

                        onopen:
                            () => {

                                console.log(
                                    "[NEYO Voice] Live socket opened"
                                );
                            },


                        onmessage:
                            message => {

                                handleLiveMessage(
                                    message
                                );
                            },


                        onerror:
                            error => {

                                console.error(
                                    "[NEYO Voice] Live error:",
                                    error
                                );


                                window.dispatchEvent(
                                    new CustomEvent(
                                        "neyo:voice-error",
                                        {
                                            detail: {
                                                message:
                                                    error?.message ||
                                                    "Voice conversation failed."
                                            }
                                        }
                                    )
                                );
                            },


                        onclose:
                            event => {

                                console.log(
                                    "[NEYO Voice] Live closed:",
                                    event?.reason ||
                                    ""
                                );


                                if (
                                    sessionActive
                                ) {

                                    endVoiceConversation({
                                        closeSession:
                                            false
                                    });
                                }
                            }
                    }
                });


            /*
            Ask for microphone only after Live connection exists.
            */

            await startMicrophone();


            await ensureOutputContext();


            sessionActive =
                true;

            sessionStarting =
                false;


            setVoiceState(
                true,
                false
            );


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

                        endVoiceConversation();

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


            sessionStarting =
                false;

            sessionActive =
                false;


            await stopMicrophone();


            if (session) {

                try {
                    session.close();
                } catch {}

                session =
                    null;
            }


            stopCurrentPlayback();


            setVoiceState(
                false,
                false
            );


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
       END LIVE SESSION
       ===================================================== */

    async function endVoiceConversation({
        closeSession = true
    } = {}) {

        if (
            !sessionActive &&
            !sessionStarting &&
            !session
        ) {
            return;
        }


        sessionActive =
            false;

        sessionStarting =
            false;


        window.clearTimeout(
            sessionTimer
        );


        sessionTimer =
            0;


        await stopMicrophone();


        stopCurrentPlayback();


        if (
            closeSession &&
            session
        ) {

            try {

                session.close();

            } catch {}
        }


        session =
            null;


        setVoiceState(
            false,
            false
        );


        console.log(
            "[NEYO Voice] conversation ended"
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


            if (
                sessionStarting
            ) {
                return;
            }


            if (
                sessionActive
            ) {

                endVoiceConversation();

            } else {

                startVoiceConversation();
            }
        },
        true
    );


    /* =====================================================
       STOP BUTTON
       ===================================================== */

    stopRecBtn
        ?.addEventListener(
            "click",
            event => {

                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();


                endVoiceConversation();
            },
            true
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
                    sessionActive ||
                    sessionStarting
                )
            ) {

                endVoiceConversation();
            }
        }
    );


    /* =====================================================
       PAGE CLEANUP
       ===================================================== */

    window.addEventListener(
        "pagehide",
        () => {

            endVoiceConversation();

        },
        {
            once: true
        }
    );


    /* =====================================================
       INIT
       ===================================================== */

    resetWaveform();


    setVoiceState(
        false,
        false
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoVoice =
        Object.freeze({

            start:
                startVoiceConversation,

            stop:
                endVoiceConversation,

            isActive:
                () =>
                    sessionActive,

            isConnecting:
                () =>
                    sessionStarting,

            engine:
                "gemini-live-native-audio"
        });

})();
