import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  type EndpointPolicy,
  isRawPassthroughEndpointPath,
  isRawPassthroughEndpointPolicy,
  resolveEndpointPolicy,
} from "@/app/v1/_lib/proxy/endpoint-policy";
import { V1_ENDPOINT_PATHS } from "@/app/v1/_lib/proxy/endpoint-paths";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const RAW_PASSTHROUGH_ENDPOINTS = [
  V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS,
  V1_ENDPOINT_PATHS.RESPONSES_COMPACT,
] as const;

const DEFAULT_ENDPOINTS = [
  V1_ENDPOINT_PATHS.MESSAGES,
  V1_ENDPOINT_PATHS.RESPONSES,
  V1_ENDPOINT_PATHS.CHAT_COMPLETIONS,
] as const;

// ---------------------------------------------------------------------------
// T11: Endpoint parity -- count_tokens and responses/compact produce
//      identical EndpointPolicy objects and exhibit identical behaviour
//      under provider errors.
// ---------------------------------------------------------------------------

describe("T11: raw passthrough endpoint parity", () => {
  test("count_tokens and responses/compact resolve to the exact same EndpointPolicy object", () => {
    const countTokensPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS);
    const compactPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);

    // Reference equality: same frozen singleton
    expect(countTokensPolicy).toBe(compactPolicy);

    // Both recognized as raw_passthrough
    expect(isRawPassthroughEndpointPolicy(countTokensPolicy)).toBe(true);
    expect(isRawPassthroughEndpointPolicy(compactPolicy)).toBe(true);
  });

  test("both raw passthrough endpoints have identical strict policy fields", () => {
    const countTokensPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS);
    const compactPolicy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);

    const expectedPolicy: EndpointPolicy = {
      kind: "raw_passthrough",
      guardPreset: "raw_passthrough",
      allowRetry: false,
      allowProviderSwitch: false,
      allowCircuitBreakerAccounting: false,
      trackConcurrentRequests: false,
      bypassRequestFilters: true,
      bypassForwarderPreprocessing: true,
      bypassSpecialSettings: true,
      bypassResponseRectifier: true,
      endpointPoolStrictness: "strict",
    };

    expect(countTokensPolicy).toEqual(expectedPolicy);
    expect(compactPolicy).toEqual(expectedPolicy);
  });

  test("under provider error, both endpoints result in no retry, no provider switch, no circuit breaker accounting", () => {
    for (const pathname of RAW_PASSTHROUGH_ENDPOINTS) {
      const policy = resolveEndpointPolicy(pathname);

      expect(policy.allowRetry).toBe(false);
      expect(policy.allowProviderSwitch).toBe(false);
      expect(policy.allowCircuitBreakerAccounting).toBe(false);
    }
  });

  test("isRawPassthroughEndpointPath returns true for both raw passthrough canonical paths", () => {
    for (const pathname of RAW_PASSTHROUGH_ENDPOINTS) {
      expect(isRawPassthroughEndpointPath(pathname)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// T12: Bypass completeness -- spy-based zero-call assertions to verify that
//      request filter guards early-return without invoking the engine.
// ---------------------------------------------------------------------------

const applyGlobalMock = vi.fn(async () => {});
const applyForProviderMock = vi.fn(async () => {});

vi.mock("@/lib/request-filter-engine", () => ({
  requestFilterEngine: {
    applyGlobal: applyGlobalMock,
    applyForProvider: applyForProviderMock,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

describe("T12: bypass completeness (spy-based zero-call assertions)", () => {
  beforeEach(() => {
    applyGlobalMock.mockClear();
    applyForProviderMock.mockClear();
  });

  test("ProxyRequestFilter.ensure early-returns without calling applyGlobal for raw passthrough", async () => {
    const { ProxyRequestFilter } = await import("@/app/v1/_lib/proxy/request-filter");

    for (const pathname of RAW_PASSTHROUGH_ENDPOINTS) {
      applyGlobalMock.mockClear();

      const session = {
        getEndpointPolicy: () => resolveEndpointPolicy(pathname),
      } as any;

      await ProxyRequestFilter.ensure(session);
      expect(applyGlobalMock).not.toHaveBeenCalled();
    }
  });

  test("ProxyProviderRequestFilter.ensure early-returns without calling applyForProvider for raw passthrough", async () => {
    const { ProxyProviderRequestFilter } = await import(
      "@/app/v1/_lib/proxy/provider-request-filter"
    );

    for (const pathname of RAW_PASSTHROUGH_ENDPOINTS) {
      applyForProviderMock.mockClear();

      const session = {
        getEndpointPolicy: () => resolveEndpointPolicy(pathname),
        provider: { id: 1 },
      } as any;

      await ProxyProviderRequestFilter.ensure(session);
      expect(applyForProviderMock).not.toHaveBeenCalled();
    }
  });

  test("ProxyRequestFilter.ensure calls applyGlobal for default policy endpoints", async () => {
    const { ProxyRequestFilter } = await import("@/app/v1/_lib/proxy/request-filter");

    for (const pathname of DEFAULT_ENDPOINTS) {
      applyGlobalMock.mockClear();

      const session = {
        getEndpointPolicy: () => resolveEndpointPolicy(pathname),
      } as any;

      await ProxyRequestFilter.ensure(session);
      expect(applyGlobalMock).toHaveBeenCalledTimes(1);
    }
  });

  test("ProxyProviderRequestFilter.ensure calls applyForProvider for default policy endpoints", async () => {
    const { ProxyProviderRequestFilter } = await import(
      "@/app/v1/_lib/proxy/provider-request-filter"
    );

    for (const pathname of DEFAULT_ENDPOINTS) {
      applyForProviderMock.mockClear();

      const session = {
        getEndpointPolicy: () => resolveEndpointPolicy(pathname),
        provider: { id: 1 },
      } as any;

      await ProxyProviderRequestFilter.ensure(session);
      expect(applyForProviderMock).toHaveBeenCalledTimes(1);
    }
  });
});

// ---------------------------------------------------------------------------
// T13: Non-target regression -- default endpoints retain full default policy.
// ---------------------------------------------------------------------------

describe("T13: non-target regression (default policy preserved)", () => {
  const expectedDefaultPolicy: EndpointPolicy = {
    kind: "default",
    guardPreset: "chat",
    allowRetry: true,
    allowProviderSwitch: true,
    allowCircuitBreakerAccounting: true,
    trackConcurrentRequests: true,
    bypassRequestFilters: false,
    bypassForwarderPreprocessing: false,
    bypassSpecialSettings: false,
    bypassResponseRectifier: false,
    endpointPoolStrictness: "inherit",
  };

  test("/v1/messages retains full default policy", () => {
    const policy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.MESSAGES);
    expect(policy).toEqual(expectedDefaultPolicy);
    expect(isRawPassthroughEndpointPolicy(policy)).toBe(false);
  });

  test("/v1/responses retains full default policy", () => {
    const policy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.RESPONSES);
    expect(policy).toEqual(expectedDefaultPolicy);
    expect(isRawPassthroughEndpointPolicy(policy)).toBe(false);
  });

  test("/v1/chat/completions retains full default policy", () => {
    const policy = resolveEndpointPolicy(V1_ENDPOINT_PATHS.CHAT_COMPLETIONS);
    expect(policy).toEqual(expectedDefaultPolicy);
    expect(isRawPassthroughEndpointPolicy(policy)).toBe(false);
  });

  test("all default endpoints resolve to the same singleton object", () => {
    const policies = DEFAULT_ENDPOINTS.map((p) => resolveEndpointPolicy(p));
    // All should be the same reference
    for (let i = 1; i < policies.length; i++) {
      expect(policies[i]).toBe(policies[0]);
    }
  });

  test("default policy has all bypass flags set to false", () => {
    for (const pathname of DEFAULT_ENDPOINTS) {
      const policy = resolveEndpointPolicy(pathname);
      expect(policy.bypassRequestFilters).toBe(false);
      expect(policy.bypassForwarderPreprocessing).toBe(false);
      expect(policy.bypassSpecialSettings).toBe(false);
      expect(policy.bypassResponseRectifier).toBe(false);
    }
  });

  test("default policy has all allow flags set to true", () => {
    for (const pathname of DEFAULT_ENDPOINTS) {
      const policy = resolveEndpointPolicy(pathname);
      expect(policy.allowRetry).toBe(true);
      expect(policy.allowProviderSwitch).toBe(true);
      expect(policy.allowCircuitBreakerAccounting).toBe(true);
      expect(policy.trackConcurrentRequests).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// T14: Path edge-case tests -- normalization handles trailing slashes, case
//      variants, query strings, and non-matching paths correctly.
// ---------------------------------------------------------------------------

describe("T14: path edge-case normalization", () => {
  test("trailing slash: /v1/messages/count_tokens/ -> raw_passthrough", () => {
    expect(isRawPassthroughEndpointPath("/v1/messages/count_tokens/")).toBe(true);
    const policy = resolveEndpointPolicy("/v1/messages/count_tokens/");
    expect(policy.kind).toBe("raw_passthrough");
  });

  test("trailing slash: /v1/responses/compact/ -> raw_passthrough", () => {
    expect(isRawPassthroughEndpointPath("/v1/responses/compact/")).toBe(true);
    const policy = resolveEndpointPolicy("/v1/responses/compact/");
    expect(policy.kind).toBe("raw_passthrough");
  });

  test("uppercase: /V1/MESSAGES/COUNT_TOKENS -> raw_passthrough", () => {
    expect(isRawPassthroughEndpointPath("/V1/MESSAGES/COUNT_TOKENS")).toBe(true);
    const policy = resolveEndpointPolicy("/V1/MESSAGES/COUNT_TOKENS");
    expect(policy.kind).toBe("raw_passthrough");
  });

  test("uppercase: /V1/RESPONSES/COMPACT -> raw_passthrough", () => {
    expect(isRawPassthroughEndpointPath("/V1/RESPONSES/COMPACT")).toBe(true);
    const policy = resolveEndpointPolicy("/V1/RESPONSES/COMPACT");
    expect(policy.kind).toBe("raw_passthrough");
  });

  test("query string: /v1/messages/count_tokens?foo=bar -> raw_passthrough", () => {
    expect(isRawPassthroughEndpointPath("/v1/messages/count_tokens?foo=bar")).toBe(true);
    const policy = resolveEndpointPolicy("/v1/messages/count_tokens?foo=bar");
    expect(policy.kind).toBe("raw_passthrough");
  });

  test("query string: /v1/responses/compact?foo=bar -> raw_passthrough", () => {
    expect(isRawPassthroughEndpointPath("/v1/responses/compact?foo=bar")).toBe(true);
    const policy = resolveEndpointPolicy("/v1/responses/compact?foo=bar");
    expect(policy.kind).toBe("raw_passthrough");
  });

  test("combined edge case: uppercase + trailing slash + query string", () => {
    expect(isRawPassthroughEndpointPath("/V1/MESSAGES/COUNT_TOKENS/?x=1")).toBe(true);
    expect(isRawPassthroughEndpointPath("/V1/RESPONSES/COMPACT/?x=1")).toBe(true);

    const policy1 = resolveEndpointPolicy("/V1/MESSAGES/COUNT_TOKENS/?x=1");
    const policy2 = resolveEndpointPolicy("/V1/RESPONSES/COMPACT/?x=1");
    expect(policy1.kind).toBe("raw_passthrough");
    expect(policy2.kind).toBe("raw_passthrough");
  });

  test("/v1/messages/ (with trailing slash) -> default, NOT raw_passthrough", () => {
    expect(isRawPassthroughEndpointPath("/v1/messages/")).toBe(false);
    const policy = resolveEndpointPolicy("/v1/messages/");
    expect(policy.kind).toBe("default");
  });

  test("/v1/messages (no trailing slash) -> default", () => {
    expect(isRawPassthroughEndpointPath("/v1/messages")).toBe(false);
    const policy = resolveEndpointPolicy("/v1/messages");
    expect(policy.kind).toBe("default");
  });

  test("/v1/responses (no sub-path) -> default", () => {
    expect(isRawPassthroughEndpointPath("/v1/responses")).toBe(false);
    const policy = resolveEndpointPolicy("/v1/responses");
    expect(policy.kind).toBe("default");
  });

  test("/v1/chat/completions -> default", () => {
    expect(isRawPassthroughEndpointPath("/v1/chat/completions")).toBe(false);
    const policy = resolveEndpointPolicy("/v1/chat/completions");
    expect(policy.kind).toBe("default");
  });

  test.each([
    "/v1/messages/count",
    "/v1/messages/count_token",
    "/v1/responses/mini",
    "/v1/responses/compacted",
    "/v2/messages/count_tokens",
    "/v1/messages/count_tokens/extra",
  ])("non-matching path %s -> default", (pathname) => {
    expect(isRawPassthroughEndpointPath(pathname)).toBe(false);
    const policy = resolveEndpointPolicy(pathname);
    expect(policy.kind).toBe("default");
  });

  test("empty and root paths -> default", () => {
    expect(resolveEndpointPolicy("/").kind).toBe("default");
    expect(resolveEndpointPolicy("").kind).toBe("default");
  });
});
