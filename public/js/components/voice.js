/*
=========================================================
NEYO — PREMIUM VOICE TRANSCRIPTION
GOOGLE CHIRP 3 FRONTEND CLIENT

Architecture:

Microphone
   ↓
MediaRecorder
   ↓
100ms audio chunks
   ↓
NEYO secure WebSocket backend
   ↓
Google Speech-to-Text V2
model: chirp_3
   ↓
interim + final transcript
   ↓
#chatInput

IMPORTANT:
- No Google API key in browser
- Backend owns Google credentials
- UI remains compatible with existing voice.css
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       DOM
       ===================================================== */

    const composer =
        document.getElementById(
            "glassInputContainer"
        );

    const inputRow =
        composer?.querySelector(
            ".composer-input-row"
        );

    const textarea =
        document.getElementById(
            "chatInput"
        );

    const micBtn =
        document.getElementById(
            "micBtn"
        );

    const stopBtn =
        document.getElementById(
            "stopRecBtn"
        );

    const voiceContainer =
        document.getElementById(
            "voiceTranscribeContainer"
        );

    const waveBar =
        document.getElementById(
            "waveDotsBar"
        );


    if (
        !composer ||
        !inputRow ||
        !textarea ||
        !micBtn ||
        !stopBtn ||
        !voiceContainer ||
        !waveBar
    ) {
        return;
    }


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG = Object.freeze({

        /*
        Backend WebSocket endpoint.

        Same-origin example:
        https://neyo.signaturesi.com
            ↓
        wss://neyo.signaturesi.com/api/transcribe-stream
        */

        socketPath:
            "/api/transcribe-stream",

        model:
            "chirp_3",

        /*
        Change later from NEYO language settings.
        */

        languageCode:
            "en-US",

        /*
        Near-real-time audio chunks.
        */

        chunkMs:
            100,

        /*
        Stop waits briefly for Google's final transcript.
        */

        finalWaitMs:
            1400,

        /*
        Connection timeout.
        */

        connectTimeoutMs:
            7000,

        /*
        Waveform visual settings.
        */

        waveformSmoothing:
            0.72,

        waveformFloor:
            0.04,

        waveformBoost:
            2.5

    });


    /* =====================================================
       STATE
       ===================================================== */

    let socket = null;

    let mediaRecorder = null;

    let mediaStream = null;

    let audioContext = null;

    let analyser = null;

    let audioSource = null;

    let animationFrame = 0;

    let connectionTimer = 0;

    let stopTimer = 0;


    let isListening = false;

    let isStopping = false;

    let socketReady = false;


    /*
    Text that existed before voice started.
    */

    let baseText = "";


    /*
    Google finalized transcript accumulated
    during current voice session.
    */

    let committedTranscript = "";


    /*
    Current temporary/interim transcript.
    */

    let interimTranscript = "";


    /*
    Waveform smoothing state.
    */

    let smoothedVolume = 0;


    /* =====================================================
       WAVEFORM BARS
       ===================================================== */

    const waveBars =
        Array.from(
            waveBar.querySelectorAll(
                "span"
            )
        );


    /* =====================================================
       HELPERS
       ===================================================== */

    function refreshIcons() {
        if (
            window.lucide &&
            typeof window.lucide.createIcons ===
                "function"
        ) {
            try {
                window.lucide.createIcons();
            } catch {
                // Non-fatal.
            }
        }
    }


    function emit(name, detail = {}) {
        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail
                }
            )
        );
    }


    function normalizeText(value) {
        return String(
            value || ""
        )
            .replace(/\s+/g, " ")
            .trim();
    }


    function joinText(...parts) {
        return parts
            .map(normalizeText)
            .filter(Boolean)
            .join(" ");
    }


    /* =====================================================
       WEBSOCKET URL
       ===================================================== */

    function getSocketUrl() {

        /*
        Optional global override:

        window.NEYO_CONFIG = {
            transcriptionSocket:
                "wss://api.example.com/voice"
        };
        */

        const custom =
            window.NEYO_CONFIG
                ?.transcriptionSocket;


        if (custom) {
            return custom;
        }


        const protocol =
            window.location.protocol ===
            "https:"
                ? "wss:"
                : "ws:";


        return (
            `${protocol}//` +
            `${window.location.host}` +
            CONFIG.socketPath
        );
    }


    /* =====================================================
       MEDIA MIME TYPE
       ===================================================== */

    function getPreferredMimeType() {

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
            const type of candidates
        ) {

            if (
                MediaRecorder
                    .isTypeSupported(type)
            ) {
                return type;
            }
        }


        return "";
    }


    /* =====================================================
       TEXTAREA UPDATE
       ===================================================== */

    function renderTranscript() {

        const nextText =
            joinText(
                baseText,
                committedTranscript,
                interimTranscript
            );


        /*
        Avoid unnecessary DOM writes.
        */

        if (
            textarea.value !==
            nextText
        ) {

            textarea.value =
                nextText;


            /*
            Notify existing NEYO composer systems:
            - scrollbar
            - autosize
            - suggestions
            - send state
            */

            textarea.dispatchEvent(
                new Event(
                    "input",
                    {
                        bubbles: true
                    }
                )
            );
        }


        /*
        Keep caret at end while actively speaking.
        */

        if (
            document.activeElement ===
                textarea ||
            isListening
        ) {

            try {
                const end =
                    textarea.value.length;

                textarea.setSelectionRange(
                    end,
                    end
                );
            } catch {
                // Safe fallback.
            }
        }
    }


    /* =====================================================
       INTERIM TRANSCRIPT
       ===================================================== */

    function setInterimTranscript(text) {

        interimTranscript =
            normalizeText(text);


        renderTranscript();
    }


    /* =====================================================
       FINAL TRANSCRIPT
       ===================================================== */

    function commitTranscript(text) {

        const clean =
            normalizeText(text);


        if (!clean) {
            return;
        }


        committedTranscript =
            joinText(
                committedTranscript,
                clean
            );


        interimTranscript = "";


        renderTranscript();


        emit(
            "neyo:voice-final",
            {
                text:
                    clean,

                transcript:
                    committedTranscript
            }
        );
    }


    /* =====================================================
       UI — ACTIVE
       ===================================================== */

    function showVoiceUI() {

        inputRow.classList.add(
            "is-transcribing"
        );


        composer.classList.add(
            "is-voice-active"
        );


        micBtn.setAttribute(
            "aria-pressed",
            "true"
        );


        stopBtn.setAttribute(
            "aria-hidden",
            "false"
        );


        stopBtn.tabIndex = 0;


        refreshIcons();


        window.NeyoComposerScrollbar
            ?.refresh?.();
    }


    /* =====================================================
       UI — IDLE
       ===================================================== */

    function hideVoiceUI() {

        inputRow.classList.remove(
            "is-transcribing"
        );


        composer.classList.remove(
            "is-voice-active"
        );


        waveBar.classList.remove(
            "is-speaking"
        );


        micBtn.setAttribute(
            "aria-pressed",
            "false"
        );


        stopBtn.setAttribute(
            "aria-hidden",
            "true"
        );


        stopBtn.tabIndex = -1;


        resetWaveform();


        window.NeyoComposerScrollbar
            ?.refresh?.();
    }


    /* =====================================================
       WAVEFORM RESET
       ===================================================== */

    function resetWaveform() {

        smoothedVolume = 0;


        for (
            const bar of waveBars
        ) {

            bar.style.height =
                "3px";

            bar.style.opacity =
                "";
        }
    }


    /* =====================================================
       WAVEFORM SETUP
       Local audio analysis only.
       Audio is NOT sent through analyser.
       ===================================================== */

    async function setupAnalyser(
        stream
    ) {

        const AudioContextClass =
            window.AudioContext ||
            window.webkitAudioContext;


        if (!AudioContextClass) {
            return;
        }


        try {

            audioContext =
                new AudioContextClass();


            if (
                audioContext.state ===
                "suspended"
            ) {
                await audioContext.resume();
            }


            analyser =
                audioContext
                    .createAnalyser();


            analyser.fftSize =
                256;


            analyser.smoothingTimeConstant =
                0.72;


            audioSource =
                audioContext
                    .createMediaStreamSource(
                        stream
                    );


            audioSource.connect(
                analyser
            );


            startWaveform();

        } catch {

            cleanupAnalyser();
        }
    }


    /* =====================================================
       LIVE WAVEFORM
       ===================================================== */

    function startWaveform() {

        if (
            !analyser ||
            !waveBars.length
        ) {
            return;
        }


        const data =
            new Uint8Array(
                analyser.frequencyBinCount
            );


        const tick = () => {

            if (
                !isListening ||
                !analyser
            ) {
                return;
            }


            analyser.getByteFrequencyData(
                data
            );


            /*
            Average useful lower/mid frequencies.
            Voice energy mostly lives here.
            */

            const usable =
                Math.min(
                    data.length,
                    48
                );


            let total = 0;


            for (
                let i = 0;
                i < usable;
                i += 1
            ) {
                total +=
                    data[i];
            }


            const raw =
                usable
                    ? (
                        total /
                        usable /
                        255
                    )
                    : 0;


            const boosted =
                Math.min(
                    1,
                    Math.max(
                        CONFIG.waveformFloor,
                        raw *
                        CONFIG.waveformBoost
                    )
                );


            smoothedVolume =
                (
                    smoothedVolume *
                    CONFIG.waveformSmoothing
                ) +
                (
                    boosted *
                    (
                        1 -
                        CONFIG.waveformSmoothing
                    )
                );


            renderWaveform(
                smoothedVolume,
                data
            );


            animationFrame =
                requestAnimationFrame(
                    tick
                );
        };


        animationFrame =
            requestAnimationFrame(
                tick
            );
    }


    /* =====================================================
       WAVEFORM RENDER
       ===================================================== */

    function renderWaveform(
        volume,
        frequencyData
    ) {

        const speaking =
            volume > 0.075;


        waveBar.classList.toggle(
            "is-speaking",
            speaking
        );


        const center =
            (
                waveBars.length -
                1
            ) / 2;


        waveBars.forEach(
            (bar, index) => {

                /*
                Center-weighted shape.
                */

                const distance =
                    Math.abs(
                        index -
                        center
                    );


                const centerWeight =
                    Math.max(
                        0.35,
                        1 -
                        (
                            distance /
                            (
                                center +
                                1
                            )
                        ) *
                        0.58
                    );


                /*
                Small frequency variation
                prevents robotic equalizer look.
                */

                const frequencyIndex =
                    Math.min(
                        frequencyData.length - 1,
                        Math.floor(
                            (
                                index /
                                Math.max(
                                    1,
                                    waveBars.length - 1
                                )
                            ) *
                            36
                        )
                    );


                const frequencyEnergy =
                    (
                        frequencyData[
                            frequencyIndex
                        ] || 0
                    ) / 255;


                const energy =
                    Math.min(
                        1,
                        (
                            volume *
                            0.72
                        ) +
                        (
                            frequencyEnergy *
                            0.28
                        )
                    );


                const maxHeight =
                    23;


                const minHeight =
                    3;


                const height =
                    minHeight +
                    (
                        maxHeight -
                        minHeight
                    ) *
                    energy *
                    centerWeight;


                bar.style.height =
                    `${Math.max(
                        minHeight,
                        height
                    ).toFixed(1)}px`;


                bar.style.opacity =
                    speaking
                        ? String(
                            Math.min(
                                0.96,
                                0.45 +
                                energy
                            )
                        )
                        : "";
            }
        );
    }


    /* =====================================================
       WEBSOCKET
       ===================================================== */

    function connectSocket() {

        return new Promise(
            (
                resolve,
                reject
            ) => {

                let settled =
                    false;


                const url =
                    getSocketUrl();


                try {

                    socket =
                        new WebSocket(
                            url
                        );


                    /*
                    Audio chunks are sent
                    as raw binary WebSocket frames.
                    */

                    socket.binaryType =
                        "arraybuffer";

                } catch (error) {

                    reject(error);

                    return;
                }


                connectionTimer =
                    window.setTimeout(
                        () => {

                            if (settled) {
                                return;
                            }


                            settled = true;


                            try {
                                socket?.close();
                            } catch {
                                // Safe.
                            }


                            reject(
                                new Error(
                                    "Voice connection timed out."
                                )
                            );

                        },
                        CONFIG.connectTimeoutMs
                    );


                socket.addEventListener(
                    "open",
                    () => {

                        if (settled) {
                            return;
                        }


                        settled = true;


                        clearTimeout(
                            connectionTimer
                        );


                        socketReady = true;


                        resolve();
                    }
                );


                socket.addEventListener(
                    "message",
                    handleSocketMessage
                );


                socket.addEventListener(
                    "error",
                    () => {

                        if (!settled) {

                            settled = true;


                            clearTimeout(
                                connectionTimer
                            );


                            reject(
                                new Error(
                                    "Could not connect to voice transcription."
                                )
                            );
                        }
                    }
                );


                socket.addEventListener(
                    "close",
                    handleSocketClose
                );
            }
        );
    }


    /* =====================================================
       SOCKET MESSAGE PROTOCOL

       Backend → browser examples:

       {
           "type": "ready"
       }

       {
           "type": "transcript",
           "text": "hello world",
           "isFinal": false
       }

       {
           "type": "transcript",
           "text": "hello world",
           "isFinal": true
       }

       {
           "type": "stopped"
       }

       {
           "type": "error",
           "message": "..."
       }
       ===================================================== */

    function handleSocketMessage(event) {

        if (
            typeof event.data !==
            "string"
        ) {
            return;
        }


        let payload;


        try {

            payload =
                JSON.parse(
                    event.data
                );

        } catch {

            return;
        }


        switch (
            payload?.type
        ) {

            case "ready":

                emit(
                    "neyo:voice-ready"
                );

                break;


            case "transcript": {

                const text =
                    payload.text || "";


                if (
                    payload.isFinal
                ) {

                    commitTranscript(
                        text
                    );

                } else {

                    setInterimTranscript(
                        text
                    );
                }


                break;
            }


            case "error":

                handleVoiceError(
                    new Error(
                        payload.message ||
                        "Transcription failed."
                    )
                );

                break;


            case "stopped":

                finalizeStop();

                break;


            default:

                break;
        }
    }


    /* =====================================================
       SOCKET CLOSE
       ===================================================== */

    function handleSocketClose() {

        socketReady = false;


        /*
        Unexpected disconnect.
        */

        if (
            isListening &&
            !isStopping
        ) {

            handleVoiceError(
                new Error(
                    "Voice connection was interrupted."
                )
            );

            return;
        }


        if (isStopping) {
            finalizeStop();
        }
    }


    /* =====================================================
       MICROPHONE
       ===================================================== */

    async function requestMicrophone() {

        if (
            !navigator.mediaDevices
                ?.getUserMedia
        ) {

            throw new Error(
                "Microphone recording is not supported in this browser."
            );
        }


        return navigator.mediaDevices
            .getUserMedia({

                audio: {

                    echoCancellation:
                        true,

                    noiseSuppression:
                        true,

                    autoGainControl:
                        true,

                    channelCount:
                        1

                },

                video:
                    false
            });
    }


    /* =====================================================
       MEDIA RECORDER
       ===================================================== */

    function createRecorder(
        stream
    ) {

        if (
            typeof MediaRecorder ===
            "undefined"
        ) {

            throw new Error(
                "Audio recording is not supported in this browser."
            );
        }


        const mimeType =
            getPreferredMimeType();


        const options =
            mimeType
                ? {
                    mimeType
                }
                : undefined;


        return new MediaRecorder(
            stream,
            options
        );
    }


    /* =====================================================
       SEND START CONFIG
       ===================================================== */

    function sendStartMessage() {

        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN
        ) {
            return;
        }


        socket.send(
            JSON.stringify({

                type:
                    "start",

                model:
                    CONFIG.model,

                languageCode:
                    CONFIG.languageCode,

                mimeType:
                    mediaRecorder
                        ?.mimeType || "",

                interimResults:
                    true,

                automaticPunctuation:
                    true

            })
        );
    }


    /* =====================================================
       SEND AUDIO
       ===================================================== */

    async function sendAudioChunk(
        blob
    ) {

        if (
            !blob ||
            !blob.size ||
            !socketReady ||
            !socket ||
            socket.readyState !==
                WebSocket.OPEN
        ) {
            return;
        }


        try {

            const buffer =
                await blob.arrayBuffer();


            /*
            Socket may have closed while
            Blob was converting.
            */

            if (
                socketReady &&
                socket?.readyState ===
                    WebSocket.OPEN
            ) {

                socket.send(
                    buffer
                );
            }

        } catch {
            // Skip a broken chunk.
        }
    }


    /* =====================================================
       START RECORDING
       ===================================================== */

    async function startListening() {

        if (
            isListening ||
            isStopping
        ) {
            return;
        }


        /*
        Capture existing typed text exactly once.
        */

        baseText =
            textarea.value
                .trim();


        committedTranscript = "";

        interimTranscript = "";


        try {

            mediaStream =
                await requestMicrophone();


            await connectSocket();


            mediaRecorder =
                createRecorder(
                    mediaStream
                );


            /*
            Start UI before recorder so it feels immediate.
            */

            isListening = true;

            isStopping = false;


            showVoiceUI();


            await setupAnalyser(
                mediaStream
            );


            /* -----------------------------------------
               RECORDER EVENTS
               ----------------------------------------- */

            mediaRecorder.addEventListener(
                "dataavailable",
                event => {

                    if (
                        event.data &&
                        event.data.size
                    ) {

                        sendAudioChunk(
                            event.data
                        );
                    }
                }
            );


            mediaRecorder.addEventListener(
                "error",
                event => {

                    handleVoiceError(
                        event.error ||
                        new Error(
                            "Microphone recording failed."
                        )
                    );
                }
            );


            mediaRecorder.addEventListener(
                "stop",
                () => {

                    /*
                    Tell backend there will be
                    no more audio frames.
                    */

                    if (
                        socket?.readyState ===
                            WebSocket.OPEN
                    ) {

                        socket.send(
                            JSON.stringify({
                                type:
                                    "stop"
                            })
                        );
                    }
                }
            );


            /* -----------------------------------------
               GOOGLE SESSION CONFIG
               ----------------------------------------- */

            sendStartMessage();


            /*
            Small timeslice produces realtime chunks.
            */

            mediaRecorder.start(
                CONFIG.chunkMs
            );


            emit(
                "neyo:voice-start",
                {
                    model:
                        CONFIG.model,

                    languageCode:
                        CONFIG.languageCode
                }
            );

        } catch (error) {

            handleVoiceError(
                error
            );
        }
    }


    /* =====================================================
       STOP LISTENING
       ===================================================== */

    function stopListening() {

        if (
            !isListening ||
            isStopping
        ) {
            return;
        }


        isStopping = true;


        /*
        Keep current interim text visible while
        Google processes the final chunk.
        */


        try {

            if (
                mediaRecorder &&
                mediaRecorder.state !==
                    "inactive"
            ) {

                mediaRecorder.stop();

            } else if (
                socket?.readyState ===
                    WebSocket.OPEN
            ) {

                socket.send(
                    JSON.stringify({
                        type:
                            "stop"
                    })
                );
            }

        } catch {
            finalizeStop();
            return;
        }


        /*
        Safety timeout:
        Backend should normally send "stopped".
        */

        clearTimeout(
            stopTimer
        );


        stopTimer =
            window.setTimeout(
                () => {

                    /*
                    If final interim result never
                    arrives, keep the words user saw.
                    */

                    if (
                        interimTranscript
                    ) {

                        commitTranscript(
                            interimTranscript
                        );
                    }


                    finalizeStop();

                },
                CONFIG.finalWaitMs
            );
    }


    /* =====================================================
       FINALIZE STOP
       ===================================================== */

    function finalizeStop() {

        if (
            !isListening &&
            !isStopping
        ) {
            return;
        }


        clearTimeout(
            stopTimer
        );


        /*
        Do not lose visible interim words
        if backend closes without final flag.
        */

        if (
            interimTranscript
        ) {

            commitTranscript(
                interimTranscript
            );
        }


        isListening = false;

        isStopping = false;


        cleanupRecorder();

        cleanupAnalyser();

        cleanupStream();

        cleanupSocket();


        hideVoiceUI();


        /*
        Focus input after transcription.
        */

        requestAnimationFrame(
            () => {

                try {

                    textarea.focus({
                        preventScroll:
                            true
                    });

                } catch {

                    textarea.focus();
                }


                const end =
                    textarea.value.length;


                try {

                    textarea.setSelectionRange(
                        end,
                        end
                    );

                } catch {
                    // Safe fallback.
                }


                textarea.dispatchEvent(
                    new Event(
                        "input",
                        {
                            bubbles:
                                true
                        }
                    )
                );
            }
        );


        emit(
            "neyo:voice-stop",
            {
                transcript:
                    committedTranscript
            }
        );
    }


    /* =====================================================
       ERROR
       ===================================================== */

    function handleVoiceError(
        error
    ) {

        const message =
            error?.message ||
            "Voice transcription failed.";


        console.error(
            "[NEYO Voice]",
            error
        );


        emit(
            "neyo:voice-error",
            {
                message,
                error
            }
        );


        /*
        Preserve visible interim text.
        */

        if (
            interimTranscript
        ) {

            commitTranscript(
                interimTranscript
            );
        }


        isListening = false;

        isStopping = false;


        cleanupRecorder();

        cleanupAnalyser();

        cleanupStream();

        cleanupSocket();

        hideVoiceUI();


        /*
        Existing NEYO notification system
        can listen to neyo:voice-error.
        */

        textarea.dispatchEvent(
            new Event(
                "input",
                {
                    bubbles:
                        true
                }
            )
        );
    }


    /* =====================================================
       CLEANUP — RECORDER
       ===================================================== */

    function cleanupRecorder() {

        if (!mediaRecorder) {
            return;
        }


        try {

            mediaRecorder.ondataavailable =
                null;

        } catch {
            // Safe.
        }


        mediaRecorder = null;
    }


    /* =====================================================
       CLEANUP — ANALYSER
       ===================================================== */

    function cleanupAnalyser() {

        if (animationFrame) {

            cancelAnimationFrame(
                animationFrame
            );

            animationFrame = 0;
        }


        try {

            audioSource
                ?.disconnect();

        } catch {
            // Safe.
        }


        audioSource = null;

        analyser = null;


        if (audioContext) {

            try {

                audioContext.close();

            } catch {
                // Safe.
            }
        }


        audioContext = null;


        resetWaveform();
    }


    /* =====================================================
       CLEANUP — STREAM
       ===================================================== */

    function cleanupStream() {

        if (!mediaStream) {
            return;
        }


        try {

            mediaStream
                .getTracks()
                .forEach(
                    track =>
                        track.stop()
                );

        } catch {
            // Safe.
        }


        mediaStream = null;
    }


    /* =====================================================
       CLEANUP — SOCKET
       ===================================================== */

    function cleanupSocket() {

        clearTimeout(
            connectionTimer
        );


        socketReady = false;


        if (!socket) {
            return;
        }


        const current =
            socket;


        socket = null;


        try {

            current.removeEventListener(
                "message",
                handleSocketMessage
            );


            current.removeEventListener(
                "close",
                handleSocketClose
            );


            if (
                current.readyState ===
                    WebSocket.OPEN ||
                current.readyState ===
                    WebSocket.CONNECTING
            ) {

                current.close(
                    1000,
                    "Voice session complete"
                );
            }

        } catch {
            // Safe.
        }
    }


    /* =====================================================
       MIC BUTTON
       ===================================================== */

    micBtn.addEventListener(
        "click",
        event => {

            event.preventDefault();
            event.stopPropagation();


            if (isListening) {
                return;
            }


            startListening();
        }
    );


    /* =====================================================
       STOP BUTTON
       ===================================================== */

    stopBtn.addEventListener(
        "click",
        event => {

            event.preventDefault();
            event.stopPropagation();


            stopListening();
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
                isListening
            ) {

                event.preventDefault();

                stopListening();
            }
        }
    );


    /* =====================================================
       PAGE CLEANUP
       ===================================================== */

    window.addEventListener(
        "pagehide",
        () => {

            isListening = false;

            isStopping = false;


            cleanupRecorder();

            cleanupAnalyser();

            cleanupStream();

            cleanupSocket();

        },
        {
            once: true
        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoVoice =
        Object.freeze({

            start:
                startListening,

            stop:
                stopListening,

            isListening:
                () =>
                    isListening,

            getTranscript:
                () =>
                    joinText(
                        committedTranscript,
                        interimTranscript
                    ),

            setLanguage:
                languageCode => {

                    /*
                    CONFIG itself is frozen,
                    so expose language through
                    runtime override.
                    */

                    if (
                        typeof languageCode ===
                            "string" &&
                        languageCode.trim()
                    ) {

                        window.NEYO_CONFIG =
                            window.NEYO_CONFIG ||
                            {};


                        window.NEYO_CONFIG
                            .voiceLanguage =
                            languageCode.trim();
                    }
                }

        });


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    stopBtn.setAttribute(
        "aria-hidden",
        "true"
    );


    stopBtn.tabIndex =
        -1;


    resetWaveform();

})();
