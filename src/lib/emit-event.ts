/**
 * 安全的事件触发辅助函数
 *
 * 此模块使用动态导入 event-emitter，确保在 Edge Runtime 中不会报错
 * 适用于 Server Actions 和 Repository 层
 */

/**
 * 触发 errorRulesUpdated 事件
 */
export async function emitErrorRulesUpdated(): Promise<void> {
  if (typeof process !== "undefined" && process.env.NEXT_RUNTIME !== "edge") {
    try {
      const { eventEmitter } = await import("@/lib/event-emitter");
      eventEmitter.emitErrorRulesUpdated();
    } catch {
      // 忽略导入错误
    }
  }
}

/**
 * 触发 sensitiveWordsUpdated 事件
 */
export async function emitSensitiveWordsUpdated(): Promise<void> {
  if (typeof process !== "undefined" && process.env.NEXT_RUNTIME !== "edge") {
    try {
      const { eventEmitter } = await import("@/lib/event-emitter");
      eventEmitter.emitSensitiveWordsUpdated();
    } catch {
      // 忽略导入错误
    }
  }
}

/**
 * 触发 requestFiltersUpdated 事件
 */
export async function emitRequestFiltersUpdated(): Promise<void> {
  if (typeof process !== "undefined" && process.env.NEXT_RUNTIME !== "edge") {
    try {
      const { eventEmitter } = await import("@/lib/event-emitter");
      eventEmitter.emitRequestFiltersUpdated();
    } catch {
      // 忽略导入错误
    }
  }
}
