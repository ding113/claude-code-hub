import { logger } from "@/lib/logger";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const targetEndpoints = [
  "/responses", // Codex Response API
  "/messages", // Claude Messages API
  "/chat/completions", // OpenAI Compatible
  "/embeddings", // OpenAI Compatible Embeddings
  "/models", // Gemini & OpenAI models
] as const;

const endpointRegexes = targetEndpoints.map((endpoint) => ({
  endpoint,
  regex: new RegExp(`^/(v\\d+[a-z0-9]*)${escapeRegExp(endpoint)}(?<suffix>/.*)?$`),
}));

function isVersionRootPath(basePath: string): boolean {
  const tail = basePath.split("/").filter(Boolean).at(-1)?.toLowerCase();
  if (!tail) {
    return false;
  }

  // 仅接受常见版本 token，避免把 /v1api、/v10models 之类的普通路径误判成版本根。
  return /^(v\d+(?:(?:alpha|beta|preview|internal|rc|ga|stable|dev|canary)\d*)?)$/.test(tail);
}

type PreviewEndpoint = {
  key: string;
  path: string;
};

const previewEndpointsByType: Record<string, PreviewEndpoint[]> = {
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

const fallbackPreviewEndpoints: PreviewEndpoint[] = [
  { key: "claudeMessages", path: "/v1/messages" },
  { key: "codexResponses", path: "/v1/responses" },
  { key: "openaiChatCompletions", path: "/v1/chat/completions" },
];

function splitPathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function endsWithSegments(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) {
    return false;
  }

  const offset = haystack.length - needle.length;
  return needle.every((segment, index) => haystack[offset + index] === segment);
}

/**
 * 构建代理目标 URL，并在以下场景下避免重复拼接：
 *
 * 1. `baseUrl` 已经是完整 endpoint 或 endpoint 根路径
 * 2. `baseUrl` 只停在版本根路径，例如 `/v1`、`/v4`、`/v1beta`
 * 3. `requestUrl` 命中的是 endpoint 子路径，例如 `/v1/messages/count_tokens`
 *
 * @param baseUrl - 基础URL（用户配置的供应商URL）
 *   - 示例 1：`https://api.openai.com` -> 需要拼接
 *   - 示例 2：`https://xxx.com/openai/responses` -> 已包含完整 endpoint
 *   - 示例 3：`https://xxx.com/openai/v1` -> 只包含版本根路径
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

    for (const { endpoint, regex } of endpointRegexes) {
      const endpointMatch = requestPath.match(regex);
      if (!endpointMatch) continue;

      const versionPrefix = endpointMatch[1];
      const requestRoot = `/${versionPrefix}${endpoint}`;
      const suffix = endpointMatch.groups?.suffix ?? "";
      const requestEndpoint = `${requestRoot}${suffix}`;
      const endpointWithSuffix = `${endpoint}${suffix}`;
      const hasFullEndpoint =
        suffix.length > 0 &&
        (basePath.endsWith(requestEndpoint) || basePath.endsWith(endpointWithSuffix));

      if (hasFullEndpoint || basePath.endsWith(endpoint) || basePath.endsWith(requestRoot)) {
        baseUrlObj.pathname = hasFullEndpoint ? basePath : basePath + suffix;
        baseUrlObj.search = requestUrl.search;

        logger.debug("[buildProxyUrl] Detected endpoint root in baseUrl", {
          basePath,
          requestPath,
          endpoint,
          action: hasFullEndpoint ? "reuse_full_endpoint" : "append_suffix",
        });

        return baseUrlObj.toString();
      }

      if (isVersionRootPath(basePath)) {
        baseUrlObj.pathname = `${basePath}${endpoint}${suffix}`;
        baseUrlObj.search = requestUrl.search;

        logger.debug("[buildProxyUrl] Detected version root in baseUrl", {
          basePath,
          requestPath,
          endpoint,
          action: "append_endpoint",
        });

        return baseUrlObj.toString();
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

function matchesEndpointRoot(basePath: string, requestPath: string): boolean {
  // `targetEndpoints` 需要保持前缀互不歧义；否则 preview 过滤会无法判断该保留哪一行。
  for (const { endpoint, regex } of endpointRegexes) {
    const match = requestPath.match(regex);
    if (!match) {
      continue;
    }

    const requestRoot = `/${match[1]}${endpoint}`;
    const suffix = match.groups?.suffix ?? "";
    const requestEndpoint = `${requestRoot}${suffix}`;
    const endpointWithSuffix = `${endpoint}${suffix}`;
    return (
      basePath.endsWith(endpoint) ||
      basePath.endsWith(requestRoot) ||
      (suffix.length > 0 &&
        (basePath.endsWith(requestEndpoint) || basePath.endsWith(endpointWithSuffix)))
    );
  }

  return false;
}

export function getPreviewEndpoints(providerType?: string, baseUrl?: string): PreviewEndpoint[] {
  const endpoints = providerType
    ? previewEndpointsByType[providerType] || []
    : previewEndpointsByType.claude;
  const effectiveEndpoints = endpoints.length > 0 ? endpoints : fallbackPreviewEndpoints;

  if (!baseUrl) {
    return effectiveEndpoints;
  }

  try {
    const basePath = new URL(baseUrl).pathname.replace(/\/$/, "");
    const matchedEndpoints = effectiveEndpoints.filter(({ path }) =>
      matchesEndpointRoot(basePath, path)
    );
    return matchedEndpoints.length > 0 ? matchedEndpoints : effectiveEndpoints;
  } catch {
    return effectiveEndpoints;
  }
}

export function hasDuplicatedEndpointPath(baseUrl: string, requestPath: string): boolean {
  try {
    const basePathSegments = splitPathSegments(new URL(baseUrl).pathname.replace(/\/$/, ""));
    if (basePathSegments.length === 0) {
      return false;
    }

    for (const { endpoint, regex } of endpointRegexes) {
      const match = requestPath.match(regex);
      if (!match) {
        continue;
      }

      const endpointSegments = splitPathSegments(endpoint);
      const suffixSegments = splitPathSegments(match.groups?.suffix ?? "");
      const endpointWithSuffixSegments = [...endpointSegments, ...suffixSegments];
      const versionSegments = [match[1]];
      const requestRootSegments = [match[1], ...endpointSegments];
      const requestPathSegments = [match[1], ...endpointWithSuffixSegments];
      const duplicateCandidates = [
        requestPathSegments,
        endpointWithSuffixSegments,
        requestRootSegments,
        endpointSegments,
        versionSegments,
      ];

      for (const candidateSegments of duplicateCandidates) {
        if (endsWithSegments(basePathSegments, candidateSegments)) {
          const prefixSegments = basePathSegments.slice(0, -candidateSegments.length);
          return duplicateCandidates.some((prefixCandidate) =>
            endsWithSegments(prefixSegments, prefixCandidate)
          );
        }
      }
    }

    return false;
  } catch {
    return false;
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

  // 生成当前供应商类型的端点预览
  for (const { key, path } of getPreviewEndpoints(providerType, baseUrl)) {
    const fakeRequestUrl = new URL(`https://dummy.com${path}`);
    previews[key] = buildProxyUrl(baseUrl, fakeRequestUrl);
  }

  return previews;
}
