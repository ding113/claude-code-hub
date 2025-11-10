/**
 * i18n Configuration
 * Defines supported locales and default locale for the application
 */

// Supported locales in the application
export const locales = ["zh-CN", "zh-TW", "en", "ru", "ja"] as const;

// TypeScript type for locale
export type Locale = (typeof locales)[number];

// Default locale (Chinese Simplified)
export const defaultLocale: Locale = "zh-CN";

// Locale labels for language switcher UI
export const localeLabels: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁体中文",
  en: "English",
  ru: "Русский",
  ja: "日本語",
};

// Locale names in English (for metadata, SEO)
export const localeNamesInEnglish: Record<Locale, string> = {
  "zh-CN": "Chinese (Simplified)",
  "zh-TW": "Chinese (Traditional)",
  en: "English",
  ru: "Russian",
  ja: "Japanese",
};
