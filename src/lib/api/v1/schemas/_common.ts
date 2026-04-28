/**
 * /api/v1 公共 schema 出口
 *
 * 这里集中导出每个资源模块都会用到的「契约级」schema：
 *   - problem+json（错误响应）
 *   - 分页（page / cursor）
 *   - 通用 ID 路径参数
 *   - 共享枚举（例如 ProviderTypeSchema 屏蔽 claude-auth/gemini-cli）
 *
 * 业务侧不允许直接 z.string().datetime / z.date()，请使用 IsoDateTimeSchema。
 */

import { z } from "@hono/zod-openapi";

import {
  CursorQuerySchema,
  CursorResponseSchema,
  PageQuerySchema,
  PageResponseSchema,
} from "../_shared/pagination";
import { IsoDateTimeSchema } from "../_shared/serialization";

// ==================== problem+json ====================

export const InvalidParamSchema = z
  .object({
    path: z
      .array(z.union([z.string(), z.number()]))
      .describe("JSON path of the invalid field, root represented as []"),
    code: z.string().describe("Issue code (e.g. zod issue code)"),
    message: z.string().describe("Human-readable message"),
  })
  .describe("Single invalid parameter entry")
  .openapi({
    example: { path: ["name"], code: "too_small", message: "Required" },
  });

export const ProblemJsonSchema = z
  .object({
    type: z.string().describe("URI identifying the problem type; about:blank when not applicable"),
    title: z.string().describe("Short, human-readable summary of the problem"),
    status: z.number().int().min(100).max(599).describe("HTTP status code mirroring the response"),
    detail: z
      .string()
      .optional()
      .describe("Human-readable explanation specific to this occurrence"),
    instance: z.string().optional().describe("URI reference identifying the request"),
    errorCode: z.string().describe("Stable machine-readable error code for i18n / clients"),
    errorParams: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .optional()
      .describe("Parameters used to interpolate localized error messages"),
    traceId: z.string().describe("Per-request trace identifier; included in logs"),
    invalidParams: z
      .array(InvalidParamSchema)
      .optional()
      .describe("List of invalid request parameters, when applicable"),
  })
  .describe("RFC 9457 problem+json error envelope")
  .openapi({
    example: {
      type: "about:blank",
      title: "Validation failed",
      status: 400,
      detail: "One or more fields are invalid.",
      instance: "/api/v1/providers",
      errorCode: "validation_failed",
      traceId: "req_0123456789",
      invalidParams: [{ path: ["name"], code: "too_small", message: "Required" }],
    },
  });

// ==================== 公共路径参数 ====================

/**
 * 通用 `{id}` 路径参数：把字符串 id 强制成正整数。
 *
 * 使用 .coerce 仅在 path 参数（永远是字符串）上是安全的，
 * 不要在 JSON body schema 中使用。
 */
export const ResourceIdParamSchema = z
  .object({
    id: z.coerce.number().int().positive().describe("Resource numeric id"),
  })
  .describe("Resource id path parameter")
  .openapi({
    example: { id: 1 },
  });

// ==================== 共享枚举 ====================

/**
 * Provider 类型枚举（v1 公开版本）。
 *
 * 显式排除：
 *   - "claude-auth"  : 内部认证适配器，不暴露到公开 API；
 *   - "gemini-cli"   : CLI 模式专用，不暴露到公开 API。
 *
 * v1 写接口必须用本枚举校验 type 字段；v1 读接口在序列化时如果遇到上述
 * 隐藏类型必须返回 404（参考 plan「Hidden Provider」章节）。
 */
export const ProviderTypeSchema = z
  .enum(["claude", "codex", "gemini", "openai-compatible"])
  .describe("Provider 类型（不含隐藏类型 claude-auth / gemini-cli）")
  .openapi({
    example: "claude",
  });

export type ProviderType = z.infer<typeof ProviderTypeSchema>;

// ==================== Re-exports ====================

export {
  CursorQuerySchema,
  CursorResponseSchema,
  IsoDateTimeSchema,
  PageQuerySchema,
  PageResponseSchema,
};
