import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "../lib/auth.js";

const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 200;
const MAX_TITLE_LENGTH = 80;


/* =====================================================
   RESPONSE
   ===================================================== */

function setResponseHeaders(res) {
    res.setHeader(
        "Content-Type",
        "application/json"
    );

    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
    );

    res.setHeader(
        "Pragma",
        "no-cache"
    );

    res.setHeader(
        "Expires",
        "0"
    );
}


/* =====================================================
   SUPABASE
   ===================================================== */

function createSupabaseAdmin() {
    const supabaseUrl =
        process.env.SUPABASE_URL;

    const serviceRoleKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY;


    if (
        !supabaseUrl ||
        !serviceRoleKey
    ) {
        throw new Error(
            "Missing required Supabase environment variables."
        );
    }


    return createClient(
        supabaseUrl,
        serviceRoleKey,
        {
            auth: {
                persistSession:
                    false,

                autoRefreshToken:
                    false
            }
        }
    );
}


/* =====================================================
   BODY
   ===================================================== */

function parseRequestBody(req) {
    if (!req.body) {
        return {};
    }


    if (
        typeof req.body ===
        "object"
    ) {
        return req.body;
    }


    if (
        typeof req.body ===
        "string"
    ) {
        try {
            return JSON.parse(
                req.body
            );
        } catch {
            return null;
        }
    }


    return null;
}


/* =====================================================
   HELPERS
   ===================================================== */

function cleanString(
    value,
    maxLength = 200
) {
    if (
        typeof value !==
        "string"
    ) {
        return "";
    }


    return value
        .replace(
            /\u0000/g,
            ""
        )
        .trim()
        .slice(
            0,
            maxLength
        );
}


function getHistoryLimit(value) {
    const parsed =
        Number.parseInt(
            String(
                value ||
                ""
            ),
            10
        );


    if (
        !Number.isFinite(
            parsed
        ) ||
        parsed <= 0
    ) {
        return DEFAULT_HISTORY_LIMIT;
    }


    return Math.min(
        parsed,
        MAX_HISTORY_LIMIT
    );
}


function normalizeAction(value) {
    const action =
        cleanString(
            value,
            40
        ).toLowerCase();


    const aliases = {
        history:
            "list",

        conversations:
            "list",

        gethistory:
            "list",

        load:
            "get",

        open:
            "get",

        messages:
            "get",

        conversation:
            "get",

        remove:
            "delete",

        update:
            "rename",

        title:
            "rename"
    };


    return (
        aliases[action] ||
        action
    );
}


function getConversationId(
    req,
    body
) {
    return cleanString(
        body?.conversationId ||
        body?.conversation_id ||
        req.query?.conversationId ||
        req.query?.conversation_id ||
        "",
        100
    );
}


/* =====================================================
   SAFE OUTPUT
   ===================================================== */

function safeConversation(
    conversation
) {
    return {
        id:
            String(
                conversation.id
            ),

        title:
            typeof conversation.title ===
                "string" &&
            conversation.title.trim()
                ? conversation.title.trim()
                : "New Chat",

        model:
            conversation.model_used ||
            conversation.model ||
            null,

        isPinned:
            Boolean(
                conversation.is_pinned
            ),

        createdAt:
            conversation.created_at ||
            null,

        updatedAt:
            conversation.updated_at ||
            conversation.created_at ||
            null
    };
}


function safeMessage(
    message
) {
    return {
        id:
            String(
                message.id
            ),

        role:
            message.role,

        content:
            typeof message.content ===
                "string"
                ? message.content
                : "",

        attachments:
            Array.isArray(
                message.attachments
            )
                ? message.attachments
                : [],

        sources:
            Array.isArray(
                message.sources
            )
                ? message.sources
                : [],

        createdAt:
            message.created_at ||
            null
    };
}


/* =====================================================
   OWNERSHIP
   ===================================================== */

async function verifyConversationOwnership(
    supabase,
    conversationId,
    userId
) {
    const {
        data,
        error
    } =
        await supabase
            .from(
                "chat_conversations"
            )
            .select(
                "*"
            )
            .eq(
                "id",
                conversationId
            )
            .eq(
                "user_id",
                userId
            )
            .maybeSingle();


    if (error) {
        throw error;
    }


    return data;
}


/* =====================================================
   LIST
   ===================================================== */

async function listConversations(
    supabase,
    userId,
    limit
) {
    const {
        data,
        error
    } =
        await supabase
            .from(
                "chat_conversations"
            )
            .select(
                "*"
            )
            .eq(
                "user_id",
                userId
            )
            .order(
                "is_pinned",
                {
                    ascending:
                        false
                }
            )
            .order(
                "created_at",
                {
                    ascending:
                        false
                }
            )
            .limit(
                limit
            );


    if (error) {
        throw error;
    }


    return (
        data ||
        []
    ).map(
        safeConversation
    );
}


/* =====================================================
   MESSAGES
   ===================================================== */

async function loadConversationMessages(
    supabase,
    conversationId
) {
    const {
        data,
        error
    } =
        await supabase
            .from(
                "chat_messages"
            )
            .select(
                "*"
            )
            .eq(
                "conversation_id",
                conversationId
            )
            .order(
                "created_at",
                {
                    ascending:
                        true
                }
            );


    if (error) {
        throw error;
    }


    return (
        data ||
        []
    ).map(
        safeMessage
    );
}


/* =====================================================
   DELETE
   ===================================================== */

async function deleteConversation(
    supabase,
    conversationId,
    userId
) {
    const conversation =
        await verifyConversationOwnership(
            supabase,
            conversationId,
            userId
        );


    if (!conversation) {
        return false;
    }


    const {
        error:
            messageDeleteError
    } =
        await supabase
            .from(
                "chat_messages"
            )
            .delete()
            .eq(
                "conversation_id",
                conversationId
            );


    if (
        messageDeleteError
    ) {
        throw messageDeleteError;
    }


    const {
        error:
            conversationDeleteError
    } =
        await supabase
            .from(
                "chat_conversations"
            )
            .delete()
            .eq(
                "id",
                conversationId
            )
            .eq(
                "user_id",
                userId
            );


    if (
        conversationDeleteError
    ) {
        throw conversationDeleteError;
    }


    return true;
}


/* =====================================================
   RENAME
   ===================================================== */

async function renameConversation(
    supabase,
    conversationId,
    userId,
    title
) {
    const conversation =
        await verifyConversationOwnership(
            supabase,
            conversationId,
            userId
        );


    if (!conversation) {
        return null;
    }


    const cleanTitle =
        cleanString(
            title,
            MAX_TITLE_LENGTH
        )
            .replace(
                /\s+/g,
                " "
            );


    if (!cleanTitle) {
        throw new Error(
            "INVALID_TITLE"
        );
    }


    const {
        data,
        error
    } =
        await supabase
            .from(
                "chat_conversations"
            )
            .update({
                title:
                    cleanTitle
            })
            .eq(
                "id",
                conversationId
            )
            .eq(
                "user_id",
                userId
            )
            .select(
                "*"
            )
            .single();


    if (error) {
        throw error;
    }


    return safeConversation(
        data
    );
}


/* =====================================================
   PIN / UNPIN
   ===================================================== */

async function setConversationPinned(
    supabase,
    conversationId,
    userId,
    isPinned
) {
    const conversation =
        await verifyConversationOwnership(
            supabase,
            conversationId,
            userId
        );


    if (!conversation) {
        return null;
    }


    const {
        data,
        error
    } =
        await supabase
            .from(
                "chat_conversations"
            )
            .update({
                is_pinned:
                    Boolean(
                        isPinned
                    )
            })
            .eq(
                "id",
                conversationId
            )
            .eq(
                "user_id",
                userId
            )
            .select(
                "*"
            )
            .single();


    if (error) {
        throw error;
    }


    return safeConversation(
        data
    );
}


/* =====================================================
   HANDLER
   ===================================================== */

export default async function handler(
    req,
    res
) {
    setResponseHeaders(
        res
    );


    const allowedMethods = [
        "GET",
        "POST",
        "DELETE",
        "PATCH"
    ];


    if (
        !allowedMethods.includes(
            req.method
        )
    ) {
        res.setHeader(
            "Allow",
            allowedMethods.join(
                ", "
            )
        );


        return res
            .status(
                405
            )
            .json({
                error:
                    "Method Not Allowed"
            });
    }


    /* =================================================
       AUTH
       ================================================= */

    const authUser =
        await getAuthenticatedUser(
            req
        );


    if (
        !authUser?.userId
    ) {
        return res
            .status(
                401
            )
            .json({
                error:
                    "Authentication required. Please log in.",

                authenticated:
                    false
            });
    }


    const userId =
        authUser.userId;


    /* =================================================
       BODY / ACTION
       ================================================= */

    const body =
        req.method ===
        "GET"
            ? {}
            : parseRequestBody(
                req
            );


    if (
        body ===
        null
    ) {
        return res
            .status(
                400
            )
            .json({
                error:
                    "Invalid JSON request payload."
            });
    }


    let action =
        normalizeAction(
            body?.action ||
            req.query?.action ||
            ""
        );


    const conversationId =
        getConversationId(
            req,
            body
        );


    if (!action) {
        if (
            req.method ===
            "DELETE"
        ) {
            action =
                "delete";

        } else if (
            req.method ===
            "PATCH"
        ) {
            action =
                "rename";

        } else if (
            conversationId
        ) {
            action =
                "get";

        } else {
            action =
                "list";
        }
    }


    let supabase;


    try {
        supabase =
            createSupabaseAdmin();

    } catch (
        error
    ) {
        console.error(
            "History configuration error:",
            error.message
        );


        return res
            .status(
                500
            )
            .json({
                error:
                    "The conversation history service is not configured."
            });
    }


    try {

        /* =================================================
           LIST
           ================================================= */

        if (
            action ===
            "list"
        ) {
            const limit =
                getHistoryLimit(
                    body?.limit ||
                    req.query?.limit
                );


            const conversations =
                await listConversations(
                    supabase,
                    userId,
                    limit
                );


            return res
                .status(
                    200
                )
                .json({
                    success:
                        true,

                    conversations,

                    history:
                        conversations,

                    count:
                        conversations.length
                });
        }


        /* =================================================
           GET
           ================================================= */

        if (
            action ===
            "get"
        ) {
            if (
                !conversationId
            ) {
                return res
                    .status(
                        400
                    )
                    .json({
                        error:
                            "Conversation ID is required."
                    });
            }


            const conversation =
                await verifyConversationOwnership(
                    supabase,
                    conversationId,
                    userId
                );


            if (
                !conversation
            ) {
                return res
                    .status(
                        404
                    )
                    .json({
                        error:
                            "Conversation not found."
                    });
            }


            const messages =
                await loadConversationMessages(
                    supabase,
                    conversationId
                );


            return res
                .status(
                    200
                )
                .json({
                    success:
                        true,

                    conversation:
                        safeConversation(
                            conversation
                        ),

                    messages
                });
        }


        /* =================================================
           PIN
           ================================================= */

        if (
            action ===
            "pin"
        ) {
            if (
                !conversationId
            ) {
                return res
                    .status(
                        400
                    )
                    .json({
                        error:
                            "Conversation ID is required."
                    });
            }


            const updatedConversation =
                await setConversationPinned(
                    supabase,
                    conversationId,
                    userId,
                    true
                );


            if (
                !updatedConversation
            ) {
                return res
                    .status(
                        404
                    )
                    .json({
                        error:
                            "Conversation not found."
                    });
            }


            return res
                .status(
                    200
                )
                .json({
                    success:
                        true,

                    pinned:
                        true,

                    conversationId,

                    conversation:
                        updatedConversation
                });
        }


        /* =================================================
           UNPIN
           ================================================= */

        if (
            action ===
            "unpin"
        ) {
            if (
                !conversationId
            ) {
                return res
                    .status(
                        400
                    )
                    .json({
                        error:
                            "Conversation ID is required."
                    });
            }


            const updatedConversation =
                await setConversationPinned(
                    supabase,
                    conversationId,
                    userId,
                    false
                );


            if (
                !updatedConversation
            ) {
                return res
                    .status(
                        404
                    )
                    .json({
                        error:
                            "Conversation not found."
                    });
            }


            return res
                .status(
                    200
                )
                .json({
                    success:
                        true,

                    pinned:
                        false,

                    conversationId,

                    conversation:
                        updatedConversation
                });
        }


        /* =================================================
           DELETE
           ================================================= */

        if (
            action ===
            "delete"
        ) {
            if (
                !conversationId
            ) {
                return res
                    .status(
                        400
                    )
                    .json({
                        error:
                            "Conversation ID is required."
                    });
            }


            const deleted =
                await deleteConversation(
                    supabase,
                    conversationId,
                    userId
                );


            if (
                !deleted
            ) {
                return res
                    .status(
                        404
                    )
                    .json({
                        error:
                            "Conversation not found."
                    });
            }


            return res
                .status(
                    200
                )
                .json({
                    success:
                        true,

                    deleted:
                        true,

                    conversationId
                });
        }


        /* =================================================
           RENAME
           ================================================= */

        if (
            action ===
            "rename"
        ) {
            if (
                !conversationId
            ) {
                return res
                    .status(
                        400
                    )
                    .json({
                        error:
                            "Conversation ID is required."
                    });
            }


            const title =
                cleanString(
                    body?.title,
                    MAX_TITLE_LENGTH
                );


            if (!title) {
                return res
                    .status(
                        400
                    )
                    .json({
                        error:
                            "A valid conversation title is required."
                    });
            }


            const updatedConversation =
                await renameConversation(
                    supabase,
                    conversationId,
                    userId,
                    title
                );


            if (
                !updatedConversation
            ) {
                return res
                    .status(
                        404
                    )
                    .json({
                        error:
                            "Conversation not found."
                    });
            }


            return res
                .status(
                    200
                )
                .json({
                    success:
                        true,

                    conversation:
                        updatedConversation
                });
        }


        return res
            .status(
                400
            )
            .json({
                error:
                    "Invalid history action."
            });


    } catch (
        error
    ) {
        console.error(
            "History API error:",
            {
                message:
                    error?.message,

                code:
                    error?.code
            }
        );


        if (
            error?.message ===
            "INVALID_TITLE"
        ) {
            return res
                .status(
                    400
                )
                .json({
                    error:
                        "A valid conversation title is required."
                });
        }


        return res
            .status(
                500
            )
            .json({
                error:
                    "Unable to process conversation history. Please try again."
            });
    }
}
