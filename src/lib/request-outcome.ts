import type { ProviderChainItem } from "@/types/message";

export type SuccessRateOutcome = "success" | "failure" | "excluded";

export type SuccessRateExclusionFamily =
  | "warmup"
  | "sensitive_word"
  | "blocked_request"
  | "matched_rule"
  | "resource_not_found"
  | "client_abort"
  | "local_capacity"
  | "local_non_retryable"
  | "hedge_loser"
  | "quota_or_rate_limit"
  | "no_available_provider";

export interface RequestOutcomeTaxonomy {
  outcome: SuccessRateOutcome;
  locus: "upstream" | "non_upstream";
  countability: "countable" | "excluded";
  result: "success" | "failure" | "n/a";
  exclusionFamily?: SuccessRateExclusionFamily;
}

const NEUTRAL_REASONS = new Set<NonNullable<ProviderChainItem["reason"]>>([
  "session_reuse",
  "initial_selection",
  "hedge_triggered",
  "hedge_launched",
  "client_restriction_filtered",
  "http2_fallback",
]);

type RequestOutcomeSignal = {
  blockedBy?: string | null;
  blockedReason?: string | null;
  statusCode?: number | null;
  reason?: ProviderChainItem["reason"] | null;
  errorMessage?: string | null;
  matchedRule?: ProviderChainItem["errorDetails"] extends { matchedRule?: infer T } ? T : unknown;
};

const SUCCESS_REASONS = new Set<NonNullable<ProviderChainItem["reason"]>>([
  "request_success",
  "retry_success",
  "hedge_winner",
]);

const EXCLUDED_REASONS = new Map<
  NonNullable<ProviderChainItem["reason"]>,
  SuccessRateExclusionFamily
>([
  ["resource_not_found", "resource_not_found"],
  ["concurrent_limit_failed", "local_capacity"],
  ["hedge_loser_cancelled", "hedge_loser"],
  ["client_error_non_retryable", "local_non_retryable"],
  ["client_abort", "client_abort"],
]);

const QUOTA_OR_RATE_LIMIT_PATTERNS = [
  "insufficient quota",
  "quota exceeded",
  "rate limit",
  "rate_limit",
  "concurrency limit",
  "concurrent limit",
  "limit exceeded",
];

function buildSuccessTaxonomy(): RequestOutcomeTaxonomy {
  return {
    outcome: "success",
    locus: "upstream",
    countability: "countable",
    result: "success",
  };
}

function buildFailureTaxonomy(): RequestOutcomeTaxonomy {
  return {
    outcome: "failure",
    locus: "upstream",
    countability: "countable",
    result: "failure",
  };
}

function buildExcludedTaxonomy(
  exclusionFamily: SuccessRateExclusionFamily
): RequestOutcomeTaxonomy {
  return {
    outcome: "excluded",
    locus: "non_upstream",
    countability: "excluded",
    result: "n/a",
    exclusionFamily,
  };
}

function normalizeBlockedBy(blockedBy: string | null | undefined): string | null {
  const normalized = blockedBy?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function matchesQuotaOrRateLimit(message: string | null | undefined): boolean {
  const normalized = message?.toLowerCase() ?? "";
  return QUOTA_OR_RATE_LIMIT_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function resolveSuccessRateModelKey(input: {
  originalModel?: string | null;
  model?: string | null;
}): string | null {
  const candidate = input.originalModel?.trim() || input.model?.trim() || "";
  return candidate.length > 0 ? candidate : null;
}

export function classifyRequestOutcomeSignal(
  signal: RequestOutcomeSignal
): RequestOutcomeTaxonomy | null {
  const blockedBy = normalizeBlockedBy(signal.blockedBy);
  if (blockedBy === "warmup") {
    return buildExcludedTaxonomy("warmup");
  }
  if (blockedBy === "sensitive_word") {
    return buildExcludedTaxonomy("sensitive_word");
  }
  if (blockedBy) {
    return buildExcludedTaxonomy("blocked_request");
  }

  if (signal.matchedRule) {
    return buildExcludedTaxonomy("matched_rule");
  }

  if (signal.statusCode === 499 || signal.reason === "client_abort") {
    return buildExcludedTaxonomy("client_abort");
  }

  if (signal.statusCode === 404 || signal.reason === "resource_not_found") {
    return buildExcludedTaxonomy("resource_not_found");
  }

  const excludedReason = signal.reason ? EXCLUDED_REASONS.get(signal.reason) : undefined;
  if (excludedReason) {
    return buildExcludedTaxonomy(excludedReason);
  }

  const normalizedError = signal.errorMessage?.toLowerCase() ?? "";
  if (normalizedError.includes("no available provider")) {
    return buildExcludedTaxonomy("no_available_provider");
  }
  if (matchesQuotaOrRateLimit(signal.errorMessage)) {
    return buildExcludedTaxonomy("quota_or_rate_limit");
  }

  if (
    (signal.reason && SUCCESS_REASONS.has(signal.reason)) ||
    isSuccessStatusCode(signal.statusCode)
  ) {
    return buildSuccessTaxonomy();
  }

  if (
    signal.reason &&
    NEUTRAL_REASONS.has(signal.reason) &&
    signal.statusCode == null &&
    (!signal.errorMessage || signal.errorMessage.length === 0)
  ) {
    return null;
  }

  if (signal.statusCode != null || signal.reason || normalizedError.length > 0) {
    return buildFailureTaxonomy();
  }

  return null;
}

export function classifyProviderChainItemOutcome(
  item: Pick<ProviderChainItem, "statusCode" | "reason" | "errorMessage" | "errorDetails">
): RequestOutcomeTaxonomy | null {
  return classifyRequestOutcomeSignal({
    statusCode: item.statusCode ?? null,
    reason: item.reason ?? null,
    errorMessage: item.errorMessage ?? null,
    matchedRule: item.errorDetails?.matchedRule,
  });
}

export function isSuccessStatusCode(statusCode: number | null | undefined): boolean {
  return statusCode != null && statusCode >= 200 && statusCode < 400;
}
