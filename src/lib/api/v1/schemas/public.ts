import { z } from "@hono/zod-openapi";

export const PublicStatusResponseSchema = z
  .record(z.string(), z.unknown())
  .describe("Public status response.");

export const PublicStatusModelConfigSchema = z
  .record(z.string(), z.unknown())
  .describe("Public status model configuration.");

export const PublicStatusSettingsUpdateSchema = z
  .object({
    publicStatusWindowHours: z.number().int().min(1).max(168).describe("Status window in hours."),
    publicStatusAggregationIntervalMinutes: z
      .number()
      .int()
      .describe("Aggregation interval in minutes."),
    groups: z
      .array(
        z
          .object({
            groupName: z.string().min(1).describe("Provider group name."),
            displayName: z.string().optional().describe("Public display name."),
            publicGroupSlug: z.string().optional().describe("Public group slug."),
            explanatoryCopy: z
              .string()
              .nullable()
              .optional()
              .describe("Optional explanatory copy."),
            sortOrder: z.number().int().optional().describe("Public sort order."),
            publicModels: z
              .array(PublicStatusModelConfigSchema)
              .describe("Published model configs."),
          })
          .strict()
      )
      .describe("Public status group settings."),
  })
  .strict();

export const PublicStatusSettingsUpdateResponseSchema = z.object({
  updatedGroupCount: z.number().int().min(0).describe("Number of updated provider groups."),
  configVersion: z.string().describe("Published config version."),
  publicStatusProjectionWarningCode: z
    .string()
    .nullable()
    .describe("Optional public status projection warning code."),
});

export const IpGeoParamSchema = z.object({
  ip: z.string().min(1).describe("IP address to look up."),
});

export const IpGeoQuerySchema = z.object({
  lang: z.string().min(1).optional().describe("Preferred result language."),
});

export const IpGeoLookupResponseSchema = z
  .union([
    z.object({
      status: z.literal("ok"),
      data: z.record(z.string(), z.unknown()).describe("IP geolocation lookup result."),
    }),
    z.object({
      status: z.literal("private"),
      data: z.object({
        ip: z.string().describe("Private IP address."),
        kind: z.literal("private"),
      }),
    }),
    z.object({
      status: z.literal("error"),
      error: z.string().describe("Lookup error."),
    }),
  ])
  .describe("IP geolocation response.");

export type PublicStatusSettingsUpdateInput = z.infer<typeof PublicStatusSettingsUpdateSchema>;
export type PublicStatusSettingsUpdateResponse = z.infer<
  typeof PublicStatusSettingsUpdateResponseSchema
>;
export type IpGeoLookupResponse = z.infer<typeof IpGeoLookupResponseSchema>;
