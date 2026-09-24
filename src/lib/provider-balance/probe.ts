import "server-only";

import { logger } from "@/lib/logger";
import { createProxyAgentForProvider, fetchWithDispatcher } from "@/lib/proxy-agent";
import type { CurrencyCode } from "@/lib/utils/currency";
import { validateProviderUrlForConnectivity } from "@/lib/validation/provider-url";
import {
  PROVIDER_BALANCE_ERROR_CODES,
  PROVIDER_BALANCE_SOURCES,
  PROVIDER_BALANCE_STATUSES,
  type ProviderBalanceErrorCode,
  type ProviderBalancePatch,
  type ProviderBalanceSnapshot,
  type ProviderBalanceSource,
} from "@/types/provider-balance";
import {
  PROVIDER_BALANCE_ENDPOINTS,
  PROVIDER_BALANCE_MAX_RESPONSE_BYTES,
  PROVIDER_BALANCE_REQUEST_TIMEOUT_MS,
} from "./endpoints";
import {
  hasBalanceData,
  parseChatGptWhamUsage,
  parseDeepSeekBalance,
  parseKimiBalance,
  parseNewApiTokenUsage,
  parseOpenAiBilling,
} from "./parsers";
import { normalizeBalanceBaseUrl, planProviderBalanceSources } from "./planner";

/** 探测所需的供应商字段 */
export interface ProviderBalanceProbeInput {
  id: number;
  url: string;
  key: string;
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;
}

/** 单个端点的请求结果 */
interface EndpointResult {
  json: unknown;
}

/** 端点返回 404/405 表示上游没有实现该协议，换下一个来源继续 */
class EndpointUnavailableError extends Error {}

/** 端点返回了明确的失败状态，不再尝试其他来源 */
class EndpointFailedError extends Error {
  readonly errorCode: ProviderBalanceErrorCode;

  constructor(errorCode: ProviderBalanceErrorCode) {
    super(errorCode);
    this.errorCode = errorCode;
  }
}

function classifyHttpStatus(status: number): ProviderBalanceErrorCode {
  if (status === 401) return PROVIDER_BALANCE_ERROR_CODES.Unauthorized;
  if (status === 403) return PROVIDER_BALANCE_ERROR_CODES.Forbidden;
  if (status === 429) return PROVIDER_BALANCE_ERROR_CODES.RateLimited;
  return PROVIDER_BALANCE_ERROR_CODES.UpstreamError;
}

function classifyFetchError(error: unknown): ProviderBalanceErrorCode {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return PROVIDER_BALANCE_ERROR_CODES.Timeout;
  }
  return PROVIDER_BALANCE_ERROR_CODES.Network;
}

/** 通过供应商自身的代理配置发起一次只读 GET */
async function fetchBalanceJson(
  provider: ProviderBalanceProbeInput,
  url: string
): Promise<EndpointResult> {
  const proxy = createProxyAgentForProvider(
    {
      id: provider.id,
      proxyUrl: provider.proxyUrl,
      proxyFallbackToDirect: provider.proxyFallbackToDirect,
    },
    url
  );

  let response: Response;
  try {
    response = await fetchWithDispatcher(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${provider.key}`,
      },
      signal: AbortSignal.timeout(PROVIDER_BALANCE_REQUEST_TIMEOUT_MS),
      ...(proxy ? { dispatcher: proxy.agent } : {}),
    });
  } catch (error) {
    throw new EndpointFailedError(classifyFetchError(error));
  }

  if (response.status === 404 || response.status === 405) {
    await cancelResponseBody(response);
    throw new EndpointUnavailableError(String(response.status));
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    throw new EndpointFailedError(classifyHttpStatus(response.status));
  }

  const text = await readTextWithLimit(response, PROVIDER_BALANCE_MAX_RESPONSE_BYTES);
  try {
    return { json: JSON.parse(text) as unknown };
  } catch {
    // HTML 登录页或网关错误页会走到这里，说明该路径没有实现余额协议
    throw new EndpointUnavailableError("non-json");
  }
}

/**
 * 丢弃不再读取的响应体。
 *
 * fetchWithDispatcher 直接调用 undici，不会自动消费响应体；非 2xx 分支若直接抛出，
 * 连接会一直被占用到超时为止。
 */
async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/**
 * 读取响应体并限制大小。
 *
 * 超过上限时中断读取并判定该来源不可用，避免上游返回大体积页面时把内存占满。
 */
async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      received += value.byteLength;
      if (received > maxBytes) {
        throw new EndpointUnavailableError("response-too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    void body.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

/** 网关兼容端点前需要从基地址去掉的 API 版本后缀 */
const TRAILING_API_VERSION_PATTERN = /\/(v1|v1beta|v1alpha)$/i;

/** 余额端点在站点根路径下的来源，基地址的子路径与它们无关 */
const ORIGIN_SCOPED_SOURCES: readonly ProviderBalanceSource[] = [
  PROVIDER_BALANCE_SOURCES.DeepSeekBalance,
  PROVIDER_BALANCE_SOURCES.KimiBalance,
  PROVIDER_BALANCE_SOURCES.ChatGptCredits,
];

/**
 * 解析一个余额来源实际使用的基地址。
 *
 * 官方钱包端点挂在站点根路径下，供应商若被配置成 `https://api.deepseek.com/v1`
 * 就不能再拼上 `/v1`，否则会请求到 `/v1/user/balance`。
 * 网关兼容端点保留子路径挂载，只去掉末尾的 API 版本后缀：
 * 端点自身已经写明 `/v1`（OpenAI 计费）或没有版本段（New API 的 `/api/...`）。
 */
export function resolveSourceBaseUrl(baseUrl: string, source: ProviderBalanceSource): string {
  if (ORIGIN_SCOPED_SOURCES.includes(source)) {
    return new URL(baseUrl).origin;
  }
  return baseUrl.replace(TRAILING_API_VERSION_PATTERN, "");
}

function buildUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl}${endpoint}`;
}

/** 生成 OpenAI 计费用量端点的当年查询区间 */
export function buildOpenAiUsageRange(now: Date): { start: string; end: string } {
  const end = now.toISOString().slice(0, 10);
  return { start: `${end.slice(0, 4)}-01-01`, end };
}

async function runSource(
  provider: ProviderBalanceProbeInput,
  baseUrl: string,
  source: ProviderBalanceSource,
  kimiCurrency: CurrencyCode
): Promise<ProviderBalancePatch> {
  const sourceBaseUrl = resolveSourceBaseUrl(baseUrl, source);

  if (source === PROVIDER_BALANCE_SOURCES.NewApiTokenUsage) {
    const result = await fetchBalanceJson(
      provider,
      buildUrl(sourceBaseUrl, PROVIDER_BALANCE_ENDPOINTS.newApiTokenUsage)
    );
    return parseNewApiTokenUsage(result.json);
  }

  if (source === PROVIDER_BALANCE_SOURCES.OpenAiBilling) {
    const subscription = await fetchBalanceJson(
      provider,
      buildUrl(sourceBaseUrl, PROVIDER_BALANCE_ENDPOINTS.openAiBillingSubscription)
    );
    const direct = parseOpenAiBilling(subscription.json, {});
    if (direct.balance !== undefined) return direct;

    const range = buildOpenAiUsageRange(new Date());
    const usageUrl = `${buildUrl(sourceBaseUrl, PROVIDER_BALANCE_ENDPOINTS.openAiBillingUsage)}?start_date=${range.start}&end_date=${range.end}`;
    const usage = await fetchBalanceJson(provider, usageUrl);
    return parseOpenAiBilling(subscription.json, usage.json);
  }

  if (source === PROVIDER_BALANCE_SOURCES.DeepSeekBalance) {
    const result = await fetchBalanceJson(
      provider,
      buildUrl(sourceBaseUrl, PROVIDER_BALANCE_ENDPOINTS.deepSeekBalance)
    );
    return parseDeepSeekBalance(result.json);
  }

  if (source === PROVIDER_BALANCE_SOURCES.ChatGptCredits) {
    const result = await fetchBalanceJson(
      provider,
      buildUrl(sourceBaseUrl, PROVIDER_BALANCE_ENDPOINTS.chatGptWhamUsage)
    );
    return parseChatGptWhamUsage(result.json);
  }

  const result = await fetchBalanceJson(
    provider,
    buildUrl(sourceBaseUrl, PROVIDER_BALANCE_ENDPOINTS.kimiBalance)
  );
  return parseKimiBalance(result.json, kimiCurrency);
}

function buildSnapshot(
  providerId: number,
  source: ProviderBalanceSource | null,
  patch: ProviderBalancePatch
): ProviderBalanceSnapshot {
  return {
    providerId,
    status: PROVIDER_BALANCE_STATUSES.Ok,
    source,
    balance: patch.balance ?? null,
    currency: patch.currency ?? "USD",
    totalGranted: patch.totalGranted ?? null,
    totalUsed: patch.totalUsed ?? null,
    unlimited: patch.unlimited === true,
    expiresAt: patch.expiresAt === undefined ? null : new Date(patch.expiresAt).toISOString(),
    checkedAt: new Date().toISOString(),
    errorCode: null,
  };
}

function buildFailureSnapshot(
  providerId: number,
  status: typeof PROVIDER_BALANCE_STATUSES.Unsupported | typeof PROVIDER_BALANCE_STATUSES.Error,
  errorCode: ProviderBalanceErrorCode | null
): ProviderBalanceSnapshot {
  return {
    providerId,
    status,
    source: null,
    balance: null,
    currency: "USD",
    totalGranted: null,
    totalUsed: null,
    unlimited: false,
    expiresAt: null,
    checkedAt: new Date().toISOString(),
    errorCode,
  };
}

/**
 * 按规划顺序探测一个供应商的余额。
 *
 * 命中第一个返回可展示数据的来源即停止；所有来源都只是缺少实现时判定为不支持；
 * 出现认证失败一类的明确错误时保留该错误码，供界面提示管理员。
 */
export async function probeProviderBalance(
  provider: ProviderBalanceProbeInput
): Promise<ProviderBalanceSnapshot> {
  const urlValidation = validateProviderUrlForConnectivity(provider.url);
  if (!urlValidation.valid) {
    return buildFailureSnapshot(
      provider.id,
      PROVIDER_BALANCE_STATUSES.Error,
      PROVIDER_BALANCE_ERROR_CODES.InvalidUrl
    );
  }

  const plan = planProviderBalanceSources({
    providerUrl: provider.url,
    providerKey: provider.key,
  });
  if (plan.sources.length === 0) {
    return buildFailureSnapshot(provider.id, PROVIDER_BALANCE_STATUSES.Unsupported, null);
  }

  const baseUrl = normalizeBalanceBaseUrl(urlValidation.normalizedUrl);
  let firstError: ProviderBalanceErrorCode | null = null;

  for (const source of plan.sources) {
    try {
      const patch = await runSource(provider, baseUrl, source, plan.kimiCurrency);
      if (hasBalanceData(patch)) {
        return buildSnapshot(provider.id, source, patch);
      }
    } catch (error) {
      if (error instanceof EndpointUnavailableError) continue;
      if (error instanceof EndpointFailedError) {
        firstError ??= error.errorCode;
        continue;
      }
      logger.warn("provider balance probe failed", {
        providerId: provider.id,
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      firstError ??= PROVIDER_BALANCE_ERROR_CODES.Network;
    }
  }

  return firstError
    ? buildFailureSnapshot(provider.id, PROVIDER_BALANCE_STATUSES.Error, firstError)
    : buildFailureSnapshot(provider.id, PROVIDER_BALANCE_STATUSES.Unsupported, null);
}
