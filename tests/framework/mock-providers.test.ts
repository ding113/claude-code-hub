/**
 * Framework Self-Tests: Provider Mock (MSW)
 *
 * Verifies that the MSW-based provider mock infrastructure works correctly:
 * - Default handlers for Claude, OpenAI, Codex
 * - Response customization
 * - Error simulation
 * - Streaming responses
 */

import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import {
  server,
  resetToDefaultHandlers,
  mockClaudeSuccess,
  mockClaudeError,
  mockOpenAISuccess,
  mockOpenAIError,
  mockDelayedResponse,
  mockRateLimited,
  mockServerError,
  mockNetworkError,
  createClaudeResponse,
  createOpenAIResponse,
} from "../__mocks__/providers.mock";

// MSW server lifecycle
beforeAll(() => {
  server.listen({ onUnhandledRequest: "warn" });
});

afterEach(() => {
  resetToDefaultHandlers();
});

afterAll(() => {
  server.close();
});

describe("Provider Mock Infrastructure (MSW)", () => {
  describe("Response Factories", () => {
    test("createClaudeResponse should create valid response structure", () => {
      const response = createClaudeResponse();

      expect(response.type).toBe("message");
      expect(response.role).toBe("assistant");
      expect(response.content).toBeArray();
      expect(response.content[0].type).toBe("text");
      expect(response.usage.input_tokens).toBeDefined();
      expect(response.usage.output_tokens).toBeDefined();
    });

    test("createClaudeResponse should allow customization", () => {
      const response = createClaudeResponse({
        model: "claude-opus-4-20250514",
        content: [{ type: "text", text: "Custom response" }],
        usage: { input_tokens: 200, output_tokens: 100 },
      });

      expect(response.model).toBe("claude-opus-4-20250514");
      expect(response.content[0].text).toBe("Custom response");
      expect(response.usage.input_tokens).toBe(200);
    });

    test("createOpenAIResponse should create valid response structure", () => {
      const response = createOpenAIResponse();

      expect(response.object).toBe("chat.completion");
      expect(response.choices).toBeArray();
      expect(response.choices[0].message.role).toBe("assistant");
      expect(response.usage.total_tokens).toBeDefined();
    });
  });

  describe("Default Handlers", () => {
    test("should intercept Claude API requests", async () => {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "test-key",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.type).toBe("message");
      expect(data.role).toBe("assistant");
    });

    test("should intercept OpenAI API requests", async () => {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.object).toBe("chat.completion");
      expect(data.choices[0].message.content).toBeDefined();
    });

    test("should intercept Codex API requests", async () => {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
        body: JSON.stringify({
          model: "codex",
          input: "Hello",
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.object).toBe("response");
    });
  });

  describe("Custom Success Handlers", () => {
    test("mockClaudeSuccess should return custom response", async () => {
      server.use(
        mockClaudeSuccess({
          content: [{ type: "text", text: "Custom Claude response" }],
          usage: { input_tokens: 50, output_tokens: 25 },
        })
      );

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", messages: [] }),
      });

      const data = await response.json();
      expect(data.content[0].text).toBe("Custom Claude response");
      expect(data.usage.input_tokens).toBe(50);
    });

    test("mockOpenAISuccess should return custom response", async () => {
      server.use(
        mockOpenAISuccess({
          model: "gpt-4-turbo",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Custom OpenAI response" },
              finish_reason: "stop",
            },
          ],
        })
      );

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4", messages: [] }),
      });

      const data = await response.json();
      expect(data.model).toBe("gpt-4-turbo");
      expect(data.choices[0].message.content).toBe("Custom OpenAI response");
    });
  });

  describe("Error Handlers", () => {
    test("mockClaudeError should return error response", async () => {
      server.use(mockClaudeError(400, "Invalid request format"));

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", messages: [] }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.type).toBe("error");
      expect(data.error.message).toBe("Invalid request format");
    });

    test("mockOpenAIError should return error response", async () => {
      server.use(mockOpenAIError(401, "Invalid API key"));

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4", messages: [] }),
      });

      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error.message).toBe("Invalid API key");
    });

    test("mockRateLimited should return 429 with Retry-After", async () => {
      server.use(mockRateLimited());

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", messages: [] }),
      });

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");

      const data = await response.json();
      expect(data.error.type).toBe("rate_limit_error");
    });

    test("mockServerError should return 500", async () => {
      server.use(mockServerError());

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", messages: [] }),
      });

      expect(response.status).toBe(500);

      const data = await response.json();
      expect(data.error.type).toBe("server_error");
    });

    test("mockNetworkError should simulate network failure", async () => {
      server.use(mockNetworkError());

      await expect(
        fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "claude-sonnet-4-20250514", messages: [] }),
        })
      ).rejects.toThrow();
    });
  });

  describe("Delayed Response Handler", () => {
    test("mockDelayedResponse should delay response", async () => {
      server.use(mockDelayedResponse(100));

      const startTime = Date.now();
      await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", messages: [] }),
      });
      const elapsed = Date.now() - startTime;

      // Use wider tolerance for CI environments (90ms min, 500ms max)
      expect(elapsed).toBeGreaterThanOrEqual(90);
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe("Streaming Responses", () => {
    test("should return streaming response when stream=true", async () => {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");

      // Read stream as text directly
      const text = await response.text();

      expect(text).toContain("message_start");
      expect(text).toContain("content_block_delta");
      expect(text).toContain("message_stop");
    });
  });

  describe("Handler Reset", () => {
    test("resetToDefaultHandlers should restore default behavior", async () => {
      // First, set a custom error handler
      server.use(mockClaudeError(500, "Custom error"));

      let response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", messages: [] }),
      });
      expect(response.status).toBe(500);

      // Reset to defaults
      resetToDefaultHandlers();

      // Should now return success
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", messages: [] }),
      });
      expect(response.ok).toBe(true);
    });
  });
});
