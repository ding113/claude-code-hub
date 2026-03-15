import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";

const h = vi.hoisted(() => ({
  session: {
    originalFormat: "openai",
    sessionId: "s_hedge",
    requestUrl: new URL("http://localhost/v1/messages"),
    request: {
      model: "gpt-test",
      message: {},
    },
    authState: { success: true, user: null, key: null, apiKey: null },
    messageContext: null,
    provider: null,
    getEndpointPolicy() {
      return resolveEndpointPolicy(h.session.requestUrl.pathname);
    },
    setOriginalFormat: vi.fn(),
    recordForwardStart: vi.fn(),
  } as any,
  forwarderError: null as unknown,
  override: undefined as unknown,
  verboseProviderError: false,
  trackerCalls: [] as string[],
}));

vi.mock("@/app/v1/_lib/proxy/session", () => ({
  ProxySession: {
    fromContext: async () => h.session,
  },
}));

vi.mock("@/app/v1/_lib/proxy/guard-pipeline", () => ({
  GuardPipelineBuilder: {
    fromSession: () => ({
      run: async () => null,
    }),
  },
}));

vi.mock("@/app/v1/_lib/proxy/format-mapper", () => ({
  detectClientFormat: () => "openai",
  detectFormatByEndpoint: () => "openai",
}));

vi.mock("@/app/v1/_lib/proxy/forwarder", () => ({
  ProxyForwarder: {
    send: async () => {
      throw h.forwarderError;
    },
  },
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: async () => ({
    verboseProviderError: h.verboseProviderError,
  }),
}));

vi.mock("@/app/v1/_lib/proxy/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>();
  return {
    ...actual,
    getErrorOverrideAsync: vi.fn(async () => h.override),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    incrementConcurrentCount: async () => {
      h.trackerCalls.push("inc");
    },
    decrementConcurrentCount: async () => {
      h.trackerCalls.push("dec");
    },
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      startRequest: () => {
        h.trackerCalls.push("startRequest");
      },
      endRequest: () => {},
    }),
  },
}));

import { ProxyError } from "@/app/v1/_lib/proxy/errors";

describe("handleProxyRequest - hedge terminal error pipeline", async () => {
  const { handleProxyRequest } = await import("@/app/v1/_lib/proxy-handler");

  beforeEach(() => {
    h.trackerCalls.length = 0;
    h.override = undefined;
    h.verboseProviderError = false;
    h.forwarderError = new ProxyError("所有供应商暂时不可用，请稍后重试", 503);
    h.session.requestUrl = new URL("http://localhost/v1/messages");
    h.session.originalFormat = "openai";
    h.session.messageContext = null;
    h.session.provider = null;
  });

  test("verboseProviderError=false 时，hedge 终态错误应返回标准 envelope，而不是裸 upstream message", async () => {
    const res = await handleProxyRequest({} as any);

    expect(res.status).toBe(503);
    expect(res.headers.get("x-cch-session-id")).toBe("s_hedge");

    const body = await res.json();
    expect(body.error.message).toBe("所有供应商暂时不可用，请稍后重试 (cch_session_id: s_hedge)");
    expect(body.error.message).not.toContain("invalid key");
    expect(body.error.details).toBeUndefined();
  });

  test("命中 error override 时，应返回 override body/status，且保留 session id header", async () => {
    h.verboseProviderError = true;
    h.override = {
      statusCode: 451,
      response: {
        error: {
          type: "invalid_request_error",
          message: "hedge override",
          code: "provider_unavailable",
        },
      },
    };

    const res = await handleProxyRequest({} as any);

    expect(res.status).toBe(451);
    expect(res.headers.get("x-cch-session-id")).toBe("s_hedge");

    const body = await res.json();
    expect(body).toEqual({
      error: {
        type: "invalid_request_error",
        message: "hedge override (cch_session_id: s_hedge)",
        code: "provider_unavailable",
      },
    });
  });
});
