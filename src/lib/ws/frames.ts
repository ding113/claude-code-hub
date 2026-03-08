import { z } from "zod";

// ---------------------------------------------------------------------------
// Reasoning config (mirrors existing ResponseRequest.reasoning)
// Uses .passthrough() to preserve unknown fields (e.g. encrypted_content)
// for forward compatibility.
// ---------------------------------------------------------------------------

export const ReasoningConfigSchema = z
  .object({
    effort: z.enum(["minimal", "low", "medium", "high"]).optional(),
    summary: z.enum(["auto", "concise", "detailed"]).optional(),
    encrypted_content: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Service tier: known values + arbitrary string for forward compat
// ---------------------------------------------------------------------------

export const ServiceTierSchema = z.enum(["auto", "default", "flex", "priority"]).or(z.string());

// ---------------------------------------------------------------------------
// Input item - permissive shape matching ResponseRequest.input entries
// ---------------------------------------------------------------------------

const InputItemSchema = z
  .object({
    type: z.string(),
    role: z.string().optional(),
    content: z.union([z.string(), z.array(z.any())]).optional(),
  })
  .passthrough();

// ===== Client -> Server Frames ==============================================

/**
 * response.create: the primary client frame.
 * The `response` body mirrors ResponseRequest from codex/types/response.ts.
 */
export const ResponseCreateFrameSchema = z.object({
  type: z.literal("response.create"),
  response: z
    .object({
      model: z.string().min(1),
      input: z.array(InputItemSchema).optional(),
      instructions: z.string().optional(),
      max_output_tokens: z.number().int().positive().optional(),
      metadata: z.record(z.string(), z.string()).optional(),
      parallel_tool_calls: z.boolean().optional(),
      previous_response_id: z.string().optional(),
      reasoning: ReasoningConfigSchema.optional(),
      store: z.boolean().optional(),
      temperature: z.number().optional(),
      tool_choice: z.union([z.string(), z.object({}).passthrough()]).optional(),
      tools: z.array(z.any()).optional(),
      top_p: z.number().optional(),
      truncation: z.enum(["auto", "disabled"]).optional(),
      user: z.string().optional(),
      service_tier: ServiceTierSchema.optional(),
      stream: z.boolean().optional(),
      prompt_cache_key: z.string().optional(),
    })
    .passthrough(),
});

/**
 * response.cancel: sent by the client to abort an in-progress response.
 */
export const ResponseCancelFrameSchema = z.object({
  type: z.literal("response.cancel"),
});

/**
 * Union of all valid client frames, discriminated on `type`.
 */
export const ClientFrameSchema = z.discriminatedUnion("type", [
  ResponseCreateFrameSchema,
  ResponseCancelFrameSchema,
]);

// ===== Server -> Client Events ===============================================

/** Terminal event type literals */
export const TERMINAL_EVENT_TYPES = [
  "response.completed",
  "response.failed",
  "response.incomplete",
] as const;

export type TerminalEventType = (typeof TERMINAL_EVENT_TYPES)[number];

/** Usage block present in terminal event responses */
export const UsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative().optional(),
    output_tokens_details: z
      .object({
        reasoning_tokens: z.number().int().nonnegative().optional(),
      })
      .optional(),
  })
  .passthrough();

/** Response object embedded in terminal events */
export const TerminalResponseSchema = z
  .object({
    id: z.string(),
    object: z.literal("response").optional(),
    model: z.string().optional(),
    status: z.enum(["completed", "failed", "incomplete"]),
    usage: UsageSchema.optional(),
    service_tier: z.string().optional(),
    prompt_cache_key: z.string().optional(),
    output: z.array(z.any()).optional(),
  })
  .passthrough();

/** Terminal event frame (response.completed / failed / incomplete) */
export const TerminalEventSchema = z.object({
  type: z.enum(TERMINAL_EVENT_TYPES),
  response: TerminalResponseSchema,
});

/** Error frame pushed by the server */
export const ServerErrorFrameSchema = z.object({
  type: z.literal("error"),
  error: z
    .object({
      type: z.string(),
      code: z.string().optional(),
      message: z.string(),
      param: z.string().nullable().optional(),
      event_id: z.string().optional(),
    })
    .passthrough(),
});

// ===== Type exports ==========================================================

export type ResponseCreateFrame = z.infer<typeof ResponseCreateFrameSchema>;
export type ClientFrame = z.infer<typeof ClientFrameSchema>;
export type TerminalEvent = z.infer<typeof TerminalEventSchema>;
export type ServerErrorFrame = z.infer<typeof ServerErrorFrameSchema>;
export type ResponseUsage = z.infer<typeof UsageSchema>;
