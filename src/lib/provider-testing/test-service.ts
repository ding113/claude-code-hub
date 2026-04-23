/**
 * Provider Testing Service
 *
 * 统一执行模板探测，并在协议不匹配时自动切换到同套件里的下一个模板。
 */

import { createProxyAgentForProvider, type ProviderProxyConfig } from "@/lib/proxy-agent";
import { parseResponse } from "./parsers";
import {
  getExecutionPresetCandidates,
  getPreset,
  getPresetPayload,
  type PresetConfig,
} from "./presets";
import type {
  ParsedResponse,
  ProviderTestConfig,
  ProviderTestResult,
  TestStatus,
  TestSubStatus,
  ValidationDetails,
} from "./types";
import { TEST_DEFAULTS } from "./types";
import {
  DEFAULT_SUCCESS_CONTAINS,
  getTestBody,
  getTestHeaders,
  getTestUrl,
  getVersionlessOpenAiFallbackUrl,
} from "./utils/test-prompts";
import { evaluateContentValidation } from "./validators/content-validator";
import { classifyHttpStatus } from "./validators/http-validator";

interface AttemptPlan {
  preset?: PresetConfig;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  model: string | undefined;
  successContains: string;
  url: string;
}

interface VersionlessFallbackState {
  hasRetriedVersionlessUrl: boolean;
  preferVersionlessUrl: boolean;
}

const RETRYABLE_HTTP_STATUS_CODES = [400, 404, 405, 415, 422] as const;
const INVALID_OPENAI_URL_MARKER = /Invalid URL \(POST \/v1\/.+\)/i;

function buildAttemptPlans(config: ProviderTestConfig): AttemptPlan[] {
  const customPayload = config.customPayload?.trim();
  if (customPayload) {
    try {
      const parsed = JSON.parse(customPayload) as Record<string, unknown>;
      return [
        {
          body: parsed,
          headers: {
            ...getTestHeaders(config.providerType, config.apiKey, config.providerUrl),
            ...(config.customHeaders || {}),
          },
          model: config.model,
          successContains: config.successContains ?? DEFAULT_SUCCESS_CONTAINS[config.providerType],
          url: getTestUrl(config.providerUrl, config.providerType, config.model),
        },
      ];
    } catch {
      throw new Error("Invalid custom payload JSON");
    }
  }

  let presets: PresetConfig[];
  if (config.preset) {
    const preset = getPreset(config.preset);
    if (!preset) {
      throw new Error(`Preset not found: ${config.preset}`);
    }
    presets = [preset];
  } else {
    presets = getExecutionPresetCandidates({
      providerType: config.providerType,
      providerUrl: config.providerUrl,
      model: config.model,
    });
  }

  if (presets.length === 0) {
    return [
      {
        body: getTestBody(config.providerType, config.model),
        headers: {
          ...getTestHeaders(config.providerType, config.apiKey, config.providerUrl),
          ...(config.customHeaders || {}),
        },
        model: config.model,
        successContains: config.successContains ?? DEFAULT_SUCCESS_CONTAINS[config.providerType],
        url: getTestUrl(config.providerUrl, config.providerType, config.model),
      },
    ];
  }

  return presets.map((preset) => {
    const effectiveModel = config.model ?? preset.defaultModel;
    return {
      preset,
      body: getPresetPayload(preset.id, effectiveModel),
      headers: {
        ...getTestHeaders(config.providerType, config.apiKey, config.providerUrl, {
          userAgent: preset.userAgent,
          extraHeaders: preset.extraHeaders,
        }),
        ...(config.customHeaders || {}),
      },
      model: effectiveModel,
      successContains:
        config.successContains ??
        preset.defaultSuccessContains ??
        DEFAULT_SUCCESS_CONTAINS[config.providerType],
      url: getTestUrl(config.providerUrl, config.providerType, effectiveModel, preset.path),
    };
  });
}

function shouldRetryWithNextTemplate(result: ProviderTestResult): boolean {
  if (result.status !== "red") {
    return false;
  }

  if (result.httpStatusCode && isRetryableHttpStatus(result.httpStatusCode)) {
    return true;
  }

  return ["client_error", "invalid_request", "content_mismatch"].includes(result.subStatus);
}

function isRetryableHttpStatus(responseStatus: number): boolean {
  return RETRYABLE_HTTP_STATUS_CODES.includes(
    responseStatus as (typeof RETRYABLE_HTTP_STATUS_CODES)[number]
  );
}

function isOpenAiStyleProvider(providerType: ProviderTestConfig["providerType"]): boolean {
  return providerType === "codex" || providerType === "openai-compatible";
}

function buildValidationDetails(
  responseStatus: number | undefined,
  latencyMs: number,
  slowThresholdMs: number,
  contentPassed: boolean,
  successContains: string
): ValidationDetails {
  return {
    httpPassed:
      responseStatus !== undefined ? responseStatus >= 200 && responseStatus < 300 : false,
    httpStatusCode: responseStatus,
    latencyPassed: responseStatus !== undefined && latencyMs <= slowThresholdMs,
    latencyMs,
    contentPassed,
    contentTarget: successContains,
  };
}

function resolveVersionlessOpenAiFallbackUrl(
  config: ProviderTestConfig,
  requestUrl: string,
  responseStatus: number,
  responseBody: string,
  fallbackState: VersionlessFallbackState
): string | null {
  if (fallbackState.hasRetriedVersionlessUrl) {
    return null;
  }

  if (!isOpenAiStyleProvider(config.providerType)) {
    return null;
  }

  if (responseStatus !== 400 || !INVALID_OPENAI_URL_MARKER.test(responseBody)) {
    return null;
  }

  return getVersionlessOpenAiFallbackUrl(requestUrl);
}

async function runSingleAttempt(
  config: ProviderTestConfig,
  plan: AttemptPlan,
  timeoutMs: number,
  slowThresholdMs: number,
  fallbackState: VersionlessFallbackState
): Promise<ProviderTestResult> {
  const startTime = Date.now();
  let attemptStartTime = startTime;
  let firstByteMs: number | undefined;
  let usedProxy = false;
  let requestUrl =
    fallbackState.preferVersionlessUrl && isOpenAiStyleProvider(config.providerType)
      ? (getVersionlessOpenAiFallbackUrl(plan.url) ?? plan.url)
      : plan.url;

  try {
    let dispatcher: unknown | undefined;
    if (config.proxyUrl) {
      const tempProvider: ProviderProxyConfig = {
        id: -1,
        name: "test-provider",
        proxyUrl: config.proxyUrl,
        proxyFallbackToDirect: config.proxyFallbackToDirect ?? false,
      };
      const proxyConfig = createProxyAgentForProvider(tempProvider, plan.url);
      if (proxyConfig) {
        dispatcher = proxyConfig.agent;
        usedProxy = true;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchOptions: RequestInit & { dispatcher?: unknown } = {
        method: "POST",
        headers: plan.headers,
        body: JSON.stringify(plan.body),
        signal: controller.signal,
      };
      if (dispatcher) {
        fetchOptions.dispatcher = dispatcher;
      }

      // provider testing 只在这条受控链路里做一次 versionless fallback，避免影响 runtime proxy 行为。
      while (true) {
        attemptStartTime = Date.now();
        firstByteMs = undefined;
        const response = await fetch(requestUrl, fetchOptions);
        firstByteMs = Date.now() - attemptStartTime;

        const responseBody = await response.text();
        const fallbackUrl = resolveVersionlessOpenAiFallbackUrl(
          config,
          requestUrl,
          response.status,
          responseBody,
          fallbackState
        );
        if (fallbackUrl && fallbackUrl !== requestUrl) {
          requestUrl = fallbackUrl;
          fallbackState.hasRetriedVersionlessUrl = true;
          fallbackState.preferVersionlessUrl = true;
          continue;
        }

        const latencyMs = Date.now() - startTime;
        const contentType = response.headers.get("content-type") || undefined;

        // best-effort 解析：即使解析失败也保留 HTTP 状态信息，避免 4xx/5xx 被误判为 network_error
        let parsed: ParsedResponse;
        try {
          parsed = parseResponse(config.providerType, responseBody, contentType);
        } catch {
          parsed = {
            content: responseBody,
            model: undefined,
            usage: undefined,
            isStreaming: false,
          };
        }

        const validationInput = parsed.content ?? responseBody;
        const httpResult = classifyHttpStatus(response.status, latencyMs, slowThresholdMs);
        const contentResult = evaluateContentValidation(
          httpResult.status,
          httpResult.subStatus,
          validationInput,
          plan.successContains
        );

        return {
          success: contentResult.status !== "red",
          status: contentResult.status,
          subStatus: contentResult.subStatus,
          latencyMs,
          firstByteMs,
          httpStatusCode: response.status,
          httpStatusText: response.statusText,
          model: parsed.model,
          content: parsed.content ?? responseBody,
          rawResponse: responseBody,
          requestUrl,
          usage: parsed.usage,
          streamInfo: parsed.isStreaming
            ? {
                isStreaming: true,
                chunksReceived: parsed.chunksReceived,
              }
            : undefined,
          testedAt: new Date(),
          validationDetails: buildValidationDetails(
            response.status,
            latencyMs,
            slowThresholdMs,
            contentResult.contentPassed,
            plan.successContains
          ),
          usedProxy,
        };
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const { subStatus, errorType, errorMessage } = classifyError(error);

    return {
      success: false,
      status: "red",
      subStatus,
      latencyMs,
      firstByteMs,
      errorMessage,
      errorType,
      rawError: error,
      requestUrl,
      testedAt: new Date(),
      validationDetails: buildValidationDetails(
        undefined,
        latencyMs,
        slowThresholdMs,
        false,
        plan.successContains
      ),
      usedProxy,
    };
  }
}

export async function executeProviderTest(config: ProviderTestConfig): Promise<ProviderTestResult> {
  const timeoutMs = config.timeoutMs ?? TEST_DEFAULTS.TIMEOUT_MS;
  const slowThresholdMs = config.latencyThresholdMs ?? TEST_DEFAULTS.SLOW_LATENCY_MS;
  const plans = buildAttemptPlans(config);
  const deadline = Date.now() + timeoutMs;
  const fallbackState: VersionlessFallbackState = {
    hasRetriedVersionlessUrl: false,
    preferVersionlessUrl: false,
  };

  let fallbackResult: ProviderTestResult | null = null;
  for (const plan of plans) {
    const remainingTimeoutMs = Math.max(1000, deadline - Date.now());
    const result = await runSingleAttempt(
      config,
      plan,
      remainingTimeoutMs,
      slowThresholdMs,
      fallbackState
    );
    if (result.success || !shouldRetryWithNextTemplate(result)) {
      return result;
    }
    fallbackResult = result;
  }

  if (fallbackResult) {
    return fallbackResult;
  }

  throw new Error("No provider testing plan could be constructed");
}

function classifyError(error: unknown): {
  subStatus: TestSubStatus;
  errorType: string;
  errorMessage: string;
} {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (error.name === "AbortError" || message.includes("timeout") || message.includes("aborted")) {
      return {
        subStatus: "network_error",
        errorType: "timeout",
        errorMessage: "Request timed out",
      };
    }

    if (
      message.includes("getaddrinfo") ||
      message.includes("enotfound") ||
      message.includes("dns")
    ) {
      return {
        subStatus: "network_error",
        errorType: "dns_error",
        errorMessage: "DNS resolution failed",
      };
    }

    if (message.includes("econnrefused") || message.includes("connection refused")) {
      return {
        subStatus: "network_error",
        errorType: "connection_refused",
        errorMessage: "Connection refused",
      };
    }

    if (message.includes("econnreset") || message.includes("connection reset")) {
      return {
        subStatus: "network_error",
        errorType: "connection_reset",
        errorMessage: "Connection reset by peer",
      };
    }

    if (message.includes("ssl") || message.includes("tls") || message.includes("certificate")) {
      return {
        subStatus: "network_error",
        errorType: "ssl_error",
        errorMessage: "SSL/TLS error",
      };
    }

    return {
      subStatus: "network_error",
      errorType: "network_error",
      errorMessage: error.message,
    };
  }

  return {
    subStatus: "network_error",
    errorType: "unknown_error",
    errorMessage: String(error),
  };
}

export function getStatusWeight(
  status: TestStatus,
  degradedWeight: number = TEST_DEFAULTS.DEGRADED_WEIGHT
): number {
  switch (status) {
    case "green":
      return 1.0;
    case "yellow":
      return degradedWeight;
    case "red":
      return 0.0;
  }
}
