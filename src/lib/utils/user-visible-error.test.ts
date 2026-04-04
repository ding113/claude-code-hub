import { describe, expect, test, vi } from "vitest";

import {
  getSafeErrorToastMessage,
  installErrorToastSanitizer,
  sanitizeUserVisibleErrorMessage,
} from "@/lib/utils/user-visible-error";

describe("user-visible-error", () => {
  test("preserves ordinary user-safe messages", () => {
    expect(getSafeErrorToastMessage("Provider probe failed", "Operation failed")).toBe(
      "Provider probe failed"
    );
    expect(getSafeErrorToastMessage("Please select from the list", "Operation failed")).toBe(
      "Please select from the list"
    );
  });

  test("falls back when database error includes query details", () => {
    const rawMessage =
      'db query error: query: SELECT * FROM keys WHERE key = \'sk-live-secret123456\'; result: [{"key":"sk-live-secret123456"}]';

    expect(getSafeErrorToastMessage(rawMessage, "Operation failed")).toBe("Operation failed");
  });

  test("redacts secrets when no fallback is available", () => {
    expect(
      sanitizeUserVisibleErrorMessage("request failed for apiKey=sk-live-secret1234567890")
    ).toContain("[REDACTED]");
  });

  test("installs a global toast sanitizer", () => {
    const originalError = vi.fn();
    const toastApi = {
      error: originalError,
    };

    installErrorToastSanitizer(toastApi, "Operation failed");

    toastApi.error(
      'db query error: query: SELECT * FROM keys WHERE key = \'sk-live-secret123456\'; result: [{"key":"sk-live-secret123456"}]'
    );

    expect(originalError).toHaveBeenCalledWith("db query error");
  });

  test("uses a generic fallback when the raw toast message starts with query details", () => {
    const originalError = vi.fn();
    const toastApi = {
      error: originalError,
    };

    installErrorToastSanitizer(toastApi, "Operation failed");

    toastApi.error("query: SELECT * FROM keys WHERE key = 'sk-live-secret123456'");

    expect(originalError).toHaveBeenCalledWith("Operation failed");
  });

  test("sanitizes toast descriptions too", () => {
    const originalError = vi.fn();
    const toastApi = {
      error: originalError,
    };

    installErrorToastSanitizer(toastApi, "Operation failed");

    toastApi.error("Save failed", {
      description:
        'db query error: query: SELECT * FROM keys WHERE key = \'sk-live-secret123456\'; result: [{"key":"[REDACTED:sk-secret]"}]',
    });

    expect(originalError).toHaveBeenCalledWith("Save failed", {
      description: "db query error",
    });
  });

  test("keeps zero-argument toast calls unchanged", () => {
    const originalError = vi.fn();
    const toastApi = {
      error: originalError,
    };

    installErrorToastSanitizer(toastApi, "Operation failed");

    toastApi.error();

    expect(originalError).toHaveBeenCalledWith();
  });

  test("redacts assignment secrets that contain spaces", () => {
    expect(sanitizeUserVisibleErrorMessage("validation failed: password: my secret password")).toBe(
      "validation failed: password: [REDACTED]"
    );
  });

  test("updates the fallback message when reinstalling for a new locale", () => {
    const originalError = vi.fn();
    const toastApi = {
      error: originalError,
    };

    installErrorToastSanitizer(toastApi, "Operation failed");
    installErrorToastSanitizer(toastApi, "操作失败");

    toastApi.error("query: SELECT * FROM keys");

    expect(originalError).toHaveBeenCalledWith("操作失败");
  });
});
