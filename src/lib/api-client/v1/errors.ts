export class ApiError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly errorParams?: Record<string, unknown>;
  readonly detail: string;

  constructor(input: {
    status: number;
    errorCode: string;
    detail: string;
    errorParams?: Record<string, unknown>;
  }) {
    super(input.detail);
    this.name = "ApiError";
    this.status = input.status;
    this.errorCode = input.errorCode;
    this.errorParams = input.errorParams;
    this.detail = input.detail;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

const API_ERROR_MESSAGE_KEYS: Record<string, string> = {
  "api.error": "INTERNAL_ERROR",
  "auth.missing": "TOKEN_REQUIRED",
  "auth.invalid": "INVALID_TOKEN",
  "auth.forbidden": "PERMISSION_DENIED",
  "auth.api_key_admin_disabled": "PERMISSION_DENIED",
  "auth.csrf_invalid": "PERMISSION_DENIED",
  "request.validation_failed": "INVALID_FORMAT",
  "resource.not_found": "NOT_FOUND",
  "provider.not_found": "NOT_FOUND",
  "provider.action_failed": "OPERATION_FAILED",
  "provider_endpoint.not_found": "NOT_FOUND",
  "provider_endpoint.action_failed": "OPERATION_FAILED",
  "provider_vendor.not_found": "NOT_FOUND",
  "provider_vendor.action_failed": "OPERATION_FAILED",
};

export function getApiErrorMessageKey(error: ApiError): string {
  return API_ERROR_MESSAGE_KEYS[error.errorCode] ?? error.errorCode;
}

export function getApiErrorMessageParams(
  error: ApiError
): Record<string, string | number> | undefined {
  if (!error.errorParams) return undefined;
  return Object.fromEntries(
    Object.entries(error.errorParams).filter(
      (entry): entry is [string, string | number] =>
        typeof entry[1] === "string" || typeof entry[1] === "number"
    )
  );
}
