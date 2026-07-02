/**
 * i18n Request Configuration
 * Configures how translations are loaded for each request
 */

import { getRequestConfig, type RequestConfig } from "next-intl/server";
import { resolveSystemTimezone } from "@/lib/utils/timezone-resolver";
import type { Locale } from "./config";
import { routing } from "./routing";

type Messages = NonNullable<RequestConfig["messages"]>;

const messageLoaders: Record<Locale, () => Promise<Messages>> = {
  "zh-CN": () => import("../../messages/zh-CN").then((module) => module.default),
  "zh-TW": () => import("../../messages/zh-TW").then((module) => module.default),
  en: () => import("../../messages/en").then((module) => module.default),
  ru: () => import("../../messages/ru").then((module) => module.default),
  ja: () => import("../../messages/ja").then((module) => module.default),
};

export default getRequestConfig(async ({ requestLocale }) => {
  // This typically corresponds to the `[locale]` segment in the app directory
  let locale = await requestLocale;

  // Ensure that the incoming locale is valid
  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale;
  }

  // Each `messages/<locale>/index.ts` default-exports the full messages object.
  const [messages, timeZone] = await Promise.all([
    messageLoaders[locale as Locale](),
    resolveSystemTimezone(),
  ]);

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
