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

    // Case 1: baseUrl 已是 requestPath 的前缀（例如 base=/v1/messages, req=/v1/messages/count_tokens）
    // 直接使用 requestPath，避免丢失子路径。
    if (requestPath === basePath || requestPath.startsWith(`${basePath}/`)) {
      baseUrlObj.pathname = requestPath;
      baseUrlObj.search = requestUrl.search;
      return baseUrlObj.toString();
    }

    // Case 2: baseUrl 已包含“端点根路径”（可能带有额外前缀），仅追加 requestPath 的子路径部分。
    const targetEndpoints = [
      "/responses", // Codex Response API
      "/messages", // Claude Messages API
      "/chat/completions", // OpenAI Compatible
      "/models", // Gemini & OpenAI models
    ];

    for (const endpoint of targetEndpoints) {
      const requestRoot = `/v1${endpoint}`; // /v1/messages, /v1/responses 等
      if (requestPath === requestRoot || requestPath.startsWith(`${requestRoot}/`)) {
        if (basePath.endsWith(endpoint) || basePath.endsWith(requestRoot)) {
          const suffix = requestPath.slice(requestRoot.length); // 例如 /count_tokens
          baseUrlObj.pathname = basePath + suffix;
          baseUrlObj.search = requestUrl.search;

          logger.debug("[buildProxyUrl] Detected endpoint root in baseUrl", {
            basePath,
            requestPath,
            endpoint,
            action: "append_suffix",
          });

          return baseUrlObj.toString();
        }
      }
    }

    // 标准拼接：basePath + requestPath
    baseUrlObj.pathname = basePath + requestPath;
    baseUrlObj.search = requestUrl.search;
    return baseUrlObj.toString();
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

  // 验证 URL 格式有效性（防止 new URL() 抛出异常）
  try {
    new URL(baseUrl);
  } catch {
    // URL 无效，返回空预览
    return previews;
  }

  // 根据供应商类型定义端点映射（key 由 UI 负责 i18n）
  const endpointsByType: Record<string, Array<{ key: string; path: string }>> = {
    claude: [
      { key: "claudeMessages", path: "/v1/messages" },
      { key: "claudeCountTokens", path: "/v1/messages/count_tokens" },
    ],
    "claude-auth": [
      { key: "claudeMessages", path: "/v1/messages" },
      { key: "claudeCountTokens", path: "/v1/messages/count_tokens" },
    ],
    codex: [{ key: "codexResponses", path: "/v1/responses" }],
    "openai-compatible": [
      { key: "openaiChatCompletions", path: "/v1/chat/completions" },
      { key: "openaiModels", path: "/v1/models" },
    ],
    gemini: [
      {
        key: "geminiGenerateContent",
        path: "/v1beta/models/gemini-1.5-pro:generateContent",
      },
      {
        key: "geminiStreamContent",
        path: "/v1beta/models/gemini-1.5-pro:streamGenerateContent",
      },
    ],
    "gemini-cli": [
      {
        key: "geminiCliGenerate",
        path: "/v1internal/models/gemini-2.5-flash:generateContent",
      },
      {
        key: "geminiCliStream",
        path: "/v1internal/models/gemini-2.5-flash:streamGenerateContent",
      },
    ],
  };

  // 获取当前供应商类型对应的端点列表（默认显示 Claude）
  const endpoints = providerType ? endpointsByType[providerType] || [] : endpointsByType.claude;

  // 如果没有匹配的端点，显示常见端点
  const effectiveEndpoints =
    endpoints.length > 0
      ? endpoints
      : [
          { key: "claudeMessages", path: "/v1/messages" },
          { key: "codexResponses", path: "/v1/responses" },
          { key: "openaiChatCompletions", path: "/v1/chat/completions" },
        ];

  // 生成当前供应商类型的端点预览
  for (const { key, path } of effectiveEndpoints) {
    const fakeRequestUrl = new URL(`https://dummy.com${path}`);
    previews[key] = buildProxyUrl(baseUrl, fakeRequestUrl);
  }

  return previews;
}
