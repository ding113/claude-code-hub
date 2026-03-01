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

describe("syncDefaultErrorRules - OpenAI Responses API error rules", () => {
  test("should include store=false rule with OpenAI error format", async () => {
    capturedInsertedRules.length = 0;
    vi.resetModules();

    const { syncDefaultErrorRules } = await import("@/repository/error-rules");
    await syncDefaultErrorRules();

    const rule = capturedInsertedRules.find((r) => r.pattern === "Items are not persisted when");
    expect(rule).toBeTruthy();

    expect(rule.matchType).toBe("contains");
    expect(rule.category).toBe("store_error");
    expect(rule.priority).toBe(73);

    // OpenAI error format (no top-level type field)
    expect(rule.overrideResponse?.error?.type).toBe("invalid_request_error");
    expect(rule.overrideResponse?.error?.message).toContain("store=false");
    expect(rule.overrideResponse?.error?.message).toContain("store=true");
    expect(rule.overrideResponse?.error?.message).toContain("rs_xxx");
  });

  test("should include input-must-be-a-list rule with OpenAI error format", async () => {
    capturedInsertedRules.length = 0;
    vi.resetModules();

    const { syncDefaultErrorRules } = await import("@/repository/error-rules");
    await syncDefaultErrorRules();

    const rule = capturedInsertedRules.find((r) => r.pattern === "Input must be a list");
    expect(rule).toBeTruthy();

    expect(rule.matchType).toBe("contains");
    expect(rule.category).toBe("parameter_error");
    expect(rule.priority).toBe(74);

    // OpenAI error format with param field
    expect(rule.overrideResponse?.error?.type).toBe("invalid_request_error");
    expect(rule.overrideResponse?.error?.param).toBe("input");
    expect(rule.overrideResponse?.error?.message).toContain("input");
  });
});
