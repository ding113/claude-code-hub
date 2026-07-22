import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

type ProxySettingsFixture = {
  readonly enableHighConcurrencyMode: boolean;
  readonly allowNonConversationEndpointProviderFallback: boolean;
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
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({ endRequest: vi.fn(), startRequest: vi.fn() }),
  },
}));

import { handleProxyRequest } from "@/app/v1/_lib/proxy-handler";

function createContext(): Context {
  const request = new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-test", messages: [] }),
  });
  return new Context(request);
}

describe("handleProxyRequest concurrency ownership", () => {
  beforeEach(() => {
    boundary.runGuards.mockReset();
    boundary.send.mockReset();
    boundary.incrementConcurrentCount.mockReset();
    boundary.decrementConcurrentCount.mockReset();
    boundary.loadSettings.mockResolvedValue({
      enableHighConcurrencyMode: false,
      allowNonConversationEndpointProviderFallback: true,
    });
    boundary.incrementConcurrentCount.mockResolvedValue(undefined);
    boundary.decrementConcurrentCount.mockResolvedValue(undefined);
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
