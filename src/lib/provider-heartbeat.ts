import { buildClaudeCodeMetadataUserId } from "@/lib/claude-code-metadata-userid";
import { getCachedSystemSettings } from "@/lib/config";
import { logger } from "@/lib/logger";
import { getHeartbeatSettings } from "@/repository/heartbeat-settings";
import {
  findEnabledHeartbeatUrlConfigs,
  type HeartbeatUrlConfig,
  recordHeartbeatFailure,
  recordHeartbeatSuccess,
} from "@/repository/heartbeat-url-configs";

/**
 * 供应商心跳发送器
 *
 * 功能：定期向配置的 URL 发送心跳请求，保持上游服务缓存活跃
 * 策略：
 * - 支持多个 URL 同时发送心跳
 * - 每个 URL 配置独立的间隔时间和定时器
 * - 记录成功/失败统计信息
 */
export class ProviderHeartbeat {
  private static timers: Map<number, NodeJS.Timeout> = new Map();
  private static isRunning = false;

  /**
   * 启动心跳任务
   */
  static async start(): Promise<void> {
    try {
      // 先清理旧的定时器（如果有）
      ProviderHeartbeat.stop();

      const settings = await getHeartbeatSettings();

      if (!settings.enabled) {
        logger.info("ProviderHeartbeat: Disabled in settings, not starting");
        return;
      }

      const configs = await findEnabledHeartbeatUrlConfigs();

      if (configs.length === 0) {
        logger.info("ProviderHeartbeat: No enabled URL configs, not starting");
        return;
      }

      ProviderHeartbeat.isRunning = true;

      for (const config of configs) {
        ProviderHeartbeat.startConfigTimer(config);
      }

      logger.info("ProviderHeartbeat: Started", {
        configCount: configs.length,
        configs: configs.map((c) => ({ id: c.id, name: c.name, interval: c.intervalSeconds })),
      });
    } catch (error) {
      logger.error("ProviderHeartbeat: Failed to start", { error });
    }
  }

  /**
   * 停止心跳任务
   */
  static stop(): void {
    // 无论 isRunning 标志如何，都清理所有定时器
    // 这样可以避免因为标志不正确而导致定时器泄漏
    if (ProviderHeartbeat.timers.size > 0) {
      for (const [configId, timer] of ProviderHeartbeat.timers.entries()) {
        clearInterval(timer);
        logger.debug("ProviderHeartbeat: Timer stopped", { configId });
      }

      ProviderHeartbeat.timers.clear();
      logger.info("ProviderHeartbeat: Stopped", { timerCount: ProviderHeartbeat.timers.size });
    } else if (ProviderHeartbeat.isRunning) {
      logger.warn("ProviderHeartbeat: isRunning was true but no timers found");
    }

    ProviderHeartbeat.isRunning = false;
  }

  /**
   * 重启心跳任务（用于配置变更后重新加载）
   */
  static async restart(): Promise<void> {
    logger.info("ProviderHeartbeat: Restarting");
    ProviderHeartbeat.stop();
    await ProviderHeartbeat.start();
  }

  /**
   * 启动单个配置的定时器
   */
  private static startConfigTimer(config: HeartbeatUrlConfig): void {
    if (ProviderHeartbeat.timers.has(config.id)) {
      logger.warn("ProviderHeartbeat: Timer already exists", { configId: config.id });
      return;
    }

    const intervalMs = config.intervalSeconds * 1000;

    void ProviderHeartbeat.sendHeartbeat(config).catch((error) => {
      logger.error("ProviderHeartbeat: Failed to send initial heartbeat", {
        configId: config.id,
        error,
      });
    });

    const timer = setInterval(() => {
      void ProviderHeartbeat.sendHeartbeat(config).catch((error) => {
        logger.error("ProviderHeartbeat: Failed to send heartbeat", {
          configId: config.id,
          error,
        });
      });
    }, intervalMs);

    ProviderHeartbeat.timers.set(config.id, timer);

    logger.debug("ProviderHeartbeat: Timer started", {
      configId: config.id,
      name: config.name,
      intervalSeconds: config.intervalSeconds,
    });
  }

  /**
   * 发送心跳请求
   */
  private static async sendHeartbeat(config: HeartbeatUrlConfig): Promise<void> {
    const startTime = Date.now();

    try {
      let body = config.body ?? undefined;

      if (body && config.method !== "GET" && config.method !== "HEAD") {
        try {
          const bodyObj = JSON.parse(body);
          if (bodyObj.metadata && typeof bodyObj.metadata === "object") {
            const settings = await getCachedSystemSettings();
            bodyObj.metadata.user_id =
              bodyObj.metadata.user_id ||
              buildClaudeCodeMetadataUserId(
                {
                  deviceId: "heartbeat_probe",
                  accountUuid: "heartbeat_probe",
                  sessionId: "00000000-0000-0000-0000-000000000000",
                },
                settings.enableClaudeCodeJsonUserIdFormat ? "json" : "legacy"
              );
            body = JSON.stringify(bodyObj);
          }
        } catch {
          // 如果不是有效的 JSON，保持原样
        }
      }

      const response = await fetch(config.url, {
        method: config.method,
        headers: config.headers,
        body,
        signal: AbortSignal.timeout(10000),
      });

      const duration = Date.now() - startTime;

      if (response.ok) {
        await recordHeartbeatSuccess(config.id);
        logger.debug("ProviderHeartbeat: Heartbeat sent successfully", {
          configId: config.id,
          name: config.name,
          statusCode: response.status,
          duration,
        });
      } else {
        const errorMessage = `HTTP ${response.status} ${response.statusText}`;
        await recordHeartbeatFailure(config.id, errorMessage);
        logger.warn("ProviderHeartbeat: Heartbeat failed", {
          configId: config.id,
          name: config.name,
          statusCode: response.status,
          duration,
        });
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await recordHeartbeatFailure(config.id, errorMessage);

      logger.debug("ProviderHeartbeat: Heartbeat error", {
        configId: config.id,
        name: config.name,
        error: errorMessage,
        duration,
      });
    }
  }
}
