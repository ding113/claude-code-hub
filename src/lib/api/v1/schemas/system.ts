/**
 * /api/v1 system 资源 schema
 *
 * 设计要点：
 * - 输出 schema 直接基于 SystemSettings 接口，避免重新枚举大量字段；
 *   priceData 等复杂嵌套字段使用 record / passthrough 透明转发；
 * - 输入 schema (Update) 复用 src/lib/validation/schemas.ts 的
 *   UpdateSystemSettingsSchema：v1 仅外层加 .describe() / .openapi()，
 *   不重新定义字段约束；
 * - timezone 端点输出仅 { timeZone: string }。
 */

import { z } from "@hono/zod-openapi";
import { UpdateSystemSettingsSchema } from "@/lib/validation/schemas";
import { IsoDateTimeSchema } from "../_shared/serialization";

// ==================== 输入：更新系统设置 ====================

export const SystemSettingsUpdateSchema = UpdateSystemSettingsSchema.describe(
  "更新系统设置请求体（局部更新，所有字段可选）"
).openapi({
  example: {
    siteTitle: "Claude Code Hub",
    enableHttp2: true,
    timezone: "Asia/Shanghai",
  },
});

export type SystemSettingsUpdateInput = z.infer<typeof SystemSettingsUpdateSchema>;

// ==================== 输出：系统设置响应 ====================

/**
 * 系统设置响应 schema。
 *
 * 因为 SystemSettings 字段非常多且包含 IpExtractionConfig / ResponseFixerConfig
 * 等复杂嵌套类型，这里使用 passthrough 把数据库行原样回传，避免重复枚举字段。
 * createdAt / updatedAt / publicStatusProjectionWarningCode 显式声明，便于客户端直接消费。
 */
export const SystemSettingsResponseSchema = z
  .object({
    id: z.number().int().describe("行主键").openapi({ example: 1 }),
    siteTitle: z.string().describe("站点标题").openapi({ example: "Claude Code Hub" }),
    timezone: z
      .string()
      .nullable()
      .describe("系统时区（IANA 标识或 null）")
      .openapi({ example: "Asia/Shanghai" }),
    publicStatusProjectionWarningCode: z
      .string()
      .nullable()
      .optional()
      .describe("Public Status 投影发布告警码（仅 PUT 响应时出现）")
      .openapi({ example: null }),
    createdAt: IsoDateTimeSchema.describe("创建时间（ISO 字符串）"),
    updatedAt: IsoDateTimeSchema.describe("更新时间（ISO 字符串）"),
  })
  .passthrough()
  .describe("系统设置响应（含 SystemSettings 全部字段，passthrough）");

export type SystemSettingsResponse = z.infer<typeof SystemSettingsResponseSchema>;

// ==================== 输出：时区 ====================

export const SystemTimezoneResponseSchema = z
  .object({
    timeZone: z.string().describe("解析后的系统时区").openapi({ example: "Asia/Shanghai" }),
  })
  .describe("系统时区响应");

export type SystemTimezoneResponse = z.infer<typeof SystemTimezoneResponseSchema>;

// ==================== 序列化 ====================

interface SystemSettingsLike {
  id: number;
  siteTitle: string;
  timezone: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  publicStatusProjectionWarningCode?: string | null;
  [key: string]: unknown;
}

export function serializeSystemSettings(input: SystemSettingsLike): SystemSettingsResponse {
  const created = input.createdAt instanceof Date ? input.createdAt.toISOString() : input.createdAt;
  const updated = input.updatedAt instanceof Date ? input.updatedAt.toISOString() : input.updatedAt;
  return {
    ...input,
    createdAt: created,
    updatedAt: updated,
  } as SystemSettingsResponse;
}
