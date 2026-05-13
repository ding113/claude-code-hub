import type { LangfuseSpanProcessor } from "@langfuse/otel";

import type { NodeSDK } from "@opentelemetry/sdk-node";
import { logger } from "@/lib/logger";

let sdk: NodeSDK | null = null;
let spanProcessor: LangfuseSpanProcessor | null = null;
let initialized = false;

export function isLangfuseEnabled(): boolean {
  return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

/**
 * Initialize Langfuse OpenTelemetry SDK.
 * Must be called early in the process (instrumentation.ts register()).
 * No-op if LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY are not set.
 */
export async function initLangfuse(): Promise<void> {
  if (initialized || !isLangfuseEnabled()) {
    return;
  }

  try {
    const { NodeSDK: OtelNodeSDK } = await import("@opentelemetry/sdk-node");
    const { LangfuseSpanProcessor: LfSpanProcessor } = await import("@langfuse/otel");

    const sampleRate = Number.parseFloat(process.env.LANGFUSE_SAMPLE_RATE || "1.0");

    spanProcessor = new LfSpanProcessor({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
      // Only export spans from langfuse-sdk scope (avoid noise from other OTel instrumentations)
      shouldExportSpan: ({ otelSpan }) => otelSpan.instrumentationScope.name === "langfuse-sdk",
    });

    const samplerConfig =
      sampleRate < 1.0
        ? await (async () => {
            const { TraceIdRatioBasedSampler } = await import("@opentelemetry/sdk-trace-base");
            return { sampler: new TraceIdRatioBasedSampler(sampleRate) };
          })()
        : {};

    sdk = new OtelNodeSDK({
      spanProcessors: [spanProcessor],
      ...samplerConfig,
    });

    sdk.start();
    initialized = true;

    logger.info("[Langfuse] Observability initialized", {
      baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
      sampleRate,
      debug: process.env.LANGFUSE_DEBUG === "true",
    });

    if (process.env.LANGFUSE_DEBUG === "true") {
      const { configureGlobalLogger, LogLevel } = await import("@langfuse/core");
      configureGlobalLogger({ level: LogLevel.DEBUG });
    }
  } catch (error) {
    logger.error("[Langfuse] Failed to initialize", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3000;

function getShutdownTimeoutMs(): number {
  const raw = process.env.LANGFUSE_SHUTDOWN_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

async function withTimeout(p: Promise<unknown>, ms: number, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      logger.warn(`[Langfuse] ${label} timed out`, { ms });
      resolve();
    }, ms);
  });
  try {
    await Promise.race([
      p.then(
        () => undefined,
        (error) => {
          logger.warn(`[Langfuse] ${label} failed`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      ),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Flush pending spans and shut down the SDK.
 * Called during graceful shutdown (SIGTERM/SIGINT).
 *
 * forceFlush 是无超时的网络刷盘——曾在生产观察到耗时 3 分钟，远超 K8s 默认 30s
 * grace period。这里用 Promise.race + setTimeout 强制上限，超时只记日志不抛错，
 * 让关闭流程继续往下走。
 */
export async function shutdownLangfuse(): Promise<void> {
  if (!initialized || !spanProcessor) {
    return;
  }

  const timeoutMs = getShutdownTimeoutMs();
  const localProcessor = spanProcessor;
  const localSdk = sdk;
  initialized = false;
  spanProcessor = null;
  sdk = null;

  await withTimeout(localProcessor.forceFlush(), timeoutMs, "forceFlush");
  if (localSdk) {
    await withTimeout(localSdk.shutdown(), timeoutMs, "sdk.shutdown");
  }
  logger.info("[Langfuse] Shutdown complete");
}
