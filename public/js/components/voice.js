/*
=========================================================
NEYO — VOICE / GEMINI WAV TRANSCRIPTION
FINAL BROWSER-COMPATIBLE VERSION

Flow:
Mic
→ Web Audio API
→ Raw PCM
→ 16 kHz mono WAV
→ POST /api/transcribe
→ Gemini
→ transcript
→ composer

Important:
- NO SpeechRecognition
- NO webkitSpeechRecognition
- NO MediaRecorder
- NO WebM
- NO FFmpeg
- neo.js remains untouched
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       LEGACY LISTENER ISOLATION
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

    const chatInput =
        document.getElementById("chatInput");

    const composerInputRow =
        document.querySelector(
            ".composer-input-row"
        );

    const waveform =
        document.getElementById(
            "waveDotsBar"
        );

    const chatMessages =
        document.getElementById(
            "chatMessages"
        );


    if (
        !micBtn ||
        !chatInput ||
        !composerInputRow
    ) {
        return;
    }


    console.log(
        "[NEYO Voice] PCM/WAV Gemini engine active"
    );


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

            targetSampleRate:
                16000,

            bufferSize:
                4096,

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
                0.9,

            contextMessages:
                4,

            contextMaxChars:
                5000
        });


    /* =====================================================
       STATE
       ===================================================== */

    let isRecording =
        false;

    let isTranscribing =
        false;

    let recordingStartedAt =
        0;

    let recordingTimer =
        0;


    /* Audio */

    let mediaStream =
        null;

    let audioContext =
        null;

    let sourceNode =
        null;

    let processorNode =
        null;

    let silentGainNode =
        null;

    let analyser =
        null;

    let analyserData =
        null;


    /* PCM */

    let pcmChunks =
        [];

    let inputSampleRate =
        48000;


    /* Wave */

    let animationFrameId =
        0;

    let smoothedLevel =
        0;


    /* Text insertion */

    let prefixText =
        "";

    let suffixText =
        "";


    /* =====================================================
       COMPOSER
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


    /* =====================================================
       CONTEXT
       ===================================================== */

    function getRecentContext() {

        const external =
            window.NeyoChatContext
                ?.getRecentText?.(
                    CONFIG.contextMessages
                );


        if (
            typeof external === "string" &&
            external.trim()
        ) {

            return external
                .trim()
                .slice(
                    0,
                    CONFIG.contextMaxChars
                );
        }


        if (!chatMessages) {
            return "";
        }


        const messages =
            Array.from(
                chatMessages.children || []
            )
                .filter(
                    element =>
                        element?.textContent
                            ?.trim()
                )
                .slice(
                    -CONFIG.contextMessages
                );


        return messages
            .map(
                element =>
                    element.textContent.trim()
            )
            .join("\n\n")
            .slice(
                0,
                CONFIG.contextMaxChars
            );
    }


    /* =====================================================
       UI STATE
       ===================================================== */

    function setVoiceState(
        recording,
        transcribing = false
    ) {

        isRecording =
            Boolean(recording);

        isTranscribing =
            Boolean(transcribing);


        composerInputRow.classList.toggle(
            "is-transcribing",
            isRecording ||
            isTranscribing
        );


        composerInputRow.classList.toggle(
            "is-processing-transcription",
            isTranscribing
        );


        micBtn.setAttribute(
            "aria-pressed",
            String(isRecording)
        );


        if (isTranscribing) {

            micBtn.setAttribute(
                "aria-label",
                "Transcribing"
            );

            micBtn.dataset.tooltip =
                "Transcribing";

        } else if (isRecording) {

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
                isTranscribing;

            stopRecBtn.setAttribute(
                "aria-busy",
                String(isTranscribing)
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
       WAVE BARS
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
                }
            );
    }


    /* =====================================================
       AUDIO LEVEL
       ===================================================== */

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


        return Math.min(
            1,
            Math.pow(
                Math.max(
                    0,
                    usable /
                    Math.max(
                        range,
                        0.001
                    )
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
            smoothedLevel <
            0.008
        ) {
            smoothedLevel =
                0;
        }


        return smoothedLevel;
    }


    /* =====================================================
       WAVE ANIMATION
       ===================================================== */

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


                const centerWeight =
                    1 -
                    distance *
                    0.46;


                const waveA =
                    Math.sin(
                        timestamp *
                        0.0048 +
                        index *
                        0.92
                    );


                const waveB =
                    Math.sin(
                        timestamp *
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


                const energy =
                    Math.max(
                        0,
                        Math.min(
                            1,
                            level *
                            centerWeight *
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
                    Math.min(
                        1,
                        level *
                        1.8
                    ) *
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
       PCM MERGE
       ===================================================== */

    function mergeFloat32Chunks(
        chunks
    ) {

        let totalLength =
            0;


        for (
            const chunk
            of chunks
        ) {
            totalLength +=
                chunk.length;
        }


        const merged =
            new Float32Array(
                totalLength
            );


        let offset =
            0;


        for (
            const chunk
            of chunks
        ) {

            merged.set(
                chunk,
                offset
            );


            offset +=
                chunk.length;
        }


        return merged;
    }


    /* =====================================================
       RESAMPLE → 16 kHz

       Reduces upload size dramatically.
       ===================================================== */

    function downsampleBuffer(
        input,
        inputRate,
        outputRate
    ) {

        if (
            outputRate >=
            inputRate
        ) {
            return input;
        }


        const ratio =
            inputRate /
            outputRate;


        const outputLength =
            Math.round(
                input.length /
                ratio
            );


        const output =
            new Float32Array(
                outputLength
            );


        let inputOffset =
            0;


        for (
            let i = 0;
            i < outputLength;
            i += 1
        ) {

            const nextInputOffset =
                Math.round(
                    (i + 1) *
                    ratio
                );


            let sum =
                0;

            let count =
                0;


            for (
                let j =
                    inputOffset;

                j <
                    nextInputOffset &&
                j <
                    input.length;

                j += 1
            ) {

                sum +=
                    input[j];

                count +=
                    1;
            }


            output[i] =
                count >
                0
                    ? sum / count
                    : 0;


            inputOffset =
                nextInputOffset;
        }


        return output;
    }


    /* =====================================================
       WAV ENCODER
       PCM16 mono
       ===================================================== */

    function writeAscii(
        view,
        offset,
        text
    ) {

        for (
            let i = 0;
            i < text.length;
            i += 1
        ) {

            view.setUint8(
                offset + i,
                text.charCodeAt(i)
            );
        }
    }


    function encodeWav(
        samples,
        sampleRate
    ) {

        const bytesPerSample =
            2;

        const channelCount =
            1;

        const dataLength =
            samples.length *
            bytesPerSample;


        const buffer =
            new ArrayBuffer(
                44 +
                dataLength
            );


        const view =
            new DataView(
                buffer
            );


        /* RIFF */

        writeAscii(
            view,
            0,
            "RIFF"
        );


        view.setUint32(
            4,
            36 +
            dataLength,
            true
        );


        writeAscii(
            view,
            8,
            "WAVE"
        );


        /* fmt */

        writeAscii(
            view,
            12,
            "fmt "
        );


        view.setUint32(
            16,
            16,
            true
        );


        /* PCM */

        view.setUint16(
            20,
            1,
            true
        );


        view.setUint16(
            22,
            channelCount,
            true
        );


        view.setUint32(
            24,
            sampleRate,
            true
        );


        view.setUint32(
            28,
            sampleRate *
            channelCount *
            bytesPerSample,
            true
        );


        view.setUint16(
            32,
            channelCount *
            bytesPerSample,
            true
        );


        view.setUint16(
            34,
            16,
            true
        );


        /* data */

        writeAscii(
            view,
            36,
            "data"
        );


        view.setUint32(
            40,
            dataLength,
            true
        );


        let offset =
            44;


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


            const pcm =
                sample < 0
                    ? sample *
                        0x8000
                    : sample *
                        0x7fff;


            view.setInt16(
                offset,
                pcm,
                true
            );


            offset +=
                2;
        }


        return new Blob(
            [buffer],
            {
                type:
                    "audio/wav"
            }
        );
    }


    /* =====================================================
       BUILD WAV
       ===================================================== */

    function createRecordedWav() {

        if (
            !pcmChunks.length
        ) {
            return null;
        }


        const merged =
            mergeFloat32Chunks(
                pcmChunks
            );


        if (
            !merged.length
        ) {
            return null;
        }


        const targetRate =
            Math.min(
                CONFIG.targetSampleRate,
                inputSampleRate
            );


        const samples =
            downsampleBuffer(
                merged,
                inputSampleRate,
                targetRate
            );


        return encodeWav(
            samples,
            targetRate
        );
    }


    /* =====================================================
       AUDIO GRAPH CLEANUP
       ===================================================== */

    function stopAudioGraph() {

        if (
            animationFrameId
        ) {

            cancelAnimationFrame(
                animationFrameId
            );

            animationFrameId =
                0;
        }


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
            sourceNode
        ) {

            try {
                sourceNode.disconnect();
            } catch {}


            sourceNode =
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
            silentGainNode
        ) {

            try {
                silentGainNode.disconnect();
            } catch {}


            silentGainNode =
                null;
        }


        analyserData =
            null;


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


        if (
            mediaStream
        ) {

            mediaStream
                .getTracks()
                .forEach(
                    track => {

                        try {
                            track.stop();
                        } catch {}
                    }
                );


            mediaStream =
                null;
        }


        resetWaveform();
    }


    /* =====================================================
       TRANSCRIBE
       ===================================================== */

    async function transcribeAudio(
        wavBlob
    ) {

        const formData =
            new FormData();


        formData.append(
            "audio",
            wavBlob,
            "voice.wav"
        );


        const recentContext =
            getRecentContext();


        if (
            recentContext
        ) {

            formData.append(
                "context",
                recentContext
            );
        }


        console.log(
            "[NEYO Voice] sending WAV",
            {
                type:
                    wavBlob.type,

                size:
                    wavBlob.size,

                contextChars:
                    recentContext.length
            }
        );


        const response =
            await fetch(
                CONFIG.transcribeEndpoint,
                {
                    method:
                        "POST",

                    body:
                        formData,

                    credentials:
                        "same-origin"
                }
            );


        const rawText =
            await response.text();


        let data =
            null;


        try {

            data =
                JSON.parse(
                    rawText
                );

        } catch {

            data =
                null;
        }


        console.log(
            "[NEYO Voice] transcription response",
            response.status,
            data
        );


        if (
            !response.ok
        ) {

            throw new Error(
                data?.error ||
                rawText ||
                `Transcription failed (${response.status})`
            );
        }


        const transcript =
            String(
                data?.transcript ||
                ""
            ).trim();


        if (
            !transcript
        ) {

            throw new Error(
                "No transcript returned."
            );
        }


        return transcript;
    }


    /* =====================================================
       PROCESS RECORDING
       ===================================================== */

    async function processRecording() {

        const duration =
            Date.now() -
            recordingStartedAt;


        if (
            duration <
            CONFIG.minimumRecordingMs
        ) {

            pcmChunks =
                [];


            setVoiceState(
                false,
                false
            );


            return;
        }


        const wavBlob =
            createRecordedWav();


        pcmChunks =
            [];


        if (
            !wavBlob ||
            wavBlob.size <= 44
        ) {

            setVoiceState(
                false,
                false
            );


            console.warn(
                "[NEYO Voice] empty WAV recording"
            );


            return;
        }


        console.log(
            "[NEYO Voice] WAV ready",
            {
                size:
                    wavBlob.size,

                inputSampleRate,

                outputSampleRate:
                    Math.min(
                        CONFIG.targetSampleRate,
                        inputSampleRate
                    )
            }
        );


        setVoiceState(
            false,
            true
        );


        try {

            const transcript =
                await transcribeAudio(
                    wavBlob
                );


            insertTranscript(
                transcript
            );

        } catch (error) {

            console.error(
                "[NEYO Voice] transcription failed:",
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

            console.error(
                "[NEYO Voice] microphone API unavailable"
            );

            return;
        }


        const AudioContextClass =
            window.AudioContext ||
            window.webkitAudioContext;


        if (
            !AudioContextClass
        ) {

            console.error(
                "[NEYO Voice] Web Audio API unavailable"
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
                                true,

                            channelCount:
                                1
                        },

                        video:
                            false
                    });


            audioContext =
                new AudioContextClass();


            if (
                audioContext.state ===
                    "suspended"
            ) {

                await audioContext
                    .resume();
            }


            inputSampleRate =
                audioContext.sampleRate;


            pcmChunks =
                [];


            sourceNode =
                audioContext
                    .createMediaStreamSource(
                        mediaStream
                    );


            /* Analyser */

            analyser =
                audioContext
                    .createAnalyser();


            analyser.fftSize =
                CONFIG.fftSize;


            analyser
                .smoothingTimeConstant =
                CONFIG.analyserSmoothing;


            analyserData =
                new Uint8Array(
                    analyser.fftSize
                );


            sourceNode.connect(
                analyser
            );


            /* PCM recorder */

            processorNode =
                audioContext
                    .createScriptProcessor(
                        CONFIG.bufferSize,
                        1,
                        1
                    );


            silentGainNode =
                audioContext
                    .createGain();


            silentGainNode.gain.value =
                0;


            sourceNode.connect(
                processorNode
            );


            processorNode.connect(
                silentGainNode
            );


            silentGainNode.connect(
                audioContext.destination
            );


            processorNode.onaudioprocess =
                event => {

                    if (
                        !isRecording
                    ) {
                        return;
                    }


                    const input =
                        event.inputBuffer
                            .getChannelData(
                                0
                            );


                    pcmChunks.push(
                        new Float32Array(
                            input
                        )
                    );
                };


            recordingStartedAt =
                Date.now();


            setVoiceState(
                true,
                false
            );


            resetWaveform();


            animationFrameId =
                requestAnimationFrame(
                    renderWaveform
                );


            window.clearTimeout(
                recordingTimer
            );


            recordingTimer =
                window.setTimeout(
                    stopRecording,
                    CONFIG.maxRecordingMs
                );


            console.log(
                "[NEYO Voice] WAV recording started",
                {
                    inputSampleRate
                }
            );

        } catch (error) {

            console.error(
                "[NEYO Voice] microphone start failed:",
                error
            );


            stopAudioGraph();


            pcmChunks =
                [];


            setVoiceState(
                false,
                false
            );
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


        if (
            !isRecording
        ) {
            return;
        }


        /*
        Freeze PCM collection first.
        */

        isRecording =
            false;


        const duration =
            Date.now() -
            recordingStartedAt;


        /*
        Disconnect audio only after chunks
        are already stored in memory.
        */

        stopAudioGraph();


        console.log(
            "[NEYO Voice] recording stopped",
            {
                duration,
                chunks:
                    pcmChunks.length
            }
        );


        /*
        Process on next task so UI can settle.
        */

        setTimeout(
            processRecording,
            0
        );
    }


    /* =====================================================
       MIC
       ===================================================== */

    micBtn.addEventListener(
        "click",
        event => {

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();


            if (
                isTranscribing
            ) {
                return;
            }


            if (
                isRecording
            ) {

                stopRecording();

            } else {

                startRecording();
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


            if (
                isRecording
            ) {

                stopRecording();
            }
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


            isRecording =
                false;


            stopAudioGraph();


            pcmChunks =
                [];

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
                    isTranscribing,

            engine:
                "pcm-wav-gemini"
        });

})();
