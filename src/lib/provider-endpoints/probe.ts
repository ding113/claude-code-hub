import "server-only";

import { recordEndpointFailure } from "@/lib/endpoint-circuit-breaker";
import { logger } from "@/lib/logger";
import { findProviderEndpointById, recordProviderEndpointProbeResult } from "@/repository";
import type { ProviderEndpoint, ProviderEndpointProbeSource } from "@/types/provider";

export type EndpointProbeMethod = "HEAD" | "GET";

export interface EndpointProbeResult {
  ok: boolean;
  method: EndpointProbeMethod;
  statusCode: number | null;
  latencyMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
}

function parseIntWithDefault(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

const DEFAULT_TIMEOUT_MS = Math.max(
  1,
  parseIntWithDefault(process.env.ENDPOINT_PROBE_TIMEOUT_MS, 5_000)
);

function safeUrlForLog(rawUrl: string): string {
  try {
    // Avoid leaking credentials/querystring in logs.
    return new URL(rawUrl).origin;
  } catch {
    return "<invalid-url>";
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ response: Response; latencyMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      redirect: "manual",
    });
    return { response, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timeout);
  }
}

function toErrorInfo(error: unknown): { type: string; message: string } {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return { type: "timeout", message: error.message || "timeout" };
    }
    if (error instanceof TypeError) {
      // Fetch URL parsing failures should not leak the original URL.
      return { type: "invalid_url", message: "invalid_url" };
    }
    return { type: "network_error", message: error.message };
  }
  return { type: "unknown_error", message: String(error) };
}

async function tryProbe(
  url: string,
  method: EndpointProbeMethod,
  timeoutMs: number
): Promise<EndpointProbeResult> {
  try {
    const { response, latencyMs } = await fetchWithTimeout(
      url,
      {
        method,
        headers: {
          "cache-control": "no-store",
        },
      },
      timeoutMs
    );

    const statusCode = response.status;
    const ok = statusCode < 500;

    return {
      ok,
      method,
      statusCode,
      latencyMs,
      errorType: ok ? null : "http_5xx",
      errorMessage: ok ? null : `HTTP ${statusCode}`,
    };
  } catch (error) {
    const { type, message } = toErrorInfo(error);
    logger.debug("[EndpointProbe] Probe request failed", {
      url: safeUrlForLog(url),
      method,
      type,
      errorMessage: message,
    });
    return {
      ok: false,
      method,
      statusCode: null,
      latencyMs: null,
      errorType: type,
      errorMessage: message,
    };
  }
}

export async function probeEndpointUrl(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<EndpointProbeResult> {
  const head = await tryProbe(url, "HEAD", timeoutMs);
  if (head.statusCode === null) {
    return tryProbe(url, "GET", timeoutMs);
  }
  return head;
}

type ProbeTarget = Pick<ProviderEndpoint, "id" | "url" | "lastProbedAt" | "lastProbeOk">;

export async function probeProviderEndpointAndRecordByEndpoint(input: {
  endpoint: ProbeTarget;
  source: ProviderEndpointProbeSource;
  timeoutMs?: number;
}): Promise<EndpointProbeResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const result = await probeEndpointUrl(input.endpoint.url, timeoutMs);
  const probedAt = new Date();

  if (!result.ok) {
    // Keep circuit-breaker logs free of raw upstream error strings.
    const message = result.statusCode
      ? `HTTP ${result.statusCode}`
      : result.errorType || "probe_failed";
    await recordEndpointFailure(input.endpoint.id, new Error(message));
  }

  // Always record probe results to history table (removed filtering logic)
  await recordProviderEndpointProbeResult({
    endpointId: input.endpoint.id,
    source: input.source,
    ok: result.ok,
    statusCode: result.statusCode,
    latencyMs: result.latencyMs,
    errorType: result.errorType,
    errorMessage: result.errorMessage,
    probedAt,
  });

  return result;
}

export async function probeProviderEndpointAndRecord(input: {
  endpointId: number;
  source: ProviderEndpointProbeSource;
  timeoutMs?: number;
}): Promise<EndpointProbeResult | null> {
  const endpoint = await findProviderEndpointById(input.endpointId);
  if (!endpoint) {
    return null;
  }

  return probeProviderEndpointAndRecordByEndpoint({
    endpoint,
    source: input.source,
    timeoutMs: input.timeoutMs,
  });
}
