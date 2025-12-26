import { getTestHeaders } from "@/lib/provider-testing/utils/test-prompts";
import { extractBalance } from "@/lib/remote-config/jsonpath-parser";
import type { ProviderType } from "@/types/provider";

export interface BalanceCheckTarget {
  vendorKeyId: number;
  vendorId: number;
  endpointId: number;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  balanceCheckEndpoint: string;
  balanceCheckJsonpath: string;
  lowThresholdUsd: number | null;
}

export interface BalanceCheckerStore {
  listBalanceCheckTargets(): Promise<BalanceCheckTarget[]>;
  recordBalanceCheck(data: {
    vendorKeyId: number;
    vendorId: number;
    endpointId: number;
    checkedAt: Date;
    durationMs: number | null;
    statusCode: number | null;
    isSuccess: boolean;
    balanceUsd: number | null;
    rawResponse: unknown;
    errorMessage: string | null;
  }): Promise<void>;
  updateVendorKeyBalance(vendorKeyId: number, balanceUsd: number): Promise<void>;
  disableVendorKey(vendorKeyId: number): Promise<void>;
}

export interface BalanceCheckOutcome {
  vendorKeyId: number;
  ok: boolean;
  balanceUsd: number | null;
  disabled: boolean;
  statusCode: number | null;
  errorMessage: string | null;
}

export interface RunBalanceCheckCycleOptions {
  store: BalanceCheckerStore;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function resolveBalanceCheckUrl(target: BalanceCheckTarget): string {
  try {
    return new URL(target.balanceCheckEndpoint, target.baseUrl).toString();
  } catch {
    // If URL construction fails, fall back to concatenation
    const base = target.baseUrl.replace(/\/$/, "");
    const path = target.balanceCheckEndpoint.startsWith("/")
      ? target.balanceCheckEndpoint
      : `/${target.balanceCheckEndpoint}`;
    return `${base}${path}`;
  }
}

export async function runBalanceCheckCycle(
  options: RunBalanceCheckCycleOptions
): Promise<BalanceCheckOutcome[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs =
    options.timeoutMs != null && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : 10000;

  const targets = await options.store.listBalanceCheckTargets();
  const results: BalanceCheckOutcome[] = [];

  for (const target of targets) {
    const url = resolveBalanceCheckUrl(target);
    const headers = getTestHeaders(target.providerType, target.apiKey);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const checkedAt = new Date();
    const start = Date.now();

    let durationMs: number | null = null;
    let statusCode: number | null = null;
    let rawResponse: unknown = null;
    let balanceUsd: number | null = null;
    let isSuccess = false;
    let disabled = false;
    let errorMessage: string | null = null;

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      statusCode = response.status;

      const bodyText = await response.text();
      durationMs = Date.now() - start;

      try {
        rawResponse = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        rawResponse = bodyText;
      }

      if (!response.ok) {
        errorMessage = `Non-2xx response: ${response.status}`;
      } else {
        try {
          balanceUsd = extractBalance(rawResponse, target.balanceCheckJsonpath);
          isSuccess = true;
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
        }
      }

      if (isSuccess && balanceUsd != null) {
        await options.store.updateVendorKeyBalance(target.vendorKeyId, balanceUsd);

        if (target.lowThresholdUsd != null && balanceUsd < target.lowThresholdUsd) {
          await options.store.disableVendorKey(target.vendorKeyId);
          disabled = true;
        }
      }
    } catch (error) {
      durationMs = Date.now() - start;
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeoutId);
    }

    await options.store.recordBalanceCheck({
      vendorKeyId: target.vendorKeyId,
      vendorId: target.vendorId,
      endpointId: target.endpointId,
      checkedAt,
      durationMs,
      statusCode,
      isSuccess,
      balanceUsd,
      rawResponse,
      errorMessage,
    });

    results.push({
      vendorKeyId: target.vendorKeyId,
      ok: isSuccess,
      balanceUsd,
      disabled,
      statusCode,
      errorMessage,
    });
  }

  return results;
}
