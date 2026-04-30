/**
 * /api/v1 客户端错误模型与国际化辅助函数。
 *
 * 设计要点：
 * - `ApiError` 反序列化 RFC 7807 problem+json 响应（含项目自定义扩展字段）；
 * - `localizeError` 在提供 i18n 翻译器时使用 `errors.api.<errorCode>` 命名空间；
 *   未提供时退化为 title -> detail -> "Unknown error"；
 * - 所有字段都为可选（除 status / errorCode / title），与服务端的 problem+json 渲染保持兼容。
 */

/** 字段级校验失败描述（Zod issue 投影） */
export interface InvalidParam {
  /**
   * 字段路径数组，如 `["body", "name"]` 或 `["query", "limit"]`。
   * 与服务端 `src/lib/api/v1/_shared/error-envelope.ts` 中的
   * `InvalidParam.path: ReadonlyArray<string | number>` 严格对齐，
   * 与生成的 OpenAPI 类型 `(string | number)[]` 保持一致。
   * 根字段使用空数组 `[]`。
   */
  path: ReadonlyArray<string | number>;
  /** 字段级提示，已脱去敏感数据 */
  message: string;
  /** 与 i18n 键相对应的稳定错误码 */
  code: string;
}

/** problem+json 响应体形状（仅约束本项目使用的字段） */
export interface ProblemJson {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  errorCode?: string;
  errorParams?: Record<string, string | number>;
  invalidParams?: InvalidParam[];
  traceId?: string;
}

/**
 * 来自 /api/v1 的 API 错误。
 *
 * 通过静态工厂 `ApiError.fromProblemJson` 构造，避免散落构造细节。
 */
export class ApiError extends Error {
  /** HTTP 状态码 */
  public readonly status: number;
  /** 稳定错误码，作为 i18n 键 */
  public readonly errorCode: string;
  /** 简短错误标题（默认英文，i18n 缺失时回退展示） */
  public readonly title: string;
  /** 详细错误描述（可选） */
  public readonly detail?: string;
  /** 错误参数，用于 i18n 模板插值 */
  public readonly errorParams?: Record<string, string | number>;
  /** 字段级校验失败列表 */
  public readonly invalidParams?: InvalidParam[];
  /** 请求级 trace ID，便于排查 */
  public readonly traceId?: string;
  /** 触发该错误的 URL 实例路径 */
  public readonly instance?: string;

  constructor(init: {
    status: number;
    errorCode: string;
    title: string;
    detail?: string;
    errorParams?: Record<string, string | number>;
    invalidParams?: InvalidParam[];
    traceId?: string;
    instance?: string;
  }) {
    super(init.detail || init.title || init.errorCode);
    this.name = "ApiError";
    this.status = init.status;
    this.errorCode = init.errorCode;
    this.title = init.title;
    this.detail = init.detail;
    this.errorParams = init.errorParams;
    this.invalidParams = init.invalidParams;
    this.traceId = init.traceId;
    this.instance = init.instance;
  }

  /**
   * 从 Response + problem+json body 构造 ApiError。
   *
   * 容错：
   * - body.status 缺失时取 response.status；
   * - errorCode 缺失时退化为 "UNKNOWN_ERROR"；
   * - title 缺失时退化为 response.statusText 或 "API Error"。
   */
  static fromProblemJson(response: Response, body: ProblemJson): ApiError {
    return new ApiError({
      status: body.status ?? response.status,
      errorCode: body.errorCode ?? "UNKNOWN_ERROR",
      title: body.title ?? response.statusText ?? "API Error",
      detail: body.detail,
      errorParams: body.errorParams,
      invalidParams: body.invalidParams,
      traceId: body.traceId,
      instance: body.instance,
    });
  }
}

/** 翻译器接口（与 next-intl 的 useTranslations 返回值兼容） */
export interface ErrorTranslator {
  t: (key: string, params?: Record<string, unknown>) => string;
}

/**
 * 将 ApiError 翻译为面向用户的可显示字符串。
 *
 * 策略：
 * 1. 提供 i18n 时使用 `errors.api.<errorCode>` 命名空间，并把 errorParams 作为 ICU 占位符；
 *    若翻译器抛错（键缺失），则按下一步降级；
 * 2. 否则按 title -> detail -> "Unknown error" 的顺序回退。
 */
export function localizeError(err: ApiError, i18n?: ErrorTranslator): string {
  if (i18n) {
    try {
      const key = `errors.api.${err.errorCode}`;
      const translated = i18n.t(key, err.errorParams);
      if (translated && translated !== key) {
        return translated;
      }
    } catch {
      // 译文缺失时降级到本地回退
    }
  }
  if (err.title) return err.title;
  if (err.detail) return err.detail;
  return "Unknown error";
}
