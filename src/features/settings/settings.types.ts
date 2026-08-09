/* =========================================================
   NEYO SETTINGS — TYPES
   File: src/features/settings/settings.types.ts

   Purpose:
   - Strongly typed settings values
   - Shared contract for store + UI
   - Prevent invalid values at compile time
   ========================================================= */

export type NeyoTheme =
  | "system"
  | "light"
  | "dark";

export type NeyoInterfaceMode =
  | "minimal"
  | "warm"
  | "glass";

export type NeyoIntelligence =
  | "standard"
  | "maximum";

export type NeyoLanguage =
  | "auto"
  | "english"
  | "urdu"
  | "roman-urdu";

export type NeyoPersonality =
  | "neyo"
  | "zadi"
  | "wizi";

export type NeyoOpenOn =
  | "new-chat"
  | "last-chat";

export type NeyoTextSize =
  | "small"
  | "default"
  | "large";

export type NeyoContentWidth =
  | "compact"
  | "balanced"
  | "wide";

export type NeyoSidebarDensity =
  | "compact"
  | "comfortable";

export type NeyoMotion =
  | "on"
  | "reduced";

/*
 * Accent supports:
 * - named presets
 * - custom hex color
 */

export type NeyoAccentPreset =
  | "neutral"
  | "blue"
  | "emerald"
  | "violet";

export type NeyoAccent =
  | NeyoAccentPreset
  | `#${string}`;


/* =========================================================
   MAIN SETTINGS MODEL
   ========================================================= */

export interface NeyoSettings {
  theme: NeyoTheme;

  interface: NeyoInterfaceMode;

  intelligence: NeyoIntelligence;

  privateChat: boolean;

  language: NeyoLanguage;

  defaultPersonality: NeyoPersonality;

  openOn: NeyoOpenOn;

  autoSaveDrafts: boolean;

  accent: NeyoAccent;

  textSize: NeyoTextSize;

  contentWidth: NeyoContentWidth;

  sidebarDensity: NeyoSidebarDensity;

  motion: NeyoMotion;
}


/* =========================================================
   SETTINGS KEYS
   ========================================================= */

export type NeyoSettingKey =
  keyof NeyoSettings;


/* =========================================================
   GENERIC SETTING VALUE
   Useful for reusable controls.
   ========================================================= */

export type NeyoSettingValue<
  K extends NeyoSettingKey
> = NeyoSettings[K];


/* =========================================================
   SELECT OPTION
   Shared by segmented controls / dropdowns.
   ========================================================= */

export interface NeyoSettingOption<
  T extends string = string
> {
  value: T;
  label: string;
  description?: string;
}


/* =========================================================
   ACCENT OPTION
   ========================================================= */

export interface NeyoAccentOption {
  value: NeyoAccentPreset;
  label: string;
  color: string;
}


/* =========================================================
   STORAGE MAP TYPE
   Keeps localStorage keys strongly typed.
   ========================================================= */

export type NeyoSettingsStorageMap = {
  [K in NeyoSettingKey]: string;
};
