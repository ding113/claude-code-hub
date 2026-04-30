import { z } from "@hono/zod-openapi";

const ResetModeSchema = z.enum(["fixed", "rolling"]);
const CacheTtlPreferenceSchema = z.enum(["inherit", "5m", "1h"]);

export const KeyIdParamSchema = z.object({
  keyId: z.coerce.number().int().positive().describe("Key id."),
});

export const UserIdForKeysParamSchema = z.object({
  userId: z.coerce.number().int().positive().describe("User id."),
});

export const KeyListQuerySchema = z.object({
  include: z.enum(["statistics"]).optional().describe("Optional statistics expansion."),
});

const KeyMutationFields = {
  name: z.string().trim().min(1).max(64).describe("Key name."),
  expiresAt: z.union([z.string(), z.null()]).optional().describe("Expiration date or null."),
  isEnabled: z.boolean().optional().describe("Whether the key is enabled."),
  canLoginWebUi: z.boolean().optional().describe("Whether this key can login to the Web UI."),
  limit5hUsd: z.number().min(0).max(10_000).nullable().optional().describe("Five-hour USD quota."),
  limit5hResetMode: ResetModeSchema.optional().describe("Five-hour reset mode."),
  limitDailyUsd: z.number().min(0).max(10_000).nullable().optional().describe("Daily USD quota."),
  dailyResetMode: ResetModeSchema.optional().describe("Daily reset mode."),
  dailyResetTime: z
    .string()
    .regex(/^([01]?\d|2[0-3]):[0-5]\d$/)
    .optional()
    .describe("Daily reset time in HH:mm."),
  limitWeeklyUsd: z.number().min(0).max(50_000).nullable().optional().describe("Weekly USD quota."),
  limitMonthlyUsd: z
    .number()
    .min(0)
    .max(200_000)
    .nullable()
    .optional()
    .describe("Monthly USD quota."),
  limitTotalUsd: z
    .number()
    .min(0)
    .max(10_000_000)
    .nullable()
    .optional()
    .describe("Total USD quota."),
  limitConcurrentSessions: z
    .number()
    .int()
    .min(0)
    .max(1000)
    .optional()
    .describe("Concurrent session limit."),
  providerGroup: z.string().max(200).nullable().optional().describe("Provider group expression."),
  cacheTtlPreference: CacheTtlPreferenceSchema.optional().describe("Cache TTL preference."),
};

export const KeyCreateSchema = z.object(KeyMutationFields).strict();

export const KeyUpdateSchema = z
  .object(KeyMutationFields)
  .partial()
  .extend({
    name: z.string().trim().min(1).max(64).describe("Key name."),
  })
  .strict();

export const KeyEnableSchema = z
  .object({
    enabled: z.boolean().describe("Target enabled state."),
  })
  .strict();

export const KeyRenewSchema = z
  .object({
    expiresAt: z.string().min(1).describe("New expiration timestamp."),
    enableKey: z.boolean().optional().describe("Enable the key while renewing."),
  })
  .strict();

export const PatchKeyLimitFieldSchema = z.enum([
  "limit5hUsd",
  "limitDailyUsd",
  "limitWeeklyUsd",
  "limitMonthlyUsd",
  "limitTotalUsd",
  "limitConcurrentSessions",
]);

export const PatchKeyLimitParamSchema = KeyIdParamSchema.extend({
  field: PatchKeyLimitFieldSchema.describe("Limit field to patch."),
});

export const PatchKeyLimitSchema = z
  .object({
    value: z.number().min(0).nullable().describe("New limit value."),
  })
  .strict();

export const KeysBatchUpdateSchema = z
  .object({
    keyIds: z.array(z.number().int().positive()).max(500).describe("Key ids."),
    updates: z
      .object({
        providerGroup: z
          .string()
          .max(200)
          .nullable()
          .optional()
          .describe("Provider group expression."),
        limit5hUsd: z.number().min(0).nullable().optional().describe("Five-hour USD quota."),
        limit5hResetMode: ResetModeSchema.optional().describe("Five-hour reset mode."),
        limitDailyUsd: z.number().min(0).nullable().optional().describe("Daily USD quota."),
        limitWeeklyUsd: z.number().min(0).nullable().optional().describe("Weekly USD quota."),
        limitMonthlyUsd: z.number().min(0).nullable().optional().describe("Monthly USD quota."),
        canLoginWebUi: z.boolean().optional().describe("Web UI login permission."),
        isEnabled: z.boolean().optional().describe("Enabled state."),
      })
      .strict()
      .describe("Fields to update."),
  })
  .strict();

export const GenericKeyResponseSchema = z
  .record(z.string(), z.unknown())
  .describe("Key API response object.");

export const KeyListResponseSchema = z.object({
  items: z.array(z.unknown()).describe("Keys for the user."),
});

export type KeyCreateInput = z.infer<typeof KeyCreateSchema>;
export type KeyUpdateInput = z.infer<typeof KeyUpdateSchema>;
export type KeyRenewInput = z.infer<typeof KeyRenewSchema>;
export type PatchKeyLimitFieldInput = z.infer<typeof PatchKeyLimitFieldSchema>;
