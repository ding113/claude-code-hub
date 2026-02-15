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

/**
 * Flush pending spans and shut down the SDK.
 * Called during graceful shutdown (SIGTERM/SIGINT).
 */
export async function shutdownLangfuse(): Promise<void> {
  if (!initialized || !spanProcessor) {
    return;
  }

  try {
    await spanProcessor.forceFlush();
    if (sdk) {
      await sdk.shutdown();
    }
    initialized = false;
    logger.info("[Langfuse] Shutdown complete");
  } catch (error) {
    logger.warn("[Langfuse] Shutdown error", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
