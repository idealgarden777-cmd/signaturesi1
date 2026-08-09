/* =========================================================
   NEYO SETTINGS — STORE
   File: src/features/settings/settings.store.ts

   Purpose:
   - Centralized settings state
   - Preserve legacy neo_* localStorage keys
   - Validate persisted values
   - Support custom accent colors
   - Safe incremental migration from neo.js
   ========================================================= */

import { create } from "zustand";

import type {
  NeyoAccent,
  NeyoContentWidth,
  NeyoInterfaceMode,
  NeyoIntelligence,
  NeyoLanguage,
  NeyoMotion,
  NeyoOpenOn,
  NeyoPersonality,
  NeyoSettingKey,
  NeyoSettings,
  NeyoSettingsStorageMap,
  NeyoSidebarDensity,
  NeyoTextSize,
  NeyoTheme,
} from "./settings.types";


/* =========================================================
   DEFAULTS
   ========================================================= */

export const DEFAULT_SETTINGS: NeyoSettings = {
  theme: "system",

  interface: "minimal",

  intelligence: "standard",

  privateChat: false,

  language: "auto",

  defaultPersonality: "neyo",

  openOn: "new-chat",

  autoSaveDrafts: true,

  accent: "neutral",

  textSize: "default",

  contentWidth: "balanced",

  sidebarDensity: "comfortable",

  motion: "on",
};


/* =========================================================
   LEGACY STORAGE KEYS

   IMPORTANT:
   These must remain compatible with the current NEYO app.
   ========================================================= */

export const SETTINGS_STORAGE_KEYS: NeyoSettingsStorageMap = {
  theme: "neo_theme",

  interface: "neo_interface",

  intelligence: "neo_intelligence",

  privateChat: "neo_private_chat",

  language: "neo_language",

  defaultPersonality:
    "neo_default_personality",

  openOn: "neo_open_on",

  autoSaveDrafts:
    "neo_auto_save_drafts",

  accent: "neo_accent",

  textSize: "neo_text_size",

  contentWidth:
    "neo_content_width",

  sidebarDensity:
    "neo_sidebar_density",

  motion: "neo_motion",
};


/* =========================================================
   VALID VALUES
   ========================================================= */

const VALID_THEMES: readonly NeyoTheme[] = [
  "system",
  "light",
  "dark",
];

const VALID_INTERFACES: readonly NeyoInterfaceMode[] = [
  "minimal",
  "warm",
  "glass",
];

const VALID_INTELLIGENCE: readonly NeyoIntelligence[] = [
  "standard",
  "maximum",
];

const VALID_LANGUAGES: readonly NeyoLanguage[] = [
  "auto",
  "english",
  "urdu",
  "roman-urdu",
];

const VALID_PERSONALITIES: readonly NeyoPersonality[] = [
  "neyo",
  "zadi",
  "wizi",
];

const VALID_OPEN_ON: readonly NeyoOpenOn[] = [
  "new-chat",
  "last-chat",
];

const VALID_TEXT_SIZES: readonly NeyoTextSize[] = [
  "small",
  "default",
  "large",
];

const VALID_CONTENT_WIDTHS: readonly NeyoContentWidth[] = [
  "compact",
  "balanced",
  "wide",
];

const VALID_SIDEBAR_DENSITIES: readonly NeyoSidebarDensity[] = [
  "compact",
  "comfortable",
];

const VALID_MOTION: readonly NeyoMotion[] = [
  "on",
  "reduced",
];

const VALID_ACCENT_PRESETS = [
  "neutral",
  "blue",
  "emerald",
  "violet",
] as const;


/* =========================================================
   HELPERS
   ========================================================= */

function hasLocalStorage(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined"
  );
}


function isBooleanStorageValue(
  value: string | null
): boolean {
  return (
    value === "true" ||
    value === "false" ||
    value === "on" ||
    value === "off"
  );
}


function parseBooleanPreference(
  value: string | null,
  fallback: boolean
): boolean {
  if (!isBooleanStorageValue(value)) {
    return fallback;
  }

  return (
    value === "true" ||
    value === "on"
  );
}


export function isValidHexColor(
  value: unknown
): value is `#${string}` {
  return (
    typeof value === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(value)
  );
}


function isAccentValue(
  value: unknown
): value is NeyoAccent {
  return (
    (
      typeof value === "string" &&
      VALID_ACCENT_PRESETS.includes(
        value as typeof VALID_ACCENT_PRESETS[number]
      )
    ) ||
    isValidHexColor(value)
  );
}


function includesValue<T extends string>(
  values: readonly T[],
  value: unknown
): value is T {
  return (
    typeof value === "string" &&
    values.includes(value as T)
  );
}


/* =========================================================
   STORAGE READ
   ========================================================= */

function readSetting<K extends NeyoSettingKey>(
  key: K
): NeyoSettings[K] {
  const fallback =
    DEFAULT_SETTINGS[key];

  if (!hasLocalStorage()) {
    return fallback;
  }

  const storageKey =
    SETTINGS_STORAGE_KEYS[key];

  const raw =
    window.localStorage.getItem(
      storageKey
    );

  if (raw === null) {
    return fallback;
  }


  switch (key) {
    case "theme":
      return (
        includesValue(
          VALID_THEMES,
          raw
        )
          ? raw
          : fallback
      ) as NeyoSettings[K];


    case "interface":
      return (
        includesValue(
          VALID_INTERFACES,
          raw
        )
          ? raw
          : fallback
      ) as NeyoSettings[K];


    case "intelligence":
      return (
        includesValue(
          VALID_INTELLIGENCE,
          raw
        )
          ? raw
          : fallback
      ) as NeyoSettings[K];


    case "privateChat":
      return parseBooleanPreference(
        raw,
        DEFAULT_SETTINGS.privateChat
      ) as NeyoSettings[K];


    case "language":
      return (
        includesValue(
          VALID_LANGUAGES,
          raw
        )
          ? raw
          : fallback
      ) as NeyoSettings[K];


    case "defaultPersonality":
      return (
        includesValue(
          VALID_PERSONALITIES,
          raw
        )
          ? raw
          : fallback
      ) as NeyoSettings[K];


    case "openOn":
      return (
        includesValue(
          VALID_OPEN_ON,
          raw
        )
          ? raw
          : fallback
      ) as NeyoSettings[K];


    case "autoSaveDrafts":
      return parseBooleanPreference(
        raw,
        DEFAULT_SETTINGS.autoSaveDrafts
      ) as NeyoSettings[K];


    case "accent":
      return (
        isAccentValue(raw)
          ? raw
          : fallback
      ) as NeyoSettings[K];


    case "textSize":
      return (
        includesValue(
          VALID_TEXT_SIZES,
          raw
        )
          ? raw
          : fallback
      ) as NeyoSettings[K];


    case "contentWidth":
      return (
        includesValue(
          VALID_CONTENT_WIDTHS,
          raw
        )
          ? raw
          : fallback
      ) as NeyoSettings[K];


    case "sidebarDensity":
      return (
        includesValue(
          VALID_SIDEBAR_DENSITIES,
          raw
        )
          ? raw
          : fallback
      ) as NeyoSettings[K];


    case "motion":
      return (
        includesValue(
          VALID_MOTION,
          raw
        )
          ? raw
          : fallback
      ) as NeyoSettings[K];


    default:
      return fallback;
  }
}


/* =========================================================
   LOAD COMPLETE SETTINGS
   ========================================================= */

export function loadSettings(): NeyoSettings {
  return {
    theme:
      readSetting("theme"),

    interface:
      readSetting("interface"),

    intelligence:
      readSetting("intelligence"),

    privateChat:
      readSetting("privateChat"),

    language:
      readSetting("language"),

    defaultPersonality:
      readSetting(
        "defaultPersonality"
      ),

    openOn:
      readSetting("openOn"),

    autoSaveDrafts:
      readSetting(
        "autoSaveDrafts"
      ),

    accent:
      readSetting("accent"),

    textSize:
      readSetting("textSize"),

    contentWidth:
      readSetting(
        "contentWidth"
      ),

    sidebarDensity:
      readSetting(
        "sidebarDensity"
      ),

    motion:
      readSetting("motion"),
  };
}


/* =========================================================
   STORAGE WRITE
   ========================================================= */

function writeSetting<K extends NeyoSettingKey>(
  key: K,
  value: NeyoSettings[K]
): void {
  if (!hasLocalStorage()) {
    return;
  }

  const storageKey =
    SETTINGS_STORAGE_KEYS[key];


  if (
    key === "privateChat" ||
    key === "autoSaveDrafts"
  ) {
    window.localStorage.setItem(
      storageKey,
      value ? "on" : "off"
    );

    return;
  }


  window.localStorage.setItem(
    storageKey,
    String(value)
  );
}


/* =========================================================
   VALIDATION
   ========================================================= */

export function validateSetting<
  K extends NeyoSettingKey
>(
  key: K,
  value: NeyoSettings[K]
): NeyoSettings[K] {
  switch (key) {
    case "theme":
      return (
        includesValue(
          VALID_THEMES,
          value
        )
          ? value
          : DEFAULT_SETTINGS.theme
      ) as NeyoSettings[K];


    case "interface":
      return (
        includesValue(
          VALID_INTERFACES,
          value
        )
          ? value
          : DEFAULT_SETTINGS.interface
      ) as NeyoSettings[K];


    case "intelligence":
      return (
        includesValue(
          VALID_INTELLIGENCE,
          value
        )
          ? value
          : DEFAULT_SETTINGS.intelligence
      ) as NeyoSettings[K];


    case "language":
      return (
        includesValue(
          VALID_LANGUAGES,
          value
        )
          ? value
          : DEFAULT_SETTINGS.language
      ) as NeyoSettings[K];


    case "defaultPersonality":
      return (
        includesValue(
          VALID_PERSONALITIES,
          value
        )
          ? value
          : DEFAULT_SETTINGS.defaultPersonality
      ) as NeyoSettings[K];


    case "openOn":
      return (
        includesValue(
          VALID_OPEN_ON,
          value
        )
          ? value
          : DEFAULT_SETTINGS.openOn
      ) as NeyoSettings[K];


    case "accent":
      return (
        isAccentValue(value)
          ? value
          : DEFAULT_SETTINGS.accent
      ) as NeyoSettings[K];


    case "textSize":
      return (
        includesValue(
          VALID_TEXT_SIZES,
          value
        )
          ? value
          : DEFAULT_SETTINGS.textSize
      ) as NeyoSettings[K];


    case "contentWidth":
      return (
        includesValue(
          VALID_CONTENT_WIDTHS,
          value
        )
          ? value
          : DEFAULT_SETTINGS.contentWidth
      ) as NeyoSettings[K];


    case "sidebarDensity":
      return (
        includesValue(
          VALID_SIDEBAR_DENSITIES,
          value
        )
          ? value
          : DEFAULT_SETTINGS.sidebarDensity
      ) as NeyoSettings[K];


    case "motion":
      return (
        includesValue(
          VALID_MOTION,
          value
        )
          ? value
          : DEFAULT_SETTINGS.motion
      ) as NeyoSettings[K];


    case "privateChat":
    case "autoSaveDrafts":
      return Boolean(
        value
      ) as NeyoSettings[K];


    default:
      return value;
  }
}


/* =========================================================
   STORE TYPES
   ========================================================= */

interface NeyoSettingsStore
  extends NeyoSettings {

  setSetting: <
    K extends NeyoSettingKey
  >(
    key: K,
    value: NeyoSettings[K]
  ) => void;

  resetSetting: (
    key: NeyoSettingKey
  ) => void;

  resetAll: () => void;

  reloadFromStorage: () => void;
}


/* =========================================================
   STORE
   ========================================================= */

export const useNeyoSettings =
  create<NeyoSettingsStore>(
    (set) => ({
      ...loadSettings(),


      setSetting: (
        key,
        value
      ) => {
        const safeValue =
          validateSetting(
            key,
            value
          );

        writeSetting(
          key,
          safeValue
        );

        set({
          [key]: safeValue,
        } as Partial<NeyoSettingsStore>);


        /*
         * Bridge event for the old
         * non-React NEYO app.
         *
         * During migration, neo.js
         * can listen to this later.
         */
        if (
          typeof window !==
          "undefined"
        ) {
          window.dispatchEvent(
            new CustomEvent(
              "neyo:settings-change",
              {
                detail: {
                  key,
                  value:
                    safeValue,
                },
              }
            )
          );
        }
      },


      resetSetting: (
        key
      ) => {
        const value =
          DEFAULT_SETTINGS[key];

        writeSetting(
          key,
          value
        );

        set({
          [key]: value,
        } as Partial<NeyoSettingsStore>);
      },


      resetAll: () => {
        const defaults = {
          ...DEFAULT_SETTINGS,
        };

        (
          Object.keys(
            defaults
          ) as NeyoSettingKey[]
        ).forEach(key => {
          writeSetting(
            key,
            defaults[key]
          );
        });

        set(defaults);
      },


      reloadFromStorage:
        () => {
          set(
            loadSettings()
          );
        },
    })
  );
