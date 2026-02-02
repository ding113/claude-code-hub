import "server-only";

export type CodexSessionIdSource =
  | "header_session_id"
  | "header_x_session_id"
  | "body_prompt_cache_key"
  | "body_metadata_session_id"
  | "body_previous_response_id"
  | null;

export interface CodexSessionExtractionResult {
  sessionId: string | null;
  source: CodexSessionIdSource;
}

// Session ID validation constants
const CODEX_SESSION_ID_MIN_LENGTH = 21; // Codex session_id typically > 20 chars (UUID-like)
const CODEX_SESSION_ID_MAX_LENGTH = 256; // Prevent Redis key bloat from malicious input
const SESSION_ID_PATTERN = /^[\w\-.:]+$/; // Alphanumeric, dash, dot, colon only

export function normalizeCodexSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.length < CODEX_SESSION_ID_MIN_LENGTH) return null;
  if (trimmed.length > CODEX_SESSION_ID_MAX_LENGTH) return null;
  if (!SESSION_ID_PATTERN.test(trimmed)) return null;

  return trimmed;
}

function parseMetadata(requestBody: Record<string, unknown>): Record<string, unknown> | null {
  const metadata = requestBody.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

/**
 * Extract Codex session id from headers/body with priority:
 * 1) headers["session_id"]
 * 2) headers["x-session-id"]
 * 3) body.prompt_cache_key
 * 4) body.metadata.session_id
 * 5) body.previous_response_id (fallback, prefixed with "codex_prev_")
 *
 * Only accept session ids with length > 20.
 */
export function extractCodexSessionId(
  headers: Headers,
  requestBody: Record<string, unknown>
): CodexSessionExtractionResult {
  const headerSessionId = normalizeCodexSessionId(headers.get("session_id"));
  if (headerSessionId) {
    return {
      sessionId: headerSessionId,
      source: "header_session_id",
    };
  }

  const headerXSessionId = normalizeCodexSessionId(headers.get("x-session-id"));
  if (headerXSessionId) {
    return {
      sessionId: headerXSessionId,
      source: "header_x_session_id",
    };
  }

  // 当请求头未提供 session_id 时，优先尝试使用 prompt_cache_key 作为稳定的会话标识
  const bodyPromptCacheKey = normalizeCodexSessionId(requestBody.prompt_cache_key);
  if (bodyPromptCacheKey) {
    return {
      sessionId: bodyPromptCacheKey,
      source: "body_prompt_cache_key",
    };
  }

  const metadata = parseMetadata(requestBody);
  const bodyMetadataSessionId = metadata ? normalizeCodexSessionId(metadata.session_id) : null;
  if (bodyMetadataSessionId) {
    return {
      sessionId: bodyMetadataSessionId,
      source: "body_metadata_session_id",
    };
  }

  const prevResponseId = normalizeCodexSessionId(requestBody.previous_response_id);
  if (prevResponseId) {
    const sessionId = `codex_prev_${prevResponseId}`;
    if (sessionId.length <= CODEX_SESSION_ID_MAX_LENGTH) {
      return {
        sessionId,
        source: "body_previous_response_id",
      };
    }
  }

  return { sessionId: null, source: null };
}
