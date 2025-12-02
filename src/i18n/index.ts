/**
 * i18n Module Exports
 * Central export point for all i18n utilities
 */

// Configuration
export { defaultLocale, type Locale, localeLabels, localeNamesInEnglish, locales } from "./config";
// Request configuration (for use in next.config.ts)
export { default as getRequestConfig } from "./request";
// Routing and navigation
export { Link, type Routing, redirect, routing, usePathname, useRouter } from "./routing";
