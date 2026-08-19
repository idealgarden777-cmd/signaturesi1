/*
=========================================================
NEYO — LIVE VOICE CONVERSATION
AudioWorklet + Gemini Live

Purpose:
- Real voice conversation
- NOT dictation
- Smooth microphone capture
- Automatic conversational turn detection
- Smooth native audio playback

Requires:
public/js/worklets/voice-input-processor.js

Keeps:
- /api/voice-token
- direct Gemini Live WebSocket
- existing NEYO composer UI
- neo.js untouched
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       BUTTON ISOLATION
       ===================================================== */

    function isolateButton(element) {

        if (!element) {
            return null;
        }

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

            websocketEndpoint:
                "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",

            workletUrl:
                "/js/worklets/voice-input-processor.js",

            workletName:
                "neyo-voice-input-processor",

            inputSampleRate:
                16000,

            outputSampleRate:
                24000,

            /*
            1600 samples @ 16kHz = ~100ms.
            */

            networkChunkSamples:
                1600,

            workletChunkSize:
                2048,

            analyserFftSize:
                256,

            setupTimeoutMs:
                10000,

            maxSessionMs:
                30 * 60 * 1000,

            /*
            Small output pre-buffer.

            Helps hide small network timing variations
            without creating noticeable latency.
            */

            playbackLeadSeconds:
                0.10,

            /*
            Natural conversation pause.

            User can briefly pause while speaking
            without NEYO assuming the turn is finished.
            */

            silenceDurationMs:
                700,

            prefixPaddingMs:
                250
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
       INPUT STATE
       ===================================================== */

    let micStream =
        null;

    let inputContext =
        null;

    let micSource =
        null;

    let workletNode =
        null;

    let silentGain =
        null;

    let analyser =
        null;

    let analyserData =
        null;

    let browserInputRate =
        48000;


    /*
    16 kHz samples waiting for a complete
    ~100 ms network packet.
    */

    let pendingInput =
        new Float32Array(0);


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
       WAVE STATE
       ===================================================== */

    let waveRaf =
        0;

    let smoothLevel =
        0;


    console.log(
        "[NEYO Voice] Conversation engine loaded"
    );


    /* =====================================================
       UI
       ===================================================== */

    function syncUi() {

        composerInputRow.classList.toggle(
            "is-transcribing",
            connecting ||
            active
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
            target >
            smoothLevel
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
                    0.84 +
                    Math.sin(
                        timestamp *
                        0.0048 +
                        index *
                        0.82
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
                binary.charCodeAt(
                    i
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
       INPUT PACKET BUFFER
       ===================================================== */

    function appendInputSamples(samples) {

        if (!samples.length) {
            return;
        }


        const combined =
            new Float32Array(
                pendingInput.length +
                samples.length
            );


        combined.set(
            pendingInput,
            0
        );


        combined.set(
            samples,
            pendingInput.length
        );


        pendingInput =
            combined;


        while (
            pendingInput.length >=
            CONFIG.networkChunkSamples
        ) {

            const packet =
                pendingInput.slice(
                    0,
                    CONFIG.networkChunkSamples
                );


            pendingInput =
                pendingInput.slice(
                    CONFIG.networkChunkSamples
                );


            sendAudioPacket(
                packet
            );
        }
    }


    function sendAudioPacket(samples) {

        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN ||
            !setupComplete ||
            !active
        ) {
            return;
        }


        const pcm =
            float32ToPcm16(
                samples
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

            return CONFIG
                .outputSampleRate;
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


        /*
        First audio chunk gets a small lead.

        Following chunks are scheduled continuously.
        */

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
            0.015
        ) {

            /*
            If network briefly falls behind,
            restart slightly ahead of realtime.
            */

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

        } catch {
            // handled below
        }


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
       MICROPHONE — AUDIOWORKLET
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


        await inputContext
            .audioWorklet
            .addModule(
                CONFIG.workletUrl
            );


        micSource =
            inputContext
                .createMediaStreamSource(
                    micStream
                );


        /* ---------------------------------------------
           ANALYSER
           --------------------------------------------- */

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


        /* ---------------------------------------------
           AUDIO WORKLET
           --------------------------------------------- */

        workletNode =
            new AudioWorkletNode(
                inputContext,
                CONFIG.workletName,
                {

                    numberOfInputs:
                        1,

                    numberOfOutputs:
                        1,

                    outputChannelCount: [
                        1
                    ],

                    processorOptions: {

                        chunkSize:
                            CONFIG.workletChunkSize
                    }
                }
            );


        silentGain =
            inputContext
                .createGain();


        /*
        Keep worklet graph alive without playing
        microphone audio through speakers.
        */

        silentGain.gain.value =
            0;


        micSource.connect(
            workletNode
        );


        workletNode.connect(
            silentGain
        );


        silentGain.connect(
            inputContext.destination
        );


        pendingInput =
            new Float32Array(0);


        workletNode.port.onmessage =
            event => {

                if (
                    !active ||
                    !setupComplete
                ) {
                    return;
                }


                if (
                    event?.data?.type !==
                    "audio"
                ) {
                    return;
                }


                const incoming =
                    event.data.samples;


                if (!incoming) {
                    return;
                }


                const samples =
                    incoming instanceof Float32Array
                        ? incoming
                        : new Float32Array(
                            incoming
                        );


                const resampled =
                    resampleFloat32(
                        samples,
                        browserInputRate,
                        CONFIG.inputSampleRate
                    );


                appendInputSamples(
                    resampled
                );
            };


        workletNode.port.postMessage({

            type:
                "start"
        });


        console.log(
            "[NEYO Voice] AudioWorklet microphone active",
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

        pendingInput =
            new Float32Array(0);


        if (workletNode) {

            try {

                workletNode.port
                    .postMessage({

                        type:
                            "stop"
                    });

            } catch {}


            workletNode.port.onmessage =
                null;


            try {
                workletNode.disconnect();
            } catch {}


            workletNode =
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
       SOCKET MESSAGE DECODING
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
       GEMINI SERVER MESSAGE
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


        /*
        User started speaking while NEYO
        was talking.

        Stop queued model audio immediately.
        */

        if (
            serverContent.interrupted
        ) {

            stopPlayback();

            return;
        }


        const parts =
            serverContent
                ?.modelTurn
                ?.parts ||
            [];


        /*
        Process every returned part.
        */

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

                await playAudioChunk(
                    inline.data,
                    inline.mimeType
                );
            }
        }
    }


    /* =====================================================
       START CONVERSATION
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
            Unlock audio output during the
            original user click.
            */

            await ensureOutputContext();


            /* -----------------------------------------
               GET EPHEMERAL TOKEN
               ----------------------------------------- */

            const credentials =
                await fetchVoiceToken();


            console.log(
                "[NEYO Voice] Token received",
                credentials.model
            );


            /* -----------------------------------------
               OPEN GEMINI LIVE SOCKET
               ----------------------------------------- */

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


            /* -----------------------------------------
               SOCKET OPEN
               ----------------------------------------- */

            socket.onopen =
                () => {

                    console.log(
                        "[NEYO Voice] WebSocket opened"
                    );


                    /*
                    This is a voice CONVERSATION.

                    Not transcription.
                    Not dictation.
                    */


                    const setupMessage = {

                        setup: {

                            model:
                                `models/${credentials.model}`,


                            /*
                            Native spoken response.
                            */

                            responseModalities: [
                                "AUDIO"
                            ],


                            /*
                            Explicit conversational identity.
                            */

                            systemInstruction: {

                                parts: [

                                    {

                                        text:
`You are NEYO in a real-time spoken conversation.

This is a live voice conversation, not dictation and not transcription.

Your job is to understand what the user says and respond naturally.

Rules:

- Never merely repeat or transcribe what the user said.
- Do not behave like a speech-to-text system.
- If the user asks a question, answer the question.
- If the user makes a request, respond to the request.
- Continue naturally across multiple conversational turns.
- Listen to the meaning and intent, not just individual words.
- Speak naturally and conversationally.
- Keep responses reasonably concise unless the user asks for detail.
- Match the user's language naturally.
- If the user speaks Urdu, respond naturally in Urdu.
- If the user speaks English, respond naturally in English.
- If the user mixes English, Urdu, Hindi, Hinglish, or Roman Urdu, respond naturally in that mixed conversational style when appropriate.
- Do not announce that you are transcribing.
- Do not read the user's words back unless they explicitly ask you to repeat them.
- If something is genuinely unclear, ask one short clarification question.
- Avoid unnecessary filler.
- Act like a real conversational voice assistant named NEYO.`
                                    }
                                ]
                            },


                            /*
                            Automatic conversational turn detection.

                            ~700 ms silence allows normal breathing
                            and brief thinking pauses without splitting
                            every sentence into separate turns.
                            */

                            realtimeInputConfig: {

                                automaticActivityDetection: {

                                    disabled:
                                        false,

                                    prefixPaddingMs:
                                        CONFIG.prefixPaddingMs,

                                    silenceDurationMs:
                                        CONFIG.silenceDurationMs
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
                        "[NEYO Voice] Conversation setup sent"
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


            /* -----------------------------------------
               SOCKET MESSAGE
               ----------------------------------------- */

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
                            "[NEYO Voice] Invalid Gemini message:",
                            error
                        );
                    }
                };


            /* -----------------------------------------
               SOCKET ERROR
               ----------------------------------------- */

            socket.onerror =
                event => {

                    console.error(
                        "[NEYO Voice] WebSocket error:",
                        event
                    );
                };


            /* -----------------------------------------
               SOCKET CLOSE
               ----------------------------------------- */

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
       STOP CONVERSATION
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
       MIC BUTTON
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
                "gemini-live-conversation-audioworklet"
        });

})();
