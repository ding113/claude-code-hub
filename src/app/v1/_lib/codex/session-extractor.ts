import "server-only";

export type CodexSessionIdSource =
  | "header_session_id"
  | "header_x_session_id"
  | "body_metadata_session_id"
  | "body_previous_response_id"
  | null;

export interface CodexSessionExtractionResult {
  sessionId: string | null;
  source: CodexSessionIdSource;
  isCodexClient: boolean;
}

// Session ID validation constants
const CODEX_SESSION_ID_MIN_LENGTH = 21; // Codex session_id typically > 20 chars (UUID-like)
const CODEX_SESSION_ID_MAX_LENGTH = 256; // Prevent Redis key bloat from malicious input
const SESSION_ID_PATTERN = /^[\w\-.:]+$/; // Alphanumeric, dash, dot, colon only

// Codex CLI User-Agent pattern (pre-compiled for performance)
const CODEX_CLI_PATTERN = /^(codex_vscode|codex_cli_rs)\/[\d.]+/i;

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
 * Detect official Codex CLI clients by User-Agent.
 *
 * Examples:
 * - codex_vscode/0.35.0 (...)
 * - codex_cli_rs/0.50.0 (...)
 */
export function isCodexClient(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return CODEX_CLI_PATTERN.test(userAgent);
}

/**
 * Extract Codex session id from headers/body with priority:
 * 1) headers["session_id"]
 * 2) headers["x-session-id"]
 * 3) body.metadata.session_id
 * 4) body.previous_response_id (fallback, prefixed with "codex_prev_")
 *
 * Only accept session ids with length > 20.
 */
export function extractCodexSessionId(
  headers: Headers,
  requestBody: Record<string, unknown>,
  userAgent: string | null
): CodexSessionExtractionResult {
  const officialClient = isCodexClient(userAgent);

  const headerSessionId = normalizeCodexSessionId(headers.get("session_id"));
  if (headerSessionId) {
    return {
      sessionId: headerSessionId,
      source: "header_session_id",
      isCodexClient: officialClient,
    };
  }

  const headerXSessionId = normalizeCodexSessionId(headers.get("x-session-id"));
  if (headerXSessionId) {
    return {
      sessionId: headerXSessionId,
      source: "header_x_session_id",
      isCodexClient: officialClient,
    };
  }

  const metadata = parseMetadata(requestBody);
  const bodyMetadataSessionId = metadata ? normalizeCodexSessionId(metadata.session_id) : null;
  if (bodyMetadataSessionId) {
    return {
      sessionId: bodyMetadataSessionId,
      source: "body_metadata_session_id",
      isCodexClient: officialClient,
    };
  }

  const prevResponseId = normalizeCodexSessionId(requestBody.previous_response_id);
  if (prevResponseId) {
    const sessionId = `codex_prev_${prevResponseId}`;
    if (sessionId.length <= CODEX_SESSION_ID_MAX_LENGTH) {
      return {
        sessionId,
        source: "body_previous_response_id",
        isCodexClient: officialClient,
      };
    }
  }

  return { sessionId: null, source: null, isCodexClient: officialClient };
}
