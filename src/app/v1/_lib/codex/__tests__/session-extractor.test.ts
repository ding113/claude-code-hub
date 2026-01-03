import { describe, expect, test } from "vitest";
import { extractCodexSessionId, isCodexClient } from "../session-extractor";

describe("Codex session extractor", () => {
  test("extracts from header session_id", () => {
    const headerSessionId = "sess_123456789012345678901";
    const result = extractCodexSessionId(
      new Headers({ session_id: headerSessionId }),
      {
        metadata: { session_id: "sess_aaaaaaaaaaaaaaaaaaaaa" },
        previous_response_id: "resp_123456789012345678901",
      },
      "codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64)"
    );

    expect(result.sessionId).toBe(headerSessionId);
    expect(result.source).toBe("header_session_id");
  });

  test("extracts from header x-session-id", () => {
    const headerSessionId = "sess_123456789012345678902";
    const result = extractCodexSessionId(
      new Headers({ "x-session-id": headerSessionId }),
      {
        prompt_cache_key: "019b82ff-08ff-75a3-a203-7e10274fdbd8",
        metadata: { session_id: "sess_aaaaaaaaaaaaaaaaaaaaa" },
        previous_response_id: "resp_123456789012345678901",
      },
      "codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64)"
    );

    expect(result.sessionId).toBe(headerSessionId);
    expect(result.source).toBe("header_x_session_id");
  });

  test("extracts from body metadata.session_id", () => {
    const bodySessionId = "sess_123456789012345678903";
    const result = extractCodexSessionId(
      new Headers(),
      { metadata: { session_id: bodySessionId } },
      "codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64)"
    );

    expect(result.sessionId).toBe(bodySessionId);
    expect(result.source).toBe("body_metadata_session_id");
  });

  test("extracts from body prompt_cache_key", () => {
    const promptCacheKey = "019b82ff-08ff-75a3-a203-7e10274fdbd8";
    const result = extractCodexSessionId(
      new Headers(),
      { prompt_cache_key: promptCacheKey },
      "codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64)"
    );

    expect(result.sessionId).toBe(promptCacheKey);
    expect(result.source).toBe("body_prompt_cache_key");
  });

  test("prompt_cache_key has higher priority than metadata.session_id", () => {
    const promptCacheKey = "019b82ff-08ff-75a3-a203-7e10274fdbd8";
    const metadataSessionId = "sess_123456789012345678903";
    const result = extractCodexSessionId(
      new Headers(),
      { prompt_cache_key: promptCacheKey, metadata: { session_id: metadataSessionId } },
      null
    );

    expect(result.sessionId).toBe(promptCacheKey);
    expect(result.source).toBe("body_prompt_cache_key");
  });

  test("ignores invalid prompt_cache_key and falls back to metadata.session_id", () => {
    const metadataSessionId = "sess_123456789012345678903";
    const result = extractCodexSessionId(
      new Headers(),
      { prompt_cache_key: "short", metadata: { session_id: metadataSessionId } },
      null
    );

    expect(result.sessionId).toBe(metadataSessionId);
    expect(result.source).toBe("body_metadata_session_id");
  });

  test("falls back to previous_response_id", () => {
    const previousResponseId = "resp_123456789012345678901";
    const result = extractCodexSessionId(
      new Headers(),
      { previous_response_id: previousResponseId },
      "codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64)"
    );

    expect(result.sessionId).toBe(`codex_prev_${previousResponseId}`);
    expect(result.source).toBe("body_previous_response_id");
  });

  test("rejects previous_response_id that would exceed 256 after prefix", () => {
    const longId = "a".repeat(250); // 250 + 11 (prefix) = 261 > 256
    const result = extractCodexSessionId(new Headers(), { previous_response_id: longId }, null);
    expect(result.sessionId).toBe(null);
    expect(result.source).toBe(null);
  });

  test("respects extraction priority", () => {
    const sessionIdFromHeader = "sess_123456789012345678904";
    const xSessionIdFromHeader = "sess_123456789012345678905";
    const sessionIdFromBody = "sess_123456789012345678906";
    const previousResponseId = "resp_123456789012345678901";

    const result = extractCodexSessionId(
      new Headers({
        session_id: sessionIdFromHeader,
        "x-session-id": xSessionIdFromHeader,
      }),
      {
        prompt_cache_key: "019b82ff-08ff-75a3-a203-7e10274fdbd8",
        metadata: { session_id: sessionIdFromBody },
        previous_response_id: previousResponseId,
      },
      "codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64)"
    );

    expect(result.sessionId).toBe(sessionIdFromHeader);
    expect(result.source).toBe("header_session_id");
  });

  test("detects Codex client User-Agent", () => {
    expect(isCodexClient("codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64)")).toBe(true);
    expect(isCodexClient("codex_vscode/0.35.0 (Windows 10.0.26100; x86_64)")).toBe(true);
    expect(isCodexClient("Mozilla/5.0")).toBe(false);
    expect(isCodexClient(null)).toBe(false);
  });

  test("rejects session_id shorter than 21 characters", () => {
    const result = extractCodexSessionId(
      new Headers({ session_id: "short_id_12345" }), // 14 chars
      {},
      null
    );
    expect(result.sessionId).toBe(null);
    expect(result.source).toBe(null);
  });

  test("accepts session_id with exactly 21 characters (minimum)", () => {
    const minId = "a".repeat(21);
    const result = extractCodexSessionId(new Headers({ session_id: minId }), {}, null);
    expect(result.sessionId).toBe(minId);
    expect(result.source).toBe("header_session_id");
  });

  test("accepts session_id with exactly 256 characters (maximum)", () => {
    const maxId = "a".repeat(256);
    const result = extractCodexSessionId(new Headers({ session_id: maxId }), {}, null);
    expect(result.sessionId).toBe(maxId);
    expect(result.source).toBe("header_session_id");
  });

  test("rejects session_id longer than 256 characters", () => {
    const longId = "a".repeat(300);
    const result = extractCodexSessionId(new Headers({ session_id: longId }), {}, null);
    expect(result.sessionId).toBe(null);
    expect(result.source).toBe(null);
  });

  test("rejects session_id with invalid characters", () => {
    // Test with body metadata to avoid Headers normalization
    const result = extractCodexSessionId(
      new Headers(),
      { metadata: { session_id: "sess_123456789@#$%^&*()!" } },
      null
    );
    expect(result.sessionId).toBe(null);
  });

  test("accepts session_id with allowed special characters", () => {
    const validId = "sess-123_456.789:abc012345";
    const result = extractCodexSessionId(new Headers({ session_id: validId }), {}, null);
    expect(result.sessionId).toBe(validId);
  });

  test("returns null when no valid session_id found", () => {
    const result = extractCodexSessionId(new Headers(), {}, "codex_cli_rs/0.50.0");
    expect(result.sessionId).toBe(null);
    expect(result.source).toBe(null);
    expect(result.isCodexClient).toBe(true);
  });
});
