/**
 * Zod i18n Integration
 *
 * Provides custom error maps for Zod schemas to integrate with next-intl translation system.
 * This module maps Zod's internal error codes to our centralized error code system.
 *
 * @example
 * // Client-side usage
 * import { setZodErrorMap } from "@/lib/utils/zod-i18n";
 * import { useTranslations } from "next-intl";
 *
 * function MyComponent() {
 *   const t = useTranslations("errors");
 *   setZodErrorMap(t);
 *   // Now all Zod validations use translated messages
 * }
 *
 * @example
 * // Server-side usage
 * import { getZodErrorMapServer } from "@/lib/utils/zod-i18n";
 *
 * const errorMap = await getZodErrorMapServer(locale);
 * const schema = z.object({ ... }).setErrorMap(errorMap);
 */

import { z } from "zod";
import { ERROR_CODES, zodErrorToCode } from "./error-messages";

/**
 * Client-side Zod error map
 *
 * Sets a global Zod error map that uses next-intl translations.
 * Call this function once per component that needs form validation.
 *
 * @param t - Translation function from useTranslations("errors")
 *
 * @example
 * const t = useTranslations("errors");
 * setZodErrorMap(t);
 */
export function setZodErrorMap(
  t: (key: string, params?: Record<string, string | number>) => string
): void {
  // @ts-expect-error - Zod v4 type definition issue with error map signature
  z.setErrorMap((issue: z.ZodIssue, _ctx: { defaultError: string; data: unknown }) => {
    // Convert Zod error to our error code system
    const { code, params } = zodErrorToCode(issue.code, {
      minimum: "minimum" in issue ? issue.minimum : undefined,
      maximum: "maximum" in issue ? issue.maximum : undefined,
      type: "expected" in issue ? issue.expected : undefined,
      received: "received" in issue ? issue.received : undefined,
      validation: "validation" in issue ? issue.validation : undefined,
      path: issue.path,
    });

    try {
      return { message: t(code, params) };
    } catch (error) {
      // Only log in development to avoid sensitive data exposure
      if (process.env.NODE_ENV === "development") {
        console.warn("setZodErrorMap fallback", { code, error });
        // Avoid logging the full issue object which may contain user input
      }
      // Fallback to Zod default message
      return { message: _ctx.defaultError };
    }
  });
}

/**
 * Server-side Zod error map factory
 *
 * Creates a Zod error map for server-side validation using next-intl/server.
 *
 * @param locale - Current locale (e.g., "zh-CN", "en")
 * @returns Zod error map function
 *
 * @example
 * const errorMap = await getZodErrorMapServer(locale);
 * const schema = CreateUserSchema.setErrorMap(errorMap);
 * const result = schema.safeParse(data);
 */
export async function getZodErrorMapServer(locale: string) {
  const { getTranslations } = await import("next-intl/server");
  const t = await getTranslations({ locale, namespace: "errors" });

  return (issue: z.ZodIssue, _ctx: { defaultError: string; data: unknown }) => {
    const { code, params } = zodErrorToCode(issue.code, {
      minimum: "minimum" in issue ? issue.minimum : undefined,
      maximum: "maximum" in issue ? issue.maximum : undefined,
      type: "expected" in issue ? issue.expected : undefined,
      received: "received" in issue ? issue.received : undefined,
      validation: "validation" in issue ? issue.validation : undefined,
      path: issue.path,
    });

    try {
      return { message: t(code, params) };
    } catch (error) {
      // Only log in development to avoid sensitive data exposure
      if (process.env.NODE_ENV === "development") {
        console.warn("getZodErrorMapServer fallback", { locale, code, error });
        // Avoid logging the full issue object which may contain user input
      }
      return { message: _ctx.defaultError };
    }
  };
}

/**
 * Create locale-aware Zod schema
 *
 * Helper function to create a Zod schema with locale-aware error messages.
 * Use this in server actions to validate data with translated error messages.
 *
 * @param schema - Base Zod schema
 * @param locale - Current locale
 * @returns Schema with locale-aware error map
 *
 * @example
 * import { createLocaleSchema } from "@/lib/utils/zod-i18n";
 * import { CreateUserSchema } from "@/lib/validation/schemas";
 *
 * export async function addUser(data: unknown) {
 *   const locale = await getLocale();
 *   const schema = await createLocaleSchema(CreateUserSchema, locale);
 *   const result = schema.safeParse(data);
 *   // ...
 * }
 */
export async function createLocaleSchema<T extends z.ZodTypeAny>(
  schema: T,
  locale: string
): Promise<T> {
  await getZodErrorMapServer(locale);
  return schema as T; // Type assertion - Zod doesn't expose setErrorMap in types properly
}

/**
 * Format Zod errors for ActionResult
 *
 * Converts Zod validation errors to a user-friendly error message.
 * Returns the first error message, or a generic message if no specific errors.
 *
 * @param error - Zod error object from safeParse
 * @returns Error message string
 *
 * @example
 * const result = schema.safeParse(data);
 * if (!result.success) {
 *   return { ok: false, error: formatZodError(result.error) };
 * }
 */
export function formatZodError(error: z.ZodError): string {
  if (error.issues && error.issues.length > 0) {
    return error.issues[0].message;
  }
  return ERROR_CODES.INVALID_FORMAT;
}

/**
 * Extract error code from Zod error
 *
 * Extracts the first error code from a Zod validation error.
 * Useful for returning error codes instead of messages in ActionResult.
 *
 * @param error - Zod error object
 * @returns Error code string
 *
 * @example
 * const result = schema.safeParse(data);
 * if (!result.success) {
 *   return { ok: false, errorCode: extractZodErrorCode(result.error) };
 * }
 */
export function extractZodErrorCode(error: z.ZodError): string {
  if (error.issues && error.issues.length > 0) {
    const issue = error.issues[0];
    const { code } = zodErrorToCode(issue.code, {
      minimum: "minimum" in issue ? issue.minimum : undefined,
      maximum: "maximum" in issue ? issue.maximum : undefined,
      type: "expected" in issue ? issue.expected : undefined,
      received: "received" in issue ? issue.received : undefined,
      validation: "validation" in issue ? issue.validation : undefined,
      path: issue.path,
    });
    return code;
  }
  return ERROR_CODES.INVALID_FORMAT;
}
