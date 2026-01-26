/**
 * Test: buildRequestDetails redaction based on STORE_SESSION_MESSAGES env
 *
 * Acceptance criteria:
 * - When STORE_SESSION_MESSAGES=false (default): redact message content in request body
 * - When STORE_SESSION_MESSAGES=true: store raw request body without redaction
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only (must be before imports)
vi.mock("server-only", () => ({}));

// Mock logger
const loggerMock = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

// Mock config - we'll control STORE_SESSION_MESSAGES dynamically
let mockStoreMessages = false;
vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => ({
    STORE_SESSION_MESSAGES: mockStoreMessages,
  }),
}));

// Mock error rule detector
vi.mock("@/lib/error-rule-detector", () => ({
  errorRuleDetector: {
    detect: vi.fn().mockResolvedValue(null),
  },
}));

// Import after mocks
const { buildRequestDetails, sanitizeUrl, sanitizeHeaders, truncateRequestBody } = await import(
  "@/app/v1/_lib/proxy/errors"
);

// Create a minimal mock session for testing
function createMockSession(requestLog: string) {
  return {
    requestUrl: new URL("https://api.example.com/v1/messages"),
    method: "POST",
    headerLog: "content-type: application/json\nauthorization: Bearer sk-1234",
    request: {
      log: requestLog,
    },
  } as Parameters<typeof buildRequestDetails>[0];
}

describe("buildRequestDetails - Redaction based on STORE_SESSION_MESSAGES", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreMessages = false; // default: redact
  });

  afterEach(() => {
    mockStoreMessages = false;
  });

  describe("when STORE_SESSION_MESSAGES=false", () => {
    it("should redact messages in request body", () => {
      mockStoreMessages = false;

      const requestBody = JSON.stringify({
        model: "claude-3-opus",
        messages: [
          { role: "user", content: "Secret user message" },
          { role: "assistant", content: "Secret response" },
        ],
        system: "Secret system prompt",
      });

      const session = createMockSession(requestBody);
      const result = buildRequestDetails(session);

      // Parse the body to verify redaction
      const parsedBody = JSON.parse(result.body);
      expect(parsedBody.model).toBe("claude-3-opus"); // preserved
      expect(parsedBody.messages[0].content).toBe("[REDACTED]");
      expect(parsedBody.messages[1].content).toBe("[REDACTED]");
      expect(parsedBody.system).toBe("[REDACTED]");
    });

    it("should redact Gemini contents format", () => {
      mockStoreMessages = false;

      const requestBody = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Secret Gemini message" }] }],
      });

      const session = createMockSession(requestBody);
      const result = buildRequestDetails(session);

      const parsedBody = JSON.parse(result.body);
      expect(parsedBody.contents[0].parts[0].text).toBe("[REDACTED]");
    });

    it("should preserve non-JSON body as-is", () => {
      mockStoreMessages = false;

      const nonJsonBody = "plain text request body";

      const session = createMockSession(nonJsonBody);
      const result = buildRequestDetails(session);

      // Non-JSON cannot be redacted, kept as-is
      expect(result.body).toBe(nonJsonBody);
    });
  });

  describe("when STORE_SESSION_MESSAGES=true", () => {
    it("should store raw messages without redaction", () => {
      mockStoreMessages = true;

      const requestBody = JSON.stringify({
        model: "claude-3-opus",
        messages: [
          { role: "user", content: "Visible user message" },
          { role: "assistant", content: "Visible response" },
        ],
        system: "Visible system prompt",
      });

      const session = createMockSession(requestBody);
      const result = buildRequestDetails(session);

      const parsedBody = JSON.parse(result.body);
      expect(parsedBody.model).toBe("claude-3-opus");
      expect(parsedBody.messages[0].content).toBe("Visible user message");
      expect(parsedBody.messages[1].content).toBe("Visible response");
      expect(parsedBody.system).toBe("Visible system prompt");
    });
  });

  describe("other fields", () => {
    it("should always sanitize URL and headers", () => {
      mockStoreMessages = false;

      const session = createMockSession("{}");
      const result = buildRequestDetails(session);

      expect(result.url).toBe("https://api.example.com/v1/messages");
      expect(result.method).toBe("POST");
      // Headers should be sanitized (authorization masked)
      expect(result.headers).toContain("authorization:");
      expect(result.headers).not.toContain("sk-1234");
    });

    it("should set bodyTruncated flag when body exceeds limit", () => {
      mockStoreMessages = true;

      // Create a body that exceeds the 2000 char limit
      const longBody = "x".repeat(3000);

      const session = createMockSession(longBody);
      const result = buildRequestDetails(session);

      expect(result.bodyTruncated).toBe(true);
      expect(result.body.length).toBe(2000);
    });
  });
});
