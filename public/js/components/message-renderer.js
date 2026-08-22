/*
=========================================================
NEYO — MESSAGE RENDERER
CHATGPT-STANDARD v8

FILE:
public/js/components/message-renderer.js

OWNS
---------------------------------------------------------
✅ Assistant Markdown rendering
✅ User plain-text rendering
✅ DOMPurify sanitization
✅ Safe links
✅ Code blocks
✅ Inline code
✅ Language labels
✅ Syntax highlighting hook
✅ KaTeX rendering
✅ Plain-text fallback
✅ Render lifecycle events
✅ Streaming-safe re-rendering

DOES NOT OWN
---------------------------------------------------------
❌ Message shell
❌ Chat API
❌ Send button
❌ History
❌ Message actions
❌ Copy button behavior
❌ Regenerate
❌ Attachment upload

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-message-renderer-v8-chatgpt-standard";


  if (
    window.NeyoMessageRenderer
      ?.__controller === true
  ) {
    console.warn(
      "[NEYO Renderer] Already initialized."
    );

    return;
  }


  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG =
    Object.freeze({
      enableMarkdown:
        true,

      enableMath:
        true,

      enableHighlight:
        true,

      openExternalLinksInNewTab:
        true,

      debug:
        false
    });


  /* =====================================================
     SAFE PROTOCOLS
     ===================================================== */

  const SAFE_PROTOCOLS =
    new Set([
      "http:",
      "https:",
      "mailto:"
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
      "[NEYO Renderer]",
      ...args
    );
  }


  /* =====================================================
     ESCAPE HTML
     ===================================================== */

  function escapeHtml(
    value
  ) {
    return String(
      value ?? ""
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
     MARKED CONFIG
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

          mangle:
            false,

          headerIds:
            false
        });


      return true;

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Renderer] marked configuration failed:",
        error
      );


      return false;
    }
  }


  /* =====================================================
     URL SAFETY
     ===================================================== */

  function isSafeUrl(
    value
  ) {
    if (
      !value
    ) {
      return false;
    }


    const raw =
      String(
        value
      ).trim();


    /*
    -------------------------------------------------------
    Block dangerous schemes immediately.
    -------------------------------------------------------
    */

    if (
      /^(javascript|data|vbscript|file):/i
        .test(
          raw
        )
    ) {
      return false;
    }


    try {
      const url =
        new URL(
          raw,
          window.location.origin
        );


      return SAFE_PROTOCOLS
        .has(
          url.protocol
        );

    } catch {
      return false;
    }
  }


  /* =====================================================
     SANITIZE
     ===================================================== */

  function sanitizeHtml(
    html
  ) {
    const input =
      String(
        html ?? ""
      );


    /*
    -------------------------------------------------------
    Critical rule:
    raw Markdown-generated HTML is NEVER trusted without
    DOMPurify.
    -------------------------------------------------------
    */

    if (
      !window.DOMPurify
        ?.sanitize
    ) {
      return escapeHtml(
        input
      );
    }


    return window.DOMPurify
      .sanitize(
        input,
        {
          USE_PROFILES: {
            html:
              true
          },

          ALLOW_DATA_ATTR:
            false,

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
            "srcset",
            "formaction"
          ]
        }
      );
  }


  /* =====================================================
     SECURE LINKS
     ===================================================== */

  function secureLinks(
    root
  ) {
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


          link.classList.add(
            "unsafe-link"
          );


          return;
        }


        let url;


        try {
          url =
            new URL(
              href,
              window.location.origin
            );

        } catch {
          return;
        }


        if (
          (
            url.protocol ===
              "http:" ||
            url.protocol ===
              "https:"
          ) &&
          CONFIG
            .openExternalLinksInNewTab
        ) {
          link.target =
            "_blank";


          link.rel =
            "noopener noreferrer";
        }
      }
    );
  }


  /* =====================================================
     INLINE CODE
     ===================================================== */

  function enhanceInlineCode(
    root
  ) {
    if (
      !(root instanceof HTMLElement)
    ) {
      return;
    }


    const inline =
      root.querySelectorAll(
        "code:not(pre code)"
      );


    inline.forEach(
      code => {
        code.classList.add(
          "message-inline-code"
        );
      }
    );
  }


  /* =====================================================
     LANGUAGE NAME
     ===================================================== */

  function normalizeLanguage(
    value
  ) {
    const raw =
      String(
        value ?? ""
      )
        .trim()
        .toLowerCase();


    const aliases =
      {
        js:
          "javascript",

        jsx:
          "javascript",

        ts:
          "typescript",

        tsx:
          "typescript",

        py:
          "python",

        sh:
          "shell",

        bash:
          "shell",

        zsh:
          "shell",

        yml:
          "yaml",

        md:
          "markdown",

        html:
          "html",

        css:
          "css",

        json:
          "json",

        sql:
          "sql",

        java:
          "java",

        c:
          "c",

        cpp:
          "cpp",

        csharp:
          "csharp",

        cs:
          "csharp",

        go:
          "go",

        rust:
          "rust",

        rs:
          "rust"
      };


    return (
      aliases[
        raw
      ] ||
      raw ||
      "text"
    );
  }


  /* =====================================================
     CODE BLOCK ENHANCEMENT
     ===================================================== */

  function enhanceCodeBlocks(
    root
  ) {
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


        if (
          !pre
        ) {
          return;
        }


        /*
        -----------------------------------------------------
        Prevent duplicate enhancement.
        -----------------------------------------------------
        */

        if (
          pre.dataset
            .neyoEnhanced ===
          "true"
        ) {
          return;
        }


        pre.dataset
          .neyoEnhanced =
          "true";


        pre.classList.add(
          "message-code-block"
        );


        code.classList.add(
          "message-code-content"
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


        const language =
          normalizeLanguage(
            languageClass
              ?.replace(
                "language-",
                ""
              )
          );


        pre.dataset.language =
          language;


        /*
        -----------------------------------------------------
        Wrapper/header.

        Copy behavior itself may remain owned by the message
        actions module; this renderer only creates structure.
        -----------------------------------------------------
        */

        const parent =
          pre.parentElement;


        if (
          parent
            ?.classList
            .contains(
              "message-code-wrapper"
            )
        ) {
          return;
        }


        const wrapper =
          document.createElement(
            "div"
          );


        wrapper.className =
          "message-code-wrapper";


        wrapper.dataset.language =
          language;


        const header =
          document.createElement(
            "div"
          );


        header.className =
          "message-code-header";


        const languageLabel =
          document.createElement(
            "span"
          );


        languageLabel.className =
          "message-code-language";


        languageLabel.textContent =
          language;


        header.appendChild(
          languageLabel
        );


        /*
        -----------------------------------------------------
        Copy button is safe to expose here because it only
        copies already rendered text and does not alter chat.
        -----------------------------------------------------
        */

        const copyButton =
          document.createElement(
            "button"
          );


        copyButton.type =
          "button";


        copyButton.className =
          "message-code-copy";


        copyButton.setAttribute(
          "aria-label",
          "Copy code"
        );


        copyButton.setAttribute(
          "title",
          "Copy code"
        );


        copyButton.innerHTML = `
          <i
            data-lucide="copy"
            size="14"
            aria-hidden="true"
          ></i>

          <span>
            Copy
          </span>
        `;


        copyButton.addEventListener(
          "click",
          async () => {
            try {
              await navigator
                .clipboard
                .writeText(
                  code.textContent ||
                  ""
                );


              copyButton
                .classList
                .add(
                  "is-copied"
                );


              const label =
                copyButton.querySelector(
                  "span"
                );


              if (
                label
              ) {
                label.textContent =
                  "Copied";
              }


              emit(
                "neyo:code-copied",
                {
                  language,

                  content:
                    code.textContent ||
                    ""
                }
              );


              window.setTimeout(
                () => {
                  copyButton
                    .classList
                    .remove(
                      "is-copied"
                    );


                  if (
                    label
                  ) {
                    label.textContent =
                      "Copy";
                  }
                },
                1200
              );

            } catch (
              error
            ) {
              console.warn(
                "[NEYO Renderer] Copy code failed:",
                error
              );
            }
          }
        );


        header.appendChild(
          copyButton
        );


        pre.replaceWith(
          wrapper
        );


        wrapper.append(
          header,
          pre
        );
      }
    );


    try {
      window.lucide
        ?.createIcons
        ?.();

    } catch {}
  }


  /* =====================================================
     SYNTAX HIGHLIGHT
     ===================================================== */

  function highlightCode(
    root
  ) {
    if (
      !CONFIG.enableHighlight ||
      !(root instanceof HTMLElement)
    ) {
      return;
    }


    /*
    -------------------------------------------------------
    highlight.js integration if loaded.
    -------------------------------------------------------
    */

    const hljs =
      window.hljs;


    if (
      !hljs
        ?.highlightElement
    ) {
      return;
    }


    root
      .querySelectorAll(
        "pre code"
      )
      .forEach(
        code => {
          if (
            code.dataset
              .highlighted ===
            "yes"
          ) {
            return;
          }


          try {
            hljs.highlightElement(
              code
            );

          } catch (
            error
          ) {
            debug(
              "Highlight failed",
              error
            );
          }
        }
      );
  }


  /* =====================================================
     TABLE ENHANCEMENT
     ===================================================== */

  function enhanceTables(
    root
  ) {
    if (
      !(root instanceof HTMLElement)
    ) {
      return;
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
                "message-table-wrapper"
              )
          ) {
            return;
          }


          const wrapper =
            document.createElement(
              "div"
            );


          wrapper.className =
            "message-table-wrapper";


          table.replaceWith(
            wrapper
          );


          wrapper.appendChild(
            table
          );
        }
      );
  }


  /* =====================================================
     BLOCKQUOTE ENHANCEMENT
     ===================================================== */

  function enhanceBlockquotes(
    root
  ) {
    if (
      !(root instanceof HTMLElement)
    ) {
      return;
    }


    root
      .querySelectorAll(
        "blockquote"
      )
      .forEach(
        quote => {
          quote.classList.add(
            "message-blockquote"
          );
        }
      );
  }


  /* =====================================================
     HEADINGS
     ===================================================== */

  function enhanceHeadings(
    root
  ) {
    if (
      !(root instanceof HTMLElement)
    ) {
      return;
    }


    root
      .querySelectorAll(
        "h1, h2, h3, h4, h5, h6"
      )
      .forEach(
        heading => {
          heading.classList.add(
            "message-heading"
          );
        }
      );
  }


  /* =====================================================
     MATH
     ===================================================== */

  function renderMath(
    root
  ) {
    if (
      !CONFIG.enableMath ||
      !(root instanceof HTMLElement)
    ) {
      return;
    }


    const renderer =
      window
        .renderMathInElement;


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

          strict:
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

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Renderer] KaTeX rendering failed:",
        error
      );
    }
  }


  /* =====================================================
     MARKDOWN → SAFE HTML
     ===================================================== */

  function markdownToHtml(
    markdown
  ) {
    const input =
      String(
        markdown ?? ""
      );


    if (
      !CONFIG.enableMarkdown ||
      !window.marked
    ) {
      return escapeHtml(
        input
      )
        .replace(
          /\n/g,
          "<br>"
        );
    }


    try {
      configureMarked();


      const rawHtml =
        window.marked
          .parse(
            input
          );


      return sanitizeHtml(
        rawHtml
      );

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Renderer] Markdown parse failed:",
        error
      );


      return escapeHtml(
        input
      )
        .replace(
          /\n/g,
          "<br>"
        );
    }
  }


  /* =====================================================
     POST PROCESS
     ===================================================== */

  function postProcess(
    root
  ) {
    if (
      !(root instanceof HTMLElement)
    ) {
      return;
    }


    secureLinks(
      root
    );


    enhanceInlineCode(
      root
    );


    enhanceCodeBlocks(
      root
    );


    highlightCode(
      root
    );


    enhanceTables(
      root
    );


    enhanceBlockquotes(
      root
    );


    enhanceHeadings(
      root
    );


    renderMath(
      root
    );
  }


  /* =====================================================
     RENDER INTO ELEMENT
     ===================================================== */

  function renderInto(
    element,
    content,
    options =
      {}
  ) {
    if (
      !(element instanceof HTMLElement)
    ) {
      return false;
    }


    const role =
      options.role ===
        "user"
        ? "user"
        : "assistant";


    /*
    -------------------------------------------------------
    User messages default plain-text.
    Assistant messages default Markdown.
    -------------------------------------------------------
    */

    const useMarkdown =
      options.markdown ??
      (
        role ===
        "assistant"
      );


    if (
      !useMarkdown
    ) {
      element.textContent =
        String(
          content ?? ""
        );


      emit(
        "neyo:message-rendered",
        {
          element,

          role,

          markdown:
            false
        }
      );


      return true;
    }


    const html =
      markdownToHtml(
        content
      );


    element.innerHTML =
      html;


    postProcess(
      element
    );


    emit(
      "neyo:message-rendered",
      {
        element,

        role,

        markdown:
          true
      }
    );


    return true;
  }


  /* =====================================================
     RENDER MESSAGE SHELL
     ===================================================== */

  function renderMessage(
    messageElement,
    content,
    options =
      {}
  ) {
    if (
      !(messageElement instanceof HTMLElement)
    ) {
      return false;
    }


    const contentElement =
      messageElement
        .querySelector(
          ".message-content"
        );


    if (
      !contentElement
    ) {
      return false;
    }


    return renderInto(
      contentElement,
      content,
      options
    );
  }


  /* =====================================================
     CHAT EVENT INTEGRATION
     ===================================================== */

  window.addEventListener(
    "neyo:chat-message-added",
    event => {
      const message =
        event.detail
          ?.message;


      if (
        !message ||
        message.role !==
          "assistant"
      ) {
        return;
      }


      const id =
        message.id;


      if (
        !id
      ) {
        return;
      }


      /*
      -----------------------------------------------------
      messages.js/chat.js already creates the shell.

      Renderer only upgrades its content.
      -----------------------------------------------------
      */

      window.requestAnimationFrame(
        () => {
          const safeId =
            globalThis.CSS
              ?.escape
              ? CSS.escape(
                  id
                )
              : String(
                  id
                );


          const element =
            document.querySelector(
              `[data-neyo-message-id="${safeId}"],` +
              `[data-message-id="${safeId}"]`
            );


          if (
            !element
          ) {
            return;
          }


          renderMessage(
            element,
            message.content,
            {
              role:
                "assistant",

              markdown:
                true
            }
          );
        }
      );
    }
  );


  /* =====================================================
     PUBLIC EVENTS
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

  const publicApi =
    Object.freeze({
      __controller:
        true,

      version:
        VERSION,

      render:
        renderMessage,

      renderInto,

      markdownToHtml,

      sanitize:
        sanitizeHtml,

      escape:
        escapeHtml,

      secureLinks,

      enhanceCodeBlocks,

      highlightCode,

      renderMath,

      postProcess
    });


  Object.defineProperty(
    window,
    "NeyoMessageRenderer",
    {
      value:
        publicApi,

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


  console.log(
    "[NEYO Renderer] ChatGPT-standard v8 ready.",
    {
      markdown:
        Boolean(
          window.marked
        ),

      domPurify:
        Boolean(
          window.DOMPurify
        ),

      katex:
        Boolean(
          window.renderMathInElement
        ),

      highlightJs:
        Boolean(
          window.hljs
        )
    }
  );


  emit(
    "neyo:message-renderer-ready",
    {
      version:
        VERSION
    }
  );

})();
