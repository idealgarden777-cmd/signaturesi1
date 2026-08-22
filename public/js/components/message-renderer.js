/*
=========================================================
NEYO — MESSAGE RENDERER
FINAL CLEAN v1

FILE:
public/js/components/message-renderer.js

OWNS
---------------------------------------------------------
- Assistant Markdown rendering
- Safe HTML sanitization
- Inline code styling hook
- Code block enhancement
- Safe links
- Tables
- Blockquotes
- Headings
- Optional syntax highlighting
- Optional KaTeX rendering
- Re-render after history load

DOES NOT OWN
---------------------------------------------------------
- Message shell creation
- Conversation state
- Chat API
- Thinking UI
- Send button
- Enter key
- Attachments
- Copy / regenerate / share actions

EVENTS LISTENED
---------------------------------------------------------
- neyo:message-created
- neyo:message-updated
- neyo:messages-replaced
- neyo:message-render-request

PUBLIC API
---------------------------------------------------------
window.NeyoMessageRenderer.render(...)
window.NeyoMessageRenderer.renderElement(...)
window.NeyoMessageRenderer.renderAll()
=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     VERSION / GUARD
     ===================================================== */

  const VERSION =
    "neyo-message-renderer-final-clean-v1";


  if (
    window.NeyoMessageRenderer?.__controller ===
    true
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

      markdown:
        true,

      syntaxHighlight:
        true,

      math:
        true,

      externalLinksNewTab:
        true
    });


  /* =====================================================
     DOM
     ===================================================== */

  const chatMessages =
    document.getElementById(
      "chatMessages"
    );


  if (
    !chatMessages
  ) {
    console.warn(
      "[NEYO Renderer] #chatMessages not found."
    );

    return;
  }


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
     ESCAPE
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
        ?.parse
    ) {
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

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Renderer] Marked config failed:",
        error
      );


      return false;
    }
  }


  /* =====================================================
     SANITIZE
     ===================================================== */

  function sanitize(
    html
  ) {
    const source =
      String(
        html ?? ""
      );


    if (
      !window.DOMPurify
        ?.sanitize
    ) {
      return escapeHtml(
        source
      );
    }


    return window.DOMPurify
      .sanitize(
        source,
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
            "textarea",
            "select",
            "button",
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
     MARKDOWN
     ===================================================== */

  function markdownToHtml(
    value
  ) {
    const text =
      String(
        value ?? ""
      );


    if (
      !CONFIG.markdown ||
      !window.marked
        ?.parse
    ) {
      return escapeHtml(
        text
      )
        .replace(
          /\n/g,
          "<br>"
        );
    }


    try {
      const html =
        window.marked
          .parse(
            text
          );


      return sanitize(
        html
      );

    } catch (
      error
    ) {
      console.warn(
        "[NEYO Renderer] Markdown failed:",
        error
      );


      return escapeHtml(
        text
      )
        .replace(
          /\n/g,
          "<br>"
        );
    }
  }


  /* =====================================================
     SAFE LINKS
     ===================================================== */

  function isSafeUrl(
    href
  ) {
    const raw =
      String(
        href ?? ""
      )
        .trim();


    if (
      !raw
    ) {
      return false;
    }


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


      return [
        "http:",
        "https:",
        "mailto:"
      ].includes(
        url.protocol
      );

    } catch {
      return false;
    }
  }


  function secureLinks(
    root
  ) {
    if (
      !(root instanceof HTMLElement)
    ) {
      return;
    }


    root
      .querySelectorAll(
        "a[href]"
      )
      .forEach(
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


          try {
            const url =
              new URL(
                href,
                window.location.origin
              );


            if (
              CONFIG.externalLinksNewTab &&
              (
                url.protocol ===
                  "http:" ||
                url.protocol ===
                  "https:"
              )
            ) {
              link.target =
                "_blank";


              link.rel =
                "noopener noreferrer";
            }

          } catch {}
        }
      );
  }


  /* =====================================================
     INLINE CODE
     ===================================================== */

  function enhanceInlineCode(
    root
  ) {
    root
      .querySelectorAll(
        "code:not(pre code)"
      )
      .forEach(
        code => {
          code.classList.add(
            "message-inline-code"
          );
        }
      );
  }


  /* =====================================================
     LANGUAGE
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

        rs:
          "rust",

        cs:
          "csharp"
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
     CODE BLOCKS
     ===================================================== */

  function enhanceCodeBlocks(
    root
  ) {
    root
      .querySelectorAll(
        "pre > code"
      )
      .forEach(
        code => {
          const pre =
            code.parentElement;


          if (
            !pre
          ) {
            return;
          }


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
                className =>
                  className.startsWith(
                    "language-"
                  )
              );


          const language =
            normalizeLanguage(
              languageClass
                ?.slice(
                  "language-".length
                )
            );


          pre.dataset.language =
            language;


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


          const label =
            document.createElement(
              "span"
            );


          label.className =
            "message-code-language";


          label.textContent =
            language;


          header.appendChild(
            label
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
  }


  /* =====================================================
     SYNTAX HIGHLIGHTING
     ===================================================== */

  function highlightCode(
    root
  ) {
    if (
      !CONFIG.syntaxHighlight ||
      !window.hljs
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
            window.hljs
              .highlightElement(
                code
              );

          } catch (
            error
          ) {
            console.warn(
              "[NEYO Renderer] Highlight failed:",
              error
            );
          }
        }
      );
  }


  /* =====================================================
     TABLES
     ===================================================== */

  function enhanceTables(
    root
  ) {
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
     BLOCKQUOTES
     ===================================================== */

  function enhanceBlockquotes(
    root
  ) {
    root
      .querySelectorAll(
        "blockquote"
      )
      .forEach(
        blockquote => {
          blockquote.classList.add(
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
      !CONFIG.math ||
      typeof window
        .renderMathInElement !==
        "function"
    ) {
      return;
    }


    try {
      window.renderMathInElement(
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
        "[NEYO Renderer] Math rendering failed:",
        error
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
      return false;
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


    return true;
  }


  /* =====================================================
     RENDER ELEMENT
     ===================================================== */

  function renderElement(
    element,
    content,
    {
      role =
        "assistant",

      markdown =
        null
    } = {}
  ) {
    if (
      !(element instanceof HTMLElement)
    ) {
      return false;
    }


    const useMarkdown =
      markdown ===
        null
        ? role ===
          "assistant"
        : Boolean(
            markdown
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


    element.innerHTML =
      markdownToHtml(
        content
      );


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
     RENDER MESSAGE
     ===================================================== */

  function render(
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


    return renderElement(
      contentElement,
      content,
      options
    );
  }


  /* =====================================================
     RENDER ALL
     ===================================================== */

  function renderAll() {
    chatMessages
      .querySelectorAll(
        '.message[data-role="assistant"]'
      )
      .forEach(
        message => {
          const content =
            message
              .querySelector(
                ".message-content"
              );


          if (
            !content
          ) {
            return;
          }


          const raw =
            message.dataset
              .rawContent ??
            content.textContent ??
            "";


          message.dataset
            .rawContent =
            raw;


          renderElement(
            content,
            raw,
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


  /* =====================================================
     MESSAGE CREATED
     ===================================================== */

  window.addEventListener(
    "neyo:message-created",
    event => {
      const element =
        event.detail
          ?.element;


      const message =
        event.detail
          ?.message;


      if (
        !(
          element instanceof
          HTMLElement
        ) ||
        !message
      ) {
        return;
      }


      if (
        message.role !==
        "assistant"
      ) {
        return;
      }


      /*
      -------------------------------------------------------
      Preserve original Markdown source.

      This prevents re-rendering already-rendered HTML.
      -------------------------------------------------------
      */

      element.dataset
        .rawContent =
        String(
          message.content ??
          ""
        );


      render(
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


  /* =====================================================
     MESSAGE UPDATED
     ===================================================== */

  window.addEventListener(
    "neyo:message-updated",
    event => {
      const element =
        event.detail
          ?.element;


      const content =
        event.detail
          ?.content;


      if (
        !(
          element instanceof
          HTMLElement
        )
      ) {
        return;
      }


      if (
        element.dataset.role !==
        "assistant"
      ) {
        return;
      }


      element.dataset
        .rawContent =
        String(
          content ??
          ""
        );


      render(
        element,
        content,
        {
          role:
            "assistant",

          markdown:
            true
        }
      );
    }
  );


  /* =====================================================
     HISTORY REPLACED
     ===================================================== */

  window.addEventListener(
    "neyo:messages-replaced",
    () => {
      renderAll();
    }
  );


  /* =====================================================
     MANUAL RENDER EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:message-render-request",
    event => {
      const element =
        event.detail
          ?.element;


      const content =
        event.detail
          ?.content;


      const options =
        event.detail
          ?.options ||
        {};


      render(
        element,
        content,
        options
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

      render,

      renderElement,

      renderAll,

      markdownToHtml,

      sanitize,

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


  emit(
    "neyo:message-renderer-ready",
    {
      version:
        VERSION
    }
  );

})();
