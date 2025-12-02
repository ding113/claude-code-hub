import { logger } from "@/lib/logger";

/**
 * 构建代理目标URL（智能检测版本）
 *
 * 核心改进：智能检测 base_url 是否已包含完整路径
 *
 * **问题场景（Issue #139）**：
 * - 用户填写：`https://xxx.com/openai/responses`（已包含完整路径）
 * - 请求路径：`/v1/responses`
 * - 旧逻辑结果：`https://xxx.com/openai/responses/v1/responses` ❌
 * - 新逻辑结果：`https://xxx.com/openai/responses` ✅
 *
 * **智能检测规则**：
 * 1. 检查 base_url 末尾是否已包含完整目标路径（如 `/responses`, `/messages`）
 * 2. 如果已包含，直接使用 base_url（不再拼接）
 * 3. 如果未包含，执行标准拼接
 *
 * @param baseUrl - 基础URL（用户配置的供应商URL）
 *   - 示例 1：`https://api.openai.com` → 需要拼接
 *   - 示例 2：`https://xxx.com/openai/responses` → 已包含，不拼接
 * @param requestUrl - 原始请求URL对象（包含路径和查询参数）
 * @returns 拼接后的完整URL字符串
 */
export function buildProxyUrl(baseUrl: string, requestUrl: URL): string {
  try {
    // 解析baseUrl
    const baseUrlObj = new URL(baseUrl);
    const basePath = baseUrlObj.pathname.replace(/\/$/, ""); // 移除末尾斜杠
    const requestPath = requestUrl.pathname; // 原始请求路径（如 /v1/messages）

    // ⭐ 智能检测：base_url 是否已包含完整目标路径
    const targetEndpoints = [
      "/responses", // Codex Response API
      "/messages", // Claude Messages API
      "/chat/completions", // OpenAI Compatible
      "/models", // Gemini & OpenAI models
    ];

    let shouldSkipConcatenation = false;
    for (const endpoint of targetEndpoints) {
      // 检查 1：base_url 末尾是否包含目标端点
      if (basePath.endsWith(endpoint)) {
        shouldSkipConcatenation = true;
        logger.debug("[buildProxyUrl] Detected complete path in baseUrl", {
          basePath,
          endpoint,
          action: "skip_concatenation",
        });
        break;
      }

      // 检查 2：base_url 是否已包含完整的 API 路径（如 /v1/messages）
      // 这处理类似 "https://xxx.com/api/v1/messages" 的情况
      const fullApiPath = `/v1${endpoint}`; // /v1/messages, /v1/responses 等
      if (basePath.endsWith(fullApiPath)) {
        shouldSkipConcatenation = true;
        logger.debug("[buildProxyUrl] Detected complete API path in baseUrl", {
          basePath,
          fullApiPath,
          action: "skip_concatenation",
        });
        break;
      }
    }

    // 构建最终URL
    if (shouldSkipConcatenation) {
      // 已包含完整路径：直接使用 baseUrl + 查询参数
      baseUrlObj.search = requestUrl.search;
      return baseUrlObj.toString();
    } else {
      // 标准拼接：basePath + requestPath
      baseUrlObj.pathname = basePath + requestPath;
      baseUrlObj.search = requestUrl.search;
      return baseUrlObj.toString();
    }
  } catch (error) {
    logger.error("URL构建失败:", error);
    // 降级到字符串拼接
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
    return `${normalizedBaseUrl}${requestUrl.pathname}${requestUrl.search}`;
  }
}

/**
 * 预览 URL 拼接结果（用于 UI 显示）
 *
 * 根据供应商类型和 base_url，生成对应端点的拼接结果
 *
 * @param baseUrl - 基础URL
 * @param providerType - 供应商类型
 * @returns 该供应商类型对应的端点预览结果
 */
export function previewProxyUrls(baseUrl: string, providerType?: string): Record<string, string> {
  const previews: Record<string, string> = {};

  // 根据供应商类型定义端点映射
  const endpointsByType: Record<string, Array<{ name: string; path: string }>> = {
    claude: [
      { name: "Claude Messages", path: "/v1/messages" },
      { name: "Claude Count Tokens", path: "/v1/messages/count_tokens" },
    ],
    "claude-auth": [
      { name: "Claude Messages", path: "/v1/messages" },
      { name: "Claude Count Tokens", path: "/v1/messages/count_tokens" },
    ],
    codex: [{ name: "Codex Responses", path: "/v1/responses" }],
    "openai-compatible": [
      { name: "OpenAI Chat Completions", path: "/v1/chat/completions" },
      { name: "OpenAI Models", path: "/v1/models" },
    ],
    gemini: [
      {
        name: "Gemini Generate Content",
        path: "/v1beta/models/gemini-1.5-pro:generateContent",
      },
      {
        name: "Gemini Stream Content",
        path: "/v1beta/models/gemini-1.5-pro:streamGenerateContent",
      },
    ],
    "gemini-cli": [
      {
        name: "Gemini CLI Generate",
        path: "/v1internal/models/gemini-2.5-flash:generateContent",
      },
      {
        name: "Gemini CLI Stream",
        path: "/v1internal/models/gemini-2.5-flash:streamGenerateContent",
      },
    ],
  };

  // 获取当前供应商类型对应的端点列表（默认显示 Claude）
  const endpoints = providerType ? endpointsByType[providerType] || [] : endpointsByType.claude;

  // 如果没有匹配的端点，显示常见端点
  if (endpoints.length === 0) {
    const commonEndpoints = [
      { name: "Claude Messages", path: "/v1/messages" },
      { name: "Codex Responses", path: "/v1/responses" },
      { name: "OpenAI Chat", path: "/v1/chat/completions" },
    ];

    for (const { name, path } of commonEndpoints) {
      try {
        const fakeRequestUrl = new URL(`https://dummy.com${path}`);
        const result = buildProxyUrl(baseUrl, fakeRequestUrl);
        previews[name] = result;
      } catch {
        previews[name] = "❌ 无效的 URL";
      }
    }

    return previews;
  }

  // 生成当前供应商类型的端点预览
  for (const { name, path } of endpoints) {
    try {
      const fakeRequestUrl = new URL(`https://dummy.com${path}`);
      const result = buildProxyUrl(baseUrl, fakeRequestUrl);
      previews[name] = result;
    } catch {
      previews[name] = "❌ 无效的 URL";
    }
  }

  return previews;
}
