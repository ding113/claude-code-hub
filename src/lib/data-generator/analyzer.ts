"use server";

import { desc, isNull } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { messageRequest, providers, users } from "@/drizzle/schema";
import { findAllLatestPrices } from "@/repository/model-price";
import type {
  CostStats,
  DurationStats,
  HourlyDistribution,
  LogDistribution,
  ModelInfo,
  ProviderInfo,
  TokenStats,
  UserInfo,
  WeightedItem,
} from "./types";

const SAMPLE_LIMIT = 10000;

function calculateMeanAndStddev(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) {
    return { mean: 0, stddev: 0 };
  }

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);

  return { mean, stddev };
}

function getDefaultDistribution(): LogDistribution {
  const hourlyPattern: HourlyDistribution = {};
  for (let h = 0; h < 24; h++) {
    if (h >= 9 && h <= 21) {
      hourlyPattern[h] = 3;
    } else if (h >= 22 || h <= 6) {
      hourlyPattern[h] = 0.3;
    } else {
      hourlyPattern[h] = 1;
    }
  }

  return {
    hourlyPattern,
    userWeights: [],
    providerWeights: [],
    modelWeights: [],
    tokenStats: { mean: 5000, stddev: 2000 },
    durationStats: { mean: 3000, stddev: 1500 },
    costStats: { mean: 0.05, stddev: 0.03 },
    errorRate: 0.02,
    totalRecords: 0,
  };
}

export async function analyzeLogDistribution(): Promise<LogDistribution> {
  try {
    const logs = await db
      .select({
        createdAt: messageRequest.createdAt,
        userId: messageRequest.userId,
        providerId: messageRequest.providerId,
        model: messageRequest.model,
        inputTokens: messageRequest.inputTokens,
        outputTokens: messageRequest.outputTokens,
        cacheCreationInputTokens: messageRequest.cacheCreationInputTokens,
        cacheReadInputTokens: messageRequest.cacheReadInputTokens,
        costUsd: messageRequest.costUsd,
        durationMs: messageRequest.durationMs,
        statusCode: messageRequest.statusCode,
      })
      .from(messageRequest)
      .where(isNull(messageRequest.deletedAt))
      .orderBy(desc(messageRequest.createdAt))
      .limit(SAMPLE_LIMIT);

    if (logs.length === 0) {
      return getDefaultDistribution();
    }

    const hourCounts: Record<number, number> = {};
    for (let h = 0; h < 24; h++) {
      hourCounts[h] = 0;
    }

    const userCounts: Record<number, number> = {};
    const providerCounts: Record<number, number> = {};
    const modelCounts: Record<string, number> = {};
    const tokenValues: number[] = [];
    const durationValues: number[] = [];
    const costValues: number[] = [];
    let errorCount = 0;

    for (const log of logs) {
      if (log.createdAt) {
        const hour = new Date(log.createdAt).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }

      userCounts[log.userId] = (userCounts[log.userId] || 0) + 1;
      providerCounts[log.providerId] = (providerCounts[log.providerId] || 0) + 1;

      if (log.model) {
        modelCounts[log.model] = (modelCounts[log.model] || 0) + 1;
      }

      const totalTokens =
        (log.inputTokens || 0) +
        (log.outputTokens || 0) +
        (log.cacheCreationInputTokens || 0) +
        (log.cacheReadInputTokens || 0);

      if (totalTokens > 0) {
        tokenValues.push(totalTokens);
      }

      if (log.durationMs && log.durationMs > 0) {
        durationValues.push(log.durationMs);
      }

      if (log.costUsd) {
        const cost = parseFloat(log.costUsd);
        if (cost > 0) {
          costValues.push(cost);
        }
      }

      if (log.statusCode && log.statusCode >= 400) {
        errorCount++;
      }
    }

    const usersData = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(isNull(users.deletedAt));

    const providersData = await db
      .select({ id: providers.id, name: providers.name })
      .from(providers)
      .where(isNull(providers.deletedAt));

    const modelPrices = await findAllLatestPrices();

    const userWeights: WeightedItem<UserInfo>[] = usersData
      .map((user) => ({
        item: { id: user.id, name: user.name },
        weight: userCounts[user.id] || 1,
      }))
      .filter((item) => item.weight > 0);

    const providerWeights: WeightedItem<ProviderInfo>[] = providersData
      .map((provider) => ({
        item: { id: provider.id, name: provider.name },
        weight: providerCounts[provider.id] || 1,
      }))
      .filter((item) => item.weight > 0);

    const modelWeights: WeightedItem<ModelInfo>[] = Object.entries(modelCounts)
      .map(([modelName, count]) => {
        const priceInfo = modelPrices.find((p) => p.modelName === modelName);
        const priceData = priceInfo?.priceData;

        let inputPricePerM = 0.003;
        let outputPricePerM = 0.015;
        let cacheWritePricePerM: number | undefined;
        let cacheReadPricePerM: number | undefined;

        if (priceData) {
          if ("input_cost_per_token" in priceData) {
            inputPricePerM = (priceData.input_cost_per_token || 0) * 1_000_000;
            outputPricePerM = (priceData.output_cost_per_token || 0) * 1_000_000;

            if (priceData.cache_creation_input_token_cost) {
              cacheWritePricePerM = priceData.cache_creation_input_token_cost * 1_000_000;
            }
            if (priceData.cache_read_input_token_cost) {
              cacheReadPricePerM = priceData.cache_read_input_token_cost * 1_000_000;
            }
          } else if ("prompt_cost_per_token" in priceData) {
            inputPricePerM = ((priceData.prompt_cost_per_token as number) || 0) * 1_000_000;
            outputPricePerM = ((priceData.completion_cost_per_token as number) || 0) * 1_000_000;
          }
        }

        return {
          item: {
            name: modelName,
            inputPricePerM,
            outputPricePerM,
            cacheWritePricePerM,
            cacheReadPricePerM,
          },
          weight: count,
        };
      })
      .filter((item) => item.weight > 0);

    const tokenStats: TokenStats = calculateMeanAndStddev(tokenValues);
    const durationStats: DurationStats = calculateMeanAndStddev(durationValues);
    const costStats: CostStats = calculateMeanAndStddev(costValues);
    const errorRate = logs.length > 0 ? errorCount / logs.length : 0.02;

    const hourlyPattern: HourlyDistribution = {};
    const totalHourCounts = Object.values(hourCounts).reduce((sum, count) => sum + count, 0);

    for (let h = 0; h < 24; h++) {
      if (totalHourCounts > 0) {
        hourlyPattern[h] = hourCounts[h] / totalHourCounts;
      } else {
        hourlyPattern[h] = h >= 9 && h <= 21 ? 3 : h >= 22 || h <= 6 ? 0.3 : 1;
      }
    }

    return {
      hourlyPattern,
      userWeights,
      providerWeights,
      modelWeights,
      tokenStats,
      durationStats,
      costStats,
      errorRate,
      totalRecords: logs.length,
    };
  } catch (error) {
    console.error("Error analyzing log distribution:", error);
    return getDefaultDistribution();
  }
}
