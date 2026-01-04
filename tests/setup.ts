/**
 * Vitest 测试前置脚本
 *
 * 在所有测试运行前执行的全局配置
 */

import { config } from "dotenv";
import { afterAll, beforeAll } from "vitest";

// ==================== 加载环境变量 ====================

// 优先加载 .env.test（如果存在）
config({ path: ".env.test", quiet: true });

// 降级加载 .env
config({ path: ".env", quiet: true });

// ==================== 全局前置钩子 ====================

beforeAll(async () => {
  console.log("\nVitest 测试环境初始化...\n");

  // 安全检查：确保使用测试数据库
  const dsn = process.env.DSN || "";
  const dbName = dsn.split("/").pop() || "";

  if (process.env.NODE_ENV === "production") {
    throw new Error("禁止在生产环境运行测试");
  }

  // 强制要求：测试必须使用包含 'test' 的数据库（CI 和本地都检查）
  if (dbName && !dbName.includes("test")) {
    // 允许通过环境变量显式跳过检查（仅用于特殊情况）
    if (process.env.ALLOW_NON_TEST_DB !== "true") {
      throw new Error(
        `安全检查失败: 数据库名称必须包含 'test' 字样\n` +
          `   当前数据库: ${dbName}\n` +
          `   建议使用测试专用数据库（如 claude_code_hub_test）\n` +
          `   如需跳过检查，请设置环境变量: ALLOW_NON_TEST_DB=true`
      );
    }

    // 即使跳过检查也要发出警告
    console.warn("警告: 当前数据库不包含 'test' 字样");
    console.warn(`   数据库: ${dbName}`);
    console.warn("   建议使用独立的测试数据库避免数据污染\n");
  }

  // 显示测试配置
  console.log("测试配置:");
  console.log(`   - 数据库: ${dbName || "未配置"}`);
  console.log(`   - Redis: ${process.env.REDIS_URL?.split("//")[1]?.split("@")[1] || "未配置"}`);
  console.log(`   - API Base: ${process.env.API_BASE_URL || "http://localhost:13500"}`);
  console.log("");

  // 初始化默认错误规则（如果数据库可用）
  if (dsn) {
    try {
      const { syncDefaultErrorRules } = await import("@/repository/error-rules");
      await syncDefaultErrorRules();
      console.log("默认错误规则已同步\n");
    } catch (error) {
      console.warn("无法同步默认错误规则:", error);
    }
  }

  // ==================== 并行 Worker 清理协调 ====================
  // setupFiles 会在每个 worker 中执行；如果每个 worker 都在 afterAll 清理数据库，会出现“互相清理”的竞态。
  // 这里用 Redis 计数器实现：只有最后一个结束的 worker 才执行 cleanup。
  try {
    const shouldCleanup = Boolean(dsn) && process.env.AUTO_CLEANUP_TEST_DATA !== "false";
    if (!shouldCleanup) return;

    const dbNameForKey = dbName || "unknown";
    const counterKey = `cch:vitest:cleanup_workers:${dbNameForKey}`;
    const { getRedisClient } = await import("@/lib/redis");
    const redis = getRedisClient();
    if (!redis) return;

    // 等待连接就绪（enableOfflineQueue=false，未 ready 时发命令会直接报错）
    if (redis.status !== "ready") {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2000);
        redis.once("ready", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    if (redis.status !== "ready") {
      console.warn("Redis 未就绪，跳过并行清理协调（不影响测试结果）");
      return;
    }

    const current = await redis.incr(counterKey);
    if (current === 1) {
      // 防止异常退出导致计数器常驻
      await redis.expire(counterKey, 60 * 15);
    }
    process.env.__VITEST_CLEANUP_COUNTER_KEY__ = counterKey;
  } catch (error) {
    console.warn("并行清理协调初始化失败（不影响测试结果）:", error);
  }
});

// ==================== 全局清理钩子 ====================

afterAll(async () => {
  console.log("\nVitest 测试环境清理...\n");

  // 清理测试期间创建的用户（仅清理最近 10 分钟内的）
  const dsn = process.env.DSN || "";
  if (dsn && process.env.AUTO_CLEANUP_TEST_DATA !== "false") {
    try {
      // 仅最后一个 worker 执行清理，避免并发互相删除
      const counterKey = process.env.__VITEST_CLEANUP_COUNTER_KEY__;
      const { getRedisClient } = await import("@/lib/redis");
      const redis = counterKey ? getRedisClient() : null;

      if (counterKey && redis) {
        if (redis.status !== "ready") {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 2000);
            redis.once("ready", () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        }

        if (redis.status === "ready") {
          const remaining = await redis.decr(counterKey);
          if (remaining <= 0) {
            const { cleanupRecentTestData } = await import("./cleanup-utils");
            const result = await cleanupRecentTestData();
            if (result.deletedUsers > 0) {
              console.log(`自动清理：删除 ${result.deletedUsers} 个测试用户\n`);
            }
            await redis.del(counterKey);
          } else {
            // 非最后一个 worker：跳过清理
          }
        } else {
          console.warn("Redis 未就绪，跳过自动清理（不影响测试结果）");
        }
      } else {
        // 无 Redis 协调：为了避免竞态，默认跳过清理
        console.warn("未启用清理协调，跳过自动清理（不影响测试结果）");
      }
    } catch (error) {
      console.warn(
        "自动清理失败（不影响测试结果）:",
        error instanceof Error ? error.message : error
      );
    }
  }

  console.log("Vitest 测试环境清理完成\n");
});

// ==================== 全局 Mock 配置（可选）====================

// 如果需要 mock 某些全局对象，可以在这里配置
// 例如：mock console.error 以避免测试输出过多错误日志

// 保存原始 console.error
const originalConsoleError = console.error;

// 在测试中静默某些预期的错误（可选）
global.console.error = (...args: unknown[]) => {
  // 过滤掉某些已知的、预期的错误日志
  const message = args[0]?.toString() || "";

  // 跳过这些预期的错误日志
  const ignoredPatterns = [
    // 可以在这里添加需要忽略的错误模式
    // "某个预期的错误消息",
  ];

  const shouldIgnore = ignoredPatterns.some((pattern) => message.includes(pattern));

  if (!shouldIgnore) {
    originalConsoleError(...args);
  }
};

// ==================== 环境变量默认值 ====================

// 设置测试环境默认值（如果未配置）
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.API_BASE_URL = process.env.API_BASE_URL || "http://localhost:13500/api/actions";
// 便于 API 测试复用 ADMIN_TOKEN（validateKey 支持该 token 直通管理员会话）
process.env.TEST_ADMIN_TOKEN = process.env.TEST_ADMIN_TOKEN || process.env.ADMIN_TOKEN;

// ==================== React act 环境标记 ====================
// React 18+ 在测试环境中会检查该标记，避免出现 “not configured to support act(...)” 的噪声警告。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ==================== 全局超时配置 ====================

// 设置全局默认超时（可以被单个测试覆盖）
const DEFAULT_TIMEOUT = 10000; // 10 秒

// 导出配置供测试使用
export const TEST_CONFIG = {
  timeout: DEFAULT_TIMEOUT,
  apiBaseUrl: process.env.API_BASE_URL,
  skipAuthTests: !process.env.TEST_AUTH_TOKEN,
};
