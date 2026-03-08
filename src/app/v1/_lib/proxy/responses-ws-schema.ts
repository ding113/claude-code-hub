import { z } from "zod";

const RESPONSES_WS_REASONING_EFFORT = z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]);
const RESPONSES_WS_REASONING_SUMMARY = z.enum(["auto", "concise", "detailed"]);
const RESPONSES_WS_SERVICE_TIER = z.enum(["auto", "default", "flex", "priority"]);

const ResponsesWsReasoningSchema = z
  .object({
    effort: RESPONSES_WS_REASONING_EFFORT.optional(),
    summary: RESPONSES_WS_REASONING_SUMMARY.optional(),
    encrypted_content: z.string().min(1).optional(),
  })
  .passthrough();

export const ResponsesWsCreatePayloadSchema = z
  .object({
    model: z.string().trim().min(1),
    input: z.unknown().optional(),
    instructions: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    parallel_tool_calls: z.boolean().optional(),
    previous_response_id: z.string().trim().min(1).optional(),
    prompt_cache_key: z.string().trim().min(1).optional(),
    reasoning: ResponsesWsReasoningSchema.optional(),
    service_tier: RESPONSES_WS_SERVICE_TIER.optional(),
    generate: z.boolean().optional(),
  })
  .passthrough();

export const ResponsesWsCreateFrameSchema = z
  .object({
    type: z.literal("response.create"),
    response: ResponsesWsCreatePayloadSchema,
  })
  .strict();

export const ResponsesWsCancelFrameSchema = z
  .object({
    type: z.literal("response.cancel"),
    response_id: z.string().trim().min(1).optional(),
  })
  .strict();

export const ResponsesWsProtocolErrorSchema = z
  .object({
    type: z.literal("error"),
    error: z
      .object({
        code: z.string().trim().min(1),
        message: z.string().trim().min(1),
        param: z.string().trim().min(1).nullable().optional(),
        event_id: z.string().trim().min(1).nullable().optional(),
      })
      .passthrough(),
  })
  .strict();

export const ResponsesWsClientFrameSchema = z.union([
  ResponsesWsCreateFrameSchema,
  ResponsesWsCancelFrameSchema,
]);

export const ResponsesWsServerEventSchema = z
  .object({
    type: z.string().trim().min(1),
  })
  .passthrough();

export const RESPONSES_WS_TERMINAL_EVENT_TYPES = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
]);

export type ResponsesWsCreatePayload = z.infer<typeof ResponsesWsCreatePayloadSchema>;
export type ResponsesWsCreateFrame = z.infer<typeof ResponsesWsCreateFrameSchema>;
export type ResponsesWsCancelFrame = z.infer<typeof ResponsesWsCancelFrameSchema>;
export type ResponsesWsClientFrame = z.infer<typeof ResponsesWsClientFrameSchema>;
export type ResponsesWsProtocolError = z.infer<typeof ResponsesWsProtocolErrorSchema>;
export type ResponsesWsServerEvent = z.infer<typeof ResponsesWsServerEventSchema>;

export function parseResponsesWsClientFrame(raw: unknown): ResponsesWsClientFrame {
  return ResponsesWsClientFrameSchema.parse(raw);
}

export function parseResponsesWsInitialFrame(raw: unknown): ResponsesWsCreateFrame {
  return ResponsesWsCreateFrameSchema.parse(raw);
}

export function parseResponsesWsServerEvent(raw: unknown): ResponsesWsServerEvent {
  return ResponsesWsServerEventSchema.parse(raw);
}

export function isResponsesWsTerminalEvent(event: ResponsesWsServerEvent): boolean {
  return RESPONSES_WS_TERMINAL_EVENT_TYPES.has(event.type);
}

export function serializeResponsesWsFrame(
  frame: ResponsesWsClientFrame | ResponsesWsProtocolError
) {
  return JSON.stringify(frame);
}
