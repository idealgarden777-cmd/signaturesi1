/*
=========================================================
NEYO — MESSAGES CORE
CANONICAL CHAT PIPELINE v3

FILE:
public/js/components/messages.js

OWNS
- Message DOM shells
- User messages
- Assistant messages
- Thinking state
- Message updates
- Message removal
- Attachments display
- Sources display
- History-loaded messages
- Auto scroll
- Hero visibility

IMPORTANT
---------------------------------------------------------
Supports BOTH:

Canonical:
neyo:chat-message-added

Legacy:
neyo:message-create

neo.js may remain loaded.
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       VERSION / GUARD
       ===================================================== */

    const VERSION =
        "neyo-messages-canonical-v3";


    if (
        window.NeyoMessages
            ?.__controller === true
    ) {
        console.warn(
            "[NEYO Messages] Already initialized."
        );

        return;
    }


    /* =====================================================
       DOM
       ===================================================== */

    const chatMessages =
        document.getElementById(
            "chatMessages"
        );


    const scrollArea =
        document.getElementById(
            "scrollArea"
        );


    const heroSection =
        document.getElementById(
            "heroSection"
        );


    if (!chatMessages) {
        console.warn(
            "[NEYO Messages] #chatMessages missing."
        );

        return;
    }


    /* =====================================================
       STATE
       ===================================================== */

    let thinkingElement =
        null;


    let nearBottom =
        true;


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
       TEXT
       ===================================================== */

    function clean(
        value,
        max = 50_000
    ) {

        return String(
            value ?? ""
        )
            .replace(
                /\u0000/g,
                ""
            )
            .replace(
                /\r\n?/g,
                "\n"
            )
            .slice(
                0,
                max
            );

    }


    /* =====================================================
       ID
       ===================================================== */

    function createId() {

        try {

            return (
                globalThis.crypto
                    ?.randomUUID
                    ?.() ||
                `msg_${Date.now()}_${Math.random()
                    .toString(36)
                    .slice(2, 9)}`
            );

        } catch {

            return (
                `msg_${Date.now()}_${Math.random()
                    .toString(36)
                    .slice(2, 9)}`
            );

        }

    }


    /* =====================================================
       ICONS
       ===================================================== */

    function refreshIcons() {

        try {

            window.lucide
                ?.createIcons
                ?.();

        } catch {}

    }


    /* =====================================================
       MESSAGE ID
       ===================================================== */

    function messageId(
        message
    ) {

        return clean(
            message?.id ||
            message?.messageId ||
            "",
            200
        ).trim();

    }


    /* =====================================================
       FIND MESSAGE
       ===================================================== */

    function findMessage(
        id
    ) {

        if (!id) {
            return null;
        }


        const value =
            String(id);


        return (
            Array
                .from(
                    chatMessages
                        .querySelectorAll(
                            "[data-neyo-message-id]"
                        )
                )
                .find(
                    element =>
                        element.dataset
                            .neyoMessageId ===
                        value
                ) ||
            null
        );

    }


    /* =====================================================
       HERO
       ===================================================== */

    function updateHero() {

        if (!heroSection) {
            return;
        }


        const hasMessages =
            Boolean(
                chatMessages.querySelector(
                    '[data-neyo-message-id]:not([data-neyo-message-id="neyo-thinking"])'
                )
            );


        heroSection.style.display =
            hasMessages
                ? "none"
                : "";


        heroSection.setAttribute(
            "aria-hidden",
            String(
                hasMessages
            )
        );

    }


    /* =====================================================
       SCROLL
       ===================================================== */

    function isNearBottom() {

        if (!scrollArea) {
            return true;
        }


        return (
            scrollArea.scrollHeight -
            scrollArea.scrollTop -
            scrollArea.clientHeight
        ) <= 140;

    }


    function scrollToBottom(
        behavior = "auto",
        force = false
    ) {

        if (!scrollArea) {
            return false;
        }


        if (
            !force &&
            !nearBottom
        ) {
            return false;
        }


        try {

            scrollArea.scrollTo({
                top:
                    scrollArea.scrollHeight,

                behavior
            });

        } catch {

            scrollArea.scrollTop =
                scrollArea.scrollHeight;

        }


        nearBottom =
            true;


        return true;

    }


    scrollArea
        ?.addEventListener(
            "scroll",
            () => {

                nearBottom =
                    isNearBottom();

            },
            {
                passive:
                    true
            }
        );


    /* =====================================================
       ATTACHMENT HELPERS
       ===================================================== */

    function formatBytes(
        bytes
    ) {

        const value =
            Math.max(
                0,
                Number(bytes) || 0
            );


        if (!value) {
            return "";
        }


        if (value < 1024) {
            return `${value} B`;
        }


        if (
            value <
            1024 * 1024
        ) {

            return `${
                (
                    value /
                    1024
                ).toFixed(1)
            } KB`;

        }


        if (
            value <
            1024 * 1024 * 1024
        ) {

            return `${
                (
                    value /
                    1024 /
                    1024
                ).toFixed(1)
            } MB`;

        }


        return `${
            (
                value /
                1024 /
                1024 /
                1024
            ).toFixed(1)
        } GB`;

    }


    function attachmentIcon(
        file
    ) {

        const mime =
            clean(
                file?.mimeType ||
                file?.mime ||
                file?.type ||
                "",
                180
            )
                .toLowerCase();


        const category =
            clean(
                file?.category ||
                "",
                50
            )
                .toLowerCase();


        if (
            category === "image" ||
            mime.startsWith(
                "image/"
            )
        ) {
            return "image";
        }


        if (
            category === "code"
        ) {
            return "file-code-2";
        }


        if (
            category ===
            "spreadsheet"
        ) {
            return "sheet";
        }


        if (
            category ===
            "presentation"
        ) {
            return "presentation";
        }


        if (
            category ===
            "archive"
        ) {
            return "archive";
        }


        if (
            category === "audio" ||
            mime.startsWith(
                "audio/"
            )
        ) {
            return "audio-lines";
        }


        if (
            category === "video" ||
            mime.startsWith(
                "video/"
            )
        ) {
            return "video";
        }


        return "file-text";

    }


    function createAttachmentCard(
        file
    ) {

        const card =
            document.createElement(
                "div"
            );


        card.className =
            "message-file-pill neyo-message-file-card";


        const iconWrapper =
            document.createElement(
                "span"
            );


        iconWrapper.className =
            "neyo-message-file-icon";


        const icon =
            document.createElement(
                "i"
            );


        icon.setAttribute(
            "data-lucide",
            attachmentIcon(
                file
            )
        );


        icon.setAttribute(
            "aria-hidden",
            "true"
        );


        iconWrapper.appendChild(
            icon
        );


        const body =
            document.createElement(
                "span"
            );


        body.className =
            "neyo-message-file-body";


        const name =
            document.createElement(
                "span"
            );


        name.className =
            "neyo-message-file-name";


        name.textContent =
            clean(
                file?.name ||
                "Attached file",
                220
            );


        body.appendChild(
            name
        );


        const size =
            formatBytes(
                file?.size
            );


        if (size) {

            const meta =
                document.createElement(
                    "span"
                );


            meta.className =
                "neyo-message-file-meta";


            meta.textContent =
                size;


            body.appendChild(
                meta
            );

        }


        card.append(
            iconWrapper,
            body
        );


        return card;

    }


    function createAttachments(
        files
    ) {

        if (
            !Array.isArray(
                files
            ) ||
            files.length === 0
        ) {
            return null;
        }


        const container =
            document.createElement(
                "div"
            );


        container.className =
            "message-attachments";


        files
            .slice(
                0,
                5
            )
            .forEach(
                file => {

                    if (
                        !file ||
                        typeof file !==
                        "object"
                    ) {
                        return;
                    }


                    container.appendChild(
                        createAttachmentCard(
                            file
                        )
                    );

                }
            );


        return container;

    }


    /* =====================================================
       SOURCES
       ===================================================== */

    function createSources(
        sources
    ) {

        if (
            !Array.isArray(
                sources
            ) ||
            sources.length === 0
        ) {
            return null;
        }


        const container =
            document.createElement(
                "div"
            );


        container.className =
            "message-sources";


        sources
            .slice(
                0,
                10
            )
            .forEach(
                source => {

                    if (!source) {
                        return;
                    }


                    const label =
                        clean(
                            source.title ||
                            source.name ||
                            source.url ||
                            "Source",
                            180
                        );


                    const url =
                        clean(
                            source.url ||
                            "",
                            2000
                        );


                    let element;


                    if (
                        url &&
                        /^https?:\/\//i
                            .test(
                                url
                            )
                    ) {

                        element =
                            document.createElement(
                                "a"
                            );


                        element.href =
                            url;


                        element.target =
                            "_blank";


                        element.rel =
                            "noopener noreferrer";

                    } else {

                        element =
                            document.createElement(
                                "span"
                            );

                    }


                    element.className =
                        "source-pill";


                    element.textContent =
                        label;


                    container.appendChild(
                        element
                    );

                }
            );


        return container;

    }


    /* =====================================================
       CONTENT RENDER
       ===================================================== */

    function renderContent(
        element,
        content,
        role
    ) {

        if (
            !(element instanceof HTMLElement)
        ) {
            return false;
        }


        const text =
            clean(
                content
            );


        if (
            role === "assistant" &&
            typeof window
                .NeyoMessageRenderer
                ?.renderInto ===
                "function"
        ) {

            try {

                return Boolean(
                    window
                        .NeyoMessageRenderer
                        .renderInto(
                            element,
                            text,
                            {
                                role:
                                    "assistant",

                                markdown:
                                    true
                            }
                        )
                );

            } catch (
                error
            ) {

                console.warn(
                    "[NEYO Messages] Markdown render failed:",
                    error
                );

            }

        }


        element.textContent =
            text;


        return true;

    }


    /* =====================================================
       ACTION BUTTONS

       IMPORTANT:
       -----------------------------------------------------
       Only the old DOM structure is restored here.

       No chat flow, history, edit logic or regenerate
       implementation is owned by this file.
       ===================================================== */


    function createUserActions() {

        const actions =
            document.createElement(
                "div"
            );


        actions.className =
            "user-msg-actions";


        const editButton =
            document.createElement(
                "button"
            );


        editButton.className =
            "user-action-btn user-edit-btn";


        editButton.type =
            "button";


        editButton.title =
            "Edit message";


        editButton.setAttribute(
            "aria-label",
            "Edit message"
        );


        editButton.innerHTML =
            '<i data-lucide="pencil" size="14"></i>';


        const copyButton =
            document.createElement(
                "button"
            );


        copyButton.className =
            "user-action-btn user-copy-btn";


        copyButton.type =
            "button";


        copyButton.title =
            "Copy text";


        copyButton.setAttribute(
            "aria-label",
            "Copy text"
        );


        copyButton.innerHTML =
            '<i data-lucide="copy" size="14"></i>';


        actions.append(
            editButton,
            copyButton
        );


        return actions;

    }


    function createAssistantActions() {

        const actions =
            document.createElement(
                "div"
            );


        actions.className =
            "message-actions";


        actions.innerHTML = `
            <button
                class="msg-action-btn copy-msg-btn"
                title="Copy"
                aria-label="Copy"
                type="button"
            >
                <i
                    data-lucide="copy"
                    size="16"
                ></i>
            </button>

            <button
                class="msg-action-btn share-msg-btn"
                title="Share"
                aria-label="Share"
                type="button"
            >
                <i
                    data-lucide="share-2"
                    size="16"
                ></i>
            </button>

            <button
                class="msg-action-btn regen-msg-btn"
                title="Regenerate"
                aria-label="Regenerate"
                type="button"
            >
                <i
                    data-lucide="rotate-cw"
                    size="16"
                ></i>
            </button>
        `;


        return actions;

    }


    /* =====================================================
       CREATE MESSAGE
       ===================================================== */

    function createMessage(
        input = {},
        options = {}
    ) {

        const message =
            typeof input ===
                "object" &&
            input !==
                null
                ? input
                : {
                    content:
                        String(
                            input ?? ""
                        )
                };


        const role =
            message.role ===
            "user"
                ? "user"
                : "assistant";


        const id =
            messageId(
                message
            ) ||
            createId();


        /*
         * Prevent duplicate DOM rows.
         */

        const existing =
            findMessage(
                id
            );


        if (existing) {

            updateMessage(
                existing,
                message.content,
                {
                    role,

                    message
                }
            );


            return existing;

        }


        /*
         * Real assistant response replaces Thinking.
         */

        if (
            role ===
            "assistant"
        ) {

            removeThinking();

        }


        const element =
            document.createElement(
                "div"
            );


        element.className =
            `message ${role}`;


        element.dataset
            .neyoMessageId =
            id;


        element.dataset
            .messageId =
            id;


        element.dataset.role =
            role;


        if (
            message.index !==
            undefined &&
            message.index !==
            null
        ) {

            element.dataset
                .msgIndex =
                String(
                    message.index
                );

        }


        const contentElement =
            document.createElement(
                "div"
            );


        contentElement.className =
            "message-content";


        renderContent(
            contentElement,
            message.content ||
            "",
            role
        );


        /* -------------------------------------------------
           USER
           ------------------------------------------------- */

        if (
            role === "user"
        ) {

            const wrapper =
                document.createElement(
                    "div"
                );


            wrapper.className =
                "message-wrapper";


            const attachments =
                createAttachments(
                    message.attachments
                );


            if (attachments) {

                wrapper.appendChild(
                    attachments
                );

            }


            wrapper.appendChild(
                contentElement
            );


            element.appendChild(
                wrapper
            );


            /*
             * ONLY RESTORED PART:
             * old user action buttons.
             */

            element.appendChild(
                createUserActions()
            );

        }


        /* -------------------------------------------------
           ASSISTANT
           ------------------------------------------------- */

        else {

            element.appendChild(
                contentElement
            );


            const sources =
                createSources(
                    message.sources
                );


            if (sources) {

                element.appendChild(
                    sources
                );

            }


            /*
             * ONLY RESTORED PART:
             * old assistant action buttons.
             */

            element.appendChild(
                createAssistantActions()
            );

        }


        chatMessages.appendChild(
            element
        );


        updateHero();


        refreshIcons();


        requestAnimationFrame(
            () => {

                scrollToBottom(
                    options.historyLoad
                        ? "auto"
                        : "smooth",
                    Boolean(
                        options.forceScroll
                    )
                );

            }
        );


        emit(
            "neyo:message-created",
            {
                message:
                    element,

                data: {
                    ...message,
                    id,
                    role
                }
            }
        );


        return element;

    }


    /* =====================================================
       UPDATE MESSAGE
       ===================================================== */

    function updateMessage(
        target,
        content = "",
        options = {}
    ) {

        let element =
            null;


        if (
            target instanceof
            HTMLElement
        ) {

            element =
                target;

        } else {

            element =
                findMessage(
                    target
                );

        }


        if (!element) {

            const message =
                options.message;


            if (
                message &&
                typeof message ===
                "object"
            ) {

                return createMessage(
                    message
                );

            }


            return null;

        }


        element.classList.remove(
            "is-thinking"
        );


        const contentElement =
            element.querySelector(
                ".message-content"
            );


        if (!contentElement) {
            return element;
        }


        const role =
            options.role ||
            element.dataset.role ||
            (
                element.classList
                    .contains(
                        "user"
                    )
                    ? "user"
                    : "assistant"
            );


        renderContent(
            contentElement,
            content,
            role
        );


        scrollToBottom();


        emit(
            "neyo:message-updated",
            {
                message:
                    element,

                content
            }
        );


        return element;

    }


    /* =====================================================
       REMOVE MESSAGE
       ===================================================== */

    function removeMessage(
        target
    ) {

        let element =
            null;


        if (
            target instanceof
            HTMLElement
        ) {

            element =
                target;

        } else {

            element =
                findMessage(
                    target
                );

        }


        if (!element) {
            return false;
        }


        if (
            element ===
            thinkingElement
        ) {

            thinkingElement =
                null;

        }


        element.remove();


        updateHero();


        emit(
            "neyo:message-removed"
        );


        return true;

    }


    /* =====================================================
       THINKING
       ===================================================== */

    function showThinking() {

        removeThinking();


        const element =
            document.createElement(
                "div"
            );


        element.id =
            "neyoThinkingIndicator";


        element.className =
            "message assistant is-thinking";


        element.dataset
            .neyoMessageId =
            "neyo-thinking";


        element.dataset
            .messageId =
            "neyo-thinking";


        element.dataset.role =
            "assistant";


        element.setAttribute(
            "aria-live",
            "polite"
        );


        const content =
            document.createElement(
                "div"
            );


        content.className =
            "message-content";


        const shimmer =
            document.createElement(
                "span"
            );


        shimmer.className =
            "thinking-shimmer";


        shimmer.textContent =
            "Thinking...";


        content.appendChild(
            shimmer
        );


        element.appendChild(
            content
        );


        chatMessages.appendChild(
            element
        );


        thinkingElement =
            element;


        updateHero();


        requestAnimationFrame(
            () => {

                scrollToBottom(
                    "auto",
                    true
                );

            }
        );


        return element;

    }


    function removeThinking() {

        const element =
            thinkingElement ||
            document.getElementById(
                "neyoThinkingIndicator"
            ) ||
            findMessage(
                "neyo-thinking"
            );


        thinkingElement =
            null;


        if (!element) {
            return false;
        }


        element.remove();


        updateHero();


        return true;

    }


    /* =====================================================
       CLEAR
       ===================================================== */

    function clearMessages() {

        thinkingElement =
            null;


        chatMessages
            .replaceChildren();


        nearBottom =
            true;


        updateHero();


        emit(
            "neyo:messages-cleared"
        );


        return true;

    }


    /* =====================================================
       REPLACE
       ===================================================== */

    function replaceMessages(
        messages = []
    ) {

        clearMessages();


        if (
            !Array.isArray(
                messages
            )
        ) {
            return false;
        }


        messages.forEach(
            message => {

                createMessage(
                    message,
                    {
                        historyLoad:
                            true
                    }
                );

            }
        );


        updateHero();


        requestAnimationFrame(
            () => {

                scrollToBottom(
                    "auto",
                    true
                );

            }
        );


        return true;

    }


    /* =====================================================
       CANONICAL CHAT EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:chat-message-added",
        event => {

            const message =
                event.detail
                    ?.message;


            if (!message) {
                return;
            }


            createMessage(
                message,
                {
                    historyLoad:
                        Boolean(
                            event.detail
                                ?.historyLoad
                        )
                }
            );

        }
    );


    window.addEventListener(
        "neyo:chat-message-removed",
        event => {

            const id =
                event.detail
                    ?.id ||
                event.detail
                    ?.message
                    ?.id;


            if (id) {

                removeMessage(
                    id
                );

            }

        }
    );


    window.addEventListener(
        "neyo:chat-message-updated",
        event => {

            const message =
                event.detail
                    ?.message;


            if (
                !message?.id
            ) {
                return;
            }


            const role =
                message.role ||
                "assistant";


            const content =
                clean(
                    message.content ||
                    ""
                );


            /*
             * STREAMING:
             *
             * Keep Thinking visible until real assistant
             * content arrives. The initial placeholder "…"
             * must not remove Thinking.
             */

            if (
                role ===
                    "assistant" &&
                content.trim() &&
                content.trim() !==
                    "…"
            ) {

                removeThinking();

            }


            updateMessage(
                message.id,
                content,
                {
                    role,

                    message
                }
            );


            /*
             * While streaming, keep the response following
             * the bottom only if the user is already near it.
             */

            requestAnimationFrame(
                () => {

                    scrollToBottom(
                        "auto"
                    );

                }
            );

        }
    );


    /* =====================================================
       GENERATION EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:chat-send-start",
        () => {

            showThinking();

        }
    );


    for (
        const eventName
        of [
            "neyo:chat-response",
            "neyo:chat-send-end",
            "neyo:chat-error",
            "neyo:chat-aborted",
            "neyo:chat-limit-reached"
        ]
    ) {

        window.addEventListener(
            eventName,
            () => {

                removeThinking();

            }
        );

    }


    /* =====================================================
       CLEAR EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:messages-clear",
        () => {

            clearMessages();

        }
    );


    /* =====================================================
       LEGACY CREATE BRIDGE
       ===================================================== */

    window.addEventListener(
        "neyo:message-create",
        event => {

            createMessage(
                event.detail ||
                {}
            );

        }
    );


    /* =====================================================
       LEGACY UPDATE BRIDGE
       ===================================================== */

    window.addEventListener(
        "neyo:message-update-request",
        event => {

            const detail =
                event.detail ||
                {};


            const id =
                detail.id ||
                detail.messageId ||
                detail.message?.id;


            if (!id) {
                return;
            }


            updateMessage(
                id,
                detail.content ??
                detail.message
                    ?.content ??
                "",
                {
                    role:
                        detail.role ||
                        detail.message
                            ?.role,

                    message:
                        detail.message
                }
            );

        }
    );


    /* =====================================================
       REPLACE BRIDGE
       ===================================================== */

    window.addEventListener(
        "neyo:messages-replace",
        event => {

            replaceMessages(
                event.detail
                    ?.messages ||
                event.detail ||
                []
            );

        }
    );


    /* =====================================================
       SCROLL EVENT
       ===================================================== */

    window.addEventListener(
        "neyo:messages-scroll-bottom",
        () => {

            scrollToBottom(
                "smooth",
                true
            );

        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    const api =
        Object.freeze({

            __controller:
                true,

            version:
                VERSION,

            active:
                true,

            create:
                createMessage,

            update:
                updateMessage,

            remove:
                removeMessage,

            clear:
                clearMessages,

            replace:
                replaceMessages,

            showThinking,

            removeThinking,

            scrollToBottom,

            getElement:
                findMessage,

            getContainer:
                () =>
                    chatMessages,

            getState:
                () => ({

                    version:
                        VERSION,

                    active:
                        true,

                    messageCount:
                        chatMessages
                            .querySelectorAll(
                                '[data-neyo-message-id]:not([data-neyo-message-id="neyo-thinking"])'
                            )
                            .length,

                    thinking:
                        Boolean(
                            thinkingElement
                        )

                })

        });


    Object.defineProperty(
        window,
        "NeyoMessages",
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
       INIT
       ===================================================== */

    updateHero();


    emit(
        "neyo:messages-ready",
        {

            version:
                VERSION,

            active:
                true

        }
    );


    console.log(
        "[NEYO Messages] Canonical renderer ready.",
        VERSION
    );

})();
