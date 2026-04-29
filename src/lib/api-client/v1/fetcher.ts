import { CSRF_HEADER } from "@/lib/api/v1/_shared/constants";
import { ApiError } from "./errors";

type ProblemBody = {
  status?: number;
  detail?: string;
  errorCode?: string;
  errorParams?: Record<string, unknown>;
};

export type ApiFetchOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  apiKey?: string;
  onResponse?: (response: Response) => void;
  skipCsrf?: boolean;
};

let csrfTokenPromise: Promise<string | null> | null = null;

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (options.apiKey) {
    headers.set("X-Api-Key", options.apiKey);
  }

  const method = (options.method ?? "GET").toUpperCase();
  const hasBody = options.body !== undefined;
  if (hasBody) {
    headers.set("Content-Type", "application/json");
  }

  if (!options.skipCsrf && isMutation(method) && !options.apiKey && !headers.has(CSRF_HEADER)) {
    const csrfToken = await getCsrfToken();
    if (csrfToken) headers.set(CSRF_HEADER, csrfToken);
  }

  const response = await fetch(path, {
    ...options,
    method,
    credentials: options.credentials ?? "include",
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await decodeApiError(response);
    if (error.errorCode === "auth.csrf_invalid") {
      clearCsrfTokenCache();
    }
    throw error;
  }

  options.onResponse?.(response);

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function getCsrfToken(): Promise<string | null> {
  if (csrfTokenPromise) return csrfTokenPromise;

  csrfTokenPromise = fetch("/api/v1/auth/csrf", {
    credentials: "include",
    headers: { Accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) {
        clearCsrfTokenCache();
        return null;
      }
      const body = (await response.json()) as { csrfToken?: string | null };
      const csrfToken = body.csrfToken ?? null;
      if (!csrfToken) clearCsrfTokenCache();
      return csrfToken;
    })
    .catch(() => {
      clearCsrfTokenCache();
      return null;
    });

  return csrfTokenPromise;
}

export function clearCsrfTokenCache(): void {
  csrfTokenPromise = null;
}

async function decodeApiError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType.includes("application/problem+json") ||
    contentType.includes("application/json")
  ) {
    const bodyText = await response.text();
    let body: ProblemBody = {};
    try {
      body = bodyText ? (JSON.parse(bodyText) as ProblemBody) : {};
    } catch {
      return new ApiError({
        status: response.status,
        errorCode: "api.malformed_error_body",
        detail: bodyText.slice(0, 500) || response.statusText || "Request failed",
      });
    }
    return new ApiError({
      status: response.status,
      errorCode: body.errorCode ?? "api.error",
      detail: body.detail ?? response.statusText,
      errorParams: body.errorParams,
    });
  }

  return new ApiError({
    status: response.status,
    errorCode: "api.error",
    detail: response.statusText || "Request failed",
  });
}

function isMutation(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}
