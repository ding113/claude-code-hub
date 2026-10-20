import { describe, expect, test, vi } from "vitest";

const callOrder: string[] = [];
let replayResult: Response | null = null;

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
      return null;
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

vi.mock("@/app/v1/_lib/proxy/replay/replay-guard", () => ({
  ProxyReplayGuard: {
    ensure: async () => {
      callOrder.push("replayAttach");
      return replayResult;
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

describe("GuardPipeline：全链路放行与 replay 短路", () => {
  test("warmup 未命中时 CHAT pipeline 应按序执行全部步骤并返回 null 交给 forwarder", async () => {
    callOrder.length = 0;
    replayResult = null;

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

    expect(res).toBeNull();
    expect(callOrder).toEqual([
      "auth",
      "sensitive",
      "client",
      "model",
      "version",
      "probe",
      "session",
      "warmup",
      "requestFilter",
      "replayAttach",
      "rateLimit",
      "provider",
      "providerRequestFilter",
      "messageContext",
    ]);
  });

  test("replayAttach 命中缓存时应在 rateLimit 之前短路返回缓存响应", async () => {
    callOrder.length = 0;
    replayResult = new Response("cached", { status: 200 });

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
    await expect(res?.text()).resolves.toBe("cached");
    expect(callOrder).toEqual([
      "auth",
      "sensitive",
      "client",
      "model",
      "version",
      "probe",
      "session",
      "warmup",
      "requestFilter",
      "replayAttach",
    ]);
    expect(callOrder).not.toContain("rateLimit");
    expect(callOrder).not.toContain("provider");
    expect(callOrder).not.toContain("messageContext");
  });

  test("fromSession 应优先采用 isRawCrossProviderFallbackEnabled 的返回值，false 时退回 raw passthrough preset", async () => {
    callOrder.length = 0;
    replayResult = null;

    const { GuardPipelineBuilder } = await import("@/app/v1/_lib/proxy/guard-pipeline");

    let flagCalls = 0;
    const session = {
      getEndpointPolicy: () => ({
        guardPreset: "raw_passthrough",
        allowRawCrossProviderFallback: true,
      }),
      isRawCrossProviderFallbackEnabled: () => {
        flagCalls += 1;
        return false;
      },
      isProbeRequest: () => {
        callOrder.push("probe");
        return false;
      },
    } as any;

    const pipeline = GuardPipelineBuilder.fromSession(session);
    const res = await pipeline.run(session);

    expect(flagCalls).toBe(1);
    expect(res).toBeNull();
    expect(callOrder).toEqual(["auth", "client", "model", "version", "probe", "provider"]);
    expect(callOrder).not.toContain("session");
    expect(callOrder).not.toContain("messageContext");
  });
});
