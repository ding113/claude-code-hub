import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadCurrentPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
const mockReadPublicStatusPayload = vi.hoisted(() => vi.fn());
const mockSchedulePublicStatusRebuild = vi.hoisted(() => vi.fn());

vi.mock("@/lib/public-status/config-snapshot", () => ({
  readCurrentPublicStatusConfigSnapshot: mockReadCurrentPublicStatusConfigSnapshot,
}));

vi.mock("@/lib/public-status/read-store", () => ({
  readPublicStatusPayload: mockReadPublicStatusPayload,
}));

vi.mock("@/lib/public-status/rebuild-hints", () => ({
  schedulePublicStatusRebuild: mockSchedulePublicStatusRebuild,
}));

async function importContractModule() {
  return import("@/lib/public-status/public-api-contract");
}

describe("public status API contract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("parses public status query", async () => {
    const { parsePublicStatusQuery } = await importContractModule();

    const parsed = parsePublicStatusQuery(
      new URLSearchParams({
        interval: "5m",
        rangeHours: "24",
        groupSlug: "openai",
        groupSlugs: "anthropic,,openai",
        model: "gpt-4.1",
        models: "claude-3.7,",
        status: "operational,degraded",
        include: "meta,defaults,groups,timeline",
        q: " Claude ",
      }),
      { intervalMinutes: 30, rangeHours: 72 }
    );

    expect(parsed).toMatchObject({
      intervalMinutes: 5,
      rangeHours: 24,
      filters: {
        groupSlugs: ["openai", "anthropic"],
        models: ["gpt-4.1", "claude-3.7"],
        statuses: ["operational", "degraded"],
        q: "Claude",
      },
      defaults: {
        intervalMinutes: 30,
        rangeHours: 72,
      },
      resolvedQuery: {
        intervalMinutes: 5,
        rangeHours: 24,
        groupSlugs: ["openai", "anthropic"],
        models: ["gpt-4.1", "claude-3.7"],
        statuses: ["operational", "degraded"],
        q: "Claude",
        include: ["meta", "defaults", "groups", "timeline"],
      },
    });
  });

  it("clamps public status query windows", async () => {
    const { parsePublicStatusQuery } = await importContractModule();

    const parsed = parsePublicStatusQuery(
      new URLSearchParams({
        interval: "45",
        rangeHours: "999",
      }),
      { intervalMinutes: 5, rangeHours: 24 }
    );

    expect(parsed.intervalMinutes).toBe(60);
    expect(parsed.rangeHours).toBe(168);
  });

  it("rejects invalid public status filters", async () => {
    const { PublicStatusQueryValidationError, parsePublicStatusQuery } =
      await importContractModule();

    expect(() =>
      parsePublicStatusQuery(
        new URLSearchParams({
          status: "unknown",
          include: "secret",
        }),
        { intervalMinutes: 5, rangeHours: 24 }
      )
    ).toThrowError(PublicStatusQueryValidationError);

    try {
      parsePublicStatusQuery(
        new URLSearchParams({
          status: "unknown",
          include: "secret",
        }),
        { intervalMinutes: 5, rangeHours: 24 }
      );
      throw new Error("expected parsePublicStatusQuery to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicStatusQueryValidationError);
      expect((error as InstanceType<typeof PublicStatusQueryValidationError>).details).toEqual([
        expect.objectContaining({
          field: "status",
          code: "invalid_enum",
        }),
        expect.objectContaining({
          field: "include",
          code: "invalid_enum",
        }),
      ]);
    }
  });

  it("rejects invalid public status query window syntax", async () => {
    const { PublicStatusQueryValidationError, parsePublicStatusQuery } =
      await importContractModule();

    expect(() =>
      parsePublicStatusQuery(
        new URLSearchParams({
          interval: "foo",
          rangeHours: "bar",
        }),
        { intervalMinutes: 5, rangeHours: 24 }
      )
    ).toThrowError(PublicStatusQueryValidationError);

    try {
      parsePublicStatusQuery(
        new URLSearchParams({
          interval: "foo",
          rangeHours: "bar",
        }),
        { intervalMinutes: 5, rangeHours: 24 }
      );
      throw new Error("expected parsePublicStatusQuery to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicStatusQueryValidationError);
      expect((error as InstanceType<typeof PublicStatusQueryValidationError>).details).toEqual([
        expect.objectContaining({
          field: "interval",
          code: "invalid_number",
        }),
        expect.objectContaining({
          field: "rangeHours",
          code: "invalid_number",
        }),
      ]);
    }
  });
});

describe("GET /api/public-status contract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockReadCurrentPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-1",
      siteTitle: "Claude Code Hub",
      siteDescription: "Claude Code Hub public status",
      timeZone: "UTC",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [{ slug: "openai" }, { slug: "anthropic" }],
    });
  });

  it("filters public status payload by query params", async () => {
    mockReadPublicStatusPayload.mockResolvedValue({
      rebuildState: "fresh",
      sourceGeneration: "gen-1",
      generatedAt: "2026-04-22T10:00:00.000Z",
      freshUntil: "2026-04-22T10:05:00.000Z",
      groups: [
        {
          publicGroupSlug: "openai",
          displayName: "OpenAI",
          explanatoryCopy: "OpenAI public models",
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
              latestState: "operational",
              availabilityPct: 99.9,
              latestTtfbMs: 420,
              latestTps: null,
              timeline: [],
            },
          ],
        },
        {
          publicGroupSlug: "anthropic",
          displayName: "Anthropic",
          explanatoryCopy: "Anthropic public models",
          models: [
            {
              publicModelKey: "claude-3.7",
              label: "Claude 3.7 Sonnet",
              vendorIconKey: "anthropic",
              requestTypeBadge: "anthropic",
              latestState: "failed",
              availabilityPct: 20,
              latestTtfbMs: 900,
              latestTps: null,
              timeline: [
                {
                  bucketStart: "2026-04-22T09:30:00.000Z",
                  bucketEnd: "2026-04-22T09:35:00.000Z",
                  state: "failed",
                  availabilityPct: 20,
                  ttfbMs: 900,
                  tps: null,
                  sampleCount: 8,
                },
              ],
            },
          ],
        },
      ],
    });

    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(
      new Request(
        "http://localhost/api/public-status?groupSlug=anthropic&status=failed&q=claude&include=meta,defaults,groups,timeline"
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      defaults: {
        intervalMinutes: 5,
        rangeHours: 24,
      },
      resolvedQuery: {
        intervalMinutes: 5,
        rangeHours: 24,
        groupSlugs: ["anthropic"],
        statuses: ["failed"],
        q: "claude",
        include: ["meta", "defaults", "groups", "timeline"],
      },
      meta: {
        siteTitle: "Claude Code Hub",
        siteDescription: "Claude Code Hub public status",
        timeZone: "UTC",
      },
      groups: [
        expect.objectContaining({
          publicGroupSlug: "anthropic",
          models: [
            expect.objectContaining({
              publicModelKey: "claude-3.7",
            }),
          ],
        }),
      ],
    });
  });

  it("filters public status payload by model query params", async () => {
    mockReadPublicStatusPayload.mockResolvedValue({
      rebuildState: "fresh",
      sourceGeneration: "gen-1",
      generatedAt: "2026-04-22T10:00:00.000Z",
      freshUntil: "2026-04-22T10:05:00.000Z",
      groups: [
        {
          publicGroupSlug: "openai",
          displayName: "OpenAI",
          explanatoryCopy: "OpenAI public models",
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
              latestState: "operational",
              availabilityPct: 99.9,
              latestTtfbMs: 420,
              latestTps: null,
              timeline: [],
            },
            {
              publicModelKey: "gpt-4o",
              label: "GPT-4o",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
              latestState: "operational",
              availabilityPct: 99.9,
              latestTtfbMs: 390,
              latestTps: null,
              timeline: [],
            },
          ],
        },
      ],
    });

    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(new Request("http://localhost/api/public-status?model=gpt-4o"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      groups: [
        {
          publicGroupSlug: "openai",
          models: [
            expect.objectContaining({
              publicModelKey: "gpt-4o",
            }),
          ],
        },
      ],
    });
  });

  it("trims optional sections when include omits groups and timeline", async () => {
    mockReadPublicStatusPayload.mockResolvedValue({
      rebuildState: "fresh",
      sourceGeneration: "gen-1",
      generatedAt: "2026-04-22T10:00:00.000Z",
      freshUntil: "2026-04-22T10:05:00.000Z",
      groups: [
        {
          publicGroupSlug: "anthropic",
          displayName: "Anthropic",
          explanatoryCopy: "Anthropic public models",
          models: [
            {
              publicModelKey: "claude-3.7",
              label: "Claude 3.7 Sonnet",
              vendorIconKey: "anthropic",
              requestTypeBadge: "anthropic",
              latestState: "failed",
              availabilityPct: 20,
              latestTtfbMs: 900,
              latestTps: null,
              timeline: [
                {
                  bucketStart: "2026-04-22T09:30:00.000Z",
                  bucketEnd: "2026-04-22T09:35:00.000Z",
                  state: "failed",
                  availabilityPct: 20,
                  ttfbMs: 900,
                  tps: null,
                  sampleCount: 8,
                },
              ],
            },
          ],
        },
      ],
    });

    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(
      new Request("http://localhost/api/public-status?include=meta,defaults")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      meta: {
        siteTitle: "Claude Code Hub",
      },
      defaults: {
        intervalMinutes: 5,
        rangeHours: 24,
      },
      groups: [],
    });
  });

  it("drops timelines when include omits timeline", async () => {
    mockReadPublicStatusPayload.mockResolvedValue({
      rebuildState: "fresh",
      sourceGeneration: "gen-1",
      generatedAt: "2026-04-22T10:00:00.000Z",
      freshUntil: "2026-04-22T10:05:00.000Z",
      groups: [
        {
          publicGroupSlug: "anthropic",
          displayName: "Anthropic",
          explanatoryCopy: "Anthropic public models",
          models: [
            {
              publicModelKey: "claude-3.7",
              label: "Claude 3.7 Sonnet",
              vendorIconKey: "anthropic",
              requestTypeBadge: "anthropic",
              latestState: "failed",
              availabilityPct: 20,
              latestTtfbMs: 900,
              latestTps: null,
              timeline: [
                {
                  bucketStart: "2026-04-22T09:30:00.000Z",
                  bucketEnd: "2026-04-22T09:35:00.000Z",
                  state: "failed",
                  availabilityPct: 20,
                  ttfbMs: 900,
                  tps: null,
                  sampleCount: 8,
                },
              ],
            },
          ],
        },
      ],
    });

    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(new Request("http://localhost/api/public-status?include=groups"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      meta: null,
      defaults: null,
      groups: [
        {
          publicGroupSlug: "anthropic",
          models: [
            {
              publicModelKey: "claude-3.7",
              timeline: [],
            },
          ],
        },
      ],
    });
  });

  it("returns 200 for rebuilding without snapshot", async () => {
    mockReadPublicStatusPayload.mockImplementation(
      async ({ triggerRebuildHint }: { triggerRebuildHint: (reason: string) => Promise<void> }) => {
        await triggerRebuildHint("manifest-missing");
        return {
          rebuildState: "rebuilding",
          sourceGeneration: "",
          generatedAt: null,
          freshUntil: null,
          groups: [],
        };
      }
    );

    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(new Request("http://localhost/api/public-status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      generatedAt: null,
      groups: [],
      status: "no_snapshot",
      rebuildState: {
        state: "rebuilding",
        hasSnapshot: false,
        reason: null,
      },
    });
  });

  it("returns 503 when the public projection is unavailable", async () => {
    mockReadPublicStatusPayload.mockImplementation(
      async ({ triggerRebuildHint }: { triggerRebuildHint: (reason: string) => Promise<void> }) => {
        await triggerRebuildHint("redis-unavailable");
        return {
          rebuildState: "rebuilding",
          sourceGeneration: "",
          generatedAt: null,
          freshUntil: null,
          groups: [],
        };
      }
    );

    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(new Request("http://localhost/api/public-status"));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      status: "rebuilding",
      rebuildState: {
        state: "rebuilding",
        hasSnapshot: false,
        reason: null,
      },
    });
  });

  it("rejects invalid public status filters at the route layer", async () => {
    const { GET } = await import("@/app/api/public-status/route");
    const response = await GET(new Request("http://localhost/api/public-status?status=unknown"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid public status query parameters",
      details: [
        expect.objectContaining({
          field: "status",
          code: "invalid_enum",
        }),
      ],
    });
    expect(mockReadPublicStatusPayload).not.toHaveBeenCalled();
  });
});
