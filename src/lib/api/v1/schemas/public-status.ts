/**
 * /api/v1 public-status 资源 schema
 */

import { z } from "@hono/zod-openapi";

export const PublicStatusResponseSchema = z
  .object({})
  .passthrough()
  .describe("Public status 响应（passthrough；与现有 /api/public-status 保持一致）")
  .openapi({ example: { status: "ok" } });

export const PublicStatusSettingsRequestSchema = z
  .object({
    publicStatusWindowHours: z.number().int().positive(),
    publicStatusAggregationIntervalMinutes: z.number().int().positive(),
    groups: z.array(z.unknown()),
  })
  .passthrough()
  .describe("更新 public status 设置（passthrough）")
  .openapi({
    example: {
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
      groups: [],
    },
  });

export type PublicStatusSettingsRequest = z.infer<typeof PublicStatusSettingsRequestSchema>;

export const PublicStatusSettingsResponseSchema = z
  .object({
    updatedGroupCount: z.number().int().nonnegative(),
    configVersion: z.string(),
    publicStatusProjectionWarningCode: z.string().nullable(),
  })
  .describe("更新 public status 设置后的响应")
  .openapi({
    example: {
      updatedGroupCount: 1,
      configVersion: "abc123",
      publicStatusProjectionWarningCode: null,
    },
  });
