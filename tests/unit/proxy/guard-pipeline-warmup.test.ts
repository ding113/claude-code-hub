import { describe, expect, test, vi } from "vitest";

const callOrder: string[] = [];

vi.mock("@/app/v1/_lib/proxy/auth-guard", () => ({
  ProxyAuthenticator: {
    ensure: async () => {
      callOrder.push("auth");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/client-guard", () => ({
  ProxyClientGuard: {
    ensure: async () => {
      callOrder.push("client");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/model-guard", () => ({
  ProxyModelGuard: {
    ensure: async () => {
      callOrder.push("model");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/version-guard", () => ({
  ProxyVersionGuard: {
    ensure: async () => {
      callOrder.push("version");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/session-guard", () => ({
  ProxySessionGuard: {
    ensure: async () => {
      callOrder.push("session");
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/warmup-guard", () => ({
  ProxyWarmupGuard: {
    ensure: async () => {
      callOrder.push("warmup");
      return new Response("ok", { status: 200 });
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/request-filter", () => ({
  ProxyRequestFilter: {
    ensure: async () => {
      callOrder.push("requestFilter");
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/sensitive-word-guard", () => ({
  ProxySensitiveWordGuard: {
    ensure: async () => {
      callOrder.push("sensitive");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/rate-limit-guard", () => ({
  ProxyRateLimitGuard: {
    ensure: async () => {
      callOrder.push("rateLimit");
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  ProxyProviderResolver: {
    ensure: async () => {
      callOrder.push("provider");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/provider-request-filter", () => ({
  ProxyProviderRequestFilter: {
    ensure: async () => {
      callOrder.push("providerRequestFilter");
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/message-service", () => ({
  ProxyMessageService: {
    ensureContext: async () => {
      callOrder.push("messageContext");
    },
  },
}));

describe("GuardPipeline：warmup 拦截点", () => {
  test("CHAT pipeline 必须包含 warmup，且位于 session 之后、requestFilter 之前", async () => {
    const { CHAT_PIPELINE } = await import("@/app/v1/_lib/proxy/guard-pipeline");

    const sensitiveIdx = CHAT_PIPELINE.steps.indexOf("sensitive");
    const sessionIdx = CHAT_PIPELINE.steps.indexOf("session");
    const warmupIdx = CHAT_PIPELINE.steps.indexOf("warmup");
    const requestFilterIdx = CHAT_PIPELINE.steps.indexOf("requestFilter");

    expect(sensitiveIdx).toBeGreaterThanOrEqual(0);
    expect(sessionIdx).toBeGreaterThanOrEqual(0);
    expect(sensitiveIdx).toBeLessThan(sessionIdx);
    expect(warmupIdx).toBe(sessionIdx + 1);
    expect(requestFilterIdx).toBeGreaterThan(warmupIdx);
  });

  test("warmup 抢答后应提前结束，不应触发 rateLimit/provider 等后续步骤", async () => {
    callOrder.length = 0;

    const { GuardPipelineBuilder, RequestType } = await import(
      "@/app/v1/_lib/proxy/guard-pipeline"
    );

    const pipeline = GuardPipelineBuilder.fromRequestType(RequestType.CHAT);

    const session = {
      isProbeRequest: () => {
        callOrder.push("probe");
        return false;
      },
    } as any;

    const res = await pipeline.run(session);

    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    expect(callOrder).toEqual([
      "auth",
      "sensitive",
      "client",
      "model",
      "version",
      "probe",
      "session",
      "warmup",
    ]);
    expect(callOrder).not.toContain("rateLimit");
    expect(callOrder).not.toContain("provider");
    expect(callOrder).not.toContain("messageContext");
  });

  test("probe 请求应在 probe 步骤提前结束，不应触发 session/warmup 等后续步骤", async () => {
    callOrder.length = 0;

    const { GuardPipelineBuilder, RequestType } = await import(
      "@/app/v1/_lib/proxy/guard-pipeline"
    );

    const pipeline = GuardPipelineBuilder.fromRequestType(RequestType.CHAT);

    const session = {
      isProbeRequest: () => {
        callOrder.push("probe");
        return true;
      },
    } as any;

    const res = await pipeline.run(session);

    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    expect(callOrder).toEqual(["auth", "sensitive", "client", "model", "version", "probe"]);
    expect(callOrder).not.toContain("session");
    expect(callOrder).not.toContain("warmup");
    expect(callOrder).not.toContain("rateLimit");
    expect(callOrder).not.toContain("provider");
    expect(callOrder).not.toContain("messageContext");
  });

  test("COUNT_TOKENS pipeline 应走最小链路（且覆盖 fromRequestType 分支）", async () => {
    callOrder.length = 0;

    const { GuardPipelineBuilder, RequestType } = await import(
      "@/app/v1/_lib/proxy/guard-pipeline"
    );

    const pipeline = GuardPipelineBuilder.fromRequestType(RequestType.COUNT_TOKENS);

    const session = {
      isProbeRequest: () => {
        callOrder.push("probe");
        return false;
      },
    } as any;

    const res = await pipeline.run(session);

    expect(res).toBeNull();
    expect(callOrder).toEqual([
      "auth",
      "client",
      "model",
      "version",
      "probe",
      "requestFilter",
      "provider",
      "providerRequestFilter",
    ]);
    expect(callOrder).not.toContain("session");
    expect(callOrder).not.toContain("warmup");
    expect(callOrder).not.toContain("sensitive");
    expect(callOrder).not.toContain("rateLimit");
    expect(callOrder).not.toContain("messageContext");
  });
});
