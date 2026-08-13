/*
=========================================================
NEYO — VOICE INPUT COMPONENT

Owns:
- Microphone button
- Speech recognition
- Listening state
- Interim transcript
- Final transcript
- Voice UI state
- Public voice events / API

Does NOT own:
- Message sending
- Chat API
- Composer resize internals
- Audio upload
- Voice message recording
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       ELEMENTS
       ===================================================== */

    const micBtn =
        document.getElementById("micBtn");

    const chatInput =
        document.getElementById("chatInput");


    if (
        !micBtn ||
        !chatInput
    ) {
        return;
    }


    /* =====================================================
       SPEECH API
       ===================================================== */

    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;


    /* =====================================================
       STATE
       ===================================================== */

    let recognition = null;

    let isListening = false;

    let baseText = "";

    let finalTranscript = "";


    /* =====================================================
       HELPERS
       ===================================================== */

    const emit = (
        name,
        detail = {}
    ) => {

        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail
                }
            )
        );

    };


    const refreshComposer = () => {

        window.dispatchEvent(
            new CustomEvent(
                "neyo:composer-refresh"
            )
        );

    };


    const setListeningState =
        listening => {

            isListening =
                Boolean(listening);


            micBtn.classList.toggle(
                "listening",
                isListening
            );


            micBtn.classList.toggle(
                "is-recording",
                isListening
            );


            micBtn.setAttribute(
                "aria-pressed",
                String(isListening)
            );


            micBtn.setAttribute(
                "aria-label",
                isListening
                    ? "Stop voice input"
                    : "Start voice input"
            );


            emit(
                "neyo:voice-state-change",
                {
                    listening:
                        isListening
                }
            );

        };


    /* =====================================================
       UNSUPPORTED
       ===================================================== */

    const handleUnsupported = () => {

        micBtn.disabled =
            true;


        micBtn.setAttribute(
            "aria-disabled",
            "true"
        );


        micBtn.dataset.tooltip =
            "Voice input is not supported in this browser";


        emit(
            "neyo:voice-unsupported"
        );

    };


    /* =====================================================
       CREATE RECOGNITION
       ===================================================== */

    const createRecognition = () => {

        if (!SpeechRecognition) {
            return null;
        }


        const instance =
            new SpeechRecognition();


        instance.continuous =
            true;


        instance.interimResults =
            true;


        instance.lang =
            document.documentElement.lang ||
            "en-US";


        /* =================================================
           START
           ================================================= */

        instance.addEventListener(
            "start",
            () => {

                setListeningState(
                    true
                );


                emit(
                    "neyo:voice-start"
                );

            }
        );


        /* =================================================
           RESULT
           ================================================= */

        instance.addEventListener(
            "result",
            event => {

                let interimTranscript =
                    "";


                for (
                    let index =
                        event.resultIndex;

                    index <
                    event.results.length;

                    index++
                ) {

                    const result =
                        event.results[index];


                    const transcript =
                        result[0]
                            ?.transcript ||
                        "";


                    if (
                        result.isFinal
                    ) {

                        finalTranscript +=
                            transcript;

                    } else {

                        interimTranscript +=
                            transcript;

                    }

                }


                const spacing =
                    baseText &&
                    !baseText.endsWith(" ")
                        ? " "
                        : "";


                const voiceText =
                    (
                        finalTranscript +
                        interimTranscript
                    ).trimStart();


                chatInput.value =
                    `${baseText}${spacing}${voiceText}`;


                refreshComposer();


                emit(
                    "neyo:voice-transcript",
                    {
                        final:
                            finalTranscript,

                        interim:
                            interimTranscript,

                        value:
                            chatInput.value
                    }
                );

            }
        );


        /* =================================================
           ERROR
           ================================================= */

        instance.addEventListener(
            "error",
            event => {

                setListeningState(
                    false
                );


                emit(
                    "neyo:voice-error",
                    {
                        error:
                            event.error ||
                            "unknown"
                    }
                );

            }
        );


        /* =================================================
           END
           ================================================= */

        instance.addEventListener(
            "end",
            () => {

                setListeningState(
                    false
                );


                emit(
                    "neyo:voice-end",
                    {
                        value:
                            chatInput.value
                    }
                );

            }
        );


        return instance;

    };


    /* =====================================================
       START LISTENING
       ===================================================== */

    const startListening = () => {

        if (!SpeechRecognition) {

            handleUnsupported();

            return false;

        }


        if (isListening) {
            return true;
        }


        recognition ??=
            createRecognition();


        if (!recognition) {
            return false;
        }


        baseText =
            chatInput.value.trimEnd();


        finalTranscript =
            "";


        try {

            recognition.start();

            return true;

        }

        catch (error) {

            emit(
                "neyo:voice-error",
                {
                    error:
                        error?.message ||
                        "start_failed"
                }
            );


            return false;

        }

    };


    /* =====================================================
       STOP LISTENING
       ===================================================== */

    const stopListening = () => {

        if (
            !recognition ||
            !isListening
        ) {
            return;
        }


        try {

            recognition.stop();

        }

        catch {

            setListeningState(
                false
            );

        }

    };


    /* =====================================================
       TOGGLE
       ===================================================== */

    const toggleListening = () => {

        if (isListening) {

            stopListening();

        } else {

            startListening();

        }

    };


    /* =====================================================
       BUTTON
       ===================================================== */

    micBtn.addEventListener(
        "click",
        event => {

            event.preventDefault();

            event.stopPropagation();


            toggleListening();

        }
    );


    /* =====================================================
       ESCAPE
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Escape" &&
                isListening
            ) {

                stopListening();

            }

        }
    );


    /* =====================================================
       PAGE VISIBILITY
       ===================================================== */

    document.addEventListener(
        "visibilitychange",
        () => {

            if (
                document.hidden &&
                isListening
            ) {

                stopListening();

            }

        }
    );


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:voice-start-request",
        startListening
    );


    window.addEventListener(
        "neyo:voice-stop-request",
        stopListening
    );


    window.addEventListener(
        "neyo:voice-toggle-request",
        toggleListening
    );


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    micBtn.setAttribute(
        "aria-pressed",
        "false"
    );


    if (!SpeechRecognition) {

        handleUnsupported();

    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoVoice =
        Object.freeze({

            start:
                startListening,

            stop:
                stopListening,

            toggle:
                toggleListening,

            isListening:
                () =>
                    isListening,

            isSupported:
                () =>
                    Boolean(
                        SpeechRecognition
                    ),

            setLanguage:
                language => {

                    if (!language) {
                        return;
                    }


                    recognition ??=
                        createRecognition();


                    if (recognition) {

                        recognition.lang =
                            language;

                    }

                }

        });

})();
