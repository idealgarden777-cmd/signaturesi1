/*
=========================================================
NEO — MESSAGE RENDERER
Production v1

Owns:
- assistant Markdown rendering
- HTML sanitization
- safe links / images
- code block enhancement
- code copy
- syntax highlighting
- responsive tables
- KaTeX auto-render hook
- plain-text fallback

Does NOT own:
- message shells
- conversation state
- /api/chat
- copy/share message actions
- edit/regenerate
- source pills
- attachments
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-message-renderer-production-v1";

  if (
    window.NeyoMessageRenderer
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const SAFE_LINK_PROTOCOLS =
    new Set([
      "http:",
      "https:",
      "mailto:"
    ]);

  const SAFE_IMAGE_PROTOCOLS =
    new Set([
      "http:",
      "https:"
    ]);

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
        { detail }
      )
    );
  }

  /* =====================================================
     TEXT
     ===================================================== */

  function text(
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
      );
  }

  function escapeHtml(
    value
  ) {
    return text(value)
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

  function plainTextHtml(
    value
  ) {
    return escapeHtml(
      value
    ).replace(
      /\n/g,
      "<br>"
    );
  }

  /* =====================================================
     MARKED
     ===================================================== */

  let markedConfigured =
    false;

  function configureMarked() {
    if (
      markedConfigured
    ) {
      return true;
    }

    const marked =
      window.marked;

    if (!marked) {
      return false;
    }

    try {
      marked.setOptions?.({
        gfm: true,
        breaks: true
      });

      markedConfigured =
        true;

      return true;

    } catch (error) {
      console.warn(
        "[NEO Renderer] Could not configure marked:",
        error
      );

      return false;
    }
  }

  /* =====================================================
     SANITIZE

     Raw model HTML is never trusted.
     ===================================================== */

  function sanitizeHtml(
    html
  ) {
    const purifier =
      window.DOMPurify;

    /*
     * Critical fail-safe:
     * without DOMPurify we NEVER inject Markdown HTML.
     */

    if (
      !purifier ||
      typeof purifier.sanitize !==
        "function"
    ) {
      return null;
    }

    try {
      return purifier.sanitize(
        String(
          html ?? ""
        ),
        {
          USE_PROFILES: {
            html: true
          },

          FORBID_TAGS: [
            "script",
            "style",
            "iframe",
            "object",
            "embed",
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
          ]
        }
      );

    } catch (error) {
      console.warn(
        "[NEO Renderer] Sanitization failed:",
        error
      );

      return null;
    }
  }

  /* =====================================================
     MARKDOWN → SAFE HTML
     ===================================================== */

  function markdownToHtml(
    markdown
  ) {
    const input =
      text(
        markdown
      );

    const marked =
      window.marked;

    /*
     * Safe fallback when either library is unavailable.
     */

    if (
      !marked ||
      !window.DOMPurify
    ) {
      return plainTextHtml(
        input
      );
    }

    try {
      configureMarked();

      const parsed =
        marked.parse(
          input
        );

      /*
       * Renderer must stay synchronous.
       */

      if (
        typeof parsed !==
        "string"
      ) {
        return plainTextHtml(
          input
        );
      }

      return (
        sanitizeHtml(
          parsed
        ) ||
        plainTextHtml(
          input
        )
      );

    } catch (error) {
      console.warn(
        "[NEO Renderer] Markdown failed:",
        error
      );

      return plainTextHtml(
        input
      );
    }
  }

  /* =====================================================
     URL
     ===================================================== */

  function safeUrl(
    value,
    allowedProtocols
  ) {
    if (!value) {
      return null;
    }

    try {
      const url =
        new URL(
          value,
          window.location.href
        );

      return allowedProtocols
        .has(
          url.protocol
        )
          ? url
          : null;

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
      return false;
    }

    root
      .querySelectorAll(
        "a[href]"
      )
      .forEach(
        link => {
          const url =
            safeUrl(
              link.getAttribute(
                "href"
              ),
              SAFE_LINK_PROTOCOLS
            );

          /*
           * Unsafe schemes:
           * javascript:
           * data:
           * file:
           * etc.
           */

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

            return;
          }

          link.href =
            url.href;

          if (
            url.protocol ===
            "http:" ||
            url.protocol ===
            "https:"
          ) {
            /*
             * External links.
             */

            if (
              url.origin !==
              window.location.origin
            ) {
              link.target =
                "_blank";

              link.rel =
                "noopener noreferrer nofollow";

            } else {
              link.removeAttribute(
                "target"
              );

              link.rel =
                "noopener";
            }

          } else {
            /*
             * mailto:
             */

            link.removeAttribute(
              "target"
            );

            link.rel =
              "noopener";
          }
        }
      );

    return true;
  }

  /* =====================================================
     MARKDOWN IMAGES
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
      return false;
    }

    root
      .querySelectorAll(
        "img[src]"
      )
      .forEach(
        image => {
          const url =
            safeUrl(
              image.getAttribute(
                "src"
              ),
              SAFE_IMAGE_PROTOCOLS
            );

          if (!url) {
            image.remove();
            return;
          }

          image.src =
            url.href;

          image.loading =
            "lazy";

          image.decoding =
            "async";

          image.referrerPolicy =
            "no-referrer";

          image.draggable =
            false;

          /*
           * Avoid a broken-image icon dominating
           * the answer.
           */

          image.addEventListener(
            "error",
            () => {
              image.remove();
            },
            {
              once: true
            }
          );
        }
      );

    return true;
  }

  /* =====================================================
     INLINE CODE

     Marked already produces <code>.
     We add only stable CSS hooks.
     ===================================================== */

  function enhanceInlineCode(
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

    root
      .querySelectorAll(
        "code"
      )
      .forEach(
        code => {
          if (
            code.parentElement
              ?.tagName ===
            "PRE"
          ) {
            return;
          }

          code.classList.add(
            "neyo-inline-code"
          );
        }
      );

    return true;
  }

  /* =====================================================
     CODE LANGUAGE
     ===================================================== */

  function languageOf(
    code
  ) {
    const className =
      String(
        code?.className ||
        ""
      );

    const match =
      className.match(
        /(?:language|lang)-([\w#+.-]+)/i
      );

    return (
      match?.[1] ||
      "code"
    )
      .toLowerCase();
  }

  /* =====================================================
     CLIPBOARD
     ===================================================== */

  async function writeClipboard(
    value
  ) {
    const content =
      String(
        value ?? ""
      );

    /*
     * Preferred modern API.
     */

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

        return true;
      }
    } catch {}

    /*
     * Compatibility fallback.
     */

    const textarea =
      document.createElement(
        "textarea"
      );

    textarea.value =
      content;

    textarea.setAttribute(
      "readonly",
      ""
    );

    textarea.style.position =
      "fixed";

    textarea.style.opacity =
      "0";

    textarea.style.pointerEvents =
      "none";

    document.body.appendChild(
      textarea
    );

    textarea.select();

    let copied =
      false;

    try {
      copied =
        document.execCommand(
          "copy"
        );
    } catch {
      copied =
        false;
    }

    textarea.remove();

    return copied;
  }

  async function copyCode(
    code,
    button
  ) {
    const copied =
      await writeClipboard(
        code?.textContent ||
        ""
      );

    if (!copied) {
      return false;
    }

    if (!button) {
      return true;
    }

    const oldLabel =
      button.getAttribute(
        "aria-label"
      ) ||
      "Copy code";

    const oldText =
      button.textContent;

    button.setAttribute(
      "aria-label",
      "Copied"
    );

    button.dataset.copied =
      "true";

    button.textContent =
      "Copied";

    window.setTimeout(
      () => {
        if (
          !button.isConnected
        ) {
          return;
        }

        button.setAttribute(
          "aria-label",
          oldLabel
        );

        button.textContent =
          oldText ||
          "Copy";

        delete button.dataset
          .copied;
      },
      1200
    );

    return true;
  }

  /* =====================================================
     SYNTAX HIGHLIGHTING
     ===================================================== */

  function highlightCode(
    code
  ) {
    try {
      if (
        window.hljs
          ?.highlightElement
      ) {
        window.hljs
          .highlightElement(
            code
          );

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

        return true;
      }

    } catch (error) {
      console.warn(
        "[NEO Renderer] Syntax highlighting failed:",
        error
      );
    }

    return false;
  }

  /* =====================================================
     CODE BLOCKS

     Existing CSS contracts preserved:
     .neyo-code-block
     .neyo-code-header
     .neyo-code-language
     .neyo-code-copy
     .message-code-block
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
      return false;
    }

    root
      .querySelectorAll(
        "pre > code"
      )
      .forEach(
        code => {
          const pre =
            code.parentElement;

          if (!pre) {
            return;
          }

          /*
           * Prevent duplicate wrappers on updates.
           */

          if (
            pre.closest(
              ".neyo-code-block"
            )
          ) {
            return;
          }

          pre.classList.add(
            "message-code-block"
          );

          const language =
            languageOf(
              code
            );

          pre.dataset.language =
            language;

          const shell =
            document.createElement(
              "div"
            );

          shell.className =
            "neyo-code-block";

          const header =
            document.createElement(
              "div"
            );

          header.className =
            "neyo-code-header";

          const label =
            document.createElement(
              "span"
            );

          label.className =
            "neyo-code-language";

          label.textContent =
            language;

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

          copy.title =
            "Copy code";

          copy.textContent =
            "Copy";

          copy.addEventListener(
            "click",
            event => {
              event.preventDefault();
              event.stopPropagation();

              void copyCode(
                code,
                copy
              );
            }
          );

          header.append(
            label,
            copy
          );

          pre.before(
            shell
          );

          shell.append(
            header,
            pre
          );

          highlightCode(
            code
          );
        }
      );

    return true;
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
      return false;
    }

    root
      .querySelectorAll(
        "table"
      )
      .forEach(
        table => {
          if (
            table.parentElement
              ?.classList
              .contains(
                "neyo-table-wrap"
              )
          ) {
            return;
          }

          const wrapper =
            document.createElement(
              "div"
            );

          wrapper.className =
            "neyo-table-wrap";

          wrapper.setAttribute(
            "role",
            "region"
          );

          wrapper.setAttribute(
            "aria-label",
            "Scrollable table"
          );

          wrapper.tabIndex =
            0;

          table.before(
            wrapper
          );

          wrapper.appendChild(
            table
          );
        }
      );

    return true;
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

    const renderer =
      window.renderMathInElement;

    if (
      typeof renderer !==
      "function"
    ) {
      return false;
    }

    try {
      renderer(
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
              left: "$$",
              right: "$$",
              display: true
            },
            {
              left: "\\[",
              right: "\\]",
              display: true
            },
            {
              left: "\\(",
              right: "\\)",
              display: false
            }
          ]
        }
      );

      return true;

    } catch (error) {
      console.warn(
        "[NEO Renderer] Math rendering failed:",
        error
      );

      return false;
    }
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
     * User messages remain plain text by default.
     * Assistant messages use Markdown by default.
     */

    const markdown =
      options.markdown ??
      (
        role ===
        "assistant"
      );

    const value =
      text(
        content
      );

    /* -----------------------------------------------
       Plain text
       ----------------------------------------------- */

    if (!markdown) {
      element.textContent =
        value;

      emit(
        "neyo:message-rendered",
        {
          element,
          role,
          markdown: false,
          content: value
        }
      );

      return true;
    }

    /* -----------------------------------------------
       Markdown
       ----------------------------------------------- */

    const html =
      markdownToHtml(
        value
      );

    element.innerHTML =
      html;

    /*
     * Post-processing happens only on sanitized content.
     */

    secureLinks(
      element
    );

    secureImages(
      element
    );

    enhanceInlineCode(
      element
    );

    wrapTables(
      element
    );

    enhanceCodeBlocks(
      element
    );

    renderMath(
      element
    );

    emit(
      "neyo:message-rendered",
      {
        element,
        role,
        markdown: true,
        content: value
      }
    );

    return true;
  }

  /* =====================================================
     RENDER MESSAGE SHELL

     messages.js supplies:
       .message
          .message-content
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
     EVENTS
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
     PUBLIC API
     ===================================================== */

  const api =
    Object.freeze({
      __controller: true,
      version: VERSION,
      active: true,

      render:
        renderMessage,

      renderInto,

      markdownToHtml,

      sanitize:
        sanitizeHtml,

      escape:
        escapeHtml,

      secureLinks,
      secureImages,

      enhanceInlineCode,
      enhanceCodeBlocks,

      wrapTables,
      renderMath,

      getState() {
        return {
          version:
            VERSION,

          active:
            true,

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
        };
      }
    });

  Object.defineProperty(
    window,
    "NeyoMessageRenderer",
    {
      value: api,
      writable: false,
      configurable: true,
      enumerable: true
    }
  );

  /* =====================================================
     READY
     ===================================================== */

  configureMarked();

  emit(
    "neyo:message-renderer-ready",
    {
      version:
        VERSION,

      active:
        true,

      marked:
        Boolean(
          window.marked
        ),

      domPurify:
        Boolean(
          window.DOMPurify
        )
    }
  );
})();
