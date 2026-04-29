/**
 * /api/v1 provider-vendors / provider-endpoints 资源 schema
 *
 * - 供应商（vendor）：维度对应 src/types/provider.ProviderVendor；
 * - 端点（endpoint）：维度对应 src/types/provider.ProviderEndpoint；
 * - providerType 显式使用 v1 公共 ProviderTypeSchema（不含 claude-auth / gemini-cli），
 *   写入接口会因此自动拒绝隐藏类型。
 */

import { z } from "@hono/zod-openapi";
import { IsoDateTimeSchema } from "../_shared/serialization";
import { ProviderTypeSchema } from "./_common";

// ==================== Vendor 输入 ====================

export const ProviderVendorUpdateSchema = z
  .object({
    displayName: z.string().trim().max(200).nullable().optional().describe("显示名"),
    websiteUrl: z.string().trim().url().nullable().optional().describe("供应商官网"),
  })
  .describe("更新 vendor 的请求体（局部更新）")
  .openapi({ example: { displayName: "Anthropic" } });

export type ProviderVendorUpdateInput = z.infer<typeof ProviderVendorUpdateSchema>;

// ==================== Endpoint 输入 ====================

export const ProviderEndpointCreateSchema = z
  .object({
    providerType: ProviderTypeSchema,
    url: z
      .string()
      .trim()
      .url()
      .describe("端点 URL")
      .openapi({ example: "https://api.anthropic.com/v1" }),
    label: z.string().trim().max(200).nullable().optional().describe("端点别名"),
    sortOrder: z.number().int().min(0).optional().describe("排序顺序"),
    isEnabled: z.boolean().optional().describe("是否启用"),
  })
  .describe("创建 provider endpoint 的请求体")
  .openapi({
    example: {
      providerType: "claude",
      url: "https://api.anthropic.com/v1",
      label: "primary",
      sortOrder: 0,
      isEnabled: true,
    },
  });

export type ProviderEndpointCreateInput = z.infer<typeof ProviderEndpointCreateSchema>;

export const ProviderEndpointUpdateSchema = z
  .object({
    url: z.string().trim().url().optional(),
    label: z.string().trim().max(200).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    isEnabled: z.boolean().optional(),
  })
  .describe("更新 provider endpoint 的请求体（局部）")
  .openapi({ example: { isEnabled: false } });

export type ProviderEndpointUpdateInput = z.infer<typeof ProviderEndpointUpdateSchema>;

export const ProviderEndpointProbeSchema = z
  .object({
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  })
  .describe("触发 endpoint 探测的请求体")
  .openapi({ example: { timeoutMs: 5000 } });

export type ProviderEndpointProbeInput = z.infer<typeof ProviderEndpointProbeSchema>;

// ==================== Vendor 输出 ====================

export const ProviderVendorResponseSchema = z
  .object({
    id: z.number().int().positive(),
    websiteDomain: z.string(),
    displayName: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    faviconUrl: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    providerTypes: z
      .array(ProviderTypeSchema)
      .optional()
      .describe("Dashboard 模式下返回该 vendor 启用的 provider 类型列表"),
  })
  .describe("Provider Vendor 响应");

export type ProviderVendorResponse = z.infer<typeof ProviderVendorResponseSchema>;

export const ProviderVendorListResponseSchema = z
  .object({
    items: z.array(ProviderVendorResponseSchema),
  })
  .describe("Provider Vendor 列表响应");

export type ProviderVendorListResponse = z.infer<typeof ProviderVendorListResponseSchema>;

// ==================== Endpoint 输出 ====================

export const ProviderEndpointResponseSchema = z
  .object({
    id: z.number().int().positive(),
    vendorId: z.number().int().positive(),
    providerType: ProviderTypeSchema,
    url: z.string(),
    label: z.string().nullable(),
    sortOrder: z.number().int(),
    isEnabled: z.boolean(),
    lastProbedAt: IsoDateTimeSchema.nullable(),
    lastProbeOk: z.boolean().nullable(),
    lastProbeStatusCode: z.number().int().nullable(),
    lastProbeLatencyMs: z.number().int().nullable(),
    lastProbeErrorType: z.string().nullable(),
    lastProbeErrorMessage: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .describe("Provider Endpoint 响应");

export type ProviderEndpointResponse = z.infer<typeof ProviderEndpointResponseSchema>;

export const ProviderEndpointListResponseSchema = z
  .object({
    items: z.array(ProviderEndpointResponseSchema),
  })
  .describe("Provider Endpoint 列表响应");

export type ProviderEndpointListResponse = z.infer<typeof ProviderEndpointListResponseSchema>;

// ==================== Probe 输出 ====================

export const ProviderEndpointProbeResultSchema = z
  .object({
    endpoint: ProviderEndpointResponseSchema,
    result: z.object({
      ok: z.boolean(),
      method: z.enum(["HEAD", "GET", "TCP"]),
      statusCode: z.number().int().nullable(),
      latencyMs: z.number().int().nullable(),
      errorType: z.string().nullable(),
      errorMessage: z.string().nullable(),
    }),
  })
  .describe("端点探测结果");

export const ProviderEndpointProbeLogSchema = z
  .object({
    id: z.number().int().positive(),
    endpointId: z.number().int().positive(),
    source: z.enum(["scheduled", "manual", "runtime"]),
    ok: z.boolean(),
    statusCode: z.number().int().nullable(),
    latencyMs: z.number().int().nullable(),
    errorType: z.string().nullable(),
    errorMessage: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .describe("端点探测日志");

export const ProviderEndpointProbeLogsResponseSchema = z
  .object({
    endpointId: z.number().int().positive(),
    logs: z.array(ProviderEndpointProbeLogSchema),
  })
  .describe("端点探测日志列表响应");

// ==================== Circuit 输出 ====================

export const ProviderEndpointCircuitInfoSchema = z
  .object({
    endpointId: z.number().int().positive(),
    health: z.object({
      failureCount: z.number().int(),
      lastFailureTime: z.number().nullable(),
      circuitState: z.enum(["closed", "open", "half-open"]),
      circuitOpenUntil: z.number().nullable(),
      halfOpenSuccessCount: z.number().int(),
    }),
    config: z.object({
      failureThreshold: z.number().int(),
      openDuration: z.number().int(),
      halfOpenSuccessThreshold: z.number().int(),
    }),
  })
  .describe("端点熔断器信息");

// ==================== 通用 ok ====================

export const ProviderEndpointOkResponseSchema = z
  .object({ ok: z.literal(true) })
  .describe("通用 ok 响应");

// ==================== 序列化 ====================

function dateToIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

/** 把仓储 ProviderVendor 序列化为响应 */
export function serializeProviderVendor(vendor: Record<string, unknown>): ProviderVendorResponse {
  const v = vendor as Record<string, unknown> & {
    id: number;
    websiteDomain: string;
    displayName: string | null;
    websiteUrl: string | null;
    faviconUrl: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    providerTypes?: string[];
  };
  return {
    id: v.id,
    websiteDomain: v.websiteDomain,
    displayName: v.displayName ?? null,
    websiteUrl: v.websiteUrl ?? null,
    faviconUrl: v.faviconUrl ?? null,
    createdAt: dateToIso(v.createdAt) ?? new Date().toISOString(),
    updatedAt: dateToIso(v.updatedAt) ?? new Date().toISOString(),
    providerTypes: Array.isArray(v.providerTypes)
      ? (v.providerTypes.filter((t) =>
          ["claude", "codex", "gemini", "openai-compatible"].includes(t)
        ) as ProviderVendorResponse["providerTypes"])
      : undefined,
  };
}

/** 把仓储 ProviderEndpoint 序列化为响应 */
export function serializeProviderEndpoint(
  endpoint: Record<string, unknown>
): ProviderEndpointResponse {
  const e = endpoint as Record<string, unknown> & {
    id: number;
    vendorId: number;
    providerType: string;
    url: string;
    label: string | null;
    sortOrder: number;
    isEnabled: boolean;
    lastProbedAt?: Date | string | null;
    lastProbeOk?: boolean | null;
    lastProbeStatusCode?: number | null;
    lastProbeLatencyMs?: number | null;
    lastProbeErrorType?: string | null;
    lastProbeErrorMessage?: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
  };
  return {
    id: e.id,
    vendorId: e.vendorId,
    providerType: e.providerType as ProviderEndpointResponse["providerType"],
    url: e.url,
    label: e.label ?? null,
    sortOrder: e.sortOrder,
    isEnabled: e.isEnabled,
    lastProbedAt: dateToIso(e.lastProbedAt),
    lastProbeOk: e.lastProbeOk ?? null,
    lastProbeStatusCode: e.lastProbeStatusCode ?? null,
    lastProbeLatencyMs: e.lastProbeLatencyMs ?? null,
    lastProbeErrorType: e.lastProbeErrorType ?? null,
    lastProbeErrorMessage: e.lastProbeErrorMessage ?? null,
    createdAt: dateToIso(e.createdAt) ?? new Date().toISOString(),
    updatedAt: dateToIso(e.updatedAt) ?? new Date().toISOString(),
  };
}

/** 过滤掉隐藏 providerType 的 endpoint */
export function filterVisibleEndpoints<T extends { providerType?: string }>(records: T[]): T[] {
  const visible = new Set(["claude", "codex", "gemini", "openai-compatible"]);
  return records.filter((r) => {
    if (typeof r.providerType !== "string") return true;
    return visible.has(r.providerType);
  });
}
