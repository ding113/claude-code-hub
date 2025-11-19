/**
 * Error Code Mapping System for i18n Error Messages
 *
 * This module provides a centralized error code system that enables dynamic error message
 * translation across the application. Error codes are mapped to translated messages on the
 * client side, supporting parameter interpolation for context-specific errors.
 *
 * @example
 * // Server action returns error code
 * return { ok: false, errorCode: "USER_NAME_REQUIRED" };
 *
 * // Client translates error code
 * const t = useTranslations("errors");
 * const message = t(result.errorCode); // "User name is required"
 */

/**
 * Error Code Categories
 *
 * Organized by domain for maintainability:
 * - VALIDATION_*: Form validation errors
 * - AUTH_*: Authentication/authorization errors
 * - SERVER_*: Server-side errors
 * - NETWORK_*: Network/connection errors
 * - BUSINESS_*: Business logic errors
 */

// Validation Error Codes
export const VALIDATION_ERRORS = {
  // Required field errors
  REQUIRED_FIELD: "REQUIRED_FIELD",
  USER_NAME_REQUIRED: "USER_NAME_REQUIRED",
  API_KEY_REQUIRED: "API_KEY_REQUIRED",
  PROVIDER_NAME_REQUIRED: "PROVIDER_NAME_REQUIRED",
  PROVIDER_URL_REQUIRED: "PROVIDER_URL_REQUIRED",

  // String validation errors
  MIN_LENGTH: "MIN_LENGTH",
  MAX_LENGTH: "MAX_LENGTH",
  INVALID_EMAIL: "INVALID_EMAIL",
  INVALID_URL: "INVALID_URL",

  // Number validation errors
  MIN_VALUE: "MIN_VALUE",
  MAX_VALUE: "MAX_VALUE",
  MUST_BE_INTEGER: "MUST_BE_INTEGER",
  MUST_BE_POSITIVE: "MUST_BE_POSITIVE",

  // Type errors
  INVALID_TYPE: "INVALID_TYPE",
  INVALID_FORMAT: "INVALID_FORMAT",

  // Business validation
  DUPLICATE_NAME: "DUPLICATE_NAME",
  INVALID_RANGE: "INVALID_RANGE",
  EMPTY_UPDATE: "EMPTY_UPDATE",
} as const;

// Authentication Error Codes
export const AUTH_ERRORS = {
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  INVALID_TOKEN: "INVALID_TOKEN",
} as const;

// Server Error Codes
export const SERVER_ERRORS = {
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  NOT_FOUND: "NOT_FOUND",
  OPERATION_FAILED: "OPERATION_FAILED",
  CREATE_FAILED: "CREATE_FAILED",
  UPDATE_FAILED: "UPDATE_FAILED",
  DELETE_FAILED: "DELETE_FAILED",
} as const;

// Network Error Codes
export const NETWORK_ERRORS = {
  CONNECTION_FAILED: "CONNECTION_FAILED",
  TIMEOUT: "TIMEOUT",
  NETWORK_ERROR: "NETWORK_ERROR",
} as const;

// Business Logic Error Codes
export const BUSINESS_ERRORS = {
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  RESOURCE_BUSY: "RESOURCE_BUSY",
  INVALID_STATE: "INVALID_STATE",
  CONFLICT: "CONFLICT",
} as const;

// Rate Limit Error Codes
export const RATE_LIMIT_ERRORS = {
  RATE_LIMIT_RPM_EXCEEDED: "RATE_LIMIT_RPM_EXCEEDED",
  RATE_LIMIT_5H_EXCEEDED: "RATE_LIMIT_5H_EXCEEDED",
  RATE_LIMIT_WEEKLY_EXCEEDED: "RATE_LIMIT_WEEKLY_EXCEEDED",
  RATE_LIMIT_MONTHLY_EXCEEDED: "RATE_LIMIT_MONTHLY_EXCEEDED",
  RATE_LIMIT_CONCURRENT_SESSIONS_EXCEEDED: "RATE_LIMIT_CONCURRENT_SESSIONS_EXCEEDED",
  RATE_LIMIT_DAILY_QUOTA_EXCEEDED: "RATE_LIMIT_DAILY_QUOTA_EXCEEDED",
} as const;

/**
 * All Error Codes Union
 */
export const ERROR_CODES = {
  ...VALIDATION_ERRORS,
  ...AUTH_ERRORS,
  ...SERVER_ERRORS,
  ...NETWORK_ERRORS,
  ...BUSINESS_ERRORS,
  ...RATE_LIMIT_ERRORS,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Error Message Parameters
 *
 * Type-safe parameters for dynamic error messages.
 * Each error code can accept specific parameters for interpolation.
 */
export type ErrorParams = {
  // String validation parameters
  MIN_LENGTH: { field?: string; min: number };
  MAX_LENGTH: { field?: string; max: number };

  // Number validation parameters
  MIN_VALUE: { field?: string; min: number };
  MAX_VALUE: { field?: string; max: number };

  // General parameters
  INVALID_RANGE: { field?: string; min: number; max: number };
  DUPLICATE_NAME: { name: string };

  // Default (no parameters)
  [key: string]: Record<string, string | number> | undefined;
};

/**
 * Get translated error message (Client-side)
 *
 * @param t - Translation function from useTranslations("errors")
 * @param code - Error code
 * @param params - Optional parameters for interpolation
 * @returns Translated error message
 *
 * @example
 * const t = useTranslations("errors");
 * const message = getErrorMessage(t, "MIN_LENGTH", { field: "username", min: 3 });
 * // Returns: "Username must be at least 3 characters"
 */
export function getErrorMessage(
  t: (key: string, params?: Record<string, string | number>) => string,
  code: ErrorCode | string,
  params?: Record<string, string | number>
): string {
  try {
    return t(code, params);
  } catch (error) {
    console.warn("Translation missing for error code", code, error);
    // Fallback to generic error message if translation key not found
    return t("INTERNAL_ERROR");
  }
}

/**
 * Get translated error message (Server-side)
 *
 * @param locale - Current locale (e.g., "zh-CN", "en")
 * @param code - Error code
 * @param params - Optional parameters for interpolation
 * @returns Translated error message
 *
 * @example
 * import { getTranslations } from "next-intl/server";
 *
 * const locale = await getLocale();
 * const message = await getErrorMessageServer(locale, "MIN_LENGTH", { field: "username", min: 3 });
 */
export async function getErrorMessageServer(
  locale: string,
  code: ErrorCode | string,
  params?: Record<string, string | number>
): Promise<string> {
  try {
    const { getTranslations } = await import("next-intl/server");
    const t = await getTranslations({ locale, namespace: "errors" });
    return t(code, params);
  } catch (error) {
    console.error("getErrorMessageServer failed", { locale, code, error });
    // Fallback to generic error message
    return "An error occurred";
  }
}

/**
 * Helper: Convert Zod error to error code
 *
 * Maps Zod's internal error types to our error code system.
 *
 * @param zodErrorCode - Zod error code (e.g., "too_small", "invalid_type")
 * @param params - Zod error parameters
 * @returns Error code and parameters
 */
export function zodErrorToCode(
  zodErrorCode: string,
  params: Record<string, unknown>
): { code: ErrorCode; params?: Record<string, string | number> } {
  const { minimum, maximum, type, path } = params;
  const field = Array.isArray(path) ? path.join(".") : undefined;

  switch (zodErrorCode) {
    case "invalid_type":
      if (type === "string" && params.received === "undefined") {
        return { code: ERROR_CODES.REQUIRED_FIELD, params: { field: field || "field" } };
      }
      return { code: ERROR_CODES.INVALID_TYPE, params: { field: field || "field" } };

    case "too_small":
      if (typeof minimum === "number") {
        // 区分字符串长度和数值范围
        const isStringType = type === "string";
        return {
          code: isStringType ? ERROR_CODES.MIN_LENGTH : ERROR_CODES.MIN_VALUE,
          params: { field: field || "field", min: minimum },
        };
      }
      return { code: ERROR_CODES.MIN_VALUE };

    case "too_big":
      if (typeof maximum === "number") {
        // 区分字符串长度和数值范围
        const isStringType = type === "string";
        return {
          code: isStringType ? ERROR_CODES.MAX_LENGTH : ERROR_CODES.MAX_VALUE,
          params: { field: field || "field", max: maximum },
        };
      }
      return { code: ERROR_CODES.MAX_VALUE };

    case "invalid_string":
      if (params.validation === "email") {
        return { code: ERROR_CODES.INVALID_EMAIL };
      }
      if (params.validation === "url") {
        return { code: ERROR_CODES.INVALID_URL };
      }
      return { code: ERROR_CODES.INVALID_FORMAT };

    default:
      return { code: ERROR_CODES.INVALID_FORMAT };
  }
}
