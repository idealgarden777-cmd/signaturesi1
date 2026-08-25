/**
 * =========================================================
 * NEYO BETA — CORE CONSTANTS
 * =========================================================
 *
 * Owns:
 * - Stable application-wide constants
 * - Event names
 * - Route names
 * - Storage keys
 * - UI states
 * - Chat roles/statuses
 * - Attachment categories
 *
 * Does NOT own:
 * - Environment variables
 * - User preferences
 * - Runtime state
 * - API secrets
 * - Feature logic
 *
 * Keep this file:
 * - dependency-free
 * - side-effect-free
 * - immutable
 * =========================================================
 */

const freeze = (value) => Object.freeze(value);

/* =========================================================
   APP
   ========================================================= */

export const APP = freeze({
  NAME: "Neyo",
  PRODUCT: "Neyo Beta",
  STORAGE_NAMESPACE: "neyo",
  DATA_ATTRIBUTE_PREFIX: "neyo"
});

/* =========================================================
   CHAT ROLES
   ========================================================= */

export const CHAT_ROLE = freeze({
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system"
});

/* =========================================================
   MESSAGE STATUS
   ========================================================= */

export const MESSAGE_STATUS = freeze({
  PENDING: "pending",
  STREAMING: "streaming",
  COMPLETE: "complete",
  STOPPED: "stopped",
  ERROR: "error"
});

/* =========================================================
   CONVERSATION STATUS
   ========================================================= */

export const CONVERSATION_STATUS = freeze({
  IDLE: "idle",
  SENDING: "sending",
  STREAMING: "streaming",
  STOPPING: "stopping",
  ERROR: "error"
});

/* =========================================================
   COMPOSER STATE
   ========================================================= */

export const COMPOSER_STATE = freeze({
  IDLE: "idle",
  TYPING: "typing",
  READY: "ready",
  SENDING: "sending",
  DISABLED: "disabled"
});

/* =========================================================
   ATTACHMENT STATUS
   ========================================================= */

export const ATTACHMENT_STATUS = freeze({
  QUEUED: "queued",
  VALIDATING: "validating",
  UPLOADING: "uploading",
  PROCESSING: "processing",
  READY: "ready",
  ERROR: "error",
  REMOVED: "removed"
});

/* =========================================================
   ATTACHMENT TYPES
   ========================================================= */

export const ATTACHMENT_TYPE = freeze({
  IMAGE: "image",
  PDF: "pdf",
  DOCUMENT: "document",
  SPREADSHEET: "spreadsheet",
  TEXT: "text",
  ARCHIVE: "archive",
  UNKNOWN: "unknown"
});

/* =========================================================
   FILE EXTENSIONS
   ========================================================= */

export const FILE_EXTENSION = freeze({
  IMAGE: freeze([
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif"
  ]),

  PDF: freeze([
    "pdf"
  ]),

  DOCUMENT: freeze([
    "doc",
    "docx"
  ]),

  SPREADSHEET: freeze([
    "xls",
    "xlsx",
    "csv"
  ]),

  TEXT: freeze([
    "txt",
    "md",
    "json"
  ]),

  ARCHIVE: freeze([
    "zip"
  ])
});

/* =========================================================
   MIME TYPES
   ========================================================= */

export const MIME = freeze({
  PDF: "application/pdf",

  DOCX:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

  XLSX:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

  XLS:
    "application/vnd.ms-excel",

  ZIP:
    "application/zip",

  JSON:
    "application/json",

  TEXT:
    "text/plain",

  CSV:
    "text/csv",

  MARKDOWN:
    "text/markdown",

  JPEG:
    "image/jpeg",

  PNG:
    "image/png",

  WEBP:
    "image/webp",

  GIF:
    "image/gif"
});

/* =========================================================
   HTTP
   ========================================================= */

export const HTTP_METHOD = freeze({
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE"
});

export const HTTP_STATUS = freeze({
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,

  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,

  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
});

/* =========================================================
   API ERROR CODES
   ========================================================= */

export const ERROR_CODE = freeze({
  UNKNOWN: "UNKNOWN_ERROR",

  NETWORK: "NETWORK_ERROR",
  TIMEOUT: "REQUEST_TIMEOUT",
  ABORTED: "REQUEST_ABORTED",

  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",

  INVALID_INPUT: "INVALID_INPUT",

  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  FILE_TYPE_UNSUPPORTED: "FILE_TYPE_UNSUPPORTED",
  TOO_MANY_ATTACHMENTS: "TOO_MANY_ATTACHMENTS",

  CHAT_FAILED: "CHAT_FAILED",
  STREAM_FAILED: "STREAM_FAILED",

  AUTH_FAILED: "AUTH_FAILED",

  CONFIG_INVALID: "CONFIG_INVALID"
});

/* =========================================================
   APP EVENTS
   ========================================================= */

export const APP_EVENT = freeze({
  READY: "neyo:app:ready",
  ERROR: "neyo:app:error",

  AUTH_CHANGED: "neyo:auth:changed",

  CHAT_CREATED: "neyo:chat:created",
  CHAT_CHANGED: "neyo:chat:changed",
  CHAT_DELETED: "neyo:chat:deleted",

  MESSAGE_CREATED: "neyo:message:created",
  MESSAGE_UPDATED: "neyo:message:updated",
  MESSAGE_DELETED: "neyo:message:deleted",

  SEND_STARTED: "neyo:send:started",
  SEND_COMPLETED: "neyo:send:completed",
  SEND_STOPPED: "neyo:send:stopped",
  SEND_FAILED: "neyo:send:failed",

  STREAM_STARTED: "neyo:stream:started",
  STREAM_CHUNK: "neyo:stream:chunk",
  STREAM_COMPLETED: "neyo:stream:completed",
  STREAM_FAILED: "neyo:stream:failed",

  ATTACHMENT_ADDED: "neyo:attachment:added",
  ATTACHMENT_UPDATED: "neyo:attachment:updated",
  ATTACHMENT_REMOVED: "neyo:attachment:removed",

  MODEL_CHANGED: "neyo:model:changed",

  VOICE_STARTED: "neyo:voice:started",
  VOICE_STOPPED: "neyo:voice:stopped",

  SIDEBAR_CHANGED: "neyo:sidebar:changed",

  THEME_CHANGED: "neyo:theme:changed"
});

/* =========================================================
   STORAGE KEYS
   ========================================================= */

export const STORAGE_KEY = freeze({
  THEME: "neyo:theme",

  SIDEBAR_STATE: "neyo:sidebar",

  SELECTED_MODEL: "neyo:selected-model",

  SELECTED_CHARACTER: "neyo:selected-character",

  DRAFT_PREFIX: "neyo:draft:",

  LAST_CONVERSATION: "neyo:last-conversation",

  SETTINGS: "neyo:settings"
});

/* =========================================================
   THEME
   ========================================================= */

export const THEME = freeze({
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark"
});

/* =========================================================
   SIDEBAR
   ========================================================= */

export const SIDEBAR_STATE = freeze({
  OPEN: "open",
  CLOSED: "closed"
});

/* =========================================================
   DEVICE
   ========================================================= */

export const DEVICE_TYPE = freeze({
  MOBILE: "mobile",
  TABLET: "tablet",
  DESKTOP: "desktop"
});

/* =========================================================
   KEYBOARD
   ========================================================= */

export const KEY = freeze({
  ENTER: "Enter",
  ESCAPE: "Escape",

  ARROW_UP: "ArrowUp",
  ARROW_DOWN: "ArrowDown",
  ARROW_LEFT: "ArrowLeft",
  ARROW_RIGHT: "ArrowRight",

  TAB: "Tab",
  SPACE: " "
});

/* =========================================================
   DOM
   ========================================================= */

export const DOM_EVENT = freeze({
  CLICK: "click",
  INPUT: "input",
  CHANGE: "change",
  SUBMIT: "submit",

  KEYDOWN: "keydown",
  KEYUP: "keyup",

  FOCUS: "focus",
  BLUR: "blur",

  PASTE: "paste",
  DROP: "drop",
  DRAG_OVER: "dragover",

  RESIZE: "resize",
  SCROLL: "scroll"
});

/* =========================================================
   UI
   ========================================================= */

export const UI_STATE = freeze({
  HIDDEN: "hidden",
  VISIBLE: "visible",
  ACTIVE: "active",
  DISABLED: "disabled",
  LOADING: "loading",
  ERROR: "error"
});

/* =========================================================
   TOAST
   ========================================================= */

export const TOAST_TYPE = freeze({
  INFO: "info",
  SUCCESS: "success",
  WARNING: "warning",
  ERROR: "error"
});

/* =========================================================
   MODAL
   ========================================================= */

export const MODAL = freeze({
  SETTINGS: "settings",
  PROFILE: "profile",
  MODEL_PICKER: "model-picker",
  CHARACTER_PICKER: "character-picker",
  SHARE: "share",
  DELETE_CONFIRMATION: "delete-confirmation"
});

/* =========================================================
   ROUTES / VIEWS
   ========================================================= */

export const VIEW = freeze({
  CHAT: "chat",
  SETTINGS: "settings",
  PROFILE: "profile"
});

/* =========================================================
   REQUEST
   ========================================================= */

export const REQUEST_STATE = freeze({
  IDLE: "idle",
  LOADING: "loading",
  SUCCESS: "success",
  ERROR: "error"
});

/* =========================================================
   DEFAULT VALUES
   ========================================================= */

export const DEFAULTS = freeze({
  CHAT_TITLE: "New chat",
  USER_NAME: "You",
  ASSISTANT_NAME: "Neyo",

  EMPTY_MESSAGE: "",

  UNTITLED_FILE: "Untitled",

  LANGUAGE: "en",

  SCROLL_BEHAVIOR: "smooth"
});

/* =========================================================
   REGEX
   ========================================================= */

export const REGEX = freeze({
  EMAIL:
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,

  UUID:
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,

  WHITESPACE:
    /\s+/g,

  FILE_EXTENSION:
    /\.([a-z0-9]+)$/i
});

/* =========================================================
   TIME
   ========================================================= */

export const TIME = freeze({
  SECOND: 1_000,
  MINUTE: 60_000,
  HOUR: 3_600_000,

  TYPING_DEBOUNCE: 150,

  SEARCH_DEBOUNCE: 250,

  DOUBLE_CLICK_WINDOW: 300
});

/* =========================================================
   PUBLIC CONSTANT COLLECTION
   ========================================================= */

export const constants = freeze({
  APP,

  CHAT_ROLE,
  MESSAGE_STATUS,
  CONVERSATION_STATUS,
  COMPOSER_STATE,

  ATTACHMENT_STATUS,
  ATTACHMENT_TYPE,
  FILE_EXTENSION,
  MIME,

  HTTP_METHOD,
  HTTP_STATUS,
  ERROR_CODE,

  APP_EVENT,

  STORAGE_KEY,

  THEME,
  SIDEBAR_STATE,
  DEVICE_TYPE,

  KEY,
  DOM_EVENT,

  UI_STATE,
  TOAST_TYPE,
  MODAL,
  VIEW,

  REQUEST_STATE,

  DEFAULTS,
  REGEX,
  TIME
});

export default constants;
