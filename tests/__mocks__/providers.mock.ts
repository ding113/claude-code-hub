/**
 * AI Provider Mock Infrastructure using MSW (Mock Service Worker)
 *
 * Provides HTTP request interception for AI provider APIs:
 * - Anthropic Claude API (/v1/messages)
 * - OpenAI API (/v1/chat/completions)
 * - Codex API (/v1/responses)
 *
 * Supports:
 * - Streaming and non-streaming responses
 * - Error simulation
 * - Custom response handlers
 *
 * Usage:
 * ```typescript
 * import { server, mockClaudeSuccess } from "../__mocks__/providers.mock";
 *
 * beforeAll(() => server.listen());
 * afterEach(() => server.resetHandlers());
 * afterAll(() => server.close());
 *
 * // Override handler for specific test
 * server.use(mockClaudeError(500, "Internal Server Error"));
 * ```
 */

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// ============================================================================
// Response Types
// ============================================================================

export interface ClaudeMessage {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{ type: "text"; text: string }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface OpenAICompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Mock Response Factories
// ============================================================================

/**
 * Create a mock Claude API response
 */
export function createClaudeResponse(overrides: Partial<ClaudeMessage> = {}): ClaudeMessage {
  return {
    id: `msg_mock_${Date.now()}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Mock response from Claude" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
    },
    ...overrides,
  };
}

/**
 * Create a mock OpenAI API response
 */
export function createOpenAIResponse(overrides: Partial<OpenAICompletion> = {}): OpenAICompletion {
  return {
    id: `chatcmpl-mock-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Mock response from OpenAI",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
    ...overrides,
  };
}

/**
 * Create a mock streaming response for Claude API
 */
export function createClaudeStreamResponse(text: string): ReadableStream {
  const encoder = new TextEncoder();

  const events = [
    {
      type: "message_start",
      message: {
        id: `msg_mock_${Date.now()}`,
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-sonnet-4-20250514",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
    {
      type: "content_block_stop",
      index: 0,
    },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 50 },
    },
    {
      type: "message_stop",
    },
  ];

  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }
      controller.close();
    },
  });
}

// ============================================================================
// Default HTTP Handlers
// ============================================================================

/**
 * Default Claude API handler (success)
 */
export const claudeHandler = http.post(
  "https://api.anthropic.com/v1/messages",
  async ({ request }) => {
    const body = (await request.json()) as { stream?: boolean };

    if (body.stream) {
      return new HttpResponse(createClaudeStreamResponse("Mock stream response"), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    return HttpResponse.json(createClaudeResponse());
  }
);

/**
 * Default OpenAI API handler (success)
 */
export const openAIHandler = http.post("https://api.openai.com/v1/chat/completions", async () => {
  return HttpResponse.json(createOpenAIResponse());
});

/**
 * Default Codex API handler (success)
 * Codex uses OpenAI's /v1/responses endpoint
 */
export const codexHandler = http.post("https://api.openai.com/v1/responses", async () => {
  return HttpResponse.json({
    id: `resp_mock_${Date.now()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    output: [
      {
        type: "message",
        id: `msg_mock_${Date.now()}`,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: "Mock Codex response" }],
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    },
  });
});

// ============================================================================
// Handler Factories for Custom Responses
// ============================================================================

/**
 * Create a Claude success handler with custom response
 */
export function mockClaudeSuccess(response?: Partial<ClaudeMessage>) {
  return http.post("https://api.anthropic.com/v1/messages", async () => {
    return HttpResponse.json(createClaudeResponse(response));
  });
}

/**
 * Create a Claude error handler
 */
export function mockClaudeError(status: number, message: string, type = "api_error") {
  return http.post("https://api.anthropic.com/v1/messages", async () => {
    return HttpResponse.json(
      {
        type: "error",
        error: { type, message },
      },
      { status }
    );
  });
}

/**
 * Create an OpenAI success handler with custom response
 */
export function mockOpenAISuccess(response?: Partial<OpenAICompletion>) {
  return http.post("https://api.openai.com/v1/chat/completions", async () => {
    return HttpResponse.json(createOpenAIResponse(response));
  });
}

/**
 * Create an OpenAI error handler
 */
export function mockOpenAIError(status: number, message: string, type = "api_error") {
  return http.post("https://api.openai.com/v1/chat/completions", async () => {
    return HttpResponse.json(
      {
        error: { message, type, code: null },
      },
      { status }
    );
  });
}

/**
 * Create a handler that delays response
 */
export function mockDelayedResponse(delayMs: number) {
  return http.post("https://api.anthropic.com/v1/messages", async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return HttpResponse.json(createClaudeResponse());
  });
}

/**
 * Create a handler that simulates rate limiting
 */
export function mockRateLimited() {
  return http.post("https://api.anthropic.com/v1/messages", async () => {
    return HttpResponse.json(
      {
        type: "error",
        error: {
          type: "rate_limit_error",
          message: "Rate limit exceeded. Please slow down.",
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": "60",
        },
      }
    );
  });
}

/**
 * Create a handler that simulates server error
 */
export function mockServerError() {
  return http.post("https://api.anthropic.com/v1/messages", async () => {
    return HttpResponse.json(
      {
        type: "error",
        error: {
          type: "server_error",
          message: "Internal server error",
        },
      },
      { status: 500 }
    );
  });
}

/**
 * Create a handler that simulates network failure
 */
export function mockNetworkError() {
  return http.post("https://api.anthropic.com/v1/messages", async () => {
    return HttpResponse.error();
  });
}

// ============================================================================
// MSW Server Setup
// ============================================================================

/**
 * Default handlers for all supported providers
 */
export const defaultHandlers = [claudeHandler, openAIHandler, codexHandler];

/**
 * MSW server instance
 * Use in tests with beforeAll/afterAll/afterEach
 */
export const server = setupServer(...defaultHandlers);

/**
 * Helper to reset server to default handlers
 */
export function resetToDefaultHandlers() {
  server.resetHandlers();
}

/**
 * Helper to add custom handlers
 */
export function addHandlers(...handlers: ReturnType<typeof http.post>[]) {
  server.use(...handlers);
}
