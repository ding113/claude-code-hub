/**
 * i18n Module Exports
 * Central export point for all i18n utilities
 */

// Configuration
export { locales, defaultLocale, localeLabels, localeNamesInEnglish, type Locale } from "./config";

// Routing and navigation
export { routing, Link, redirect, useRouter, usePathname, type Routing } from "./routing";

// Request configuration (for use in next.config.ts)
export { default as getRequestConfig } from "./request";
