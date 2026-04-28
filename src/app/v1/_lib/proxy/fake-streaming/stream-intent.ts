import type { ClientFormat } from "../format-mapper";

export interface StreamIntentInputs {
  format: ClientFormat;
  pathname: string;
  search: string;
  body: Record<string, unknown> | null;
}

const GEMINI_FORMATS: ReadonlyArray<ClientFormat> = ["gemini", "gemini-cli"];

function isGeminiFamily(format: ClientFormat): boolean {
  return GEMINI_FORMATS.includes(format);
}

function bodyStreamFlag(body: Record<string, unknown> | null): boolean {
  return body !== null && body.stream === true;
}

/**
 * Detect whether the client requested a streaming response.
 *
 * Standard formats (claude / openai / response): only `body.stream === true`
 * counts. Path / query are ignored.
 *
 * Gemini family (gemini / gemini-cli): any of `:streamGenerateContent` in
 * pathname, `alt=sse` query, or `body.stream === true` counts.
 *
 * Inputs come from already-parsed request state — this helper does not consume
 * request body streams.
 */
export function detectClientStreamIntent(input: StreamIntentInputs): boolean {
  if (isGeminiFamily(input.format)) {
    if (input.pathname.includes(":streamGenerateContent")) return true;
    if (hasAltSse(input.search)) return true;
    return bodyStreamFlag(input.body);
  }
  return bodyStreamFlag(input.body);
}

function hasAltSse(search: string): boolean {
  if (!search) return false;
  // search may or may not include leading "?"; URLSearchParams handles both.
  const normalized = search.startsWith("?") ? search.slice(1) : search;
  if (!normalized) return false;
  try {
    const params = new URLSearchParams(normalized);
    // `alt` may legally appear multiple times (e.g. ?alt=json&alt=sse). Only
    // looking at the first value would misclassify such requests as
    // non-streaming.
    return params.getAll("alt").includes("sse");
  } catch {
    return false;
  }
}

/**
 * Produce a non-stream variant of the request inputs without mutating the
 * originals. Used when the client wants a stream but fake streaming wants to
 * call upstream with a buffered, non-stream attempt.
 */
export function cloneRequestForInternalNonStreamAttempt(
  input: StreamIntentInputs
): StreamIntentInputs {
  if (isGeminiFamily(input.format)) {
    const newPath = input.pathname.replace(":streamGenerateContent", ":generateContent");
    const newSearch = stripAltSse(input.search);
    const newBody = cloneBodyWithoutStreamFlag(input.body);
    return { format: input.format, pathname: newPath, search: newSearch, body: newBody };
  }

  return {
    format: input.format,
    pathname: input.pathname,
    search: input.search,
    body: cloneBodyWithStreamFalse(input.body),
  };
}

function stripAltSse(search: string): string {
  if (!search) return "";
  const hasLeadingQuestion = search.startsWith("?");
  const raw = hasLeadingQuestion ? search.slice(1) : search;
  if (!raw) return "";
  try {
    const params = new URLSearchParams(raw);
    const altValues = params.getAll("alt");
    if (altValues.includes("sse")) {
      // Drop only the sse occurrences; preserve any other `alt` values.
      params.delete("alt");
      for (const value of altValues) {
        if (value !== "sse") params.append("alt", value);
      }
    }
    const remaining = params.toString();
    if (!remaining) return "";
    return hasLeadingQuestion ? `?${remaining}` : remaining;
  } catch {
    return search;
  }
}

function cloneBodyWithStreamFalse(
  body: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (body === null) return null;
  return { ...body, stream: false };
}

function cloneBodyWithoutStreamFlag(
  body: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (body === null) return null;
  if (!("stream" in body)) {
    return { ...body };
  }
  return { ...body, stream: false };
}
