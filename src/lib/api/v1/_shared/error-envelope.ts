/**
 * /api/v1 错误响应（RFC 9457 problem+json）封装。
 *
 * 设计要点：
 * - 所有错误都通过 `problem(...)` 构造，禁止 handler 自行拼装 problem JSON；
 * - 内容类型固定为 `application/problem+json`，不允许覆盖为 `application/json`；
 * - 必须包含 RFC 9457 标准字段（type/title/status/detail/instance）+ 项目扩展字段
 *   `errorCode`（必填）、`errorParams`（可选）、`traceId`（必填）、`invalidParams`（仅校验失败）；
 * - 不依赖任何业务模块，纯函数；handler/中间件直接调用即可。
 */

import type { Context } from "hono";
import type { ZodError, ZodIssue } from "zod";
import type { ErrorResult } from "@/actions/types";
import { CONTENT_TYPE_JSON, CONTENT_TYPE_PROBLEM_JSON, PROBLEM_TYPE_BLANK } from "./constants";
import type { Status } from "./status-code-map";

/** 单个 invalid 字段（与 RFC 9457 / OpenAPI 习惯一致） */
export type InvalidParam = {
  /** 字段路径（数组形式）；空数组表示根 */
  path: ReadonlyArray<string | number>;
  /** zod issue code，例如 too_small/invalid_type/custom */
  code: string;
  /** 人类可读消息 */
  message: string;
};

/** 标准 problem+json body */
export type ProblemBody = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errorCode: string;
  errorParams?: Record<string, string | number>;
  traceId: string;
  invalidParams?: ReadonlyArray<InvalidParam>;
};

/** problem(...) 入参 */
export type ProblemOptions = {
  /** HTTP status；与 errorCode 单独传入，便于显式选择 */
  status: Status;
  /** 业务错误码（必填，前端 i18n 用） */
  errorCode: string;
  /** RFC 9457 title；不传时自动用「分类名」 */
  title?: string;
  /** RFC 9457 detail（人类可读详情） */
  detail?: string;
  /** RFC 9457 instance；不传时使用 c.req.path */
  instance?: string;
  /** 业务参数；用于前端 i18n 插值 */
  errorParams?: Record<string, string | number>;
  /** 校验失败时的字段列表 */
  validation?: ReadonlyArray<InvalidParam>;
};

// ==================== 内部工具 ====================

/**
 * 生成 traceId。优先使用 crypto.randomUUID（Node 与 Edge 均原生支持），
 * 失败回退到 `req_<ts>_<rand>` 形式（确保即便没有 webcrypto 也不至于崩溃）。
 */
function makeTraceId(): string {
  try {
    const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (cryptoLike?.randomUUID) {
      return cryptoLike.randomUUID();
    }
  } catch {
    // ignore
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const STATUS_TITLE: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  410: "Gone",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

function defaultTitle(status: number): string {
  return STATUS_TITLE[status] ?? "Error";
}

/** 把 problem body 序列化为 Response，并强制 problem+json content-type */
function buildResponse(body: ProblemBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": CONTENT_TYPE_PROBLEM_JSON,
    },
  });
}

// ==================== 公共 API ====================

/**
 * 构造 problem+json 响应。
 *
 * `c` 用于读取 instance（请求路径）；不会写任何东西到 `c.res`，
 * 因此调用方需要自己 `return problem(c, ...)`，让 Hono 接管响应。
 */
export function problem(c: Context, opts: ProblemOptions): Response {
  const traceId = makeTraceId();
  const body: ProblemBody = {
    type: PROBLEM_TYPE_BLANK,
    title: opts.title ?? defaultTitle(opts.status),
    status: opts.status,
    instance: opts.instance ?? c.req.path,
    errorCode: opts.errorCode,
    traceId,
  };
  if (opts.detail !== undefined) body.detail = opts.detail;
  if (opts.errorParams && Object.keys(opts.errorParams).length > 0) {
    body.errorParams = opts.errorParams;
  }
  if (opts.validation && opts.validation.length > 0) {
    body.invalidParams = opts.validation;
  }
  return buildResponse(body, opts.status);
}

/**
 * 把 ZodError -> problem+json。
 * - status 固定 400
 * - errorCode 固定 "validation_failed"
 * - invalidParams 来自 zod issues
 */
export function fromZodError(c: Context, err: ZodError, opts?: { instance?: string }): Response {
  const issues: ReadonlyArray<ZodIssue> = err.issues ?? [];
  const validation: InvalidParam[] = issues.map((i) => ({
    path: (i.path ?? []).map((p: PropertyKey) => (typeof p === "symbol" ? String(p) : p)) as Array<
      string | number
    >,
    code: i.code ?? "invalid",
    message: i.message ?? "Invalid value",
  }));
  return problem(c, {
    status: 400,
    errorCode: "validation_failed",
    title: "Validation failed",
    detail: "One or more fields are invalid.",
    instance: opts?.instance,
    validation,
  });
}

/**
 * 把遗留 ActionResult.error 包装成 problem+json。
 * - 业务侧明确传入 status，避免根据自由文本 error 字符串猜测；
 * - 优先使用 `err.errorCode`，否则使用 "internal_error"；
 * - `err.error`（自由文本） -> problem.detail。
 */
export function fromActionError(c: Context, status: Status, err: ErrorResult): Response {
  const errorCode = err.errorCode ?? "internal_error";
  return problem(c, {
    status,
    errorCode,
    detail: err.error,
    errorParams: err.errorParams,
  });
}

/**
 * 当上层已经构造了一个 Response，但内容类型可能是 application/json 时，
 * 把它「修正」为 application/problem+json。仅在确实是 JSON 响应时改写。
 */
export function withProblemContentType(response: Response): Response {
  const ct = response.headers.get("Content-Type") ?? "";
  if (ct.startsWith(CONTENT_TYPE_PROBLEM_JSON)) {
    return response;
  }
  if (!ct.includes(CONTENT_TYPE_JSON) && !ct.includes(CONTENT_TYPE_PROBLEM_JSON)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Content-Type", CONTENT_TYPE_PROBLEM_JSON);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
