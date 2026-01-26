/**
 * Test: SessionManager redaction based on STORE_SESSION_MESSAGES env
 *
 * Acceptance criteria (Task 3):
 * - When STORE_SESSION_MESSAGES=false (default): store but redact message content
 * - When STORE_SESSION_MESSAGES=true: store raw content without redaction
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

// Mock sanitizeHeaders/sanitizeUrl
vi.mock("@/app/v1/_lib/proxy/errors", () => ({
  sanitizeHeaders: vi.fn(() => "(empty)"),
  sanitizeUrl: vi.fn((url: unknown) => String(url)),
}));

// Mock Redis
const redisMock = {
  status: "ready",
  setex: vi.fn().mockResolvedValue("OK"),
  get: vi.fn(),
  set: vi.fn().mockResolvedValue("OK"),
  expire: vi.fn().mockResolvedValue(1),
  incr: vi.fn().mockResolvedValue(1),
  pipeline: vi.fn(() => ({
    setex: vi.fn().mockReturnThis(),
    hset: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  })),
};
vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisMock,
}));

// Mock config - we'll control STORE_SESSION_MESSAGES dynamically
let mockStoreMessages = false;
vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => ({
    STORE_SESSION_MESSAGES: mockStoreMessages,
    SESSION_TTL: 300,
  }),
}));

// Import after mocks
const { SessionManager } = await import("@/lib/session-manager");

describe("SessionManager - Redaction based on STORE_SESSION_MESSAGES", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreMessages = false; // default: redact
  });

  afterEach(() => {
    mockStoreMessages = false;
  });

  describe("storeSessionMessages", () => {
    const testMessages = [
      { role: "user", content: "Hello secret message" },
      { role: "assistant", content: "Secret response" },
    ];

    it("should store redacted messages when STORE_SESSION_MESSAGES=false", async () => {
      mockStoreMessages = false;

      await SessionManager.storeSessionMessages("sess_123", testMessages, 1);

      expect(redisMock.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = redisMock.setex.mock.calls[0];
      expect(key).toBe("session:sess_123:req:1:messages");
      expect(ttl).toBe(300);

      const stored = JSON.parse(value);
      expect(stored[0].content).toBe("[REDACTED]");
      expect(stored[1].content).toBe("[REDACTED]");
    });

    it("should store raw messages when STORE_SESSION_MESSAGES=true", async () => {
      mockStoreMessages = true;

      await SessionManager.storeSessionMessages("sess_456", testMessages, 1);

      expect(redisMock.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = redisMock.setex.mock.calls[0];
      expect(key).toBe("session:sess_456:req:1:messages");

      const stored = JSON.parse(value);
      expect(stored[0].content).toBe("Hello secret message");
      expect(stored[1].content).toBe("Secret response");
    });
  });

  describe("storeSessionRequestBody", () => {
    const testRequestBody = {
      model: "claude-3-opus",
      messages: [
        { role: "user", content: "Secret user input" },
        { role: "assistant", content: "Secret assistant reply" },
      ],
      system: "Secret system prompt",
    };

    it("should store redacted request body when STORE_SESSION_MESSAGES=false", async () => {
      mockStoreMessages = false;

      await SessionManager.storeSessionRequestBody("sess_789", testRequestBody, 1);

      expect(redisMock.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = redisMock.setex.mock.calls[0];
      expect(key).toBe("session:sess_789:req:1:requestBody");

      const stored = JSON.parse(value);
      expect(stored.model).toBe("claude-3-opus"); // preserved
      expect(stored.messages[0].content).toBe("[REDACTED]");
      expect(stored.messages[1].content).toBe("[REDACTED]");
      expect(stored.system).toBe("[REDACTED]");
    });

    it("should store raw request body when STORE_SESSION_MESSAGES=true", async () => {
      mockStoreMessages = true;

      await SessionManager.storeSessionRequestBody("sess_abc", testRequestBody, 1);

      expect(redisMock.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = redisMock.setex.mock.calls[0];

      const stored = JSON.parse(value);
      expect(stored.model).toBe("claude-3-opus");
      expect(stored.messages[0].content).toBe("Secret user input");
      expect(stored.messages[1].content).toBe("Secret assistant reply");
      expect(stored.system).toBe("Secret system prompt");
    });

    it("should handle Gemini contents format when STORE_SESSION_MESSAGES=false", async () => {
      mockStoreMessages = false;
      const geminiBody = {
        contents: [{ role: "user", parts: [{ text: "Secret Gemini message" }] }],
      };

      await SessionManager.storeSessionRequestBody("sess_gemini", geminiBody, 1);

      const [, , value] = redisMock.setex.mock.calls[0];
      const stored = JSON.parse(value);
      expect(stored.contents[0].parts[0].text).toBe("[REDACTED]");
    });
  });

  describe("storeSessionResponse", () => {
    it("should store redacted JSON response when STORE_SESSION_MESSAGES=false", async () => {
      mockStoreMessages = false;
      const responseBody = {
        id: "msg_123",
        content: [{ type: "text", text: "Secret response text" }],
      };

      await SessionManager.storeSessionResponse("sess_res", JSON.stringify(responseBody), 1);

      expect(redisMock.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = redisMock.setex.mock.calls[0];
      expect(key).toBe("session:sess_res:req:1:response");

      const stored = JSON.parse(value);
      expect(stored.id).toBe("msg_123"); // preserved
      expect(stored.content[0].text).toBe("[REDACTED]");
    });

    it("should store raw JSON response when STORE_SESSION_MESSAGES=true", async () => {
      mockStoreMessages = true;
      const responseBody = {
        id: "msg_456",
        content: [{ type: "text", text: "Visible response text" }],
      };

      await SessionManager.storeSessionResponse("sess_res2", JSON.stringify(responseBody), 1);

      const [, , value] = redisMock.setex.mock.calls[0];
      const stored = JSON.parse(value);
      expect(stored.content[0].text).toBe("Visible response text");
    });

    it("should store non-JSON response as-is when STORE_SESSION_MESSAGES=false", async () => {
      mockStoreMessages = false;
      const nonJsonResponse = "data: event stream chunk";

      await SessionManager.storeSessionResponse("sess_stream", nonJsonResponse, 1);

      const [, , value] = redisMock.setex.mock.calls[0];
      // Non-JSON should be stored as-is (cannot redact)
      expect(value).toBe(nonJsonResponse);
    });

    it("should handle OpenAI choices format when STORE_SESSION_MESSAGES=false", async () => {
      mockStoreMessages = false;
      const openaiResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            message: {
              role: "assistant",
              content: "Secret OpenAI response",
            },
          },
        ],
      };

      await SessionManager.storeSessionResponse("sess_openai", JSON.stringify(openaiResponse), 1);

      const [, , value] = redisMock.setex.mock.calls[0];
      const stored = JSON.parse(value);
      expect(stored.id).toBe("chatcmpl-123");
      expect(stored.choices[0].message.content).toBe("[REDACTED]");
    });

    it("should handle Gemini candidates format when STORE_SESSION_MESSAGES=false", async () => {
      mockStoreMessages = false;
      const geminiResponse = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Secret Gemini response" }],
            },
          },
        ],
      };

      await SessionManager.storeSessionResponse(
        "sess_gemini_res",
        JSON.stringify(geminiResponse),
        1
      );

      const [, , value] = redisMock.setex.mock.calls[0];
      const stored = JSON.parse(value);
      expect(stored.candidates[0].content.parts[0].text).toBe("[REDACTED]");
    });

    it("should handle object response (auto-stringify)", async () => {
      mockStoreMessages = false;
      const responseObj = {
        content: [{ type: "text", text: "Object response" }],
      };

      await SessionManager.storeSessionResponse("sess_obj", responseObj, 1);

      const [, , value] = redisMock.setex.mock.calls[0];
      const stored = JSON.parse(value);
      expect(stored.content[0].text).toBe("[REDACTED]");
    });
  });
});
