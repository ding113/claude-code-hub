import { describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { V1_ENDPOINT_PATHS } from "@/app/v1/_lib/proxy/endpoint-paths";
import { ProxyResponses } from "@/app/v1/_lib/proxy/responses";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";
import { DbPoolAdmissionError } from "@/drizzle/admitted-client";

const h = vi.hoisted(() => ({
  session: {
    originalFormat: "openai",
    sessionId: "s_123",
    requestUrl: new URL("http://localhost/v1/messages"),
    request: {
      model: "gpt",
      message: {},
    },
    getEndpointPolicy: () => resolveEndpointPolicy(h.session.requestUrl.pathname),
    isCountTokensRequest: () => false,
    getProviderChain: () => [],
    setOriginalFormat: () => {},
    setHighConcurrencyModeEnabled(enabled: boolean) {
      h.session.highConcurrencyModeEnabled = enabled;
    },
    setRawCrossProviderFallbackEnabled(enabled: boolean) {
      h.session.rawCrossProviderFallbackEnabled = enabled;
    },
    isRawCrossProviderFallbackEnabled: () => !!h.session.rawCrossProviderFallbackEnabled,
    recordForwardStart: () => {},
    messageContext: null,
    provider: null,
    highConcurrencyModeEnabled: false,
    rawCrossProviderFallbackEnabled: false,
  } as any,

  fromContextError: null as unknown,
  pipelineError: null as unknown,
  earlyResponse: null as Response | null,
  forwardResponse: new Response("ok", { status: 200 }),
  dispatchedResponse: null as Response | null,

  settingsError: null as unknown,
  systemSettings: {} as Record<string, unknown>,
  fakeStreamingResponse: null as Response | null,
  normalizeInputCalls: 0,

  endpointFormat: null as string | null,
  clientFormat: "openai" as string,
  trackerCalls: [] as string[],
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    getCachedSystemSettings: async () => {
      if (h.settingsError) throw h.settingsError;
      return h.systemSettings;
    },
  };
});

vi.mock("@/app/v1/_lib/proxy/fake-streaming/proxy-integration", () => ({
  tryFakeStreamingPath: async () => h.fakeStreamingResponse,
}));

vi.mock("@/app/v1/_lib/proxy/response-input-rectifier", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/v1/_lib/proxy/response-input-rectifier")>();
  return {
    ...actual,
    normalizeResponseInput: async () => {
      h.normalizeInputCalls += 1;
    },
  };
});

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
    fromSession: () => ({
      run: async () => {
        if (h.pipelineError) throw h.pipelineError;
        return h.earlyResponse;
      },
    }),
    fromRequestType: () => ({
      run: async () => {
        if (h.pipelineError) throw h.pipelineError;
        return h.earlyResponse;
      },
    }),
  },
}));

vi.mock("@/app/v1/_lib/proxy/format-mapper", () => ({
  detectClientFormat: () => h.clientFormat,
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

async function expectMessageSuffixOnly(
  response: Response,
  expectedStatus: number,
  expectedMessage: string
) {
  expect(response.status).toBe(expectedStatus);
  expect(response.headers.get("x-cch-session-id")).toBeNull();

  const body = await response.json();
  expect(body.error.message).toBe(`${expectedMessage} (cch_session_id: s_123)`);
}

describe("handleProxyRequest - session id on errors", async () => {
  const { handleProxyRequest } = await import("@/app/v1/_lib/proxy-handler");

  test("decorates early error response with message suffix only", async () => {
    h.fromContextError = null;
    h.session.originalFormat = "openai";
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.earlyResponse = ProxyResponses.buildError(400, "bad request");
    const res = await handleProxyRequest({} as any);

    await expectMessageSuffixOnly(res, 400, "bad request");
  });

  test("decorates dispatch error response with message suffix only", async () => {
    h.fromContextError = null;
    h.session.originalFormat = "openai";
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.earlyResponse = null;
    h.forwardResponse = new Response("upstream", { status: 502 });
    h.dispatchedResponse = ProxyResponses.buildError(502, "bad gateway");

    const res = await handleProxyRequest({} as any);

    await expectMessageSuffixOnly(res, 502, "bad gateway");
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
    await expectMessageSuffixOnly(res, 400, "bad request");
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

  test.each([
    {
      pathname: V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS,
      isCountTokensRequest: true,
    },
    {
      pathname: V1_ENDPOINT_PATHS.RESPONSES_COMPACT,
      isCountTokensRequest: false,
    },
  ])("raw endpoint $pathname 应统一跳过并发计数", async ({ pathname, isCountTokensRequest }) => {
    h.fromContextError = null;
    h.session.originalFormat = "claude";
    h.endpointFormat = "openai";
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.earlyResponse = null;
    h.forwardResponse = new Response("ok", { status: 200 });
    h.dispatchedResponse = null;

    h.session.requestUrl = new URL(`http://localhost${pathname}`);
    h.session.getEndpointPolicy = () => resolveEndpointPolicy(h.session.requestUrl.pathname);
    h.session.sessionId = "s_123";
    h.session.messageContext = { id: 1, user: { id: 1, name: "u" }, key: { name: "k" } };
    h.session.provider = { id: 1, name: "p" };
    h.session.isCountTokensRequest = () => isCountTokensRequest;

    const res = await handleProxyRequest({} as any);

    expect(res.status).toBe(200);
    expect(h.trackerCalls).toEqual(["startRequest"]);
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

  test.each([
    { label: "Error", settingsError: new Error("settings backend down") as unknown },
    { label: "非 Error 值", settingsError: "settings string failure" as unknown },
    { label: "数据库准入错误", settingsError: new DbPoolAdmissionError("app", 16) as unknown },
  ])("settings 加载抛出 $label 时降级关闭开关并继续请求", async ({ settingsError }) => {
    h.fromContextError = null;
    h.session.originalFormat = "openai";
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.earlyResponse = null;
    h.forwardResponse = new Response("ok", { status: 200 });
    h.dispatchedResponse = null;
    h.settingsError = settingsError;
    h.systemSettings = {};
    // settings 失败时 cachedSystemSettings 为 null，fake streaming 必须被跳过
    h.fakeStreamingResponse = ProxyResponses.buildError(500, "fake streaming should be skipped");
    h.session.requestUrl = new URL("http://localhost/v1/messages");
    h.session.getEndpointPolicy = () => resolveEndpointPolicy(h.session.requestUrl.pathname);
    h.session.request = { model: "gpt", message: {} };
    h.session.sessionId = "s_123";
    h.session.messageContext = null;
    h.session.provider = null;
    h.session.highConcurrencyModeEnabled = null;
    h.session.rawCrossProviderFallbackEnabled = null;

    const res = await handleProxyRequest({} as any);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(h.session.highConcurrencyModeEnabled).toBe(false);
    expect(h.session.rawCrossProviderFallbackEnabled).toBe(false);

    h.settingsError = null;
    h.fakeStreamingResponse = null;
  });

  test("response 格式请求在 guard pipeline 前执行 input 规范化", async () => {
    h.fromContextError = null;
    h.session.originalFormat = "response";
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.settingsError = null;
    h.systemSettings = {};
    h.fakeStreamingResponse = null;
    h.normalizeInputCalls = 0;
    h.earlyResponse = ProxyResponses.buildError(400, "invalid input");
    h.session.requestUrl = new URL("http://localhost/v1/responses");
    h.session.getEndpointPolicy = () => resolveEndpointPolicy(h.session.requestUrl.pathname);
    h.session.request = { model: "gpt", message: {} };
    h.session.sessionId = "s_123";
    h.session.messageContext = null;
    h.session.provider = null;

    const res = await handleProxyRequest({} as any);

    await expectMessageSuffixOnly(res, 400, "invalid input");
    expect(h.normalizeInputCalls).toBe(1);
  });

  test("fake streaming 错误响应同样附加 session id 后缀", async () => {
    h.fromContextError = null;
    h.session.originalFormat = "openai";
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.earlyResponse = null;
    h.dispatchedResponse = null;
    h.settingsError = null;
    h.systemSettings = {
      enableHighConcurrencyMode: true,
      allowNonConversationEndpointProviderFallback: false,
    };
    h.fakeStreamingResponse = ProxyResponses.buildError(502, "fake streaming upstream failed");
    h.session.requestUrl = new URL("http://localhost/v1/messages");
    h.session.getEndpointPolicy = () => resolveEndpointPolicy(h.session.requestUrl.pathname);
    h.session.request = { model: "", message: {} };
    h.session.sessionId = "s_123";
    h.session.messageContext = { id: 1, user: { id: 1, name: "u" }, key: { name: "k" } };
    h.session.provider = { id: 1, name: "p" };

    const res = await handleProxyRequest({} as any);

    await expectMessageSuffixOnly(res, 502, "fake streaming upstream failed");
    expect(h.session.highConcurrencyModeEnabled).toBe(true);
    expect(h.session.rawCrossProviderFallbackEnabled).toBe(false);
    expect(h.trackerCalls).toEqual(["inc", "startRequest", "dec"]);

    h.fakeStreamingResponse = null;
  });

  test("缺少 session id 时跳过并发计数与错误装饰", async () => {
    h.fromContextError = null;
    h.session.originalFormat = "openai";
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.earlyResponse = null;
    h.settingsError = null;
    h.systemSettings = {};
    h.fakeStreamingResponse = null;
    h.forwardResponse = new Response("upstream", { status: 502 });
    h.dispatchedResponse = ProxyResponses.buildError(502, "upstream failed");
    h.session.requestUrl = new URL("http://localhost/v1/messages");
    h.session.getEndpointPolicy = () => resolveEndpointPolicy(h.session.requestUrl.pathname);
    h.session.request = { model: "gpt", message: {} };
    h.session.sessionId = null;
    h.session.messageContext = null;
    h.session.provider = null;

    const res = await handleProxyRequest({} as any);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.message).toBe("upstream failed");
    expect(h.trackerCalls).toEqual([]);

    h.session.sessionId = "s_123";
  });

  test("claude body detection keeps claude format without debug branch", async () => {
    h.fromContextError = null;
    h.session.originalFormat = "claude";
    h.endpointFormat = null;
    h.clientFormat = "claude";
    h.trackerCalls.length = 0;
    h.pipelineError = null;
    h.settingsError = null;
    h.systemSettings = {};
    h.fakeStreamingResponse = null;
    h.earlyResponse = ProxyResponses.buildError(400, "bad request");
    h.session.requestUrl = new URL("http://localhost/v1/unknown");
    h.session.getEndpointPolicy = () => resolveEndpointPolicy(h.session.requestUrl.pathname);
    h.session.request = { model: "gpt", message: {} };
    h.session.sessionId = "s_123";
    h.session.messageContext = null;
    h.session.provider = null;

    const res = await handleProxyRequest({} as any);

    await expectMessageSuffixOnly(res, 400, "bad request");

    h.clientFormat = "openai";
  });

  test.each([
    { label: "数据库准入错误", pipelineError: new DbPoolAdmissionError("app", 16) as unknown },
    { label: "非 Error 值", pipelineError: "guard exploded" as unknown },
  ])("pipeline 抛出 $label 时仍走 ProxyErrorHandler", async ({ pipelineError }) => {
    h.fromContextError = null;
    h.session.originalFormat = "openai";
    h.endpointFormat = null;
    h.trackerCalls.length = 0;
    h.pipelineError = pipelineError;
    h.settingsError = null;
    h.systemSettings = {};
    h.fakeStreamingResponse = null;
    h.earlyResponse = null;
    h.session.requestUrl = new URL("http://localhost/v1/messages");
    h.session.getEndpointPolicy = () => resolveEndpointPolicy(h.session.requestUrl.pathname);
    h.session.request = { model: "gpt", message: {} };
    h.session.sessionId = "s_123";
    h.session.messageContext = null;
    h.session.provider = null;

    const res = await handleProxyRequest({} as any);

    expect(res.status).toBe(502);
    expect(await res.text()).toBe("handled");

    h.pipelineError = null;
  });
});
