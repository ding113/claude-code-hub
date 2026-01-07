import type { Context } from "hono";
import { request as undiciRequest } from "undici";
import { logger } from "@/lib/logger";
import { createProxyAgentForProvider } from "@/lib/proxy-agent";
import { validateApiKeyAndGetUser } from "@/repository/key";
import type {
  AnthropicModelsResponse,
  GeminiModelsResponse,
  OpenAIModelsResponse,
} from "@/types/models";
import type { Provider } from "@/types/provider";
import { extractApiKeyFromHeaders } from "../proxy/auth-guard";
import type { ClientFormat } from "../proxy/format-mapper";
import { ProxyProviderResolver } from "../proxy/provider-selector";

type ResponseFormat = "openai" | "anthropic" | "gemini" | "codex";

export interface FetchedModel {
  id: string;
  displayName?: string;
  createdAt?: string;
}

/** 模型列表请求的默认超时（毫秒） */
const DEFAULT_MODELS_TIMEOUT_MS = 10000;

/**
 * 获取 provider 的请求超时配置
 */
function getProviderTimeout(provider: Provider): number {
  return provider.requestTimeoutNonStreamingMs || DEFAULT_MODELS_TIMEOUT_MS;
}

/**
 * 从请求中提取 API Key（复用 auth-guard 的逻辑）
 */
function extractApiKey(c: Context): string | null {
  return extractApiKeyFromHeaders({
    authorization: c.req.header("authorization"),
    "x-api-key": c.req.header("x-api-key"),
    "x-goog-api-key": c.req.header("x-goog-api-key"),
  });
}

/**
 * 验证请求的 API Key 并返回用户信息
 *
 * @throws {Response} 401 错误响应（未提供凭据、无效 key、用户禁用、用户过期）
 */
async function authenticateRequest(c: Context): Promise<{
  user: { id: number; providerGroup: string | null; isEnabled: boolean; expiresAt?: Date | null };
  key: { providerGroup: string | null; name: string };
}> {
  const apiKey = extractApiKey(c);
  if (!apiKey) {
    throw c.json({ error: { message: "未提供认证凭据", type: "authentication_error" } }, 401);
  }

  const authResult = await validateApiKeyAndGetUser(apiKey);
  if (!authResult) {
    throw c.json({ error: { message: "API 密钥无效", type: "invalid_api_key" } }, 401);
  }

  const { user, key } = authResult;

  if (!user.isEnabled) {
    throw c.json({ error: { message: "用户账户已被禁用", type: "user_disabled" } }, 401);
  }

  if (user.expiresAt && user.expiresAt.getTime() <= Date.now()) {
    throw c.json({ error: { message: "用户账户已过期", type: "user_expired" } }, 401);
  }

  return { user, key };
}

/**
 * 检测响应格式
 */
function detectResponseFormat(c: Context): ResponseFormat {
  if (c.req.header("anthropic-version")) {
    return "anthropic";
  }

  if (c.req.header("x-goog-api-key") || c.req.path.includes("/v1beta/")) {
    return "gemini";
  }

  return "openai";
}

/**
 * 解析 /v1/models 的客户端格式覆盖（可选）
 *
 * 用途：当使用 /v1/responses 时，可通过 header 或 query 明确告知只返回 codex 供应商模型。
 */
function detectClientFormatOverride(c: Context): ClientFormat | null {
  const headerOverride =
    c.req.header("x-openai-api-type") ||
    c.req.header("x-cch-api-type") ||
    c.req.header("openai-beta");
  const queryOverride = c.req.query("api_type") || c.req.query("apiType") || c.req.query("format");

  const raw = (queryOverride || headerOverride || "").toString().trim().toLowerCase();
  if (!raw) return null;

  if (raw === "response" || raw === "responses" || raw === "codex") return "response";
  if (raw === "openai" || raw === "chat") return "openai";
  if (raw === "claude" || raw === "anthropic") return "claude";
  if (raw === "gemini") return "gemini";
  if (raw === "gemini-cli" || raw === "geminicli") return "gemini-cli";

  return null;
}

/**
 * 将响应格式映射到客户端格式（用于 provider 选择）
 */
function mapResponseFormatToClientFormat(format: ResponseFormat): ClientFormat {
  switch (format) {
    case "anthropic":
      return "claude";
    case "gemini":
      return "gemini";
    default:
      return "openai";
  }
}

/**
 * 模型所有者类型
 */
export type ModelOwner = "anthropic" | "openai" | "google" | "deepseek" | "alibaba" | "unknown";

/**
 * 根据模型 ID 推断所有者
 */
export function inferOwner(modelId: string): ModelOwner {
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3"))
    return "openai";
  if (modelId.startsWith("gemini-")) return "google";
  if (modelId.startsWith("deepseek")) return "deepseek";
  if (modelId.startsWith("qwen")) return "alibaba";
  return "unknown";
}

/** 上游 API 请求配置 */
interface UpstreamFetchConfig {
  buildUrl: (baseUrl: string, provider: Provider) => string;
  buildHeaders: (provider: Provider) => Record<string, string>;
  parseResponse: (body: unknown) => FetchedModel[];
}

/** 各 Provider 类型的请求配置 */
const UPSTREAM_CONFIGS: Record<string, UpstreamFetchConfig> = {
  claude: {
    buildUrl: (baseUrl) => `${baseUrl}/v1/models`,
    buildHeaders: (p) => ({ "x-api-key": p.key, "anthropic-version": "2023-06-01" }),
    parseResponse: (body) => {
      const data =
        (body as { data?: Array<{ id: string; display_name?: string; created_at?: string }> })
          .data || [];
      return data.map((m) => ({ id: m.id, displayName: m.display_name, createdAt: m.created_at }));
    },
  },
  openai: {
    buildUrl: (baseUrl) => `${baseUrl}/v1/models`,
    buildHeaders: (p) => ({ Authorization: `Bearer ${p.key}` }),
    parseResponse: (body) => {
      const data = (body as { data?: Array<{ id: string }> }).data || [];
      return data.map((m) => ({ id: m.id }));
    },
  },
  gemini: {
    buildUrl: (baseUrl) => {
      const prefix = baseUrl.endsWith("/v1beta") ? baseUrl : `${baseUrl}/v1beta`;
      return `${prefix}/models`;
    },
    buildHeaders: (p) => ({ "x-goog-api-key": p.key }),
    parseResponse: (body) => {
      const models =
        (body as { models?: Array<{ name: string; displayName?: string }> }).models || [];
      return models.map((m) => ({
        id: m.name.replace(/^models\//, ""),
        displayName: m.displayName,
      }));
    },
  },
};

/**
 * 通用模型列表获取函数
 */
async function fetchModelsWithConfig(
  provider: Provider,
  config: UpstreamFetchConfig
): Promise<FetchedModel[]> {
  const baseUrl = provider.url.replace(/\/$/, "");
  const url = config.buildUrl(baseUrl, provider);
  const headers = config.buildHeaders(provider);
  const proxyConfig = createProxyAgentForProvider(provider, url);
  const timeout = getProviderTimeout(provider);

  const safeUrl = url.replace(/[?&]key=[^&]+/, "[key=REDACTED]");
  logger.debug(`[AvailableModels] Fetching models from ${provider.name}: ${safeUrl}`);

  const response = await undiciRequest(url, {
    method: "GET",
    headers,
    dispatcher: proxyConfig?.agent,
    headersTimeout: timeout,
    bodyTimeout: timeout,
  });

  if (response.statusCode !== 200) {
    const errorBody = await response.body.text();
    logger.debug(
      `[AvailableModels] ${provider.name} returned ${response.statusCode}: ${errorBody}`
    );
    throw new Error(`${provider.name} API returned ${response.statusCode}`);
  }

  const body = await response.body.json();
  const models = config.parseResponse(body);

  logger.debug(`[AvailableModels] ${provider.name} returned ${models.length} models`);
  return models;
}

/**
 * 根据 Provider 类型获取模型列表
 *
 * 优先级：
 * 1. 如果 provider 配置了 allowedModels，直接使用（无需查上游）
 * 2. 否则根据 providerType 查询上游
 */
async function fetchModelsFromProvider(provider: Provider): Promise<FetchedModel[]> {
  if (provider.allowedModels && provider.allowedModels.length > 0) {
    logger.debug(`[AvailableModels] Using configured allowedModels for ${provider.name}`, {
      modelCount: provider.allowedModels.length,
    });
    return provider.allowedModels.map((id) => ({ id }));
  }

  const configMap: Record<Provider["providerType"], UpstreamFetchConfig> = {
    claude: UPSTREAM_CONFIGS.claude,
    "claude-auth": UPSTREAM_CONFIGS.claude,
    "openai-compatible": UPSTREAM_CONFIGS.openai,
    codex: UPSTREAM_CONFIGS.openai,
    gemini: UPSTREAM_CONFIGS.gemini,
    "gemini-cli": UPSTREAM_CONFIGS.gemini,
  };

  const config = configMap[provider.providerType];
  if (!config) {
    logger.warn(`[AvailableModels] Unknown provider type: ${provider.providerType}`);
    return [];
  }

  try {
    return await fetchModelsWithConfig(provider, config);
  } catch (error) {
    logger.warn(`[AvailableModels] Failed to fetch from ${provider.name}:`, error);
    return [];
  }
}

/**
 * 根据客户端格式获取需要决策的 providerType 列表
 */
export function getProviderTypesForFormat(clientFormat: ClientFormat): Provider["providerType"][] {
  switch (clientFormat) {
    case "claude":
      return ["claude", "claude-auth"];
    case "openai":
      // openai 格式需要对 codex 和 openai-compatible 分别决策
      return ["codex", "openai-compatible"];
    case "gemini":
    case "gemini-cli":
      return ["gemini", "gemini-cli"];
    case "response":
      return ["codex"];
    default: {
      const _exhaustiveCheck: never = clientFormat;
      throw new Error(`Unknown client format: ${_exhaustiveCheck}`);
    }
  }
}

/**
 * 获取用户可用的模型列表
 *
 * 决策流程：
 * 1. 根据 clientFormat 确定需要决策的 providerType 列表
 * 2. 对每种 providerType 独立进行完整决策（分组过滤 → 健康检查 → 优先级 → 加权随机）
 * 3. 每种类型选出 1 个最优 provider
 * 4. 聚合这些 provider 的模型列表（去重）
 */
async function getAvailableModels(
  authState: {
    user: { id: number; providerGroup: string | null };
    key: { providerGroup: string | null };
  },
  clientFormat: ClientFormat
): Promise<{ models: FetchedModel[]; providerName?: string }> {
  const providerTypes = getProviderTypesForFormat(clientFormat);
  return getAvailableModelsByProviderTypes(authState, providerTypes);
}

/**
 * 格式化为 OpenAI 响应
 */
export function formatOpenAIResponse(models: FetchedModel[]): OpenAIModelsResponse {
  const now = Math.floor(Date.now() / 1000);
  const data = models.map((m) => ({
    id: m.id,
    object: "model" as const,
    created: now,
    owned_by: inferOwner(m.id),
  }));

  return { object: "list" as const, data };
}

/**
 * 格式化为 Anthropic 响应
 */
export function formatAnthropicResponse(models: FetchedModel[]): AnthropicModelsResponse {
  const now = new Date().toISOString();
  const data = models.map((m) => ({
    id: m.id,
    type: "model" as const,
    display_name: m.displayName || m.id,
    created_at: m.createdAt || now,
  }));

  return { data, has_more: false };
}

/**
 * 格式化为 Gemini 响应
 */
export function formatGeminiResponse(models: FetchedModel[]): GeminiModelsResponse {
  const geminiModels = models.map((m) => ({
    name: `models/${m.id}`,
    displayName: m.displayName || m.id,
    supportedGenerationMethods: ["generateContent"],
  }));

  return { models: geminiModels };
}

/**
 * 根据指定的 providerTypes 获取模型列表
 */
async function getAvailableModelsByProviderTypes(
  authState: {
    user: { id: number; providerGroup: string | null };
    key: { providerGroup: string | null };
  },
  providerTypes: Provider["providerType"][]
): Promise<{ models: FetchedModel[]; providerName?: string }> {
  const selectedProviders: Provider[] = [];
  for (const providerType of providerTypes) {
    const { provider, context } = await ProxyProviderResolver.selectProviderByType(
      authState,
      providerType
    );
    if (provider) {
      selectedProviders.push(provider);
      logger.debug("[AvailableModels] Provider selected for type", {
        providerType,
        providerId: provider.id,
        providerName: provider.name,
        context,
      });
    } else {
      logger.debug("[AvailableModels] No provider available for type", {
        providerType,
        context,
      });
    }
  }

  if (selectedProviders.length === 0) {
    logger.warn("[AvailableModels] No available provider", {
      userId: authState.user.id,
      triedTypes: providerTypes,
    });
    return { models: [] };
  }

  logger.debug("[AvailableModels] Selected providers for models list", {
    providerTypes,
    providerCount: selectedProviders.length,
    providers: selectedProviders.map((p) => ({ id: p.id, name: p.name, type: p.providerType })),
  });

  const allModels: FetchedModel[] = [];
  const seenIds = new Set<string>();

  const fetchResults = await Promise.all(
    selectedProviders.map((provider) => fetchModelsFromProvider(provider))
  );

  for (const models of fetchResults) {
    for (const model of models) {
      if (!seenIds.has(model.id)) {
        seenIds.add(model.id);
        allModels.push(model);
      }
    }
  }

  logger.info("[AvailableModels] Aggregated models", {
    userId: authState.user.id,
    modelCount: allModels.length,
    providerCount: selectedProviders.length,
  });

  return {
    models: allModels.sort((a, b) => a.id.localeCompare(b.id)),
    providerName: selectedProviders.map((p) => p.name).join(", "),
  };
}

/**
 * 创建带固定 providerTypes 的模型列表处理函数
 */
function createFixedProviderTypesModelsHandler(
  providerTypes: Provider["providerType"][],
  endpointName: string
) {
  return async (c: Context): Promise<Response> => {
    try {
      const { user, key } = await authenticateRequest(c);

      logger.debug("[AvailableModels] Fixed providerTypes request", {
        userId: user.id,
        endpointName,
        providerTypes,
      });

      const { models, providerName } = await getAvailableModelsByProviderTypes(
        { user, key },
        providerTypes
      );

      logger.debug("[AvailableModels] Response ready", {
        userId: user.id,
        providerName,
        modelCount: models.length,
      });

      return c.json(formatOpenAIResponse(models));
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  };
}

/**
 * 处理 /v1/responses/models 请求（只返回 codex 类型）
 */
export const handleCodexModels = createFixedProviderTypesModelsHandler(
  ["codex"],
  "responses/models"
);

/**
 * 处理 /v1/chat/completions/models 或 /v1/chat/models 请求（只返回 openai-compatible 类型）
 */
export const handleOpenAICompatibleModels = createFixedProviderTypesModelsHandler(
  ["openai-compatible"],
  "chat/models"
);

/**
 * 处理可用模型列表请求
 */
export async function handleAvailableModels(c: Context): Promise<Response> {
  try {
    const { user, key } = await authenticateRequest(c);

    const responseFormat = detectResponseFormat(c);
    const clientFormatOverride = detectClientFormatOverride(c);
    const clientFormat = clientFormatOverride || mapResponseFormatToClientFormat(responseFormat);

    logger.debug("[AvailableModels] Request received", {
      userId: user.id,
      responseFormat,
      clientFormat,
      clientFormatOverride: clientFormatOverride || undefined,
    });

    const { models, providerName } = await getAvailableModels({ user, key }, clientFormat);

    logger.debug("[AvailableModels] Response ready", {
      userId: user.id,
      providerName,
      modelCount: models.length,
    });

    switch (responseFormat) {
      case "anthropic":
        return c.json(formatAnthropicResponse(models));
      case "gemini":
        return c.json(formatGeminiResponse(models));
      default:
        return c.json(formatOpenAIResponse(models));
    }
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
