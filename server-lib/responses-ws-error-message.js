"use strict";

const { createTranslator } = require("next-intl");

// Keep in sync with src/i18n/config.ts. This entry runs outside the Next
// request context and cannot import TypeScript or next-intl/server.
const locales = ["zh-CN", "zh-TW", "en", "ru", "ja"];
const defaultLocale = "zh-CN";
const translators = new Map(
  locales.map((locale) => [
    locale,
    createTranslator({ locale, messages: require(`../messages/${locale}/errors.json`) }),
  ])
);

function findLocale(value) {
  return locales.find((locale) => locale.toLowerCase() === value.toLowerCase());
}

function resolveWsErrorLocale(headers = {}) {
  const cookie = typeof headers.cookie === "string" ? headers.cookie : "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== "NEXT_LOCALE") continue;
    try {
      const locale = findLocale(decodeURIComponent(part.slice(separator + 1).trim()));
      if (locale) return locale;
    } catch {
      // A malformed cookie must not prevent a terminal error response.
    }
  }

  const acceptLanguage =
    typeof headers["accept-language"] === "string" ? headers["accept-language"] : "";
  const languages = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return { tag: tag.trim(), weight: quality ? Number(quality.trim().slice(2)) : 1 };
    })
    .filter(({ weight }) => Number.isFinite(weight) && weight > 0 && weight <= 1)
    .sort((a, b) => b.weight - a.weight);
  for (const { tag } of languages) {
    const locale = findLocale(tag) || findLocale(tag.split("-")[0]);
    if (locale) return locale;
  }
  return defaultLocale;
}

function formatWsPayloadTooLargeMessage(headers, bytes, limitBytes) {
  const locale = resolveWsErrorLocale(headers);
  return translators.get(locale)("RESPONSES_WS_REQUEST_TOO_LARGE", {
    actualMiB: (bytes / (1024 * 1024)).toFixed(2),
    limitMiB: (limitBytes / (1024 * 1024)).toFixed(2),
  });
}

module.exports = { resolveWsErrorLocale, formatWsPayloadTooLargeMessage };
