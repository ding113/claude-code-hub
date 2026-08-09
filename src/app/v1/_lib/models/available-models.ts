import type { Context } from "hono";
import { request as undiciRequest } from "undici";
import {
  matchesAllowedModelRules,
  normalizeAllowedModelRules,
} from "@/lib/allowed-model-rules";
import { logger } from "@/lib/logger";
import { createProxyAgentForProvider } from "@/lib/proxy-agent";
import { ERROR_CODES, getErrorMessageServer } from "@/lib/utils/error-messages";
import { isProviderActiveNow } from "@/lib/utils/provider-schedule";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import { resolveApiKeyAuthOutcome } from "@/repository/key";
import { findAllProviders } from "@/repository/provider";
import type {
  AnthropicModelsResponse,
  GeminiModelsResponse,
  OpenAIModelsResponse,
} from "@/types/models";
import type { Provider } from "@/types/provider";
import { extractApiKeyFromHeaders } from "../proxy/auth-guard";
import type { ClientFormat } from "../proxy/format-mapper";
import { checkProviderGroupMatch } from "../proxy/provider-selector";

type ResponseFormat = "openai" | "anthropic" | "gemini" | "codex";

export interface FetchedModel {
  id: string;
  displayName?: string;
  createdAt?: string;
  /** CCH 调度分组；OpenAI 模型列表通过 owned_by 暴露给客户端。 */
  groupTag?: string | null;
}

/** 模型列表请求的默认超时（毫秒） */
const DEFAULT_MODELS_TIMEOUT_MS = 3000;
const MAX_MODELS_TIMEOUT_MS = 3000;

/**
 * 模型目录短缓存：客户端通常会在启动/切换模型时重复请求，
 * 不应每次都重新 fan-out 到所有上游。缓存按用户和 provider 分组隔离，
 * 避免不同权限的模型目录互相复用；过期后下一次请求重新拉取。
 */
const MODELS_LIST_CACHE_TTL_MS = 30_000;

type AvailableModelsResult = { models: FetchedModel[]; providerName?: string };
type AvailableModelsCacheEntry = { data: AvailableModelsResult; timestamp: number };

const availableModelsCache = new Map<string, AvailableModelsCacheEntry>();
const inFlightAvailableModels = new Map<string, Promise<AvailableModelsResult>>();

/**
 * 获取 provider 的请求超时配置
 */
function getProviderTimeout(provider: Provider): number {
  const configured = Number(provider.requestTimeoutNonStreamingMs);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MODELS_TIMEOUT_MS;
  }
  return Math.min(configured, MAX_MODELS_TIMEOUT_MS);
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

  const outcome = await resolveApiKeyAuthOutcome(apiKey);
  if (!outcome.ok) {
    // Exhaustive switch: see auth-guard.ts for rationale. Adding a new
    // ApiKeyAuthFailureReason will produce a TypeScript error on the
    // exhaustiveness fallthrough until this branch is handled explicitly.
    const { getLocale } = await import("next-intl/server");
    const locale = await getLocale();
    switch (outcome.reason) {
      case "key_disabled":
        throw c.json(
          {
            error: {
              message: await getErrorMessageServer(locale, ERROR_CODES.PROXY_API_KEY_DISABLED),
              type: "key_disabled",
            },
          },
          401
        );
      case "key_expired":
        throw c.json(
          {
            error: {
              message: await getErrorMessageServer(locale, ERROR_CODES.PROXY_API_KEY_EXPIRED),
              type: "key_expired",
            },
          },
          401
        );
      case "not_found":
        throw c.json(
          {
            error: {
              message: await getErrorMessageServer(locale, ERROR_CODES.PROXY_INVALID_API_KEY),
              type: "invalid_api_key",
            },
          },
          401
        );
      default: {
        const _exhaustive: never = outcome.reason;
        throw new Error(`Unhandled auth outcome reason: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  const { user, key } = outcome;

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

/**
 * 拼接上游模型列表路径，避免 provider.url 已经包含 /v1 时生成 /v1/v1/models。
 */
function joinModelsPath(baseUrl: string, path: "/v1/models" | "/models"): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (path === "/v1/models" && /\/v1$/i.test(base)) {
    return `${base}/models`;
  }
  return `${base}${path}`;
}

/** 各 Provider 类型的请求配置 */
const UPSTREAM_CONFIGS: Record<string, UpstreamFetchConfig> = {
  claude: {
    buildUrl: (baseUrl) => joinModelsPath(baseUrl, "/v1/models"),
    buildHeaders: (p) => ({ "x-api-key": p.key, "anthropic-version": "2023-06-01" }),
    parseResponse: (body) => {
      const data =
        (body as { data?: Array<{ id: string; display_name?: string; created_at?: string }> })
          .data || [];
      return data.map((m) => ({ id: m.id, displayName: m.display_name, createdAt: m.created_at }));
    },
  },
  openai: {
    buildUrl: (baseUrl) => joinModelsPath(baseUrl, "/v1/models"),
    buildHeaders: (p) => ({ Authorization: `Bearer ${p.key}` }),
    parseResponse: (body) => {
      const data = (body as { data?: Array<{ id: string }> }).data || [];
      return data.map((m) => ({ id: m.id }));
    },
  },
  gemini: {
    buildUrl: (baseUrl) => {
      const prefix = /\/v1beta$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1beta`;
      return joinModelsPath(prefix, "/models");
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

function attachProviderGroup(provider: Provider, models: FetchedModel[]): FetchedModel[] {
  const groupTag = provider.groupTag?.trim() || null;
  return models.map((model) => ({ ...model, groupTag }));
}

function getConfiguredExactModels(
  provider: Provider,
  rules: ReturnType<typeof normalizeAllowedModelRules>
): FetchedModel[] {
  return (rules ?? [])
    .filter((rule) => rule.matchType === "exact")
    .map((rule) => ({ id: rule.pattern }))
    .map((model) => ({ ...model, groupTag: provider.groupTag?.trim() || null }));
}

/**
 * 根据 Provider 类型获取模型列表
 *
 * 优先从上游获取，再按 provider.allowedModels 过滤；纯 exact allowlist
 * 可以直接作为上游失败时的兜底，避免单个上游短暂异常导致模型目录消失。
 *
 * Exported for admin aggregation (provider-group model picker).
 */
export async function fetchModelsFromProvider(provider: Provider): Promise<FetchedModel[]> {
  const rules = normalizeAllowedModelRules(provider.allowedModels);
  const exactModels = getConfiguredExactModels(provider, rules);

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
    const upstreamModels = await fetchModelsWithConfig(provider, config);
    const filteredModels = rules?.length
      ? upstreamModels.filter((model) => matchesAllowedModelRules(model.id, rules))
      : upstreamModels;
    const presentIds = new Set(filteredModels.map((model) => model.id));
    const exactFallbackModels = exactModels.filter((model) => !presentIds.has(model.id));
    return attachProviderGroup(provider, [...filteredModels, ...exactFallbackModels]);
  } catch (error) {
    logger.warn(`[AvailableModels] Failed to fetch from ${provider.name}:`, error);
    return exactModels;
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
      // 统一模型目录聚合所有可通过 CCH 路由的 provider 类型。
      return ["claude", "claude-auth", "codex", "openai-compatible", "gemini", "gemini-cli"];
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
 * 1. 根据 clientFormat 确定需要扫描的 providerType 列表
 * 2. 过滤用户可访问且当前启用的 provider
 * 3. 并发从每个匹配 provider 的上游模型接口获取列表
 * 4. 合并去重，并保留 provider 的 CCH 分组
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
    owned_by: m.groupTag?.trim() || inferOwner(m.id),
  }));

  return { object: "list" as const, data };
}

/**
 * 将时间戳归一化为 Anthropic API 规范格式(秒级精度,不含毫秒)。
 *
 * 官方 Anthropic /v1/models 的 created_at 形如 `2026-05-29T09:22:44Z`,不含毫秒;
 * 而 Date.toISOString() 始终输出 `.SSSZ`,部分上游也会带毫秒,因此统一去除。
 * 无法解析的上游时间戳原样返回,避免抛错。
 */
function normalizeAnthropicTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * 格式化为 Anthropic 响应
 */
export function formatAnthropicResponse(models: FetchedModel[]): AnthropicModelsResponse {
  const now = normalizeAnthropicTimestamp(new Date().toISOString());
  const data = models.map((m) => ({
    id: m.id,
    type: "model" as const,
    display_name: m.displayName || m.id,
    created_at: m.createdAt ? normalizeAnthropicTimestamp(m.createdAt) : now,
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

const MODEL_GROUP_PRIORITY = ["claude", "codex", "grok", "image"];

function modelGroupRank(groupTag: string | null | undefined): number {
  const normalized = groupTag?.trim().toLowerCase() || "";
  const managedIndex = MODEL_GROUP_PRIORITY.indexOf(normalized);
  if (managedIndex >= 0) return managedIndex;
  if (!normalized || normalized === "other" || normalized === "default") return 100;
  return 50;
}

function shouldPreferModel(candidate: FetchedModel, current: FetchedModel): boolean {
  return modelGroupRank(candidate.groupTag) < modelGroupRank(current.groupTag);
}

/**
 * 根据指定的 providerTypes 获取模型列表
 *
 * 与代理请求不同，模型列表需要展示所有已启用 provider 的模型（不做健康检查），
 * 因为模型列表的职责是"告诉用户有哪些模型可用"，实时可用性由代理请求时的守卫链处理。
 *
 * Fix: #956 — 之前复用 selectProviderByType() 导致每种类型只选 1 个 provider
 */
async function fetchAvailableModelsByProviderTypes(
  authState: {
    user: { id: number; providerGroup: string | null };
    key: { providerGroup: string | null };
  },
  providerTypes: Provider["providerType"][]
): Promise<AvailableModelsResult> {
  const allProviders = await findAllProviders();

  // 过滤出所有匹配的供应商
  const effectiveGroup = authState.key.providerGroup || authState.user.providerGroup || null;
  const providerTypeSet = new Set(providerTypes);
  const systemTimezone = await resolveSystemTimezone();

  const matchedProviders = allProviders.filter(
    (p) =>
      p.isEnabled &&
      providerTypeSet.has(p.providerType) &&
      isProviderActiveNow(p.activeTimeStart, p.activeTimeEnd, systemTimezone) &&
      (!effectiveGroup || checkProviderGroupMatch(p.groupTag, effectiveGroup))
  );

  if (matchedProviders.length === 0) {
    logger.warn("[AvailableModels] No available provider", {
      userId: authState.user.id,
      triedTypes: providerTypes,
    });
    return { models: [] };
  }

  logger.debug("[AvailableModels] Matched providers for models list", {
    providerTypes,
    providerCount: matchedProviders.length,
    providers: matchedProviders.map((p) => ({ id: p.id, name: p.name, type: p.providerType })),
  });

  const modelsById = new Map<string, FetchedModel>();

  const fetchResults = await Promise.all(
    matchedProviders.map((provider) => fetchModelsFromProvider(provider))
  );

  for (const models of fetchResults) {
    for (const model of models) {
      const current = modelsById.get(model.id);
      if (!current || shouldPreferModel(model, current)) {
        modelsById.set(model.id, model);
      }
    }
  }

  const allModels = Array.from(modelsById.values());

  logger.info("[AvailableModels] Aggregated models", {
    userId: authState.user.id,
    modelCount: allModels.length,
    providerCount: matchedProviders.length,
  });

  return {
    models: allModels.sort((a, b) => a.id.localeCompare(b.id)),
    providerName: matchedProviders.map((p) => p.name).join(", "),
  };
}

function getAvailableModelsCacheKey(
  authState: {
    user: { id: number; providerGroup: string | null };
    key: { providerGroup: string | null };
  },
  providerTypes: Provider["providerType"][]
): string {
  const effectiveGroup = authState.key.providerGroup || authState.user.providerGroup || null;
  return JSON.stringify({
    userId: authState.user.id,
    providerGroup: effectiveGroup,
    providerTypes: Array.from(new Set(providerTypes)).sort(),
  });
}

/**
 * 带短 TTL 和并发合并的模型目录读取。
 * 同一个权限范围在缓存有效期内不重复请求上游；缓存未命中时，
 * 同时到达的请求共享同一个 fan-out Promise。
 */
async function getAvailableModelsByProviderTypes(
  authState: {
    user: { id: number; providerGroup: string | null };
    key: { providerGroup: string | null };
  },
  providerTypes: Provider["providerType"][]
): Promise<AvailableModelsResult> {
  const cacheKey = getAvailableModelsCacheKey(authState, providerTypes);
  const cached = availableModelsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < MODELS_LIST_CACHE_TTL_MS) {
    return cached.data;
  }

  const inFlight = inFlightAvailableModels.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = fetchAvailableModelsByProviderTypes(authState, providerTypes)
    .then((data) => {
      availableModelsCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    })
    .finally(() => {
      inFlightAvailableModels.delete(cacheKey);
    });

  inFlightAvailableModels.set(cacheKey, request);
  return request;
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
