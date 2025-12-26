import type { Context1mPreference } from "@/lib/special-attributes";
import type { CacheTtlPreference } from "./cache";
import type { CodexInstructionsStrategy, McpPassthroughType, ProviderType } from "./provider";

export type VendorCategory = "official" | "relay" | "self_hosted";
export type VendorApiFormat = "claude" | "codex" | "gemini";

export interface Vendor {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  category: VendorCategory;
  isManaged: boolean;
  isEnabled: boolean;
  tags: string[];
  websiteUrl: string | null;
  faviconUrl: string | null;

  balanceCheckEnabled: boolean;
  balanceCheckEndpoint: string | null;
  balanceCheckJsonpath: string | null;
  balanceCheckIntervalSeconds: number | null;
  balanceCheckLowThresholdUsd: number | null;

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface VendorEndpoint {
  id: number;
  vendorId: number;
  name: string;
  url: string;
  apiFormat: VendorApiFormat;
  isEnabled: boolean;

  priority: number;
  latencyMs: number | null;

  healthCheckEnabled: boolean;
  healthCheckEndpoint: string | null;
  healthCheckIntervalSeconds: number | null;
  healthCheckTimeoutMs: number | null;
  healthCheckLastCheckedAt: Date | null;
  healthCheckLastStatusCode: number | null;
  healthCheckErrorMessage: string | null;

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface VendorKey {
  id: number;

  vendorId: number;
  endpointId: number;
  isUserOverride: boolean;
  balanceUsd: number | null;
  balanceUpdatedAt: Date | null;

  // ====== provider-like fields ======
  name: string;
  description: string | null;
  url: string;
  key: string;
  isEnabled: boolean;
  weight: number;

  priority: number;
  costMultiplier: number;
  groupTag: string | null;

  providerType: ProviderType;
  preserveClientIp: boolean;

  modelRedirects: Record<string, string> | null;
  allowedModels: string[] | null;
  joinClaudePool: boolean;

  codexInstructionsStrategy: CodexInstructionsStrategy;

  mcpPassthroughType: McpPassthroughType;
  mcpPassthroughUrl: string | null;

  limit5hUsd: number | null;
  limitDailyUsd: number | null;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitConcurrentSessions: number;

  maxRetryAttempts: number | null;
  circuitBreakerFailureThreshold: number;
  circuitBreakerOpenDuration: number;
  circuitBreakerHalfOpenSuccessThreshold: number;

  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;

  firstByteTimeoutStreamingMs: number;
  streamingIdleTimeoutMs: number;
  requestTimeoutNonStreamingMs: number;

  websiteUrl: string | null;
  faviconUrl: string | null;
  cacheTtlPreference: CacheTtlPreference | null;
  context1mPreference: Context1mPreference | null;

  tpm: number | null;
  rpm: number | null;
  rpd: number | null;
  cc: number | null;

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}
