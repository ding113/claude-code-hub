import type { ProviderChainItem } from "@/types/message";

export interface HourlyDistribution {
  [hour: number]: number;
}

export interface WeightedItem<T> {
  item: T;
  weight: number;
}

export interface TokenStats {
  mean: number;
  stddev: number;
}

export interface DurationStats {
  mean: number;
  stddev: number;
}

export interface CostStats {
  mean: number;
  stddev: number;
}

export interface UserInfo {
  id: number;
  name: string;
}

export interface ProviderInfo {
  id: number;
  name: string;
}

export interface ModelInfo {
  name: string;
  inputPricePerM: number;
  outputPricePerM: number;
  cacheWritePricePerM?: number;
  cacheReadPricePerM?: number;
}

export interface LogDistribution {
  hourlyPattern: HourlyDistribution;
  userWeights: WeightedItem<UserInfo>[];
  providerWeights: WeightedItem<ProviderInfo>[];
  modelWeights: WeightedItem<ModelInfo>[];
  tokenStats: TokenStats;
  durationStats: DurationStats;
  costStats: CostStats;
  errorRate: number;
  totalRecords: number;
}

export interface GeneratorParams {
  startDate: Date;
  endDate: Date;
  mode?: "usage" | "userBreakdown";
  serviceName?: string;
  totalRecords?: number;
  totalCostCny?: number;
  models?: string[];
  userIds?: number[];
  providerIds?: number[];
}

export interface GeneratedLog {
  id: number;
  createdAt: Date;
  sessionId: string | null;
  userName: string;
  keyName: string;
  providerName: string;
  model: string;
  statusCode: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  costUsd: string;
  durationMs: number;
  errorMessage: string | null;
  providerChain: ProviderChainItem[] | null;
  blockedBy: string | null;
  blockedReason: string | null;
}

export interface GeneratorResult {
  logs: GeneratedLog[];
  summary: {
    totalRecords: number;
    totalCost: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheCreationTokens: number;
    totalCacheReadTokens: number;
  };
}

export interface UserBreakdownItem {
  userName: string;
  keyName: string;
  model: string;
  serviceName: string;
  totalCalls: number;
  totalCost: number;
}

export interface UserBreakdownResult {
  items: UserBreakdownItem[];
  summary: {
    totalCalls: number;
    totalCost: number;
    uniqueUsers: number;
    uniqueKeys: number;
    uniqueModels: number;
  };
}
