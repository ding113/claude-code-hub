import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { FakeStreamingWhitelistEntry } from "@/types/system-config";

type ProxySettingsFixture = {
  readonly enableHighConcurrencyMode: boolean;
  readonly allowNonConversationEndpointProviderFallback: boolean;
  readonly enableResponseFixer: boolean;
  readonly enableResponseInputRectifier: boolean;
  readonly fakeStreamingWhitelist: FakeStreamingWhitelistEntry[];
};

const boundary = vi.hoisted(() => ({
  decrementConcurrentCount: vi.fn<(sessionId: string) => Promise<void>>(),
  incrementConcurrentCount: vi.fn<(sessionId: string) => Promise<void>>(),
  loadSettings: vi.fn<() => Promise<ProxySettingsFixture>>(),
  runGuards: vi.fn<(session: ProxySession) => Promise<Response | null>>(),
  send: vi.fn<(session: ProxySession) => Promise<Response>>(),
}));

vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config")>()),
  getCachedSystemSettings: boundary.loadSettings,
}));

vi.mock("@/lib/config/system-settings-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/system-settings-cache")>()),
  getCachedSystemSettings: boundary.loadSettings,
}));

vi.mock("@/app/v1/_lib/proxy/guard-pipeline", () => ({
  GuardPipelineBuilder: {
    fromSession: () => ({ run: boundary.runGuards }),
  },
}));

vi.mock("@/app/v1/_lib/proxy/forwarder", () => ({
  ProxyForwarder: { send: boundary.send },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    decrementConcurrentCount: boundary.decrementConcurrentCount,
    incrementConcurrentCount: boundary.incrementConcurrentCount,
    refreshSession: vi.fn(),
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({ endRequest: vi.fn(), startRequest: vi.fn() }),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

import { handleProxyRequest } from "@/app/v1/_lib/proxy-handler";

const defaultSettings: ProxySettingsFixture = {
  enableHighConcurrencyMode: false,
  allowNonConversationEndpointProviderFallback: true,
  enableResponseFixer: true,
  enableResponseInputRectifier: true,
  fakeStreamingWhitelist: [],
};

function createContext(pathname: string, body: Record<string, unknown>): Context {
  const request = new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return new Context(request);
}

describe("handleProxyRequest public success behavior", () => {
  beforeEach(() => {
    boundary.runGuards.mockReset();
    boundary.send.mockReset();
    boundary.incrementConcurrentCount.mockReset();
    boundary.decrementConcurrentCount.mockReset();
    boundary.loadSettings.mockReset();
    boundary.loadSettings.mockResolvedValue(defaultSettings);
    boundary.runGuards.mockResolvedValue(null);
    boundary.incrementConcurrentCount.mockResolvedValue(undefined);
    boundary.decrementConcurrentCount.mockResolvedValue(undefined);
  });

  it("returns a successful upstream response through the real dispatcher", async () => {
    boundary.send.mockResolvedValue(
      new Response(JSON.stringify({ id: "msg_1", type: "message", content: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const response = await handleProxyRequest(
      createContext("/v1/messages", { model: "claude-test", messages: [] })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ id: "msg_1", type: "message", content: [] });
    expect(boundary.send).toHaveBeenCalledOnce();
  });

  it("returns synthesized SSE when the request is fake-stream eligible", async () => {
    boundary.loadSettings.mockResolvedValue({
      ...defaultSettings,
      fakeStreamingWhitelist: [{ model: "gpt-image-2", groupTags: [] }],
    });
    boundary.send.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: "claude-test",
          content: [{ type: "text", text: "generated" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 3, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const response = await handleProxyRequest(
      createContext("/v1/messages", { model: "gpt-image-2", messages: [], stream: true })
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: message_start");
    expect(body).toContain('"text":"generated"');
    expect(body).toContain("event: message_stop");
    expect(boundary.send).toHaveBeenCalledOnce();
  });

  it("normalizes Responses input and output at the public boundary", async () => {
    boundary.send.mockImplementation(
      async (session) =>
        new Response(
          JSON.stringify({
            id: "resp_1",
            object: "response",
            echoed_input: session.request.message.input,
            output: [{ type: "message", content: null }],
            tools: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );

    const response = await handleProxyRequest(
      createContext("/v1/responses", { model: "gpt-5", input: "hello" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "resp_1",
      object: "response",
      echoed_input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
      output: [{ type: "message", content: [] }],
      tools: [],
    });
  });
});
