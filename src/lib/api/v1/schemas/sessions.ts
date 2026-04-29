/**
 * /api/v1 sessions 资源 schema
 *
 * 设计要点：
 * - 复用 ActiveSessionInfo / SessionDetailsRow 等遗留接口；
 * - 列表 + 详情 + messages + requests + origin-chain + response 全部以 passthrough 透传，
 *   保持与 actions 的契约一致。
 */

import { z } from "@hono/zod-openapi";

export const ActiveSessionItemSchema = z
  .object({
    sessionId: z.string(),
    userName: z.string().optional(),
    userId: z.number().int().optional(),
    keyId: z.number().int().optional(),
    keyName: z.string().optional(),
    providerId: z.number().int().nullable().optional(),
    providerName: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    apiType: z.enum(["chat", "codex"]).optional(),
    startTime: z.number().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    cacheCreationInputTokens: z.number().optional(),
    cacheReadInputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
    costUsd: z.number().optional(),
    status: z.string().optional(),
    durationMs: z.number().optional(),
    requestCount: z.number().optional(),
    concurrentCount: z.number().optional(),
  })
  .passthrough()
  .describe("Active session 信息（passthrough）")
  .openapi({ example: { sessionId: "sess_abc", userId: 1 } });

export type ActiveSessionItem = z.infer<typeof ActiveSessionItemSchema>;

export const SessionsListResponseSchema = z
  .object({
    items: z.array(ActiveSessionItemSchema),
  })
  .passthrough()
  .describe("Sessions 列表响应（state=active 时仅返回 items；state=all 时含 active/inactive 分组）")
  .openapi({ example: { items: [] } });

export type SessionsListResponse = z.infer<typeof SessionsListResponseSchema>;

export const SessionDetailResponseSchema = z
  .object({})
  .passthrough()
  .describe("Session 详情（passthrough）")
  .openapi({ example: { sessionId: "sess_abc" } });

export type SessionDetailResponse = z.infer<typeof SessionDetailResponseSchema>;

export const SessionMessagesResponseSchema = z
  .object({})
  .passthrough()
  .describe("Session messages（任意 JSON）");

export const SessionRequestsResponseSchema = z
  .object({
    requests: z.array(z.unknown()),
    total: z.number().int(),
    hasMore: z.boolean(),
  })
  .passthrough()
  .describe("Session 请求列表");

export const SessionOriginChainResponseSchema = z
  .object({
    chain: z.array(z.unknown()).nullable(),
  })
  .describe("Session origin chain")
  .openapi({ example: { chain: null } });

export const SessionResponseBodyResponseSchema = z
  .object({
    response: z.string(),
  })
  .describe("Session 响应体内容")
  .openapi({ example: { response: "..." } });

export const SessionsBatchTerminateRequestSchema = z
  .object({
    sessionIds: z.array(z.string()).min(1).describe("待终止的 session id 列表"),
  })
  .describe("批量终止 session 请求体")
  .openapi({ example: { sessionIds: ["sess_a", "sess_b"] } });

export type SessionsBatchTerminateRequest = z.infer<typeof SessionsBatchTerminateRequestSchema>;

export const SessionsBatchTerminateResponseSchema = z
  .object({})
  .passthrough()
  .describe("批量终止结果（passthrough）");

export const SessionIdParamSchema = z
  .object({
    sessionId: z.string().min(1).describe("Session id"),
  })
  .openapi({ example: { sessionId: "sess_abc" } });
