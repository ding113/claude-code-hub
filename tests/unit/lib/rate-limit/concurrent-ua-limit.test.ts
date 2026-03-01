import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeConcurrentUaLimit,
  resolveConcurrentUaIdentity,
  resolveKeyConcurrentUaLimit,
  resolveKeyUserConcurrentUaLimits,
} from "@/lib/rate-limit/concurrent-ua-limit";

describe("resolveKeyConcurrentUaLimit", () => {
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
      expect(resolveKeyConcurrentUaLimit(testCase.keyLimit, testCase.userLimit)).toBe(
        testCase.expected
      );
    });
  }
});

describe("normalizeConcurrentUaLimit", () => {
  const cases: Array<{ title: string; input: number | null | undefined; expected: number }> = [
    { title: "null 应归一化为 0", input: null, expected: 0 },
    { title: "undefined 应归一化为 0", input: undefined, expected: 0 },
    { title: "0 应归一化为 0", input: 0, expected: 0 },
    { title: "负数应归一化为 0", input: -1, expected: 0 },
    { title: "NaN 应归一化为 0", input: Number.NaN, expected: 0 },
    { title: "Infinity 应归一化为 0", input: Number.POSITIVE_INFINITY, expected: 0 },
    { title: "正整数应保持不变", input: 15, expected: 15 },
    { title: "小数应向下取整", input: 7.9, expected: 7 },
    { title: "小数 < 1 应向下取整为 0", input: 0.9, expected: 0 },
  ];

  for (const testCase of cases) {
    it(testCase.title, () => {
      expect(normalizeConcurrentUaLimit(testCase.input)).toBe(testCase.expected);
    });
  }
});

describe("resolveKeyUserConcurrentUaLimits", () => {
  it("Key 未设置且 User 已设置时：effectiveKeyLimit 应继承 User，且 enabled=true", () => {
    const result = resolveKeyUserConcurrentUaLimits(0, 15);
    expect(result).toEqual({ effectiveKeyLimit: 15, normalizedUserLimit: 15, enabled: true });
  });

  it("Key 已设置且 User 已设置时：Key 优先，User 保留为 normalizedUserLimit", () => {
    const result = resolveKeyUserConcurrentUaLimits(10, 15);
    expect(result).toEqual({ effectiveKeyLimit: 10, normalizedUserLimit: 15, enabled: true });
  });

  it("Key/User 均未设置时：enabled=false", () => {
    const result = resolveKeyUserConcurrentUaLimits(0, null);
    expect(result).toEqual({ effectiveKeyLimit: 0, normalizedUserLimit: 0, enabled: false });
  });
});

describe("resolveConcurrentUaIdentity", () => {
  it("应优先使用解析出的 clientType 作为 bucket（且 sha256 稳定）", () => {
    const uaV1 = "claude-cli/2.0.31 (external, cli)";
    const uaV2 = "claude-cli/2.0.32 (external, cli)";

    const idV1 = resolveConcurrentUaIdentity(uaV1);
    const idV2 = resolveConcurrentUaIdentity(uaV2);

    expect(idV1.bucket).toBe("claude-cli");
    expect(idV2.bucket).toBe("claude-cli");
    expect(idV1.id).toBe(idV2.id);
  });

  it("应在解析失败时回退到原始 UA（trim 后）", () => {
    const raw = "  Mozilla/5.0  ";
    const result = resolveConcurrentUaIdentity(raw);
    expect(result.bucket).toBe("Mozilla/5.0");
  });

  it("当 UA 为空时 bucket 应为 unknown", () => {
    const result = resolveConcurrentUaIdentity(null);
    expect(result.bucket).toBe("unknown");
  });

  it("应返回 ua:sha256(bucket) 的 member 形式", () => {
    const ua = "anthropic-sdk-typescript/1.0.0";
    const { bucket, id } = resolveConcurrentUaIdentity(ua);

    const expectedId = `ua:${crypto.createHash("sha256").update(bucket, "utf8").digest("hex")}`;
    expect(id).toBe(expectedId);
    expect(id.startsWith("ua:")).toBe(true);
    expect(id.length).toBe(3 + 64);
  });
});
