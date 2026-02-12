import { describe, expect, test } from "vitest";

import { detectApiKeyWarnings } from "./api-key-warnings";

describe("detectApiKeyWarnings", () => {
  test("空值/空白：应返回空数组", () => {
    expect(detectApiKeyWarnings("")).toEqual([]);
    expect(detectApiKeyWarnings("   ")).toEqual([]);
  });

  test("包含中文：应提示 contains_non_ascii", () => {
    expect(detectApiKeyWarnings("sk-中文")).toContain("contains_non_ascii");
  });

  test("看起来像 Authorization/Bearer header：应提示 looks_like_auth_header", () => {
    expect(detectApiKeyWarnings("Bearer sk-123")).toContain("looks_like_auth_header");
    expect(detectApiKeyWarnings("Authorization: Bearer sk-123")).toContain(
      "looks_like_auth_header"
    );
    expect(detectApiKeyWarnings("x-api-key: sk-123")).toContain("looks_like_auth_header");
    expect(detectApiKeyWarnings("x-goog-api-key: sk-123")).toContain("looks_like_auth_header");
  });

  test("被引号包裹：应提示 wrapped_in_quotes", () => {
    expect(detectApiKeyWarnings('"sk-123"')).toContain("wrapped_in_quotes");
    expect(detectApiKeyWarnings("'sk-123'")).toContain("wrapped_in_quotes");
  });

  test("包含空白：非 JSON 时应提示 contains_whitespace", () => {
    expect(detectApiKeyWarnings("sk-12 3")).toContain("contains_whitespace");
    expect(detectApiKeyWarnings(" sk-123 ")).toContain("contains_whitespace");
    expect(detectApiKeyWarnings("sk-123\n456")).toContain("contains_whitespace");
  });

  test("包含不常见 ASCII 符号：非 JSON 时应提示 contains_uncommon_ascii", () => {
    expect(detectApiKeyWarnings("sk-123@456")).toContain("contains_uncommon_ascii");
    expect(detectApiKeyWarnings("sk-123;456")).toContain("contains_uncommon_ascii");
  });

  test("JSON 凭据：不应提示 contains_whitespace（避免误报）", () => {
    const json = `{\n  "access_token": "ya29.abc"\n}`;
    expect(detectApiKeyWarnings(json)).not.toContain("contains_whitespace");
  });
});
