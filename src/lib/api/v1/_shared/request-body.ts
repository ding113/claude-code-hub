/**
 * /api/v1 请求体解析辅助
 *
 * 流程：
 *   1) 写方法（POST/PUT/PATCH）必须 Content-Type 兼容 application/json，否则返回 415；
 *   2) 解析 JSON；JSON 语法错误返回 400 problem+json `errorCode = malformed_json`；
 *   3) 用 zod schema 校验；失败返回 400 problem+json，附 invalidParams；
 *   4) 默认对 z.object schema 启用 .strict()（拒绝未知字段），调用方可通过
 *      `opts.strict = false` 关闭，或 schema 自身已经是 .passthrough() 时也会跳过 strict。
 */

import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ZodType } from "zod";
import { fromZodError, problem } from "./error-envelope";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);
const JSON_CONTENT_TYPE_PATTERN = /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;.*)?$/i;

/** parseJsonBody 返回值 */
export type ParseBodyResult<T> = { ok: true; data: T } | { ok: false; response: Response };

export type ParseJsonBodyOptions = {
  /**
   * 是否对 z.object 自动启用 .strict()。默认 true。
   * 仅当 schema 本身用了 .passthrough() 时自动跳过。
   */
  strict?: boolean;
};

/** 判断 Content-Type 是否为 JSON 兼容（含 problem+json / vnd.api+json 等） */
function isJsonContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return JSON_CONTENT_TYPE_PATTERN.test(contentType.trim());
}

/** 检测 zod 4 中的 object 是否已是 passthrough（不阻止未知 key） */
function isPassthroughObject(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const def = (schema as { _def?: { catchall?: unknown; type?: string; typeName?: string } })._def;
  if (!def) return false;
  // zod 4 的 object 内部用 catchall + unknown 表达 passthrough
  const catchall = def.catchall;
  if (!catchall) return false;
  const catchallDef = (catchall as { _def?: { typeName?: string; type?: string } })._def;
  const tag = catchallDef?.typeName ?? catchallDef?.type;
  return tag === "ZodUnknown" || tag === "unknown";
}

/** 把 schema（如果是普通 object）升级为 strict object */
function maybeStrict<S extends ZodType>(schema: S): S {
  if (isPassthroughObject(schema)) return schema;
  // 用 unknown 中转规避 generic + instanceof 的类型检查限制
  const candidate = schema as unknown;
  if (candidate instanceof z.ZodObject) {
    return candidate.strict() as unknown as S;
  }
  return schema;
}

/**
 * 安全解析并校验 JSON 请求体。
 *
 * 写方法（POST/PUT/PATCH）：
 *   - 缺失/非 JSON Content-Type -> 415 unsupported_media_type
 *   - JSON 语法错误            -> 400 malformed_json
 *   - schema 校验失败          -> 400 validation_failed + invalidParams
 *
 * GET/DELETE 默认不会有 body，但本函数仍能解析（用于 DELETE+JSON 这种少数场景）。
 */
export async function parseJsonBody<S extends ZodType>(
  c: Context,
  schema: S,
  opts: ParseJsonBodyOptions = {}
): Promise<ParseBodyResult<z.infer<S>>> {
  const method = c.req.method.toUpperCase();
  const contentType = c.req.header("content-type");

  if (WRITE_METHODS.has(method) && !isJsonContentType(contentType)) {
    return {
      ok: false,
      response: problem(c, {
        status: 415,
        errorCode: "unsupported_media_type",
        title: "Unsupported Media Type",
        detail: `Content-Type must be application/json (received: ${contentType ?? "<none>"}).`,
      }),
    };
  }

  let raw: unknown;
  try {
    // c.req.json() 在 Hono 中读取 body 并解析；body 为空字符串时也会抛 SyntaxError
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      response: problem(c, {
        status: 400,
        errorCode: "malformed_json",
        title: "Malformed JSON",
        detail: "Request body is not valid JSON.",
      }),
    };
  }

  const useStrict = opts.strict !== false;
  const target = useStrict ? maybeStrict(schema) : schema;
  const parsed = target.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: fromZodError(c, parsed.error),
    };
  }

  return { ok: true, data: parsed.data };
}
