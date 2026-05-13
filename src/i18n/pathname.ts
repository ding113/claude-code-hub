import { type Locale, locales } from "./config";

const DEFAULT_INTERNAL_PATH = "/dashboard";
const PROTOCOL_LIKE_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function isLocale(value: string): value is Locale {
  return locales.some((locale) => locale === value);
}

function normalizeFallback(fallback: string): string {
  const candidate = fallback.trim();

  if (!candidate?.startsWith("/") || candidate.startsWith("//")) {
    return DEFAULT_INTERNAL_PATH;
  }

  return candidate === "/" ? DEFAULT_INTERNAL_PATH : candidate;
}

export function getLocaleFromValue(value: string | null | undefined): Locale | null {
  if (!value) return null;

  const candidate = value.trim();
  return isLocale(candidate) ? candidate : null;
}

export function normalizePathnameForLocaleNavigation(
  pathname: string | null | undefined,
  fallback = DEFAULT_INTERNAL_PATH
): string {
  const safeFallback = normalizeFallback(fallback);
  const candidate = pathname?.trim() ?? "";

  if (!candidate?.startsWith("/") || candidate.startsWith("//")) {
    return safeFallback;
  }

  if (PROTOCOL_LIKE_PATTERN.test(candidate) || PROTOCOL_LIKE_PATTERN.test(candidate.slice(1))) {
    return safeFallback;
  }

  const suffixStart = candidate.search(/[?#]/);
  let path = suffixStart === -1 ? candidate : candidate.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : candidate.slice(suffixStart);

  while (true) {
    const localeMatch = path.match(/^\/([^/]+)(?=\/|$)/);
    const locale = localeMatch?.[1];

    if (!locale || !isLocale(locale)) {
      break;
    }

    path = path.slice(locale.length + 1) || "/";
  }

  if (path === "/") {
    return `${safeFallback}${suffix}`;
  }

  if (!path.startsWith("/") || path.startsWith("//") || PROTOCOL_LIKE_PATTERN.test(path.slice(1))) {
    return safeFallback;
  }

  return `${path}${suffix}`;
}
