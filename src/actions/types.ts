export type SuccessResult<T = undefined> = T extends undefined
  ? { ok: true; data?: undefined }
  : { ok: true; data: T };

/**
 * Error result with optional error code for i18n
 *
 * @property error - Legacy error message string (kept for backward compatibility)
 * @property errorCode - Error code for i18n translation (optional, recommended for new code)
 * @property errorParams - Parameters for error message interpolation (optional)
 *
 * @example
 * // Legacy usage (still supported)
 * return { ok: false, error: "用户名不能为空" };
 *
 * @example
 * // New i18n usage (recommended)
 * return { ok: false, errorCode: "USER_NAME_REQUIRED" };
 *
 * @example
 * // With parameters
 * return { ok: false, errorCode: "MIN_LENGTH", errorParams: { field: "username", min: 3 } };
 */
export type ErrorResult = {
  ok: false;
  error: string;
  errorCode?: string;
  errorParams?: Record<string, string | number>;
};

export type ActionResult<T = undefined> = SuccessResult<T> | ErrorResult;
