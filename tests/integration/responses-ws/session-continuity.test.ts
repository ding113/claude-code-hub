import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    trace: () => {},
  },
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestCost: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
}));

vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(async () => ({
    billingModelSource: "original",
  })),
}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    trackCost: vi.fn(),
    trackUserDailyCost: vi.fn(),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    refreshSession: vi.fn(),
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      endRequest: () => {},
    }),
  },
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    updateSessionUsage: vi.fn(),
    storeSessionResponse: vi.fn(),
    extractCodexPromptCacheKey: vi.fn(),
    updateSessionWithCodexCacheKey: vi.fn(),
  },
}));

import { ProxySession } from "@/app/v1/_lib/proxy/session";
import {
  sendResponsesWsRequest,
  ResponsesWsTransportError,
} from "@/app/v1/_lib/proxy/responses-ws-adapter";
import { SessionManager } from "@/lib/session-manager";
import { WebSocketServer } from "ws";
import { parseSSEData } from "@/lib/utils/sse";

function createSession() {
  const session = new (
    ProxySession as unknown as {
      new (init: {
        startTime: number;
        method: string;
        requestUrl: URL;
        headers: Headers;
        headerLog: string;
        request: { message: Record<string, unknown>; log: string; model: string | null };
        userAgent: string | null;
        context: unknown;
        clientAbortSignal: AbortSignal | null;
      }): ProxySession;
    }
  )({
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("http://localhost/v1/responses"),
    headers: new Headers(),
    headerLog: "",
    request: {
      message: {
        stream: true,
        service_tier: "flex",
      },
      log: "(test)",
      model: "gpt-5-codex",
    },
    userAgent: null,
    context: {},
    clientAbortSignal: null,
  });

  session.setOriginalFormat("response");
  session.setOriginalModel("gpt-5-codex");
  session.setSessionId("session_initial");
  session.setProvider({
    id: 9,
    name: "codex-provider",
    url: "https://api.openai.com/v1/responses",
    providerType: "codex",
    costMultiplier: 1,
    streamingIdleTimeoutMs: 0,
  } as any);
  session.setAuthState({
    user: { id: 1, name: "user", dailyResetTime: "00:00", dailyResetMode: "fixed" } as any,
    key: { id: 2, name: "key", dailyResetTime: "00:00", dailyResetMode: "fixed" } as any,
    apiKey: "sk-test",
    success: true,
  });
  session.setMessageContext({
    id: 123,
    createdAt: new Date(),
    user: { id: 1, name: "user" } as any,
    key: { id: 2, name: "key" } as any,
    apiKey: "sk-test",
  });
  return session;
}

function createSseResponseWithPromptCacheKey(promptCacheKey: string) {
  const encoder = new TextEncoder();
  const events = [
    {
      type: "response.created",
      payload: {
        response: {
          id: "resp_1",
          object: "response",
          created: 1,
          model: "gpt-5-codex",
          status: "in_progress",
          prompt_cache_key: promptCacheKey,
        },
      },
    },
    {
      type: "response.completed",
      payload: {
        response: {
          id: "resp_1",
          object: "response",
          created: 1,
          model: "gpt-5-codex",
          status: "completed",
          prompt_cache_key: promptCacheKey,
          output: [],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      },
    },
  ];

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`)
          );
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
      },
    }
  );
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate free port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on("error", reject);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(SessionManager.extractCodexPromptCacheKey).mockImplementation((data) => {
    const payload = data as Record<string, unknown>;
    const response = payload.response as Record<string, unknown> | undefined;
    return (
      (response?.prompt_cache_key as string | undefined) ??
      (payload.prompt_cache_key as string | undefined) ??
      null
    );
  });
  vi.mocked(SessionManager.updateSessionWithCodexCacheKey).mockResolvedValue({
    sessionId: "codex_cache_key_1",
    updated: true,
  });
});

describe("responses websocket session continuity", () => {
  it("rebinds session from prompt_cache_key terminal event", async () => {
    const session = createSession();
    const upstreamResponse = createSseResponseWithPromptCacheKey("cache_key_terminal");
    const sseText = await upstreamResponse.text();

    for (const event of parseSSEData(sseText)) {
      if (typeof event.data !== "object" || !event.data) {
        continue;
      }
      const promptCacheKey = SessionManager.extractCodexPromptCacheKey(event.data);
      if (promptCacheKey) {
        await SessionManager.updateSessionWithCodexCacheKey(session.sessionId, promptCacheKey, 9);
      }
    }

    expect(SessionManager.extractCodexPromptCacheKey).toHaveBeenCalled();
    expect(SessionManager.updateSessionWithCodexCacheKey).toHaveBeenCalledWith(
      "session_initial",
      "cache_key_terminal",
      9
    );
  });

  it("fails mid-stream disconnect without implicit replay", async () => {
    const port = await getFreePort();
    const wss = new WebSocketServer({ port, host: "127.0.0.1" });
    wss.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(
          JSON.stringify({
            type: "response.created",
            response: {
              id: "resp_1",
              object: "response",
              created: 1,
              model: "gpt-5-codex",
              status: "in_progress",
            },
          })
        );
        socket.close();
      });
    });

    const response = await sendResponsesWsRequest({
      websocketUrl: `ws://127.0.0.1:${port}/v1/responses`,
      frame: {
        type: "response.create",
        response: {
          model: "gpt-5-codex",
        },
      },
      isStreaming: true,
      handshakeTimeoutMs: 1000,
      firstEventTimeoutMs: 1000,
    });

    await expect(response.text()).rejects.toThrow("closed before terminal event");
    await new Promise((resolve) => wss.close(() => resolve(undefined)));
  });
});

describe("responses websocket protocol error relay", () => {
  let wss: WebSocketServer | null = null;

  afterEach(async () => {
    if (wss) {
      await new Promise((resolve) => wss?.close(() => resolve(undefined)));
      wss = null;
    }
  });

  it("relays previous_response_not_found error without HTTP fallback (streaming)", async () => {
    const port = await getFreePort();
    wss = new WebSocketServer({ port, host: "127.0.0.1" });
    wss.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(
          JSON.stringify({
            type: "error",
            error: {
              type: "previous_response_not_found",
              code: "previous_response_not_found",
              message: "No response found with id 'resp_nonexistent'.",
            },
          })
        );
      });
    });

    const response = await sendResponsesWsRequest({
      websocketUrl: `ws://127.0.0.1:${port}/v1/responses`,
      frame: {
        type: "response.create",
        response: {
          model: "gpt-5-codex",
          previous_response_id: "resp_nonexistent",
        },
      },
      isStreaming: true,
      handshakeTimeoutMs: 1000,
      firstEventTimeoutMs: 1000,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const body = await response.text();
    expect(body).toContain("event: error");
    expect(body).toContain("previous_response_not_found");
  });

  it("relays websocket_connection_limit_reached error without HTTP fallback (streaming)", async () => {
    const port = await getFreePort();
    wss = new WebSocketServer({ port, host: "127.0.0.1" });
    wss.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(
          JSON.stringify({
            type: "error",
            error: {
              type: "websocket_connection_limit_reached",
              code: "websocket_connection_limit_reached",
              message: "WebSocket connection limit reached.",
            },
          })
        );
      });
    });

    const response = await sendResponsesWsRequest({
      websocketUrl: `ws://127.0.0.1:${port}/v1/responses`,
      frame: {
        type: "response.create",
        response: {
          model: "gpt-5-codex",
        },
      },
      isStreaming: true,
      handshakeTimeoutMs: 1000,
      firstEventTimeoutMs: 1000,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const body = await response.text();
    expect(body).toContain("event: error");
    expect(body).toContain("websocket_connection_limit_reached");
  });

  it("resolves non-streaming response with error payload (not transport error)", async () => {
    const port = await getFreePort();
    wss = new WebSocketServer({ port, host: "127.0.0.1" });
    wss.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(
          JSON.stringify({
            type: "error",
            error: {
              type: "previous_response_not_found",
              code: "previous_response_not_found",
              message: "No response found with id 'resp_nonexistent'.",
            },
          })
        );
      });
    });

    const response = await sendResponsesWsRequest({
      websocketUrl: `ws://127.0.0.1:${port}/v1/responses`,
      frame: {
        type: "response.create",
        response: {
          model: "gpt-5-codex",
          previous_response_id: "resp_nonexistent",
        },
      },
      isStreaming: false,
      handshakeTimeoutMs: 1000,
      firstEventTimeoutMs: 1000,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const json = await response.json();
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe("previous_response_not_found");
  });
});
