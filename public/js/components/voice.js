/*
=========================================================
NEYO — VOICE / LIVE TRANSCRIPTION
Production real-time speech reactive version

Goals:
- Real microphone-reactive waveform
- Smooth ChatGPT-class visual feel
- No random fake equalizer animation
- SpeechRecognition interim + final text
- Existing composer architecture preserved
- Mobile / desktop safe
- Proper microphone cleanup
- No dependency on neo.js
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

    const sendBtn =
        document.getElementById("sendBtn");

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
       STATE
       ===================================================== */

    let recognition = null;

    let isListening = false;

    let manualStop = false;


    /* Audio visualizer */

    let micStream = null;

    let audioContext = null;

    let analyser = null;

    let sourceNode = null;

    let animationFrameId = 0;

    let timeDomainData = null;


    /* Wave smoothing */

    let smoothedLevel = 0;

    let previousLevel = 0;

    let visualTime = 0;


    /* Transcript composition */

    let prefixText = "";

    let suffixText = "";

    let finalTranscript = "";

    let interimTranscript = "";


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG = Object.freeze({

        fftSize: 256,

        analyserSmoothing: 0.86,

        silenceThreshold: 0.018,

        normalSpeechLevel: 0.075,

        strongSpeechLevel: 0.18,

        attack: 0.34,

        release: 0.12,

        minimumBarHeight: 3,

        maximumBarHeight: 24,

        idleOpacity: 0.32,

        activeOpacity: 0.9

    });


    /* =====================================================
       HELPERS
       ===================================================== */

    function getWaveBars() {

        if (!waveform) {
            return [];
        }

        return Array.from(
            waveform.querySelectorAll("span")
        );

    }


    function getRecognitionLanguage() {

        const htmlLang =
            document.documentElement.lang;

        if (
            htmlLang &&
            htmlLang.trim()
        ) {
            return htmlLang;
        }

        return (
            navigator.language ||
            "en-US"
        );

    }


    function dispatchComposerInput() {

        chatInput.dispatchEvent(
            new Event(
                "input",
                {
                    bubbles: true
                }
            )
        );


        /*
        Allow other isolated composer modules
        to refresh without directly depending
        on their implementation.
        */

        window.NeyoComposerScrollbar
            ?.refresh?.();

    }


    function setListeningUI(active) {

        composerInputRow.classList.toggle(
            "is-transcribing",
            active
        );


        micBtn.setAttribute(
            "aria-pressed",
            String(active)
        );


        micBtn.setAttribute(
            "aria-label",
            active
                ? "Stop voice input"
                : "Start voice input"
        );


        if (active) {

            micBtn.dataset.tooltip =
                "Stop listening";

        } else {

            micBtn.dataset.tooltip =
                "Voice input";

        }

    }


    /* =====================================================
       TRANSCRIPT INSERTION

       Voice text is inserted at the user's current
       cursor position instead of destroying existing text.
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


        /*
        Add natural spacing if speech is being
        inserted after existing text.
        */

        if (
            prefixText &&
            !/\s$/.test(prefixText)
        ) {
            prefixText += " ";
        }


        finalTranscript = "";
        interimTranscript = "";

    }


    function renderTranscript() {

        const spoken =
            `${finalTranscript}${interimTranscript}`;


        let result =
            `${prefixText}${spoken}`;


        if (
            suffixText &&
            result &&
            !/\s$/.test(result) &&
            !/^\s/.test(suffixText)
        ) {
            result += " ";
        }


        result += suffixText;


        chatInput.value =
            result;


        dispatchComposerInput();


        const caret =
            Math.min(
                chatInput.value.length,
                prefixText.length +
                spoken.length
            );


        try {

            chatInput.setSelectionRange(
                caret,
                caret
            );

        } catch {
            // Some mobile browsers may reject
            // selection updates while recognition
            // owns focus.
        }

    }


    /* =====================================================
       AUDIO LEVEL

       RMS of microphone time-domain signal gives
       a much more natural speech-energy measurement
       than mapping raw frequency bins directly.
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


        let sumSquares = 0;


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


    /* =====================================================
       SPEECH ENERGY NORMALIZATION
       ===================================================== */

    function normalizeSpeechLevel(rms) {

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


        /*
        Slight curve:
        quiet speech remains visible,
        loud speech does not instantly max out.
        */

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


    /* =====================================================
       ENVELOPE FOLLOWER

       Fast attack + slower release creates a
       natural voice waveform instead of jitter.
       ===================================================== */

    function smoothSpeechLevel(target) {

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


        /*
        Tiny dead zone prevents endless movement
        from microphone noise.
        */

        if (
            smoothedLevel < 0.008
        ) {
            smoothedLevel = 0;
        }


        return smoothedLevel;

    }


    /* =====================================================
       BAR SHAPE

       Center-weighted organic waveform.
       Deterministic — no Math.random() jitter.
       ===================================================== */

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


        /*
        Center bars are stronger.
        Outer bars remain alive but calmer.
        */

        const centerWeight =
            1 -
            (
                distance *
                0.46
            );


        /*
        Slow phase motion gives the waveform
        a coherent fluid shape.
        */

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
       RENDER WAVEFORM
       ===================================================== */

    function renderWaveform(timestamp) {

        if (
            !isListening ||
            !analyser
        ) {
            return;
        }


        visualTime =
            timestamp || 0;


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


        const count =
            bars.length;


        bars.forEach(
            (
                bar,
                index
            ) => {

                const energy =
                    getBarEnergy(
                        index,
                        count,
                        level,
                        visualTime
                    );


                /*
                Idle waveform:
                tiny calm vertical bars.

                Active waveform:
                speech-reactive growth.
                */

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


                /*
                Do not constantly change colors.
                A stable monochrome waveform feels
                significantly more premium.
                */

                bar.style.backgroundColor =
                    "currentColor";

            }
        );


        previousLevel =
            level;


        animationFrameId =
            requestAnimationFrame(
                renderWaveform
            );

    }


    /* =====================================================
       RESET WAVEFORM
       ===================================================== */

    function resetWaveform() {

        smoothedLevel = 0;
        previousLevel = 0;
        visualTime = 0;


        getWaveBars().forEach(
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


    /* =====================================================
       START AUDIO VISUALIZER
       ===================================================== */

    async function startAudioVisualizer() {

        stopAudioVisualizer();


        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices
                .getUserMedia
        ) {

            resetWaveform();

            return;

        }


        try {

            micStream =
                await navigator
                    .mediaDevices
                    .getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        },

                        video: false
                    });


            const AudioContextClass =
                window.AudioContext ||
                window.webkitAudioContext;


            if (!AudioContextClass) {

                resetWaveform();

                return;

            }


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
                        micStream
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


            resetWaveform();

        }

    }


    /* =====================================================
       STOP AUDIO VISUALIZER
       ===================================================== */

    function stopAudioVisualizer() {

        if (animationFrameId) {

            cancelAnimationFrame(
                animationFrameId
            );

            animationFrameId = 0;

        }


        if (sourceNode) {

            try {

                sourceNode.disconnect();

            } catch {
                // Already disconnected.
            }


            sourceNode = null;

        }


        if (micStream) {

            micStream
                .getTracks()
                .forEach(
                    track => {

                        try {
                            track.stop();
                        } catch {
                            // Ignore closed tracks.
                        }

                    }
                );


            micStream = null;

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


        audioContext = null;
        analyser = null;
        timeDomainData = null;


        resetWaveform();

    }


    /* =====================================================
       STOP LISTENING
       ===================================================== */

    function stopListening() {

        if (!isListening) {

            stopAudioVisualizer();

            setListeningUI(false);

            return;

        }


        isListening = false;


        setListeningUI(false);


        stopAudioVisualizer();


        /*
        Commit final transcript and remove any
        stale interim fragment.
        */

        interimTranscript = "";


        if (
            finalTranscript
        ) {

            renderTranscript();

        }


        /*
        Restore composer state after voice UI.
        */

        dispatchComposerInput();

    }


    /* =====================================================
       RECOGNITION SETUP
       ===================================================== */

    function setupSpeechRecognition() {

        const SpeechRecognition =
            window.SpeechRecognition ||
            window.webkitSpeechRecognition;


        if (!SpeechRecognition) {

            micBtn.disabled =
                true;


            micBtn.setAttribute(
                "aria-label",
                "Voice input unavailable"
            );


            micBtn.dataset.tooltip =
                "Voice input unavailable";


            return;

        }


        try {

            recognition =
                new SpeechRecognition();


            recognition.continuous =
                true;


            recognition.interimResults =
                true;


            recognition.maxAlternatives =
                1;


            recognition.lang =
                getRecognitionLanguage();


            /* ---------------------------------------------
               START
               --------------------------------------------- */

            recognition.onstart =
                () => {

                    isListening =
                        true;


                    manualStop =
                        false;


                    setListeningUI(
                        true
                    );


                    startAudioVisualizer();

                };


            /* ---------------------------------------------
               RESULTS
               --------------------------------------------- */

            recognition.onresult =
                event => {

                    let finalChunk = "";
                    let interimChunk = "";


                    for (
                        let i =
                            event.resultIndex;

                        i <
                        event.results.length;

                        i += 1
                    ) {

                        const result =
                            event.results[i];


                        const transcript =
                            result?.[0]
                                ?.transcript ||
                            "";


                        if (
                            result.isFinal
                        ) {

                            finalChunk +=
                                transcript;

                        } else {

                            interimChunk +=
                                transcript;

                        }

                    }


                    if (finalChunk) {

                        if (
                            finalTranscript &&
                            !/\s$/.test(
                                finalTranscript
                            ) &&
                            !/^\s/.test(
                                finalChunk
                            )
                        ) {

                            finalTranscript +=
                                " ";

                        }


                        finalTranscript +=
                            finalChunk;

                    }


                    interimTranscript =
                        interimChunk;


                    renderTranscript();

                };


            /* ---------------------------------------------
               SPEECH START / END
               --------------------------------------------- */

            recognition.onspeechstart =
                () => {

                    waveform
                        ?.classList
                        .add(
                            "is-speaking"
                        );

                };


            recognition.onspeechend =
                () => {

                    waveform
                        ?.classList
                        .remove(
                            "is-speaking"
                        );

                };


            /* ---------------------------------------------
               ERROR
               --------------------------------------------- */

            recognition.onerror =
                event => {

                    const code =
                        event?.error || "";


                    /*
                    "no-speech" is normal and should
                    not be treated as a hard failure.
                    */

                    if (
                        code !==
                        "no-speech" &&
                        code !==
                        "aborted"
                    ) {

                        console.warn(
                            "NEYO speech recognition:",
                            code
                        );

                    }


                    stopListening();

                };


            /* ---------------------------------------------
               END
               --------------------------------------------- */

            recognition.onend =
                () => {

                    /*
                    No hidden endless restart loops.
                    Browser owns recognition lifecycle.
                    */

                    stopListening();

                };


        } catch (error) {

            console.warn(
                "NEYO speech recognition setup failed:",
                error
            );


            recognition = null;

        }

    }


    /* =====================================================
       START LISTENING
       ===================================================== */

    function startListening() {

        if (
            !recognition ||
            isListening
        ) {
            return;
        }


        captureInsertionPoint();


        manualStop = false;


        try {

            recognition.lang =
                getRecognitionLanguage();


            recognition.start();

        } catch (error) {

            /*
            Chromium can throw InvalidStateError
            if start is called twice too quickly.
            */

            if (
                error?.name !==
                "InvalidStateError"
            ) {

                console.warn(
                    "NEYO could not start voice input:",
                    error
                );

            }

        }

    }


    /* =====================================================
       REQUEST STOP
       ===================================================== */

    function requestStop() {

        manualStop =
            true;


        if (
            recognition &&
            isListening
        ) {

            try {

                recognition.stop();

            } catch {

                stopListening();

            }

        } else {

            stopListening();

        }

    }


    /* =====================================================
       MIC CLICK
       ===================================================== */

    micBtn.addEventListener(
        "click",
        event => {

            event.preventDefault();
            event.stopPropagation();


            if (isListening) {

                requestStop();

                return;

            }


            startListening();

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


                requestStop();

            }
        );


    /* =====================================================
       ESCAPE TO STOP
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                    "Escape" &&
                isListening
            ) {

                requestStop();

            }

        }
    );


    /* =====================================================
       PAGE CLEANUP
       ===================================================== */

    window.addEventListener(
        "pagehide",
        () => {

            manualStop =
                true;


            if (
                recognition &&
                isListening
            ) {

                try {
                    recognition.abort();
                } catch {
                    // Ignore.
                }

            }


            isListening = false;


            stopAudioVisualizer();

        },
        {
            once: true
        }
    );


    /* =====================================================
       INITIALIZE
       ===================================================== */

    resetWaveform();

    setupSpeechRecognition();


    /* =====================================================
       OPTIONAL PUBLIC API
       ===================================================== */

    window.NeyoVoice =
        Object.freeze({

            start:
                startListening,

            stop:
                requestStop,

            isListening:
                () =>
                    isListening

        });

})();
