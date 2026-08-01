import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

/**
 * F3a "ignore client session id" semantics and review fixes in ensure():
 * - affinity candidates must not bypass cost limits (windowed + total);
 * - ignore on + fingerprintable request skips the session binding read;
 * - ignore on + non-fingerprintable body keeps legacy session reuse;
 * - metrics-only mode (ENABLE_CACHE_EFFECTIVENESS) fingerprints without nominating;
 * - non-default endpoint policies never build affinity state.
 */

const envControl = vi.hoisted(() => ({
  affinityEnabled: true,
  cacheEffectiveness: false,
}));

const settingsControl = vi.hoisted(() => ({ ignoreClientSessionId: true }));

const storeMocks = vi.hoisted(() => ({
  lookup: vi.fn(async () => null as unknown),
  put: vi.fn(async () => {}),
  tombstone: vi.fn(async () => {}),
}));

const circuitBreakerMocks = vi.hoisted(() => ({
  isCircuitOpen: vi.fn(async (_providerId: number) => false),
  getCircuitState: vi.fn(() => "closed"),
}));

const vendorTypeCircuitMocks = vi.hoisted(() => ({
  isVendorTypeCircuitOpen: vi.fn(async () => false),
}));

const sessionManagerMocks = vi.hoisted(() => ({
  SessionManager: {
    getSessionProvider: vi.fn(async () => null as number | null),
    clearSessionProvider: vi.fn(async () => undefined),
    // 版本化绑定读不可用 -> findReusable 走 legacy getSessionProvider 回退，测试意图不变
    getSessionBindingSnapshot: vi.fn(async () => ({
      status: "unavailable" as const,
      reason: "redis_unavailable",
      capabilityState: "unknown",
      legacyFallbackAllowed: true,
    })),
    isSessionProviderCoolingDown: vi.fn(async () => ({
      status: "ok" as const,
      coolingDown: false,
      legacyFallbackAllowed: false as const,
    })),
  },
}));

const providerRepositoryMocks = vi.hoisted(() => ({
  findProviderById: vi.fn(async () => null as Provider | null),
  findAllProviders: vi.fn(async () => [] as Provider[]),
}));

const rateLimitMocks = vi.hoisted(() => ({
  RateLimitService: {
    checkCostLimitsWithLease: vi.fn(async (_providerId: number) => ({ allowed: true })),
    checkTotalCostLimit: vi.fn(async (_providerId: number) => ({ allowed: true, current: 0 })),
    checkAndTrackProviderSession: vi.fn(async () => ({
      allowed: true,
      count: 1,
      tracked: true,
      referenced: false,
    })),
  },
}));

vi.mock("@/lib/circuit-breaker", () => circuitBreakerMocks);
vi.mock("@/lib/vendor-type-circuit-breaker", () => vendorTypeCircuitMocks);
vi.mock("@/lib/session-manager", () => sessionManagerMocks);
vi.mock("@/repository/provider", () => providerRepositoryMocks);
vi.mock("@/lib/rate-limit", () => rateLimitMocks);
vi.mock("@/repository/provider-groups", () => ({
  getGroupCostMultiplier: vi.fn(async () => 1),
}));
vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "UTC"),
}));
vi.mock("@/app/v1/_lib/proxy/provider-selector-settings-cache", () => ({
  getVerboseProviderErrorCached: vi.fn(async () => false),
}));
vi.mock("@/app/v1/_lib/proxy/affinity/affinity-store", () => ({
  getAffinityStore: () => storeMocks,
}));
vi.mock("@/lib/system-settings/proxy-runtime", () => ({
  getProxyRuntimeSettings: vi.fn(async () => ({
    streamGateMode: "off" as const,
    affinityIgnoreClientSessionId: settingsControl.ignoreClientSessionId,
  })),
  isCacheEffectivenessEnabled: () => envControl.cacheEffectiveness,
}));
vi.mock("@/lib/config/env.schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/env.schema")>();
  const baseEnv = actual.EnvSchema.parse({});
  return {
    ...actual,
    getEnvConfig: () => ({
      ...baseEnv,
      ENABLE_PREFIX_AFFINITY: envControl.affinityEnabled,
      ENABLE_CACHE_EFFECTIVENESS: envControl.cacheEffectiveness,
      PREFIX_AFFINITY_WINDOW: 8,
      PREFIX_AFFINITY_TTL_SECONDS: 3600,
    }),
  };
});

import { ProxyProviderResolver } from "@/app/v1/_lib/proxy/provider-selector";

function makeProvider(id: number, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: `provider_${id}`,
    isEnabled: true,
    providerType: "claude",
    groupTag: null,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    disableSessionReuse: false,
    allowedModels: null,
    allowedClients: [],
    blockedClients: [],
    providerVendorId: null,
    activeTimeStart: null,
    activeTimeEnd: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
    ...overrides,
  } as unknown as Provider;
}

const claudeMessage = {
  model: "claude-sonnet-4-5",
  system: "You are helpful.",
  messages: [{ role: "user", content: "hello" }],
};

// Minimal ProxySession stub; loose typing matches sibling selector tests.
function makeSession(overrides: Record<string, unknown> = {}): any {
  const session: any = {
    sessionId: null,
    provider: null,
    affinity: null,
    originalFormat: "claude",
    userAgent: "claude-cli/2.0.0",
    authState: { key: { id: 5, providerGroup: "default" }, user: null },
    request: { message: claudeMessage },
    getEndpointPolicy: () => ({ kind: "default" }),
    shouldReuseProvider: () => false,
    getOriginalModel: () => "claude-sonnet-4-5",
    getCurrentModel: () => null,
    setProvider(p: Provider) {
      session.provider = p;
    },
    addProviderToChain: vi.fn(),
    getProviderChain: vi.fn(() => []),
    setLastSelectionContext: vi.fn((ctx: unknown) => {
      session._ctx = ctx;
    }),
    getLastSelectionContext: vi.fn(() => session._ctx ?? null),
    setGroupCostMultiplier: vi.fn(),
    getProvidersSnapshot: vi.fn(async () => [makeProvider(55)]),
    recordProviderSessionRef: vi.fn(),
    setSessionIdentityMetadata: vi.fn((metadata: unknown) => {
      session._sessionIdentityMetadata = metadata;
    }),
  };
  return Object.assign(session, overrides);
}

const affinityHint = {
  generation: "0",
  hint: {
    providerId: 42,
    matchedFp: "deepfp",
    matchedIndex: 0,
    tier: "conversation" as const,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  envControl.affinityEnabled = true;
  envControl.cacheEffectiveness = false;
  settingsControl.ignoreClientSessionId = true;
  storeMocks.lookup.mockResolvedValue(null);
  circuitBreakerMocks.isCircuitOpen.mockResolvedValue(false);
  circuitBreakerMocks.getCircuitState.mockReturnValue("closed");
  rateLimitMocks.RateLimitService.checkCostLimitsWithLease.mockResolvedValue({ allowed: true });
  rateLimitMocks.RateLimitService.checkTotalCostLimit.mockResolvedValue({
    allowed: true,
    current: 0,
  });
  rateLimitMocks.RateLimitService.checkAndTrackProviderSession.mockResolvedValue({
    allowed: true,
    count: 1,
    tracked: true,
    referenced: false,
  });
});

describe("affinity candidate cost limits", () => {
  test("candidate over windowed cost limits is rejected and falls back to weighted random", async () => {
    storeMocks.lookup.mockResolvedValue(affinityHint);
    providerRepositoryMocks.findProviderById.mockResolvedValue(makeProvider(42));
    rateLimitMocks.RateLimitService.checkCostLimitsWithLease.mockImplementation(
      async (providerId: number) => ({ allowed: providerId !== 42 })
    );

    const session = makeSession();
    const result = await ProxyProviderResolver.ensure(session);

    expect(result).toBeNull();
    expect(session.provider?.id).toBe(55);
    expect(session.affinity?.matchedFp).toBe("deepfp");
    expect(session.affinity?.nominatedProviderId).toBeNull();
    expect(rateLimitMocks.RateLimitService.checkCostLimitsWithLease).toHaveBeenCalledWith(
      42,
      "provider",
      expect.any(Object)
    );
  });

  test("candidate over total cost limit is rejected and falls back to weighted random", async () => {
    storeMocks.lookup.mockResolvedValue(affinityHint);
    providerRepositoryMocks.findProviderById.mockResolvedValue(makeProvider(42));
    rateLimitMocks.RateLimitService.checkTotalCostLimit.mockImplementation(
      async (providerId: number) => ({ allowed: providerId !== 42, current: 0 })
    );

    const session = makeSession();
    const result = await ProxyProviderResolver.ensure(session);

    expect(result).toBeNull();
    expect(session.provider?.id).toBe(55);
    expect(session.affinity?.nominatedProviderId).toBeNull();
    expect(rateLimitMocks.RateLimitService.checkTotalCostLimit).toHaveBeenCalledWith(
      42,
      "provider",
      null,
      expect.any(Object)
    );
  });
});

describe("ignore client session id semantics", () => {
  test("uses the actual matched fingerprint as the prefix Session identity", async () => {
    storeMocks.lookup
      .mockResolvedValueOnce({
        ...affinityHint,
        hint: { ...affinityHint.hint, matchedFp: "fingerprint-f" },
      })
      .mockResolvedValueOnce({
        ...affinityHint,
        hint: { ...affinityHint.hint, matchedFp: "fingerprint-g" },
      })
      .mockResolvedValueOnce({
        ...affinityHint,
        hint: { ...affinityHint.hint, matchedFp: "fingerprint-g" },
      });
    providerRepositoryMocks.findProviderById.mockResolvedValue(makeProvider(42));

    const sessions = [
      makeSession({ sessionId: "physical-session-1" }),
      makeSession({ sessionId: "physical-session-2" }),
      makeSession({ sessionId: "physical-session-3" }),
    ];
    for (const session of sessions) {
      await ProxyProviderResolver.ensure(session);
    }

    const identities = sessions.map((session) => {
      const metadata = session._sessionIdentityMetadata as {
        identity: string;
        scopeTag: string;
        fingerprint: string;
      };
      expect(metadata.identity).toBe(`pfx:${metadata.scopeTag}:${metadata.fingerprint}`);
      return metadata.fingerprint;
    });

    expect(identities).toEqual(["fingerprint-f", "fingerprint-g", "fingerprint-g"]);
  });

  test("stores the stable root and complete fingerprint chain for an intermediate hit", async () => {
    let deepestFirst: string[] = [];
    storeMocks.lookup.mockImplementation(async (_scopeTag, fingerprints: string[]) => {
      deepestFirst = fingerprints;
      return {
        generation: "0",
        identityFp: fingerprints[1],
        hint: {
          ...affinityHint.hint,
          matchedFp: fingerprints[1],
          matchedIndex: 1,
        },
      };
    });
    providerRepositoryMocks.findProviderById.mockResolvedValue(makeProvider(42));

    const session = makeSession({
      sessionId: "physical-session",
      request: {
        message: {
          ...claudeMessage,
          messages: [
            { role: "user", content: "one" },
            { role: "assistant", content: "two" },
            { role: "user", content: "three" },
            { role: "assistant", content: "four" },
            { role: "user", content: "five" },
          ],
        },
      },
    });

    await ProxyProviderResolver.ensure(session);

    expect(deepestFirst.length).toBeGreaterThan(1);
    expect(session._sessionIdentityMetadata).toMatchObject({
      identity: expect.stringContaining(`:${deepestFirst[1]}`),
      fingerprint: deepestFirst[1],
      fingerprints: [...new Set([deepestFirst[1], ...deepestFirst])],
    });
  });

  test("ignore on + fingerprintable request never reads the session binding", async () => {
    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValue(91);
    providerRepositoryMocks.findProviderById.mockResolvedValue(makeProvider(91));

    const session = makeSession({
      sessionId: "sess_bound",
      shouldReuseProvider: () => true,
    });

    const result = await ProxyProviderResolver.ensure(session);

    expect(result).toBeNull();
    expect(sessionManagerMocks.SessionManager.getSessionProvider).not.toHaveBeenCalled();
    expect(storeMocks.lookup).toHaveBeenCalledTimes(1);
    expect(session.affinity).not.toBeNull();
    // affinity miss: weighted random, not the stale session binding
    expect(session.provider?.id).toBe(55);
  });

  test("ignore on + non-fingerprintable body still uses legacy session reuse", async () => {
    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValue(91);
    providerRepositoryMocks.findProviderById.mockResolvedValue(makeProvider(91));

    const session = makeSession({
      sessionId: "sess_bound",
      shouldReuseProvider: () => true,
      // 无 messages 数组：不可指纹化（如 Codex 非 chat 体），保住既有粘性
      request: { message: { model: "claude-sonnet-4-5" } },
    });

    const result = await ProxyProviderResolver.ensure(session);

    expect(result).toBeNull();
    expect(sessionManagerMocks.SessionManager.getSessionProvider).toHaveBeenCalledTimes(1);
    expect(session.provider?.id).toBe(91);
    expect(session.affinity).toBeNull();
    expect(storeMocks.lookup).not.toHaveBeenCalled();
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.objectContaining({ id: 91 }),
      expect.objectContaining({ reason: "session_reuse" })
    );
  });

  test("escapes a client-controlled pfx prefix from the logical Session identity namespace", async () => {
    const session = makeSession({
      sessionId: "pfx:foreign-scope:foreign-fingerprint",
      request: { message: { model: "claude-sonnet-4-5" } },
    });

    const result = await ProxyProviderResolver.ensure(session);

    expect(result).toBeNull();
    expect(session.setSessionIdentityMetadata).toHaveBeenCalledWith({
      identity: "sid:ce9895f7ae1c9727ce21d234b659482e",
      kind: "session_id",
      scopeTag: null,
      fingerprint: null,
      fingerprints: [],
    });
  });

  test("isolates both reserved physical Session namespaces without changing ordinary identities", async () => {
    const reservedPfx = makeSession({
      sessionId: "pfx:foreign-scope:foreign-fingerprint",
      request: { message: { model: "claude-sonnet-4-5" } },
    });
    const reservedSid = makeSession({
      sessionId: "sid:pfx:foreign-scope:foreign-fingerprint",
      request: { message: { model: "claude-sonnet-4-5" } },
    });
    const otherKey = makeSession({
      sessionId: "pfx:foreign-scope:foreign-fingerprint",
      authState: { key: { id: 6, providerGroup: "default" }, user: null },
      request: { message: { model: "claude-sonnet-4-5" } },
    });
    const ordinary = makeSession({
      sessionId: "physical-session-1",
      request: { message: { model: "claude-sonnet-4-5" } },
    });

    for (const session of [reservedPfx, reservedSid, otherKey, ordinary]) {
      await ProxyProviderResolver.ensure(session);
    }

    expect(reservedPfx._sessionIdentityMetadata.identity).toBe(
      "sid:ce9895f7ae1c9727ce21d234b659482e"
    );
    expect(reservedSid._sessionIdentityMetadata.identity).toBe(
      "sid:c300a896dbf9af49bbe231ce1ed2767a"
    );
    expect(otherKey._sessionIdentityMetadata.identity).toBe("sid:11d7b35b031557d5573098565a9ee514");
    expect(
      new Set([
        reservedPfx._sessionIdentityMetadata.identity,
        reservedSid._sessionIdentityMetadata.identity,
        otherKey._sessionIdentityMetadata.identity,
      ])
    ).toHaveLength(3);
    expect(reservedPfx._sessionIdentityMetadata.identity).toHaveLength(36);
    expect(ordinary._sessionIdentityMetadata.identity).toBe("physical-session-1");
  });

  test.each(["pfx:", "sid:"])(
    "keeps a 64-character %s physical Session identity inside the database limit",
    async (prefix) => {
      const session = makeSession({
        sessionId: `${prefix}${"x".repeat(64 - prefix.length)}`,
        request: { message: { model: "claude-sonnet-4-5" } },
      });

      await ProxyProviderResolver.ensure(session);

      expect(session._sessionIdentityMetadata.identity).toMatch(/^sid:[0-9a-f]{32}$/);
      expect(session._sessionIdentityMetadata.identity.length).toBeLessThanOrEqual(64);
    }
  );
});

describe("metrics-only and endpoint policy gating", () => {
  test("cache-effectiveness only: fingerprints the request but never looks up or nominates", async () => {
    envControl.affinityEnabled = false;
    envControl.cacheEffectiveness = true;
    settingsControl.ignoreClientSessionId = false;

    const session = makeSession();
    const result = await ProxyProviderResolver.ensure(session);

    expect(result).toBeNull();
    expect(session.affinity).not.toBeNull();
    expect(session.affinity?.nominatedProviderId).toBeNull();
    expect(storeMocks.lookup).not.toHaveBeenCalled();
    expect(session.provider?.id).toBe(55);
  });

  test("non-default endpoint policy never builds affinity state", async () => {
    const session = makeSession({
      getEndpointPolicy: () => ({ kind: "raw_passthrough" }),
    });

    const result = await ProxyProviderResolver.ensure(session);

    expect(result).toBeNull();
    expect(session.affinity).toBeNull();
    expect(storeMocks.lookup).not.toHaveBeenCalled();
    expect(session.provider?.id).toBe(55);
  });
});
