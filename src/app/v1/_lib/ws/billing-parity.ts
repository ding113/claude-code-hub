/**
 * WS Billing Parity Module
 *
 * Thin adapter that feeds WS terminal payloads through the SAME
 * billing/logging sinks as the HTTP proxy path, ensuring cost
 * calculation, trace metadata, and content redaction remain
 * consistent across transport types.
 *
 * This module does NOT modify existing files. It provides adapter
 * functions that translate WS types to the shapes expected by the
 * existing billing pipeline (calculateRequestCost, CostBreakdown,
 * UsageMetrics, REDACTED_MARKER).
 */

import type { UsageMetrics } from "@/app/v1/_lib/proxy/response-handler";
import {
  type CostBreakdown,
  calculateRequestCost,
  calculateRequestCostBreakdown,
} from "@/lib/utils/cost-calculation";
import { REDACTED_MARKER } from "@/lib/utils/message-redaction";
import type { ResponseUsage } from "@/lib/ws/frames";
import type { ModelPriceData } from "@/types/model-price";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WsBillingParams {
  /** Usage from terminal event */
  usage?: ResponseUsage;
  /** Model from terminal response */
  model?: string;
  /** Actual service tier from terminal response */
  serviceTier?: string;
  /** Requested service tier from client request */
  requestedServiceTier?: string;
  /** Price data for cost calculation (no cost if absent) */
  priceData?: ModelPriceData;
  /** Provider cost multiplier (default: 1.0) */
  costMultiplier?: number;
  /** Whether 1M context was applied */
  context1mApplied?: boolean;
}

export interface WsBillingResult {
  /** Normalized usage metrics (null if no usage) */
  usageMetrics: UsageMetrics | null;
  /** Individual token counts extracted from usage */
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  /** Whether priority service tier pricing should apply */
  priorityServiceTierApplied: boolean;
  /** Computed cost in USD (undefined if no priceData or no usage) */
  costUsd?: string;
  /** Cost breakdown by category (undefined if no priceData or no usage) */
  costBreakdown?: CostBreakdown;
}

export interface WsTraceParams {
  /** Handshake latency in ms */
  handshakeMs?: number;
  /** Total events relayed */
  eventCount: number;
  /** Terminal event type (e.g. "response.completed") */
  terminalType?: string;
  /** Model from terminal response */
  model?: string;
  /** Service tier from terminal response */
  serviceTier?: string;
  /** Total turn duration in ms */
  durationMs: number;
  /** HTTP-equivalent status code */
  statusCode?: number;
  /** Error message if failed */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Redact a single output item using the same rules as redactCodexOutput
 * in message-redaction.ts, plus encrypted_content redaction.
 */
function redactOutputItem(item: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...item };
  const itemType = redacted.type as string;

  // Redact message content[].text
  if (itemType === "message" && "content" in redacted && Array.isArray(redacted.content)) {
    redacted.content = (redacted.content as unknown[]).map((c) => {
      if (!isPlainObject(c)) return c;
      const rc = { ...c };
      if ("text" in rc && typeof rc.text === "string") {
        rc.text = REDACTED_MARKER;
      }
      return rc;
    });
  }

  // Redact reasoning summary[].text
  if (itemType === "reasoning" && "summary" in redacted && Array.isArray(redacted.summary)) {
    redacted.summary = (redacted.summary as unknown[]).map((s) => {
      if (!isPlainObject(s)) return s;
      const rs = { ...s };
      if ("text" in rs && typeof rs.text === "string") {
        rs.text = REDACTED_MARKER;
      }
      return rs;
    });
  }

  // Redact encrypted_content (present on reasoning items)
  if ("encrypted_content" in redacted && typeof redacted.encrypted_content === "string") {
    redacted.encrypted_content = REDACTED_MARKER;
  }

  // Redact function_call arguments
  if (itemType === "function_call" && "arguments" in redacted) {
    redacted.arguments = REDACTED_MARKER;
  }

  return redacted;
}

// ---------------------------------------------------------------------------
// wsUsageToMetrics
// ---------------------------------------------------------------------------

/**
 * Convert WS ResponseUsage (with potential passthrough cache fields)
 * to the canonical UsageMetrics type used by the billing pipeline.
 *
 * ResponseUsage schema uses .passthrough(), so cache fields may exist
 * as extra properties not visible at the TypeScript level.
 */
export function wsUsageToMetrics(usage?: ResponseUsage): UsageMetrics | null {
  if (!usage) return null;

  // Access passthrough fields via Record cast
  const raw = usage as Record<string, unknown>;

  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens:
      typeof raw.cache_creation_input_tokens === "number"
        ? raw.cache_creation_input_tokens
        : undefined,
    cache_read_input_tokens:
      typeof raw.cache_read_input_tokens === "number" ? raw.cache_read_input_tokens : undefined,
    // WS terminal payloads do not include 5m/1h split or cache_ttl;
    // leaving these undefined causes downstream pricing to fall back
    // to the unified cache_creation_input_tokens path.
  };
}

// ---------------------------------------------------------------------------
// settleWsTurnBilling
// ---------------------------------------------------------------------------

/**
 * Settle billing for a single WS turn using the same cost calculation
 * logic as the HTTP proxy path.
 *
 * Mirrors the flow in response-handler.ts:
 *   1. Extract usage metrics from ResponseUsage
 *   2. Determine priority service tier (actual from terminal > requested)
 *   3. Calculate cost via calculateRequestCost / calculateRequestCostBreakdown
 */
export function settleWsTurnBilling(params: WsBillingParams): WsBillingResult {
  const {
    usage,
    serviceTier,
    requestedServiceTier,
    priceData,
    costMultiplier = 1.0,
    context1mApplied = false,
  } = params;

  const usageMetrics = wsUsageToMetrics(usage);

  // Determine priority service tier: actual from terminal takes precedence,
  // fall back to requested tier. Mirrors isPriorityServiceTierApplied in
  // response-handler.ts.
  const priorityServiceTierApplied =
    serviceTier != null ? serviceTier === "priority" : requestedServiceTier === "priority";

  const result: WsBillingResult = {
    usageMetrics,
    inputTokens: usageMetrics?.input_tokens,
    outputTokens: usageMetrics?.output_tokens,
    cacheCreationInputTokens: usageMetrics?.cache_creation_input_tokens,
    cacheReadInputTokens: usageMetrics?.cache_read_input_tokens,
    priorityServiceTierApplied,
  };

  // Calculate cost only when both usage and pricing data are available
  if (usageMetrics && priceData) {
    const cost = calculateRequestCost(
      usageMetrics,
      priceData,
      costMultiplier,
      context1mApplied,
      priorityServiceTierApplied
    );

    if (cost.gt(0)) {
      result.costUsd = cost.toString();
    }

    result.costBreakdown = calculateRequestCostBreakdown(
      usageMetrics,
      priceData,
      context1mApplied,
      priorityServiceTierApplied
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// buildWsTraceMetadata
// ---------------------------------------------------------------------------

/**
 * Build trace metadata for Langfuse/logging that includes WS transport info.
 * Structured to merge into the existing generation metadata record used by
 * traceProxyRequest().
 */
export function buildWsTraceMetadata(params: WsTraceParams): Record<string, unknown> {
  return {
    transport: "websocket",
    handshakeMs: params.handshakeMs,
    eventCount: params.eventCount,
    terminalType: params.terminalType,
    model: params.model,
    serviceTier: params.serviceTier,
    durationMs: params.durationMs,
    statusCode: params.statusCode,
    errorMessage: params.errorMessage,
  };
}

// ---------------------------------------------------------------------------
// redactWsEventPayload
// ---------------------------------------------------------------------------

/** Event types whose `delta` field contains sensitive user content. */
const SENSITIVE_DELTA_TYPES = new Set([
  "response.output_text.delta",
  "response.reasoning_summary_text.delta",
  "response.function_call_arguments.delta",
  "response.content_part.delta",
]);

/**
 * Apply content redaction to a WS event payload, consistent with the
 * redaction rules applied to HTTP response bodies (redactCodexOutput).
 *
 * Handles three event shapes:
 *   1. Terminal events with response.output[] (response.completed/failed/incomplete)
 *   2. Streaming item events with item field (response.output_item.done)
 *   3. Delta events with string delta field (response.output_text.delta, etc.)
 *
 * Returns a shallow-cloned event with sensitive content replaced by
 * REDACTED_MARKER. Does not mutate the original.
 */
export function redactWsEventPayload(event: Record<string, unknown>): Record<string, unknown> {
  const result = { ...event };
  const eventType = typeof result.type === "string" ? result.type : "";

  // 1. Terminal events: redact response.output[] items
  if (isPlainObject(result.response)) {
    const response = { ...(result.response as Record<string, unknown>) };

    if ("output" in response && Array.isArray(response.output)) {
      response.output = (response.output as unknown[]).map((item) => {
        if (!isPlainObject(item)) return item;
        return redactOutputItem(item);
      });
    }

    result.response = response;
  }

  // 2. Streaming item events: redact item content
  if ("item" in result && isPlainObject(result.item)) {
    result.item = redactOutputItem(result.item as Record<string, unknown>);
  }

  // 3. Delta events: redact text/reasoning/function_call deltas
  if ("delta" in result && typeof result.delta === "string") {
    if (SENSITIVE_DELTA_TYPES.has(eventType)) {
      result.delta = REDACTED_MARKER;
    }
  }

  return result;
}
