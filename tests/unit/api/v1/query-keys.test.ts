/**
 * /api/v1 查询键注册表测试。
 *
 * 验证：
 * - `v1Keys.all` 严格等价于 ["v1"]（只读元组）；
 * - 注册表的现有键互不重复，为后续资源扩展提供基础保证。
 */

import { describe, expect, it } from "vitest";
import { v1Keys } from "@/lib/api-client/v1/keys";

describe("v1 query keys", () => {
  it("v1Keys.all === ['v1']", () => {
    expect(v1Keys.all).toEqual(["v1"]);
    // 类型层面的只读元组在运行时表现为普通数组；这里仅做内容相等断言。
  });

  it("registry keys are unique (no duplicate top-level entries)", () => {
    const entries = Object.values(v1Keys).map((value) => JSON.stringify(value));
    const unique = new Set(entries);
    expect(unique.size).toBe(entries.length);
  });
});
