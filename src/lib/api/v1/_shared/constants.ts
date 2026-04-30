export const MANAGEMENT_API_VERSION = "1.0.0";
export const MANAGEMENT_API_BASE_PATH = "/api/v1";
export const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json";
export const API_VERSION_HEADER = "X-API-Version";
export const CSRF_HEADER = "X-CCH-CSRF";
export const DASHBOARD_COMPAT_HEADER = "X-CCH-Dashboard-Compat";

export const PUBLIC_PROVIDER_TYPE_VALUES = [
  "claude",
  "codex",
  "gemini",
  "openai-compatible",
] as const;
export const HIDDEN_PROVIDER_TYPES = ["claude-auth", "gemini-cli"] as const;
export const INTERNAL_PROVIDER_TYPE_VALUES = [
  ...PUBLIC_PROVIDER_TYPE_VALUES,
  ...HIDDEN_PROVIDER_TYPES,
] as const;
