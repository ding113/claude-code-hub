/**
 * /api/v1/sessions handler 集合
 */

import type { Context } from "hono";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import { respondJson, respondNoContent } from "@/lib/api/v1/_shared/response-helpers";
import { SessionsBatchTerminateRequestSchema } from "@/lib/api/v1/schemas/sessions";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

async function loadActions() {
  const mod = await import("@/actions/active-sessions");
  return {
    listActive: mod.getActiveSessions as unknown as AnyAction,
    listAll: mod.getAllSessions as unknown as AnyAction,
    detail: mod.getSessionDetails as unknown as AnyAction,
    messages: mod.getSessionMessages as unknown as AnyAction,
    hasMessages: mod.hasSessionMessages as unknown as AnyAction,
    requests: mod.getSessionRequests as unknown as AnyAction,
    terminate: mod.terminateActiveSession as unknown as AnyAction,
    batchTerminate: mod.terminateActiveSessionsBatch as unknown as AnyAction,
  };
}

async function loadOriginChainAction(): Promise<AnyAction> {
  const mod = await import("@/actions/session-origin-chain");
  return mod.getSessionOriginChain as unknown as AnyAction;
}

async function loadResponseAction(): Promise<AnyAction> {
  const mod = await import("@/actions/session-response");
  return mod.getSessionResponse as unknown as AnyAction;
}

function readSessionId(
  c: Context
): { ok: true; sessionId: string } | { ok: false; response: Response } {
  const raw = c.req.param("sessionId");
  if (!raw) {
    return {
      ok: false,
      response: problem(c, {
        status: 400,
        errorCode: "validation_failed",
        title: "Invalid path parameter",
        detail: "Path parameter `sessionId` is required.",
      }),
    };
  }
  return { ok: true, sessionId: raw };
}

// ==================== GET /sessions ====================

export async function listSessions(c: Context): Promise<Response> {
  const q = c.req.query();
  const state = q.state ?? "active";
  const actions = await loadActions();

  if (state === "all") {
    const activePage = q.activePage ? Number(q.activePage) : 1;
    const inactivePage = q.inactivePage ? Number(q.inactivePage) : 1;
    const pageSize = q.pageSize ? Number(q.pageSize) : 20;
    const result = await callAction<unknown>(c, actions.listAll, [
      activePage,
      inactivePage,
      pageSize,
    ]);
    if (!result.ok) return result.problem;
    return respondJson(c, result.data, 200);
  }

  const result = await callAction<unknown[]>(c, actions.listActive, []);
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data ?? [] }, 200);
}

// ==================== GET /sessions/{sessionId} ====================

export async function getSessionDetail(c: Context): Promise<Response> {
  const parsed = readSessionId(c);
  if (!parsed.ok) return parsed.response;
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.detail, [parsed.sessionId]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /sessions/{sessionId}/messages ====================

export async function getSessionMessages(c: Context): Promise<Response> {
  const parsed = readSessionId(c);
  if (!parsed.ok) return parsed.response;
  const method = c.req.method.toUpperCase();
  const actions = await loadActions();
  if (method === "HEAD") {
    const q = c.req.query();
    const seq = q.requestSequence ? Number(q.requestSequence) : undefined;
    const result = await callAction<boolean>(c, actions.hasMessages, [parsed.sessionId, seq]);
    if (!result.ok) return result.problem;
    return new Response(null, {
      status: result.data ? 204 : 404,
    });
  }
  const result = await callAction<unknown>(c, actions.messages, [parsed.sessionId]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /sessions/{sessionId}/requests ====================

export async function getSessionRequests(c: Context): Promise<Response> {
  const parsed = readSessionId(c);
  if (!parsed.ok) return parsed.response;
  const q = c.req.query();
  const page = q.page ? Number(q.page) : 1;
  const pageSize = q.pageSize ? Number(q.pageSize) : 20;
  const order = q.order === "desc" ? "desc" : "asc";
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.requests, [
    parsed.sessionId,
    page,
    pageSize,
    order,
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /sessions/{sessionId}/origin-chain ====================

export async function getSessionOriginChain(c: Context): Promise<Response> {
  const parsed = readSessionId(c);
  if (!parsed.ok) return parsed.response;
  const action = await loadOriginChainAction();
  const result = await callAction<unknown>(c, action, [parsed.sessionId]);
  if (!result.ok) return result.problem;
  return respondJson(c, { chain: result.data ?? null }, 200);
}

// ==================== GET /sessions/{sessionId}/response ====================

export async function getSessionResponse(c: Context): Promise<Response> {
  const parsed = readSessionId(c);
  if (!parsed.ok) return parsed.response;
  const action = await loadResponseAction();
  const result = await callAction<string>(c, action, [parsed.sessionId]);
  if (!result.ok) return result.problem;
  return respondJson(c, { response: result.data }, 200);
}

// ==================== DELETE /sessions/{sessionId} ====================

export async function terminateSession(c: Context): Promise<Response> {
  const parsed = readSessionId(c);
  if (!parsed.ok) return parsed.response;
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.terminate, [parsed.sessionId]);
  if (!result.ok) return result.problem;
  return respondNoContent(c);
}

// ==================== POST /sessions:batchTerminate ====================

export async function batchTerminateSessions(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof SessionsBatchTerminateRequestSchema>(
    c,
    SessionsBatchTerminateRequestSchema
  );
  if (!body.ok) return body.response;
  const actions = await loadActions();
  const result = await callAction<unknown>(c, actions.batchTerminate, [body.data.sessionIds]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}
