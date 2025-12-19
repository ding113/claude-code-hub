/**
 * Vitest 测试前置脚本
 *
 * 在所有测试运行前执行的全局配置
 */

import { config } from "dotenv";
import { afterAll, beforeAll } from "vitest";

// ==================== 加载环境变量 ====================

// 优先加载 .env.test（如果存在）
config({ path: ".env.test" });

// 降级加载 .env
config({ path: ".env" });

// ==================== 全局前置钩子 ====================

beforeAll(async () => {
  console.log("\n🧪 Vitest 测试环境初始化...\n");

  // 安全检查：确保使用测试数据库
  const dsn = process.env.DSN || "";
  const dbName = dsn.split("/").pop() || "";

  if (process.env.NODE_ENV === "production") {
    throw new Error("❌ 禁止在生产环境运行测试");
  }

  // 强制要求：测试必须使用包含 'test' 的数据库（CI 和本地都检查）
  if (dbName && !dbName.includes("test")) {
    // 允许通过环境变量显式跳过检查（仅用于特殊情况）
    if (process.env.ALLOW_NON_TEST_DB !== "true") {
      throw new Error(
        `❌ 安全检查失败: 数据库名称必须包含 'test' 字样\n` +
          `   当前数据库: ${dbName}\n` +
          `   建议使用测试专用数据库（如 claude_code_hub_test）\n` +
          `   如需跳过检查，请设置环境变量: ALLOW_NON_TEST_DB=true`
      );
    }

    // 即使跳过检查也要发出警告
    console.warn("⚠️  警告: 当前数据库不包含 'test' 字样");
    console.warn(`   数据库: ${dbName}`);
    console.warn("   建议使用独立的测试数据库避免数据污染\n");
  }

  // 显示测试配置
  console.log("📋 测试配置:");
  console.log(`   - 数据库: ${dbName || "未配置"}`);
  console.log(`   - Redis: ${process.env.REDIS_URL?.split("//")[1]?.split("@")[1] || "未配置"}`);
  console.log(`   - API Base: ${process.env.API_BASE_URL || "http://localhost:13500"}`);
  console.log("");

  // 初始化默认错误规则（如果数据库可用）
  if (dsn) {
    try {
      const { syncDefaultErrorRules } = await import("@/repository/error-rules");
      await syncDefaultErrorRules();
      console.log("✅ 默认错误规则已同步\n");
    } catch (error) {
      console.warn("⚠️  无法同步默认错误规则:", error);
    }
  }
});

// ==================== 全局清理钩子 ====================

afterAll(async () => {
  console.log("\n🧹 Vitest 测试环境清理...\n");

  // 清理测试期间创建的用户（仅清理最近 10 分钟内的）
  const dsn = process.env.DSN || "";
  if (dsn && process.env.AUTO_CLEANUP_TEST_DATA !== "false") {
    try {
      const { cleanupRecentTestData } = await import("./cleanup-utils");
      const result = await cleanupRecentTestData();
      if (result.deletedUsers > 0) {
        console.log(`✅ 自动清理：删除 ${result.deletedUsers} 个测试用户\n`);
      }
    } catch (error) {
      console.warn(
        "⚠️  自动清理失败（不影响测试结果）:",
        error instanceof Error ? error.message : error
      );
    }
  }

  console.log("🧹 Vitest 测试环境清理完成\n");
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

// ==================== 全局超时配置 ====================

// 设置全局默认超时（可以被单个测试覆盖）
const DEFAULT_TIMEOUT = 10000; // 10 秒

// 导出配置供测试使用
export const TEST_CONFIG = {
  timeout: DEFAULT_TIMEOUT,
  apiBaseUrl: process.env.API_BASE_URL,
  skipAuthTests: !process.env.TEST_AUTH_TOKEN,
};
