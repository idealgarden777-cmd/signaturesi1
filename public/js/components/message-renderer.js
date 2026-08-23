/*
=========================================================
NEYO — MESSAGE RENDERER
FINAL PRODUCTION MIXER v7

FILE:
public/js/components/message-renderer.js

OWNS
---------------------------------------------------------
- Assistant Markdown rendering
- Plain-text rendering
- DOMPurify sanitization
- Safe URL handling
- Safe link hardening
- Safe Markdown images
- Inline code
- Code blocks
- Code language labels
- Code copy
- Syntax highlighting
- Scrollable table wrappers
- KaTeX auto-render
- Rendering lifecycle events
- Safe fallbacks when libraries are unavailable

DOES NOT OWN
---------------------------------------------------------
- Message DOM shell
- Chat API
- Conversation state
- Attachments
- Sources
- Thinking state
- Message copy action
- Edit
- Regenerate
- Share
- History
- Send / Enter

IMPORTANT
---------------------------------------------------------
Code-block copy belongs here because it is intrinsic to
rendered code.

Whole-message Copy/Edit/Regenerate/Share belongs later to
message-actions.js.

MIGRATION RULE
---------------------------------------------------------
This renderer stays active regardless of neo.js presence.

After neo.js is removed this file continues unchanged.
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-message-renderer-final-v7";

  if (
    window.NeyoMessageRenderer
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      maxContentLength:
        500_000,

      copySuccessMs:
        1400,

      maxCodeLanguageLength:
        40,

      safeProtocols:
        new Set([
          "http:",
          "https:",
          "mailto:"
        ]),

      safeImageProtocols:
        new Set([
          "http:",
          "https:"
        ])
    });

  /* =====================================================
     LEGACY TELEMETRY

     Informational only.
     ===================================================== */

  const legacyScriptPresent =
    Array
      .from(
        document.scripts || []
      )
      .some(
        script =>
          /(?:^|\/)neo\.js(?:\?|$)/
            .test(
              script.src || ""
            )
      );

  /* =====================================================
     STATE
     ===================================================== */

  const state = {
    rendered:
      0,

    markdownRendered:
      0,

    plainRendered:
      0,

    sanitized:
      0,

    codeBlocks:
      0,

    tables:
      0,

    mathPasses:
      0,

    copyOperations:
      0,

    lastRenderedAt:
      null,

    lastError:
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
     TEXT
     ===================================================== */

  function normalizeText(
    value
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
        CONFIG.maxContentLength
      );
  }

  /* =====================================================
     ESCAPE HTML
     ===================================================== */

  function escapeHtml(
    value
  ) {
    return normalizeText(
      value
    )
      .replace(
        /&/g,
        "&amp;"
      )
      .replace(
        /</g,
        "&lt;"
      )
      .replace(
        />/g,
        "&gt;"
      )
      .replace(
        /"/g,
        "&quot;"
      )
      .replace(
        /'/g,
        "&#039;"
      );
  }

  /* =====================================================
     SAFE PLAIN HTML FALLBACK
     ===================================================== */

  function plainTextHtml(
    value
  ) {
    return escapeHtml(
      value
    )
      .replace(
        /\n/g,
        "<br>"
      );
  }

  /* =====================================================
     MARKED
     ===================================================== */

  function configureMarked() {
    if (
      !window.marked
    ) {
      return false;
    }

    try {
      window.marked
        .setOptions({
          gfm:
            true,

          breaks:
            true,

          pedantic:
            false,

          /*
           * Compatibility with marked versions
           * where these options still exist.
           */

          mangle:
            false,

          headerIds:
            false
        });

      return true;

    } catch {
      try {
        /*
         * Newer marked versions may reject
         * removed legacy options.
         */

        window.marked
          .setOptions({
            gfm:
              true,

            breaks:
              true,

            pedantic:
              false
          });

        return true;

      } catch {
        return false;
      }
    }
  }

  /* =====================================================
     SANITIZE
     ===================================================== */

  function sanitizeHtml(
    html
  ) {
    /*
     * SECURITY RULE:
     *
     * Never trust Markdown-generated HTML if DOMPurify
     * is unavailable.
     */

    if (
      !window.DOMPurify
    ) {
      return null;
    }

    try {
      const output =
        window.DOMPurify
          .sanitize(
            String(
              html ?? ""
            ),
            {
              USE_PROFILES: {
                html:
                  true
              },

              FORBID_TAGS: [
                "script",
                "style",
                "iframe",
                "frame",
                "frameset",
                "object",
                "embed",
                "applet",
                "form",
                "input",
                "button",
                "textarea",
                "select",
                "option",
                "meta",
                "link",
                "base"
              ],

              FORBID_ATTR: [
                "style",
                "srcdoc",
                "formaction",
                "autofocus"
              ],

              /*
               * Keep language-* classes for
               * syntax highlighting.
               */

              ALLOW_DATA_ATTR:
                false
            }
          );

      state.sanitized +=
        1;

      return output;

    } catch (
      error
    ) {
      state.lastError =
        error?.message ||
        "DOM sanitization failed.";

      return null;
    }
  }

  /* =====================================================
     MARKDOWN -> SAFE HTML
     ===================================================== */

  function markdownToHtml(
    markdown
  ) {
    const input =
      normalizeText(
        markdown
      );

    /*
     * No Markdown parser:
     * safe plain-text rendering.
     */

    if (
      !window.marked
    ) {
      return plainTextHtml(
        input
      );
    }

    /*
     * Markdown parser exists but sanitizer does not:
     * DO NOT inject parsed HTML.
     */

    if (
      !window.DOMPurify
    ) {
      return plainTextHtml(
        input
      );
    }

    try {
      configureMarked();

      const parsed =
        window.marked
          .parse(
            input
          );

      const sanitized =
        sanitizeHtml(
          parsed
        );

      if (
        sanitized ===
        null
      ) {
        return plainTextHtml(
          input
        );
      }

      return sanitized;

    } catch (
      error
    ) {
      state.lastError =
        error?.message ||
        "Markdown rendering failed.";

      console.warn(
        "[NEYO Renderer] Markdown failed:",
        error
      );

      return plainTextHtml(
        input
      );
    }
  }

  /* =====================================================
     SAFE URL
     ===================================================== */

  function parseSafeUrl(
    value
  ) {
    const raw =
      String(
        value || ""
      )
        .trim();

    if (!raw) {
      return null;
    }

    try {
      const url =
        new URL(
          raw,
          window.location.origin
        );

      if (
        !CONFIG
          .safeProtocols
          .has(
            url.protocol
          )
      ) {
        return null;
      }

      return url;

    } catch {
      return null;
    }
  }

  /* =====================================================
     LINKS
     ===================================================== */

  function secureLinks(
    root
  ) {
    if (
      !(
        root instanceof
        HTMLElement
      )
    ) {
      return 0;
    }

    let count =
      0;

    const links =
      root.querySelectorAll(
        "a"
      );

    for (
      const link
      of links
    ) {
      const href =
        link.getAttribute(
          "href"
        );

      const url =
        parseSafeUrl(
          href
        );

      if (!url) {
        link.removeAttribute(
          "href"
        );

        link.removeAttribute(
          "target"
        );

        link.removeAttribute(
          "rel"
        );

        link.removeAttribute(
          "referrerpolicy"
        );

        link.classList.add(
          "neyo-unsafe-link"
        );

        continue;
      }

      /*
       * Normalize final safe URL.
       */

      link.href =
        url.href;

      /*
       * mailto should stay normal.
       */

      if (
        url.protocol ===
        "mailto:"
      ) {
        link.removeAttribute(
          "target"
        );

        link.rel =
          "nofollow";

        count +=
          1;

        continue;
      }

      const external =
        url.origin !==
        window.location.origin;

      if (
        external
      ) {
        link.target =
          "_blank";

        link.rel =
          "noopener noreferrer nofollow";

        link.referrerPolicy =
          "no-referrer-when-downgrade";

      } else {
        /*
         * Same-origin links should not unnecessarily
         * create a new tab.
         */

        link.removeAttribute(
          "target"
        );

        link.rel =
          "noopener";
      }

      count +=
        1;
    }

    return count;
  }

  /* =====================================================
     SAFE MARKDOWN IMAGES
     ===================================================== */

  function secureImages(
    root
  ) {
    if (
      !(
        root instanceof
        HTMLElement
      )
    ) {
      return 0;
    }

    let count =
      0;

    const images =
      root.querySelectorAll(
        "img"
      );

    for (
      const image
      of images
    ) {
      const raw =
        image.getAttribute(
          "src"
        );

      if (!raw) {
        image.remove();
        continue;
      }

      let safe =
        false;

      try {
        const url =
          new URL(
            raw,
            window.location.origin
          );

        safe =
          CONFIG
            .safeImageProtocols
            .has(
              url.protocol
            );

        if (safe) {
          image.src =
            url.href;
        }

      } catch {
        safe =
          false;
      }

      if (!safe) {
        image.remove();
        continue;
      }

      image.loading =
        "lazy";

      image.decoding =
        "async";

      image.referrerPolicy =
        "no-referrer";

      if (
        !image.alt
      ) {
        image.alt =
          "";
      }

      count +=
        1;
    }

    return count;
  }

  /* =====================================================
     LANGUAGE
     ===================================================== */

  function languageOf(
    code
  ) {
    if (
      !(code instanceof Element)
    ) {
      return "plaintext";
    }

    const classes =
      Array.from(
        code.classList ||
        []
      );

    for (
      const className
      of classes
    ) {
      const match =
        String(
          className
        )
          .match(
            /^(?:language|lang)-(.+)$/i
          );

      if (
        match?.[1]
      ) {
        return String(
          match[1]
        )
          .replace(
            /[^a-z0-9_+#.-]/gi,
            ""
          )
          .slice(
            0,
            CONFIG
              .maxCodeLanguageLength
          ) ||
          "plaintext";
      }
    }

    return "plaintext";
  }

  /* =====================================================
     COPY TEXT FALLBACK
     ===================================================== */

  async function fallbackCopy(
    value
  ) {
    const textarea =
      document.createElement(
        "textarea"
      );

    textarea.value =
      value;

    textarea.setAttribute(
      "readonly",
      ""
    );

    textarea.setAttribute(
      "aria-hidden",
      "true"
    );

    Object.assign(
      textarea.style,
      {
        position:
          "fixed",

        opacity:
          "0",

        pointerEvents:
          "none",

        left:
          "-9999px",

        top:
          "0"
      }
    );

    document.body.appendChild(
      textarea
    );

    textarea.select();

    textarea.setSelectionRange(
      0,
      textarea.value.length
    );

    let success =
      false;

    try {
      success =
        document.execCommand(
          "copy"
        );

    } catch {
      success =
        false;
    }

    textarea.remove();

    return success;
  }

  /* =====================================================
     COPY TEXT
     ===================================================== */

  async function copyText(
    value,
    button = null
  ) {
    const content =
      String(
        value ?? ""
      );

    if (!content) {
      return false;
    }

    let copied =
      false;

    try {
      if (
        navigator.clipboard
          ?.writeText &&
        window.isSecureContext
      ) {
        await navigator
          .clipboard
          .writeText(
            content
          );

        copied =
          true;

      } else {
        copied =
          await fallbackCopy(
            content
          );
      }

    } catch {
      copied =
        await fallbackCopy(
          content
        );
    }

    if (
      copied
    ) {
      state.copyOperations +=
        1;
    }

    if (
      button instanceof
      HTMLElement
    ) {
      const originalText =
        button.textContent;

      const originalLabel =
        button.getAttribute(
          "aria-label"
        );

      button.textContent =
        copied
          ? "Copied"
          : "Copy failed";

      button.setAttribute(
        "aria-label",
        copied
          ? "Code copied"
          : "Copy failed"
      );

      button.classList.toggle(
        "is-copied",
        copied
      );

      button.classList.toggle(
        "is-copy-error",
        !copied
      );

      window.setTimeout(
        () => {
          if (
            !button.isConnected
          ) {
            return;
          }

          button.textContent =
            originalText ||
            "Copy";

          button.setAttribute(
            "aria-label",
            originalLabel ||
            "Copy code"
          );

          button.classList.remove(
            "is-copied",
            "is-copy-error"
          );
        },
        CONFIG.copySuccessMs
      );
    }

    emit(
      "neyo:code-copy",
      {
        success:
          copied
      }
    );

    return copied;
  }

  /* =====================================================
     SYNTAX HIGHLIGHT
     ===================================================== */

  function highlight(
    code
  ) {
    if (
      !(
        code instanceof
        HTMLElement
      )
    ) {
      return false;
    }

    /*
     * Avoid repeatedly highlighting same node.
     */

    if (
      code.dataset
        .neyoHighlighted ===
      "true"
    ) {
      return true;
    }

    try {
      if (
        window.hljs
          ?.highlightElement
      ) {
        window.hljs
          .highlightElement(
            code
          );

        code.dataset
          .neyoHighlighted =
          "true";

        return true;
      }

      if (
        window.Prism
          ?.highlightElement
      ) {
        window.Prism
          .highlightElement(
            code
          );

        code.dataset
          .neyoHighlighted =
          "true";

        return true;
      }

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Renderer] Highlight failed:",
        error
      );
    }

    return false;
  }

  /* =====================================================
     CODE BLOCK
     ===================================================== */

  function createCodeHeader(
    code
  ) {
    const header =
      document.createElement(
        "div"
      );

    header.className =
      "neyo-code-header";

    /*
     * Additional compatibility class from old UI.
     */

    header.classList.add(
      "code-header"
    );

    const label =
      document.createElement(
        "span"
      );

    label.className =
      "neyo-code-language";

    label.textContent =
      languageOf(
        code
      );

    const copy =
      document.createElement(
        "button"
      );

    copy.type =
      "button";

    copy.className =
      "neyo-code-copy";

    /*
     * Old production CSS may still target .code-copy.
     */

    copy.classList.add(
      "code-copy"
    );

    copy.setAttribute(
      "aria-label",
      "Copy code"
    );

    copy.title =
      "Copy code";

    copy.textContent =
      "Copy";

    copy.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        void copyText(
          code.textContent ||
          "",
          copy
        );
      }
    );

    header.append(
      label,
      copy
    );

    return header;
  }

  /* =====================================================
     ENHANCE CODE BLOCKS
     ===================================================== */

  function enhanceCodeBlocks(
    root
  ) {
    if (
      !(
        root instanceof
        HTMLElement
      )
    ) {
      return 0;
    }

    let count =
      0;

    const blocks =
      Array.from(
        root.querySelectorAll(
          "pre > code"
        )
      );

    for (
      const code
      of blocks
    ) {
      const pre =
        code.parentElement;

      if (!pre) {
        continue;
      }

      /*
       * Already enhanced.
       */

      const existing =
        pre.closest(
          ".neyo-code-block"
        );

      if (
        existing
      ) {
        highlight(
          code
        );

        continue;
      }

      const shell =
        document.createElement(
          "div"
        );

      shell.className =
        "neyo-code-block";

      /*
       * Preserve older production CSS.
       */

      shell.classList.add(
        "code-wrapper"
      );

      shell.setAttribute(
        "data-language",
        languageOf(
          code
        )
      );

      const header =
        createCodeHeader(
          code
        );

      pre.before(
        shell
      );

      shell.append(
        header,
        pre
      );

      highlight(
        code
      );

      count +=
        1;
    }

    state.codeBlocks +=
      count;

    return count;
  }

  /* =====================================================
     TABLES
     ===================================================== */

  function wrapTables(
    root
  ) {
    if (
      !(
        root instanceof
        HTMLElement
      )
    ) {
      return 0;
    }

    let count =
      0;

    const tables =
      Array.from(
        root.querySelectorAll(
          "table"
        )
      );

    for (
      const table
      of tables
    ) {
      if (
        table.parentElement
          ?.classList
          .contains(
            "neyo-table-wrap"
          )
      ) {
        continue;
      }

      const wrap =
        document.createElement(
          "div"
        );

      wrap.className =
        "neyo-table-wrap";

      wrap.setAttribute(
        "role",
        "region"
      );

      wrap.setAttribute(
        "aria-label",
        "Scrollable table"
      );

      wrap.tabIndex =
        0;

      table.before(
        wrap
      );

      wrap.appendChild(
        table
      );

      count +=
        1;
    }

    state.tables +=
      count;

    return count;
  }

  /* =====================================================
     MATH
     ===================================================== */

  function renderMath(
    root
  ) {
    if (
      !(
        root instanceof
        HTMLElement
      )
    ) {
      return false;
    }

    if (
      typeof window
        .renderMathInElement !==
      "function"
    ) {
      return false;
    }

    try {
      window
        .renderMathInElement(
          root,
          {
            throwOnError:
              false,

            strict:
              "ignore",

            ignoredTags: [
              "script",
              "noscript",
              "style",
              "textarea",
              "pre",
              "code"
            ],

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

      state.mathPasses +=
        1;

      return true;

    } catch (
      error
    ) {
      state.lastError =
        error?.message ||
        "Math rendering failed.";

      console.warn(
        "[NEYO Renderer] Math failed:",
        error
      );

      return false;
    }
  }

  /* =====================================================
     POST PROCESS
     ===================================================== */

  function postProcess(
    root
  ) {
    if (
      !(
        root instanceof
        HTMLElement
      )
    ) {
      return false;
    }

    secureLinks(
      root
    );

    secureImages(
      root
    );

    wrapTables(
      root
    );

    /*
     * Code before KaTeX so KaTeX ignores protected
     * pre/code nodes.
     */

    enhanceCodeBlocks(
      root
    );

    renderMath(
      root
    );

    return true;
  }

  /* =====================================================
     RENDER INTO ELEMENT
     ===================================================== */

  function renderInto(
    element,
    content,
    options = {}
  ) {
    if (
      !(
        element instanceof
        HTMLElement
      )
    ) {
      return false;
    }

    const role =
      options.role ||
      "assistant";

    /*
     * Assistant defaults Markdown.
     * User defaults plain text.
     */

    const useMarkdown =
      options.markdown ??
      (
        role ===
        "assistant"
      );

    const value =
      normalizeText(
        content
      );

    try {
      /* =================================================
         PLAIN TEXT
         ================================================= */

      if (
        !useMarkdown
      ) {
        element.textContent =
          value;

        state.plainRendered +=
          1;
      }

      /* =================================================
         MARKDOWN
         ================================================= */

      else {
        element.innerHTML =
          markdownToHtml(
            value
          );

        postProcess(
          element
        );

        state.markdownRendered +=
          1;
      }

      state.rendered +=
        1;

      state.lastRenderedAt =
        Date.now();

      state.lastError =
        null;

      emit(
        "neyo:message-rendered",
        {
          element,

          role,

          markdown:
            useMarkdown,

          content:
            value
        }
      );

      return true;

    } catch (
      error
    ) {
      /*
       * Last-resort safe rendering.
       */

      element.textContent =
        value;

      state.lastError =
        error?.message ||
        "Rendering failed.";

      emit(
        "neyo:message-render-error",
        {
          element,

          error,

          role
        }
      );

      return false;
    }
  }

  /* =====================================================
     RENDER MESSAGE SHELL
     ===================================================== */

  function renderMessage(
    messageElement,
    content,
    options = {}
  ) {
    if (
      !(
        messageElement instanceof
        HTMLElement
      )
    ) {
      return false;
    }

    const target =
      messageElement
        .querySelector(
          ".message-content"
        );

    if (!target) {
      return false;
    }

    return renderInto(
      target,
      content,
      options
    );
  }

  /* =====================================================
     REPROCESS EXISTING RENDERED HTML

     Useful after Prism/hljs/KaTeX becomes available.
     Does NOT parse Markdown again.
     ===================================================== */

  function enhance(
    root
  ) {
    if (
      !(
        root instanceof
        HTMLElement
      )
    ) {
      return false;
    }

    return postProcess(
      root
    );
  }

  /* =====================================================
     RERENDER EXISTING CONVERSATION

     Uses canonical raw content from NeyoChat.
     ===================================================== */

  function rerenderConversation() {
    const messages =
      window.NeyoChat
        ?.getConversation
        ?.();

    if (
      !Array.isArray(
        messages
      )
    ) {
      return 0;
    }

    let count =
      0;

    for (
      const message
      of messages
    ) {
      if (
        message.role !==
        "assistant"
      ) {
        continue;
      }

      const element =
        window.NeyoMessages
          ?.getElement
          ?.(message.id);

      if (
        !(
          element instanceof
          HTMLElement
        )
      ) {
        continue;
      }

      if (
        renderMessage(
          element,
          message.content,
          {
            role:
              "assistant",

            markdown:
              true
          }
        )
      ) {
        count +=
          1;
      }
    }

    return count;
  }

  /* =====================================================
     EVENT — MESSAGE RENDER
     ===================================================== */

  window.addEventListener(
    "neyo:message-render-request",
    event => {
      renderMessage(
        event.detail
          ?.message,

        event.detail
          ?.content,

        event.detail
          ?.options ||
        {}
      );
    }
  );

  /* =====================================================
     EVENT — GENERIC CONTENT RENDER
     ===================================================== */

  window.addEventListener(
    "neyo:content-render-request",
    event => {
      renderInto(
        event.detail
          ?.element,

        event.detail
          ?.content,

        event.detail
          ?.options ||
        {}
      );
    }
  );

  /* =====================================================
     EVENT — ENHANCE EXISTING ELEMENT
     ===================================================== */

  window.addEventListener(
    "neyo:content-enhance-request",
    event => {
      enhance(
        event.detail
          ?.element
      );
    }
  );

  /* =====================================================
     LIBRARY LATE-LOAD EVENTS
     Optional compatibility hooks.
     ===================================================== */

  for (
    const eventName
    of [
      "neyo:markdown-library-ready",
      "neyo:syntax-highlighter-ready",
      "neyo:katex-ready"
    ]
  ) {
    window.addEventListener(
      eventName,
      () => {
        rerenderConversation();
      }
    );
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

      active:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      /*
       * Main rendering
       */

      render:
        renderMessage,

      renderMessage,

      renderInto,

      /*
       * Markdown
       */

      markdownToHtml,

      configureMarked,

      /*
       * Security
       */

      sanitize:
        sanitizeHtml,

      sanitizeHtml,

      escape:
        escapeHtml,

      escapeHtml,

      secureLinks,

      secureImages,

      /*
       * Code
       */

      enhanceCodeBlocks,

      highlight,

      languageOf,

      copyText,

      /*
       * Tables / Math
       */

      wrapTables,

      renderMath,

      /*
       * Enhancement
       */

      enhance,

      postProcess,

      rerenderConversation,

      /*
       * State
       */

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

          legacyScriptPresent,

          legacyOwnerActive:
            false,

          libraries: {
            marked:
              Boolean(
                window.marked
              ),

            domPurify:
              Boolean(
                window.DOMPurify
              ),

            katex:
              Boolean(
                window
                  .renderMathInElement
              ),

            highlightJs:
              Boolean(
                window.hljs
              ),

            prism:
              Boolean(
                window.Prism
              )
          },

          rendered:
            state.rendered,

          markdownRendered:
            state.markdownRendered,

          plainRendered:
            state.plainRendered,

          sanitized:
            state.sanitized,

          codeBlocks:
            state.codeBlocks,

          tables:
            state.tables,

          mathPasses:
            state.mathPasses,

          copyOperations:
            state.copyOperations,

          lastRenderedAt:
            state.lastRenderedAt,

          lastError:
            state.lastError
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoMessageRenderer",
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

  configureMarked();

  emit(
    "neyo:message-renderer-ready",
    {
      version:
        VERSION,

      active:
        true,

      legacyScriptPresent,

      legacyOwnerActive:
        false,

      marked:
        Boolean(
          window.marked
        ),

      domPurify:
        Boolean(
          window.DOMPurify
        ),

      katex:
        Boolean(
          window
            .renderMathInElement
        ),

      highlighter:
        Boolean(
          window.hljs ||
          window.Prism
        )
    }
  );
})();
