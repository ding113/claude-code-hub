import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDbInsert = vi.hoisted(() => vi.fn());
const mockDbDelete = vi.hoisted(() => vi.fn());

vi.mock("@/drizzle/db", () => ({
  db: {
    insert: mockDbInsert,
    delete: mockDbDelete,
  },
}));

vi.mock("@/drizzle/schema", async () => {
  const actual = await vi.importActual<typeof import("@/drizzle/schema")>("@/drizzle/schema");
  return {
    ...actual,
    publicStatusHourlyRollups: {
      bucketStart: "bucket_start",
      bucketEnd: "bucket_end",
      configVersion: "config_version",
      sourceGroupName: "source_group_name",
      publicGroupSlug: "public_group_slug",
      publicModelKey: "public_model_key",
      label: "label",
      vendorIconKey: "vendor_icon_key",
      requestTypeBadge: "request_type_badge",
      state: "state",
      successCount: "success_count",
      failureCount: "failure_count",
      sampleCount: "sample_count",
      availabilityPct: "availability_pct",
      ttfbMs: "ttfb_ms",
      tps: "tps",
      generatedAt: "generated_at",
      updatedAt: "updated_at",
    },
  };
});

function buildGroup() {
  return {
    sourceGroupName: "openai",
    publicGroupSlug: "openai",
    displayName: "OpenAI",
    explanatoryCopy: "Primary",
    sortOrder: 1,
    models: [
      {
        publicModelKey: "gpt-4.1",
        label: "GPT-4.1",
        vendorIconKey: "openai",
        requestTypeBadge: "openaiCompatible",
      },
    ],
  };
}

describe("public-status hourly rollups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds finalized hourly rollup rows from request rows", async () => {
    const mod = await import("@/lib/public-status/hourly-rollups");

    const rows = mod.buildPublicStatusHourlyRollupsFromRequests({
      configVersion: "cfg-1",
      hourStart: "2026-04-21T10:23:00.000Z",
      groups: [buildGroup()],
      generatedAt: "2026-04-21T11:00:00.000Z",
      requests: [
        {
          id: 1,
          createdAt: "2026-04-21T10:10:00.000Z",
          originalModel: "gpt-4.1",
          durationMs: 1200,
          ttfbMs: 200,
          outputTokens: 50,
          providerChain: [
            {
              id: 11,
              name: "provider",
              groupTag: "openai",
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
        {
          id: 2,
          createdAt: "2026-04-21T10:45:00.000Z",
          originalModel: "gpt-4.1",
          providerChain: [
            {
              id: 12,
              name: "provider",
              groupTag: "openai",
              reason: "retry_failed",
              statusCode: 500,
            },
          ],
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bucketStart: new Date("2026-04-21T10:00:00.000Z"),
      bucketEnd: new Date("2026-04-21T11:00:00.000Z"),
      configVersion: "cfg-1",
      publicGroupSlug: "openai",
      publicModelKey: "gpt-4.1",
      state: "operational",
      successCount: 1,
      failureCount: 1,
      sampleCount: 2,
      availabilityPct: 50,
      ttfbMs: 200,
      tps: 50,
    });
  });

  it("assembles API-compatible payload from DB history plus current hour summary", async () => {
    const mod = await import("@/lib/public-status/hourly-rollups");
    const payload = mod.buildPublicStatusPayloadFromHourlyRollups({
      groups: [buildGroup()],
      rangeHours: 2,
      now: "2026-04-21T11:15:00.000Z",
      configVersion: "cfg-1",
      rows: [
        {
          bucketStart: new Date("2026-04-21T10:00:00.000Z"),
          bucketEnd: new Date("2026-04-21T11:00:00.000Z"),
          configVersion: "cfg-1",
          sourceGroupName: "openai",
          publicGroupSlug: "openai",
          publicModelKey: "gpt-4.1",
          label: "GPT-4.1",
          vendorIconKey: "openai",
          requestTypeBadge: "openaiCompatible",
          state: "operational",
          successCount: 4,
          failureCount: 0,
          sampleCount: 4,
          availabilityPct: 100,
          ttfbMs: 120,
          tps: 8,
          generatedAt: new Date("2026-04-21T11:00:00.000Z"),
        },
        {
          bucketStart: new Date("2026-04-21T11:00:00.000Z"),
          bucketEnd: new Date("2026-04-21T12:00:00.000Z"),
          configVersion: "cfg-1",
          sourceGroupName: "openai",
          publicGroupSlug: "openai",
          publicModelKey: "gpt-4.1",
          label: "GPT-4.1",
          vendorIconKey: "openai",
          requestTypeBadge: "openaiCompatible",
          state: "failed",
          successCount: 0,
          failureCount: 1,
          sampleCount: 1,
          availabilityPct: 0,
          ttfbMs: null,
          tps: null,
          generatedAt: new Date("2026-04-21T11:15:00.000Z"),
        },
      ],
    });

    expect(payload.rebuildState).toBe("fresh");
    expect(payload.groups[0]?.models[0]).toMatchObject({
      latestState: "failed",
      availabilityPct: 80,
      latestTtfbMs: 120,
      latestTps: 8,
    });
    expect(payload.groups[0]?.models[0]?.timeline).toEqual([
      expect.objectContaining({
        bucketStart: "2026-04-21T10:00:00.000Z",
        sampleCount: 4,
      }),
      expect.objectContaining({
        bucketStart: "2026-04-21T11:00:00.000Z",
        sampleCount: 1,
        state: "failed",
      }),
    ]);
  });

  it("writes current-hour summary with short ttl and reads it back", async () => {
    const mod = await import("@/lib/public-status/hourly-rollups");
    const store = new Map<string, string>();
    const redis = {
      status: "ready",
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return "OK";
      }),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
    };
    const row = mod.buildPublicStatusHourlyRollupsFromRequests({
      configVersion: "cfg-1",
      hourStart: "2026-04-21T11:00:00.000Z",
      groups: [buildGroup()],
      requests: [],
    })[0];
    if (!row) {
      throw new Error("expected rollup row");
    }

    await mod.writeCurrentHourPublicStatusSummary({
      redis,
      configVersion: "cfg-1",
      hourStart: "2026-04-21T11:10:00.000Z",
      rows: [row],
    });
    const readRows = await mod.readCurrentHourPublicStatusSummary({
      redis,
      configVersion: "cfg-1",
      hourStart: "2026-04-21T11:30:00.000Z",
    });

    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining("public-status:v1:current-hour:cfg-1:"),
      expect.any(String),
      "EX",
      10 * 60
    );
    expect(readRows).toHaveLength(1);
    expect(readRows[0]?.bucketStart.toISOString()).toBe("2026-04-21T11:00:00.000Z");
  });

  it("uses batch upsert conflict handling and retention cleanup queries", async () => {
    const values = vi.fn(() => ({
      onConflictDoUpdate: vi.fn(async () => undefined),
    }));
    mockDbInsert.mockReturnValue({ values });
    const where = vi.fn(async () => undefined);
    mockDbDelete.mockReturnValue({ where });

    const mod = await import("@/lib/public-status/hourly-rollups");
    const rows = mod.buildPublicStatusHourlyRollupsFromRequests({
      configVersion: "cfg-1",
      hourStart: "2026-04-21T10:00:00.000Z",
      groups: [buildGroup()],
      requests: [],
    });

    await mod.upsertPublicStatusHourlyRollups(rows);
    await mod.cleanupPublicStatusHourlyRollups({
      now: new Date("2026-05-21T10:00:00.000Z"),
      retentionDays: 30,
    });

    expect(mockDbInsert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(rows);
    expect(mockDbDelete).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
  });
});
