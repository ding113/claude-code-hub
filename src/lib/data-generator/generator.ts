import type { ProviderChainItem } from "@/types/message";
import { analyzeLogDistribution } from "./analyzer";
import type {
  GeneratedLog,
  GeneratorParams,
  GeneratorResult,
  LogDistribution,
  ModelInfo,
  ProviderInfo,
  UserBreakdownItem,
  UserBreakdownResult,
  WeightedItem,
} from "./types";

const CNY_TO_USD = 7.1;
const MAX_RECORDS = 10000;

function weightedRandom<T>(items: WeightedItem<T>[]): T {
  if (items.length === 0) {
    throw new Error("Cannot select from empty array");
  }

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;

  for (const item of items) {
    random -= item.weight;
    if (random <= 0) {
      return item.item;
    }
  }

  return items[items.length - 1].item;
}

function normalRandom(mean: number, stddev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const value = mean + z0 * stddev;
  return Math.max(0, Math.round(value));
}

function generateTimestamp(
  startDate: Date,
  endDate: Date,
  hourlyPattern: Record<number, number>
): Date {
  const startTime = startDate.getTime();
  const endTime = endDate.getTime();
  const totalMs = endTime - startTime;

  const randomMs = Math.random() * totalMs;
  const baseTimestamp = new Date(startTime + randomMs);

  const hour = baseTimestamp.getHours();
  const hourWeight = hourlyPattern[hour] || 1;

  if (Math.random() > hourWeight / 3) {
    return generateTimestamp(startDate, endDate, hourlyPattern);
  }

  return baseTimestamp;
}

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

function calculateCost(
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  modelInfo: ModelInfo
): number {
  const inputCost = (inputTokens / 1_000_000) * modelInfo.inputPricePerM;
  const outputCost = (outputTokens / 1_000_000) * modelInfo.outputPricePerM;

  let cacheCost = 0;
  if (modelInfo.cacheWritePricePerM && cacheCreationTokens > 0) {
    cacheCost += (cacheCreationTokens / 1_000_000) * modelInfo.cacheWritePricePerM;
  }
  if (modelInfo.cacheReadPricePerM && cacheReadTokens > 0) {
    cacheCost += (cacheReadTokens / 1_000_000) * modelInfo.cacheReadPricePerM;
  }

  return inputCost + outputCost + cacheCost;
}

function generateProviderChain(
  finalProvider: ProviderInfo,
  distribution: LogDistribution
): ProviderChainItem[] {
  if (Math.random() > 0.3 || distribution.providerWeights.length <= 1) {
    return [];
  }

  const numRetries = Math.floor(Math.random() * 2) + 1;
  const chain: ProviderChainItem[] = [];

  for (let i = 0; i < numRetries; i++) {
    const provider = weightedRandom(distribution.providerWeights);
    if (provider.id !== finalProvider.id) {
      chain.push({ id: provider.id, name: provider.name });
    }
  }

  return chain;
}

export async function generateLogs(params: GeneratorParams): Promise<GeneratorResult> {
  const distribution = await analyzeLogDistribution();

  if (
    distribution.userWeights.length === 0 ||
    distribution.providerWeights.length === 0 ||
    distribution.modelWeights.length === 0
  ) {
    throw new Error(
      "Insufficient data to generate logs. Please ensure users, providers, and model prices are configured."
    );
  }

  let filteredUsers = distribution.userWeights;
  if (params.userIds && params.userIds.length > 0) {
    filteredUsers = distribution.userWeights.filter((w) => params.userIds?.includes(w.item.id));
  }

  let filteredProviders = distribution.providerWeights;
  if (params.providerIds && params.providerIds.length > 0) {
    filteredProviders = distribution.providerWeights.filter((w) =>
      params.providerIds?.includes(w.item.id)
    );
  }

  let filteredModels = distribution.modelWeights;
  if (params.models && params.models.length > 0) {
    filteredModels = distribution.modelWeights.filter((w) => params.models?.includes(w.item.name));
  }

  if (filteredUsers.length === 0 || filteredProviders.length === 0 || filteredModels.length === 0) {
    throw new Error("No data matches the filter criteria");
  }

  let targetRecords = params.totalRecords || 1000;

  if (params.totalCostCny) {
    const targetCostUsd = params.totalCostCny / CNY_TO_USD;
    const avgCost = distribution.costStats.mean || 0.05;
    targetRecords = Math.round(targetCostUsd / avgCost);
  }

  targetRecords = Math.min(targetRecords, MAX_RECORDS);

  const logs: GeneratedLog[] = [];
  let totalCost = 0;
  let totalTokens = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;

  const recentSessions: string[] = [];

  for (let i = 0; i < targetRecords; i++) {
    const user = weightedRandom(filteredUsers);
    const provider = weightedRandom(filteredProviders);
    const model = weightedRandom(filteredModels);

    const createdAt = generateTimestamp(
      params.startDate,
      params.endDate,
      distribution.hourlyPattern
    );

    let sessionId: string | null = null;
    if (Math.random() < 0.2 && recentSessions.length > 0) {
      sessionId = recentSessions[Math.floor(Math.random() * recentSessions.length)];
    } else {
      sessionId = generateSessionId();
      recentSessions.push(sessionId);
      if (recentSessions.length > 20) {
        recentSessions.shift();
      }
    }

    const isError = Math.random() < distribution.errorRate;
    const statusCode = isError ? (Math.random() < 0.5 ? 429 : 500) : 200;

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationInputTokens = 0;
    let cacheReadInputTokens = 0;
    let durationMs = 0;
    let costUsd = 0;
    let errorMessage: string | null = null;

    if (!isError) {
      const totalTokensGenerated = normalRandom(
        distribution.tokenStats.mean,
        distribution.tokenStats.stddev
      );

      inputTokens = Math.floor(totalTokensGenerated * 0.6);
      outputTokens = Math.floor(totalTokensGenerated * 0.35);

      if (Math.random() < 0.1 && model.cacheWritePricePerM) {
        cacheCreationInputTokens = Math.floor(inputTokens * 0.3);
        inputTokens = inputTokens - cacheCreationInputTokens;
      }

      if (Math.random() < 0.15 && model.cacheReadPricePerM) {
        cacheReadInputTokens = Math.floor(inputTokens * 0.5);
        inputTokens = inputTokens - cacheReadInputTokens;
      }

      durationMs = normalRandom(distribution.durationStats.mean, distribution.durationStats.stddev);

      costUsd = calculateCost(
        inputTokens,
        outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
        model
      );
    } else {
      durationMs = Math.floor(Math.random() * 2000) + 500;
      errorMessage = statusCode === 429 ? "Rate limit exceeded" : "Internal server error";
    }

    const providerChain = generateProviderChain(provider, distribution);

    logs.push({
      id: i + 1,
      createdAt,
      sessionId,
      userName: user.name,
      keyName: `${user.name}-key-${Math.floor(Math.random() * 3) + 1}`,
      providerName: provider.name,
      model: model.name,
      statusCode,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
      costUsd: costUsd.toFixed(15),
      durationMs,
      errorMessage,
      providerChain: providerChain.length > 0 ? providerChain : null,
      blockedBy: null,
      blockedReason: null,
    });

    totalCost += costUsd;
    totalTokens += inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalCacheCreationTokens += cacheCreationInputTokens;
    totalCacheReadTokens += cacheReadInputTokens;
  }

  logs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  if (params.totalCostCny) {
    const targetCostUsd = params.totalCostCny / CNY_TO_USD;
    const scaleFactor = targetCostUsd / totalCost;

    for (const log of logs) {
      const originalCost = parseFloat(log.costUsd);
      const scaledCost = originalCost * scaleFactor;
      log.costUsd = scaledCost.toFixed(15);
    }

    totalCost = targetCostUsd;
  }

  return {
    logs,
    summary: {
      totalRecords: logs.length,
      totalCost,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalCacheCreationTokens,
      totalCacheReadTokens,
    },
  };
}

export async function generateUserBreakdown(params: GeneratorParams): Promise<UserBreakdownResult> {
  const logsResult = await generateLogs(params);
  const serviceName = params.serviceName || "AI大模型推理服务";

  const breakdownMap = new Map<string, UserBreakdownItem>();

  for (const log of logsResult.logs) {
    if (log.statusCode !== 200) continue;

    const key = `${log.userName}|${log.keyName}|${log.model}`;
    const existing = breakdownMap.get(key);

    if (existing) {
      existing.totalCalls++;
      existing.totalCost += parseFloat(log.costUsd);
    } else {
      breakdownMap.set(key, {
        userName: log.userName,
        keyName: log.keyName,
        model: log.model,
        serviceName,
        totalCalls: 1,
        totalCost: parseFloat(log.costUsd),
      });
    }
  }

  const items = Array.from(breakdownMap.values()).sort((a, b) => b.totalCost - a.totalCost);

  const uniqueUsers = new Set(items.map((item) => item.userName)).size;
  const uniqueKeys = new Set(items.map((item) => item.keyName)).size;
  const uniqueModels = new Set(items.map((item) => item.model)).size;

  const totalCalls = items.reduce((sum, item) => sum + item.totalCalls, 0);
  const totalCost = items.reduce((sum, item) => sum + item.totalCost, 0);

  return {
    items,
    summary: {
      totalCalls,
      totalCost,
      uniqueUsers,
      uniqueKeys,
      uniqueModels,
    },
  };
}
