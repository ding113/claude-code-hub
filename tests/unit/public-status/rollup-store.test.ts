import { describe, expect, it, vi } from "vitest";
import {
  buildPublicStatusPayloadFromRollups,
  buildPublicStatusRollupField,
  buildPublicStatusRollupIncrements,
  buildPublicStatusRollupBucketStarts,
  parsePublicStatusRollupField,
  readPublicStatusRollupBuckets,
  writePublicStatusRollupEvent,
  type PublicStatusRollupBucket,
} from "@/lib/public-status/rollup-store";
import {
  buildPublicStatusRollupCoverageStartKey,
  buildPublicStatusRollupKey,
} from "@/lib/public-status/redis-contract";
import type { PublicStatusConfiguredGroup } from "@/lib/public-status/aggregation-core";

const groups: PublicStatusConfiguredGroup[] = [
  {
    sourceGroupId: 42,
    sourceGroupName: "openai",
    publicGroupSlug: "openai-public",
    displayName: "OpenAI",
    explanatoryCopy: null,
    sortOrder: 1,
    models: [
      {
        publicModelKey: "gpt-4.1",
        label: "GPT-4.1",
        vendorIconKey: "openai",
        requestTypeBadge: "openaiCompatible",
      },
    ],
  },
];

describe("public-status rollup store", () => {
  it("builds rollup increments by stable provider group id and public model key", () => {
    const increments = buildPublicStatusRollupIncrements({
      groups,
      event: {
        createdAt: "2026-04-21T10:02:00.000Z",
        originalModel: "gpt-4.1",
        durationMs: 1200,
        ttfbMs: 200,
        outputTokens: 50,
        providerChain: [
          {
            id: 7,
            name: "internal-provider",
            endpointUrl: "https://private.example.com",
            groupTag: "openai",
            reason: "request_success",
            statusCode: 200,
          },
        ],
      },
    });

    expect(increments).toEqual(
      expect.arrayContaining([
        { groupId: "42", modelKey: "gpt-4.1", metric: "success", value: 1 },
        { groupId: "42", modelKey: "gpt-4.1", metric: "ttfb_sum", value: 200 },
        { groupId: "42", modelKey: "gpt-4.1", metric: "ttfb_count", value: 1 },
        { groupId: "42", modelKey: "gpt-4.1", metric: "tps_sum", value: 50 },
        { groupId: "42", modelKey: "gpt-4.1", metric: "tps_count", value: 1 },
      ])
    );

    for (const increment of increments) {
      expect(increment.groupId).toBe("42");
      expect(JSON.stringify(increment)).not.toContain("private.example.com");
    }
  });

  it("excludes local/client failures from rollup counts", () => {
    const increments = buildPublicStatusRollupIncrements({
      groups,
      event: {
        createdAt: "2026-04-21T10:02:00.000Z",
        originalModel: "gpt-4.1",
        providerChain: [
          {
            id: 7,
            name: "internal-provider",
            groupTag: "openai",
            reason: "client_abort",
            statusCode: 499,
          },
        ],
      },
    });

    expect(increments).toEqual([]);
  });

  it("marks unmatched events as ignored instead of retryable write failures", async () => {
    const redis = {
      status: "ready",
      hincrbyfloat: vi.fn(),
      pipeline: vi.fn(),
    };

    const result = await writePublicStatusRollupEvent({
      redis,
      groups,
      event: {
        createdAt: "2026-04-21T10:02:00.000Z",
        originalModel: "not-public-model",
        providerChain: [
          {
            id: 7,
            name: "internal-provider",
            groupTag: "openai",
            reason: "request_success",
            statusCode: 200,
          },
        ],
      },
    });

    expect(result).toEqual({
      written: false,
      retryable: false,
      reason: "ignored",
      incrementCount: 0,
      key: null,
    });
    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  it("records latency and throughput only for the group that actually succeeds", () => {
    const fallbackGroups: PublicStatusConfiguredGroup[] = [
      groups[0]!,
      {
        sourceGroupId: 43,
        sourceGroupName: "backup",
        publicGroupSlug: "backup-public",
        displayName: "Backup",
        explanatoryCopy: null,
        sortOrder: 2,
        models: groups[0]!.models,
      },
    ];

    const increments = buildPublicStatusRollupIncrements({
      groups: fallbackGroups,
      event: {
        createdAt: "2026-04-21T10:02:00.000Z",
        originalModel: "gpt-4.1",
        durationMs: 1200,
        ttfbMs: 200,
        outputTokens: 50,
        providerChain: [
          {
            id: 7,
            name: "failed-provider",
            groupTag: "openai",
            reason: "retry_failed",
            statusCode: 500,
          },
          {
            id: 8,
            name: "successful-provider",
            groupTag: "backup",
            reason: "request_success",
            statusCode: 200,
          },
        ],
      },
    });

    expect(increments).toEqual(
      expect.arrayContaining([
        { groupId: "42", modelKey: "gpt-4.1", metric: "failure", value: 1 },
        { groupId: "43", modelKey: "gpt-4.1", metric: "success", value: 1 },
        { groupId: "43", modelKey: "gpt-4.1", metric: "ttfb_sum", value: 200 },
        { groupId: "43", modelKey: "gpt-4.1", metric: "ttfb_count", value: 1 },
        { groupId: "43", modelKey: "gpt-4.1", metric: "tps_sum", value: 50 },
        { groupId: "43", modelKey: "gpt-4.1", metric: "tps_count", value: 1 },
      ])
    );
    expect(increments).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: "42", metric: "ttfb_sum" }),
        expect.objectContaining({ groupId: "42", metric: "ttfb_count" }),
        expect.objectContaining({ groupId: "42", metric: "tps_sum" }),
        expect.objectContaining({ groupId: "42", metric: "tps_count" }),
      ])
    );
  });

  it("writes one 5m bucket hash instead of endpoint multiplied keys", async () => {
    const fields = new Map<string, number>();
    const pipeline = {
      hincrbyfloat: vi.fn((_key: string, field: string, increment: number) => {
        fields.set(field, (fields.get(field) ?? 0) + increment);
      }),
      set: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn(async () => [
        [null, "1"],
        [null, "1"],
        [null, "1"],
        [null, "1"],
        [null, "1"],
        [null, "OK"],
        [null, 1],
        [null, 1],
      ]),
    };
    const redis = {
      status: "ready",
      hincrbyfloat: vi.fn(async (_key: string, field: string, increment: number) => {
        fields.set(field, (fields.get(field) ?? 0) + increment);
      }),
      expire: vi.fn(),
      pipeline: vi.fn(() => pipeline),
    };

    const result = await writePublicStatusRollupEvent({
      redis,
      groups,
      event: {
        createdAt: "2026-04-21T10:02:00.000Z",
        originalModel: "gpt-4.1",
        durationMs: 1200,
        ttfbMs: 200,
        outputTokens: 50,
        providerChain: [
          {
            id: 7,
            name: "internal-provider",
            endpointUrl: "https://private.example.com",
            groupTag: "openai",
            reason: "request_success",
            statusCode: 200,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      written: true,
      retryable: false,
      key: buildPublicStatusRollupKey({ bucketStartIso: "2026-04-21T10:02:00.000Z" }),
    });
    expect(redis.hincrbyfloat).not.toHaveBeenCalled();
    expect(pipeline.hincrbyfloat.mock.calls.map(([key]) => key)).toEqual([
      result.key,
      result.key,
      result.key,
      result.key,
      result.key,
    ]);
    expect(pipeline.set).toHaveBeenCalledWith(
      buildPublicStatusRollupCoverageStartKey(),
      "2026-04-21T10:00:00.000Z",
      "NX"
    );
    expect(pipeline.expire).toHaveBeenCalledWith(result.key, 60 * 60 * 24 * 32);
    expect(pipeline.expire).toHaveBeenCalledWith(
      buildPublicStatusRollupCoverageStartKey(),
      60 * 60 * 24 * 32
    );
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
    expect(pipeline.hincrbyfloat.mock.calls.map((call) => call.join("|")).join("\n")).not.toContain(
      "private.example.com"
    );
    expect(
      fields.get(
        buildPublicStatusRollupField({
          groupId: 42,
          modelKey: "gpt-4.1",
          metric: "success",
        })
      )
    ).toBe(1);
  });

  it("rejects the rollup write when a Redis pipeline command fails", async () => {
    const pipelineError = new Error("ERR hash command failed");
    const pipeline = {
      hincrbyfloat: vi.fn(),
      set: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn(async () => [
        [pipelineError, null],
        [null, "1"],
        [null, "1"],
        [null, "1"],
        [null, "1"],
        [null, "OK"],
        [null, 1],
        [null, 1],
      ]),
    };
    const redis = {
      status: "ready",
      hincrbyfloat: vi.fn(),
      pipeline: vi.fn(() => pipeline),
    };

    await expect(
      writePublicStatusRollupEvent({
        redis,
        groups,
        event: {
          createdAt: "2026-04-21T10:02:00.000Z",
          originalModel: "gpt-4.1",
          durationMs: 1200,
          ttfbMs: 200,
          outputTokens: 50,
          providerChain: [
            {
              id: 7,
              name: "internal-provider",
              groupTag: "openai",
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
      })
    ).rejects.toThrow("Public status rollup pipeline failed");
  });

  it("rejects the rollup write when Redis pipeline returns no result", async () => {
    const pipeline = {
      hincrbyfloat: vi.fn(),
      set: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn(async () => null),
    };
    const redis = {
      status: "ready",
      hincrbyfloat: vi.fn(),
      pipeline: vi.fn(() => pipeline),
    };

    await expect(
      writePublicStatusRollupEvent({
        redis,
        groups,
        event: {
          createdAt: "2026-04-21T10:02:00.000Z",
          originalModel: "gpt-4.1",
          durationMs: 1200,
          ttfbMs: 200,
          outputTokens: 50,
          providerChain: [
            {
              id: 7,
              name: "internal-provider",
              groupTag: "openai",
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
      })
    ).rejects.toThrow("empty exec result");
  });

  it("reads rollup buckets through batched Redis pipelines when available", async () => {
    const bucketStarts = buildPublicStatusRollupBucketStarts({
      now: "2026-04-21T11:00:00.000Z",
      rangeHours: 1,
      intervalMinutes: 5,
    });
    const pipelineExec = vi.fn(async () =>
      bucketStarts.map((_, index) => [
        null,
        {
          [buildPublicStatusRollupField({
            groupId: 42,
            modelKey: "gpt-4.1",
            metric: "success",
          })]: String(index + 1),
        },
      ])
    );
    const pipeline = {
      hgetall: vi.fn(),
      exec: pipelineExec,
    };
    const redis = {
      hgetall: vi.fn(),
      pipeline: vi.fn(() => pipeline),
    };

    const buckets = await readPublicStatusRollupBuckets({
      redis,
      bucketStarts,
    });

    expect(redis.pipeline).toHaveBeenCalledTimes(1);
    expect(redis.hgetall).not.toHaveBeenCalled();
    expect(pipeline.hgetall).toHaveBeenCalledTimes(bucketStarts.length);
    expect(buckets).toHaveLength(bucketStarts.length);
    expect(
      buckets[0]?.values.get(
        buildPublicStatusRollupField({
          groupId: 42,
          modelKey: "gpt-4.1",
          metric: "success",
        })
      )
    ).toBe(1);
  });

  it("builds interval snapshots from 5m rollups by stable group id", () => {
    const bucketStarts = buildPublicStatusRollupBucketStarts({
      now: "2026-04-21T11:00:00.000Z",
      rangeHours: 1,
      intervalMinutes: 15,
    });
    const makeBucket = (
      bucketStart: string,
      entries: Array<{ groupId: string | number; metric: "success" | "failure"; value: number }>
    ): PublicStatusRollupBucket => ({
      bucketStart,
      values: new Map(
        entries.map((entry) => [
          buildPublicStatusRollupField({
            groupId: entry.groupId,
            modelKey: "gpt-4.1",
            metric: entry.metric,
          }),
          entry.value,
        ])
      ),
    });

    const result = buildPublicStatusPayloadFromRollups({
      rangeHours: 1,
      intervalMinutes: 15,
      now: "2026-04-21T11:00:00.000Z",
      groups,
      rollupBuckets: [
        makeBucket(bucketStarts[0]!, [{ groupId: 42, metric: "success", value: 1 }]),
        makeBucket(bucketStarts[1]!, [{ groupId: 42, metric: "failure", value: 1 }]),
        makeBucket(bucketStarts[2]!, [{ groupId: "openai", metric: "success", value: 1 }]),
      ],
    });

    const model = result.groups[0]?.models[0];
    expect(result.coveredFrom).toBe("2026-04-21T10:00:00.000Z");
    expect(result.coveredTo).toBe("2026-04-21T11:00:00.000Z");
    expect(model?.timeline).toHaveLength(4);
    expect(model?.timeline[0]).toMatchObject({
      bucketStart: "2026-04-21T10:00:00.000Z",
      sampleCount: 2,
      availabilityPct: 50,
      state: "operational",
    });
    expect(model?.availabilityPct).toBe(50);
  });

  it("rejects unsupported display intervals instead of silently rounding boundaries", () => {
    expect(() =>
      buildPublicStatusRollupBucketStarts({
        now: "2026-04-21T11:00:00.000Z",
        rangeHours: 1,
        intervalMinutes: 16,
      })
    ).toThrow("Unsupported public status rollup intervalMinutes: 16");
    expect(() =>
      buildPublicStatusPayloadFromRollups({
        rangeHours: 1,
        intervalMinutes: 16,
        now: "2026-04-21T11:00:00.000Z",
        groups,
        rollupBuckets: [],
      })
    ).toThrow("Unsupported public status rollup intervalMinutes: 16");
  });

  it("marks the latest partially failing bucket as degraded instead of fully operational", () => {
    const bucketStarts = buildPublicStatusRollupBucketStarts({
      now: "2026-04-21T11:00:00.000Z",
      rangeHours: 1,
      intervalMinutes: 15,
    });
    const makeBucket = (
      bucketStart: string,
      entries: Array<{ metric: "success" | "failure"; value: number }>
    ): PublicStatusRollupBucket => ({
      bucketStart,
      values: new Map(
        entries.map((entry) => [
          buildPublicStatusRollupField({
            groupId: 42,
            modelKey: "gpt-4.1",
            metric: entry.metric,
          }),
          entry.value,
        ])
      ),
    });

    const result = buildPublicStatusPayloadFromRollups({
      rangeHours: 1,
      intervalMinutes: 15,
      now: "2026-04-21T11:00:00.000Z",
      groups,
      rollupBuckets: [
        makeBucket(bucketStarts[9]!, [
          { metric: "success", value: 1 },
          { metric: "failure", value: 2 },
        ]),
      ],
    });

    const model = result.groups[0]?.models[0];
    expect(model?.latestState).toBe("degraded");
    expect(model?.timeline[3]).toMatchObject({
      availabilityPct: 33.33,
      state: "operational",
      sampleCount: 3,
    });
  });

  it("round-trips escaped rollup field parts", () => {
    const field = buildPublicStatusRollupField({
      groupId: "group|42",
      modelKey: "vendor/model|v1",
      metric: "failure",
    });

    expect(parsePublicStatusRollupField(field)).toEqual({
      groupId: "group|42",
      modelKey: "vendor/model|v1",
      metric: "failure",
    });
  });
});
