import { z } from "@hono/zod-openapi";

export const SessionIdParamSchema = z.object({
  sessionId: z.string().min(1).describe("Session id."),
});

export const SessionsListQuerySchema = z.object({
  state: z.enum(["active", "all"]).default("active").describe("Session list mode."),
  activePage: z.coerce.number().int().min(1).default(1).describe("Active sessions page."),
  inactivePage: z.coerce.number().int().min(1).default(1).describe("Inactive sessions page."),
  pageSize: z.coerce.number().int().min(1).max(200).default(20).describe("Page size."),
});

export const SessionSequenceQuerySchema = z.object({
  requestSequence: z.coerce.number().int().positive().optional().describe("Request sequence."),
});

export const SessionRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).describe("One-based page number."),
  pageSize: z.coerce.number().int().min(1).max(200).default(20).describe("Page size."),
  order: z.enum(["asc", "desc"]).default("asc").describe("Sort order."),
});

export const BatchTerminateSessionsSchema = z
  .object({
    sessionIds: z.array(z.string().min(1)).min(1).max(200).describe("Session ids to terminate."),
  })
  .strict();

export const SessionListResponseSchema = z
  .union([
    z.object({ items: z.array(z.unknown()).describe("Active sessions.") }),
    z.object({
      active: z.array(z.unknown()).describe("Active sessions."),
      inactive: z.array(z.unknown()).describe("Inactive sessions."),
      totalActive: z.number().int().min(0).describe("Active session count."),
      totalInactive: z.number().int().min(0).describe("Inactive session count."),
      hasMoreActive: z.boolean().describe("Whether more active sessions exist."),
      hasMoreInactive: z.boolean().describe("Whether more inactive sessions exist."),
    }),
  ])
  .describe("Session list response.");

export const SessionGenericResponseSchema = z
  .record(z.string(), z.unknown())
  .describe("Session response object.");

export const SessionUnknownResponseSchema = z.unknown().describe("Session payload.");

export const SessionBooleanResponseSchema = z.object({
  exists: z.boolean().describe("Whether the session payload exists."),
});

export const SessionStringResponseSchema = z.object({
  response: z.string().describe("Session response body."),
});

export const BatchTerminateSessionsResponseSchema = z.object({
  successCount: z.number().int().min(0).describe("Successful termination count."),
  failedCount: z.number().int().min(0).describe("Failed termination count."),
  allowedFailedCount: z.number().int().min(0).describe("Failed authorized termination count."),
  unauthorizedCount: z.number().int().min(0).describe("Unauthorized session count."),
  missingCount: z.number().int().min(0).describe("Missing session count."),
  requestedCount: z.number().int().min(0).describe("Unique requested session count."),
  processedCount: z.number().int().min(0).describe("Processed session count."),
  unauthorizedSessionIds: z.array(z.string()).describe("Unauthorized session ids."),
  missingSessionIds: z.array(z.string()).describe("Missing session ids."),
});

export type SessionsListQuery = z.infer<typeof SessionsListQuerySchema>;
export type SessionSequenceQuery = z.infer<typeof SessionSequenceQuerySchema>;
export type SessionRequestsQuery = z.infer<typeof SessionRequestsQuerySchema>;
export type BatchTerminateSessionsInput = z.infer<typeof BatchTerminateSessionsSchema>;
