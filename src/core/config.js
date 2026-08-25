/**
 * =========================================================
 * NEYO BETA — CORE CONFIGURATION
 * =========================================================
 *
 * Owns:
 * - Public runtime configuration
 * - Environment validation
 * - App metadata
 * - Client-safe feature flags
 * - Shared limits
 *
 * Does NOT own:
 * - Secret API keys
 * - Server-only credentials
 * - Authentication state
 * - User preferences
 * - Feature business logic
 *
 * IMPORTANT:
 * Anything exposed through VITE_* is visible in the browser.
 * Never place private service-role keys or provider secrets here.
 * =========================================================
 */

const env = import.meta.env;

/* =========================================================
   HELPERS
   ========================================================= */

const readString = (key, fallback = "") => {
  const value = env[key];

  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim() || fallback;
};

const readBoolean = (key, fallback = false) => {
  const value = env[key];

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
};

const readNumber = (key, fallback) => {
  const value = Number(env[key]);

  return Number.isFinite(value) ? value : fallback;
};

const freeze = (value) => Object.freeze(value);

/* =========================================================
   ENVIRONMENT
   ========================================================= */

const MODE = env.MODE || "development";

const IS_DEV = Boolean(env.DEV);
const IS_PROD = Boolean(env.PROD);

/* =========================================================
   APPLICATION
   ========================================================= */

const app = freeze({
  name: "Neyo",
  productName: "Neyo Beta",

  version:
    typeof __APP_VERSION__ !== "undefined"
      ? __APP_VERSION__
      : "2.0.0-beta.1",

  mode:
    typeof __BUILD_MODE__ !== "undefined"
      ? __BUILD_MODE__
      : MODE,

  isDev: IS_DEV,
  isProd: IS_PROD,

  baseUrl: env.BASE_URL || "/"
});

/* =========================================================
   SUPABASE
   ========================================================= */

const supabase = freeze({
  url: readString("VITE_SUPABASE_URL"),
  anonKey: readString("VITE_SUPABASE_ANON_KEY")
});

/* =========================================================
   API
   ========================================================= */

const api = freeze({
  baseUrl: readString("VITE_API_BASE_URL", "/api"),

  timeoutMs: readNumber(
    "VITE_API_TIMEOUT_MS",
    60_000
  ),

  streamTimeoutMs: readNumber(
    "VITE_STREAM_TIMEOUT_MS",
    180_000
  )
});

/* =========================================================
   CHAT
   ========================================================= */

const chat = freeze({
  maxMessageLength: readNumber(
    "VITE_MAX_MESSAGE_LENGTH",
    50_000
  ),

  maxHistoryMessages: readNumber(
    "VITE_MAX_HISTORY_MESSAGES",
    50
  ),

  maxRegenerationAttempts: 3,

  defaultModel: readString(
    "VITE_DEFAULT_MODEL",
    "gemini-3.1-flash-lite"
  )
});

/* =========================================================
   ATTACHMENTS
   ========================================================= */

const attachments = freeze({
  maxFiles: readNumber(
    "VITE_MAX_ATTACHMENTS",
    5
  ),

  maxFileSizeMb: readNumber(
    "VITE_MAX_FILE_SIZE_MB",
    25
  ),

  maxTotalSizeMb: readNumber(
    "VITE_MAX_TOTAL_ATTACHMENT_SIZE_MB",
    100
  ),

  acceptedMimeTypes: freeze([
    "application/pdf",

    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

    "application/vnd.ms-excel",

    "text/plain",
    "text/csv",
    "text/markdown",

    "application/json",

    "application/zip",

    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
  ])
});

/* =========================================================
   VOICE
   ========================================================= */

const voice = freeze({
  enabled: readBoolean(
    "VITE_ENABLE_VOICE",
    true
  ),

  maxRecordingSeconds: readNumber(
    "VITE_MAX_RECORDING_SECONDS",
    300
  )
});

/* =========================================================
   FEATURES
   ========================================================= */

const features = freeze({
  attachments: readBoolean(
    "VITE_ENABLE_ATTACHMENTS",
    true
  ),

  voice: readBoolean(
    "VITE_ENABLE_VOICE",
    true
  ),

  mascot: readBoolean(
    "VITE_ENABLE_MASCOT",
    true
  ),

  characters: readBoolean(
    "VITE_ENABLE_CHARACTERS",
    true
  ),

  research: readBoolean(
    "VITE_ENABLE_RESEARCH",
    true
  ),

  memory: readBoolean(
    "VITE_ENABLE_MEMORY",
    true
  )
});

/* =========================================================
   UI
   ========================================================= */

const ui = freeze({
  mobileBreakpoint: 768,

  sidebarBreakpoint: 1024,

  animationDurationMs: 200,

  toastDurationMs: 4_000
});

/* =========================================================
   VALIDATION
   ========================================================= */

const validateConfig = () => {
  const errors = [];

  if (!supabase.url) {
    errors.push(
      "Missing VITE_SUPABASE_URL"
    );
  }

  if (!supabase.anonKey) {
    errors.push(
      "Missing VITE_SUPABASE_ANON_KEY"
    );
  }

  if (chat.maxMessageLength <= 0) {
    errors.push(
      "VITE_MAX_MESSAGE_LENGTH must be greater than 0"
    );
  }

  if (attachments.maxFiles <= 0) {
    errors.push(
      "VITE_MAX_ATTACHMENTS must be greater than 0"
    );
  }

  if (attachments.maxFileSizeMb <= 0) {
    errors.push(
      "VITE_MAX_FILE_SIZE_MB must be greater than 0"
    );
  }

  return errors;
};

/* =========================================================
   PUBLIC CONFIG
   ========================================================= */

export const config = freeze({
  app,
  api,
  supabase,
  chat,
  attachments,
  voice,
  features,
  ui
});

/* =========================================================
   CONFIG ASSERTION
   ========================================================= */

export const assertConfig = () => {
  const errors = validateConfig();

  if (!errors.length) {
    return true;
  }

  const message = [
    "[Neyo] Invalid application configuration:",
    ...errors.map((error) => `- ${error}`)
  ].join("\n");

  if (IS_DEV) {
    console.error(message);
  }

  throw new Error(message);
};

/* =========================================================
   UTILITIES
   ========================================================= */

export const getConfig = () => config;

export const isFeatureEnabled = (feature) => {
  return config.features[feature] === true;
};

export default config;
