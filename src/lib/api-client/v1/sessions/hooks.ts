"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BatchTerminateSessionsInput,
  SessionRequestsQuery,
  SessionSequenceQuery,
  SessionsListQuery,
} from "@/lib/api/v1/schemas/sessions";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

function toQuery(params?: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function useSessions(params?: SessionsListQuery) {
  return useQuery({
    queryKey: v1Keys.sessions.list(params),
    queryFn: () => apiClient.get(`/api/v1/sessions${toQuery(params)}`),
  });
}

export function useSessionDetail(sessionId: string, params?: SessionSequenceQuery) {
  return useQuery({
    queryKey: v1Keys.sessions.detail(sessionId, params),
    queryFn: () =>
      apiClient.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}${toQuery(params)}`),
  });
}

export function useSessionMessages(sessionId: string, params?: SessionSequenceQuery) {
  return useQuery({
    queryKey: v1Keys.sessions.messages(sessionId, params),
    queryFn: () =>
      apiClient.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}/messages${toQuery(params)}`),
  });
}

export function useSessionRequests(sessionId: string, params?: SessionRequestsQuery) {
  return useQuery({
    queryKey: v1Keys.sessions.requests(sessionId, params),
    queryFn: () =>
      apiClient.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}/requests${toQuery(params)}`),
  });
}

export function useSessionOriginChain(sessionId: string) {
  return useQuery({
    queryKey: v1Keys.sessions.originChain(sessionId),
    queryFn: () => apiClient.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}/origin-chain`),
  });
}

export function useSessionResponse(sessionId: string) {
  return useQuery({
    queryKey: v1Keys.sessions.response(sessionId),
    queryFn: () => apiClient.get(`/api/v1/sessions/${encodeURIComponent(sessionId)}/response`),
  });
}

export function useTerminateSession() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (sessionId: string) =>
      apiClient.delete(`/api/v1/sessions/${encodeURIComponent(sessionId)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.sessions.all }),
  });
}

export function useBatchTerminateSessions() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: BatchTerminateSessionsInput) =>
      apiClient.post("/api/v1/sessions:batchTerminate", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.sessions.all }),
  });
}
