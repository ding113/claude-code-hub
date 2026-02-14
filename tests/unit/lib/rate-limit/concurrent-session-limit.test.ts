import { describe, expect, it } from "vitest";
import { resolveKeyConcurrentSessionLimit } from "@/lib/rate-limit/concurrent-session-limit";

describe("resolveKeyConcurrentSessionLimit", () => {
  const cases: Array<{
    title: string;
    keyLimit: number | null | undefined;
    userLimit: number | null | undefined;
    expected: number;
  }> = [
    { title: "Key > 0 时应优先使用 Key", keyLimit: 10, userLimit: 15, expected: 10 },
    { title: "Key 为 0 时应回退到 User", keyLimit: 0, userLimit: 15, expected: 15 },
    { title: "Key 为 null 时应回退到 User", keyLimit: null, userLimit: 15, expected: 15 },
    { title: "Key 为 undefined 时应回退到 User", keyLimit: undefined, userLimit: 15, expected: 15 },
    {
      title: "Key 为 NaN 时应回退到 User",
      keyLimit: Number.NaN,
      userLimit: 15,
      expected: 15,
    },
    {
      title: "Key 为 Infinity 时应回退到 User",
      keyLimit: Number.POSITIVE_INFINITY,
      userLimit: 15,
      expected: 15,
    },
    { title: "Key < 0 时应回退到 User", keyLimit: -1, userLimit: 15, expected: 15 },
    { title: "Key 为小数时应向下取整", keyLimit: 5.9, userLimit: 15, expected: 5 },
    { title: "Key 小数 < 1 时应回退到 User", keyLimit: 0.9, userLimit: 15, expected: 15 },
    { title: "User 为小数时应向下取整", keyLimit: 0, userLimit: 7.8, expected: 7 },
    {
      title: "Key 与 User 均未设置/无效时应返回 0（无限制）",
      keyLimit: undefined,
      userLimit: null,
      expected: 0,
    },
    {
      title: "Key 为 0 且 User 为 Infinity 时应返回 0（无限制）",
      keyLimit: 0,
      userLimit: Number.POSITIVE_INFINITY,
      expected: 0,
    },
  ];

  for (const testCase of cases) {
    it(testCase.title, () => {
      expect(resolveKeyConcurrentSessionLimit(testCase.keyLimit, testCase.userLimit)).toBe(
        testCase.expected
      );
    });
  }
});
