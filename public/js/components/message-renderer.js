(() => {
  "use strict";

  const VERSION = "neyo-message-renderer-v2";
  if (window.NeyoMessageRenderer?.__controller === true) return;

  const SAFE_PROTOCOLS = new Set([
    "http:",
    "https:",
    "mailto:"
  ]);

  function emit(name, detail = {}) {
    window.dispatchEvent(
      new CustomEvent(name, { detail })
    );
  }

  function text(value) {
    return String(value ?? "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n");
  }

  function escapeHtml(value) {
    return text(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function configureMarked() {
    if (!window.marked?.setOptions) return false;

    try {
      window.marked.setOptions({
        gfm: true,
        breaks: true,
        pedantic: false,
        mangle: false,
        headerIds: false
      });

      return true;
    } catch {
      return false;
    }
  }

  function sanitizeHtml(html) {
    if (!window.DOMPurify?.sanitize) {
      return null;
    }

    return window.DOMPurify.sanitize(
      String(html ?? ""),
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
  }

  function markdownToHtml(markdown) {
    const input = text(markdown);

    if (
      !window.marked?.parse ||
      !window.DOMPurify?.sanitize
    ) {
      return escapeHtml(input).replace(/\n/g, "<br>");
    }

    try {
      configureMarked();

      const parsed = window.marked.parse(input);
      const safe = sanitizeHtml(parsed);

      return (
        safe ??
        escapeHtml(input).replace(/\n/g, "<br>")
      );
    } catch (error) {
      console.warn(
        "[NEYO Renderer] Markdown render failed:",
        error
      );

      return escapeHtml(input).replace(/\n/g, "<br>");
    }
  }

  function safeUrl(value) {
    if (!value) return null;

    try {
      const url = new URL(
        value,
        location.origin
      );

      return SAFE_PROTOCOLS.has(url.protocol)
        ? url
        : null;
    } catch {
      return null;
    }
  }

  function secureLinks(root) {
    if (!(root instanceof HTMLElement)) {
      return false;
    }

    for (const link of root.querySelectorAll("a[href]")) {
      const url = safeUrl(
        link.getAttribute("href")
      );

      if (!url) {
        link.removeAttribute("href");
        link.removeAttribute("target");
        link.removeAttribute("rel");
        continue;
      }

      link.href = url.href;

      if (url.origin !== location.origin) {
        link.target = "_blank";
        link.rel =
          "noopener noreferrer nofollow";
      } else {
        link.removeAttribute("target");
        link.rel = "noopener";
      }
    }

    return true;
  }

  function languageOf(code) {
    const className = String(
      code?.className || ""
    );

    return (
      className.match(
        /(?:language|lang)-([\w#+.-]+)/i
      )?.[1] ||
      "code"
    ).toLowerCase();
  }

  async function copyText(value, button) {
    if (!navigator.clipboard?.writeText) {
      return false;
    }

    try {
      await navigator.clipboard.writeText(
        String(value ?? "")
      );

      if (button) {
        const previous =
          button.getAttribute("aria-label") ||
          "Copy code";

        button.setAttribute(
          "aria-label",
          "Copied"
        );

        button.dataset.copied = "true";

        window.setTimeout(() => {
          button.setAttribute(
            "aria-label",
            previous
          );

          delete button.dataset.copied;
        }, 1200);
      }

      return true;
    } catch (error) {
      console.warn(
        "[NEYO Renderer] Copy failed:",
        error
      );

      return false;
    }
  }

  function highlightCode(code) {
    try {
      if (
        typeof window.hljs?.highlightElement ===
        "function"
      ) {
        window.hljs.highlightElement(code);
        return true;
      }

      if (
        typeof window.Prism?.highlightElement ===
        "function"
      ) {
        window.Prism.highlightElement(code);
        return true;
      }
    } catch {}

    return false;
  }

  function enhanceCodeBlocks(root) {
    if (!(root instanceof HTMLElement)) {
      return false;
    }

    for (const code of root.querySelectorAll("pre > code")) {
      const pre = code.parentElement;

      if (
        !pre ||
        pre.closest(".neyo-code-block")
      ) {
        continue;
      }

      const shell =
        document.createElement("div");

      const header =
        document.createElement("div");

      const label =
        document.createElement("span");

      const copy =
        document.createElement("button");

      shell.className =
        "neyo-code-block";

      header.className =
        "neyo-code-header";

      label.className =
        "neyo-code-language";

      label.textContent =
        languageOf(code);

      copy.type = "button";
      copy.className =
        "neyo-code-copy";

      copy.textContent = "Copy";

      copy.setAttribute(
        "aria-label",
        "Copy code"
      );

      copy.title = "Copy code";

      copy.addEventListener(
        "click",
        () => {
          void copyText(
            code.textContent || "",
            copy
          );
        }
      );

      header.append(
        label,
        copy
      );

      pre.before(shell);

      shell.append(
        header,
        pre
      );

      highlightCode(code);
    }

    return true;
  }

  function wrapTables(root) {
    if (!(root instanceof HTMLElement)) {
      return false;
    }

    for (const table of root.querySelectorAll("table")) {
      if (
        table.parentElement?.classList.contains(
          "neyo-table-wrap"
        )
      ) {
        continue;
      }

      const wrapper =
        document.createElement("div");

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

      wrapper.tabIndex = 0;

      table.before(wrapper);
      wrapper.appendChild(table);
    }

    return true;
  }

  function renderMath(root) {
    if (!(root instanceof HTMLElement)) {
      return false;
    }

    if (
      typeof window.renderMathInElement !==
      "function"
    ) {
      return false;
    }

    try {
      window.renderMathInElement(
        root,
        {
          throwOnError: false,
          strict: "ignore",

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
        "[NEYO Renderer] Math render failed:",
        error
      );

      return false;
    }
  }

  function renderInto(
    element,
    content,
    options = {}
  ) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const role =
      options.role ||
      "assistant";

    const markdown =
      options.markdown ??
      (role === "assistant");

    const value = text(content);

    if (!markdown) {
      element.textContent = value;
    } else {
      element.innerHTML =
        markdownToHtml(value);

      secureLinks(element);
      wrapTables(element);
      enhanceCodeBlocks(element);
      renderMath(element);
    }

    emit(
      "neyo:message-rendered",
      {
        element,
        role,
        markdown,
        content: value
      }
    );

    return true;
  }

  function render(
    messageElement,
    content,
    options = {}
  ) {
    if (
      !(messageElement instanceof HTMLElement)
    ) {
      return false;
    }

    const target =
      messageElement.querySelector(
        ".message-content"
      );

    if (!target) return false;

    return renderInto(
      target,
      content,
      options
    );
  }

  window.addEventListener(
    "neyo:message-render-request",
    event => {
      render(
        event.detail?.message,
        event.detail?.content,
        event.detail?.options || {}
      );
    }
  );

  window.addEventListener(
    "neyo:content-render-request",
    event => {
      renderInto(
        event.detail?.element,
        event.detail?.content,
        event.detail?.options || {}
      );
    }
  );

  const api = Object.freeze({
    __controller: true,
    version: VERSION,
    active: true,

    render,
    renderInto,
    markdownToHtml,

    sanitize:
      sanitizeHtml,

    escape:
      escapeHtml,

    secureLinks,
    enhanceCodeBlocks,
    renderMath,

    getState() {
      return {
        version: VERSION,
        active: true,
        marked: Boolean(
          window.marked?.parse
        ),
        domPurify: Boolean(
          window.DOMPurify?.sanitize
        ),
        katex: Boolean(
          window.renderMathInElement
        ),
        highlighter: Boolean(
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

  emit(
    "neyo:message-renderer-ready",
    {
      version: VERSION,
      active: true
    }
  );
})();
