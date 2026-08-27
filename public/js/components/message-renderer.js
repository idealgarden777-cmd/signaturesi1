/*
=========================================================
NEYO — MESSAGE RENDERER COMPONENT

Owns:
- Markdown rendering
- DOMPurify sanitization
- Safe links
- Code block rendering
- Inline code
- KaTeX rendering hook
- Plain-text fallback
- Public renderer API

Does NOT own:
- Message DOM shell
- Chat API
- History
- Copy buttons
- Regenerate
- Message actions
=========================================================
*/

(() => {
    "use strict";


    /* =====================================================
       CONSTANTS
       ===================================================== */

    const SAFE_PROTOCOLS =
        new Set([
            "http:",
            "https:",
            "mailto:"
        ]);


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


    const escapeHtml = value => {

        return String(
            value ?? ""
        )
            .replaceAll(
                "&",
                "&amp;"
            )
            .replaceAll(
                "<",
                "&lt;"
            )
            .replaceAll(
                ">",
                "&gt;"
            )
            .replaceAll(
                '"',
                "&quot;"
            )
            .replaceAll(
                "'",
                "&#039;"
            );

    };


    /* =====================================================
       MARKED CONFIG
       ===================================================== */

    const configureMarked = () => {

        if (!window.marked) {
            return false;
        }


        try {

            window.marked
                .setOptions({
                    gfm:
                        true,

                    breaks:
                        true
                });


            return true;

        }

        catch {

            return false;

        }

    };


    /* =====================================================
       SAFE URL
       ===================================================== */

    const isSafeUrl =
        value => {

            if (!value) {
                return false;
            }


            try {

                const url =
                    new URL(
                        value,
                        window.location.origin
                    );


                return SAFE_PROTOCOLS.has(
                    url.protocol
                );

            }

            catch {

                return false;

            }

        };


    /* =====================================================
       SANITIZE
       ===================================================== */

    const sanitizeHtml =
        html => {

            if (!window.DOMPurify) {

                /*
                Never trust raw Markdown HTML
                if DOMPurify is unavailable.
                */

                return escapeHtml(
                    html
                );

            }


            return window.DOMPurify
                .sanitize(
                    html,
                    {
                        USE_PROFILES: {
                            html:
                                true
                        },

                        FORBID_TAGS: [
                            "script",
                            "style",
                            "iframe",
                            "object",
                            "embed",
                            "form"
                        ],

                        FORBID_ATTR: [
                            "style"
                        ]
                    }
                );

        };


    /* =====================================================
       LINK HARDENING
       ===================================================== */

    const secureLinks =
        root => {

            if (
                !(root instanceof HTMLElement)
            ) {
                return;
            }


            const links =
                root.querySelectorAll(
                    "a[href]"
                );


            links.forEach(
                link => {

                    const href =
                        link.getAttribute(
                            "href"
                        );


                    if (
                        !isSafeUrl(
                            href
                        )
                    ) {

                        link.removeAttribute(
                            "href"
                        );

                        link.removeAttribute(
                            "target"
                        );

                        link.removeAttribute(
                            "rel"
                        );

                        return;

                    }


                    const url =
                        new URL(
                            href,
                            window.location.origin
                        );


                    if (
                        url.protocol ===
                            "http:" ||
                        url.protocol ===
                            "https:"
                    ) {

                        link.target =
                            "_blank";


                        link.rel =
                            "noopener noreferrer";

                    }

                }
            );

        };


    /* =====================================================
       CODE BLOCKS
       ===================================================== */

    const enhanceCodeBlocks =
        root => {

            if (
                !(root instanceof HTMLElement)
            ) {
                return;
            }


            const blocks =
                root.querySelectorAll(
                    "pre > code"
                );


            blocks.forEach(
                code => {

                    const pre =
                        code.parentElement;


                    if (!pre) {
                        return;
                    }


                    pre.classList.add(
                        "message-code-block"
                    );


                    const languageClass =
                        Array.from(
                            code.classList
                        )
                            .find(
                                item =>
                                    item.startsWith(
                                        "language-"
                                    )
                            );


                    if (
                        languageClass
                    ) {

                        pre.dataset.language =
                            languageClass
                                .replace(
                                    "language-",
                                    ""
                                );

                    }

                }
            );

        };


    /* =====================================================
       KATEX
       ===================================================== */

    const renderMath =
        root => {

            if (
                !(root instanceof HTMLElement)
            ) {
                return;
            }


            /*
            If auto-render is loaded,
            use it.

            Otherwise renderer simply
            leaves math text untouched.
            */

            const renderer =
                window.renderMathInElement;


            if (
                typeof renderer !==
                "function"
            ) {
                return;
            }


            try {

                renderer(
                    root,
                    {
                        throwOnError:
                            false,

                        delimiters: [
                            {
                                left:
                                    "$$",

                                right:
                                    "$$",

                                display:
                                    true
                            },
                            {
                                left:
                                    "\\[",

                                right:
                                    "\\]",

                                display:
                                    true
                            },
                            {
                                left:
                                    "\\(",

                                right:
                                    "\\)",

                                display:
                                    false
                            }
                        ]
                    }
                );

            }

            catch (error) {

                console.warn(
                    "KaTeX render failed:",
                    error
                );

            }

        };


    /* =====================================================
       MARKDOWN → HTML
       ===================================================== */

    const markdownToHtml =
        markdown => {

            const input =
                String(
                    markdown ?? ""
                );


            if (
                !window.marked
            ) {

                return escapeHtml(
                    input
                ).replace(
                    /\n/g,
                    "<br>"
                );

            }


            try {

                configureMarked();


                const html =
                    window.marked
                        .parse(
                            input
                        );


                return sanitizeHtml(
                    html
                );

            }

            catch (error) {

                console.warn(
                    "Markdown render failed:",
                    error
                );


                return escapeHtml(
                    input
                ).replace(
                    /\n/g,
                    "<br>"
                );

            }

        };


    /* =====================================================
       RENDER INTO ELEMENT
       ===================================================== */

    const renderInto = (
        element,
        content,
        options = {}
    ) => {

        if (
            !(element instanceof HTMLElement)
        ) {
            return false;
        }


        const role =
            options.role ||
            "assistant";


        /*
        User messages default to plain text.
        Assistant messages default to Markdown.
        */

        const useMarkdown =
            options.markdown ??
            (
                role ===
                "assistant"
            );


        if (!useMarkdown) {

            element.textContent =
                String(
                    content ?? ""
                );

        } else {

            const html =
                markdownToHtml(
                    content
                );


            element.innerHTML =
                html;


            secureLinks(
                element
            );


            enhanceCodeBlocks(
                element
            );


            renderMath(
                element
            );

        }


        emit(
            "neyo:message-rendered",
            {
                element,
                role,
                markdown:
                    useMarkdown
            }
        );


        return true;

    };


    /* =====================================================
       RENDER MESSAGE ELEMENT
       ===================================================== */

    const renderMessage =
        (
            messageElement,
            content,
            options = {}
        ) => {

            if (
                !(
                    messageElement instanceof
                    HTMLElement
                )
            ) {
                return false;
            }


            const contentElement =
                messageElement.querySelector(
                    ".message-content"
                );


            if (!contentElement) {
                return false;
            }


            return renderInto(
                contentElement,
                content,
                options
            );

        };


    /* =====================================================
       PUBLIC EVENTS
       ===================================================== */

    window.addEventListener(
        "neyo:message-render-request",
        event => {

            renderMessage(
                event.detail?.message,
                event.detail?.content,
                event.detail?.options ||
                {}
            );

        }
    );


    window.addEventListener(
        "neyo:content-render-request",
        event => {

            renderInto(
                event.detail?.element,
                event.detail?.content,
                event.detail?.options ||
                {}
            );

        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NeyoMessageRenderer =
        Object.freeze({

            render:
                renderMessage,

            renderInto,

            markdownToHtml,

            sanitize:
                sanitizeHtml,

            escape:
                escapeHtml,

            secureLinks,

            renderMath

        });

})();
