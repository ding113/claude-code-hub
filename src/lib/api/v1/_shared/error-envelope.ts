import type { ZodError } from "zod";
import { MANAGEMENT_API_BASE_PATH, PROBLEM_JSON_CONTENT_TYPE } from "./constants";
import {
  getDefaultErrorCode,
  getDefaultProblemTitle,
  type ProblemStatusCode,
} from "./status-code-map";

export type ProblemJson = {
  type: string;
  title: string;
  status: ProblemStatusCode;
  detail: string;
  instance: string;
  errorCode: string;
  errorParams?: Record<string, unknown>;
  traceId?: string;
  invalidParams?: Array<{
    path: Array<string | number>;
    code: string;
    message: string;
  }>;
};

export type CreateProblemOptions = {
  status: ProblemStatusCode;
  instance?: string;
  title?: string;
  detail?: string;
  errorCode?: string;
  errorParams?: Record<string, unknown>;
  traceId?: string;
  invalidParams?: ProblemJson["invalidParams"];
};

function problemTypeFor(errorCode: string): string {
  return `https://claude-code-hub.local/problems/${encodeURIComponent(errorCode)}`;
}

export function createProblemJson(options: CreateProblemOptions): ProblemJson {
  const errorCode = options.errorCode ?? getDefaultErrorCode(options.status);
  return {
    type: problemTypeFor(errorCode),
    title: options.title ?? getDefaultProblemTitle(options.status),
    status: options.status,
    detail: options.detail ?? getDefaultProblemTitle(options.status),
    instance: options.instance ?? MANAGEMENT_API_BASE_PATH,
    errorCode,
    ...(options.errorParams ? { errorParams: options.errorParams } : {}),
    ...(options.traceId ? { traceId: options.traceId } : {}),
    ...(options.invalidParams ? { invalidParams: options.invalidParams } : {}),
  };
}

export function createProblemResponse(options: CreateProblemOptions): Response {
  return new Response(JSON.stringify(createProblemJson(options)), {
    status: options.status,
    headers: {
      "Content-Type": PROBLEM_JSON_CONTENT_TYPE,
    },
  });
}

export function publicActionErrorDetail(status: ProblemStatusCode): string {
  return getDefaultProblemTitle(status);
}

export function problem(options: CreateProblemOptions): Response {
  return createProblemResponse(options);
}

export function fromZodError(error: ZodError, instance: string): Response {
  return createProblemResponse({
    status: 400,
    instance,
    title: "Validation failed",
    detail: "One or more fields are invalid.",
    errorCode: "request.validation_failed",
    invalidParams: error.issues.map((issue) => ({
      path: normalizeZodPath(issue.path),
      code: issue.code,
      message: issue.message,
    })),
  });
}

export function normalizeZodPath(path: PropertyKey[]): Array<string | number> {
  return path.map((segment) =>
    typeof segment === "string" || typeof segment === "number" ? segment : String(segment)
  );
}
