import { describe, expect, test } from "vitest";
import {
  ApiError,
  getApiErrorMessageKey,
  getApiErrorMessageParams,
} from "@/lib/api-client/v1/errors";

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
});
