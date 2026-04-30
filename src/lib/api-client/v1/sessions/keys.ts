/**
 * /api/v1/sessions 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const sessionsKeys = {
  all: [...v1Keys.all, "sessions"] as const,
  list: (params?: Record<string, unknown>) => [...sessionsKeys.all, "list", params ?? {}] as const,
  detail: (sessionId: string) => [...sessionsKeys.all, "detail", sessionId] as const,
  messages: (sessionId: string) => [...sessionsKeys.all, "messages", sessionId] as const,
  requests: (sessionId: string, params?: Record<string, unknown>) =>
    [...sessionsKeys.all, "requests", sessionId, params ?? {}] as const,
  originChain: (sessionId: string) => [...sessionsKeys.all, "origin-chain", sessionId] as const,
  response: (sessionId: string) => [...sessionsKeys.all, "response", sessionId] as const,
};

export type SessionsQueryKey = ReturnType<
  (typeof sessionsKeys)[Exclude<keyof typeof sessionsKeys, "all">]
>;
