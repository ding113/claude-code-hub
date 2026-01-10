import { describe, expect, test, vi } from "vitest";

// 该测试通过 mock 仓储层验证默认规则内容，不需要真实 DB/Redis。
// 禁用 tests/setup.ts 中基于 DSN/Redis 的默认同步与清理协调，避免无关依赖引入。
process.env.DSN = "";
process.env.AUTO_CLEANUP_TEST_DATA = "false";

const capturedInsertedRules: any[] = [];

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    // 仅用于构造查询条件参数，单测不关心其实现细节
    desc: vi.fn((...args: unknown[]) => ({ args, op: "desc" })),
    eq: vi.fn((...args: unknown[]) => ({ args, op: "eq" })),
    inArray: vi.fn((...args: unknown[]) => ({ args, op: "inArray" })),
  };
});

vi.mock("@/drizzle/schema", () => ({
  // 仅需提供被 syncDefaultErrorRules 用到的字段占位符
  errorRules: {
    id: "error_rules.id",
    pattern: "error_rules.pattern",
    isDefault: "error_rules.is_default",
  },
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => {
      const tx = {
        query: {
          errorRules: {
            findMany: vi.fn(async () => []),
          },
        },
        delete: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
        insert: vi.fn(() => ({
          values: (rule: any) => {
            capturedInsertedRules.push(rule);
            return {
              onConflictDoNothing: () => ({
                returning: vi.fn(async () => [{ id: 1 }]),
              }),
            };
          },
        })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(async () => []),
          })),
        })),
      };

      await fn(tx);
    }),
  },
}));

vi.mock("@/lib/emit-event", () => ({
  emitErrorRulesUpdated: vi.fn(async () => {}),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

describe("syncDefaultErrorRules - 默认 thinking/tool_use 兜底规则", () => {
  test("应包含 must start with a thinking block 的默认规则，并提供可操作提示", async () => {
    capturedInsertedRules.length = 0;
    vi.resetModules();

    const { syncDefaultErrorRules } = await import("@/repository/error-rules");
    await syncDefaultErrorRules();

    const rule = capturedInsertedRules.find(
      (r) => r.pattern === "must start with a thinking block"
    );
    expect(rule).toBeTruthy();

    expect(rule.matchType).toBe("contains");
    expect(rule.category).toBe("thinking_error");

    // 覆写响应需为 Claude 错误格式，且包含清晰的自助修复建议
    expect(rule.overrideResponse?.type).toBe("error");
    expect(rule.overrideResponse?.error?.type).toBe("thinking_error");
    expect(rule.overrideResponse?.error?.message).toContain("tool_result");
    expect(rule.overrideResponse?.error?.message).toContain("signature");
    expect(rule.overrideResponse?.error?.message).toContain("关闭");
  });

  test("应包含 Expected thinking/redacted_thinking but found tool_use 的默认规则，并提供可操作提示", async () => {
    capturedInsertedRules.length = 0;
    vi.resetModules();

    const { syncDefaultErrorRules } = await import("@/repository/error-rules");
    await syncDefaultErrorRules();

    const rule = capturedInsertedRules.find(
      (r) =>
        typeof r?.pattern === "string" &&
        r.pattern.includes("redacted_thinking") &&
        r.pattern.includes("tool_use") &&
        r.pattern.toLowerCase().includes("expected")
    );
    expect(rule).toBeTruthy();

    expect(rule.matchType).toBe("regex");
    expect(rule.category).toBe("thinking_error");
    expect(rule.priority).toBe(68);

    // 覆写响应需为 Claude 错误格式，且包含清晰的自助修复建议
    expect(rule.overrideResponse?.type).toBe("error");
    expect(rule.overrideResponse?.error?.type).toBe("thinking_error");
    expect(rule.overrideResponse?.error?.message).toContain("tool_result");
    expect(rule.overrideResponse?.error?.message).toContain("signature");
    expect(rule.overrideResponse?.error?.message).toContain("关闭");
  });
});
