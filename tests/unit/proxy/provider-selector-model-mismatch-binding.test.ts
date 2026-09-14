import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

const circuitBreakerMocks = vi.hoisted(() => ({
  isCircuitOpen: vi.fn(async () => false),
  getCircuitState: vi.fn(() => "closed"),
}));

vi.mock("@/lib/circuit-breaker", () => circuitBreakerMocks);

const vendorTypeCircuitMocks = vi.hoisted(() => ({
  isVendorTypeCircuitOpen: vi.fn(async () => false),
}));

vi.mock("@/lib/vendor-type-circuit-breaker", () => vendorTypeCircuitMocks);

const sessionManagerMocks = vi.hoisted(() => ({
  SessionManager: {
    getSessionBindingSnapshot: vi.fn(),
    getSessionProvider: vi.fn(async () => null as number | null),
    clearSessionProvider: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/session-manager", () => sessionManagerMocks);

const providerRepositoryMocks = vi.hoisted(() => ({
  findAllProviders: vi.fn(async () => [] as Provider[]),
}));

vi.mock("@/repository/provider", () => providerRepositoryMocks);

const rateLimitMocks = vi.hoisted(() => ({
  RateLimitService: {
    checkCostLimitsWithLease: vi.fn(async () => ({ allowed: true })),
    checkTotalCostLimit: vi.fn(async () => ({ allowed: true, current: 0 })),
    checkAndTrackProviderSession: vi.fn(async () => ({
      allowed: true,
      count: 0,
      tracked: false,
      referenced: true,
    })),
  },
}));

vi.mock("@/lib/rate-limit", () => rateLimitMocks);

// Deterministic verbose-error mode so the no-fallback branch never touches
// the repository / DB layer via getVerboseProviderErrorCached().
const settingsCacheMocks = vi.hoisted(() => ({
  getVerboseProviderErrorCached: vi.fn(async () => false),
}));

vi.mock("@/app/v1/_lib/proxy/provider-selector-settings-cache", () => settingsCacheMocks);

beforeEach(() => {
  vi.resetAllMocks();
});

function createHaikuOnlyProvider(): Provider {
  return {
    id: 78,
    name: "zhipu_Haiku",
    isEnabled: true,
    providerType: "claude",
    groupTag: null,
    weight: 1,
    priority: 1,
    costMultiplier: 1,
    disableSessionReuse: false,
    overwriteResponseModel: false,
    allowedModels: ["claude-haiku-4-5-20251001", "claude-haiku-4-5"],
    providerVendorId: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
  } as unknown as Provider;
}

function createOpusProvider(): Provider {
  return {
    id: 94,
    name: "yescode_team",
    isEnabled: true,
    providerType: "claude",
    groupTag: null,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    allowedModels: null, // supports all claude models
    providerVendorId: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
  } as unknown as Provider;
}

describe("findReusable - model mismatch clears stale binding", () => {
  test("should clear binding when bound provider disables session reuse", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(78);
    const provider = createHaikuOnlyProvider();
    const boundProvider = {
      ...provider,
      disableSessionReuse: true,
    } as Provider;

    const session = {
      sessionId: "sess_disable_reuse",
      shouldReuseProvider: () => true,
      getProvidersSnapshot: async () => [boundProvider],
      getOriginalModel: () => "claude-haiku-4-5-20251001",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).toBeNull();
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).toHaveBeenCalledWith(
      "sess_disable_reuse",
      78,
      null
    );
  });

  test("should clear stale binding when bound provider does not support requested model", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    // Session bound to haiku-only provider
    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(78);

    const session = {
      sessionId: "4c25cf92",
      shouldReuseProvider: () => true,
      getProvidersSnapshot: async () => [createHaikuOnlyProvider()],
      getOriginalModel: () => "claude-opus-4-6",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).toBeNull();
    // Key assertion: clearSessionProvider should have been called
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).toHaveBeenCalledWith(
      "4c25cf92",
      78,
      null
    );
  });

  test("should invalidate a cleared versioned snapshot before Discovery", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");
    const snapshot = {
      sessionId: "versioned-model-mismatch",
      keyId: 456,
      providerId: 78,
      generation: "stale-generation",
    };
    sessionManagerMocks.SessionManager.getSessionBindingSnapshot.mockResolvedValueOnce({
      status: "ok",
      snapshot,
    });
    const setSessionBindingSnapshot = vi.fn();
    const session = {
      sessionId: snapshot.sessionId,
      shouldReuseProvider: () => true,
      getProvidersSnapshot: async () => [createHaikuOnlyProvider()],
      getOriginalModel: () => "claude-opus-4-6",
      authState: { key: { id: snapshot.keyId } },
      getCurrentModel: () => null,
      setSessionBindingSnapshot,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).toBeNull();
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).toHaveBeenCalledWith(
      snapshot.sessionId,
      snapshot.providerId,
      snapshot.keyId
    );
    expect(setSessionBindingSnapshot).toHaveBeenNthCalledWith(1, snapshot);
    expect(setSessionBindingSnapshot).toHaveBeenNthCalledWith(2, null);
  });

  test("should clear stale binding when bound provider type is incompatible with request format", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(94);

    const session = {
      sessionId: "sess_response_format_mismatch",
      shouldReuseProvider: () => true,
      getProvidersSnapshot: async () => [createOpusProvider()],
      originalFormat: "response",
      getOriginalModel: () => null,
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).toBeNull();
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).toHaveBeenCalledWith(
      "sess_response_format_mismatch",
      94,
      null
    );
  });

  test("should NOT clear binding when bound provider supports requested model", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    // Session bound to provider that supports all claude models
    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(94);
    rateLimitMocks.RateLimitService.checkCostLimitsWithLease.mockResolvedValueOnce({
      allowed: true,
    });
    rateLimitMocks.RateLimitService.checkTotalCostLimit.mockResolvedValueOnce({
      allowed: true,
      current: 0,
    });

    const session = {
      sessionId: "sess_ok",
      shouldReuseProvider: () => true,
      getProvidersSnapshot: async () => [createOpusProvider()],
      getOriginalModel: () => "claude-opus-4-6",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    // Should return the provider (model matches)
    expect(result).not.toBeNull();
    expect(result?.id).toBe(94);
    // clearSessionProvider should NOT have been called
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).not.toHaveBeenCalled();
  });

  test("should NOT clear binding when shouldReuseProvider returns false", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const session = {
      sessionId: "sess_short",
      shouldReuseProvider: () => false,
      getOriginalModel: () => "claude-opus-4-6",
      authState: null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).toBeNull();
    // Should not even reach the model check, so no clear
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).not.toHaveBeenCalled();
    expect(sessionManagerMocks.SessionManager.getSessionProvider).not.toHaveBeenCalled();
  });

  test("should clear binding for haiku-only provider when requesting haiku-4-5 variant not in allowlist", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(78);
    const provider = createHaikuOnlyProvider();
    // Restrictive allowlist - only allows specific variant
    provider.allowedModels = ["claude-haiku-4-5-20251001"];

    const session = {
      sessionId: "sess_variant",
      shouldReuseProvider: () => true,
      getProvidersSnapshot: async () => [provider],
      getOriginalModel: () => "claude-sonnet-4-5-20250929",
      authState: null,
      getCurrentModel: () => null,
    } as any;

    const result = await (ProxyProviderResolver as any).findReusable(session);

    expect(result).toBeNull();
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).toHaveBeenCalledWith(
      "sess_variant",
      78,
      null
    );
  });
});

// ---------------------------------------------------------------------------
// Sticky-session regression: client-restriction-rejected bound provider must
// be cleared, traced, and replaced by an eligible fallback. Exercises the
// public ProxyProviderResolver.ensure flow.
// ---------------------------------------------------------------------------

const RESTRICTED_USER_AGENT = "test-suite-ua/1.0 (some-marker)";
const RESTRICTED_METADATA: Record<string, unknown> = null;

function createHeadersStub(): Headers {
  // Minimal Headers-like stand-in: provides get()/has() the client detector
  // touches. The restricted session uses a non-builtin keyword (UA substring),
  // so confirmClaudeCodeSignals() is not invoked.
  const map = new Map<string, string>();
  return {
    get: (k: string) => map.get(k.toLowerCase()) ?? null,
    has: (k: string) => map.has(k.toLowerCase()),
  } as unknown as Headers;
}

function createFallbackProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 99,
    name: "eligible_fallback",
    isEnabled: true,
    providerType: "claude",
    groupTag: null,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    disableSessionReuse: false,
    overwriteResponseModel: false,
    allowedModels: null, // supports every claude model
    allowedClients: [],
    blockedClients: [],
    providerVendorId: null,
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

function createOtherRestrictedProvider(): Provider {
  return {
    id: 88,
    name: "other_restricted",
    isEnabled: true,
    providerType: "claude",
    groupTag: null,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    disableSessionReuse: false,
    overwriteResponseModel: false,
    allowedModels: null,
    allowedClients: [],
    blockedClients: ["test-suite"], // also rejects RESTRICTED_USER_AGENT
    providerVendorId: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
  } as unknown as Provider;
}

function createBoundRestrictedProvider(): Provider {
  return {
    id: 78,
    name: "bound_restricted",
    isEnabled: true,
    providerType: "claude",
    groupTag: null,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    disableSessionReuse: false,
    overwriteResponseModel: false,
    allowedModels: null, // model support is fine — restriction is client-side
    allowedClients: [],
    blockedClients: ["test-suite"], // rejects RESTRICTED_USER_AGENT
    providerVendorId: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
  } as unknown as Provider;
}

interface RestrictedSession {
  sessionId: string;
  shouldReuseProvider: () => boolean;
  getOriginalModel: () => string;
  getCurrentModel: () => null;
  originalFormat: string;
  authState: null;
  userAgent: string;
  headers: Headers;
  request: { message: { metadata: unknown } };
  provider: Provider | null;
  providerChain: Array<Record<string, unknown>>;
  setProvider(provider: Provider | null): void;
  addProviderToChain(
    provider: Provider,
    metadata?: { reason?: string; decisionContext?: unknown; [k: string]: unknown }
  ): void;
  getProviderChain(): Array<Record<string, unknown>>;
  setLastSelectionContext(ctx: unknown): void;
  getLastSelectionContext(): unknown;
  setSessionIdentityMetadata(metadata: unknown): void;
  setGroupCostMultiplier(value: number): void;
  recordProviderSessionRef(providerId: number): void;
  getProvidersSnapshot: () => Promise<Provider[]>;
}

function createRestrictedSession(opts: {
  sessionId: string;
  providers: Provider[];
}): RestrictedSession {
  let provider: Provider | null = null;
  let lastSelectionContext: unknown;
  const chain: Array<Record<string, unknown>> = [];
  const sessionRefs: number[] = [];

  return {
    sessionId: opts.sessionId,
    shouldReuseProvider: () => true,
    getOriginalModel: () => "claude-opus-4-6",
    getCurrentModel: () => null,
    originalFormat: "claude",
    authState: null,
    userAgent: RESTRICTED_USER_AGENT,
    headers: createHeadersStub(),
    request: { message: { metadata: RESTRICTED_METADATA } },
    get provider() {
      return provider;
    },
    setProvider(p: Provider | null) {
      provider = p;
    },
    providerChain: chain,
    addProviderToChain(p, metadata) {
      const last = chain[chain.length - 1];
      const shouldAdd =
        chain.length === 0 ||
        last.id !== p.id ||
        last.reason !== metadata?.reason ||
        (metadata?.attemptNumber !== undefined && last.attemptNumber !== metadata?.attemptNumber);
      if (shouldAdd) {
        chain.push({
          id: p.id,
          name: p.name,
          reason: metadata?.reason,
          selectionMethod: metadata?.selectionMethod,
          attemptNumber: metadata?.attemptNumber,
          errorMessage: metadata?.errorMessage,
          decisionContext: metadata?.decisionContext,
        });
      }
    },
    getProviderChain() {
      return chain;
    },
    setLastSelectionContext(ctx: unknown) {
      lastSelectionContext = ctx;
    },
    getLastSelectionContext() {
      return lastSelectionContext;
    },
    setSessionIdentityMetadata(_metadata: unknown) {},
    setGroupCostMultiplier(_value: number) {
      // No-op: ensure() calls this when authState has a group, but our tests
      // use authState=null so this branch is never reached.
    },
    recordProviderSessionRef(providerId: number) {
      sessionRefs.push(providerId);
    },
    getProvidersSnapshot: async () => opts.providers,
  };
}

describe("ProxyProviderResolver.ensure - sticky-session client restriction regression", () => {
  beforeEach(() => {
    // verboseError=false keeps the no-fallback branch deterministic and avoids
    // pulling the repository / DB-backed settings cache.
    settingsCacheMocks.getVerboseProviderErrorCached.mockResolvedValue(false);

    // ensure() invokes checkAndTrackProviderSession for every candidate.
    // Default = allowed + referenced so the success path can complete.
    rateLimitMocks.RateLimitService.checkAndTrackProviderSession.mockResolvedValue({
      allowed: true,
      count: 0,
      tracked: false,
      referenced: true,
    });

    // Default fall-throughs for cost checks used by pickRandomProvider's
    // filterByLimits stage.
    rateLimitMocks.RateLimitService.checkCostLimitsWithLease.mockResolvedValue({
      allowed: true,
    });
    rateLimitMocks.RateLimitService.checkTotalCostLimit.mockResolvedValue({
      allowed: true,
      current: 0,
    });
  });

  test("reusable session bound to a client-ineligible provider is cleared and replaced by an eligible fallback", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const bound = createBoundRestrictedProvider();
    const fallback = createFallbackProvider();

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(78);
    providerRepositoryMocks.findAllProviders.mockResolvedValueOnce([bound, fallback]);

    const session = createRestrictedSession({
      sessionId: "sess_restricted_a",
      providers: [bound, fallback],
    });

    const result = await ProxyProviderResolver.ensure(session as any);

    // Success: no 503 Response surfaced; ensure() returns null on success.
    expect(result).toBeNull();

    // 1) The stale binding is cleared.
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).toHaveBeenCalledWith(
      "sess_restricted_a",
      78,
      null
    );

    // 2) The bound provider is recorded as client_restriction_filtered with the
    //    detailed client-restriction context, then the eligible fallback is
    //    recorded as initial_selection.
    const chain = session.getProviderChain();
    expect(chain.length).toBeGreaterThanOrEqual(2);

    const filteredEntry = chain.find((c) => c.reason === "client_restriction_filtered");
    expect(filteredEntry).toBeDefined();
    expect(filteredEntry?.id).toBe(78);
    expect(filteredEntry?.name).toBe("bound_restricted");
    const filteredDecision = (filteredEntry?.decisionContext ?? {}) as {
      filteredProviders?: Array<{
        id: number;
        reason: string;
        details?: string;
        clientRestrictionContext?: {
          matchType: string;
          matchedPattern?: string;
          detectedClient?: string;
          providerAllowlist: unknown[];
          providerBlocklist: unknown[];
        };
      }>;
    };
    const filteredProvider = filteredDecision.filteredProviders?.[0];
    expect(filteredProvider).toBeDefined();
    expect(filteredProvider?.reason).toBe("client_restriction");
    expect(filteredProvider?.details).toBe("blocklist_hit");
    expect(filteredProvider?.clientRestrictionContext).toBeDefined();
    expect(filteredProvider?.clientRestrictionContext?.matchType).toBe("blocklist_hit");
    expect(filteredProvider?.clientRestrictionContext?.matchedPattern).toBe("test-suite");
    expect(filteredProvider?.clientRestrictionContext?.detectedClient).toBe(RESTRICTED_USER_AGENT);
    expect(filteredProvider?.clientRestrictionContext?.providerAllowlist).toEqual([]);
    expect(filteredProvider?.clientRestrictionContext?.providerBlocklist).toEqual(["test-suite"]);

    const initialEntry = chain.find((c) => c.reason === "initial_selection");
    expect(initialEntry).toBeDefined();
    expect(initialEntry?.id).toBe(99);
    expect(initialEntry?.name).toBe("eligible_fallback");

    // 3) The eligible fallback is the session.provider after ensure() finishes.
    expect(session.provider).not.toBeNull();
    expect(session.provider?.id).toBe(99);
    expect(session.provider?.id).not.toBe(78); // bound provider is not re-attached
  });

  test("all candidates restricted surfaces a 503 with error type no_available_providers and leaves no bound provider on the session", async () => {
    const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

    const bound = createBoundRestrictedProvider();
    const otherRestricted = createOtherRestrictedProvider();

    sessionManagerMocks.SessionManager.getSessionProvider.mockResolvedValueOnce(78);
    // Snapshot contains only restricted candidates -> pickRandomProvider filters
    // both out via client_restriction, returns null provider.
    providerRepositoryMocks.findAllProviders.mockResolvedValueOnce([bound, otherRestricted]);

    const session = createRestrictedSession({
      sessionId: "sess_restricted_b",
      providers: [bound, otherRestricted],
    });

    const result = await ProxyProviderResolver.ensure(session as any);

    // 1) Result is a Response (503 surfaced by the no-fallback branch).
    expect(result).not.toBeNull();
    expect(result).toBeInstanceOf(Response);
    const response = result as unknown as Response;
    expect(response.status).toBe(503);

    // 2) Error type is no_available_providers — assert TYPE only, never wording.
    const body = (await response.json()) as {
      error: { type: string; code: string; message: string };
    };
    expect(body.error.type).toBe("no_available_providers");

    // 3) The stale binding was still cleared.
    expect(sessionManagerMocks.SessionManager.clearSessionProvider).toHaveBeenCalledWith(
      "sess_restricted_b",
      78,
      null
    );

    // 4) The previously-bound provider is NOT left attached to the session.
    expect(session.provider === null || session.provider?.id !== 78).toBe(true);

    // 5) The bound provider is recorded as client_restriction_filtered (so the
    //    rejection IS traced) but never attached as session.provider — the
    //    clearSessionProvider call above removed the binding and ensure()
    //    never re-attached it. Both restricted candidates appear in the chain
    //    only as filter records.
    const chain = session.getProviderChain();
    const restrictedEntries = chain.filter((c) => c.reason === "client_restriction_filtered");
    expect(restrictedEntries.length).toBeGreaterThanOrEqual(1);
    const restrictedIds = new Set(restrictedEntries.map((e) => e.id));
    expect(restrictedIds.has(78)).toBe(true); // bound provider is traced
    expect(session.provider).toBeNull(); // ...but never re-attached

    // 6) ensure() did NOT silently emit an initial_selection entry — no
    //    candidate actually won the race.
    expect(chain.some((c) => c.reason === "initial_selection")).toBe(false);
  });
});
