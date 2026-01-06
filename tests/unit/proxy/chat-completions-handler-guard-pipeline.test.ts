import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";

const h = vi.hoisted(() => ({
  callOrder: [] as string[],
  session: null as any,
  clientGuardResult: null as Response | null,
  warmupResult: null as Response | null,
  providerResult: null as Response | null,
  forwardError: null as Error | null,
  assignSessionId: true,
  forwardResponse: new Response("ok", { status: 200 }),
}));

vi.mock("@/app/v1/_lib/proxy/session", () => ({
  ProxySession: {
    fromContext: async () => h.session,
  },
}));

vi.mock("@/app/v1/_lib/proxy/auth-guard", () => ({
  ProxyAuthenticator: {
    ensure: async (session: any) => {
      h.callOrder.push("auth");
      session.authState = {
        success: true,
        user: {
          id: 1,
          name: "u",
          allowedClients: ["claude-cli"],
          allowedModels: [],
        },
        key: { id: 1, name: "k" },
        apiKey: "api-key",
      };
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/error-handler", () => ({
  ProxyErrorHandler: {
    handle: async () => {
      h.callOrder.push("errorHandler");
      return new Response("handled", { status: 502 });
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/client-guard", () => ({
  ProxyClientGuard: {
    ensure: async () => {
      h.callOrder.push("client");
      return h.clientGuardResult;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/model-guard", () => ({
  ProxyModelGuard: {
    ensure: async () => {
      h.callOrder.push("model");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/version-guard", () => ({
  ProxyVersionGuard: {
    ensure: async () => {
      h.callOrder.push("version");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/session-guard", () => ({
  ProxySessionGuard: {
    ensure: async (session: any) => {
      h.callOrder.push("session");
      if (h.assignSessionId) {
        session.sessionId ??= "session_assigned";
      }
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/warmup-guard", () => ({
  ProxyWarmupGuard: {
    ensure: async () => {
      h.callOrder.push("warmup");
      return h.warmupResult;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/request-filter", () => ({
  ProxyRequestFilter: {
    ensure: async () => {
      h.callOrder.push("requestFilter");
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/sensitive-word-guard", () => ({
  ProxySensitiveWordGuard: {
    ensure: async () => {
      h.callOrder.push("sensitive");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/rate-limit-guard", () => ({
  ProxyRateLimitGuard: {
    ensure: async () => {
      h.callOrder.push("rateLimit");
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  ProxyProviderResolver: {
    ensure: async (session: any) => {
      h.callOrder.push("provider");
      if (h.providerResult) return h.providerResult;
      session.provider = { id: 1, name: "p", providerType: "codex" };
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/provider-request-filter", () => ({
  ProxyProviderRequestFilter: {
    ensure: async () => {
      h.callOrder.push("providerRequestFilter");
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/message-service", () => ({
  ProxyMessageService: {
    ensureContext: async (session: any) => {
      h.callOrder.push("messageContext");
      session.messageContext = {
        id: 1,
        user: { id: 1, name: "u" },
        key: { name: "k" },
      };
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/forwarder", () => ({
  ProxyForwarder: {
    send: async () => {
      h.callOrder.push("forward");
      if (h.forwardError) {
        throw h.forwardError;
      }
      return h.forwardResponse;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/response-handler", () => ({
  ProxyResponseHandler: {
    dispatch: async (_session: any, response: Response) => {
      h.callOrder.push("dispatch");
      return response;
    },
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    incrementConcurrentCount: async () => {
      h.callOrder.push("concurrencyInc");
    },
    decrementConcurrentCount: async () => {
      h.callOrder.push("concurrencyDec");
    },
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      startRequest: () => undefined,
    }),
  },
}));

function createSession(requestMessage: Record<string, unknown>) {
  const session: any = {
    request: {
      message: requestMessage,
      model: typeof requestMessage.model === "string" ? requestMessage.model : null,
      log: "",
    },
    originalFormat: "claude",
    setOriginalFormat(format: any) {
      this.originalFormat = format;
    },
    isProbeRequest() {
      h.callOrder.push("probe");
      return false;
    },
    isCountTokensRequest() {
      return false;
    },
    requestUrl: new URL("http://localhost/v1/responses"),
    headers: new Headers(),
    userAgent: "codexcli/1.0",
    sessionId: null,
    provider: null,
    messageContext: null,
  };

  return session;
}

beforeEach(() => {
  h.callOrder.length = 0;
  h.clientGuardResult = null;
  h.warmupResult = null;
  h.providerResult = null;
  h.forwardError = null;
  h.assignSessionId = true;
  h.forwardResponse = new Response("ok", { status: 200 });
  h.session = null;
});

describe("handleChatCompletions：必须走 GuardPipeline", () => {
  test("请求体既不是 messages 也不是 input 时，应返回 400（不进入 pipeline）", async () => {
    h.session = createSession({});

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(400);
    expect(h.callOrder).toEqual([]);
  });

  test("OpenAI(messages) 但缺少 model 时，应返回 400（不进入 pipeline）", async () => {
    h.session = createSession({ messages: [{ role: "user", content: "hi" }] });

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(400);
    expect(h.callOrder).toEqual([]);
  });

  test("Response(input) 但缺少 model 时，应返回 400（不进入 pipeline）", async () => {
    h.session = createSession({
      input: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(400);
    expect(h.callOrder).toEqual([]);
  });

  test("OpenAI(messages) 转换阶段抛错时，应返回 400 transformation_error（不进入 pipeline）", async () => {
    const session = createSession({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "hi" }],
    });
    Object.freeze(session.request);
    h.session = session;

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(400);
    expect(h.callOrder).toEqual([]);

    const body = await res.json();
    expect(body?.error?.code).toBe("transformation_error");
  });

  test("client guard 早退时，应直接返回且不得 forward", async () => {
    h.session = createSession({
      input: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      model: "gpt-4.1-mini",
    });
    h.clientGuardResult = new Response(
      JSON.stringify({ error: { message: "Client not allowed" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(400);
    expect(h.callOrder).toEqual(["auth", "sensitive", "client"]);
    expect(h.callOrder).not.toContain("forward");
    expect(h.callOrder).not.toContain("dispatch");
  });

  test("warmup 早退时，不应进行并发计数（避免 decrement 未匹配 increment）", async () => {
    h.session = createSession({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });
    h.warmupResult = new Response("warmup", { status: 200 });

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(200);
    expect(h.callOrder).toEqual([
      "auth",
      "sensitive",
      "client",
      "model",
      "version",
      "probe",
      "session",
      "warmup",
    ]);
    expect(h.callOrder).not.toContain("concurrencyInc");
    expect(h.callOrder).not.toContain("concurrencyDec");
    expect(h.callOrder).not.toContain("forward");
    expect(h.callOrder).not.toContain("dispatch");
  });

  test("OpenAI(messages) 请求成功路径必须执行全链路 guards/filters 再 forward/dispatch", async () => {
    h.session = createSession({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(200);
    expect(h.callOrder).toEqual([
      "auth",
      "sensitive",
      "client",
      "model",
      "version",
      "probe",
      "session",
      "warmup",
      "requestFilter",
      "rateLimit",
      "provider",
      "providerRequestFilter",
      "messageContext",
      "concurrencyInc",
      "forward",
      "dispatch",
      "concurrencyDec",
    ]);
  });

  test("Response(input) 请求成功路径必须执行全链路 guards/filters 再 forward/dispatch", async () => {
    h.session = createSession({
      input: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      model: "gpt-4.1-mini",
      stream: false,
    });

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(200);
    expect(h.callOrder).toEqual([
      "auth",
      "sensitive",
      "client",
      "model",
      "version",
      "probe",
      "session",
      "warmup",
      "requestFilter",
      "rateLimit",
      "provider",
      "providerRequestFilter",
      "messageContext",
      "concurrencyInc",
      "forward",
      "dispatch",
      "concurrencyDec",
    ]);
  });

  test("当 sessionId 未分配时，不应进行并发计数（覆盖分支）", async () => {
    h.assignSessionId = false;
    h.session = createSession({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(200);
    expect(h.callOrder).not.toContain("concurrencyInc");
    expect(h.callOrder).not.toContain("concurrencyDec");
  });

  test("count_tokens 路径应选择 COUNT_TOKENS pipeline 且跳过并发计数（覆盖分支）", async () => {
    const session = createSession({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });
    session.isCountTokensRequest = () => true;
    h.session = session;

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(200);
    expect(h.callOrder).toEqual([
      "auth",
      "client",
      "model",
      "version",
      "probe",
      "requestFilter",
      "provider",
      "providerRequestFilter",
      "forward",
      "dispatch",
    ]);
    expect(h.callOrder).not.toContain("session");
    expect(h.callOrder).not.toContain("warmup");
    expect(h.callOrder).not.toContain("sensitive");
    expect(h.callOrder).not.toContain("rateLimit");
    expect(h.callOrder).not.toContain("messageContext");
    expect(h.callOrder).not.toContain("concurrencyInc");
    expect(h.callOrder).not.toContain("concurrencyDec");
  });

  test("startRequest 的 model 回退到 unknown（覆盖 || 分支）", async () => {
    const session = createSession({
      input: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      model: "gpt-4.1-mini",
      stream: false,
    });
    session.request.model = null;
    h.session = session;

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(200);
    expect(h.callOrder).toContain("messageContext");
    expect(h.callOrder).toContain("forward");
    expect(h.callOrder).toContain("dispatch");
  });

  test("development 模式下也应走全链路 guards/filters（覆盖调试分支）", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    try {
      h.session = createSession({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      });

      const { handleChatCompletions } = await import(
        "@/app/v1/_lib/codex/chat-completions-handler"
      );
      const res = await handleChatCompletions({} as any);

      expect(res.status).toBe(200);
      expect(h.callOrder).toContain("requestFilter");
      expect(h.callOrder).toContain("providerRequestFilter");
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  test("forwarder 抛错时，应进入 ProxyErrorHandler 并保证 finally 执行", async () => {
    h.session = createSession({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "hi" }],
    });
    h.forwardError = new Error("boom");

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(502);
    expect(h.callOrder).toContain("errorHandler");
    expect(h.callOrder).toContain("concurrencyDec");
    expect(h.callOrder).not.toContain("dispatch");
  });

  test("fromContext 抛 ProxyError 且 session 未创建时，应返回对应 statusCode", async () => {
    h.session = Promise.reject(new ProxyError("bad", 400));

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(400);
    expect(h.callOrder).toEqual([]);
  });

  test("fromContext 抛普通错误且 session 未创建时，应返回 500", async () => {
    h.session = Promise.reject(new Error("boom"));

    const { handleChatCompletions } = await import("@/app/v1/_lib/codex/chat-completions-handler");
    const res = await handleChatCompletions({} as any);

    expect(res.status).toBe(500);
    expect(h.callOrder).toEqual([]);
  });
});
