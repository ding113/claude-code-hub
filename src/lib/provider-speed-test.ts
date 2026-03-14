/**
 * 供应商测速服务
 * 用于测试 Provider 的响应速度和可用性
 */

import type { Provider } from "@/types/provider";

export interface SpeedTestResult {
  providerId: number;
  providerName: string;
  providerUrl: string;
  success: boolean;
  responseTime: number; // 毫秒
  error?: string;
  timestamp: Date;
}

export interface OptimizationResult {
  totalTested: number;
  successCount: number;
  failureCount: number;
  results: SpeedTestResult[];
  recommendations: {
    providerId: number;
    currentPriority: number;
    suggestedPriority: number;
    reason: string;
  }[];
}

/**
 * 测试单个 Provider 的响应速度
 */
export async function testProviderSpeed(
  provider: Provider,
  timeoutMs = 10000
): Promise<SpeedTestResult> {
  const startTime = Date.now();

  try {
    // 根据 Provider 类型构造测试请求
    const testRequest = buildTestRequest(provider);

    // 发送测试请求
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(testRequest.url, {
      method: "POST",
      headers: testRequest.headers,
      body: JSON.stringify(testRequest.body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseTime = Date.now() - startTime;

    // 检查响应状态
    if (!response.ok) {
      return {
        providerId: provider.id,
        providerName: provider.name,
        providerUrl: provider.url,
        success: false,
        responseTime,
        error: `HTTP ${response.status}: ${response.statusText}`,
        timestamp: new Date(),
      };
    }

    return {
      providerId: provider.id,
      providerName: provider.name,
      providerUrl: provider.url,
      success: true,
      responseTime,
      timestamp: new Date(),
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerUrl: provider.url,
      success: false,
      responseTime,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date(),
    };
  }
}

/**
 * 根据 Provider 类型构造测试请求
 */
function buildTestRequest(provider: Provider): {
  url: string;
  headers: Record<string, string>;
  body: unknown;
} {
  const baseUrl = provider.url.replace(/\/$/, "");

  // Claude 类型 Provider
  if (provider.providerType === "claude" || provider.providerType === "claude-auth") {
    return {
      url: `${baseUrl}/v1/messages`,
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(provider.providerType === "claude"
          ? { "x-api-key": provider.key }
          : { Authorization: `Bearer ${provider.key}` }),
      },
      body: {
        model: "claude-3-haiku-20240307",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      },
    };
  }

  // OpenAI 兼容类型
  if (provider.providerType === "openai" || provider.providerType === "openai-compatible") {
    return {
      url: `${baseUrl}/v1/chat/completions`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.key}`,
      },
      body: {
        model: "gpt-3.5-turbo",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      },
    };
  }

  // Gemini 类型
  if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
    return {
      url: `${baseUrl}/v1beta/models/gemini-pro:generateContent?key=${provider.key}`,
      headers: {
        "Content-Type": "application/json",
      },
      body: {
        contents: [{ parts: [{ text: "Hi" }] }],
      },
    };
  }

  // Codex 类型
  if (provider.providerType === "codex") {
    return {
      url: `${baseUrl}/v1/responses`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.key}`,
      },
      body: {
        model: "claude-3-haiku-20240307",
        max_tokens: 10,
        prompt: "Hi",
      },
    };
  }

  // 默认使用 Claude 格式
  return {
    url: `${baseUrl}/v1/messages`,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.key,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: "claude-3-haiku-20240307",
      max_tokens: 10,
      messages: [{ role: "user", content: "Hi" }],
    },
  };
}

/**
 * 批量测试多个 Provider
 */
export async function testMultipleProviders(
  providers: Provider[],
  concurrency = 3
): Promise<SpeedTestResult[]> {
  const results: SpeedTestResult[] = [];

  // 分批并发测试
  for (let i = 0; i < providers.length; i += concurrency) {
    const batch = providers.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((provider) => testProviderSpeed(provider)));
    results.push(...batchResults);
  }

  return results;
}

/**
 * 生成优化建议
 */
export function generateOptimizationRecommendations(
  providers: Provider[],
  testResults: SpeedTestResult[]
): OptimizationResult["recommendations"] {
  const recommendations: OptimizationResult["recommendations"] = [];

  // 按响应时间排序（成功的在前）
  const sortedResults = [...testResults].sort((a, b) => {
    if (a.success && !b.success) return -1;
    if (!a.success && b.success) return 1;
    return a.responseTime - b.responseTime;
  });

  // 根据排名分配优先级
  sortedResults.forEach((result, _index) => {
    const provider = providers.find((p) => p.id === result.providerId);
    if (!provider) return;

    let suggestedPriority: number;
    let reason: string;

    if (!result.success) {
      // 失败的 Provider 降低优先级
      suggestedPriority = 99;
      reason = `测速失败: ${result.error}`;
    } else if (result.responseTime < 500) {
      // 响应时间 < 500ms，优先级 1
      suggestedPriority = 1;
      reason = `响应速度极快 (${result.responseTime}ms)`;
    } else if (result.responseTime < 1000) {
      // 响应时间 < 1s，优先级 2
      suggestedPriority = 2;
      reason = `响应速度较快 (${result.responseTime}ms)`;
    } else if (result.responseTime < 2000) {
      // 响应时间 < 2s，优先级 3
      suggestedPriority = 3;
      reason = `响应速度一般 (${result.responseTime}ms)`;
    } else {
      // 响应时间 >= 2s，优先级 5
      suggestedPriority = 5;
      reason = `响应速度较慢 (${result.responseTime}ms)`;
    }

    // 只在优先级有变化时添加建议
    if (provider.priority !== suggestedPriority) {
      recommendations.push({
        providerId: provider.id,
        currentPriority: provider.priority,
        suggestedPriority,
        reason,
      });
    }
  });

  return recommendations;
}

/**
 * 执行完整的优化流程
 */
export async function optimizeProviders(providers: Provider[]): Promise<OptimizationResult> {
  // 只测试启用的 Provider
  const enabledProviders = providers.filter((p) => p.isEnabled);

  // 批量测速
  const results = await testMultipleProviders(enabledProviders);

  // 生成优化建议
  const recommendations = generateOptimizationRecommendations(enabledProviders, results);

  // 统计结果
  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  return {
    totalTested: results.length,
    successCount,
    failureCount,
    results,
    recommendations,
  };
}
