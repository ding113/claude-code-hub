import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  BatchTerminateSessionsResponseSchema,
  BatchTerminateSessionsSchema,
  SessionBooleanResponseSchema,
  SessionGenericResponseSchema,
  SessionIdParamSchema,
  SessionListResponseSchema,
  SessionRequestsQuerySchema,
  SessionSequenceQuerySchema,
  SessionStringResponseSchema,
  SessionsListQuerySchema,
  SessionUnknownResponseSchema,
} from "@/lib/api/v1/schemas/sessions";
import {
  batchTerminateSessions,
  getSessionDetail,
  getSessionMessages,
  getSessionOriginChain,
  getSessionRequests,
  getSessionResponseBody,
  hasSessionMessages,
  listSessions,
  terminateSession,
} from "./handlers";

export const sessionsRouter = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) return fromZodError(result.error, new URL(c.req.url).pathname);
  },
});

const security: Array<Record<string, string[]>> = [
  { cookieAuth: [] },
  { bearerAuth: [] },
  { apiKeyAuth: [] },
];

const problemResponses = {
  400: {
    description: "Invalid request.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  401: {
    description: "Authentication required.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  403: {
    description: "Session access denied.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  404: {
    description: "Session payload not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

sessionsRouter.openapi(
  createRoute({
    method: "get",
    path: "/sessions",
    middleware: requireAuth("read"),
    tags: ["Sessions"],
    summary: "List sessions",
    description: "Lists active sessions or active/inactive session pages.",
    "x-required-access": "read",
    security,
    request: { query: SessionsListQuerySchema },
    responses: {
      200: {
        description: "Session list.",
        content: { "application/json": { schema: SessionListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listSessions as never
);

sessionsRouter.openapi(
  createRoute({
    method: "post",
    path: "/sessions:batchTerminate",
    middleware: requireAuth("read"),
    tags: ["Sessions"],
    summary: "Batch terminate sessions",
    description: "Terminates multiple sessions allowed by the caller scope.",
    "x-required-access": "read",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: BatchTerminateSessionsSchema } },
      },
    },
    responses: {
      200: {
        description: "Batch termination result.",
        content: { "application/json": { schema: BatchTerminateSessionsResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  batchTerminateSessions as never
);

sessionsRouter.openapi(
  createRoute({
    method: "get",
    path: "/sessions/{sessionId}",
    middleware: requireAuth("read"),
    tags: ["Sessions"],
    summary: "Get session detail",
    description: "Returns session detail, snapshots, request metadata, and response metadata.",
    "x-required-access": "read",
    security,
    request: { params: SessionIdParamSchema, query: SessionSequenceQuerySchema },
    responses: {
      200: {
        description: "Session detail.",
        content: { "application/json": { schema: SessionGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getSessionDetail as never
);

sessionsRouter.openapi(
  createRoute({
    method: "get",
    path: "/sessions/{sessionId}/messages",
    middleware: requireAuth("read"),
    tags: ["Sessions"],
    summary: "Get session messages",
    description: "Returns stored session messages for a session or request sequence.",
    "x-required-access": "read",
    security,
    request: { params: SessionIdParamSchema, query: SessionSequenceQuerySchema },
    responses: {
      200: {
        description: "Session messages.",
        content: { "application/json": { schema: SessionUnknownResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getSessionMessages as never
);

sessionsRouter.openapi(
  createRoute({
    method: "get",
    path: "/sessions/{sessionId}/messages/exists",
    middleware: requireAuth("read"),
    tags: ["Sessions"],
    summary: "Check session messages",
    description: "Checks whether stored messages exist for a session or request sequence.",
    "x-required-access": "read",
    security,
    request: { params: SessionIdParamSchema, query: SessionSequenceQuerySchema },
    responses: {
      200: {
        description: "Session message existence.",
        content: { "application/json": { schema: SessionBooleanResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  hasSessionMessages as never
);

sessionsRouter.openapi(
  createRoute({
    method: "get",
    path: "/sessions/{sessionId}/requests",
    middleware: requireAuth("read"),
    tags: ["Sessions"],
    summary: "List session requests",
    description: "Lists request rows for a session.",
    "x-required-access": "read",
    security,
    request: { params: SessionIdParamSchema, query: SessionRequestsQuerySchema },
    responses: {
      200: {
        description: "Session requests.",
        content: { "application/json": { schema: SessionGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getSessionRequests as never
);

sessionsRouter.openapi(
  createRoute({
    method: "get",
    path: "/sessions/{sessionId}/origin-chain",
    middleware: requireAuth("read"),
    tags: ["Sessions"],
    summary: "Get session origin chain",
    description: "Returns provider origin chain information for a session.",
    "x-required-access": "read",
    security,
    request: { params: SessionIdParamSchema },
    responses: {
      200: {
        description: "Session origin chain.",
        content: { "application/json": { schema: SessionUnknownResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getSessionOriginChain as never
);

sessionsRouter.openapi(
  createRoute({
    method: "get",
    path: "/sessions/{sessionId}/response",
    middleware: requireAuth("read"),
    tags: ["Sessions"],
    summary: "Get session response body",
    description: "Returns the stored response body for a session.",
    "x-required-access": "read",
    security,
    request: { params: SessionIdParamSchema },
    responses: {
      200: {
        description: "Session response body.",
        content: { "application/json": { schema: SessionStringResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getSessionResponseBody as never
);

sessionsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/sessions/{sessionId}",
    middleware: requireAuth("read"),
    tags: ["Sessions"],
    summary: "Terminate session",
    description: "Terminates one active session allowed by the caller scope.",
    "x-required-access": "read",
    security,
    request: { params: SessionIdParamSchema },
    responses: {
      204: { description: "Session terminated." },
      ...problemResponses,
    },
  }),
  terminateSession as never
);
