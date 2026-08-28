/*
=========================================================
NEYO — CHAT RUNTIME
ROUTING ONLY v5

FILE:
public/js/components/chat-runtime.js

PURPOSE
---------------------------------------------------------
Runtime support layer only.

OWNS
---------------------------------------------------------
- Runtime activation
- New Conversation routing
- Starter prompt routing
- History active-state synchronization
- Runtime health reporting
- Legacy chat-action isolation where needed

DOES NOT OWN
---------------------------------------------------------
- #sendBtn
- Send arrow
- Stop square
- Enter key
- Shift + Enter
- NeyoChat.send()
- NeyoChat.stop()

SEND / STOP OWNER
---------------------------------------------------------
public/js/components/send-state.js
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       VERSION / GUARD
       ===================================================== */

    const VERSION =
        "neyo-chat-runtime-routing-only-v5";


    if (
        window.NeyoChatRuntime
            ?.__controller === true
    ) {

        console.warn(
            "[NEYO Runtime] Already initialized."
        );


        return;

    }


    /* =====================================================
       CONFIG
       ===================================================== */

    const CONFIG =
        Object.freeze({

            debug:
                true,

            dependencyWaitMs:
                8000,

            dependencyPollMs:
                50

        });


    /* =====================================================
       DOM
       ===================================================== */

    const chatInput =
        document.getElementById(
            "chatInput"
        );


    /* =====================================================
       STATE
       ===================================================== */

    const state = {

        active:
            false,

        ready:
            false,

        activating:
            false,

        generating:
            false,

        reason:
            null,

        startedAt:
            Date.now(),

        activatedAt:
            null

    };


    /* =====================================================
       EVENTS
       ===================================================== */

    function emit(
        name,
        detail = {}
    ) {

        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail
                }
            )
        );

    }


    /* =====================================================
       DEBUG
       ===================================================== */

    function debug(
        ...args
    ) {

        if (
            !CONFIG.debug
        ) {
            return;
        }


        console.log(
            "[NEYO Runtime]",
            ...args
        );

    }


    /* =====================================================
       HELPERS
       ===================================================== */

    function isElement(
        value
    ) {

        return (
            value instanceof
            Element
        );

    }


    function closest(
        target,
        selector
    ) {

        if (
            !isElement(
                target
            )
        ) {
            return null;
        }


        try {

            return target.closest(
                selector
            );

        } catch {

            return null;

        }

    }


    /* =====================================================
       DEPENDENCY CHECK
       ===================================================== */

    function validateModules() {

        if (
            !window.NeyoChat ||
            typeof window.NeyoChat.send !==
                "function"
        ) {

            return {

                valid:
                    false,

                reason:
                    "NeyoChat.send() unavailable."

            };

        }


        if (
            typeof window.NeyoChat.stop !==
                "function"
        ) {

            return {

                valid:
                    false,

                reason:
                    "NeyoChat.stop() unavailable."

            };

        }


        if (
            window.NeyoSendState
                ?.__controller !== true
        ) {

            return {

                valid:
                    false,

                reason:
                    "NeyoSendState unavailable."

            };

        }


        return {

            valid:
                true,

            reason:
                null

        };

    }


    /* =====================================================
       WAIT
       ===================================================== */

    function waitForDependencies() {

        return new Promise(
            resolve => {

                const started =
                    Date.now();


                const check =
                    () => {

                        const result =
                            validateModules();


                        if (
                            result.valid
                        ) {

                            resolve(
                                result
                            );


                            return;

                        }


                        if (
                            Date.now() -
                                started >=
                            CONFIG.dependencyWaitMs
                        ) {

                            resolve(
                                result
                            );


                            return;

                        }


                        window.setTimeout(
                            check,
                            CONFIG.dependencyPollMs
                        );

                    };


                check();

            }
        );

    }


    /* =====================================================
       RUNTIME ATTRIBUTE
       ===================================================== */

    function setRuntimeAttribute(
        active
    ) {

        const root =
            document.documentElement;


        if (
            active
        ) {

            root.setAttribute(
                "data-neyo-chat-runtime",
                "routing-only-v5"
            );


            root.classList.add(
                "neyo-chat-v2"
            );


            return;

        }


        root.removeAttribute(
            "data-neyo-chat-runtime"
        );


        root.classList.remove(
            "neyo-chat-v2"
        );

    }


    /* =====================================================
       STARTER PROMPTS
       ===================================================== */

    function handleStarterPrompt(
        button,
        event
    ) {

        const prompt =
            String(
                button.dataset
                    ?.prompt ||
                ""
            )
                .trim();


        if (
            !prompt ||
            !chatInput
        ) {
            return false;
        }


        event.preventDefault();


        event.stopPropagation();


        event.stopImmediatePropagation();


        chatInput.value =
            prompt;


        chatInput.dispatchEvent(
            new Event(
                "input",
                {
                    bubbles:
                        true
                }
            )
        );


        /*
         * Send through the ONE canonical Send owner.
         */

        try {

            window.NeyoSendState
                ?.send
                ?.();

        } catch (
            error
        ) {

            console.error(
                "[NEYO Runtime] Starter prompt send failed:",
                error
            );


            return false;

        }


        return true;

    }


    /* =====================================================
       NEW CHAT
       ===================================================== */

    function requestNewChat(
        event
    ) {

        if (
            event
        ) {

            event.preventDefault();


            event.stopPropagation();


            event.stopImmediatePropagation();

        }


        emit(
            "neyo:chat-new-request"
        );


        return true;

    }


    /* =====================================================
       CLICK ROUTING
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            if (
                !state.active
            ) {
                return;
            }


            /*
            -------------------------------------------------
            IMPORTANT:

            #sendBtn is intentionally NOT handled here.

            send-state.js is the sole Send / Stop owner.
            -------------------------------------------------
            */


            /* =================================================
               NEW CHAT
               ================================================= */

            const newChatButton =
                closest(
                    event.target,
                    "#newChatBtn"
                );


            if (
                newChatButton
            ) {

                requestNewChat(
                    event
                );


                return;

            }


            /* =================================================
               STARTER PROMPT
               ================================================= */

            const starterButton =
                closest(
                    event.target,
                    "[data-prompt]"
                );


            if (
                starterButton
            ) {

                handleStarterPrompt(
                    starterButton,
                    event
                );


                return;

            }

        },
        true
    );


    /* =====================================================
       NO KEYDOWN OWNERSHIP
       ===================================================== */

    /*
     * IMPORTANT:
     *
     * There is intentionally NO Enter / keydown listener
     * in chat-runtime.js.
     *
     * send-state.js owns Enter completely.
     */


    /* =====================================================
       GENERATION SYNC
       ===================================================== */

    window.addEventListener(
        "neyo:chat-send-start",
        () => {

            state.generating =
                true;

        }
    );


    function generationFinished() {

        state.generating =
            false;

    }


    for (
        const eventName
        of [

            "neyo:chat-send-end",

            "neyo:chat-response",

            "neyo:chat-error",

            "neyo:chat-aborted",

            "neyo:chat-limit-reached",

            "neyo:chat-new",

            "neyo:chat-state-loaded"

        ]
    ) {

        window.addEventListener(
            eventName,
            generationFinished
        );

    }


    /* =====================================================
       HISTORY ACTIVE SYNC
       ===================================================== */

    function syncConversation(
        event
    ) {

        if (
            !state.active
        ) {
            return;
        }


        const conversationId =
            event.detail
                ?.conversationId ||
            event.detail
                ?.id ||
            null;


        if (
            !conversationId
        ) {
            return;
        }


        emit(
            "neyo:history-active-set",
            {
                conversationId
            }
        );

    }


    window.addEventListener(
        "neyo:conversation-loaded",
        syncConversation
    );


    window.addEventListener(
        "neyo:chat-state-loaded",
        syncConversation
    );


    /* =====================================================
       NEW CHAT STATE
       ===================================================== */

    window.addEventListener(
        "neyo:chat-new",
        () => {

            emit(
                "neyo:history-active-set",
                {
                    conversationId:
                        null
                }
            );


            try {

                window.NeyoSendState
                    ?.update
                    ?.();

            } catch {}

        }
    );


    /* =====================================================
       ACTIVE CONVERSATION DELETED
       ===================================================== */

    window.addEventListener(
        "neyo:active-conversation-deleted",
        () => {

            if (
                !state.active
            ) {
                return;
            }


            emit(
                "neyo:chat-new-request"
            );

        }
    );


    /* =====================================================
       ACTIVATE
       ===================================================== */

    async function activate() {

        if (
            state.active
        ) {
            return true;
        }


        if (
            state.activating
        ) {
            return false;
        }


        state.activating =
            true;


        try {

            const result =
                await waitForDependencies();


            if (
                !result.valid
            ) {

                state.active =
                    false;


                state.ready =
                    false;


                state.reason =
                    result.reason;


                setRuntimeAttribute(
                    false
                );


                console.error(
                    "[NEYO Runtime] Activation failed:",
                    result.reason
                );


                emit(
                    "neyo:runtime-error",
                    {

                        version:
                            VERSION,

                        reason:
                            result.reason

                    }
                );


                return false;

            }


            state.active =
                true;


            state.ready =
                true;


            state.reason =
                null;


            state.activatedAt =
                Date.now();


            setRuntimeAttribute(
                true
            );


            emit(
                "neyo:chat-state-sync-request"
            );


            try {

                window.NeyoSendState
                    ?.update
                    ?.();

            } catch {}


            emit(
                "neyo:runtime-ready",
                {

                    version:
                        VERSION,

                    active:
                        true,

                    mode:
                        "routing-only",

                    sendOwner:
                        "NeyoSendState"

                }
            );


            debug(
                "ACTIVE",
                {

                    version:
                        VERSION,

                    sendOwner:
                        "NeyoSendState",

                    chat:
                        window.NeyoChat
                            ?.getState
                            ?.(),

                    send:
                        window.NeyoSendState
                            ?.getState
                            ?.()

                }
            );


            return true;

        } catch (
            error
        ) {

            state.active =
                false;


            state.ready =
                false;


            state.reason =
                error?.message ||
                "Runtime activation failed.";


            setRuntimeAttribute(
                false
            );


            console.error(
                "[NEYO Runtime] Activation exception:",
                error
            );


            return false;

        } finally {

            state.activating =
                false;

        }

    }


    /* =====================================================
       DEACTIVATE
       ===================================================== */

    function deactivate(
        reason =
            "Runtime disabled."
    ) {

        state.active =
            false;


        state.ready =
            false;


        state.generating =
            false;


        state.reason =
            reason;


        setRuntimeAttribute(
            false
        );


        emit(
            "neyo:runtime-disabled",
            {

                version:
                    VERSION,

                reason

            }
        );


        return true;

    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    const api =
        Object.freeze({

            __controller:
                true,

            version:
                VERSION,

            activate,

            deactivate,


            /*
             * Compatibility public calls route through
             * NeyoSendState without owning its UI.
             */

            send() {

                if (
                    !state.active
                ) {
                    return false;
                }


                return Boolean(
                    window.NeyoSendState
                        ?.send
                        ?.()
                );

            },


            stop() {

                if (
                    !state.active
                ) {
                    return false;
                }


                return Boolean(
                    window.NeyoSendState
                        ?.stop
                        ?.()
                );

            },


            check:
                validateModules,


            isActive() {

                return state.active;

            },


            getState() {

                return {

                    version:
                        VERSION,

                    active:
                        state.active,

                    ready:
                        state.ready,

                    activating:
                        state.activating,

                    generating:
                        state.generating,

                    reason:
                        state.reason,

                    sendOwner:
                        "NeyoSendState",

                    runtimeOwnsSendButton:
                        false,

                    runtimeOwnsEnter:
                        false,

                    activatedAt:
                        state.activatedAt,

                    uptimeMs:
                        Date.now() -
                        state.startedAt

                };

            }

        });


    Object.defineProperty(
        window,
        "NeyoChatRuntime",
        {

            value:
                api,

            writable:
                false,

            configurable:
                true,

            enumerable:
                true

        }
    );


    /* =====================================================
       BOOT
       ===================================================== */

    void activate();

})();
