/**
 * ApiError 本地化函数 localizeError 单元测试。
 *
 * 覆盖：
 * - 未提供 i18n 时：返回 errorCode 对应的 fallback（title 优先、然后 detail、然后 "Unknown error"）；
 * - 提供 i18n 时：返回翻译串，并把 errorParams 透传到 t(key, params)；
 * - i18n 翻译器抛错或返回原 key 时：降级到 title -> detail -> "Unknown error"。
 */

import { describe, expect, it, vi } from "vitest";
import { ApiError, localizeError } from "@/lib/api-client/v1/client";

function makeError(overrides: Partial<ConstructorParameters<typeof ApiError>[0]> = {}): ApiError {
  return new ApiError({
    status: 400,
    errorCode: "VALIDATION_FAILED",
    title: "Validation failed",
    detail: "name is required",
    ...overrides,
  });
}

describe("localizeError", () => {
  it("falls back to title when no i18n is provided", () => {
    const err = makeError();
    expect(localizeError(err)).toBe("Validation failed");
  });

  it("falls back to detail when no title is provided", () => {
    const err = makeError({ title: "" });
    expect(localizeError(err)).toBe("name is required");
  });

  it("falls back to 'Unknown error' when neither title nor detail is set", () => {
    const err = makeError({ title: "", detail: undefined });
    expect(localizeError(err)).toBe("Unknown error");
  });

  it("uses i18n translator with errors.api.<errorCode> key and errorParams", () => {
    const err = makeError({
      errorCode: "NAME_REQUIRED",
      errorParams: { field: "name" },
    });
    const t = vi.fn().mockImplementation((key: string, params?: Record<string, unknown>) => {
      if (key === "errors.api.NAME_REQUIRED") {
        return `Field ${(params as { field?: string } | undefined)?.field ?? ""} is required`;
      }
      return key;
    });
    const message = localizeError(err, { t });
    expect(t).toHaveBeenCalledWith("errors.api.NAME_REQUIRED", { field: "name" });
    expect(message).toBe("Field name is required");
  });

  it("falls back to title when translator returns the key unchanged (missing translation)", () => {
    const err = makeError({ errorCode: "MISSING_KEY" });
    const t = vi.fn().mockImplementation((key: string) => key);
    expect(localizeError(err, { t })).toBe("Validation failed");
  });

  it("falls back to title when translator throws", () => {
    const err = makeError({ errorCode: "THROWING_KEY" });
    const t = vi.fn().mockImplementation(() => {
      throw new Error("missing message");
    });
    expect(localizeError(err, { t })).toBe("Validation failed");
  });
});
