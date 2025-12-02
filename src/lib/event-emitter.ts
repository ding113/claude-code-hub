/**
 * 全局事件发射器
 *
 * 用于系统内部事件驱动的通信机制，支持：
 * - 缓存数据更新事件（errorRulesUpdated、sensitiveWordsUpdated）
 * - 系统配置变更事件
 * - 监听器的自动注册和卸载
 *
 * 注意：此模块仅在 Node.js runtime 中使用
 * 请确保通过动态导入 (dynamic import) 引入此模块
 */

import { EventEmitter as NodeEventEmitter } from "node:events";

/**
 * 事件映射类型定义
 */
interface EventMap {
  errorRulesUpdated: [];
  sensitiveWordsUpdated: [];
  requestFiltersUpdated: [];
}

/**
 * 全局事件发射器单例
 */
class GlobalEventEmitter extends NodeEventEmitter {
  /**
   * 发送 errorRulesUpdated 事件
   */
  emitErrorRulesUpdated(): void {
    this.emit("errorRulesUpdated");
  }

  /**
   * 发送 sensitiveWordsUpdated 事件
   */
  emitSensitiveWordsUpdated(): void {
    this.emit("sensitiveWordsUpdated");
  }

  /**
   * 发送 requestFiltersUpdated 事件
   */
  emitRequestFiltersUpdated(): void {
    this.emit("requestFiltersUpdated");
  }
}

/**
 * 全局事件发射器单例导出
 */
export const eventEmitter = new GlobalEventEmitter();

export type { EventMap };
