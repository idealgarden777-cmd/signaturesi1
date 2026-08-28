/*
=========================================================
NEYO — MESSAGES CORE
CANONICAL CHAT PIPELINE v4

FILE:
public/js/components/messages.js

OWNS
---------------------------------------------------------
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
- User message actions
- Assistant message actions

ACTIONS
---------------------------------------------------------
USER
- Edit
- Copy

ASSISTANT
- Copy
- Share
- Regenerate

SUPPORTS
---------------------------------------------------------
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
        "neyo-messages-canonical-v4";


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
       CLEAN TEXT
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
       ATTACHMENTS
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


        if (
            value <
            1024
        ) {
            return `${value} B`;
        }


        if (
            value <
            1024 * 1024
        ) {

            return `${(
                value /
                1024
            ).toFixed(1)} KB`;

        }


        if (
            value <
            1024 * 1024 * 1024
        ) {

            return `${(
                value /
                1024 /
                1024
            ).toFixed(1)} MB`;

        }


        return `${(
            value /
            1024 /
            1024 /
            1024
        ).toFixed(1)} GB`;

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
       RENDER CONTENT
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
       ACTION BUTTON
       ===================================================== */

    function createActionButton({
        icon,
        label,
        action
    }) {

        const button =
            document.createElement(
                "button"
            );


        button.type =
            "button";


        button.className =
            "message-action-btn";


        button.dataset.action =
            action;


        button.setAttribute(
            "aria-label",
            label
        );


        button.setAttribute(
            "title",
            label
        );


        button.setAttribute(
            "data-tooltip",
            label
        );


        button.setAttribute(
            "data-tooltip-position",
            "top"
        );


        const iconElement =
            document.createElement(
                "i"
            );


        iconElement.setAttribute(
            "data-lucide",
            icon
        );


        iconElement.setAttribute(
            "size",
            "16"
        );


        iconElement.setAttribute(
            "aria-hidden",
            "true"
        );


        button.appendChild(
            iconElement
        );


        return button;

    }


    /* =====================================================
       COPY
       ===================================================== */

    async function copyText(
        text,
        button
    ) {

        const value =
            clean(
                text
            );


        if (!value) {
            return false;
        }


        try {

            await navigator.clipboard
                .writeText(
                    value
                );


            const oldLabel =
                button?.getAttribute(
                    "aria-label"
                ) ||
                "Copy";


            if (button) {

                button.setAttribute(
                    "aria-label",
                    "Copied"
                );


                button.setAttribute(
                    "data-tooltip",
                    "Copied"
                );


                button.replaceChildren();


                const icon =
                    document.createElement(
                        "i"
                    );


                icon.setAttribute(
                    "data-lucide",
                    "check"
                );


                icon.setAttribute(
                    "size",
                    "16"
                );


                button.appendChild(
                    icon
                );


                refreshIcons();


                window.setTimeout(
                    () => {

                        button.setAttribute(
                            "aria-label",
                            oldLabel
                        );


                        button.setAttribute(
                            "data-tooltip",
                            oldLabel
                        );


                        button.replaceChildren();


                        const original =
                            document.createElement(
                                "i"
                            );


                        original.setAttribute(
                            "data-lucide",
                            "copy"
                        );


                        original.setAttribute(
                            "size",
                            "16"
                        );


                        button.appendChild(
                            original
                        );


                        refreshIcons();

                    },
                    1100
                );

            }


            return true;

        } catch (
            error
        ) {

            console.warn(
                "[NEYO Messages] Clipboard failed:",
                error
            );


            return false;

        }

    }


    /* =====================================================
       SHARE
       ===================================================== */

    async function shareText(
        text
    ) {

        const value =
            clean(
                text
            );


        if (!value) {
            return false;
        }


        if (
            typeof navigator.share ===
            "function"
        ) {

            try {

                await navigator.share({
                    text:
                        value
                });


                return true;

            } catch (
                error
            ) {

                if (
                    error?.name ===
                    "AbortError"
                ) {
                    return false;
                }

            }

        }


        try {

            await navigator.clipboard
                .writeText(
                    value
                );


            return true;

        } catch {

            return false;

        }

    }


    /* =====================================================
       MESSAGE DATA
       ===================================================== */

    function readMessageText(
        element
    ) {

        return clean(
            element
                ?.querySelector(
                    ".message-content"
                )
                ?.innerText ||
            ""
        );

    }


    function getMessageIndex(
        element
    ) {

        const value =
            Number(
                element?.dataset
                    ?.msgIndex
            );


        return Number.isFinite(
            value
        )
            ? value
            : null;

    }


    /* =====================================================
       USER ACTIONS
       ===================================================== */

    function createUserActions(
        element,
        message
    ) {

        const actions =
            document.createElement(
                "div"
            );


        actions.className =
            "user-msg-actions message-actions";


        const editButton =
            createActionButton({
                icon:
                    "pencil",

                label:
                    "Edit",

                action:
                    "edit"
            });


        const copyButton =
            createActionButton({
                icon:
                    "copy",

                label:
                    "Copy",

                action:
                    "copy"
            });


        editButton.addEventListener(
            "click",
            event => {

                event.preventDefault();
                event.stopPropagation();


                beginEdit(
                    element,
                    message
                );

            }
        );


        copyButton.addEventListener(
            "click",
            event => {

                event.preventDefault();
                event.stopPropagation();


                void copyText(
                    readMessageText(
                        element
                    ),
                    copyButton
                );

            }
        );


        actions.append(
            editButton,
            copyButton
        );


        return actions;

    }


    /* =====================================================
       ASSISTANT ACTIONS
       ===================================================== */

    function createAssistantActions(
        element,
        message
    ) {

        const actions =
            document.createElement(
                "div"
            );


        actions.className =
            "assistant-msg-actions message-actions";


        const copyButton =
            createActionButton({
                icon:
                    "copy",

                label:
                    "Copy",

                action:
                    "copy"
            });


        const shareButton =
            createActionButton({
                icon:
                    "share-2",

                label:
                    "Share",

                action:
                    "share"
            });


        const regenerateButton =
            createActionButton({
                icon:
                    "rotate-cw",

                label:
                    "Regenerate",

                action:
                    "regenerate"
            });


        copyButton.addEventListener(
            "click",
            event => {

                event.preventDefault();
                event.stopPropagation();


                void copyText(
                    readMessageText(
                        element
                    ),
                    copyButton
                );

            }
        );


        shareButton.addEventListener(
            "click",
            event => {

                event.preventDefault();
                event.stopPropagation();


                void shareText(
                    readMessageText(
                        element
                    )
                );

            }
        );


        regenerateButton
            .addEventListener(
                "click",
                event => {

                    event.preventDefault();
                    event.stopPropagation();


                    const messageId =
                        element.dataset
                            .neyoMessageId ||
                        null;


                    const index =
                        getMessageIndex(
                            element
                        );


                    /*
                     * Use events so chat.js / legacy neo.js
                     * can handle regeneration without this
                     * module owning the API.
                     */

                    emit(
                        "neyo:chat-regenerate-request",
                        {
                            messageId,
                            index,
                            message
                        }
                    );


                    emit(
                        "neyo:message-regenerate-request",
                        {
                            messageId,
                            index,
                            message
                        }
                    );

                }
            );


        actions.append(
            copyButton,
            shareButton,
            regenerateButton
        );


        return actions;

    }


    /* =====================================================
       EDIT MODE
       ===================================================== */

    function beginEdit(
        element,
        message
    ) {

        if (
            !element ||
            !element.classList
                .contains(
                    "user"
                )
        ) {
            return false;
        }


        if (
            element.querySelector(
                ".edit-message-box"
            )
        ) {
            return false;
        }


        const wrapper =
            element.querySelector(
                ".message-wrapper"
            );


        const content =
            element.querySelector(
                ".message-content"
            );


        if (
            !wrapper ||
            !content
        ) {
            return false;
        }


        const originalText =
            clean(
                content.innerText
            );


        const oldActions =
            element.querySelector(
                ".user-msg-actions"
            );


        wrapper.style.display =
            "none";


        if (oldActions) {
            oldActions.style.display =
                "none";
        }


        const box =
            document.createElement(
                "div"
            );


        box.className =
            "edit-message-box";


        const textarea =
            document.createElement(
                "textarea"
            );


        textarea.className =
            "edit-textarea";


        textarea.value =
            originalText;


        textarea.rows =
            1;


        const actions =
            document.createElement(
                "div"
            );


        actions.className =
            "edit-actions";


        const cancel =
            document.createElement(
                "button"
            );


        cancel.type =
            "button";


        cancel.className =
            "edit-btn-cancel";


        cancel.textContent =
            "Cancel";


        const save =
            document.createElement(
                "button"
            );


        save.type =
            "button";


        save.className =
            "edit-btn-save";


        save.textContent =
            "Send";


        actions.append(
            cancel,
            save
        );


        box.append(
            textarea,
            actions
        );


        element.appendChild(
            box
        );


        function closeEdit() {

            box.remove();


            wrapper.style.display =
                "";


            if (oldActions) {
                oldActions.style.display =
                    "";
            }

        }


        cancel.addEventListener(
            "click",
            event => {

                event.preventDefault();
                event.stopPropagation();


                closeEdit();

            }
        );


        save.addEventListener(
            "click",
            event => {

                event.preventDefault();
                event.stopPropagation();


                const text =
                    clean(
                        textarea.value
                    ).trim();


                if (!text) {
                    return;
                }


                const id =
                    element.dataset
                        .neyoMessageId ||
                    messageId(
                        message
                    );


                const index =
                    getMessageIndex(
                        element
                    );


                /*
                 * UI updates immediately.
                 */

                renderContent(
                    content,
                    text,
                    "user"
                );


                closeEdit();


                /*
                 * Let chat.js / legacy layer perform
                 * canonical edit + resend logic.
                 */

                emit(
                    "neyo:chat-edit-request",
                    {
                        id,
                        messageId:
                            id,

                        index,

                        content:
                            text,

                        text,

                        message: {
                            ...message,
                            id,
                            role:
                                "user",
                            content:
                                text
                        }
                    }
                );


                emit(
                    "neyo:message-edit-request",
                    {
                        id,
                        messageId:
                            id,

                        index,

                        content:
                            text,

                        text
                    }
                );

            }
        );


        textarea
            .addEventListener(
                "keydown",
                event => {

                    if (
                        event.key ===
                        "Escape"
                    ) {

                        event.preventDefault();


                        closeEdit();


                        return;

                    }


                    if (
                        event.key ===
                        "Enter" &&
                        !event.shiftKey
                    ) {

                        event.preventDefault();


                        save.click();

                    }

                }
            );


        requestAnimationFrame(
            () => {

                textarea.focus();


                textarea.setSelectionRange(
                    textarea.value.length,
                    textarea.value.length
                );

            }
        );


        return true;

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
            role ===
            "user"
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


            element.appendChild(
                createUserActions(
                    element,
                    message
                )
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


            element.appendChild(
                createAssistantActions(
                    element,
                    message
                )
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
       REPLACE HISTORY
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


            if (!message?.id) {
                return;
            }


            updateMessage(
                message.id,
                message.content ||
                "",
                {
                    role:
                        message.role,

                    message
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
       HISTORY LOAD BRIDGE
       ===================================================== */

    window.addEventListener(
        "neyo:conversation-loaded",
        event => {

            const messages =
                event.detail
                    ?.messages;


            if (
                Array.isArray(
                    messages
                )
            ) {

                replaceMessages(
                    messages
                );

            }

        }
    );


    window.addEventListener(
        "neyo:history-conversation-loaded",
        event => {

            const messages =
                event.detail
                    ?.messages;


            if (
                Array.isArray(
                    messages
                )
            ) {

                replaceMessages(
                    messages
                );

            }

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

            find:
                findMessage,

            refreshIcons,

            getRoot() {

                return chatMessages;

            }

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


    updateHero();


    refreshIcons();


    emit(
        "neyo:messages-ready",
        {

            version:
                VERSION

        }
    );


    console.log(
        "[NEYO Messages] Ready.",
        VERSION
    );

})();
