import { z } from "@hono/zod-openapi";
import { ProviderTypeSchema } from "./_common";

export const ProviderVendorIdParamSchema = z.object({
  vendorId: z.coerce.number().int().positive().describe("Provider vendor id."),
});

export const ProviderEndpointIdParamSchema = z.object({
  endpointId: z.coerce.number().int().positive().describe("Provider endpoint id."),
});

export const ProviderVendorListQuerySchema = z.object({
  dashboard: z.coerce.boolean().optional().describe("Return dashboard-oriented vendors."),
});

export const ProviderEndpointListQuerySchema = z.object({
  providerType: ProviderTypeSchema.optional().describe("Provider type filter."),
  dashboard: z.coerce.boolean().optional().describe("Return dashboard-oriented endpoints."),
});

export const ProviderEndpointCreateSchema = z
  .object({
    providerType: ProviderTypeSchema.describe("Provider type."),
    url: z.string().trim().url().describe("Endpoint URL."),
    label: z.string().trim().max(200).nullable().optional().describe("Endpoint label."),
    sortOrder: z.number().int().min(0).optional().describe("Sort order."),
    isEnabled: z.boolean().optional().describe("Whether the endpoint is enabled."),
  })
  .strict();

export const ProviderEndpointUpdateSchema = z
  .object({
    url: z.string().trim().url().optional().describe("Endpoint URL."),
    label: z.string().trim().max(200).nullable().optional().describe("Endpoint label."),
    sortOrder: z.number().int().min(0).optional().describe("Sort order."),
    isEnabled: z.boolean().optional().describe("Whether the endpoint is enabled."),
  })
  .strict();

export const ProviderEndpointProbeSchema = z
  .object({
    timeoutMs: z.number().int().min(1000).max(120_000).optional().describe("Probe timeout."),
  })
  .strict();

export const ProviderProbeLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200).describe("Log limit."),
  offset: z.coerce.number().int().min(0).default(0).describe("Log offset."),
});

export const BatchProbeLogsSchema = z
  .object({
    endpointIds: z.array(z.number().int().positive()).max(500).describe("Endpoint ids."),
    limit: z.number().int().min(1).max(200).optional().describe("Logs per endpoint."),
  })
  .strict();

export const BatchEndpointCircuitSchema = z
  .object({
    endpointIds: z.array(z.number().int().positive()).max(500).describe("Endpoint ids."),
  })
  .strict();

export const BatchVendorEndpointStatsSchema = z
  .object({
    vendorIds: z.array(z.number().int().positive()).max(500).describe("Vendor ids."),
    providerType: ProviderTypeSchema.describe("Provider type."),
  })
  .strict();

export const VendorTypeQuerySchema = z.object({
  providerType: ProviderTypeSchema.describe("Provider type."),
});

export const VendorTypeManualOpenSchema = z
  .object({
    providerType: ProviderTypeSchema.describe("Provider type."),
    manualOpen: z.boolean().describe("Whether the vendor type circuit is manually open."),
  })
  .strict();

export const VendorTypeBodySchema = z
  .object({
    providerType: ProviderTypeSchema.describe("Provider type."),
  })
  .strict();

export const ProviderVendorUpdateSchema = z
  .object({
    displayName: z.string().trim().max(200).nullable().optional().describe("Vendor display name."),
    websiteUrl: z.string().trim().url().nullable().optional().describe("Vendor website URL."),
  })
  .strict();

export const ProviderEndpointArrayResponseSchema = z.object({
  items: z.array(z.unknown()).describe("Provider endpoint items."),
});

export const ProviderVendorArrayResponseSchema = z.object({
  items: z.array(z.unknown()).describe("Provider vendor items."),
});

export const ProviderEndpointGenericResponseSchema = z
  .record(z.string(), z.unknown())
  .describe("Provider endpoint response object.");

export type ProviderEndpointCreateInput = z.infer<typeof ProviderEndpointCreateSchema>;
export type ProviderEndpointUpdateInput = z.infer<typeof ProviderEndpointUpdateSchema>;
export type ProviderEndpointProbeInput = z.infer<typeof ProviderEndpointProbeSchema>;
export type ProviderVendorUpdateInput = z.infer<typeof ProviderVendorUpdateSchema>;
