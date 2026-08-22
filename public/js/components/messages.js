/*
=========================================================
NEYO — MESSAGES CORE

Owns:
- Message DOM shells
- User attachment display
- Source pills
- Thinking state
- Message updates/removal
- Auto-scroll
- Clear messages

Does NOT own:
- /api/chat
- Markdown parser
- Copy/edit/regenerate/share
- Attachments upload
- History
- Send / Enter
=========================================================
*/

(() => {
  "use strict";

  const VERSION =
    "neyo-messages-recovery-v1";

  if (
    window.NeyoMessages
      ?.__controller
  ) {
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

  /*
   * While neo.js exists it remains
   * the sole message-DOM owner.
   */

  const active =
    Boolean(
      chatMessages
    ) &&
    !legacy;


  /* =====================================================
     STATE
     ===================================================== */

  let nearBottom =
    true;

  let thinkingElement =
    null;


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


  const clean =
    (
      value,
      max = 50_000
    ) =>

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
        )
        .slice(
          0,
          max
        );


  const makeId =
    () =>

      globalThis.crypto
        ?.randomUUID
        ?.() ||

      (
        `msg_${Date.now()}_` +
        Math.random()
          .toString(36)
          .slice(2)
      );


  const refreshIcons =
    () => {

      try {
        window.lucide
          ?.createIcons
          ?.();

      } catch {}
    };


  /* =====================================================
     MESSAGE LOOKUP
     ===================================================== */

  function findMessage(
    id
  ) {

    if (
      !chatMessages ||
      !id
    ) {
      return null;
    }

    return Array
      .from(
        chatMessages
          .querySelectorAll(
            "[data-neyo-message-id]"
          )
      )
      .find(
        node =>
          node.dataset
            .neyoMessageId ===
          String(id)
      ) ||
      null;
  }


  /* =====================================================
     HERO
     ===================================================== */

  function updateHero() {

    if (
      !active ||
      !heroSection
    ) {
      return;
    }

    const hasMessages =
      Boolean(
        chatMessages
          .querySelector(
            "[data-neyo-message-id]"
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

  function atBottom() {

    if (!scrollArea) {
      return true;
    }

    return (
      scrollArea.scrollHeight -
      scrollArea.scrollTop -
      scrollArea.clientHeight
    ) <= 120;
  }


  function scrollToBottom(
    behavior = "auto",
    force = false
  ) {

    if (
      !active ||
      !scrollArea ||
      (
        !force &&
        !nearBottom
      )
    ) {
      return false;
    }

    try {

      scrollArea.scrollTo({
        top:
          scrollArea
            .scrollHeight,

        behavior
      });

    } catch {

      scrollArea.scrollTop =
        scrollArea
          .scrollHeight;
    }

    nearBottom =
      true;

    return true;
  }


  /* =====================================================
     ATTACHMENT PREVIEW URL
     ===================================================== */

  function safePreview(
    value
  ) {

    const raw =
      clean(
        value,
        5000
      )
        .trim();

    if (!raw) {
      return "";
    }

    if (
      /^(blob:|data:image\/)/i
        .test(
          raw
        )
    ) {
      return raw;
    }

    try {

      const url =
        new URL(
          raw,
          location.origin
        );

      return [
        "http:",
        "https:"
      ].includes(
        url.protocol
      )
        ? url.href
        : "";

    } catch {

      return "";
    }
  }


  /* =====================================================
     ATTACHMENTS
     ===================================================== */

  function renderAttachments(
    wrapper,
    files
  ) {

    if (
      !Array.isArray(
        files
      ) ||
      !files.length
    ) {
      return;
    }

    const grid =
      document.createElement(
        "div"
      );

    grid.className =
      "message-media-grid";

    grid.setAttribute(
      "aria-label",
      "Message attachments"
    );


    files
      .slice(
        0,
        5
      )
      .forEach(
        file => {

          const name =
            clean(
              file?.name ||
              "Attached file",
              220
            );

          const mime =
            clean(
              file?.mime ||
              file?.mimeType ||
              file?.type ||
              "",
              180
            )
              .toLowerCase();

          const category =
            clean(
              file?.category ||
              "unknown",
              32
            )
              .toLowerCase();

          const preview =
            safePreview(
              file?.previewUrl ||
              file?.url ||
              ""
            );


          if (
            (
              category ===
                "image" ||
              mime.startsWith(
                "image/"
              )
            ) &&
            preview
          ) {

            const image =
              document.createElement(
                "img"
              );

            image.src =
              preview;

            image.alt =
              name ||
              "Uploaded image";

            image.loading =
              "lazy";

            image.decoding =
              "async";

            grid.appendChild(
              image
            );

            return;
          }


          const pill =
            document.createElement(
              "div"
            );

          pill.className =
            "message-file-pill";

          pill.textContent =
            name;

          pill.title =
            name;

          grid.appendChild(
            pill
          );
        }
      );


    wrapper.appendChild(
      grid
    );
  }


  /* =====================================================
     SOURCES
     ===================================================== */

  function getSource(
    source
  ) {

    const value =
      source?.url ||
      source?.uri ||
      source?.link ||
      source?.web?.uri ||
      "";

    try {

      const url =
        new URL(
          value
        );

      if (
        ![
          "http:",
          "https:"
        ].includes(
          url.protocol
        )
      ) {
        return null;
      }

      return {
        url:
          url.href,

        label:
          clean(
            source?.title ||
            source?.name ||
            source?.web?.title ||
            url.hostname
              .replace(
                /^www\./,
                ""
              ),
            160
          )
      };

    } catch {

      return null;
    }
  }


  function renderSources(
    messageElement,
    sources
  ) {

    if (
      !Array.isArray(
        sources
      ) ||
      !sources.length
    ) {
      return;
    }

    const valid =
      sources
        .slice(
          0,
          10
        )
        .map(
          getSource
        )
        .filter(
          Boolean
        );

    if (!valid.length) {
      return;
    }


    const root =
      document.createElement(
        "div"
      );

    root.className =
      "neo-source-pills";

    root.setAttribute(
      "aria-label",
      "Sources"
    );


    const title =
      document.createElement(
        "span"
      );

    title.className =
      "neo-source-label";

    title.textContent =
      "Sources";

    root.appendChild(
      title
    );


    valid.forEach(
      source => {

        const link =
          document.createElement(
            "a"
          );

        link.className =
          "neo-source-pill";

        link.href =
          source.url;

        link.target =
          "_blank";

        link.rel =
          "noopener noreferrer";

        link.textContent =
          source.label ||
          "Source";

        link.title =
          link.textContent;

        root.appendChild(
          link
        );
      }
    );


    messageElement
      .appendChild(
        root
      );
  }


  /* =====================================================
     CONTENT
     ===================================================== */

  function renderContent(
    element,
    message,
    markdown = true
  ) {

    const content =
      element
        .querySelector(
          ".message-content"
        );

    if (!content) {
      return false;
    }

    const text =
      clean(
        message?.content
      );


    /*
     * User content is always plain text.
     */

    if (
      message.role !==
      "assistant"
    ) {

      content.textContent =
        text;

      return true;
    }


    /*
     * Safe fallback.
     *
     * If renderer exists it upgrades
     * this content to Markdown.
     */

    content.textContent =
      text;


    if (
      typeof window
        .NeyoMessageRenderer
        ?.render ===
      "function"
    ) {

      window
        .NeyoMessageRenderer
        .render(
          element,
          text,
          {
            role:
              "assistant",

            markdown
          }
        );

    } else {

      emit(
        "neyo:message-render-request",
        {
          message:
            element,

          content:
            text,

          options: {
            role:
              "assistant",

            markdown
          }
        }
      );
    }


    return true;
  }


  /* =====================================================
     CREATE MESSAGE
     ===================================================== */

  function create(
    message,
    options = {}
  ) {

    if (
      !active ||
      !message ||
      ![
        "user",
        "assistant"
      ].includes(
        message.role
      )
    ) {
      return null;
    }


    const id =
      clean(
        message.id,
        128
      ) ||
      makeId();


    /*
     * Duplicate-event protection.
     */

    const existing =
      findMessage(
        id
      );

    if (existing) {
      return existing;
    }


    if (
      message.role ===
      "assistant"
    ) {
      removeThinking();
    }


    const element =
      document.createElement(
        "div"
      );

    element.className =
      `message ${message.role}`;

    element.dataset
      .neyoMessageId =
      id;

    element.dataset
      .messageId =
      id;

    element.dataset
      .role =
      message.role;


    if (
      message.error ===
      true
    ) {

      element.classList
        .add(
          "is-error"
        );

      element.dataset
        .error =
        "true";
    }


    if (
      options.historyLoad
    ) {

      element.dataset
        .historyLoad =
        "true";
    }


    /* -------------------------------------------------
       USER
       ------------------------------------------------- */

    if (
      message.role ===
      "user"
    ) {

      const wrapper =
        document.createElement(
          "div"
        );

      wrapper.className =
        "message-wrapper";


      const content =
        document.createElement(
          "div"
        );

      content.className =
        "message-content";

      wrapper.appendChild(
        content
      );


      renderAttachments(
        wrapper,
        message.attachments
      );


      element.appendChild(
        wrapper
      );

    }

    /* -------------------------------------------------
       ASSISTANT
       ------------------------------------------------- */

    else {

      const content =
        document.createElement(
          "div"
        );

      content.className =
        "message-content";

      element.appendChild(
        content
      );
    }


    chatMessages.appendChild(
      element
    );


    renderContent(
      element,
      message,
      true
    );


    if (
      message.role ===
      "assistant"
    ) {

      renderSources(
        element,
        message.sources
      );
    }


    updateHero();
    refreshIcons();


    emit(
      "neyo:message-shell-created",
      {
        id,

        element,

        message: {
          ...message,
          id
        }
      }
    );


    requestAnimationFrame(
      () =>
        scrollToBottom(
          "auto",
          message.role ===
            "user" ||
          Boolean(
            options.forceScroll
          )
        )
    );


    return element;
  }


  /* =====================================================
     UPDATE MESSAGE
     ===================================================== */

  function update(
    id,
    content,
    options = {}
  ) {

    if (!active) {
      return false;
    }


    const element =
      findMessage(
        id
      );

    if (!element) {
      return false;
    }


    const role =
      element.dataset.role ||
      "assistant";


    const text =
      clean(
        content
      );


    renderContent(
      element,
      {
        role,
        content:
          text
      },
      options.markdown ??
      true
    );


    element.classList
      .toggle(
        "is-error",
        options.error ===
          true
      );


    element.dataset.error =
      options.error ===
        true
        ? "true"
        : "false";


    emit(
      "neyo:message-updated",
      {
        id,
        element,
        content:
          text
      }
    );


    requestAnimationFrame(
      () =>
        scrollToBottom(
          "auto",
          false
        )
    );


    return true;
  }


  /* =====================================================
     REMOVE MESSAGE
     ===================================================== */

  function remove(
    id
  ) {

    if (!active) {
      return false;
    }


    const element =
      findMessage(
        id
      );

    if (!element) {
      return false;
    }


    element.remove();

    updateHero();


    emit(
      "neyo:message-removed",
      {
        id
      }
    );


    return true;
  }


  /* =====================================================
     THINKING
     ===================================================== */

  function showThinking() {

    if (!active) {
      return null;
    }


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

    element.dataset
      .role =
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
      "Thinking.";


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
      () =>
        scrollToBottom(
          "auto",
          true
        )
    );


    emit(
      "neyo:thinking-shown",
      {
        element
      }
    );


    return element;
  }


  function removeThinking() {

    if (!active) {
      return false;
    }


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


    emit(
      "neyo:thinking-hidden"
    );


    return true;
  }


  /* =====================================================
     CLEAR
     ===================================================== */

  function clear() {

    if (
      !active ||
      !chatMessages
    ) {
      return false;
    }


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
     EVENT OWNERSHIP
     ===================================================== */

  if (active) {

    scrollArea
      ?.addEventListener(
        "scroll",
        () => {

          nearBottom =
            atBottom();
        },
        {
          passive:
            true
        }
      );


    /*
     * Chat adds a message to state.
     */

    window.addEventListener(
      "neyo:chat-message-added",
      event => {

        const message =
          event.detail
            ?.message;

        if (!message) {
          return;
        }


        create(
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


    /*
     * Chat removes message from state.
     */

    window.addEventListener(
      "neyo:chat-message-removed",
      event => {

        const id =
          event.detail
            ?.message
            ?.id ||

          event.detail
            ?.id;


        if (id) {
          remove(
            id
          );
        }
      }
    );


    /*
     * Generation lifecycle.
     */

    window.addEventListener(
      "neyo:chat-send-start",
      showThinking
    );

    window.addEventListener(
      "neyo:chat-response",
      removeThinking
    );

    window.addEventListener(
      "neyo:chat-send-end",
      removeThinking
    );

    window.addEventListener(
      "neyo:chat-aborted",
      removeThinking
    );

    window.addEventListener(
      "neyo:chat-error",
      removeThinking
    );


    /*
     * New chat / history reload.
     */

    window.addEventListener(
      "neyo:messages-clear",
      clear
    );


    /*
     * Streaming/edit/regenerate compatible update hook.
     */

    window.addEventListener(
      "neyo:message-update-request",
      event => {

        update(
          event.detail
            ?.id,

          event.detail
            ?.content,

          event.detail
            ?.options ||
          {}
        );
      }
    );


    updateHero();
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

      create,
      update,
      remove,
      clear,

      showThinking,
      removeThinking,

      scrollToBottom,

      getElement:
        findMessage,

      getContainer:
        () =>
          chatMessages,

      getState:
        () => ({

          version:
            VERSION,

          active,

          legacyOwnerActive:
            legacy,

          nearBottom,

          thinking:
            Boolean(
              thinkingElement
            ),

          messageCount:
            active

              ? chatMessages
                  .querySelectorAll(
                    '[data-neyo-message-id]:not([data-neyo-message-id="neyo-thinking"])'
                  )
                  .length

              : 0
        })
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


  emit(
    "neyo:messages-ready",
    {
      version:
        VERSION,

      active,

      legacyOwnerActive:
        legacy
    }
  );

})();
