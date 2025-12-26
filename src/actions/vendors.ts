"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getTestHeaders } from "@/lib/provider-testing/utils/test-prompts";
import { RemoteConfigSyncService } from "@/lib/remote-config";
import { maskKey } from "@/lib/utils/validation";
import { runBalanceCheckCycle } from "@/lib/vendor-balance/balance-checker";
import { upsertRemoteConfigSync } from "@/repository/remote-config";
import {
  createVendor as createVendorRepo,
  deleteVendor as deleteVendorRepo,
  findAllVendors,
  findVendorById,
  updateVendor as updateVendorRepo,
} from "@/repository/vendor";
import { createVendorBalanceCheck } from "@/repository/vendor-balance";
import {
  createVendorEndpoint as createVendorEndpointRepo,
  deleteVendorEndpoint as deleteVendorEndpointRepo,
  findVendorEndpointById,
  findVendorEndpointsByVendorId,
  updateVendorEndpoint as updateVendorEndpointRepo,
} from "@/repository/vendor-endpoint";
import {
  createVendorKey as createVendorKeyRepo,
  deleteVendorKey as deleteVendorKeyRepo,
  findVendorKeyById,
  findVendorKeysByVendorId,
  updateVendorKey as updateVendorKeyRepo,
} from "@/repository/vendor-key";
import type { ProviderType } from "@/types/provider";
import type {
  Vendor,
  VendorApiFormat,
  VendorCategory,
  VendorEndpoint,
  VendorKey,
} from "@/types/vendor";
import type { ActionResult } from "./types";

export type VendorKeyDisplay = Omit<VendorKey, "key"> & { maskedKey: string };

export interface VendorBundle {
  vendor: Vendor;
  endpoints: VendorEndpoint[];
  keys: VendorKeyDisplay[];
}

const VendorCategorySchema = z.enum(["official", "relay", "self_hosted"]);
const VendorApiFormatSchema = z.enum(["claude", "codex", "gemini"]);

const ProviderTypeSchema = z.enum([
  "claude",
  "claude-auth",
  "codex",
  "gemini",
  "gemini-cli",
  "openai-compatible",
]);

const CodexInstructionsStrategySchema = z.enum(["auto", "force_official", "keep_original"]);
const McpPassthroughTypeSchema = z.enum(["none", "minimax", "glm", "custom"]);
const CacheTtlPreferenceSchema = z.enum(["inherit", "5m", "1h"]);
const Context1mPreferenceSchema = z.enum(["inherit", "force_enable", "disabled"]);

const CreateVendorSchema = z
  .object({
    slug: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(128),
    category: VendorCategorySchema,
    description: z.string().max(2000).nullable().optional(),
    isManaged: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
    tags: z.array(z.string().max(64)).optional(),
    websiteUrl: z.string().url().nullable().optional(),
    faviconUrl: z.string().url().nullable().optional(),
    balanceCheckEnabled: z.boolean().optional(),
    balanceCheckEndpoint: z.string().max(2000).nullable().optional(),
    balanceCheckJsonpath: z.string().max(2000).nullable().optional(),
    balanceCheckIntervalSeconds: z.coerce.number().int().positive().nullable().optional(),
    balanceCheckLowThresholdUsd: z.coerce.number().min(0).nullable().optional(),
  })
  .strict();

const UpdateVendorSchema = CreateVendorSchema.partial().strict();

const CreateVendorEndpointSchema = z
  .object({
    vendorId: z.number().int().positive(),
    name: z.string().trim().min(1).max(128),
    url: z.string().url(),
    apiFormat: VendorApiFormatSchema,
    isEnabled: z.boolean().optional(),
    priority: z.coerce.number().int().optional(),
    latencyMs: z.coerce.number().int().min(0).nullable().optional(),
    healthCheckEnabled: z.boolean().optional(),
    healthCheckEndpoint: z.string().max(2000).nullable().optional(),
    healthCheckIntervalSeconds: z.coerce.number().int().positive().nullable().optional(),
    healthCheckTimeoutMs: z.coerce.number().int().min(0).nullable().optional(),
  })
  .strict();

const UpdateVendorEndpointSchema = CreateVendorEndpointSchema.partial()
  .extend({
    healthCheckLastCheckedAt: z.preprocess((val) => {
      if (val === null || val === undefined || val === "") return undefined;
      if (val instanceof Date) return val;
      if (typeof val === "string" || typeof val === "number") return new Date(val);
      return val;
    }, z.date().nullable().optional()),
    healthCheckLastStatusCode: z.coerce.number().int().min(0).nullable().optional(),
    healthCheckErrorMessage: z.string().max(2000).nullable().optional(),
  })
  .strict();

const CreateVendorKeySchema = z
  .object({
    vendorId: z.number().int().positive(),
    endpointId: z.number().int().positive(),
    isUserOverride: z.boolean().optional(),
    name: z.string().trim().min(1).max(128),
    description: z.string().max(2000).nullable().optional(),
    url: z.string().url(),
    key: z.string().min(1).max(2000),
    isEnabled: z.boolean().optional(),
    weight: z.coerce.number().int().min(1).max(100).optional(),
    priority: z.coerce.number().int().optional(),
    costMultiplier: z.coerce.number().min(0).nullable().optional(),
    groupTag: z.string().max(64).nullable().optional(),
    providerType: ProviderTypeSchema.optional(),
    preserveClientIp: z.boolean().optional(),
    modelRedirects: z.record(z.string(), z.string()).nullable().optional(),
    allowedModels: z.array(z.string().max(128)).nullable().optional(),
    joinClaudePool: z.boolean().optional(),
    codexInstructionsStrategy: CodexInstructionsStrategySchema.optional(),
    mcpPassthroughType: McpPassthroughTypeSchema.optional(),
    mcpPassthroughUrl: z.string().url().nullable().optional(),
    limit5hUsd: z.coerce.number().min(0).nullable().optional(),
    limitDailyUsd: z.coerce.number().min(0).nullable().optional(),
    dailyResetMode: z.enum(["fixed", "rolling"]).optional(),
    dailyResetTime: z
      .string()
      .regex(/^([01]\\d|2[0-3]):[0-5]\\d$/, "dailyResetTime must be HH:mm")
      .optional(),
    limitWeeklyUsd: z.coerce.number().min(0).nullable().optional(),
    limitMonthlyUsd: z.coerce.number().min(0).nullable().optional(),
    limitConcurrentSessions: z.coerce.number().int().min(0).optional(),
    maxRetryAttempts: z.coerce.number().int().min(1).nullable().optional(),
    circuitBreakerFailureThreshold: z.coerce.number().int().min(1).optional(),
    circuitBreakerOpenDuration: z.coerce.number().int().min(1).optional(),
    circuitBreakerHalfOpenSuccessThreshold: z.coerce.number().int().min(1).optional(),
    proxyUrl: z.string().url().nullable().optional(),
    proxyFallbackToDirect: z.boolean().optional(),
    firstByteTimeoutStreamingMs: z.coerce.number().int().min(0).optional(),
    streamingIdleTimeoutMs: z.coerce.number().int().min(0).optional(),
    requestTimeoutNonStreamingMs: z.coerce.number().int().min(0).optional(),
    websiteUrl: z.string().url().nullable().optional(),
    faviconUrl: z.string().url().nullable().optional(),
    cacheTtlPreference: CacheTtlPreferenceSchema.nullable().optional(),
    context1mPreference: Context1mPreferenceSchema.nullable().optional(),
    tpm: z.coerce.number().int().min(0).nullable().optional(),
    rpm: z.coerce.number().int().min(0).nullable().optional(),
    rpd: z.coerce.number().int().min(0).nullable().optional(),
    cc: z.coerce.number().int().min(0).nullable().optional(),
  })
  .strict();

const UpdateVendorKeySchema = CreateVendorKeySchema.partial()
  .extend({
    balanceUsd: z.coerce.number().min(0).nullable().optional(),
    balanceUpdatedAt: z.preprocess((val) => {
      if (val === null || val === undefined || val === "") return undefined;
      if (val instanceof Date) return val;
      if (typeof val === "string" || typeof val === "number") return new Date(val);
      return val;
    }, z.date().nullable().optional()),
  })
  .strict();

function toVendorKeyDisplay(key: VendorKey): VendorKeyDisplay {
  const { key: secret, ...rest } = key;
  return { ...rest, maskedKey: maskKey(secret) };
}

function isAdminSession(session: Awaited<ReturnType<typeof getSession>>): boolean {
  return Boolean(session && session.user.role === "admin");
}

function zodErrorToMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

function createRemoteConfigSyncService(): RemoteConfigSyncService {
  // Vitest 常用写法：把 class mock 成 vi.fn(() => ({ ...methods }))
  // 这类 mock 在 `new` 场景下可能不会返回 mockImplementation 的对象，因此这里优先识别 mock 并按工厂调用。
  const maybeMock = RemoteConfigSyncService as unknown as { mock?: unknown };
  const isVitestMockFn = typeof maybeMock.mock === "object" && maybeMock.mock !== null;

  if (isVitestMockFn) {
    return (RemoteConfigSyncService as unknown as () => RemoteConfigSyncService)();
  }

  return new RemoteConfigSyncService();
}

const remoteConfigSyncService = createRemoteConfigSyncService();

export async function createVendor(
  data: z.infer<typeof CreateVendorSchema>
): Promise<ActionResult<Vendor>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validated = CreateVendorSchema.parse(data);
    const vendor = await createVendorRepo(validated);

    revalidatePath("/settings/vendors");
    return { ok: true, data: vendor };
  } catch (error) {
    logger.error("[vendors.createVendor] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function updateVendor(
  id: number,
  data: z.infer<typeof UpdateVendorSchema>
): Promise<ActionResult<Vendor>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedId = z.number().int().positive().parse(id);
    const validated = UpdateVendorSchema.parse(data);

    const vendor = await updateVendorRepo(validatedId, validated);
    if (!vendor) {
      return { ok: false, error: "供应商不存在" };
    }

    revalidatePath("/settings/vendors");
    return { ok: true, data: vendor };
  } catch (error) {
    logger.error("[vendors.updateVendor] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function deleteVendor(id: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedId = z.number().int().positive().parse(id);
    const deleted = await deleteVendorRepo(validatedId);
    if (!deleted) {
      return { ok: false, error: "供应商不存在" };
    }

    revalidatePath("/settings/vendors");
    return { ok: true };
  } catch (error) {
    logger.error("[vendors.deleteVendor] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function getVendors(): Promise<VendorBundle[]> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return [];
    }

    const vendors = await findAllVendors();
    const bundles = await Promise.all(
      vendors.map(async (vendor) => {
        const [endpoints, keys] = await Promise.all([
          findVendorEndpointsByVendorId(vendor.id),
          findVendorKeysByVendorId(vendor.id),
        ]);

        return {
          vendor,
          endpoints,
          keys: keys.map(toVendorKeyDisplay),
        } satisfies VendorBundle;
      })
    );

    return bundles;
  } catch (error) {
    logger.error("[vendors.getVendors] failed", { error });
    return [];
  }
}

export async function getVendorById(id: number): Promise<VendorBundle | null> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return null;
    }

    const validatedId = z.number().int().positive().parse(id);
    const vendor = await findVendorById(validatedId);
    if (!vendor) return null;

    const [endpoints, keys] = await Promise.all([
      findVendorEndpointsByVendorId(vendor.id),
      findVendorKeysByVendorId(vendor.id),
    ]);

    return {
      vendor,
      endpoints,
      keys: keys.map(toVendorKeyDisplay),
    };
  } catch (error) {
    logger.error("[vendors.getVendorById] failed", { error });
    return null;
  }
}

export interface SyncVendorsResult {
  remoteVersion: string;
  vendors: { inserted: number; updated: number; skipped: number };
  endpoints: { inserted: number; updated: number; skipped: number };
}

function parseVendorCategory(value: unknown): VendorCategory | null {
  const parsed = VendorCategorySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseVendorApiFormat(value: unknown): VendorApiFormat | null {
  const parsed = VendorApiFormatSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function syncVendorsFromRemote(): Promise<ActionResult<SyncVendorsResult>> {
  const now = new Date();

  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    await upsertRemoteConfigSync({
      configKey: "vendors",
      lastAttemptAt: now,
      lastErrorMessage: null,
    });

    const remote = await remoteConfigSyncService.syncVendors();

    if (!remote.ok) {
      await upsertRemoteConfigSync({
        configKey: "vendors",
        lastAttemptAt: now,
        lastErrorMessage: remote.error,
      });
      return { ok: false, error: remote.error };
    }

    const localVendors = await findAllVendors();
    const localBySlug = new Map(localVendors.map((vendor) => [vendor.slug, vendor]));

    let vendorsInserted = 0;
    let vendorsUpdated = 0;
    let vendorsSkipped = 0;
    let endpointsInserted = 0;
    let endpointsUpdated = 0;
    let endpointsSkipped = 0;

    for (const remoteVendor of remote.data.vendors) {
      const category = parseVendorCategory(remoteVendor.category);
      if (!category) {
        vendorsSkipped += 1;
        continue;
      }

      const balanceConfig = remoteVendor.balance_check;
      const desiredVendorData = {
        slug: remoteVendor.slug,
        name: remoteVendor.name,
        category,
        isManaged: true,
        tags: remoteVendor.tags ?? [],
        websiteUrl: remoteVendor.website_url ?? null,
        faviconUrl: remoteVendor.favicon_url ?? null,
        balanceCheckEnabled: Boolean(balanceConfig?.enabled),
        balanceCheckEndpoint: balanceConfig?.endpoint ?? null,
        balanceCheckJsonpath: balanceConfig?.jsonpath ?? null,
        balanceCheckIntervalSeconds: balanceConfig?.interval_seconds ?? null,
        balanceCheckLowThresholdUsd: balanceConfig?.low_threshold_usd ?? null,
      };

      const existing = localBySlug.get(remoteVendor.slug);
      let vendor: Vendor | null = null;

      if (!existing) {
        vendor = await createVendorRepo(desiredVendorData);
        localBySlug.set(vendor.slug, vendor);
        vendorsInserted += 1;
      } else if (existing.isManaged) {
        vendor = await updateVendorRepo(existing.id, desiredVendorData);
        if (vendor) {
          localBySlug.set(vendor.slug, vendor);
        }
        vendorsUpdated += 1;
      } else {
        vendor = existing;
        vendorsSkipped += 1;
      }

      if (!vendor) continue;

      const localEndpoints = await findVendorEndpointsByVendorId(vendor.id);
      const endpointByUrl = new Map(localEndpoints.map((endpoint) => [endpoint.url, endpoint]));

      for (const remoteEndpoint of remoteVendor.endpoints ?? []) {
        const apiFormat = parseVendorApiFormat(remoteEndpoint.api_format);
        if (!apiFormat) {
          endpointsSkipped += 1;
          continue;
        }

        const existingEndpoint = endpointByUrl.get(remoteEndpoint.url);
        const desiredEndpointData = {
          vendorId: vendor.id,
          name: remoteEndpoint.name,
          url: remoteEndpoint.url,
          apiFormat,
          isEnabled: true,
        };

        if (!existingEndpoint) {
          const created = await createVendorEndpointRepo(desiredEndpointData);
          endpointByUrl.set(created.url, created);
          endpointsInserted += 1;
        } else if (vendor.isManaged) {
          const updated = await updateVendorEndpointRepo(existingEndpoint.id, desiredEndpointData);
          if (updated) {
            endpointByUrl.set(updated.url, updated);
          }
          endpointsUpdated += 1;
        } else {
          endpointsSkipped += 1;
        }
      }
    }

    await upsertRemoteConfigSync({
      configKey: "vendors",
      remoteVersion: remote.remoteVersion,
      lastAttemptAt: now,
      lastSyncedAt: now,
      lastErrorMessage: null,
    });

    revalidatePath("/settings/vendors");
    return {
      ok: true,
      data: {
        remoteVersion: remote.remoteVersion,
        vendors: { inserted: vendorsInserted, updated: vendorsUpdated, skipped: vendorsSkipped },
        endpoints: {
          inserted: endpointsInserted,
          updated: endpointsUpdated,
          skipped: endpointsSkipped,
        },
      },
    };
  } catch (error) {
    logger.error("[vendors.syncVendorsFromRemote] failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await upsertRemoteConfigSync({
      configKey: "vendors",
      lastAttemptAt: now,
      lastErrorMessage: zodErrorToMessage(error),
    });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function createVendorEndpoint(
  data: z.infer<typeof CreateVendorEndpointSchema>
): Promise<ActionResult<VendorEndpoint>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validated = CreateVendorEndpointSchema.parse(data);
    const endpoint = await createVendorEndpointRepo(validated);

    revalidatePath("/settings/vendors");
    return { ok: true, data: endpoint };
  } catch (error) {
    logger.error("[vendors.createVendorEndpoint] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function updateVendorEndpoint(
  id: number,
  data: z.infer<typeof UpdateVendorEndpointSchema>
): Promise<ActionResult<VendorEndpoint>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedId = z.number().int().positive().parse(id);
    const validated = UpdateVendorEndpointSchema.parse(data);

    const endpoint = await updateVendorEndpointRepo(validatedId, validated);
    if (!endpoint) {
      return { ok: false, error: "线路不存在" };
    }

    revalidatePath("/settings/vendors");
    return { ok: true, data: endpoint };
  } catch (error) {
    logger.error("[vendors.updateVendorEndpoint] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function deleteVendorEndpoint(id: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedId = z.number().int().positive().parse(id);
    const deleted = await deleteVendorEndpointRepo(validatedId);
    if (!deleted) {
      return { ok: false, error: "线路不存在" };
    }

    revalidatePath("/settings/vendors");
    return { ok: true };
  } catch (error) {
    logger.error("[vendors.deleteVendorEndpoint] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function createVendorKey(
  data: z.infer<typeof CreateVendorKeySchema>
): Promise<ActionResult<VendorKeyDisplay>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validated = CreateVendorKeySchema.parse(data);
    const created = await createVendorKeyRepo(validated);

    revalidatePath("/settings/vendors");
    return { ok: true, data: toVendorKeyDisplay(created) };
  } catch (error) {
    logger.error("[vendors.createVendorKey] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function updateVendorKey(
  id: number,
  data: z.infer<typeof UpdateVendorKeySchema>
): Promise<ActionResult<VendorKeyDisplay>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedId = z.number().int().positive().parse(id);
    const validated = UpdateVendorKeySchema.parse(data);

    const updated = await updateVendorKeyRepo(validatedId, validated);
    if (!updated) {
      return { ok: false, error: "密钥不存在" };
    }

    revalidatePath("/settings/vendors");
    return { ok: true, data: toVendorKeyDisplay(updated) };
  } catch (error) {
    logger.error("[vendors.updateVendorKey] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function deleteVendorKey(id: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedId = z.number().int().positive().parse(id);
    const deleted = await deleteVendorKeyRepo(validatedId);
    if (!deleted) {
      return { ok: false, error: "密钥不存在" };
    }

    revalidatePath("/settings/vendors");
    return { ok: true };
  } catch (error) {
    logger.error("[vendors.deleteVendorKey] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export interface BalanceCheckResult {
  vendorKeyId: number;
  ok: boolean;
  balanceUsd: number | null;
  disabled: boolean;
  statusCode: number | null;
  errorMessage: string | null;
}

export async function checkVendorBalance(keyId: number): Promise<ActionResult<BalanceCheckResult>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedKeyId = z.number().int().positive().parse(keyId);
    const vendorKey = await findVendorKeyById(validatedKeyId);
    if (!vendorKey) {
      return { ok: false, error: "密钥不存在" };
    }

    const vendor = await findVendorById(vendorKey.vendorId);
    if (!vendor) {
      return { ok: false, error: "供应商不存在" };
    }

    if (!vendor.balanceCheckEnabled) {
      return { ok: false, error: "该供应商未启用余额检查" };
    }

    if (!vendor.balanceCheckEndpoint || !vendor.balanceCheckJsonpath) {
      return { ok: false, error: "余额检查配置不完整" };
    }

    const target = {
      vendorKeyId: vendorKey.id,
      vendorId: vendorKey.vendorId,
      endpointId: vendorKey.endpointId,
      providerType: vendorKey.providerType as ProviderType,
      baseUrl: vendorKey.url,
      apiKey: vendorKey.key,
      balanceCheckEndpoint: vendor.balanceCheckEndpoint,
      balanceCheckJsonpath: vendor.balanceCheckJsonpath,
      lowThresholdUsd: vendor.balanceCheckLowThresholdUsd,
    };

    const [result] = await runBalanceCheckCycle({
      store: {
        listBalanceCheckTargets: async () => [target],
        recordBalanceCheck: async (data) => {
          await createVendorBalanceCheck({
            vendorKeyId: data.vendorKeyId,
            vendorId: data.vendorId,
            endpointId: data.endpointId,
            checkedAt: data.checkedAt,
            durationMs: data.durationMs,
            statusCode: data.statusCode,
            isSuccess: data.isSuccess,
            balanceUsd: data.balanceUsd,
            rawResponse: data.rawResponse,
            errorMessage: data.errorMessage,
          });
        },
        updateVendorKeyBalance: async (vendorKeyId, balanceUsd) => {
          await updateVendorKeyRepo(vendorKeyId, {
            balanceUsd,
            balanceUpdatedAt: new Date(),
          });
        },
        disableVendorKey: async (vendorKeyId) => {
          await updateVendorKeyRepo(vendorKeyId, { isEnabled: false });
        },
      },
      fetchImpl: async (url, init) => {
        // Ensure we always send provider-specific auth headers for balance checking.
        const headers = getTestHeaders(vendorKey.providerType, vendorKey.key);
        return await fetch(url, {
          ...init,
          method: "GET",
          headers,
        });
      },
    });

    if (!result) {
      return { ok: false, error: "余额检查未返回结果" };
    }

    return { ok: true, data: result };
  } catch (error) {
    logger.error("[vendors.checkVendorBalance] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function getVendorEndpointById(id: number): Promise<ActionResult<VendorEndpoint>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedId = z.number().int().positive().parse(id);
    const endpoint = await findVendorEndpointById(validatedId);
    if (!endpoint) {
      return { ok: false, error: "线路不存在" };
    }

    return { ok: true, data: endpoint };
  } catch (error) {
    logger.error("[vendors.getVendorEndpointById] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function getVendorKeyById(id: number): Promise<ActionResult<VendorKeyDisplay>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedId = z.number().int().positive().parse(id);
    const vendorKey = await findVendorKeyById(validatedId);
    if (!vendorKey) {
      return { ok: false, error: "密钥不存在" };
    }

    return { ok: true, data: toVendorKeyDisplay(vendorKey) };
  } catch (error) {
    logger.error("[vendors.getVendorKeyById] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}

export async function resolveVendorKeyAuthHeaders(
  keyId: number
): Promise<ActionResult<Record<string, string>>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedId = z.number().int().positive().parse(keyId);
    const vendorKey = await findVendorKeyById(validatedId);
    if (!vendorKey) {
      return { ok: false, error: "密钥不存在" };
    }

    return { ok: true, data: getTestHeaders(vendorKey.providerType, vendorKey.key) };
  } catch (error) {
    logger.error("[vendors.resolveVendorKeyAuthHeaders] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}
