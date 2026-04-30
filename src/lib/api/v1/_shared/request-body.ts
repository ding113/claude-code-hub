import type { z } from "zod";
import { createProblemResponse, normalizeZodPath } from "./error-envelope";

export type ParsedBodyResult<T> = { ok: true; data: T } | { ok: false; response: Response };

type JsonBodySchema<T> = {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: z.ZodError };
};

type HonoJsonRequest = {
  req: {
    raw: Request;
    url: string;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
};

export async function parseJsonBody<T>(
  request: Request,
  schema: JsonBodySchema<T>
): Promise<ParsedBodyResult<T>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      response: createProblemResponse({
        status: 415,
        instance: new URL(request.url).pathname,
        detail: "Request body must use application/json.",
      }),
    };
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return {
      ok: false,
      response: createProblemResponse({
        status: 400,
        instance: new URL(request.url).pathname,
        errorCode: "request.malformed_json",
        detail: "Request body is not valid JSON.",
      }),
    };
  }

  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      response: createProblemResponse({
        status: 400,
        instance: new URL(request.url).pathname,
        title: "Validation failed",
        detail: "One or more fields are invalid.",
        errorCode: "request.validation_failed",
        invalidParams: parsed.error.issues.map((issue) => ({
          path: normalizeZodPath(issue.path),
          code: issue.code,
          message: issue.message,
        })),
      }),
    };
  }

  return { ok: true, data: parsed.data };
}

export async function parseHonoJsonBody<T>(
  c: HonoJsonRequest,
  schema: JsonBodySchema<T>
): Promise<ParsedBodyResult<T>> {
  const contentType =
    c.req.header("content-type") ??
    c.req.header("Content-Type") ??
    c.req.raw.headers.get("content-type") ??
    "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      response: createProblemResponse({
        status: 415,
        instance: new URL(c.req.url).pathname,
        detail: "Request body must use application/json.",
      }),
    };
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return {
      ok: false,
      response: createProblemResponse({
        status: 400,
        instance: new URL(c.req.url).pathname,
        errorCode: "request.malformed_json",
        detail: "Request body is not valid JSON.",
      }),
    };
  }

  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      response: createProblemResponse({
        status: 400,
        instance: new URL(c.req.url).pathname,
        title: "Validation failed",
        detail: "One or more fields are invalid.",
        errorCode: "request.validation_failed",
        invalidParams: parsed.error.issues.map((issue) => ({
          path: normalizeZodPath(issue.path),
          code: issue.code,
          message: issue.message,
        })),
      }),
    };
  }

  return { ok: true, data: parsed.data };
}
