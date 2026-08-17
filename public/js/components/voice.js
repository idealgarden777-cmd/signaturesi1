/*
=========================================================
NEYO — VOICE / GEMINI TRANSCRIPTION
STABLE PRODUCTION VERSION

Flow:
Mic
→ MediaRecorder
→ audio Blob
→ POST /api/transcribe
→ Gemini 3.5 Flash-Lite
→ transcript
→ composer

Owns:
- microphone recording
- waveform animation
- stop recording
- transcription request
- transcript insertion
- cleanup

Does NOT own:
- Gemini API key
- Gemini backend call
- composer geometry
- voice.css
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       DOM
       ===================================================== */

    const micBtn =
        document.getElementById("micBtn");

    const stopRecBtn =
        document.getElementById("stopRecBtn");

    const chatInput =
        document.getElementById("chatInput");

    const composerInputRow =
        document.querySelector(".composer-input-row");

    const waveform =
        document.querySelector(".wave-dots-bar");


    if (
        !micBtn ||
        !chatInput ||
        !composerInputRow
    ) {
        return;
    }


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG =
        Object.freeze({

            transcribeEndpoint:
                "/api/transcribe",

            maxRecordingMs:
                120000,

            minimumRecordingMs:
                350,

            fftSize:
                256,

            analyserSmoothing:
                0.86,

            silenceThreshold:
                0.018,

            strongSpeechLevel:
                0.18,

            attack:
                0.34,

            release:
                0.12,

            minimumBarHeight:
                3,

            maximumBarHeight:
                24,

            idleOpacity:
                0.32,

            activeOpacity:
                0.9
        });


    /* =====================================================
       STATE
       ===================================================== */

    let mediaRecorder = null;

    let mediaStream = null;

    let audioChunks = [];

    let recordingStartedAt = 0;

    let recordingTimer = 0;

    let isRecording = false;

    let isTranscribing = false;


    /* Audio visualizer */

    let audioContext = null;

    let analyser = null;

    let sourceNode = null;

    let timeDomainData = null;

    let animationFrameId = 0;

    let smoothedLevel = 0;


    /* Text insertion */

    let prefixText = "";

    let suffixText = "";


    /* =====================================================
       HELPERS
       ===================================================== */

    function refreshComposer() {

        chatInput.dispatchEvent(
            new Event(
                "input",
                {
                    bubbles: true
                }
            )
        );


        window.NeyoComposerScrollbar
            ?.refresh?.();
    }


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


    function setVoiceState(
        recording,
        transcribing = false
    ) {

        isRecording =
            recording;

        isTranscribing =
            transcribing;


        composerInputRow.classList.toggle(
            "is-transcribing",
            recording ||
            transcribing
        );


        composerInputRow.classList.toggle(
            "is-processing-transcription",
            transcribing
        );


        micBtn.setAttribute(
            "aria-pressed",
            String(recording)
        );


        if (transcribing) {

            micBtn.setAttribute(
                "aria-label",
                "Transcribing"
            );

            micBtn.dataset.tooltip =
                "Transcribing";

        } else if (recording) {

            micBtn.setAttribute(
                "aria-label",
                "Stop voice input"
            );

            micBtn.dataset.tooltip =
                "Stop listening";

        } else {

            micBtn.setAttribute(
                "aria-label",
                "Start voice input"
            );

            micBtn.dataset.tooltip =
                "Voice input";
        }


        if (stopRecBtn) {

            stopRecBtn.disabled =
                transcribing;

            stopRecBtn.setAttribute(
                "aria-busy",
                String(transcribing)
            );
        }
    }


    /* =====================================================
       TEXT INSERTION
       ===================================================== */

    function captureInsertionPoint() {

        const value =
            chatInput.value || "";


        const start =
            Number.isFinite(
                chatInput.selectionStart
            )
                ? chatInput.selectionStart
                : value.length;


        const end =
            Number.isFinite(
                chatInput.selectionEnd
            )
                ? chatInput.selectionEnd
                : start;


        prefixText =
            value.slice(
                0,
                start
            );


        suffixText =
            value.slice(
                end
            );
    }


    function insertTranscript(
        transcript
    ) {

        const clean =
            String(
                transcript || ""
            ).trim();


        if (!clean) {
            return;
        }


        let before =
            prefixText;


        let after =
            suffixText;


        if (
            before &&
            !/\s$/.test(before)
        ) {
            before += " ";
        }


        let middle =
            clean;


        if (
            after &&
            !/^\s/.test(after)
        ) {
            middle += " ";
        }


        chatInput.value =
            `${before}${middle}${after}`;


        const caret =
            before.length +
            middle.length;


        try {

            chatInput.setSelectionRange(
                caret,
                caret
            );

        } catch {
            // Safe fallback.
        }


        refreshComposer();


        requestAnimationFrame(
            () => {

                try {

                    chatInput.focus({
                        preventScroll: true
                    });

                } catch {

                    chatInput.focus();
                }
            }
        );
    }


    /* =====================================================
       MIME TYPE
       ===================================================== */

    function getSupportedMimeType() {

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

            "audio/ogg"

        ];


        for (
            const type
            of candidates
        ) {

            if (
                MediaRecorder
                    .isTypeSupported(
                        type
                    )
            ) {
                return type;
            }
        }


        return "";
    }


    /* =====================================================
       AUDIO LEVEL
       ===================================================== */

    function calculateRms() {

        if (
            !analyser ||
            !timeDomainData
        ) {
            return 0;
        }


        analyser.getByteTimeDomainData(
            timeDomainData
        );


        let sumSquares =
            0;


        for (
            let i = 0;
            i < timeDomainData.length;
            i += 1
        ) {

            const normalized =
                (
                    timeDomainData[i] -
                    128
                ) / 128;


            sumSquares +=
                normalized *
                normalized;
        }


        return Math.sqrt(
            sumSquares /
            timeDomainData.length
        );
    }


    function normalizeSpeechLevel(
        rms
    ) {

        if (
            rms <=
            CONFIG.silenceThreshold
        ) {
            return 0;
        }


        const usable =
            rms -
            CONFIG.silenceThreshold;


        const range =
            CONFIG.strongSpeechLevel -
            CONFIG.silenceThreshold;


        const normalized =
            usable /
            Math.max(
                range,
                0.001
            );


        return Math.min(
            1,
            Math.pow(
                Math.max(
                    0,
                    normalized
                ),
                0.72
            )
        );
    }


    function smoothSpeechLevel(
        target
    ) {

        const coefficient =
            target >
            smoothedLevel
                ? CONFIG.attack
                : CONFIG.release;


        smoothedLevel +=
            (
                target -
                smoothedLevel
            ) *
            coefficient;


        if (
            smoothedLevel < 0.008
        ) {
            smoothedLevel = 0;
        }


        return smoothedLevel;
    }


    function getBarEnergy(
        index,
        count,
        level,
        time
    ) {

        if (count <= 1) {
            return level;
        }


        const center =
            (count - 1) / 2;


        const distance =
            Math.abs(
                index -
                center
            ) /
            Math.max(
                center,
                1
            );


        const centerWeight =
            1 -
            distance *
            0.46;


        const waveA =
            Math.sin(
                time *
                0.0048 +
                index *
                0.92
            );


        const waveB =
            Math.sin(
                time *
                0.0029 -
                index *
                0.57
            );


        const motion =
            0.78 +
            waveA *
            0.13 +
            waveB *
            0.09;


        return Math.max(
            0,
            Math.min(
                1,
                level *
                centerWeight *
                motion
            )
        );
    }


    /* =====================================================
       WAVEFORM
       ===================================================== */

    function resetWaveform() {

        smoothedLevel =
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

                    bar.style.backgroundColor =
                        "currentColor";
                }
            );
    }


    function renderWaveform(
        timestamp
    ) {

        if (
            !isRecording ||
            !analyser
        ) {
            return;
        }


        const rms =
            calculateRms();


        const target =
            normalizeSpeechLevel(
                rms
            );


        const level =
            smoothSpeechLevel(
                target
            );


        const bars =
            getWaveBars();


        bars.forEach(
            (
                bar,
                index
            ) => {

                const energy =
                    getBarEnergy(
                        index,
                        bars.length,
                        level,
                        timestamp || 0
                    );


                const height =
                    CONFIG.minimumBarHeight +
                    energy *
                    (
                        CONFIG.maximumBarHeight -
                        CONFIG.minimumBarHeight
                    );


                const activity =
                    Math.min(
                        1,
                        level *
                        1.8
                    );


                const opacity =
                    CONFIG.idleOpacity +
                    activity *
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


        animationFrameId =
            requestAnimationFrame(
                renderWaveform
            );
    }


    /* =====================================================
       AUDIO VISUALIZER
       ===================================================== */

    async function startVisualizer(
        stream
    ) {

        stopVisualizer();


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
                await audioContext
                    .resume();
            }


            analyser =
                audioContext
                    .createAnalyser();


            analyser.fftSize =
                CONFIG.fftSize;


            analyser
                .smoothingTimeConstant =
                CONFIG.analyserSmoothing;


            sourceNode =
                audioContext
                    .createMediaStreamSource(
                        stream
                    );


            sourceNode.connect(
                analyser
            );


            timeDomainData =
                new Uint8Array(
                    analyser.fftSize
                );


            resetWaveform();


            animationFrameId =
                requestAnimationFrame(
                    renderWaveform
                );

        } catch (error) {

            console.warn(
                "NEYO voice visualizer unavailable:",
                error
            );
        }
    }


    function stopVisualizer() {

        if (
            animationFrameId
        ) {

            cancelAnimationFrame(
                animationFrameId
            );


            animationFrameId =
                0;
        }


        if (sourceNode) {

            try {
                sourceNode.disconnect();
            } catch {
                // Ignore.
            }


            sourceNode =
                null;
        }


        if (
            audioContext &&
            audioContext.state !==
            "closed"
        ) {

            audioContext
                .close()
                .catch(
                    () => {}
                );
        }


        audioContext =
            null;

        analyser =
            null;

        timeDomainData =
            null;


        resetWaveform();
    }


    /* =====================================================
       MICROPHONE CLEANUP
       ===================================================== */

    function stopMediaStream() {

        if (!mediaStream) {
            return;
        }


        mediaStream
            .getTracks()
            .forEach(
                track => {

                    try {
                        track.stop();
                    } catch {
                        // Ignore.
                    }
                }
            );


        mediaStream =
            null;
    }


    /* =====================================================
       TRANSCRIPTION REQUEST
       ===================================================== */

    async function transcribeAudio(
        audioBlob
    ) {

        const formData =
            new FormData();


        const mimeType =
            audioBlob.type ||
            "audio/webm";


        let extension =
            "webm";


        if (
            mimeType.includes(
                "ogg"
            )
        ) {
            extension =
                "ogg";
        }


        formData.append(
            "audio",
            audioBlob,
            `voice.${extension}`
        );


        const response =
            await fetch(
                CONFIG.transcribeEndpoint,
                {
                    method:
                        "POST",

                    body:
                        formData
                }
            );


        let data = null;


        try {

            data =
                await response.json();

        } catch {
            // handled below
        }


        if (
            !response.ok
        ) {

            throw new Error(
                data?.error ||
                `Transcription failed (${response.status})`
            );
        }


        const transcript =
            String(
                data?.transcript ||
                ""
            ).trim();


        if (!transcript) {

            throw new Error(
                "No transcript returned."
            );
        }


        return transcript;
    }


    /* =====================================================
       RECORDING COMPLETE
       ===================================================== */

    async function processRecording() {

        const duration =
            Date.now() -
            recordingStartedAt;


        const recorderType =
            mediaRecorder
                ?.mimeType ||
            getSupportedMimeType() ||
            "audio/webm";


        const chunks =
            [...audioChunks];


        audioChunks =
            [];


        stopVisualizer();

        stopMediaStream();


        if (
            duration <
            CONFIG.minimumRecordingMs
        ) {

            setVoiceState(
                false,
                false
            );


            return;
        }


        if (!chunks.length) {

            setVoiceState(
                false,
                false
            );


            return;
        }


        const blob =
            new Blob(
                chunks,
                {
                    type:
                        recorderType
                }
            );


        if (
            blob.size === 0
        ) {

            setVoiceState(
                false,
                false
            );


            return;
        }


        setVoiceState(
            false,
            true
        );


        try {

            const transcript =
                await transcribeAudio(
                    blob
                );


            insertTranscript(
                transcript
            );

        } catch (error) {

            console.error(
                "NEYO transcription failed:",
                error
            );


            window.dispatchEvent(
                new CustomEvent(
                    "neyo:voice-error",
                    {
                        detail: {
                            message:
                                error?.message ||
                                "Voice transcription failed."
                        }
                    }
                )
            );

        } finally {

            setVoiceState(
                false,
                false
            );


            mediaRecorder =
                null;


            recordingStartedAt =
                0;
        }
    }


    /* =====================================================
       START RECORDING
       ===================================================== */

    async function startRecording() {

        if (
            isRecording ||
            isTranscribing
        ) {
            return;
        }


        if (
            !navigator.mediaDevices
                ?.getUserMedia
        ) {

            console.warn(
                "Microphone API unavailable."
            );


            return;
        }


        if (
            typeof MediaRecorder ===
            "undefined"
        ) {

            console.warn(
                "MediaRecorder unavailable."
            );


            return;
        }


        captureInsertionPoint();


        try {

            mediaStream =
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


            const mimeType =
                getSupportedMimeType();


            if (mimeType) {

                mediaRecorder =
                    new MediaRecorder(
                        mediaStream,
                        {
                            mimeType
                        }
                    );

            } else {

                mediaRecorder =
                    new MediaRecorder(
                        mediaStream
                    );
            }


            audioChunks =
                [];


            mediaRecorder
                .addEventListener(
                    "dataavailable",
                    event => {

                        if (
                            event.data &&
                            event.data.size > 0
                        ) {
                            audioChunks.push(
                                event.data
                            );
                        }
                    }
                );


            mediaRecorder
                .addEventListener(
                    "stop",
                    () => {

                        processRecording();

                    },
                    {
                        once: true
                    }
                );


            mediaRecorder
                .addEventListener(
                    "error",
                    event => {

                        console.error(
                            "MediaRecorder error:",
                            event
                        );


                        stopVisualizer();

                        stopMediaStream();


                        setVoiceState(
                            false,
                            false
                        );
                    }
                );


            recordingStartedAt =
                Date.now();


            setVoiceState(
                true,
                false
            );


            await startVisualizer(
                mediaStream
            );


            /*
            timeslice ensures chunks are produced
            continuously instead of relying only
            on the final recorder stop event.
            */

            mediaRecorder.start(
                250
            );


            window.clearTimeout(
                recordingTimer
            );


            recordingTimer =
                window.setTimeout(
                    stopRecording,
                    CONFIG.maxRecordingMs
                );

        } catch (error) {

            console.error(
                "NEYO microphone start failed:",
                error
            );


            stopVisualizer();

            stopMediaStream();


            setVoiceState(
                false,
                false
            );


            mediaRecorder =
                null;
        }
    }


    /* =====================================================
       STOP RECORDING
       ===================================================== */

    function stopRecording() {

        window.clearTimeout(
            recordingTimer
        );


        recordingTimer =
            0;


        if (!isRecording) {
            return;
        }


        isRecording =
            false;


        stopVisualizer();


        if (
            mediaRecorder &&
            mediaRecorder.state !==
            "inactive"
        ) {

            try {

                mediaRecorder.stop();

            } catch (error) {

                console.warn(
                    "Could not stop MediaRecorder:",
                    error
                );


                stopMediaStream();


                setVoiceState(
                    false,
                    false
                );
            }

        } else {

            stopMediaStream();


            setVoiceState(
                false,
                false
            );
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


            if (isTranscribing) {
                return;
            }


            if (isRecording) {

                stopRecording();

            } else {

                startRecording();
            }
        }
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


                if (
                    isRecording
                ) {
                    stopRecording();
                }
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
                isRecording
            ) {
                stopRecording();
            }
        }
    );


    /* =====================================================
       PAGE CLEANUP
       ===================================================== */

    window.addEventListener(
        "pagehide",
        () => {

            window.clearTimeout(
                recordingTimer
            );


            if (
                mediaRecorder &&
                mediaRecorder.state !==
                "inactive"
            ) {

                try {

                    mediaRecorder.stop();

                } catch {
                    // Ignore.
                }
            }


            stopVisualizer();

            stopMediaStream();

        },
        {
            once: true
        }
    );


    /* =====================================================
       INITIAL STATE
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
                startRecording,

            stop:
                stopRecording,

            isRecording:
                () =>
                    isRecording,

            isTranscribing:
                () =>
                    isTranscribing

        });

})();
