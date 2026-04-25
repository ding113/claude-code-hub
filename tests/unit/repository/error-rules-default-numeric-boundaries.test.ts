import { describe, expect, test, vi } from "vitest";

process.env.DSN = "";
process.env.AUTO_CLEANUP_TEST_DATA = "false";

type CapturedDefaultRule = {
  pattern: string;
  matchType: "contains" | "exact" | "regex";
  category: string;
};

type MockTransaction = {
  query: {
    errorRules: {
      findMany: () => Promise<unknown[]>;
    };
  };
  delete: () => {
    where: () => Promise<unknown[]>;
  };
  insert: () => {
    values: (rule: CapturedDefaultRule) => {
      onConflictDoNothing: () => {
        returning: () => Promise<Array<{ id: number }>>;
      };
    };
  };
  update: () => {
    set: () => {
      where: () => Promise<unknown[]>;
    };
  };
};

const capturedInsertedRules: CapturedDefaultRule[] = [];

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((...args: unknown[]) => ({ args, op: "desc" })),
  eq: vi.fn((...args: unknown[]) => ({ args, op: "eq" })),
  inArray: vi.fn((...args: unknown[]) => ({ args, op: "inArray" })),
}));

vi.mock("@/drizzle/schema", () => ({
  errorRules: {
    id: "error_rules.id",
    pattern: "error_rules.pattern",
    isDefault: "error_rules.is_default",
  },
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: MockTransaction) => Promise<void>) => {
      const tx: MockTransaction = {
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

describe("syncDefaultErrorRules numeric boundaries", () => {
  test("default regex rules do not match numeric substrings in request ids or prices", async () => {
    const regexRules = (await loadDefaultRules()).filter((rule) => rule.matchType === "regex");
    const samples = ["request id: 202604250550399959", "需要预扣费额度：¥0.352942"];

    const accidentalMatches = regexRules.flatMap((rule) => {
      const pattern = new RegExp(rule.pattern, "i");
      return samples
        .filter((sample) => pattern.test(sample))
        .map((sample) => ({ category: rule.category, pattern: rule.pattern, sample }));
    });

    expect(accidentalMatches).toEqual([]);
  });
});
