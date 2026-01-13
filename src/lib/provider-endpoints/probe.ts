import "server-only";

import { logger } from "@/lib/logger";
import { findProviderEndpointById, recordProviderEndpointProbeResult } from "@/repository";
import type { ProviderEndpointProbeSource } from "@/types/provider";

export type EndpointProbeMethod = "HEAD" | "GET";

export interface EndpointProbeResult {
  ok: boolean;
  method: EndpointProbeMethod;
  statusCode: number | null;
  latencyMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
}

const DEFAULT_TIMEOUT_MS = 5000;

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
    logger.debug("[EndpointProbe] Probe request failed", { url, method, type, error });
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

export async function probeProviderEndpointAndRecord(input: {
  endpointId: number;
  source: ProviderEndpointProbeSource;
  timeoutMs?: number;
}): Promise<EndpointProbeResult | null> {
  const endpoint = await findProviderEndpointById(input.endpointId);
  if (!endpoint) {
    return null;
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const result = await probeEndpointUrl(endpoint.url, timeoutMs);

  await recordProviderEndpointProbeResult({
    endpointId: endpoint.id,
    source: input.source,
    ok: result.ok,
    statusCode: result.statusCode,
    latencyMs: result.latencyMs,
    errorType: result.errorType,
    errorMessage: result.errorMessage,
    probedAt: new Date(),
  });

  return result;
}
