/*
=========================================================
NEYO — GEMINI LIVE VOICE
AUDIOWORKLET + SMOOTH PLAYBACK VERSION

Requires:
public/js/worklets/voice-input-processor.js

Keeps:
- current /api/voice-token
- current Gemini Live WebSocket
- current composer UI
- current neo.js isolation

Improves:
- removes ScriptProcessorNode
- smoother mic capture
- ~100 ms network audio packets
- playback pre-buffer
- cleaner interruption handling
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

    const CONFIG = Object.freeze({

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
        1600 samples @ 16 kHz = 100 ms.
        Google recommends ~100 ms audio chunks
        for low-latency Live streaming.
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
        Small playback lead prevents tiny network
        timing variations from creating audible gaps.
        */

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
    Resampled 16 kHz samples waiting to be
    packetized into ~100 ms network chunks.
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
        "[NEYO Voice] AudioWorklet Live engine loaded"
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


                const motion =
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
                            motion
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


        const CHUNK =
            32768;


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


        return btoa(
            binary
        );
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


        const buffer =
            context.createBuffer(
                1,
                samples.length,
                CONFIG.outputSampleRate
            );


        buffer
            .getChannelData(0)
            .set(
                samples
            );


        const source =
            context.createBufferSource();


        source.buffer =
            buffer;


        source.connect(
            context.destination
        );


        /*
        First chunk gets a tiny pre-buffer.
        After that every chunk is placed exactly
        after the previous scheduled chunk.
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
            0.01
        ) {

            /*
            Network fell behind.
            Recover without stacking old audio.
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
       START MICROPHONE — AUDIOWORKLET
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


        /*
        Load AudioWorklet module.
        */

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
           Analyser
           --------------------------------------------- */

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


        /* ---------------------------------------------
           AudioWorklet
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
        AudioWorklet needs to remain in an active
        graph, but we do not want mic monitor audio.
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

                workletNode.port.postMessage({
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
       HANDLE SERVER MESSAGE
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


        /*
        Stop queued audio immediately when Gemini
        reports user interruption.
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
                    inline.data
                );
            }
        }
    }


    /* =====================================================
       START SESSION
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
       STOP SESSION
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
                "gemini-live-audioworklet"
        });

})();
