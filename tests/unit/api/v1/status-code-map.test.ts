/**
 * /api/v1 错误类别 -> HTTP 状态码 映射：单元测试
 *
 * 验证：
 * - plan 文档「Status map」中列出的所有类别都能命中映射表；
 * - 未知类别回退为 500；
 * - 405 method_not_allowed / 410 gone / 415 unsupported_media_type 这些非主路径的常见类别也要覆盖。
 */

import { describe, expect, it } from "vitest";

import { pickStatus, STATUS_CODE_MAP } from "@/lib/api/v1/_shared/status-code-map";

describe("status-code-map", () => {
  it("maps the canonical Status map entries from the plan", () => {
    expect(pickStatus("validation")).toBe(400);
    expect(pickStatus("validation_failed")).toBe(400);
    expect(pickStatus("not_found")).toBe(404);
    expect(pickStatus("conflict")).toBe(409);
    expect(pickStatus("unprocessable")).toBe(422);
    expect(pickStatus("rate_limited")).toBe(429);
    expect(pickStatus("internal")).toBe(500);
    expect(pickStatus("dependency_unavailable")).toBe(503);
  });

  it("maps unauthorized / forbidden / method_not_allowed / gone", () => {
    expect(pickStatus("unauthorized")).toBe(401);
    expect(pickStatus("forbidden")).toBe(403);
    expect(pickStatus("method_not_allowed")).toBe(405);
    expect(pickStatus("gone")).toBe(410);
  });

  it("maps unsupported_media_type and malformed_json (request body errors)", () => {
    expect(pickStatus("unsupported_media_type")).toBe(415);
    expect(pickStatus("malformed_json")).toBe(400);
  });

  it("falls back to 500 for unknown error codes (loud failure)", () => {
    expect(pickStatus("totally_unknown_xyz")).toBe(500);
    expect(pickStatus("")).toBe(500);
  });

  it("STATUS_CODE_MAP exposes all of the categories used by handlers", () => {
    const expected = [
      "validation",
      "validation_failed",
      "malformed_json",
      "bad_request",
      "unauthorized",
      "forbidden",
      "csrf_failed",
      "not_found",
      "method_not_allowed",
      "conflict",
      "gone",
      "unsupported_media_type",
      "unprocessable",
      "unprocessable_entity",
      "rate_limited",
      "internal",
      "internal_error",
      "dependency_unavailable",
    ] as const;
    for (const key of expected) {
      expect(STATUS_CODE_MAP[key]).toBeTypeOf("number");
    }
  });
});
