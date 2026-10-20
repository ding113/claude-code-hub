import { logger } from "@/lib/logger";
import { reconcilePublicStatusSiteTitleProjection } from "./config-publisher";

export async function reconcilePublicStatusSiteTitleAtStartup(): Promise<void> {
  try {
    const written = await reconcilePublicStatusSiteTitleProjection();
    if (!written) {
      logger.warn("[Instrumentation] Public status site title reconciliation deferred", {
        reason: "redis-projection-unavailable",
      });
    }
  } catch (error) {
    logger.warn("[Instrumentation] Public status site title reconciliation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
