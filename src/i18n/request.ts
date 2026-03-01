/**
 * i18n Request Configuration
 * Configures how translations are loaded for each request
 */

import { getRequestConfig } from "next-intl/server";
import { isValidIANATimezone } from "@/lib/utils/timezone";
import type { Locale } from "./config";
import { routing } from "./routing";

function resolveEnvTimezone(): string {
  const tz = process.env.TZ?.trim();
  return tz && isValidIANATimezone(tz) ? tz : "UTC";
}

async function resolveRequestTimezone(): Promise<string> {
  const fallback = resolveEnvTimezone();

  // Edge runtime 无法访问数据库/Redis，直接使用 env/UTC
  if (process.env.NEXT_RUNTIME === "edge") {
    return fallback;
  }

  try {
    const { resolveSystemTimezone } = await import("@/lib/utils/timezone.server");
    return await resolveSystemTimezone();
  } catch {
    return fallback;
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  // This typically corresponds to the `[locale]` segment in the app directory
  let locale = await requestLocale;

  // Ensure that the incoming locale is valid
  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale;
  }

  // Dynamically import all translation files for the current locale
  // NOTE: This import expects each `messages/<locale>/index.ts` to default-export the full messages object.
  // The `settings` namespace is composed by `messages/<locale>/settings/index.ts` so key paths stay stable.
  const messages = await import(`../../messages/${locale}`).then((module) => module.default);

  const timeZone = await resolveRequestTimezone();

  return {
    locale,
    messages,
    timeZone,
    now: new Date(),
    // Optional: Enable runtime warnings for missing translations in development
    onError:
      process.env.NODE_ENV === "development"
        ? (error) => {
            console.error("i18n error:", error);
          }
        : undefined,
    // Optional: Configure what happens when a translation is missing
    getMessageFallback: ({ namespace, key }) => {
      return `${namespace}.${key}`;
    },
  };
});
