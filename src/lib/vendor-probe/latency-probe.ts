export interface VendorEndpointProbeTarget {
  id: number;
  url: string;
  healthCheckEnabled: boolean;
  healthCheckEndpoint: string | null;
  healthCheckTimeoutMs: number | null;
}

export interface VendorEndpointProbeStore {
  listEnabledEndpoints(): Promise<VendorEndpointProbeTarget[]>;
  updateEndpointLatencyMs(endpointId: number, latencyMs: number | null): Promise<void>;
}

export interface LatencyProbeOutcome {
  endpointId: number;
  probeUrl: string;
  ok: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
}

export interface RunLatencyProbeCycleOptions {
  store: VendorEndpointProbeStore;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

function resolveProbeUrl(endpoint: VendorEndpointProbeTarget): string {
  if (endpoint.healthCheckEnabled && endpoint.healthCheckEndpoint?.trim()) {
    try {
      return new URL(endpoint.healthCheckEndpoint, endpoint.url).toString();
    } catch {
      // Fall back to base URL if joining fails
    }
  }
  return endpoint.url;
}

function getTimeoutMs(endpoint: VendorEndpointProbeTarget, defaultTimeoutMs: number): number {
  const timeoutMs = endpoint.healthCheckTimeoutMs ?? defaultTimeoutMs;
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : defaultTimeoutMs;
}

export async function runLatencyProbeCycle(
  options: RunLatencyProbeCycleOptions
): Promise<LatencyProbeOutcome[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultTimeoutMs =
    options.defaultTimeoutMs != null &&
    Number.isFinite(options.defaultTimeoutMs) &&
    options.defaultTimeoutMs > 0
      ? options.defaultTimeoutMs
      : 5000;

  const endpoints = await options.store.listEnabledEndpoints();
  const results: LatencyProbeOutcome[] = [];

  for (const endpoint of endpoints) {
    const probeUrl = resolveProbeUrl(endpoint);
    const timeoutMs = getTimeoutMs(endpoint, defaultTimeoutMs);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const start = Date.now();
      const response = await fetchImpl(probeUrl, {
        method: "HEAD",
        signal: controller.signal,
      });
      const latencyMs = Date.now() - start;

      try {
        await options.store.updateEndpointLatencyMs(endpoint.id, latencyMs);
      } catch {
        // Do not fail the cycle if DB update fails; still return probe result.
      }

      try {
        await response.body?.cancel();
      } catch {
        // ignore
      }

      results.push({
        endpointId: endpoint.id,
        probeUrl,
        ok: true,
        latencyMs,
        statusCode: response.status,
        errorMessage: null,
      });
    } catch (error) {
      try {
        await options.store.updateEndpointLatencyMs(endpoint.id, null);
      } catch {
        // ignore
      }

      results.push({
        endpointId: endpoint.id,
        probeUrl,
        ok: false,
        latencyMs: null,
        statusCode: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return results;
}
