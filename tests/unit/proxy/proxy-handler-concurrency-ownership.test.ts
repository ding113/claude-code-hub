import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

type ProxySettingsFixture = {
  readonly enableHighConcurrencyMode: boolean;
  readonly allowNonConversationEndpointProviderFallback: boolean;
};

const boundary = vi.hoisted(() => ({
  decrementConcurrentCount: vi.fn<(sessionId: string) => Promise<void>>(),
  decrementObservedConcurrentCount: vi.fn<(sessionId: string) => Promise<void>>(),
  incrementConcurrentCount: vi.fn<(sessionId: string) => Promise<void>>(),
  incrementObservedConcurrentCount: vi.fn<(sessionId: string) => Promise<void>>(),
  loadSettings: vi.fn<() => Promise<ProxySettingsFixture>>(),
  runGuards: vi.fn<(session: ProxySession) => Promise<Response | null>>(),
  send: vi.fn<(session: ProxySession) => Promise<Response>>(),
  trackObservedSession: vi.fn<(sessionId: string) => Promise<void>>(),
}));

vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config")>()),
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
    decrementObservedConcurrentCount: boundary.decrementObservedConcurrentCount,
    incrementConcurrentCount: boundary.incrementConcurrentCount,
    incrementObservedConcurrentCount: boundary.incrementObservedConcurrentCount,
    trackObservedSession: boundary.trackObservedSession,
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({ endRequest: vi.fn(), startRequest: vi.fn() }),
  },
}));

import { handleProxyRequest } from "@/app/v1/_lib/proxy-handler";

function createContext(
  message: Record<string, unknown> = { model: "claude-test", messages: [] }
): Context {
  const request = new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  return new Context(request);
}

describe("handleProxyRequest concurrency ownership", () => {
  beforeEach(() => {
    boundary.runGuards.mockReset();
    boundary.send.mockReset();
    boundary.incrementConcurrentCount.mockReset();
    boundary.decrementConcurrentCount.mockReset();
    boundary.incrementObservedConcurrentCount.mockReset();
    boundary.decrementObservedConcurrentCount.mockReset();
    boundary.trackObservedSession.mockReset();
    boundary.loadSettings.mockResolvedValue({
      enableHighConcurrencyMode: false,
      allowNonConversationEndpointProviderFallback: true,
    });
    boundary.incrementConcurrentCount.mockResolvedValue(undefined);
    boundary.decrementConcurrentCount.mockResolvedValue(undefined);
    boundary.incrementObservedConcurrentCount.mockResolvedValue(undefined);
    boundary.decrementObservedConcurrentCount.mockResolvedValue(undefined);
    boundary.trackObservedSession.mockResolvedValue(undefined);
    boundary.send.mockResolvedValue(new Response("unused", { status: 200 }));
  });

  it("does not release concurrency for an early guard response before acquisition", async () => {
    boundary.runGuards.mockImplementation(async (session) => {
      session.setSessionId("session-early");
      return new Response("guard rejected", { status: 429 });
    });

    const response = await handleProxyRequest(createContext());

    expect(response.status).toBe(429);
    expect(await response.text()).toBe("guard rejected");
    expect(boundary.incrementConcurrentCount).not.toHaveBeenCalled();
    expect(boundary.decrementConcurrentCount).not.toHaveBeenCalled();
    expect(boundary.send).not.toHaveBeenCalled();
    expect(boundary.trackObservedSession).toHaveBeenCalledWith("session-early");
  });

  it.each(["completed", "live"] as const)(
    "does not track a %s Replay early response as a new active Session",
    async (mode) => {
      boundary.runGuards.mockImplementation(async (session) => {
        session.setSessionId("session-replay");
        return new Response("replayed", {
          status: 200,
          headers: { "x-cch-replay": mode },
        });
      });

      const response = await handleProxyRequest(createContext());

      expect(response.headers.get("x-cch-replay")).toBe(mode);
      expect(boundary.trackObservedSession).not.toHaveBeenCalled();
      expect(boundary.send).not.toHaveBeenCalled();
    }
  );

  it("does not track a handled warmup early response as an active Session", async () => {
    boundary.runGuards.mockImplementation(async (session) => {
      session.setSessionId("session-warmup");
      return new Response("warmed", { status: 200 });
    });

    const response = await handleProxyRequest(
      createContext({
        model: "claude-test",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Warmup",
                cache_control: { type: "ephemeral" },
              },
            ],
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    expect(boundary.trackObservedSession).not.toHaveBeenCalled();
    expect(boundary.send).not.toHaveBeenCalled();
  });

  it("releases exactly one concurrency count after acquiring it", async () => {
    boundary.runGuards.mockImplementation(async (session) => {
      session.setSessionId("session-forwarded");
      return null;
    });
    boundary.send.mockResolvedValue(new Response("forwarded", { status: 201 }));

    const response = await handleProxyRequest(createContext());

    expect(response.status).toBe(201);
    expect(await response.text()).toBe("forwarded");
    expect(boundary.incrementConcurrentCount).toHaveBeenCalledOnce();
    expect(boundary.incrementConcurrentCount).toHaveBeenCalledWith("session-forwarded");
    expect(boundary.decrementConcurrentCount).toHaveBeenCalledOnce();
    expect(boundary.decrementConcurrentCount).toHaveBeenCalledWith("session-forwarded");
  });
});
