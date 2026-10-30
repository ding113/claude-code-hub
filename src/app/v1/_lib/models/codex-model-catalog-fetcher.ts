import { createHash } from "node:crypto";
import { request as undiciRequest } from "undici";
import {
  CODEX_MODEL_CATALOG_UPSTREAM_MAX_BYTES,
  type CodexModelInfo,
  parseCodexModelCatalog,
} from "@/lib/codex-model-catalog";
import { mergeResolvedCustomHeaders, PROTECTED_AUTH_HEADER_NAMES } from "@/lib/custom-headers";
import { logger } from "@/lib/logger";
import { createProxyAgentForProvider } from "@/lib/proxy-agent";
import type { Provider } from "@/types/provider";
import { RESERVED_INTERNAL_HEADERS } from "../responses-ws/internal-secret";
import { buildProxyUrl } from "../url";

const MAX_CATALOG_TIMEOUT_MS = 4_000;
const RESERVED_CATALOG_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "cookie",
  "set-cookie",
  ...RESERVED_INTERNAL_HEADERS,
]);

export interface CodexCatalogSource {
  key: string;
  providerId: number;
  clientVersion: string;
  dynamicHeaders: boolean;
  provider: Provider;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

export type CodexCatalogFetchResult =
  | { ok: true; models: CodexModelInfo[]; bytes: number; elapsedMs: number }
  | { ok: false; reason: string; status?: number; unauthorized?: boolean };

/** Derive the directory from the configured Responses endpoint, preserving gateway prefixes. */
export function buildCodexModelCatalogUrl(providerUrl: string, clientVersion: string): string {
  try {
    const baseUrl = new URL(providerUrl);
    if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
      throw new TypeError();
    }
    const url = new URL(
      buildProxyUrl(baseUrl.toString(), new URL("https://cch.invalid/v1/responses"))
    );
    url.pathname = url.pathname.replace(/\/responses\/?$/, "/models");
    url.search = "";
    url.hash = "";
    url.searchParams.set("client_version", clientVersion);
    return url.toString();
  } catch {
    throw new TypeError("Invalid model catalog URL");
  }
}

function sortedHeaders(headers: Record<string, string>): Array<[string, string]> {
  return Object.entries(headers)
    .map(([name, value]): [string, string] => [name.toLowerCase(), value])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

/** Snapshot the effective outbound identity without exposing credentials in its cache key. */
export function prepareCodexModelCatalogSource(
  provider: Provider,
  clientVersion: string,
  requestHeaders?: Headers
): CodexCatalogSource {
  const snapshot = structuredClone(provider);
  const url = buildCodexModelCatalogUrl(snapshot.url, clientVersion);
  const headers: Record<string, string> = {};
  mergeResolvedCustomHeaders(
    headers,
    snapshot.customHeaders,
    { getHeader: (name) => requestHeaders?.get(name) },
    RESERVED_CATALOG_HEADERS
  );
  headers.Authorization = `Bearer ${snapshot.key}`;
  const configuredTimeout = snapshot.requestTimeoutNonStreamingMs;
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(Math.max(1, Math.floor(configuredTimeout)), MAX_CATALOG_TIMEOUT_MS)
      : MAX_CATALOG_TIMEOUT_MS;
  const dynamicHeaders = Object.entries(snapshot.customHeaders ?? {}).some(
    ([name, value]) =>
      !PROTECTED_AUTH_HEADER_NAMES.has(name.toLowerCase()) &&
      !RESERVED_CATALOG_HEADERS.has(name.toLowerCase()) &&
      typeof value === "string" &&
      /\{\{\s*header\.[^{}]+\}\}/i.test(value)
  );
  const identity = {
    version: 1,
    providerId: snapshot.id,
    providerUrl: snapshot.url,
    clientVersion,
    url,
    headers: sortedHeaders(headers),
    customHeaders: sortedHeaders(snapshot.customHeaders ?? {}),
    proxyUrl: snapshot.proxyUrl ?? null,
    proxyFallbackToDirect: snapshot.proxyFallbackToDirect ?? false,
    timeoutMs,
    updatedAt: snapshot.updatedAt ?? null,
  };
  return {
    key: createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
    providerId: snapshot.id,
    clientVersion,
    dynamicHeaders,
    provider: snapshot,
    url,
    headers,
    timeoutMs,
  };
}

function unavailable(providerId: number, reason: string, status?: number): CodexCatalogFetchResult {
  logger.warn("[CodexModelCatalog] Upstream catalog unavailable", { providerId, reason });
  return {
    ok: false,
    reason,
    ...(status === undefined ? {} : { status }),
    ...(status === 401 || status === 403 ? { unauthorized: true } : {}),
  };
}

/** A native empty catalog is a successful replacement; transport and schema failures are not. */
export async function fetchCodexModelCatalog(
  source: CodexCatalogSource,
  signal?: AbortSignal
): Promise<CodexCatalogFetchResult> {
  let body: Awaited<ReturnType<typeof undiciRequest>>["body"] | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let proxy: ReturnType<typeof createProxyAgentForProvider> = null;
  const startedAt = performance.now();
  const controller = new AbortController();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let reason = "proxy_configuration";

  try {
    if (combinedSignal.aborted) return unavailable(source.providerId, "aborted");
    timeout = setTimeout(() => controller.abort(), source.timeoutMs);
    proxy = createProxyAgentForProvider(source.provider, source.url);
    reason = "network_error";
    const init = {
      method: "GET" as const,
      headers: source.headers,
      headersTimeout: source.timeoutMs,
      bodyTimeout: source.timeoutMs,
      signal: combinedSignal,
      // undici.request does not follow redirects, including credential-bearing redirects.
    };
    let response: Awaited<ReturnType<typeof undiciRequest>>;
    try {
      response = await undiciRequest(source.url, { ...init, dispatcher: proxy?.agent });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isProxyError =
        message.includes("proxy") ||
        message.includes("ECONNREFUSED") ||
        message.includes("ENOTFOUND") ||
        message.includes("ETIMEDOUT");
      if (!proxy?.fallbackToDirect || !isProxyError || combinedSignal.aborted) throw error;
      if (performance.now() - startedAt >= source.timeoutMs) {
        return unavailable(source.providerId, "timeout");
      }
      // Retain the original signal and deadline; only the dispatcher changes.
      response = await undiciRequest(source.url, init);
    }
    body = response.body;
    if (response.statusCode !== 200) {
      return unavailable(source.providerId, `http_${response.statusCode}`, response.statusCode);
    }

    const contentLength = response.headers["content-length"];
    if (
      typeof contentLength === "string" &&
      /^\d+$/.test(contentLength) &&
      Number(contentLength) > CODEX_MODEL_CATALOG_UPSTREAM_MAX_BYTES
    ) {
      return unavailable(source.providerId, "payload_too_large");
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > CODEX_MODEL_CATALOG_UPSTREAM_MAX_BYTES) {
        return unavailable(source.providerId, "payload_too_large");
      }
      chunks.push(buffer);
    }

    reason = "invalid_json";
    const payload: unknown = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
    reason = "invalid_catalog";
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("models" in payload) ||
      !Array.isArray(payload.models)
    ) {
      return unavailable(source.providerId, reason);
    }
    const models = parseCodexModelCatalog(payload);
    if (payload.models.length > 0 && models.length === 0) {
      return unavailable(source.providerId, reason);
    }
    const elapsedMs = Math.max(0, performance.now() - startedAt);
    if (combinedSignal.aborted || elapsedMs >= source.timeoutMs) {
      return unavailable(source.providerId, signal?.aborted ? "aborted" : "timeout");
    }
    return { ok: true, models, bytes, elapsedMs };
  } catch {
    return unavailable(
      source.providerId,
      signal?.aborted ? "aborted" : controller.signal.aborted ? "timeout" : reason
    );
  } finally {
    clearTimeout(timeout);
    body?.on("error", () => {});
    body?.destroy();
    // This factory creates a dedicated dispatcher, rather than borrowing the inference pool.
    void proxy?.agent.destroy().catch(() => {});
  }
}
