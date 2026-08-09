import { z } from "@hono/zod-openapi";
import { IsoDateTimeStringSchema } from "./_common";

export const ProviderSiteGroupRateSchema = z.object({
  id: z.number().int().positive().describe("Site group rate id."),
  siteId: z.number().int().positive().describe("Parent provider site id."),
  groupName: z.string().describe("Upstream website group name."),
  description: z.string().nullable().describe("Optional group description."),
  ratio: z.number().min(0).describe("Upstream group ratio / rate multiplier."),
  effectiveRatio: z
    .number()
    .min(0)
    .describe("CCH-facing group ratio after dividing by the site's recharge multiplier."),
  completionRatio: z
    .number()
    .min(0)
    .nullable()
    .describe("Optional completion/output ratio; 0 or null means unused."),
  effectiveCompletionRatio: z
    .number()
    .min(0)
    .nullable()
    .describe("CCH-facing completion ratio after dividing by the site's recharge multiplier."),
  dispatchGroupTag: z.string().nullable().describe("CCH dispatch pool tag after classification."),
  lastSeenAt: IsoDateTimeStringSchema.describe("Last seen / synced time."),
  createdAt: IsoDateTimeStringSchema.describe("Creation time."),
  updatedAt: IsoDateTimeStringSchema.describe("Last update time."),
});

export const ProviderSiteSchema = z.object({
  id: z.number().int().positive().describe("Provider site id."),
  name: z.string().describe("Display name for the upstream website."),
  siteUrl: z.string().url().describe("Website base URL."),
  siteType: z.string().describe("Site type: sub2api | newapi | custom."),
  providerVendorId: z.number().int().positive().nullable().describe("Optional vendor id."),
  notes: z.string().nullable().describe("Optional notes."),
  isEnabled: z.boolean().describe("Whether the site is enabled."),
  sortOrder: z.number().int().optional().describe("Manual display order (lower first)."),
  rechargeMultiplier: z
    .number()
    .finite()
    .positive()
    .describe("Divide upstream group ratios and balance by this value for CCH-facing amounts."),
  upstreamHubChannelId: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("Optional Upstream Hub channel id."),
  username: z.string().nullable().optional().describe("Upstream login username/email."),
  hasPassword: z.boolean().optional().describe("Whether a password is stored."),
  turnstileEnabled: z.boolean().optional().describe("Whether Turnstile captcha is required."),
  captchaProvider: z
    .string()
    .optional()
    .describe("Captcha selection: none | global | yescaptcha | capsolver | 2captcha | anticaptcha."),
  hasCaptchaApiKey: z.boolean().optional().describe("Whether captcha API key is stored."),
  captchaEndpoint: z
    .string()
    .nullable()
    .optional()
    .describe("Optional captcha API endpoint override."),
  lastBalance: z.number().nullable().optional().describe("Last known upstream balance."),
  realBalance: z
    .number()
    .nullable()
    .optional()
    .describe("CCH-facing balance: upstream balance divided by recharge multiplier."),
  lastBalanceAt: IsoDateTimeStringSchema.nullable()
    .optional()
    .describe("Last balance sample time."),
  todayCost: z.number().nullable().optional().describe("Upstream today cost if available."),
  totalCost: z.number().nullable().optional().describe("Upstream total cost if available."),
  lastSyncError: z.string().nullable().optional().describe("Last sync error message."),
  lastSyncAt: IsoDateTimeStringSchema.nullable().optional().describe("Last sync attempt time."),
  lastRateSyncedAt: IsoDateTimeStringSchema.nullable().describe("Last rate sync time."),
  lastCostSyncedAt: IsoDateTimeStringSchema.nullable().describe("Last cost sync time."),
  createdAt: IsoDateTimeStringSchema.describe("Creation time."),
  updatedAt: IsoDateTimeStringSchema.describe("Last update time."),
  groupRates: z
    .array(ProviderSiteGroupRateSchema)
    .optional()
    .describe("Upstream group rates under this site."),
  providerCount: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Number of providers attached to this site."),
  enabledProviderCount: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Number of enabled providers attached to this site."),
});

export const ProviderSiteListResponseSchema = z.object({
  items: z.array(ProviderSiteSchema).describe("Provider sites."),
});

export const ProviderSiteCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(128).describe("Site display name."),
    siteUrl: z.string().trim().url().max(2000).describe("Website base URL."),
    siteType: z.enum(["sub2api", "newapi", "custom"]).optional().describe("Site type."),
    providerVendorId: z.number().int().positive().nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    isEnabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
    rechargeMultiplier: z.number().finite().positive().optional(),
    upstreamHubChannelId: z.number().int().positive().nullable().optional(),
    username: z.string().trim().max(256).nullable().optional(),
    password: z.string().max(512).nullable().optional(),
    turnstileEnabled: z.boolean().optional(),
    captchaProvider: z
      .enum(["none", "global", "yescaptcha", "capsolver", "2captcha", "anticaptcha"])
      .optional(),
    captchaApiKey: z.string().max(512).nullable().optional(),
    captchaEndpoint: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const ProviderSiteUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    siteUrl: z.string().trim().url().max(2000).optional(),
    siteType: z.enum(["sub2api", "newapi", "custom"]).optional(),
    providerVendorId: z.number().int().positive().nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    isEnabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
    rechargeMultiplier: z.number().finite().positive().optional(),
    upstreamHubChannelId: z.number().int().positive().nullable().optional(),
    username: z.string().trim().max(256).nullable().optional(),
    password: z.string().max(512).nullable().optional(),
    turnstileEnabled: z.boolean().optional(),
    captchaProvider: z
      .enum(["none", "global", "yescaptcha", "capsolver", "2captcha", "anticaptcha"])
      .optional(),
    captchaApiKey: z.string().max(512).nullable().optional(),
    captchaEndpoint: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const ProviderSiteReorderSchema = z
  .object({
    orderedIds: z.array(z.number().int().positive()).min(1).describe("Site ids in display order."),
  })
  .strict();

export const ProviderSiteSyncResultSchema = z.object({
  siteId: z.number().int().positive(),
  siteName: z.string(),
  ok: z.boolean(),
  groupsUpserted: z.number().int().min(0),
  groupsSeen: z.number().int().min(0),
  balance: z.number().nullable(),
  todayCost: z.number().nullable(),
  totalCost: z.number().nullable(),
  error: z.string().optional(),
  durationMs: z.number(),
});

export const ProviderSiteSyncAllResponseSchema = z.object({
  items: z.array(ProviderSiteSyncResultSchema),
});

export const ProviderSiteIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Provider site id."),
});

export const ProviderSiteGroupRateIdParamSchema = z.object({
  id: z.coerce.number().int().positive().describe("Site group rate id."),
});

export const ProviderSiteGroupRateUpsertSchema = z
  .object({
    groupName: z.string().trim().min(1).max(256).describe("Upstream group name."),
    description: z.string().max(5000).nullable().optional(),
    ratio: z.number().min(0).optional().describe("Group ratio / multiplier."),
    completionRatio: z.number().min(0).nullable().optional(),
    dispatchGroupTag: z.string().max(64).nullable().optional(),
  })
  .strict();

export const ProviderSiteGroupRateUpdateSchema = z
  .object({
    groupName: z.string().trim().min(1).max(256).optional(),
    description: z.string().max(5000).nullable().optional(),
    ratio: z.number().min(0).optional(),
    completionRatio: z.number().min(0).nullable().optional(),
    dispatchGroupTag: z.string().max(64).nullable().optional(),
  })
  .strict();

export type ProviderSiteResponse = z.infer<typeof ProviderSiteSchema>;
export type ProviderSiteCreateInput = z.infer<typeof ProviderSiteCreateSchema>;
export type ProviderSiteUpdateInput = z.infer<typeof ProviderSiteUpdateSchema>;
export type ProviderSiteGroupRateUpsertInput = z.infer<typeof ProviderSiteGroupRateUpsertSchema>;
export type ProviderSiteGroupRateUpdateInput = z.infer<typeof ProviderSiteGroupRateUpdateSchema>;
