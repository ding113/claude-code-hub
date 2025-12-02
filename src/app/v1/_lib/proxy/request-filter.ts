import { logger } from "@/lib/logger";
import { requestFilterEngine } from "@/lib/request-filter-engine";
import type { ProxySession } from "./session";

/**
 * 请求过滤器：支持 Header 删除/覆盖，Body 替换（JSON Path / 文本关键字/正则）
 *
 * 设计：
 * - 管理端配置的过滤规则存储在 request_filters 表
 * - 通过 RequestFilterEngine 缓存并监听 eventEmitter 自动热更新
 * - 在 GuardPipeline 中于敏感词检测前执行，便于先脱敏再检测
 */
export class ProxyRequestFilter {
  static async ensure(session: ProxySession): Promise<void> {
    try {
      await requestFilterEngine.apply(session);
    } catch (error) {
      // Fail-open: 过滤失败不阻塞主流程
      logger.error("[ProxyRequestFilter] Failed to apply request filters", { error });
    }
  }
}
