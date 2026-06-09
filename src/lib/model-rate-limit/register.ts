import { registerExtensionStep } from "@/app/v1/_lib/proxy/guard-pipeline";
import { ModelRateLimitGuard } from "@/app/v1/_lib/proxy/model-rate-limit-guard";

/**
 * Wire the per-model rate limit guard into the proxy guard pipeline.
 *
 * Called from instrumentation `register()`. Idempotent: the underlying
 * `registerExtensionStep` dedups by key, so repeated calls (dev hot reload)
 * are safe.
 */
export function registerModelRateLimitExtension(): void {
  registerExtensionStep({
    key: "modelRateLimit",
    step: ModelRateLimitGuard,
    insertBefore: "rateLimit",
  });
}
