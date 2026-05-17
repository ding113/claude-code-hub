import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import {
  createProblemResponse,
  fromZodError,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { parseHonoJsonBody } from "@/lib/api/v1/_shared/request-body";
import { jsonResponse, noContentResponse } from "@/lib/api/v1/_shared/response-helpers";
import {
  BatchTerminateSessionsSchema,
  SessionIdParamSchema,
  SessionRequestsQuerySchema,
  SessionSequenceQuerySchema,
  SessionsListQuerySchema,
} from "@/lib/api/v1/schemas/sessions";

export async function listSessions(c: Context): Promise<Response> {
  const query = SessionsListQuerySchema.safeParse({
    state: c.req.query("state"),
    activePage: c.req.query("activePage"),
    inactivePage: c.req.query("inactivePage"),
    pageSize: c.req.query("pageSize"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/active-sessions");
  const result =
    query.data.state === "all"
      ? await callAction(
          c,
          actions.getAllSessions,
          [query.data.activePage, query.data.inactivePage, query.data.pageSize] as never[],
          c.get("auth")
        )
      : await callAction(c, actions.getActiveSessions, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse(query.data.state === "all" ? result.data : { items: result.data });
}

export async function getSessionDetail(c: Context): Promise<Response> {
  const params = parseSessionParams(c);
  if (params instanceof Response) return params;
  const query = SessionSequenceQuerySchema.safeParse({
    requestSequence: c.req.query("requestSequence"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/active-sessions");
  return actionJson(
    c,
    await callAction(
      c,
      actions.getSessionDetails,
      [params.sessionId, query.data.requestSequence] as never[],
      c.get("auth")
    )
  );
}

export async function getSessionMessages(c: Context): Promise<Response> {
  const params = parseSessionParams(c);
  if (params instanceof Response) return params;
  const query = SessionSequenceQuerySchema.safeParse({
    requestSequence: c.req.query("requestSequence"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/active-sessions");
  return actionJson(
    c,
    await callAction(
      c,
      actions.getSessionMessages,
      [params.sessionId, query.data.requestSequence] as never[],
      c.get("auth")
    )
  );
}

export async function hasSessionMessages(c: Context): Promise<Response> {
  const params = parseSessionParams(c);
  if (params instanceof Response) return params;
  const query = SessionSequenceQuerySchema.safeParse({
    requestSequence: c.req.query("requestSequence"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/active-sessions");
  const result = await callAction(
    c,
    actions.hasSessionMessages,
    [params.sessionId, query.data.requestSequence] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ exists: result.data });
}

export async function getSessionRequests(c: Context): Promise<Response> {
  const params = parseSessionParams(c);
  if (params instanceof Response) return params;
  const query = SessionRequestsQuerySchema.safeParse({
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
    order: c.req.query("order"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/active-sessions");
  return actionJson(
    c,
    await callAction(
      c,
      actions.getSessionRequests,
      [params.sessionId, query.data.page, query.data.pageSize, query.data.order] as never[],
      c.get("auth")
    )
  );
}

export async function getSessionOriginChain(c: Context): Promise<Response> {
  const params = parseSessionParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/session-origin-chain");
  return actionJson(
    c,
    await callAction(c, actions.getSessionOriginChain, [params.sessionId] as never[], c.get("auth"))
  );
}

export async function getSessionResponseBody(c: Context): Promise<Response> {
  const params = parseSessionParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/session-response");
  const result = await callAction(
    c,
    actions.getSessionResponse,
    [params.sessionId] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ response: result.data });
}

export async function terminateSession(c: Context): Promise<Response> {
  const params = parseSessionParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/active-sessions");
  const result = await callAction(
    c,
    actions.terminateActiveSession,
    [params.sessionId] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function batchTerminateSessions(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, BatchTerminateSessionsSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/active-sessions");
  return actionJson(
    c,
    await callAction(
      c,
      actions.terminateActiveSessionsBatch,
      [body.data.sessionIds] as never[],
      c.get("auth")
    )
  );
}

function parseSessionParams(c: Context): { sessionId: string } | Response {
  const params = SessionIdParamSchema.safeParse({ sessionId: c.req.param("sessionId") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  return params.data;
}

function actionJson<T>(c: Context, result: ActionResult<T>): Response {
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status =
    detail.includes("不存在") || detail.includes("过期")
      ? 404
      : detail.includes("无权") || detail.includes("权限")
        ? 403
        : 400;
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: result.errorCode ?? (status === 404 ? "session.not_found" : "session.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}
