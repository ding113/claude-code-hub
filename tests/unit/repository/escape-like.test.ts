import { describe, expect, test } from "vitest";

import { escapeLike } from "@/repository/_shared/like";

describe("escapeLike", () => {
  test("普通字符串保持不变", () => {
    expect(escapeLike("abc-123")).toBe("abc-123");
  });

  test("%/_/\\\\ 应被转义（用于 LIKE ... ESCAPE '\\\\'）", () => {
    expect(escapeLike("%")).toBe("\\%");
    expect(escapeLike("_")).toBe("\\_");
    expect(escapeLike("\\")).toBe("\\\\");
  });

  test("组合输入应按字面量匹配语义转义", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });

  test("空字符串应返回空字符串", () => {
    expect(escapeLike("")).toBe("");
  });
});
