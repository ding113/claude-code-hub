import {
  detectUpstreamErrorFromSseOrJsonText,
  sanitizeErrorTextForDetail,
} from "@/lib/utils/upstream-error-detection";

export interface DeriveClientSafeUpstreamErrorMessageInput {
  rawText?: string;
  candidateMessage?: string;
  providerName?: string | null;
  forbiddenProviderLabels?: string[];
}

const MAX_CLIENT_ERROR_MESSAGE_CHARS = 240;
const DEFAULT_FORBIDDEN_PROVIDER_LABELS = [
  "anthropic",
  "openai",
  "gemini",
  "google",
  "vertex",
  "bedrock",
  "azure",
  "deepseek",
  "grok",
  "claude",
  "codex",
  "openrouter",
  "siliconflow",
  "dashscope",
  "qwen",
  "kimi",
];

const INTERNAL_ONLY_RE =
  /^(?:FAKE_200_[A-Z0-9_]+|EMPTY_RESPONSE|HTTP\s+\d{3}|No available providers?|No available provider endpoints|所有供应商暂时不可用，请稍后重试)$/iu;
const PROVIDER_PREFIX_RE = /\bProvider\s+[\w.-]+(?:\s+returned|\s*:|\s+-)/iu;
const RAW_JSON_BLOB_RE = /^[[{]/u;
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/giu;
const DOMAIN_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ai|app|dev|cloud|cn|co|uk|jp|ru|de|fr|us|example)(?:\b|\/[^\s"'<>]*)/giu;
const HOSTLIKE_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[^\s"'<>]*)?\b/giu;
const INTERNAL_LABEL_RE =
  /\b(?:gateway|proxy|provider|vendor|region|shard|cluster|internal|router|route|endpoint|node|alpha|beta)[-_a-z0-9.:/]*\b/giu;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\b/g;
const REQUEST_ID_RE =
  /\b(?:request[_ -]?id|x-request-id|req(?:uest)?[_ -]?id|trace[_ -]?id|cf-ray)\b\s*[:=]?\s*[A-Za-z0-9._:-]{3,}\b/giu;
const REQUEST_ID_TOKEN_RE = /\b(?:req|msg|chatcmpl|run|trace)_[A-Za-z0-9._-]{3,}\b/giu;
const KEY_VALUE_RE =
  /\b(?:api[_ -]?key|token|secret|password)\b\s*[:=]\s*(?:\[REDACTED(?:_KEY)?\]|\[JWT\]|\*\*\*|[A-Za-z0-9._-]{6,})/giu;

function isAscii(text: string): boolean {
  return [...text].every((char) => char.charCodeAt(0) <= 0x7f);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasForbiddenProviderLabel(message: string, labels: string[]): boolean {
  const normalized = message.toLocaleLowerCase();
  if (PROVIDER_PREFIX_RE.test(message)) return true;

  return labels.some((label) => {
    const trimmed = label.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLocaleLowerCase();
    if (lower.length <= 1) return false;

    const boundary =
      /^[\w.-]+$/u.test(trimmed) && isAscii(trimmed)
        ? new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "iu")
        : null;
    return boundary ? boundary.test(message) : normalized.includes(lower);
  });
}

function normalizeClientMessage(text: string): string {
  let sanitized = sanitizeErrorTextForDetail(text);

  sanitized = sanitized
    .replace(URL_RE, " ")
    .replace(DOMAIN_RE, " ")
    .replace(HOSTLIKE_RE, " ")
    .replace(IPV4_RE, " ")
    .replace(REQUEST_ID_RE, " ")
    .replace(REQUEST_ID_TOKEN_RE, " ")
    .replace(INTERNAL_LABEL_RE, " ")
    .replace(KEY_VALUE_RE, " ")
    .replace(/\b(?:request[_ -]?id|x-request-id|trace[_ -]?id)\b\s*[:=]?\s*$/giu, " ")
    .replace(/\s+\b(?:at|from|for|with)\b\s*(?:[,.;:，。；：]|$)/giu, " ")
    .replace(/\s*[,;，；]\s*/g, ", ")
    .replace(/\s*[:：]\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();

  sanitized = sanitized.replace(/^(?:error|message)\s*[:：]\s*/iu, "").trim();
  if (sanitized.length > MAX_CLIENT_ERROR_MESSAGE_CHARS) {
    sanitized = `${sanitized.slice(0, MAX_CLIENT_ERROR_MESSAGE_CHARS).trim()}...`;
  }

  return sanitized;
}

function isUnsafeAfterRedaction(text: string): boolean {
  if (!text.trim()) return true;
  if (URL_RE.test(text) || DOMAIN_RE.test(text) || HOSTLIKE_RE.test(text) || IPV4_RE.test(text)) {
    return true;
  }
  if (REQUEST_ID_RE.test(text) || REQUEST_ID_TOKEN_RE.test(text)) return true;
  if (INTERNAL_LABEL_RE.test(text)) return true;
  if (/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/iu.test(text)) return true;
  return false;
}

function deriveCandidateFromRawText(rawText: string | undefined): string | null {
  if (typeof rawText !== "string" || !rawText.trim()) return null;
  const detected = detectUpstreamErrorFromSseOrJsonText(rawText);
  if (!detected.isError || !detected.detail) return null;
  return detected.detail;
}

export function deriveClientSafeUpstreamErrorMessage(
  input: DeriveClientSafeUpstreamErrorMessageInput
): string | null {
  const labels = [
    input.providerName ?? "",
    ...DEFAULT_FORBIDDEN_PROVIDER_LABELS,
    ...(input.forbiddenProviderLabels ?? []),
  ].filter(Boolean);
  const candidates = [deriveCandidateFromRawText(input.rawText), input.candidateMessage].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed || INTERNAL_ONLY_RE.test(trimmed) || RAW_JSON_BLOB_RE.test(trimmed)) {
      continue;
    }
    if (hasForbiddenProviderLabel(trimmed, labels)) {
      continue;
    }

    const normalized = normalizeClientMessage(trimmed);
    if (!normalized || INTERNAL_ONLY_RE.test(normalized) || RAW_JSON_BLOB_RE.test(normalized)) {
      continue;
    }
    if (hasForbiddenProviderLabel(normalized, labels) || isUnsafeAfterRedaction(normalized)) {
      continue;
    }

    return normalized;
  }

  return null;
}
