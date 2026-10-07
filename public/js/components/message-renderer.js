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


                    // Premium frame: header with language + copy button.
                    // Labels come from CSS so "Copy message" stays clean.
                    if (
                        !pre.parentElement?.classList.contains(
                            "neyo-code"
                        )
                    ) {

                        const frame =
                            document.createElement(
                                "div"
                            );

                        frame.className =
                            "neyo-code";

                        const head =
                            document.createElement(
                                "div"
                            );

                        head.className =
                            "neyo-code-head";

                        head.dataset.lang =
                            pre.dataset.language ||
                            "code";

                        const copy =
                            document.createElement(
                                "button"
                            );

                        copy.type =
                            "button";

                        copy.className =
                            "neyo-code-copy";

                        copy.setAttribute(
                            "aria-label",
                            "Copy code"
                        );

                        copy.innerHTML =
                            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

                        head.appendChild(
                            copy
                        );

                        pre.replaceWith(
                            frame
                        );

                        frame.append(
                            head,
                            pre
                        );

                    }

                }
            );


            // Tables scroll sideways on small screens.
            root.querySelectorAll(
                "table"
            ).forEach(
                table => {

                    if (
                        table.parentElement?.classList.contains(
                            "neyo-table-wrap"
                        )
                    ) {
                        return;
                    }

                    const wrap =
                        document.createElement(
                            "div"
                        );

                    wrap.className =
                        "neyo-table-wrap";

                    table.replaceWith(
                        wrap
                    );

                    wrap.appendChild(
                        table
                    );

                }
            );

        };


    // One click handler for every code "Copy" button.
    document.addEventListener(
        "click",
        event => {

            const button =
                event.target.closest?.(
                    ".neyo-code-copy"
                );

            if (!button) {
                return;
            }

            const code =
                button
                    .closest(".neyo-code")
                    ?.querySelector("pre code, pre");

            const text =
                code?.innerText || "";

            const done =
                () => {

                    button.classList.add(
                        "is-copied"
                    );

                    setTimeout(
                        () =>
                            button.classList.remove(
                                "is-copied"
                            ),
                        1600
                    );

                };

            try {

                navigator.clipboard
                    .writeText(text)
                    .then(done)
                    .catch(() => {});

            } catch {}

        }
    );


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

            renderPendingMath(
                root
            );


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

    /* =====================================================
       MATH PROTECTION
       Maths is pulled out BEFORE Markdown so marked can't break
       it (\frac, _, *, and | inside tables), then rendered with
       KaTeX and put back.
       ===================================================== */

    const MATH_TOKEN =
        index =>
            `NEYOMATHTOKEN${index}END`;

    const protectMath =
        input => {

            const store = [];

            const keep =
                (tex, display) => {
                    store.push({
                        tex: String(tex || "").trim(),
                        display
                    });
                    return MATH_TOKEN(store.length - 1);
                };

            // Leave code blocks and inline code untouched.
            const parts =
                input.split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/g);

            const out =
                parts.map(
                    (part, index) => {

                        if (index % 2 === 1) {
                            return part;
                        }

                        return part
                            .replace(
                                /\$\$([\s\S]+?)\$\$/g,
                                (m, tex) => keep(tex, true)
                            )
                            .replace(
                                /\\\[([\s\S]+?)\\\]/g,
                                (m, tex) => keep(tex, true)
                            )
                            .replace(
                                /\\\(([\s\S]+?)\\\)/g,
                                (m, tex) => keep(tex, false)
                            )
                            .replace(
                                // $x$ inline: no space just inside the
                                // dollars, no digit right after the
                                // closing one (so "$5 and $10" stays text).
                                /(^|[^\\$])\$(?!\s)([^$\n]*?[^\s\\$])\$(?!\d)/g,
                                (m, before, tex) =>
                                    before + keep(tex, false)
                            );

                    }
                );

            return {
                text: out.join(""),
                store
            };

        };


    const mathHtml =
        ({ tex, display }) => {

            if (
                window.katex &&
                typeof window.katex.renderToString === "function"
            ) {

                try {

                    return window.katex.renderToString(
                        tex,
                        {
                            displayMode: display,
                            throwOnError: false,
                            strict: "ignore"
                        }
                    );

                } catch {}

            }

            // KaTeX not loaded yet: keep the TeX and render later.
            return `<span class="neyo-math" data-display="${display ? "1" : "0"}">${escapeHtml(tex)}</span>`;

        };


    const restoreMath =
        (html, store) => {

            if (!store.length) {
                return html;
            }

            return html.replace(
                /NEYOMATHTOKEN(\d+)END/g,
                (m, index) => {

                    const item =
                        store[Number(index)];

                    if (!item) {
                        return m;
                    }

                    const rendered =
                        mathHtml(item);

                    return item.display
                        ? `<span class="neyo-math-block">${rendered}</span>`
                        : rendered;

                }
            );

        };


    const renderPendingMath =
        (root = document) => {

            if (!window.katex) {
                return;
            }

            root
                .querySelectorAll?.(".neyo-math")
                .forEach(
                    span => {

                        try {

                            window.katex.render(
                                span.textContent || "",
                                span,
                                {
                                    displayMode:
                                        span.dataset.display === "1",
                                    throwOnError: false,
                                    strict: "ignore"
                                }
                            );

                            span.classList.remove("neyo-math");

                        } catch {}

                    }
                );

        };


    window.addEventListener(
        "load",
        () => renderPendingMath(document)
    );


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


                const math =
                    protectMath(
                        input
                    );


                const html =
                    window.marked
                        .parse(
                            math.text
                        );


                return restoreMath(
                    sanitizeHtml(
                        html
                    ),
                    math.store
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
