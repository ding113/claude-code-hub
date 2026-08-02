import { describe, expect, test } from "vitest";
import {
  ApiError,
  getApiErrorMessageKey,
  getApiErrorMessageParams,
} from "@/lib/api-client/v1/errors";
import enDashboard from "../../../messages/en/dashboard.json";
import jaDashboard from "../../../messages/ja/dashboard.json";
import ruDashboard from "../../../messages/ru/dashboard.json";
import zhCNDashboard from "../../../messages/zh-CN/dashboard.json";
import zhTWDashboard from "../../../messages/zh-TW/dashboard.json";

describe("v1 API error i18n mapping", () => {
  test("maps problem error codes to existing translation keys instead of raw details", () => {
    const error = new ApiError({
      status: 403,
      errorCode: "auth.forbidden",
      detail: "Admin access is required.",
    });

    expect(getApiErrorMessageKey(error)).toBe("PERMISSION_DENIED");
  });

  test("drops non-primitive error params before passing them to next-intl", () => {
    const error = new ApiError({
      status: 400,
      errorCode: "BATCH_SIZE_EXCEEDED",
      detail: "Too many items.",
      errorParams: { max: 500, nested: { ignored: true }, field: "providerIds" },
    });

    expect(getApiErrorMessageParams(error)).toEqual({ max: 500, field: "providerIds" });
  });

  test("uses the generic translation key for unstructured fetch fallbacks", () => {
    const error = new ApiError({
      status: 500,
      errorCode: "api.error",
      detail: "Request failed",
    });

    expect(getApiErrorMessageKey(error)).toBe("INTERNAL_ERROR");
  });

  test("maps provider endpoint and vendor REST codes to existing translation keys", () => {
    expect(
      getApiErrorMessageKey(
        new ApiError({
          status: 404,
          errorCode: "provider_endpoint.not_found",
          detail: "Not found",
        })
      )
    ).toBe("NOT_FOUND");

    expect(
      getApiErrorMessageKey(
        new ApiError({
          status: 400,
          errorCode: "provider_vendor.action_failed",
          detail: "Bad request",
        })
      )
    ).toBe("OPERATION_FAILED");
  });

  test("maps key and user REST codes to existing translation keys", () => {
    expect(
      getApiErrorMessageKey(
        new ApiError({ status: 404, errorCode: "key.not_found", detail: "Not found" })
      )
    ).toBe("KEY_NOT_FOUND");

    expect(
      getApiErrorMessageKey(
        new ApiError({ status: 400, errorCode: "key.action_failed", detail: "Bad request" })
      )
    ).toBe("OPERATION_FAILED");

    expect(
      getApiErrorMessageKey(
        new ApiError({ status: 404, errorCode: "user.not_found", detail: "Not found" })
      )
    ).toBe("USER_NOT_FOUND");

    expect(
      getApiErrorMessageKey(
        new ApiError({ status: 400, errorCode: "user.action_failed", detail: "Bad request" })
      )
    ).toBe("OPERATION_FAILED");
  });

  test("maps Session REST codes to existing translation keys", () => {
    expect(
      getApiErrorMessageKey(
        new ApiError({ status: 404, errorCode: "session.not_found", detail: "Not found" })
      )
    ).toBe("NOT_FOUND");

    expect(
      getApiErrorMessageKey(
        new ApiError({ status: 400, errorCode: "session.action_failed", detail: "Bad request" })
      )
    ).toBe("OPERATION_FAILED");
  });

  test("defines Session detail identity and error labels in every locale", () => {
    for (const dashboard of [enDashboard, zhCNDashboard, zhTWDashboard, jaDashboard, ruDashboard]) {
      expect(dashboard.sessions.status.error).toBeTruthy();
      expect(dashboard.sessions.details.canonicalSessionId).toBeTruthy();
      expect(dashboard.sessions.details.clientSessionId).toBeTruthy();
      expect(dashboard.logs.details.metadata.canonicalSessionId).toBeTruthy();
      expect(dashboard.logs.details.metadata.clientSessionId).toBeTruthy();
    }
  });
});
