/*
=========================================================
NEO — MESSAGE RENDERER
Production v2 — Baseline Safe

Baseline:
- Old neo.js safeParseMarkdown()
- Old neo.js renderNeoMath()
- Old modular message-renderer.js
- Current NeyoMessages streaming contract

Owns:
- Assistant Markdown rendering
- User plain-text rendering
- DOMPurify sanitization
- Safe links
- Safe images
- Code-block enhancement
- Code-block copy action
- Responsive table wrappers
- KaTeX rendering
- Streaming-safe progressive rendering
- Plain-text fallback

Does NOT own:
- Message shell DOM
- Chat API
- Conversation state
- Message-level Copy / Share / Regenerate
- History
- Sources UI
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neo-message-renderer-production-v2";

  if (
    window.NeyoMessageRenderer
      ?.__controller === true
  ) {
    return;
  }

  /* =====================================================
     CONFIG
     ===================================================== */

  const CONFIG = Object.freeze({
    codeCopyResetMs: 1800,

    safeProtocols: new Set([
      "http:",
      "https:",
      "mailto:"
    ]),

    blockedTags: [
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
      "option"
    ],

    blockedAttributes: [
      "style",
      "srcdoc",
      "formaction",
      "onerror",
      "onload",
      "onclick",
      "onmouseover",
      "onfocus"
    ]
  });

  /* =====================================================
     EVENTS
     ===================================================== */

  function emit(
    name,
    detail = {}
  ) {
    window.dispatchEvent(
      new CustomEvent(name, {
        detail
      })
    );
  }

  /* =====================================================
     ESCAPE
     ===================================================== */

  function escapeHtml(value) {
    return String(value ?? "")
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
  }

  /* =====================================================
     MATH NORMALIZATION

     Preserve old NEO behavior while avoiding modification
     inside fenced code blocks.
     ===================================================== */

  function normalizeMathDelimiters(
    value
  ) {
    const source =
      String(value ?? "");

    if (!source) {
      return "";
    }

    const parts =
      source.split(
        /(```[\s\S]*?```|`[^`\n]*`)/g
      );

    return parts
      .map((part, index) => {
        /*
         * Regex captures code pieces into odd positions.
         */

        if (index % 2 === 1) {
          return part;
        }

        return part
          /*
           * \[...\] and \(...\) are already supported by
           * KaTeX auto-render. Preserve them.
           */

          /*
           * Common model output:
           * escaped dollar delimiters.
           */

          .replace(
            /\\\$\$([\s\S]*?)\\\$\$/g,
            "$$$$1$$"
          )

          .replace(
            /\\\$([^$\n]+?)\\\$/g,
            "$$$1$"
          );
      })
      .join("");
  }

  /* =====================================================
     MARKED CONFIG
     ===================================================== */

  function configureMarked() {
    if (!window.marked) {
      return false;
    }

    try {
      window.marked.setOptions({
        gfm: true,

        /*
         * Old working neo.js used breaks:false.
         * Keep that behavior.
         */

        breaks: false
      });

      return true;
    } catch {
      return false;
    }
  }

  /* =====================================================
     SAFE URL
     ===================================================== */

  function parseSafeUrl(value) {
    if (
      typeof value !== "string" ||
      !value.trim()
    ) {
      return null;
    }

    try {
      const url =
        new URL(
          value,
          window.location.href
        );

      if (
        !CONFIG.safeProtocols.has(
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

  function isSafeUrl(value) {
    return Boolean(
      parseSafeUrl(value)
    );
  }

  /* =====================================================
     SANITIZATION
     ===================================================== */

  function sanitizeHtml(html) {
    const source =
      String(html ?? "");

    /*
     * Critical:
     * if DOMPurify is unavailable, never trust parsed HTML.
     */

    if (!window.DOMPurify) {
      return escapeHtml(source);
    }

    try {
      return window.DOMPurify.sanitize(
        source,
        {
          USE_PROFILES: {
            html: true
          },

          FORBID_TAGS:
            CONFIG.blockedTags,

          FORBID_ATTR:
            CONFIG.blockedAttributes
        }
      );
    } catch (error) {
      console.warn(
        "[NEO Renderer] Sanitization failed:",
        error
      );

      return escapeHtml(source);
    }
  }

  /* =====================================================
     PLAIN-TEXT HTML FALLBACK
     ===================================================== */

  function plainTextHtml(value) {
    return escapeHtml(
      String(value ?? "")
    ).replace(
      /\n/g,
      "<br>"
    );
  }

  /* =====================================================
     MARKDOWN → HTML
     ===================================================== */

  function markdownToHtml(markdown) {
    const source =
      normalizeMathDelimiters(
        String(markdown ?? "")
      )
        .replace(
          /\r\n?/g,
          "\n"
        )
        .trim();

    /*
     * Match old neo.js safety rule:
     * Marked without DOMPurify is NOT enough.
     */

    if (
      !window.marked ||
      !window.DOMPurify
    ) {
      return plainTextHtml(
        source
      );
    }

    try {
      configureMarked();

      const parsed =
        window.marked.parse(
          source,
          {
            gfm: true,
            breaks: false
          }
        );

      return sanitizeHtml(
        parsed
      );
    } catch (error) {
      console.warn(
        "[NEO Renderer] Markdown parsing failed:",
        error
      );

      return plainTextHtml(
        source
      );
    }
  }

  /* =====================================================
     LINK HARDENING
     ===================================================== */

  function secureLinks(root) {
    if (
      !(root instanceof HTMLElement)
    ) {
      return false;
    }

    const links =
      root.querySelectorAll(
        "a[href]"
      );

    for (const link of links) {
      const raw =
        link.getAttribute(
          "href"
        );

      const url =
        parseSafeUrl(raw);

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

        continue;
      }

      link.setAttribute(
        "href",
        url.href
      );

      if (
        url.protocol === "http:" ||
        url.protocol === "https:"
      ) {
        link.setAttribute(
          "target",
          "_blank"
        );

        link.setAttribute(
          "rel",
          "noopener noreferrer"
        );
      } else {
        link.removeAttribute(
          "target"
        );

        link.removeAttribute(
          "rel"
        );
      }
    }

    return true;
  }

  /* =====================================================
     IMAGE HARDENING
     ===================================================== */

  function secureImages(root) {
    if (
      !(root instanceof HTMLElement)
    ) {
      return false;
    }

    const images =
      root.querySelectorAll(
        "img[src]"
      );

    for (const image of images) {
      const raw =
        image.getAttribute(
          "src"
        );

      const url =
        parseSafeUrl(raw);

      /*
       * Markdown-generated images only allow HTTP(S).
       * Message attachment previews are rendered elsewhere.
       */

      if (
        !url ||
        (
          url.protocol !== "http:" &&
          url.protocol !== "https:"
        )
      ) {
        image.remove();
        continue;
      }

      image.src =
        url.href;

      image.loading =
        "lazy";

      image.decoding =
        "async";

      image.referrerPolicy =
        "no-referrer";

      if (!image.alt) {
        image.alt =
          "Image";
      }
    }

    return true;
  }

  /* =====================================================
     LANGUAGE
     ===================================================== */

  function getCodeLanguage(code) {
    if (
      !(code instanceof HTMLElement)
    ) {
      return "";
    }

    const languageClass =
      Array.from(
        code.classList
      ).find(item =>
        item.startsWith(
          "language-"
        )
      );

    if (!languageClass) {
      return "";
    }

    return languageClass
      .slice(
        "language-".length
      )
      .trim()
      .toLowerCase();
  }

  function displayLanguage(value) {
    const language =
      String(value || "")
        .trim()
        .toLowerCase();

    if (!language) {
      return "Code";
    }

    const names = {
      js: "JavaScript",
      javascript:
        "JavaScript",

      ts: "TypeScript",
      typescript:
        "TypeScript",

      jsx: "JSX",
      tsx: "TSX",

      html: "HTML",
      css: "CSS",

      json: "JSON",

      py: "Python",
      python: "Python",

      sh: "Shell",
      bash: "Bash",
      shell: "Shell",

      sql: "SQL",

      java: "Java",

      c: "C",
      cpp: "C++",
      "c++": "C++",

      cs: "C#",
      csharp: "C#",

      php: "PHP",

      ruby: "Ruby",
      rb: "Ruby",

      go: "Go",

      rust: "Rust",

      rs: "Rust",

      swift: "Swift",

      kotlin: "Kotlin",

      xml: "XML",

      yaml: "YAML",
      yml: "YAML",

      md: "Markdown",
      markdown: "Markdown",

      text: "Text",
      plaintext: "Text"
    };

    return (
      names[language] ||
      language
        .replace(
          /[-_]+/g,
          " "
        )
        .replace(
          /\b\w/g,
          char =>
            char.toUpperCase()
        )
    );
  }

  /* =====================================================
     CLIPBOARD
     ===================================================== */

  async function copyText(value) {
    const text =
      String(value ?? "");

    if (!text) {
      return false;
    }

    try {
      if (
        navigator.clipboard &&
        window.isSecureContext
      ) {
        await navigator.clipboard
          .writeText(text);

        return true;
      }
    } catch {}

    const textarea =
      document.createElement(
        "textarea"
      );

    textarea.value =
      text;

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

    textarea.style.left =
      "-9999px";

    document.body.appendChild(
      textarea
    );

    textarea.select();

    let copied = false;

    try {
      copied =
        document.execCommand(
          "copy"
        );
    } catch {
      copied = false;
    }

    textarea.remove();

    return copied;
  }

  /* =====================================================
     CODE COPY BUTTON
     ===================================================== */

  function createCodeCopyButton(
    code
  ) {
    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      "message-code-copy";

    button.setAttribute(
      "aria-label",
      "Copy code"
    );

    button.setAttribute(
      "data-tooltip",
      "Copy code"
    );

    const icon =
      document.createElement(
        "i"
      );

    icon.setAttribute(
      "data-lucide",
      "copy"
    );

    icon.setAttribute(
      "aria-hidden",
      "true"
    );

    icon.setAttribute(
      "size",
      "14"
    );

    const text =
      document.createElement(
        "span"
      );

    text.textContent =
      "Copy";

    button.append(
      icon,
      text
    );

    button.addEventListener(
      "click",
      async event => {
        event.preventDefault();
        event.stopPropagation();

        if (
          button.dataset.busy ===
          "true"
        ) {
          return;
        }

        button.dataset.busy =
          "true";

        const copied =
          await copyText(
            code.textContent || ""
          );

        button.dataset.busy =
          "false";

        if (!copied) {
          emit(
            "neyo:code-copy-error",
            {
              code:
                code.textContent ||
                ""
            }
          );

          return;
        }

        icon.setAttribute(
          "data-lucide",
          "check"
        );

        text.textContent =
          "Copied";

        button.classList.add(
          "is-copied"
        );

        try {
          window.lucide
            ?.createIcons?.();
        } catch {}

        emit(
          "neyo:code-copied",
          {
            code:
              code.textContent ||
              ""
          }
        );

        window.setTimeout(
          () => {
            if (
              !button.isConnected
            ) {
              return;
            }

            icon.setAttribute(
              "data-lucide",
              "copy"
            );

            text.textContent =
              "Copy";

            button.classList.remove(
              "is-copied"
            );

            try {
              window.lucide
                ?.createIcons?.();
            } catch {}
          },
          CONFIG.codeCopyResetMs
        );
      }
    );

    return button;
  }

  /* =====================================================
     SYNTAX HIGHLIGHTING
     ===================================================== */

  function highlightCode(code) {
    if (
      !(code instanceof HTMLElement)
    ) {
      return false;
    }

    /*
     * Highlight.js
     */

    if (
      window.hljs &&
      typeof window.hljs
        .highlightElement ===
        "function"
    ) {
      try {
        window.hljs.highlightElement(
          code
        );

        return true;
      } catch {}
    }

    /*
     * Prism fallback
     */

    if (
      window.Prism &&
      typeof window.Prism
        .highlightElement ===
        "function"
    ) {
      try {
        window.Prism.highlightElement(
          code
        );

        return true;
      } catch {}
    }

    return false;
  }

  /* =====================================================
     CODE BLOCKS

     Preserve old .message-code-block class and also add
     modern .neo-code-block class for future CSS.
     ===================================================== */

  function enhanceCodeBlocks(
    root,
    {
      streaming = false
    } = {}
  ) {
    if (
      !(root instanceof HTMLElement)
    ) {
      return false;
    }

    const blocks =
      root.querySelectorAll(
        "pre > code"
      );

    for (const code of blocks) {
      const pre =
        code.parentElement;

      if (!pre) {
        continue;
      }

      pre.classList.add(
        "message-code-block",
        "neo-code-block"
      );

      const language =
        getCodeLanguage(code);

      if (language) {
        pre.dataset.language =
          language;
      } else {
        delete pre.dataset.language;
      }

      /*
       * Streaming:
       * avoid repeatedly running syntax highlighter against
       * incomplete code. It renders once stream finishes.
       */

      if (!streaming) {
        highlightCode(code);
      }

      /*
       * Do not duplicate header if renderer is called again.
       */

      let header =
        pre.querySelector(
          ":scope > .message-code-header"
        );

      if (!header) {
        header =
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

        const copyButton =
          createCodeCopyButton(
            code
          );

        header.append(
          languageLabel,
          copyButton
        );

        pre.prepend(header);
      }

      const languageLabel =
        header.querySelector(
          ".message-code-language"
        );

      if (languageLabel) {
        languageLabel.textContent =
          displayLanguage(
            language
          );
      }
    }

    try {
      window.lucide
        ?.createIcons?.();
    } catch {}

    return true;
  }

  /* =====================================================
     TABLE WRAPPERS
     ===================================================== */

  function enhanceTables(root) {
    if (
      !(root instanceof HTMLElement)
    ) {
      return false;
    }

    const tables =
      root.querySelectorAll(
        "table"
      );

    for (const table of tables) {
      const parent =
        table.parentElement;

      if (
        parent?.classList.contains(
          "message-table-wrap"
        )
      ) {
        continue;
      }

      const wrapper =
        document.createElement(
          "div"
        );

      wrapper.className =
        "message-table-wrap";

      table.parentNode?.insertBefore(
        wrapper,
        table
      );

      wrapper.appendChild(
        table
      );
    }

    return true;
  }

  /* =====================================================
     HEADING IDS

     Local IDs only. No anchor links are inserted, avoiding
     duplicate global navigation ownership.
     ===================================================== */

  function enhanceHeadings(root) {
    if (
      !(root instanceof HTMLElement)
    ) {
      return false;
    }

    const headings =
      root.querySelectorAll(
        "h1, h2, h3, h4, h5, h6"
      );

    const used =
      new Set();

    for (const heading of headings) {
      if (heading.id) {
        used.add(
          heading.id
        );

        continue;
      }

      const base =
        String(
          heading.textContent ||
          "section"
        )
          .toLowerCase()
          .trim()
          .replace(
            /[^\p{L}\p{N}\s-]/gu,
            ""
          )
          .replace(
            /\s+/g,
            "-"
          )
          .replace(
            /-+/g,
            "-"
          )
          .slice(
            0,
            80
          ) ||
        "section";

      let id =
        base;

      let index = 2;

      while (
        used.has(id)
      ) {
        id =
          `${base}-${index}`;

        index += 1;
      }

      heading.id =
        id;

      used.add(id);
    }

    return true;
  }

  /* =====================================================
     KATEX

     Matches old neo.js delimiters, including single $...$.
     ===================================================== */

  function renderMath(root) {
    if (
      !(root instanceof HTMLElement)
    ) {
      return false;
    }

    const renderer =
      window.renderMathInElement;

    if (
      typeof renderer !== "function"
    ) {
      return false;
    }

    try {
      renderer(
        root,
        {
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
            },
            {
              left: "$",
              right: "$",
              display: false
            }
          ],

          throwOnError: false,

          ignoredTags: [
            "script",
            "noscript",
            "style",
            "textarea",
            "pre",
            "code"
          ]
        }
      );

      return true;
    } catch (error) {
      console.warn(
        "[NEO Renderer] KaTeX rendering failed:",
        error
      );

      return false;
    }
  }

  /* =====================================================
     POST PROCESS
     ===================================================== */

  function postProcess(
    root,
    {
      streaming = false
    } = {}
  ) {
    secureLinks(root);

    secureImages(root);

    enhanceTables(root);

    enhanceHeadings(root);

    enhanceCodeBlocks(
      root,
      {
        streaming
      }
    );

    /*
     * Streaming math can be incomplete and KaTeX may
     * repeatedly replace DOM. Render math only at final.
     */

    if (!streaming) {
      renderMath(root);
    }

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
      !(element instanceof HTMLElement)
    ) {
      return false;
    }

    const role =
      options.role ||
      "assistant";

    const streaming =
      Boolean(
        options.streaming
      );

    /*
     * User messages remain plain text by default.
     * Assistant messages use Markdown by default.
     */

    const useMarkdown =
      options.markdown ??
      (
        role === "assistant"
      );

    if (!useMarkdown) {
      element.textContent =
        String(
          content ?? ""
        );

      emit(
        "neyo:message-rendered",
        {
          element,
          role,
          markdown: false,
          streaming
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
      element,
      {
        streaming
      }
    );

    emit(
      "neyo:message-rendered",
      {
        element,
        role,
        markdown: true,
        streaming
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
  }

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

  const api =
    Object.freeze({
      __controller: true,

      version:
        VERSION,

      active: true,

      render:
        renderMessage,

      renderInto,

      markdownToHtml,

      sanitize:
        sanitizeHtml,

      escape:
        escapeHtml,

      normalizeMathDelimiters,

      secureLinks,

      secureImages,

      enhanceCodeBlocks,

      enhanceTables,

      renderMath,

      isSafeUrl,

      getState() {
        return {
          version:
            VERSION,

          active: true,

          marked:
            Boolean(
              window.marked
            ),

          domPurify:
            Boolean(
              window.DOMPurify
            ),

          katex:
            typeof window
              .renderMathInElement ===
              "function",

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

      active: true,

      markdown: true,

      safeHtml: true,

      math: true,

      codeBlocks: true,

      codeCopy: true,

      streamingSafe: true
    }
  );
})();
