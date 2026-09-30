import { describe, expect, test, vi } from "vitest";

// 该测试通过 mock 仓储层验证默认规则内容，不需要真实 DB/Redis。
// 禁用 tests/setup.ts 中基于 DSN/Redis 的默认同步与清理协调，避免无关依赖引入。
process.env.DSN = "";
process.env.AUTO_CLEANUP_TEST_DATA = "false";

type CapturedDefaultRule = {
  pattern: string;
  matchType: "contains" | "exact" | "regex";
  category: string;
  description?: string;
  overrideResponse?: unknown;
  priority: number;
};

const capturedInsertedRules: CapturedDefaultRule[] = [];

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    desc: vi.fn((...args: unknown[]) => ({ args, op: "desc" })),
    eq: vi.fn((...args: unknown[]) => ({ args, op: "eq" })),
    inArray: vi.fn((...args: unknown[]) => ({ args, op: "inArray" })),
  };
});

vi.mock("@/drizzle/schema", () => ({
  errorRules: {
    id: "error_rules.id",
    pattern: "error_rules.pattern",
    isDefault: "error_rules.is_default",
  },
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
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
          values: (rule: CapturedDefaultRule) => {
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

async function loadDefaultRules(): Promise<CapturedDefaultRule[]> {
  capturedInsertedRules.length = 0;
  vi.resetModules();

  const { syncDefaultErrorRules } = await import("@/repository/error-rules");
  await syncDefaultErrorRules();

  return [...capturedInsertedRules];
}

function matches(rule: CapturedDefaultRule, sample: string): boolean {
  if (rule.matchType === "exact") return sample === rule.pattern;
  if (rule.matchType === "contains")
    return sample.toLowerCase().includes(rule.pattern.toLowerCase());

  return new RegExp(rule.pattern, "i").test(sample);
}

/**
 * 复刻 ErrorRuleDetector.detect() 的真实顺序：
 * 1. contains 规则优先（按 priority 升序、category 升序，来自 getActiveErrorRules 的 orderBy）
 * 2. 其次 exact
 * 3. 最后 regex（同样是 priority/category 升序）
 * 注意 priority 数值越小越先匹配，不能按降序筛选。
 */
function ruleFor(rules: CapturedDefaultRule[], sample: string): CapturedDefaultRule | undefined {
  const byOrder = (a: CapturedDefaultRule, b: CapturedDefaultRule) => a.priority - b.priority;
  const groups: Array<CapturedDefaultRule["matchType"]> = ["contains", "exact", "regex"];

  for (const type of groups) {
    const matched = [...rules]
      .filter((r) => r.matchType === type)
      .sort(byOrder)
      .find((r) => matches(r, sample));
    if (matched) return matched;
  }

  return undefined;
}

describe("default error rules: non-retryable client input errors", () => {
  test("oversized request payload is classified as a client input limit", async () => {
    const rules = await loadDefaultRules();

    // 上游原文（New API）与 CCH 包装后的文案都应命中
    const upstream =
      'Provider returned 400: Bad Request | Upstream: {"error":{"message":"Request payload is too large (request id: 2026092509221799795870936468c0eXXXX)"}}';
    const matched = ruleFor(rules, upstream);

    expect(matched?.category).toBe("input_limit");
    expect(matched?.matchType).toBe("contains");
  });

  test("inline image count limit is classified as a media limit", async () => {
    const rules = await loadDefaultRules();

    const upstream =
      'Upstream: {"error":{"message":"basispoints accepts at most 20 inline images per request (request id: 2026092508482480858398136468c0eXXXX)"}}';
    const matched = ruleFor(rules, upstream);

    expect(matched?.category).toBe("media_limit");
    expect(matched?.matchType).toBe("regex");
  });

  test("upstream sensitive word rejection is classified as a content filter", async () => {
    const rules = await loadDefaultRules();

    const upstream =
      "Provider returned 403: new_api_error: sensitive words detected (request id: 2026092406384125790606236468c0eFhmvSctr)";
    const matched = ruleFor(rules, upstream);

    expect(matched?.category).toBe("content_filter");
  });

  test("all three rules carry a client-facing override message", async () => {
    const rules = await loadDefaultRules();
    const samples = [
      "Request payload is too large",
      "accepts at most 20 inline images per request",
      "sensitive words detected",
    ];

    for (const sample of samples) {
      const matched = ruleFor(rules, sample);
      expect(matched, `no default rule matched: ${sample}`).toBeDefined();
      const override = matched?.overrideResponse as { error?: { message?: string } } | undefined;
      expect(override?.error?.message, `missing override message for: ${sample}`).toBeTruthy();
    }
  });

  test("new rules stay default rules so they sync on upgrade", async () => {
    const rules = await loadDefaultRules();

    const newPatterns = [
      "Request payload is too large",
      "accepts at most \\d+ inline images",
      "sensitive words detected",
    ];

    for (const pattern of newPatterns) {
      const rule = rules.find((candidate) => candidate.pattern === pattern);
      expect(rule, `default rule not seeded: ${pattern}`).toBeDefined();
      expect((rule as CapturedDefaultRule & { isDefault?: boolean }).isDefault).not.toBe(false);
      expect((rule as CapturedDefaultRule & { isEnabled?: boolean }).isEnabled).not.toBe(false);
    }
  });

  test("new rules do not match unrelated upstream failures", async () => {
    const rules = await loadDefaultRules();

    // 429 限流、524 超时、额度不足属于上游/账号问题，仍需保留故障切换与熔断语义
    const unrelated = [
      "当前模型服务暂不可用，请稍后重试",
      "月卡额度不足，且通用额度不足",
      "shu26.cfd | 524: A timeout occurred",
      "rate_limit_exceeded",
      "system memory overloaded (current: 95.5%, threshold: 90%)",
    ];

    for (const sample of unrelated) {
      const matched = ruleFor(rules, sample);
      expect(
        ["input_limit", "media_limit", "content_filter"].includes(matched?.category ?? ""),
        `unexpected client-error match for: ${sample} -> ${matched?.pattern}`
      ).toBe(false);
    }
  });
});
