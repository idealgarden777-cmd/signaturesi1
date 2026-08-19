/*
=========================================================
NEYO — GEMINI LIVE VOICE
DIRECT WEBSOCKET / NATIVE AUDIO
STABLE MINIMAL VERSION

Flow:
Mic click
→ POST /api/voice-token
→ ephemeral token
→ Gemini constrained WebSocket
→ setup
→ setupComplete
→ mic PCM 16 kHz
→ Gemini PCM audio
→ browser playback

NO:
- SpeechRecognition
- MediaRecorder
- /api/transcribe
- browser Gemini SDK
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       BUTTON ISOLATION
       neo.js stays untouched
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


    if (
        !micBtn ||
        !composerInputRow
    ) {
        console.warn(
            "[NEYO Voice] required DOM missing"
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

        inputSampleRate:
            16000,

        outputSampleRate:
            24000,

        processorBufferSize:
            4096,

        analyserFftSize:
            256,

        maxSessionMs:
            30 * 60 * 1000,

        setupTimeoutMs:
            10000
    });


    /* =====================================================
       SESSION STATE
       ===================================================== */

    let socket = null;

    let connecting = false;

    let active = false;

    let setupComplete = false;

    let stopping = false;

    let sessionTimer = 0;

    let setupTimer = 0;


    /* =====================================================
       INPUT AUDIO STATE
       ===================================================== */

    let micStream = null;

    let inputContext = null;

    let micSource = null;

    let processor = null;

    let silentGain = null;

    let analyser = null;

    let analyserData = null;

    let browserInputRate = 48000;


    /* =====================================================
       OUTPUT AUDIO STATE
       ===================================================== */

    let outputContext = null;

    let nextPlaybackTime = 0;

    const playingSources =
        new Set();


    /* =====================================================
       WAVE STATE
       ===================================================== */

    let waveRaf = 0;

    let smoothLevel = 0;


    console.log(
        "[NEYO Voice] Direct Gemini Live engine loaded"
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

        smoothLevel = 0;


        for (const bar of getWaveBars()) {

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


        let sum = 0;


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


            sum += sample * sample;
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
       RESAMPLING
       ===================================================== */

    function resampleFloat32(
        input,
        sourceRate,
        targetRate
    ) {

        if (
            sourceRate === targetRate
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


            let sum = 0;

            let count = 0;


            for (
                let j = start;
                j < end;
                j += 1
            ) {

                sum += input[j];

                count += 1;
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
       BASE64
       ===================================================== */

    function bytesToBase64(bytes) {

        let binary = "";

        const CHUNK = 32768;


        for (
            let i = 0;
            i < bytes.length;
            i += CHUNK
        ) {

            const part =
                bytes.subarray(
                    i,
                    Math.min(
                        i + CHUNK,
                        bytes.length
                    )
                );


            binary +=
                String.fromCharCode(
                    ...part
                );
        }


        return btoa(binary);
    }


    function base64ToBytes(value) {

        const binary =
            atob(value);


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
       PCM16 → FLOAT32
       ===================================================== */

    function pcm16ToFloat32(bytes) {

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
                "Audio playback is unavailable."
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


        return outputContext;
    }


    async function playAudioChunk(
        base64,
        mimeType = ""
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


        const rateMatch =
            String(mimeType)
                .match(
                    /rate=(\d+)/i
                );


        const sampleRate =
            rateMatch
                ? Number(rateMatch[1])
                : CONFIG.outputSampleRate;


        const audioBuffer =
            context.createBuffer(
                1,
                samples.length,
                sampleRate
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
                0.015,
                nextPlaybackTime
            );


        source.start(
            startAt
        );


        nextPlaybackTime =
            startAt +
            audioBuffer.duration;


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
                    method: "POST",

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


        let data = null;


        try {
            data = JSON.parse(raw);
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
                "Invalid voice-token response."
            );
        }


        return data;
    }


    /* =====================================================
       SEND AUDIO
       ===================================================== */

    function sendAudioChunk(
        pcmBytes
    ) {

        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN ||
            !setupComplete ||
            !active
        ) {
            return;
        }


        socket.send(
            JSON.stringify({

                realtimeInput: {

                    audio: {

                        data:
                            bytesToBase64(
                                pcmBytes
                            ),

                        mimeType:
                            "audio/pcm;rate=16000"
                    }
                }
            })
        );
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


        analyserData =
            new Uint8Array(
                analyser.fftSize
            );


        micSource.connect(
            analyser
        );


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


        micSource.connect(
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
                    !setupComplete
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


                sendAudioChunk(
                    pcm
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

        if (processor) {

            processor.onaudioprocess =
                null;


            try {
                processor.disconnect();
            } catch {}


            processor = null;
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


        if (silentGain) {

            try {
                silentGain.disconnect();
            } catch {}


            silentGain = null;
        }


        analyserData = null;


        if (micStream) {

            for (
                const track
                of micStream.getTracks()
            ) {

                try {
                    track.stop();
                } catch {}
            }


            micStream = null;
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


        inputContext = null;


        if (waveRaf) {

            cancelAnimationFrame(
                waveRaf
            );


            waveRaf = 0;
        }


        resetWaveform();
    }


    /* =====================================================
       SERVER MESSAGE
       ===================================================== */

    async function handleServerMessage(
        message
    ) {

        /*
        Critical:
        Do nothing else until setupComplete.
        */

        if (message?.setupComplete) {

            console.log(
                "[NEYO Voice] Gemini setup complete"
            );


            clearTimeout(
                setupTimer
            );


            setupTimer = 0;


            setupComplete = true;


            await startMicrophone();


            active = true;

            connecting = false;


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

            console.log(
                "[NEYO Voice] Model interrupted"
            );


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

            const inline =
                part?.inlineData;


            if (
                !inline?.data
            ) {
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

                playAudioChunk(
                    inline.data,
                    inline.mimeType
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


        connecting = true;

        setupComplete = false;


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
            Unlock browser audio output from the
            user's click gesture.
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


            socket.onopen =
                () => {

                    console.log(
                        "[NEYO Voice] WebSocket opened"
                    );


                    /*
                    IMPORTANT FIX:
                    responseModalities belongs inside
                    generationConfig.
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
                                        "[NEYO Voice] setup timed out"
                                    );


                                    stopConversation();
                                }
                            },
                            CONFIG.setupTimeoutMs
                        );
                };


            socket.onmessage =
                event => {

                    try {

                        const message =
                            JSON.parse(
                                event.data
                            );


                        handleServerMessage(
                            message
                        ).catch(
                            error => {

                                console.error(
                                    "[NEYO Voice] message handling failed:",
                                    error
                                );


                                stopConversation();
                            }
                        );

                    } catch (error) {

                        console.error(
                            "[NEYO Voice] invalid Gemini message:",
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


                    window.dispatchEvent(
                        new CustomEvent(
                            "neyo:voice-error",
                            {
                                detail: {

                                    message:
                                        "Gemini Live connection failed."
                                }
                            }
                        )
                    );
                };


            socket.onclose =
                event => {

                    console.log(
                        "[NEYO Voice] WebSocket closed",
                        {
                            code:
                                event.code,

                            reason:
                                event.reason,

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


            connecting = false;

            active = false;

            setupComplete = false;


            clearTimeout(
                setupTimer
            );


            setupTimer = 0;


            await stopMicrophone();


            stopPlayback();


            if (socket) {

                try {
                    socket.close();
                } catch {}


                socket = null;
            }


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


        stopping = true;


        active = false;

        connecting = false;

        setupComplete = false;


        clearTimeout(
            setupTimer
        );


        setupTimer = 0;


        clearTimeout(
            sessionTimer
        );


        sessionTimer = 0;


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


        socket = null;


        syncUi();


        stopping = false;


        console.log(
            "[NEYO Voice] Conversation stopped"
        );
    }


    /* =====================================================
       BUTTONS
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
                () => active,

            isConnecting:
                () => connecting,

            engine:
                "gemini-live-direct-websocket"
        });

})();
