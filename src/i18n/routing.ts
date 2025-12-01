/**
 * i18n Routing Configuration
 * Configures locale routing and provides type-safe navigation utilities
 */

import { createNavigation } from "next-intl/navigation";
import { defineRouting } from "next-intl/routing";
import { defaultLocale, locales } from "./config";

// Define routing configuration for next-intl
export const routing = defineRouting({
  // All supported locales
  locales,

  // Default locale (used when no locale prefix is present)
  defaultLocale,

  // Locale detection strategy:
  // 1. Check locale cookie (NEXT_LOCALE)
  // 2. Check Accept-Language header
  // 3. Fall back to default locale
  localePrefix: "always",

  // Locale cookie configuration
  localeCookie: {
    name: "NEXT_LOCALE",
    // Cookie expires in 1 year
    maxAge: 365 * 24 * 60 * 60,
    // Available across the entire site
    path: "/",
    // SameSite to prevent CSRF
    sameSite: "lax",
  },
});

// Type-safe navigation utilities
// These replace Next.js's default Link, redirect, useRouter, usePathname
// with locale-aware versions that automatically prepend the locale prefix
export const { Link, redirect, useRouter, usePathname } = createNavigation(routing);

// Re-export routing type for use in other files
export type Routing = typeof routing;
