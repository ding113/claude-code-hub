/**
 * /api/v1 users 资源 schema
 *
 * 设计要点：
 * - 用户写操作复用 `src/lib/validation/schemas.ts` 的 CreateUserSchema /
 *   UpdateUserSchema：v1 schema 仅在外层套上 .describe() / .openapi() 元数据，
 *   不重复字段定义；
 * - 列表响应来自 getUsersBatch -> UserDisplay；这里把它序列化为 OpenAPI 友好
 *   的纯 JSON：日期 -> ISO 字符串，可选字段保留 null 或省略；
 * - 列表 key 字段使用 `maskKey()` 脱敏，并通过 `redactKey(...)` helper 同步；
 *   只有 POST /users（addUser 的默认 key）才在 201 响应里 ONCE 暴露原始 key。
 */

import { z } from "@hono/zod-openapi";
import { maskKey } from "@/lib/utils/validation";
import { CreateUserSchema, UpdateUserSchema } from "@/lib/validation/schemas";
import { IsoDateTimeSchema } from "../_shared/serialization";

// ==================== 通用枚举/字段 ====================

const ResetModeSchema = z
  .enum(["fixed", "rolling"])
  .describe("限额重置模式：固定窗口（fixed）或滚动窗口（rolling）")
  .openapi({ example: "rolling" });

// ==================== 输入：创建用户 ====================

/**
 * 创建用户请求体（包装 CreateUserSchema）。
 * 字段约束完全继承 src/lib/validation/schemas.ts 中的 zod 校验。
 */
export const UserCreateSchema = CreateUserSchema.describe(
  "创建用户的请求体（同时会创建一个默认 key）"
).openapi({
  example: {
    name: "alice",
    note: "design team",
    rpm: 60,
    dailyQuota: 50,
    isEnabled: true,
  },
});

export type UserCreateInput = z.infer<typeof UserCreateSchema>;

// ==================== 输入：更新用户 ====================

export const UserUpdateSchema = UpdateUserSchema.describe(
  "更新用户的请求体（局部更新；未提供的字段保持原值）"
).openapi({
  example: { rpm: 120, isEnabled: false },
});

export type UserUpdateInput = z.infer<typeof UserUpdateSchema>;

// ==================== 输入：操作动词 ====================

export const UserEnableSchema = z
  .object({
    enabled: z.boolean().describe("目标启用状态").openapi({ example: false }),
  })
  .describe("切换用户启用状态的请求体");

export type UserEnableInput = z.infer<typeof UserEnableSchema>;

export const UserRenewSchema = z
  .object({
    expiresAt: z
      .union([z.string().min(1), z.null()])
      .describe("新的过期时间（ISO 8601 字符串，null 表示永不过期）")
      .openapi({ example: "2026-12-31T23:59:59Z" }),
    enableUser: z.boolean().optional().describe("是否同时启用用户").openapi({ example: true }),
  })
  .describe("续期用户的请求体");

export type UserRenewInput = z.infer<typeof UserRenewSchema>;

// ==================== 输出：用户 key 摘要 ====================

const UserKeySummarySchema = z
  .object({
    id: z.number().int().positive().describe("Key 主键").openapi({ example: 100 }),
    name: z.string().describe("Key 名称").openapi({ example: "default" }),
    maskedKey: z.string().describe("脱敏后的 key 字符串").openapi({ example: "sk-A•••••B0c1" }),
    isEnabled: z.boolean().describe("Key 是否启用").openapi({ example: true }),
    canLoginWebUi: z
      .boolean()
      .describe("是否允许使用此 key 登录 Web UI")
      .openapi({ example: true }),
    providerGroup: z
      .string()
      .nullable()
      .describe("Key 的供应商分组覆盖；null 表示沿用用户分组")
      .openapi({ example: "default" }),
    expiresAt: z
      .string()
      .nullable()
      .describe("过期时间（ISO 字符串或 'neverExpires' 标识；按用户语言本地化）")
      .openapi({ example: "neverExpires" }),
    limit5hUsd: z.number().nullable().describe("5 小时消费上限").openapi({ example: null }),
    limit5hResetMode: ResetModeSchema,
    limitDailyUsd: z.number().nullable().describe("每日消费上限").openapi({ example: 10 }),
    dailyResetMode: ResetModeSchema,
    dailyResetTime: z.string().describe("每日重置时间 (HH:mm)").openapi({ example: "00:00" }),
    limitWeeklyUsd: z.number().nullable().describe("周消费上限").openapi({ example: null }),
    limitMonthlyUsd: z.number().nullable().describe("月消费上限").openapi({ example: null }),
    limitTotalUsd: z
      .number()
      .nullable()
      .optional()
      .describe("总消费上限")
      .openapi({ example: null }),
    limitConcurrentSessions: z
      .number()
      .int()
      .nonnegative()
      .describe("并发会话上限；0 表示不限制")
      .openapi({ example: 0 }),
  })
  .describe("用户 key 的摘要视图（敏感字段已脱敏）");

// ==================== 输出：用户详情 ====================

export const UserResponseSchema = z
  .object({
    id: z.number().int().positive().describe("用户 ID").openapi({ example: 1 }),
    name: z.string().describe("用户名").openapi({ example: "alice" }),
    note: z.string().nullable().describe("备注").openapi({ example: null }),
    role: z.enum(["admin", "user"]).describe("角色").openapi({ example: "user" }),
    rpm: z
      .number()
      .int()
      .nullable()
      .describe("每分钟请求数限制；null 表示不限制")
      .openapi({ example: 60 }),
    dailyQuota: z
      .number()
      .nullable()
      .describe("每日消费额度（USD）；null 表示不限制")
      .openapi({ example: 50 }),
    providerGroup: z.string().nullable().describe("供应商分组").openapi({ example: "default" }),
    tags: z
      .array(z.string())
      .describe("用户标签")
      .openapi({ example: ["team-a"] }),
    isEnabled: z.boolean().describe("是否启用").openapi({ example: true }),
    expiresAt: IsoDateTimeSchema.nullable().describe("过期时间（ISO 字符串）"),
    limit5hUsd: z.number().nullable().describe("5 小时消费上限").openapi({ example: null }),
    limit5hResetMode: ResetModeSchema.optional(),
    limitWeeklyUsd: z.number().nullable().describe("周消费上限").openapi({ example: null }),
    limitMonthlyUsd: z.number().nullable().describe("月消费上限").openapi({ example: null }),
    limitTotalUsd: z.number().nullable().describe("总消费上限").openapi({ example: null }),
    limitConcurrentSessions: z
      .number()
      .int()
      .nullable()
      .describe("并发会话上限")
      .openapi({ example: null }),
    dailyResetMode: ResetModeSchema.optional(),
    dailyResetTime: z
      .string()
      .optional()
      .describe("每日重置时间 HH:mm")
      .openapi({ example: "00:00" }),
    allowedClients: z.array(z.string()).describe("允许的客户端模式").openapi({ example: [] }),
    blockedClients: z.array(z.string()).describe("禁止的客户端模式").openapi({ example: [] }),
    allowedModels: z.array(z.string()).describe("允许的模型").openapi({ example: [] }),
    keys: z.array(UserKeySummarySchema).describe("用户名下的 key 列表（已脱敏）"),
  })
  .describe("用户详情响应（脱敏，敏感字段不会回传）");

export type UserResponse = z.infer<typeof UserResponseSchema>;

// ==================== 输出：列表 ====================

const UserListPageInfoSchema = z
  .object({
    nextCursor: z
      .string()
      .nullable()
      .describe("下一页游标；null 表示无更多")
      .openapi({ example: null }),
    hasMore: z.boolean().describe("是否还有更多数据").openapi({ example: false }),
    limit: z.number().int().min(1).describe("本次返回的最大条数").openapi({ example: 50 }),
  })
  .describe("游标分页元数据");

export const UserListResponseSchema = z
  .object({
    items: z.array(UserResponseSchema).describe("用户列表"),
    pageInfo: UserListPageInfoSchema,
  })
  .describe("用户列表响应");

export type UserListResponse = z.infer<typeof UserListResponseSchema>;

// ==================== 输出：addUser 创建响应 ====================

const UserCreateDefaultKeySchema = z
  .object({
    id: z.number().int().positive().describe("默认 key 主键").openapi({ example: 100 }),
    name: z.string().describe("默认 key 名称").openapi({ example: "default" }),
    key: z
      .string()
      .describe(
        "新创建的原始 API key 字符串。**仅在此响应中返回一次**；后续读接口仅回传脱敏字符串。"
      )
      .openapi({ example: "sk-abcdef0123456789abcdef0123456789" }),
  })
  .describe("addUser 同步创建的默认 key（包含原始 key 字符串，仅暴露一次）");

export const UserCreateResponseSchema = z
  .object({
    user: z
      .object({
        id: z.number().int().positive().describe("用户 ID").openapi({ example: 1 }),
        name: z.string().describe("用户名").openapi({ example: "alice" }),
        note: z.string().nullable().optional().describe("备注").openapi({ example: null }),
        role: z.enum(["admin", "user"]).describe("角色").openapi({ example: "user" }),
        isEnabled: z.boolean().describe("是否启用").openapi({ example: true }),
        expiresAt: IsoDateTimeSchema.nullable().describe("过期时间（ISO 字符串）"),
        rpm: z.number().int().nullable().describe("每分钟请求数限制").openapi({ example: 60 }),
        dailyQuota: z.number().nullable().describe("每日消费额度").openapi({ example: 50 }),
        providerGroup: z
          .string()
          .nullable()
          .optional()
          .describe("供应商分组")
          .openapi({ example: "default" }),
        tags: z.array(z.string()).describe("标签").openapi({ example: [] }),
        limit5hUsd: z.number().nullable().describe("5 小时上限").openapi({ example: null }),
        limit5hResetMode: ResetModeSchema,
        limitWeeklyUsd: z.number().nullable().describe("周上限").openapi({ example: null }),
        limitMonthlyUsd: z.number().nullable().describe("月上限").openapi({ example: null }),
        limitTotalUsd: z.number().nullable().describe("总上限").openapi({ example: null }),
        limitConcurrentSessions: z
          .number()
          .int()
          .nullable()
          .describe("并发上限")
          .openapi({ example: null }),
        allowedModels: z.array(z.string()).describe("允许的模型").openapi({ example: [] }),
      })
      .describe("新建的用户"),
    defaultKey: UserCreateDefaultKeySchema,
  })
  .describe("创建用户的成功响应；defaultKey.key 是原始 API key，仅在创建时返回一次");

export type UserCreateResponse = z.infer<typeof UserCreateResponseSchema>;

// ==================== 输出：tags / key-groups ====================

export const UserTagsResponseSchema = z
  .object({
    items: z
      .array(z.string())
      .describe("用户标签集合（去重）")
      .openapi({ example: ["team-a", "team-b"] }),
  })
  .describe("用户标签列表响应");

export type UserTagsResponse = z.infer<typeof UserTagsResponseSchema>;

export const UserKeyGroupsResponseSchema = z
  .object({
    items: z
      .array(z.string())
      .describe("用户 key 分组集合（去重）")
      .openapi({ example: ["default", "claude-only"] }),
  })
  .describe("用户 key 分组列表响应");

export type UserKeyGroupsResponse = z.infer<typeof UserKeyGroupsResponseSchema>;

// ==================== 序列化：脱敏 ====================

/** 把原始 key 字符串脱敏为 "head••••••tail" 格式（< 9 字符直接返回 dots） */
export function redactKey(rawKey: string | null | undefined): string {
  if (!rawKey) return "••••••";
  return maskKey(rawKey);
}

/**
 * 把 UserDisplay -> UserResponse；日期 Date -> ISO 字符串；key 字段固定脱敏。
 * 注意：UserDisplay.keys[i].maskedKey 已经是脱敏值；fullKey 永远不向 v1 输出层暴露。
 */
export function serializeUser(input: Record<string, unknown>): UserResponse {
  // 强类型化转换：调用方负责传入 UserDisplay-shape 的对象。
  const u = input as Record<string, unknown> & {
    id: number;
    name: string;
    note?: string;
    role: "admin" | "user";
    rpm: number | null;
    dailyQuota: number | null;
    providerGroup?: string | null;
    tags?: string[];
    keys?: Array<Record<string, unknown>>;
    limit5hUsd?: number | null;
    limit5hResetMode?: "fixed" | "rolling";
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitTotalUsd?: number | null;
    costResetAt?: Date | null;
    limitConcurrentSessions?: number | null;
    dailyResetMode?: "fixed" | "rolling";
    dailyResetTime?: string;
    isEnabled: boolean;
    expiresAt?: Date | null;
    allowedClients?: string[];
    blockedClients?: string[];
    allowedModels?: string[];
  };

  return {
    id: u.id,
    name: u.name,
    note: u.note ?? null,
    role: u.role,
    rpm: u.rpm,
    dailyQuota: u.dailyQuota,
    providerGroup: u.providerGroup ?? null,
    tags: u.tags ?? [],
    isEnabled: u.isEnabled,
    expiresAt: u.expiresAt instanceof Date ? u.expiresAt.toISOString() : null,
    limit5hUsd: u.limit5hUsd ?? null,
    limit5hResetMode: u.limit5hResetMode,
    limitWeeklyUsd: u.limitWeeklyUsd ?? null,
    limitMonthlyUsd: u.limitMonthlyUsd ?? null,
    limitTotalUsd: u.limitTotalUsd ?? null,
    limitConcurrentSessions: u.limitConcurrentSessions ?? null,
    dailyResetMode: u.dailyResetMode,
    dailyResetTime: u.dailyResetTime,
    allowedClients: u.allowedClients ?? [],
    blockedClients: u.blockedClients ?? [],
    allowedModels: u.allowedModels ?? [],
    keys: (u.keys ?? []).map((k) => {
      const key = k as Record<string, unknown> & {
        id: number;
        name: string;
        maskedKey?: string;
        fullKey?: string;
        status?: "enabled" | "disabled";
        canLoginWebUi: boolean;
        providerGroup?: string | null;
        expiresAt?: string | Date | null;
        limit5hUsd: number | null;
        limit5hResetMode: "fixed" | "rolling";
        limitDailyUsd: number | null;
        dailyResetMode: "fixed" | "rolling";
        dailyResetTime: string;
        limitWeeklyUsd: number | null;
        limitMonthlyUsd: number | null;
        limitTotalUsd?: number | null;
        limitConcurrentSessions: number;
      };
      const expires = key.expiresAt;
      const expiresStr =
        typeof expires === "string"
          ? expires
          : expires instanceof Date
            ? expires.toISOString()
            : null;
      return {
        id: key.id,
        name: key.name,
        // 优先用 maskedKey；fallback 到 fullKey 经 redactKey；最后兜底 "••••••"
        maskedKey: key.maskedKey ?? redactKey(typeof key.fullKey === "string" ? key.fullKey : null),
        isEnabled: key.status === "enabled",
        canLoginWebUi: key.canLoginWebUi,
        providerGroup: key.providerGroup ?? null,
        expiresAt: expiresStr,
        limit5hUsd: key.limit5hUsd ?? null,
        limit5hResetMode: key.limit5hResetMode,
        limitDailyUsd: key.limitDailyUsd ?? null,
        dailyResetMode: key.dailyResetMode,
        dailyResetTime: key.dailyResetTime,
        limitWeeklyUsd: key.limitWeeklyUsd ?? null,
        limitMonthlyUsd: key.limitMonthlyUsd ?? null,
        limitTotalUsd: key.limitTotalUsd ?? null,
        limitConcurrentSessions: key.limitConcurrentSessions ?? 0,
      };
    }),
  };
}
