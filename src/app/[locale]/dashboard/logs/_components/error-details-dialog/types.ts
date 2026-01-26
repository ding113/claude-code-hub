import type { ProviderChainItem } from "@/types/message";
import type { SpecialSetting } from "@/types/special-settings";
import type { BillingModelSource } from "@/types/system-config";

/**
 * Shared props interface for all tab components
 */
export interface TabSharedProps {
  /** HTTP status code */
  statusCode: number | null;
  /** Error message if request failed */
  errorMessage: string | null;
  /** Provider decision chain */
  providerChain: ProviderChainItem[] | null;
  /** Session ID */
  sessionId: string | null;
  /** Request sequence number within session */
  requestSequence?: number | null;
  /** Block type (e.g., "sensitive_word", "warmup") */
  blockedBy?: string | null;
  /** Block reason (JSON string) */
  blockedReason?: string | null;
  /** Original model before redirect */
  originalModel?: string | null;
  /** Current model after redirect */
  currentModel?: string | null;
  /** User-Agent header */
  userAgent?: string | null;
  /** Number of messages in request */
  messagesCount?: number | null;
  /** API endpoint */
  endpoint?: string | null;
  /** Billing model source */
  billingModelSource?: BillingModelSource;
  /** Special settings applied */
  specialSettings?: SpecialSetting[] | null;
  /** Input tokens */
  inputTokens?: number | null;
  /** Output tokens */
  outputTokens?: number | null;
  /** Cache creation input tokens (total) */
  cacheCreationInputTokens?: number | null;
  /** Cache creation 5m input tokens */
  cacheCreation5mInputTokens?: number | null;
  /** Cache creation 1h input tokens */
  cacheCreation1hInputTokens?: number | null;
  /** Cache read input tokens */
  cacheReadInputTokens?: number | null;
  /** Cache TTL applied */
  cacheTtlApplied?: string | null;
  /** Total cost in USD */
  costUsd?: string | null;
  /** Cost multiplier */
  costMultiplier?: string | null;
  /** Whether 1M context pricing was applied */
  context1mApplied?: boolean | null;
  /** Total request duration in ms */
  durationMs?: number | null;
  /** Time to first byte in ms */
  ttfbMs?: number | null;
}

/**
 * Props for SummaryTab with additional handlers
 */
export interface SummaryTabProps extends TabSharedProps {
  /** Whether session has messages data */
  hasMessages: boolean;
  /** Whether messages check is loading */
  checkingMessages: boolean;
  /** Callback to switch to Logic Trace tab */
  onViewLogicTrace?: () => void;
}

/**
 * Props for LogicTraceTab
 */
export interface LogicTraceTabProps extends TabSharedProps {}

/**
 * Props for PerformanceTab
 */
export interface PerformanceTabProps extends TabSharedProps {}

/**
 * Props for MetadataTab
 */
export interface MetadataTabProps extends TabSharedProps {
  /** Whether session has messages data */
  hasMessages: boolean;
  /** Whether messages check is loading */
  checkingMessages: boolean;
}

/**
 * Parse blocked reason JSON string
 */
export function parseBlockedReason(
  blockedReason: string | null | undefined
): { word?: string; matchType?: string; matchedText?: string } | null {
  if (!blockedReason) return null;
  try {
    return JSON.parse(blockedReason);
  } catch {
    return null;
  }
}

/**
 * Calculate output tokens per second
 */
export function calculateOutputRate(
  outputTokens: number | null | undefined,
  durationMs: number | null | undefined,
  ttfbMs: number | null | undefined
): number | null {
  if (
    outputTokens === null ||
    outputTokens === undefined ||
    outputTokens <= 0 ||
    durationMs === null ||
    durationMs === undefined ||
    ttfbMs === null ||
    ttfbMs === undefined ||
    ttfbMs >= durationMs
  ) {
    return null;
  }
  const seconds = (durationMs - ttfbMs) / 1000;
  if (seconds <= 0) return null;
  return outputTokens / seconds;
}

/**
 * Determine if output rate should be hidden due to blocked streaming request.
 * Rule: Hide when generationTimeMs / durationMs < 0.1 AND outputRate > 5000
 * This indicates TTFB is very close to total duration with abnormally high tok/s.
 */
export function shouldHideOutputRate(
  outputRate: number | null,
  durationMs: number | null | undefined,
  ttfbMs: number | null | undefined
): boolean {
  if (
    outputRate == null ||
    !Number.isFinite(outputRate) ||
    durationMs == null ||
    durationMs <= 0 ||
    ttfbMs == null
  ) {
    return false;
  }
  const generationTimeMs = durationMs - ttfbMs;
  if (generationTimeMs <= 0) return false;
  const ratio = generationTimeMs / durationMs;
  return ratio < 0.1 && outputRate > 5000;
}

/**
 * Check if request is successful (2xx status)
 */
export function isSuccessStatus(statusCode: number | null): boolean {
  return statusCode !== null && statusCode >= 200 && statusCode < 300;
}

/**
 * Check if request is in progress (no status code)
 */
export function isInProgressStatus(statusCode: number | null): boolean {
  return statusCode === null;
}
