/*
=========================================================
NEYO — CHAT CORE COMPONENT v3
UNIVERSAL ATTACHMENT AWARE

Owns:
- Conversation state
- /api/chat requests
- Send/generation state
- Conversation ID
- API payload
- Reply parsing
- Credit-limit handling
- Chat lifecycle events
- Attachment transport integration

Does NOT own:
- File upload
- File processing
- Message DOM rendering
- Markdown rendering
- History rendering
- Upgrade/ad modal UI

Attachment architecture:
NeyoAttachments
      ↓
ready attachment
      ↓
Chat transport payload
      ↓
/api/chat
      ↓
normalized chunks / multimodal fallback

=========================================================
*/

(() => {
  "use strict";


  /* =====================================================
     CONSTANTS
     ===================================================== */

  const CHAT_ENDPOINT =
    "/api/chat";


  const MAX_HISTORY_MESSAGES =
    50;


  const MAX_ATTACHMENTS =
    10;


  const MAX_ATTACHMENT_CHUNKS =
    10;


  const MAX_ATTACHMENT_CHUNK_CHARS =
    16000;


  /* =====================================================
     STATE
     ===================================================== */

  let conversation =
    [];


  let currentConversationId =
    null;


  let isGenerating =
    false;


  let abortController =
    null;


  /* =====================================================
     PREFERENCES
     ===================================================== */

  let preferences = {

    intelligence:
      "standard",

    language:
      "auto",

    personality:
      "neyo",

    privateChat:
      false,

    isDeepResearch:
      false
  };


  /* =====================================================
     EVENTS
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


  /* =====================================================
     HELPERS
     ===================================================== */

  const cleanText =
    value => {

      if (
        typeof value !==
        "string"
      ) {

        return "";
      }


      return value
        .replace(
          /\r\n?/g,
          "\n"
        )
        .replace(
          /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
          ""
        )
        .trim();
    };


  const cleanShortText = (
    value,
    max
  ) => {

    return cleanText(
      String(
        value ?? ""
      )
    ).slice(
      0,
      max
    );
  };


  const readJsonResponse =
    async response => {

      const data =
        await response
          .json()
          .catch(
            () => ({})
          );


      if (
        !response.ok
      ) {

        const error =
          new Error(
            data?.error ||
            `Request failed (${response.status})`
          );


        error.status =
          response.status;


        error.data =
          data;


        throw error;
      }


      return data;
    };


  /* =====================================================
     MODEL
     ===================================================== */

  const getSelectedModel =
    () => {

      return (
        window
          .NeyoModelMenu
          ?.getSelected
          ?.() ||
        "l1.0"
      );
    };


  /* =====================================================
     TITLE
     ===================================================== */

  const makeConversationTitle =
    (
      text,
      attachments = []
    ) => {

      const clean =
        cleanText(
          text
        );


      if (
        clean
      ) {

        return clean
          .replace(
            /\s+/g,
            " "
          )
          .slice(
            0,
            80
          );
      }


      if (
        Array.isArray(
          attachments
        ) &&
        attachments.length
      ) {

        return String(
          attachments[0]
            ?.name ||
          "New conversation"
        ).slice(
          0,
          80
        );
      }


      return "New conversation";
    };


  /* =====================================================
     ATTACHMENT HELPERS
     ===================================================== */

  const normalizeChunk =
    chunk => {

      if (
        !chunk ||
        typeof chunk !==
          "object"
      ) {

        return null;
      }


      const text =
        cleanShortText(
          chunk.text ||
          "",
          MAX_ATTACHMENT_CHUNK_CHARS
        );


      if (
        !text
      ) {

        return null;
      }


      return {

        id:
          cleanShortText(
            chunk.id ||
            "",
            100
          ),

        index:
          Number.isFinite(
            Number(
              chunk.index
            )
          )
            ? Number(
                chunk.index
              )
            : 0,

        heading:
          cleanShortText(
            chunk.heading ||
            "",
            200
          ),

        startChar:
          Number.isFinite(
            Number(
              chunk.startChar
            )
          )
            ? Number(
                chunk.startChar
              )
            : null,

        endChar:
          Number.isFinite(
            Number(
              chunk.endChar
            )
          )
            ? Number(
                chunk.endChar
              )
            : null,

        characters:
          Number.isFinite(
            Number(
              chunk.characters
            )
          )
            ? Number(
                chunk.characters
              )
            : text.length,

        text
      };
    };


  /* =====================================================
     FULL TRANSPORT ATTACHMENTS

     These are sent to /api/chat.

     They may contain normalized chunks required
     for direct file grounding.
     ===================================================== */

  const normalizeTransportAttachments =
    attachments => {

      if (
        !Array.isArray(
          attachments
        )
      ) {

        return [];
      }


      return attachments
        .slice(
          0,
          MAX_ATTACHMENTS
        )
        .map(
          file => {

            const chunks =
              Array.isArray(
                file?.chunks
              )
                ? file.chunks
                    .slice(
                      0,
                      MAX_ATTACHMENT_CHUNKS
                    )
                    .map(
                      normalizeChunk
                    )
                    .filter(Boolean)
                : [];


            return {

              provider:
                file?.provider ||
                "supabase",


              bucket:
                file?.bucket ||
                "neyo-attachments",


              path:
                cleanShortText(
                  file?.path ||
                  "",
                  1000
                ),


              uploadId:
                cleanShortText(
                  file?.uploadId ||
                  "",
                  100
                ),


              processId:
                cleanShortText(
                  file?.processId ||
                  "",
                  100
                ),


              documentId:
                cleanShortText(
                  file?.documentId ||
                  file?.document?.id ||
                  "",
                  100
                ),


              name:
                cleanShortText(
                  file?.name ||
                  "Attached file",
                  180
                ),


              mime:
                cleanShortText(
                  file?.mime ||
                  file?.mimeType ||
                  file?.type ||
                  "application/octet-stream",
                  120
                ),


              mimeType:
                cleanShortText(
                  file?.mime ||
                  file?.mimeType ||
                  file?.type ||
                  "application/octet-stream",
                  120
                ),


              extension:
                cleanShortText(
                  file?.extension ||
                  "",
                  30
                )
                  .toLowerCase(),


              category:
                cleanShortText(
                  file?.category ||
                  "unknown",
                  30
                )
                  .toLowerCase(),


              size:
                Number.isFinite(
                  Number(
                    file?.size
                  )
                )
                  ? Math.max(
                      0,
                      Number(
                        file.size
                      )
                    )
                  : 0,


              document:
                file?.document &&
                typeof file.document ===
                  "object"
                  ? {

                      id:
                        cleanShortText(
                          file.document.id ||
                          "",
                          100
                        ),

                      name:
                        cleanShortText(
                          file.document.name ||
                          file?.name ||
                          "",
                          180
                        ),

                      type:
                        cleanShortText(
                          file.document.type ||
                          "",
                          100
                        ),

                      parser:
                        cleanShortText(
                          file.document.parser ||
                          "",
                          100
                        ),

                      extracted:
                        Boolean(
                          file.document
                            .extracted
                        ),

                      truncated:
                        Boolean(
                          file.document
                            .truncated
                        ),

                      chunkCount:
                        Number(
                          file.document
                            .chunkCount
                        ) ||
                        chunks.length,

                      characters:
                        Number(
                          file.document
                            .characters
                        ) ||
                        0
                    }
                  : null,


              chunks,


              stats:
                file?.stats &&
                typeof file.stats ===
                  "object"
                  ? {
                      characters:
                        Number(
                          file.stats
                            .characters
                        ) ||
                        0,

                      chunks:
                        Number(
                          file.stats
                            .chunks
                        ) ||
                        chunks.length,

                      extracted:
                        Boolean(
                          file.stats
                            .extracted
                        ),

                      truncated:
                        Boolean(
                          file.stats
                            .truncated
                        )
                    }
                  : null
            };
          }
        )
        .filter(
          file =>
            Boolean(
              file.path
            )
        );
    };


  /* =====================================================
     LIGHTWEIGHT MESSAGE ATTACHMENTS

     Local conversation history should NOT retain giant
     chunk payloads.

     This representation is for:
     - UI
     - state
     - history
     ===================================================== */

  const normalizeStateAttachments =
    attachments => {

      if (
        !Array.isArray(
          attachments
        )
      ) {

        return [];
      }


      return attachments
        .slice(
          0,
          MAX_ATTACHMENTS
        )
        .map(
          file => ({

            provider:
              file?.provider ||
              "supabase",

            bucket:
              file?.bucket ||
              "neyo-attachments",

            path:
              cleanShortText(
                file?.path ||
                "",
                1000
              ),

            uploadId:
              cleanShortText(
                file?.uploadId ||
                "",
                100
              ),

            processId:
              cleanShortText(
                file?.processId ||
                "",
                100
              ),

            documentId:
              cleanShortText(
                file?.documentId ||
                file?.document?.id ||
                "",
                100
              ),

            name:
              cleanShortText(
                file?.name ||
                "Attached file",
                180
              ),

            mimeType:
              cleanShortText(
                file?.mime ||
                file?.mimeType ||
                file?.type ||
                "application/octet-stream",
                120
              ),

            category:
              cleanShortText(
                file?.category ||
                "unknown",
                30
              )
                .toLowerCase(),

            extension:
              cleanShortText(
                file?.extension ||
                "",
                30
              )
                .toLowerCase(),

            size:
              Number(
                file?.size
              ) ||
              0
          })
        )
        .filter(
          file =>
            Boolean(
              file.path
            )
        );
    };


  /* =====================================================
     ATTACHMENT SYSTEM STATE
     ===================================================== */

  const getAttachmentController =
    () => {

      return (
        window
          .NeyoAttachments ||
        null
      );
    };


  const getCurrentReadyAttachments =
    () => {

      try {

        const controller =
          getAttachmentController();


        if (
          !controller
        ) {

          return [];
        }


        const ready =
          controller
            .getReady
            ?.();


        return Array.isArray(
          ready
        )
          ? ready
          : [];


      } catch (error) {

        console.warn(
          "[NEYO Chat] Unable to read attachments:",
          error
        );


        return [];
      }
    };


  const attachmentsArePending =
    () => {

      try {

        return Boolean(
          getAttachmentController()
            ?.hasPending
            ?.()
        );


      } catch {

        return false;
      }
    };


  const attachmentsHaveErrors =
    () => {

      try {

        return Boolean(
          getAttachmentController()
            ?.hasErrors
            ?.()
        );


      } catch {

        return false;
      }
    };


  /* =====================================================
     ADD MESSAGE TO STATE
     ===================================================== */

  const addMessage =
    (
      role,
      content,
      options = {}
    ) => {

      if (
        role !==
          "user" &&
        role !==
          "assistant"
      ) {

        return null;
      }


      const message = {

        role,

        content:
          cleanText(
            content
          )
      };


      const attachments =
        normalizeStateAttachments(
          options.attachments
        );


      if (
        attachments.length
      ) {

        message.attachments =
          attachments;
      }


      if (
        Array.isArray(
          options.sources
        ) &&
        options.sources.length
      ) {

        message.sources =
          options.sources;
      }


      conversation.push(
        message
      );


      if (
        conversation.length >
        MAX_HISTORY_MESSAGES
      ) {

        conversation =
          conversation.slice(
            -MAX_HISTORY_MESSAGES
          );
      }


      emit(
        "neyo:chat-message-added",
        {

          message,

          conversation:
            [...conversation]
        }
      );


      return message;
    };


  /* =====================================================
     REMOVE LAST USER MESSAGE
     ===================================================== */

  const removeLastUserMessage =
    () => {

      const last =
        conversation[
          conversation.length -
          1
        ];


      if (
        last?.role ===
        "user"
      ) {

        return conversation.pop();
      }


      return null;
    };


  /* =====================================================
     BUILD SERVER HISTORY

     Important:
     Stored historical attachment refs remain lightweight.

     Current-turn full attachment chunks travel separately
     through payload.attachments.
     ===================================================== */

  const buildServerHistory =
    () => {

      return conversation
        .slice(
          -MAX_HISTORY_MESSAGES
        )
        .map(
          message => {

            const normalized = {

              role:
                message.role,

              content:
                cleanText(
                  message.content ||
                  ""
                )
            };


            const attachments =
              normalizeStateAttachments(
                message.attachments
              );


            if (
              attachments.length
            ) {

              normalized.attachments =
                attachments;
            }


            return normalized;
          }
        );
    };


  /* =====================================================
     BUILD PAYLOAD
     ===================================================== */

  const buildPayload =
    (
      text,
      attachments
    ) => {

      const privateChat =
        Boolean(
          preferences.privateChat
        );


      const transportAttachments =
        normalizeTransportAttachments(
          attachments
        );


      return {

        messages:
          buildServerHistory(),


        /*
        Full current-turn attachment payload.
        */

        attachments:
          transportAttachments,


        conversationId:
          privateChat
            ? null
            : currentConversationId,


        model:
          getSelectedModel(),


        intelligence:
          preferences.intelligence,


        privateChat,


        language:
          preferences.language,


        personality:
          preferences.personality,


        isDeepResearch:
          Boolean(
            preferences
              .isDeepResearch
          ),


        title:
          makeConversationTitle(
            text,
            transportAttachments
          )
      };
    };


  /* =====================================================
     RESOLVE ATTACHMENTS FOR SEND

     Priority:
     1. Explicit attachments passed to send()
     2. Current NeyoAttachments ready state
     ===================================================== */

  const resolveSendAttachments =
    attachments => {

      if (
        Array.isArray(
          attachments
        ) &&
        attachments.length
      ) {

        return normalizeTransportAttachments(
          attachments
        );
      }


      return normalizeTransportAttachments(
        getCurrentReadyAttachments()
      );
    };


  /* =====================================================
     SEND
     ===================================================== */

  const send =
    async ({
      text = "",
      attachments = null
    } = {}) => {

      /* -------------------------------------------------
         GENERATION LOCK
         ------------------------------------------------- */

      if (
        isGenerating
      ) {

        emit(
          "neyo:chat-busy"
        );


        return null;
      }


      /* -------------------------------------------------
         ATTACHMENT PROCESSING LOCK

         Do not send while file is still:
         uploading / processing / queued.
         ------------------------------------------------- */

      if (
        attachmentsArePending()
      ) {

        emit(
          "neyo:chat-attachments-pending",
          {
            message:
              "Please wait for attachments to finish processing."
          }
        );


        return null;
      }


      const clean =
        cleanText(
          text
        );


      const transportAttachments =
        resolveSendAttachments(
          attachments
        );


      if (
        !clean &&
        transportAttachments.length ===
          0
      ) {

        return null;
      }


      /*
      Attachment-only messages still need a user text
      message for Gemini.
      */

      const apiContent =
        clean ||
        "Please analyze the attached file.";


      /* -------------------------------------------------
         LIGHTWEIGHT USER MESSAGE STATE
         ------------------------------------------------- */

      const stateAttachments =
        normalizeStateAttachments(
          transportAttachments
        );


      addMessage(
        "user",
        apiContent,
        {
          attachments:
            stateAttachments
        }
      );


      isGenerating =
        true;


      abortController =
        new AbortController();


      emit(
        "neyo:chat-send-start",
        {

          text:
            clean,

          attachments:
            stateAttachments,

          attachmentCount:
            transportAttachments.length,

          conversationId:
            currentConversationId
        }
      );


      try {

        /* ---------------------------------------------
           PAYLOAD
           --------------------------------------------- */

        const payload =
          buildPayload(
            apiContent,
            transportAttachments
          );


        /* ---------------------------------------------
           REQUEST
           --------------------------------------------- */

        const response =
          await fetch(
            CHAT_ENDPOINT,
            {
              method:
                "POST",

              credentials:
                "include",

              cache:
                "no-store",

              headers: {

                "Content-Type":
                  "application/json",

                Accept:
                  "application/json"
              },

              body:
                JSON.stringify(
                  payload
                ),

              signal:
                abortController
                  .signal
            }
          );


        /* ---------------------------------------------
           MESSAGE LIMIT
           --------------------------------------------- */

        if (
          response.status ===
          429
        ) {

          const data =
            await response
              .json()
              .catch(
                () => ({})
              );


          removeLastUserMessage();


          emit(
            "neyo:chat-limit-reached",
            {
              data
            }
          );


          return null;
        }


        const data =
          await readJsonResponse(
            response
          );


        /* ---------------------------------------------
           REPLY
           --------------------------------------------- */

        const replyValue =
          data?.reply ??
          data?.choices?.[0]
            ?.message
            ?.content ??
          data?.message
            ?.content ??
          data?.content ??
          data?.text;


        const reply =
          typeof replyValue ===
            "string"
            ? replyValue.trim()
            : "";


        if (
          !reply
        ) {

          throw new Error(
            "The AI response was empty."
          );
        }


        /* ---------------------------------------------
           CONVERSATION ID
           --------------------------------------------- */

        if (
          !preferences.privateChat &&
          typeof data
            ?.conversationId ===
            "string" &&
          data.conversationId
            .trim()
        ) {

          currentConversationId =
            data
              .conversationId
              .trim();
        }


        /* ---------------------------------------------
           SOURCES
           --------------------------------------------- */

        const sources =
          Array.isArray(
            data?.sources
          )
            ? data.sources
            : [];


        /* ---------------------------------------------
           ATTACHMENT RESULT INFO
           --------------------------------------------- */

        const attachmentInfo =
          data?.attachmentInfo &&
          typeof data.attachmentInfo ===
            "object"
            ? data.attachmentInfo
            : null;


        if (
          attachmentInfo
        ) {

          emit(
            "neyo:chat-attachment-info",
            attachmentInfo
          );
        }


        /* ---------------------------------------------
           ASSISTANT STATE
           --------------------------------------------- */

        addMessage(
          "assistant",
          reply,
          {
            sources
          }
        );


        const result = {

          reply,

          sources,

          conversationId:
            currentConversationId,

          privateChat:
            Boolean(
              data?.privateChat
            ),

          usedUrlContext:
            Boolean(
              data
                ?.usedUrlContext
            ),

          creditType:
            data?.creditType ||
            null,

          attachmentInfo
        };


        emit(
          "neyo:chat-response",
          result
        );


        /* ---------------------------------------------
           ATTACHMENT CONSUMED

           Do not automatically clear if another module
           explicitly wants to preserve them.

           Default frontend behavior:
           successful send clears composer attachments.
           --------------------------------------------- */

        if (
          transportAttachments.length
        ) {

          emit(
            "neyo:chat-attachments-consumed",
            {
              attachments:
                stateAttachments
            }
          );


          try {

            window
              .NeyoAttachments
              ?.clear
              ?.();

          } catch (
            error
          ) {

            console.warn(
              "[NEYO Chat] Could not clear sent attachments:",
              error
            );
          }
        }


        /*
        History module decides how to
        refresh its UI.
        */

        if (
          !preferences.privateChat
        ) {

          emit(
            "neyo:history-load-request"
          );
        }


        return result;


      } catch (error) {

        if (
          error?.name ===
          "AbortError"
        ) {

          emit(
            "neyo:chat-aborted"
          );


          return null;
        }


        /*
        API failed, so remove optimistic
        current user message from local state.
        */

        removeLastUserMessage();


        emit(
          "neyo:chat-error",
          {
            error
          }
        );


        throw error;


      } finally {

        isGenerating =
          false;


        abortController =
          null;


        emit(
          "neyo:chat-send-end",
          {
            conversationId:
              currentConversationId
          }
        );
      }
    };


  /* =====================================================
     STOP
     ===================================================== */

  const stop =
    () => {

      if (
        !abortController
      ) {

        return false;
      }


      abortController.abort();


      return true;
    };


  /* =====================================================
     NEW CONVERSATION
     ===================================================== */

  const newConversation =
    () => {

      stop();


      conversation =
        [];


      currentConversationId =
        null;


      /*
      New conversation should start with
      clean composer attachments.
      */

      try {

        window
          .NeyoAttachments
          ?.clear
          ?.();

      } catch {}


      emit(
        "neyo:chat-new",
        {
          conversation:
            []
        }
      );


      return true;
    };


  /* =====================================================
     LOAD CONVERSATION
     ===================================================== */

  const loadConversation = ({
    conversationId,
    messages = []
  } = {}) => {

    currentConversationId =
      conversationId ||
      null;


    conversation =
      Array.isArray(
        messages
      )
        ? messages
            .filter(
              message =>
                message &&
                (
                  message.role ===
                    "user" ||
                  message.role ===
                    "assistant"
                )
            )
            .map(
              message => {

                const normalized = {

                  role:
                    message.role,

                  content:
                    cleanText(
                      message.content ||
                      ""
                    )
                };


                const attachments =
                  normalizeStateAttachments(
                    message.attachments
                  );


                if (
                  attachments.length
                ) {

                  normalized.attachments =
                    attachments;
                }


                if (
                  Array.isArray(
                    message.sources
                  ) &&
                  message.sources.length
                ) {

                  normalized.sources =
                    message.sources;
                }


                return normalized;
              }
            )
            .slice(
              -MAX_HISTORY_MESSAGES
            )
        : [];


    emit(
      "neyo:chat-state-loaded",
      {

        conversationId:
          currentConversationId,

        messages:
          [...conversation]
      }
    );
  };


  /* =====================================================
     PREFERENCES
     ===================================================== */

  const setPreferences =
    values => {

      if (
        !values ||
        typeof values !==
          "object"
      ) {

        return;
      }


      preferences = {
        ...preferences,
        ...values
      };


      emit(
        "neyo:chat-preferences-change",
        {
          preferences:
            {
              ...preferences
            }
        }
      );
    };


  /* =====================================================
     ATTACHMENT STATE EVENTS
     ===================================================== */

  window.addEventListener(
    "neyo:attachments-change",
    event => {

      const attachments =
        Array.isArray(
          event.detail
            ?.attachments
        )
          ? event.detail.attachments
          : [];


      emit(
        "neyo:chat-attachments-state",
        {

          count:
            attachments.length,

          pending:
            attachments.some(
              attachment =>
                [
                  "queued",
                  "authorizing",
                  "uploading",
                  "uploaded",
                  "processing",
                  "queued-processing"
                ].includes(
                  attachment.status
                )
            ),

          errors:
            attachments.filter(
              attachment =>
                attachment.status ===
                  "error"
            ).length,

          ready:
            attachments.filter(
              attachment =>
                attachment.status ===
                  "ready"
            ).length
        }
      );
    }
  );


  /* =====================================================
     HISTORY CONNECTION
     ===================================================== */

  window.addEventListener(
    "neyo:conversation-loaded",
    event => {

      loadConversation({

        conversationId:
          event.detail
            ?.conversationId,

        messages:
          event.detail
            ?.messages ||
          []
      });
    }
  );


  /* =====================================================
     PUBLIC SEND EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-send-request",
    event => {

      /*
      If composer explicitly supplies attachments,
      use them.

      Otherwise send() automatically reads
      NeyoAttachments.getReady().
      */

      send({

        text:
          event.detail
            ?.text ||
          "",

        attachments:
          Array.isArray(
            event.detail
              ?.attachments
          )
            ? event.detail
                .attachments
            : null

      }).catch(
        error => {

          console.error(
            "[NEYO Chat] Send failed:",
            error
          );
        }
      );
    }
  );


  /* =====================================================
     STOP EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-stop-request",
    stop
  );


  /* =====================================================
     NEW CHAT EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-new-request",
    newConversation
  );


  /* =====================================================
     PREFERENCES EVENT
     ===================================================== */

  window.addEventListener(
    "neyo:chat-preferences-set",
    event => {

      setPreferences(
        event.detail
      );
    }
  );


  /* =====================================================
     PUBLIC API
     ===================================================== */

  window.NeyoChat =
    Object.freeze({

      send,

      stop,

      newConversation,

      loadConversation,

      addMessage,

      setPreferences,


      getPreferences:
        () => ({
          ...preferences
        }),


      getConversation:
        () =>
          conversation.map(
            message => ({

              ...message,

              attachments:
                message.attachments
                  ? message
                      .attachments
                      .map(
                        attachment => ({
                          ...attachment
                        })
                      )
                  : undefined,

              sources:
                message.sources
                  ? [
                      ...message.sources
                    ]
                  : undefined
            })
          ),


      getConversationId:
        () =>
          currentConversationId,


      setConversationId:
        id => {

          currentConversationId =
            id ||
            null;
        },


      getReadyAttachments:
        () =>
          normalizeTransportAttachments(
            getCurrentReadyAttachments()
          ),


      attachmentsPending:
        attachmentsArePending,


      attachmentsHaveErrors,


      isGenerating:
        () =>
          isGenerating,


      version:
        "chat-v3-universal-attachments"
    });


  /* =====================================================
     INIT
     ===================================================== */

  console.log(
    "[NEYO Chat] Universal attachment-aware chat ready",
    {
      maxAttachments:
        MAX_ATTACHMENTS,

      attachmentSystem:
        Boolean(
          window.NeyoAttachments
        )
    }
  );

})();
