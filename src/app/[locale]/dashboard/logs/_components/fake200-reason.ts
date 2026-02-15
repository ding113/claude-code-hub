// Shared mapping from internal FAKE_200_* error codes to i18n suffix keys.
// These codes represent: upstream returned 2xx but the body looks like an error page / error JSON.
// UI-only: does not participate in detection logic.

const FAKE_200_REASON_KEYS: Record<string, string> = {
  FAKE_200_EMPTY_BODY: "emptyBody",
  FAKE_200_HTML_BODY: "htmlBody",
  FAKE_200_JSON_ERROR_NON_EMPTY: "jsonErrorNonEmpty",
  FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY: "jsonErrorMessageNonEmpty",
  FAKE_200_JSON_MESSAGE_KEYWORD_MATCH: "jsonMessageKeywordMatch",
};

export function getFake200ReasonKey(code: string, prefix: string): string {
  return `${prefix}.${FAKE_200_REASON_KEYS[code] ?? "unknown"}`;
}
