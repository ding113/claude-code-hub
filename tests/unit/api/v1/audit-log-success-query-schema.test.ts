import { describe, expect, test } from "vitest";

import { AuditLogListQuerySchema } from "@/lib/api/v1/schemas/audit-logs";

describe("v1 AuditLogListQuerySchema - success 过滤器查询字符串解析", () => {
  test("success=true 解析为 true", () => {
    const result = AuditLogListQuerySchema.safeParse({ success: "true" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
  });

  test("success=false 解析为 false（防止 Boolean('false')===true 的回归）", () => {
    const result = AuditLogListQuerySchema.safeParse({ success: "false" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(false);
    }
  });

  test("缺省 success 时保持 undefined（不应用过滤器）", () => {
    const result = AuditLogListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBeUndefined();
    }
  });

  test("不支持的字符串被拒绝，返回校验错误", () => {
    const result = AuditLogListQuerySchema.safeParse({ success: "maybe" });
    expect(result.success).toBe(false);
  });
});
