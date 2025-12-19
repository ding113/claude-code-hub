/**
 * Detect if an error is network-related
 *
 * @param error - The error to check
 * @returns true if the error appears to be network-related
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("abort") ||
    message.includes("und_err_connect_timeout")
  );
}

/**
 * Get a safe error message that won't leak sensitive information
 *
 * @param _error - The error (unused, kept for API consistency)
 * @param fallbackMessage - Default message if error message is unavailable
 * @returns A safe error message suitable for display to users
 */
export function getSafeErrorMessage(_error: unknown, fallbackMessage = "Operation failed"): string {
  // Never expose raw error messages to users - they may contain sensitive info
  // Always return the fallback message for user-facing contexts
  return fallbackMessage;
}

/**
 * Get the raw error message for logging purposes only
 *
 * @param error - The error to extract message from
 * @returns The error message string
 */
export function getErrorMessageForLogging(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
