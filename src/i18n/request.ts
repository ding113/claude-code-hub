/**
 * i18n Request Configuration
 * Configures how translations are loaded for each request
 */

import { getRequestConfig } from "next-intl/server";
import type { Locale } from "./config";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  // This typically corresponds to the `[locale]` segment in the app directory
  let locale = await requestLocale;

  // Ensure that the incoming locale is valid
  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale;
  }

  // Dynamically import all translation files for the current locale
  const messages = await import(`../../messages/${locale}`).then((module) => module.default);

  return {
    locale,
    messages,
    // Optional: Configure date/time/number formatting
    // formats: {
    //   dateTime: {
    //     short: {
    //       day: 'numeric',
    //       month: 'short',
    //       year: 'numeric'
    //     }
    //   }
    // },
    // Optional: Configure time zone
    // timeZone: 'Asia/Shanghai',
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
