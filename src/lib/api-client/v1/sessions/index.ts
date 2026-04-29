/**
 * /api/v1/sessions 类型化客户端方法
 */

import type { z } from "@hono/zod-openapi";
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
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

type SessionMessagesResponse = z.infer<typeof SessionMessagesResponseSchema>;
type SessionRequestsResponse = z.infer<typeof SessionRequestsResponseSchema>;
type SessionOriginChainResponse = z.infer<typeof SessionOriginChainResponseSchema>;
type SessionResponseBodyResponse = z.infer<typeof SessionResponseBodyResponseSchema>;
type SessionsBatchTerminateResponse = z.infer<typeof SessionsBatchTerminateResponseSchema>;

const BASE_PATH = "/api/v1/sessions";

export interface SessionsListParams {
  state?: "active" | "all";
  activePage?: number;
  inactivePage?: number;
  pageSize?: number;
  [key: string]: string | number | undefined;
}

export interface SessionRequestsParams {
  page?: number;
  pageSize?: number;
  order?: "asc" | "desc";
  [key: string]: string | number | undefined;
}

export interface SessionsClient {
  list(params?: SessionsListParams): Promise<SessionsListResponse>;
  detail(sessionId: string): Promise<SessionDetailResponse>;
  messages(sessionId: string): Promise<SessionMessagesResponse>;
  requests(sessionId: string, params?: SessionRequestsParams): Promise<SessionRequestsResponse>;
  originChain(sessionId: string): Promise<SessionOriginChainResponse>;
  response(sessionId: string): Promise<SessionResponseBodyResponse>;
  terminate(sessionId: string): Promise<void>;
  batchTerminate(input: SessionsBatchTerminateRequest): Promise<SessionsBatchTerminateResponse>;
}

function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

async function list(params?: SessionsListParams): Promise<SessionsListResponse> {
  const response = await fetchApi(`${BASE_PATH}${buildQuery(params)}`, { method: "GET" });
  return (await response.json()) as SessionsListResponse;
}

async function detail(sessionId: string): Promise<SessionDetailResponse> {
  const response = await fetchApi(`${BASE_PATH}/${encodeURIComponent(sessionId)}`, {
    method: "GET",
  });
  return (await response.json()) as SessionDetailResponse;
}

async function messages(sessionId: string): Promise<SessionMessagesResponse> {
  const response = await fetchApi(`${BASE_PATH}/${encodeURIComponent(sessionId)}/messages`, {
    method: "GET",
  });
  return (await response.json()) as SessionMessagesResponse;
}

async function requests(
  sessionId: string,
  params?: SessionRequestsParams
): Promise<SessionRequestsResponse> {
  const response = await fetchApi(
    `${BASE_PATH}/${encodeURIComponent(sessionId)}/requests${buildQuery(params)}`,
    { method: "GET" }
  );
  return (await response.json()) as SessionRequestsResponse;
}

async function originChain(sessionId: string): Promise<SessionOriginChainResponse> {
  const response = await fetchApi(`${BASE_PATH}/${encodeURIComponent(sessionId)}/origin-chain`, {
    method: "GET",
  });
  return (await response.json()) as SessionOriginChainResponse;
}

async function response(sessionId: string): Promise<SessionResponseBodyResponse> {
  const r = await fetchApi(`${BASE_PATH}/${encodeURIComponent(sessionId)}/response`, {
    method: "GET",
  });
  return (await r.json()) as SessionResponseBodyResponse;
}

async function terminate(sessionId: string): Promise<void> {
  await fetchApi(`${BASE_PATH}/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

async function batchTerminate(
  input: SessionsBatchTerminateRequest
): Promise<SessionsBatchTerminateResponse> {
  const r = await fetchApi(`${BASE_PATH}:batchTerminate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await r.json()) as SessionsBatchTerminateResponse;
}

export const sessionsClient: SessionsClient = {
  list,
  detail,
  messages,
  requests,
  originChain,
  response,
  terminate,
  batchTerminate,
};

Object.assign(apiClient, { sessions: sessionsClient });
