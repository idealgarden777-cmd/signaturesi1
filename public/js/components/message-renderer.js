(() => {
  "use strict";

  const VERSION =
    "neyo-message-renderer-recovery-v1";

  if (
    window.NeyoMessageRenderer
      ?.__controller
  ) {
    return;
  }


  /* =====================================================
     RUNTIME OWNERSHIP
     ===================================================== */

  const legacy =
    Array.from(
      document.scripts ||
      []
    )
      .some(
        script =>
          /(?:^|\/)neo\.js(?:\?|$)/
            .test(
              script.src ||
              ""
            )
      );

  const active =
    !legacy;


  /* =====================================================
     SECURITY
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

  const emit =
    (
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


  const text =
    value =>

      String(
        value ??
        ""
      )
        .replace(
          /\u0000/g,
          ""
        )
        .replace(
          /\r\n?/g,
          "\n"
        );


  const escapeHtml =
    value =>

      text(
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


  /* =====================================================
     MARKED
     ===================================================== */

  function configureMarked() {

    if (!window.marked) {
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

          mangle:
            false,

          headerIds:
            false
        });

      return true;

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

    /*
     * Never trust Markdown-generated HTML
     * when DOMPurify is unavailable.
     */

    if (!window.DOMPurify) {
      return null;
    }

    return window
      .DOMPurify
      .sanitize(
        String(
          html ??
          ""
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
  }


  /* =====================================================
     MARKDOWN → HTML
     ===================================================== */

  function markdownToHtml(
    markdown
  ) {

    const input =
      text(
        markdown
      );


    /*
     * Safe plain-text fallback.
     */

    if (
      !window.marked ||
      !window.DOMPurify
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

      const parsed =
        window.marked
          .parse(
            input
          );


      return (
        sanitizeHtml(
          parsed
        ) ||

        escapeHtml(
          input
        )
          .replace(
            /\n/g,
            "<br>"
          )
      );

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Renderer] Markdown failed:",
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
     SAFE LINKS
     ===================================================== */

  function safeUrl(
    value
  ) {

    if (!value) {
      return null;
    }

    try {

      const url =
        new URL(
          value,
          location.origin
        );


      return SAFE_PROTOCOLS
        .has(
          url.protocol
        )
          ? url
          : null;

    } catch {

      return null;
    }
  }


  function secureLinks(
    root
  ) {

    if (
      !(
        root instanceof
        HTMLElement
      )
    ) {
      return;
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
              )
            );


          /*
           * Unsafe protocol:
           * remove navigation entirely.
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


          /*
           * External links open safely.
           */

          if (
            url.origin !==
            location.origin
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
        }
      );
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


    return (
      className
        .match(
          /(?:language|lang)-([\w#+.-]+)/i
        )
        ?.[1] ||

      "code"
    )
      .toLowerCase();
  }


  /* =====================================================
     COPY CODE
     ===================================================== */

  async function copyText(
    value,
    button
  ) {

    try {

      await navigator
        .clipboard
        .writeText(
          value
        );


      const previous =
        button
          ?.getAttribute(
            "aria-label"
          ) ||

        "Copy code";


      if (button) {

        button.setAttribute(
          "aria-label",
          "Copied"
        );

        button.dataset
          .copied =
          "true";


        window.setTimeout(
          () => {

            button.setAttribute(
              "aria-label",
              previous
            );

            delete button
              .dataset
              .copied;

          },
          1200
        );
      }

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Renderer] Copy failed:",
        error
      );
    }
  }


  /* =====================================================
     SYNTAX HIGHLIGHTING
     ===================================================== */

  function highlight(
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

        return;
      }


      if (
        window.Prism
          ?.highlightElement
      ) {

        window.Prism
          .highlightElement(
            code
          );
      }

    } catch {}
  }


  /* =====================================================
     CODE BLOCKS
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
      return;
    }


    root
      .querySelectorAll(
        "pre > code"
      )
      .forEach(
        code => {

          const pre =
            code.parentElement;


          if (
            !pre ||
            pre.closest(
              ".neyo-code-block"
            )
          ) {
            return;
          }


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
            () => {

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


          /*
           * Move existing <pre> into
           * code block shell.
           */

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
        }
      );
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
      !(
        root instanceof
        HTMLElement
      )
    ) {
      return false;
    }


    try {

      if (
        typeof window
          .renderMathInElement ===
        "function"
      ) {

        window.renderMathInElement(
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


        return true;
      }

    } catch (
      error
    ) {

      console.warn(
        "[NEYO Renderer] Math failed:",
        error
      );
    }


    return false;
  }


  /* =====================================================
     RENDER CONTENT
     ===================================================== */

  function renderInto(
    element,
    content,
    options = {}
  ) {

    if (
      !active ||
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


    /*
     * User messages remain plain text.
     */

    if (!markdown) {

      element.textContent =
        value;

    }

    /*
     * Assistant messages:
     * Markdown + sanitization.
     */

    else {

      element.innerHTML =
        markdownToHtml(
          value
        );


      secureLinks(
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
    }


    emit(
      "neyo:message-rendered",
      {
        element,
        role,
        markdown,
        content:
          value
      }
    );


    return true;
  }


  /* =====================================================
     RENDER MESSAGE
     ===================================================== */

  function renderMessage(
    messageElement,
    content,
    options = {}
  ) {

    if (
      !active ||
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

  if (active) {

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

      active,

      legacyOwnerActive:
        legacy,

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

      renderMath,

      getState:
        () => ({

          version:
            VERSION,

          active,

          legacyOwnerActive:
            legacy,

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
              window.renderMathInElement
            ),

          highlighter:
            Boolean(
              window.hljs ||
              window.Prism
            )
        })
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


  emit(
    "neyo:message-renderer-ready",
    {
      version:
        VERSION,

      active,

      legacyOwnerActive:
        legacy
    }
  );

})();
