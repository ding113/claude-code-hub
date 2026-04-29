"use client";

/**
 * /api/v1/sessions TanStack Query hooks
 */

import type { z } from "@hono/zod-openapi";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  SessionDetailResponse,
  SessionMessagesResponseSchema,
  SessionOriginChainResponseSchema,
  SessionRequestsResponseSchema,
  SessionResponseBodyResponseSchema,
  SessionsBatchTerminateRequest,
  SessionsBatchTerminateResponseSchema,
  SessionsListResponse,
} from "@/lib/api/v1/schemas/sessions";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { type SessionRequestsParams, type SessionsListParams, sessionsClient } from "./index";
import { sessionsKeys } from "./keys";

type SessionMessagesResponse = z.infer<typeof SessionMessagesResponseSchema>;
type SessionRequestsResponse = z.infer<typeof SessionRequestsResponseSchema>;
type SessionOriginChainResponse = z.infer<typeof SessionOriginChainResponseSchema>;
type SessionResponseBodyResponse = z.infer<typeof SessionResponseBodyResponseSchema>;
type SessionsBatchTerminateResponse = z.infer<typeof SessionsBatchTerminateResponseSchema>;

// ==================== 查询 ====================

export function useSessionsList(
  params?: SessionsListParams
): UseQueryResult<SessionsListResponse, ApiError | Error> {
  return useQuery<SessionsListResponse, ApiError | Error>({
    queryKey: sessionsKeys.list(params),
    queryFn: () => sessionsClient.list(params),
  });
}

export function useSessionDetail(
  sessionId: string
): UseQueryResult<SessionDetailResponse, ApiError | Error> {
  return useQuery<SessionDetailResponse, ApiError | Error>({
    queryKey: sessionsKeys.detail(sessionId),
    queryFn: () => sessionsClient.detail(sessionId),
    enabled: typeof sessionId === "string" && sessionId.length > 0,
  });
}

export function useSessionMessages(
  sessionId: string
): UseQueryResult<SessionMessagesResponse, ApiError | Error> {
  return useQuery<SessionMessagesResponse, ApiError | Error>({
    queryKey: sessionsKeys.messages(sessionId),
    queryFn: () => sessionsClient.messages(sessionId),
    enabled: typeof sessionId === "string" && sessionId.length > 0,
  });
}

export function useSessionRequests(
  sessionId: string,
  params?: SessionRequestsParams
): UseQueryResult<SessionRequestsResponse, ApiError | Error> {
  return useQuery<SessionRequestsResponse, ApiError | Error>({
    queryKey: sessionsKeys.requests(sessionId, params),
    queryFn: () => sessionsClient.requests(sessionId, params),
    enabled: typeof sessionId === "string" && sessionId.length > 0,
  });
}

export function useSessionOriginChain(
  sessionId: string
): UseQueryResult<SessionOriginChainResponse, ApiError | Error> {
  return useQuery<SessionOriginChainResponse, ApiError | Error>({
    queryKey: sessionsKeys.originChain(sessionId),
    queryFn: () => sessionsClient.originChain(sessionId),
    enabled: typeof sessionId === "string" && sessionId.length > 0,
  });
}

export function useSessionResponse(
  sessionId: string
): UseQueryResult<SessionResponseBodyResponse, ApiError | Error> {
  return useQuery<SessionResponseBodyResponse, ApiError | Error>({
    queryKey: sessionsKeys.response(sessionId),
    queryFn: () => sessionsClient.response(sessionId),
    enabled: typeof sessionId === "string" && sessionId.length > 0,
  });
}

// ==================== 变更 ====================

export function useTerminateSession() {
  return useApiMutation<string, void>({
    mutationFn: (sessionId) => sessionsClient.terminate(sessionId),
    invalidates: [sessionsKeys.all],
  });
}

export function useBatchTerminateSessions() {
  return useApiMutation<SessionsBatchTerminateRequest, SessionsBatchTerminateResponse>({
    mutationFn: (input) => sessionsClient.batchTerminate(input),
    invalidates: [sessionsKeys.all],
  });
}
