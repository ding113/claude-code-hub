export type ProblemStatusCode =
  | 400
  | 401
  | 403
  | 404
  | 405
  | 409
  | 410
  | 415
  | 422
  | 429
  | 500
  | 503;

const DEFAULT_TITLES = {
  400: "Bad request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
  405: "Method not allowed",
  409: "Conflict",
  410: "Gone",
  415: "Unsupported media type",
  422: "Unprocessable entity",
  429: "Too many requests",
  500: "Internal server error",
  503: "Service unavailable",
} as const satisfies Record<ProblemStatusCode, string>;

const DEFAULT_ERROR_CODES = {
  400: "request.invalid",
  401: "auth.invalid",
  403: "auth.forbidden",
  404: "resource.not_found",
  405: "method.not_allowed",
  409: "resource.conflict",
  410: "resource.gone",
  415: "request.unsupported_media_type",
  422: "request.unprocessable",
  429: "rate_limit.exceeded",
  500: "internal.error",
  503: "dependency.unavailable",
} as const satisfies Record<ProblemStatusCode, string>;

export function getDefaultProblemTitle(status: ProblemStatusCode): string {
  return DEFAULT_TITLES[status];
}

export function getDefaultErrorCode(status: ProblemStatusCode): string {
  return DEFAULT_ERROR_CODES[status];
}
