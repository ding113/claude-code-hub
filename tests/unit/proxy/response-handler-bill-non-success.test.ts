import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    trace: () => {},
  },
}));

vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    register: () => new AbortController(),
    cleanup: () => {},
    cancel: () => {},
  },
}));

vi.mock("@/lib/utils/upstream-error-detection", () => ({
  detectUpstreamErrorFromSseOrJsonText: vi.fn(() => ({ isError: false })),
  inferUpstreamErrorStatusCodeFromText: vi.fn(() => null),
}));

vi.mock(import("@/lib/utils/performance-formatter"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isNonBillingEndpoint: vi.fn(() => false),
  };
});

import { resolveBillableUsageMetricsForCost } from "@/app/v1/_lib/proxy/response-handler";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { detectUpstreamErrorFromSseOrJsonText } from "@/lib/utils/upstream-error-detection";

const mockGetCachedSystemSettings = getCachedSystemSettings as unknown as ReturnType<typeof vi.fn>;

type MinimalSession = {
  getEndpoint: () => string | null;
  getOriginalModel: () => string | null;
  getCurrentModel: () => string | null;
  getResolvedPricingByBillingSource: (provider: unknown) => Promise<null>;
};

function makeSession(): MinimalSession {
  return {
    getEndpoint: () => "/v1/messages",
    getOriginalModel: () => "claude-3-5-sonnet",
    getCurrentModel: () => "claude-3-5-sonnet",
    getResolvedPricingByBillingSource: async () => null,
  };
}

describe("resolveBillableUsageMetricsForCost — bill-non-success toggle", () => {
  beforeEach(() => {
    mockGetCachedSystemSettings.mockReset();
    (detectUpstreamErrorFromSseOrJsonText as unknown as ReturnType<typeof vi.fn>).mockReset();
    (detectUpstreamErrorFromSseOrJsonText as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isError: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null on 499 when toggle is OFF (default)", async () => {
    mockGetCachedSystemSettings.mockResolvedValue({ billNonSuccessfulRequests: false });

    const session = makeSession();
    const result = await resolveBillableUsageMetricsForCost(
      // biome-ignore lint/suspicious/noExplicitAny: minimal session for test
      session as any,
      null,
      { input_tokens: 100, output_tokens: 50 },
      499
    );

    expect(result).toBeNull();
  });

  it("returns usage on 499 when toggle is ON and tokens are positive", async () => {
    mockGetCachedSystemSettings.mockResolvedValue({ billNonSuccessfulRequests: true });

    const session = makeSession();
    const usage = { input_tokens: 100, output_tokens: 50 };
    const result = await resolveBillableUsageMetricsForCost(
      // biome-ignore lint/suspicious/noExplicitAny: minimal session for test
      session as any,
      null,
      usage,
      499
    );

    expect(result).toEqual(usage);
  });

  it("returns null on 499 when toggle is ON but usage is null", async () => {
    mockGetCachedSystemSettings.mockResolvedValue({ billNonSuccessfulRequests: true });

    const session = makeSession();
    const result = await resolveBillableUsageMetricsForCost(
      // biome-ignore lint/suspicious/noExplicitAny: minimal session for test
      session as any,
      null,
      null,
      499
    );

    expect(result).toBeNull();
  });

  it("returns null on 499 when toggle is ON but tokens are all zero", async () => {
    mockGetCachedSystemSettings.mockResolvedValue({ billNonSuccessfulRequests: true });

    const session = makeSession();
    const result = await resolveBillableUsageMetricsForCost(
      // biome-ignore lint/suspicious/noExplicitAny: minimal session for test
      session as any,
      null,
      { input_tokens: 0, output_tokens: 0 },
      499
    );

    expect(result).toBeNull();
  });

  it("counts cache tokens as positive when toggle is ON", async () => {
    mockGetCachedSystemSettings.mockResolvedValue({ billNonSuccessfulRequests: true });

    const session = makeSession();
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 200,
    };
    const result = await resolveBillableUsageMetricsForCost(
      // biome-ignore lint/suspicious/noExplicitAny: minimal session for test
      session as any,
      null,
      usage,
      499
    );

    expect(result).toEqual(usage);
  });

  it("does NOT bypass fake-200 detector even when toggle is ON (fake-200 only checked for 2xx)", async () => {
    // For status 200 with fake error payload: still skipped regardless of toggle.
    mockGetCachedSystemSettings.mockResolvedValue({ billNonSuccessfulRequests: true });
    (detectUpstreamErrorFromSseOrJsonText as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isError: true,
      code: 401,
      detail: "unauthorized",
    });

    const session = makeSession();
    const result = await resolveBillableUsageMetricsForCost(
      // biome-ignore lint/suspicious/noExplicitAny: minimal session for test
      session as any,
      null,
      { input_tokens: 100, output_tokens: 50 },
      200,
      "fake error body"
    );

    expect(result).toBeNull();
  });

  it("falls back to skip-billing if reading the setting throws", async () => {
    mockGetCachedSystemSettings.mockRejectedValue(new Error("redis down"));

    const session = makeSession();
    const result = await resolveBillableUsageMetricsForCost(
      // biome-ignore lint/suspicious/noExplicitAny: minimal session for test
      session as any,
      null,
      { input_tokens: 100, output_tokens: 50 },
      499
    );

    expect(result).toBeNull();
  });
});
