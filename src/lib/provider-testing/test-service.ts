/**
 * Provider Testing Service
 * Main entry point for unified provider testing
 *
 * Implements three-tier validation from relay-pulse:
 * 1. HTTP Status Code validation
 * 2. Latency threshold validation
 * 3. Content validation (success_contains)
 */

import {
  ResponsesWsTransportError,
  sendResponsesWsRequest,
} from "@/app/v1/_lib/proxy/responses-ws-adapter";
import { evaluateResponsesWsTransport } from "@/app/v1/_lib/proxy/responses-ws-transport";
import { createProxyAgentForProvider, type ProviderProxyConfig } from "@/lib/proxy-agent";
import { parseSSEData } from "@/lib/utils/sse";
import { getPreset, getPresetPayload } from "./presets";
import type {
  ProviderTestConfig,
  ProviderTestResult,
  TestSubStatus,
  ValidationDetails,
} from "./types";
import { TEST_DEFAULTS } from "./types";
import {
  DEFAULT_SUCCESS_CONTAINS,
  getTestBody,
  getTestHeaders,
  getTestUrl,
} from "./utils/test-prompts";
import { evaluateContentValidation } from "./validators/content-validator";
import { classifyHttpStatus } from "./validators/http-validator";

function resolveTestSetup(config: ProviderTestConfig) {
  const timeoutMs = config.timeoutMs ?? TEST_DEFAULTS.TIMEOUT_MS;
  const slowThresholdMs = config.latencyThresholdMs ?? TEST_DEFAULTS.SLOW_LATENCY_MS;

  let successContains = config.successContains;
  if (!successContains && config.preset) {
    const preset = getPreset(config.preset);
    successContains = preset?.defaultSuccessContains;
  }
  successContains ??= DEFAULT_SUCCESS_CONTAINS[config.providerType];

  const url = getTestUrl(
    config.providerUrl,
    config.providerType,
    config.model,
    config.providerType === "gemini" || config.providerType === "gemini-cli"
      ? config.apiKey
      : undefined
  );

  let body: Record<string, unknown>;
  if (config.customPayload) {
    try {
      body = JSON.parse(config.customPayload);
    } catch {
      throw new Error("Invalid custom payload JSON");
    }
  } else if (config.preset) {
    body = getPresetPayload(config.preset, config.model);
  } else {
    body = getTestBody(config.providerType, config.model);
  }

  const baseHeaders = getTestHeaders(config.providerType, config.apiKey);
  const headers = config.customHeaders ? { ...baseHeaders, ...config.customHeaders } : baseHeaders;

  return {
    timeoutMs,
    slowThresholdMs,
    successContains,
    url,
    body,
    headers,
  };
}

async function createDispatcher(config: ProviderTestConfig, url: string) {
  let usedProxy = false;
  let dispatcher: unknown | undefined;

  if (config.proxyUrl) {
    const tempProvider: ProviderProxyConfig = {
      id: -1,
      name: "test-provider",
      proxyUrl: config.proxyUrl,
      proxyFallbackToDirect: config.proxyFallbackToDirect ?? false,
    };
    const proxyConfig = createProxyAgentForProvider(tempProvider, url);
    if (proxyConfig) {
      dispatcher = proxyConfig.agent;
      usedProxy = true;
    }
  }

  return { dispatcher, usedProxy };
}

function buildValidationDetails(
  responseOk: boolean,
  responseStatus: number | undefined,
  latencyMs: number,
  slowThresholdMs: number,
  contentPassed: boolean,
  contentTarget: string
): ValidationDetails {
  return {
    httpPassed: responseOk,
    httpStatusCode: responseStatus,
    latencyPassed: latencyMs <= slowThresholdMs,
    latencyMs,
    contentPassed,
    contentTarget,
  };
}

async function executeHttpProviderTest(
  params: ReturnType<typeof resolveTestSetup>,
  config: ProviderTestConfig,
  startTime: number
): Promise<ProviderTestResult> {
  let firstByteMs: number | undefined;
  const { dispatcher, usedProxy } = await createDispatcher(config, params.url);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

    try {
      const fetchOptions: RequestInit & { dispatcher?: unknown } = {
        method: "POST",
        headers: params.headers,
        body: JSON.stringify(params.body),
        signal: controller.signal,
      };
      if (dispatcher) {
        fetchOptions.dispatcher = dispatcher;
      }
      const response = await fetch(params.url, fetchOptions);

      firstByteMs = Date.now() - startTime;
      const responseBody = await response.text();
      const latencyMs = Date.now() - startTime;
      const httpResult = classifyHttpStatus(response.status, latencyMs, params.slowThresholdMs);
      const contentResult = evaluateContentValidation(
        httpResult.status,
        httpResult.subStatus,
        responseBody,
        params.successContains
      );

      let model: string | undefined;
      try {
        model = JSON.parse(responseBody).model;
      } catch {}

      return {
        success: contentResult.status !== "red",
        status: contentResult.status,
        subStatus: contentResult.subStatus,
        latencyMs,
        firstByteMs,
        httpStatusCode: response.status,
        httpStatusText: response.statusText,
        model,
        content: responseBody.slice(0, 500),
        rawResponse: responseBody.slice(0, 5000),
        testedAt: new Date(),
        validationDetails: buildValidationDetails(
          response.ok,
          response.status,
          latencyMs,
          params.slowThresholdMs,
          contentResult.contentPassed,
          params.successContains
        ),
        usedProxy,
        transportKind: "http",
      };
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
      testedAt: new Date(),
      validationDetails: buildValidationDetails(
        false,
        undefined,
        latencyMs,
        params.slowThresholdMs,
        false,
        params.successContains
      ),
      usedProxy,
      transportKind: "http",
    };
  }
}

function parseWsProbeResponseBody(responseBody: string) {
  const events = parseSSEData(responseBody);
  let model: string | undefined;
  let usage: ProviderTestResult["usage"];

  for (const event of events) {
    if (typeof event.data !== "object" || !event.data) {
      continue;
    }

    const data = event.data as Record<string, unknown>;
    const response =
      data.response && typeof data.response === "object"
        ? (data.response as Record<string, unknown>)
        : data;

    if (typeof response.model === "string") {
      model = response.model;
    }

    if (response.usage && typeof response.usage === "object") {
      const usageRecord = response.usage as Record<string, unknown>;
      if (
        typeof usageRecord.input_tokens === "number" &&
        typeof usageRecord.output_tokens === "number"
      ) {
        usage = {
          inputTokens: usageRecord.input_tokens,
          outputTokens: usageRecord.output_tokens,
        };
      }
    }
  }

  return {
    eventCount: events.length,
    model,
    usage,
  };
}

async function executeResponsesWsProviderTest(
  params: ReturnType<typeof resolveTestSetup>,
  config: ProviderTestConfig,
  startTime: number
): Promise<ProviderTestResult> {
  let handshakeLatencyMs: number | undefined;
  let eventCount = 0;

  try {
    const decision = evaluateResponsesWsTransport({
      enableResponsesWebSocket: true,
      provider: {
        id: -1,
        name: "test-provider",
        providerType: config.providerType,
        proxyUrl: config.proxyUrl ?? null,
      },
      upstreamUrl: params.url,
    });

    if (decision.effectiveTransport !== "responses_websocket" || !decision.websocketUrl) {
      const httpResult = await executeHttpProviderTest(params, config, startTime);
      return {
        ...httpResult,
        websocketFallbackReason: decision.fallbackReason ?? undefined,
      };
    }

    const response = await sendResponsesWsRequest({
      websocketUrl: decision.websocketUrl,
      frame: {
        type: "response.create",
        response: params.body as Record<string, unknown> & { model: string },
      },
      headers: params.headers,
      isStreaming: true,
      handshakeTimeoutMs: params.timeoutMs,
      firstEventTimeoutMs: params.timeoutMs,
      onOpen: (latencyMs) => {
        handshakeLatencyMs = latencyMs;
      },
      onEvent: () => {
        eventCount += 1;
      },
    });

    const firstByteMs = Date.now() - startTime;
    const responseBody = await response.text();
    const latencyMs = Date.now() - startTime;
    const httpResult = classifyHttpStatus(response.status, latencyMs, params.slowThresholdMs);
    const contentResult = evaluateContentValidation(
      httpResult.status,
      httpResult.subStatus,
      responseBody,
      params.successContains
    );
    const parsed = parseWsProbeResponseBody(responseBody);

    return {
      success: contentResult.status !== "red",
      status: contentResult.status,
      subStatus: contentResult.subStatus,
      latencyMs,
      firstByteMs,
      httpStatusCode: response.status,
      httpStatusText: response.statusText,
      model: parsed.model,
      content: responseBody.slice(0, 500),
      rawResponse: responseBody.slice(0, 5000),
      usage: parsed.usage,
      streamInfo: {
        isStreaming: true,
        chunksReceived: parsed.eventCount,
      },
      testedAt: new Date(),
      validationDetails: buildValidationDetails(
        response.ok,
        response.status,
        latencyMs,
        params.slowThresholdMs,
        contentResult.contentPassed,
        params.successContains
      ),
      usedProxy: false,
      transportKind: "responses_websocket",
      websocketHandshakeMs: handshakeLatencyMs,
      websocketEventCount: parsed.eventCount,
    };
  } catch (error) {
    if (error instanceof ResponsesWsTransportError && error.allowHttpFallback) {
      const httpResult = await executeHttpProviderTest(params, config, startTime);
      return {
        ...httpResult,
        websocketFallbackReason: error.fallbackReason,
      };
    }

    const latencyMs = Date.now() - startTime;
    const { subStatus, errorType, errorMessage } = classifyError(error);

    return {
      success: false,
      status: "red",
      subStatus,
      latencyMs,
      errorMessage,
      errorType,
      rawError: error,
      testedAt: new Date(),
      validationDetails: buildValidationDetails(
        false,
        undefined,
        latencyMs,
        params.slowThresholdMs,
        false,
        params.successContains
      ),
      transportKind: "responses_websocket",
      websocketHandshakeMs: handshakeLatencyMs,
      websocketEventCount: eventCount,
      websocketFallbackReason:
        error instanceof ResponsesWsTransportError ? error.fallbackReason : undefined,
    };
  }
}

/**
 * Execute a provider test with three-tier validation
 */
export async function executeProviderTest(config: ProviderTestConfig): Promise<ProviderTestResult> {
  const startTime = Date.now();
  const params = resolveTestSetup(config);

  if (config.providerType === "codex") {
    return executeResponsesWsProviderTest(params, config, startTime);
  }

  return executeHttpProviderTest(params, config, startTime);
}

/**
 * Classify error into sub-status and message
 */
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
        errorType: "tls_error",
        errorMessage: "TLS/SSL handshake failed",
      };
    }
  }

  return {
    subStatus: "network_error",
    errorType: "unknown",
    errorMessage: error instanceof Error ? error.message : "Unknown error",
  };
}

export function getStatusWeight(status: ProviderTestResult["status"]): number {
  return status === "green" ? 1 : status === "yellow" ? 0.7 : 0;
}
