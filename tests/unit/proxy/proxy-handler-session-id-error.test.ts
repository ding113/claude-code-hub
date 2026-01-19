import { describe, expect, test, vi } from "vitest";
import { ProxyResponses } from "@/app/v1/_lib/proxy/responses";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";

const h = vi.hoisted(() => ({
  session: {
    originalFormat: "openai",
    sessionId: "s_123",
    requestUrl: new URL("http://localhost/v1/messages"),
    request: {
      model: "gpt",
      message: {},
    },
    isCountTokensRequest: () => false,
    setOriginalFormat: () => {},
    messageContext: null,
    provider: null,
  } as any,

  fromContextError: null as unknown,
  pipelineError: null as unknown,
  earlyResponse: null as Response | null,
  forwardResponse: new Response("ok", { status: 200 }),
  dispatchedResponse: null as Response | null,

  endpointFormat: null as string | null,
  trackerCalls: [] as string[],
}));

vi.mock("@/app/v1/_lib/proxy/session", () => ({
  ProxySession: {
    fromContext: async () => {
      if (h.fromContextError) throw h.fromContextError;
      return h.session;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/guard-pipeline", () => ({
  RequestType: { CHAT: "CHAT", COUNT_TOKENS: "COUNT_TOKENS" },
  GuardPipelineBuilder: {
    fromRequestType: () => ({
      run: async () => {
        if (h.pipelineError) throw h.pipelineError;
        return h.earlyResponse;
      },
    }),
  },
}));

vi.mock("@/app/v1/_lib/proxy/format-mapper", () => ({
  detectClientFormat: () => "openai",
  detectFormatByEndpoint: () => h.endpointFormat,
}));

vi.mock("@/app/v1/_lib/proxy/forwarder", () => ({
  ProxyForwarder: {
    send: async () => h.forwardResponse,
  },
}));

vi.mock("@/app/v1/_lib/proxy/response-handler", () => ({
  ProxyResponseHandler: {
    dispatch: async () => h.dispatchedResponse ?? h.forwardResponse,
  },
}));

vi.mock("@/app/v1/_lib/proxy/error-handler", () => ({
  ProxyErrorHandler: {
    handle: async () => new Response("handled", { status: 502 }),
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

describe("handleProxyRequest - session id on errors", async () => {
  const { handleProxyRequest } = await import("@/app/v1/_lib/proxy-handler");

  test("decorates early error response with x-cch-session-id and message suffix", async () => {
    h.fromContextError = null;
    h.session.originalFormat = "openai";
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.earlyResponse = ProxyResponses.buildError(400, "bad request");
    const res = await handleProxyRequest({} as any);

    expect(res.status).toBe(400);
    expect(res.headers.get("x-cch-session-id")).toBe("s_123");

    const body = await res.json();
    expect(body.error.message).toBe("bad request (cch_session_id: s_123)");
  });

  test("decorates dispatch error response with x-cch-session-id and message suffix", async () => {
    h.fromContextError = null;
    h.session.originalFormat = "openai";
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.earlyResponse = null;
    h.forwardResponse = new Response("upstream", { status: 502 });
    h.dispatchedResponse = ProxyResponses.buildError(502, "bad gateway");

    const res = await handleProxyRequest({} as any);

    expect(res.status).toBe(502);
    expect(res.headers.get("x-cch-session-id")).toBe("s_123");

    const body = await res.json();
    expect(body.error.message).toBe("bad gateway (cch_session_id: s_123)");
  });

  test("covers claude format detection branch without breaking behavior", async () => {
    h.fromContextError = null;
    h.session.originalFormat = "claude";
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.earlyResponse = ProxyResponses.buildError(400, "bad request");
    h.session.requestUrl = new URL("http://localhost/v1/unknown");
    h.session.request = { model: "gpt", message: { contents: [] } };

    const res = await handleProxyRequest({} as any);
    expect(res.status).toBe(400);
    expect(res.headers.get("x-cch-session-id")).toBe("s_123");
  });

  test("covers endpoint format detection + tracking + finally decrement", async () => {
    h.fromContextError = null;
    h.session.originalFormat = "claude";
    h.endpointFormat = "openai";
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.earlyResponse = null;
    h.forwardResponse = new Response("ok", { status: 200 });
    h.dispatchedResponse = null;

    h.session.sessionId = "s_123";
    h.session.messageContext = { id: 1, user: { id: 1, name: "u" }, key: { name: "k" } };
    h.session.provider = { id: 1, name: "p" };
    h.session.isCountTokensRequest = () => false;

    const res = await handleProxyRequest({} as any);
    expect(res.status).toBe(200);
    expect(h.trackerCalls).toEqual(["inc", "startRequest", "dec"]);
  });

  test("session not created and ProxyError thrown: returns buildError without session header", async () => {
    h.fromContextError = new ProxyError("upstream", 401);
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.earlyResponse = null;

    const res = await handleProxyRequest({} as any);
    expect(res.status).toBe(401);
    expect(res.headers.get("x-cch-session-id")).toBeNull();
    const body = await res.json();
    expect(body.error.message).toBe("upstream");
  });

  test("session created but pipeline throws: routes to ProxyErrorHandler.handle", async () => {
    h.fromContextError = null;
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = new Error("pipeline boom");
    h.earlyResponse = null;

    const res = await handleProxyRequest({} as any);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("handled");
  });

  test("session not created and non-ProxyError thrown: returns 500 buildError", async () => {
    h.fromContextError = new Error("boom");
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.earlyResponse = null;

    const res = await handleProxyRequest({} as any);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toBe("代理请求发生未知错误");
  });
});
