import { parseSSEData } from "@/lib/utils/sse";

/**
 * 上游“假 200”错误检测（仅用于内部统计/熔断/故障转移判定）。
 *
 * 背景
 * - 一些上游供应商在鉴权/配额/风控等错误场景下，会返回 HTTP 200，
 *   但在 body 里给出错误 JSON（例如：`{"error":"当前无可用凭证"}`）。
 * - 在流式 SSE 场景中，这类错误可能被包裹在某个 `data: {...}` 事件里。
 * - CCH 在“已开始向客户端透传 SSE”后，无法再把 HTTP 状态码改成 4xx/5xx，
 *   也无法阻止错误内容继续被传递到客户端。
 *
 * 为什么还要检测
 * - 我们至少要让 CCH 自己意识到“这次请求实际上是失败的”，从而：
 *   1) 触发故障转移/供应商熔断的失败统计；
 *   2) 避免把 session 智能绑定（粘性）更新到一个实际不可用的 provider；
 *   3) 让客户端下一次自动重试时，有机会切换到其他 provider（避免“假 200”导致重试仍复用同一坏 provider）。
 *
 * 设计目标（偏保守）
 * - 仅基于结构化字段做启发式判断：`error` 与 `message`；
 * - 对明显的 HTML 文档（doctype/html 标签）做强信号判定，覆盖部分网关/WAF/Cloudflare 返回的“假 200”；
 * - 不扫描模型生成的正文内容（例如 content/choices），避免把用户/模型自然语言里的 "error" 误判为上游错误；
 * - message 关键字检测仅对“小体积 JSON”启用，降低误判与性能开销。
 * - 返回的 `code` 是语言无关的错误码（便于写入 DB/监控/告警）；
 * - 返回的 `detail`（如有）会做脱敏与截断：用于日志排查，但不建议直接作为用户展示文案。
 */
export type UpstreamErrorDetectionResult =
  | { isError: false }
  | {
      isError: true;
      code: string;
      detail?: string;
    };

type DetectionOptions = {
  /**
   * 仅对小体积 JSON 启用 message 关键字检测，避免误判与无谓开销。
   *
   * 说明：这里的“体积”是原始 JSON 文本（或 SSE 单个 data 的 JSON）序列化后的字符数，
   * 而不是 HTTP 的 Content-Length。
   */
  maxJsonCharsForMessageCheck?: number;
  /**
   * message 关键字匹配规则（默认 /error/i）。
   *
   * 注意：该规则只用于检查 `message` 字段（字符串）。
   * `error.message` 属于更强信号：只要 `error` 非空（含对象形式），就会直接判定为错误。
   */
  messageKeyword?: RegExp;
};

const DEFAULT_MAX_JSON_CHARS_FOR_MESSAGE_CHECK = 1000;
const DEFAULT_MESSAGE_KEYWORD = /error/i;

const FAKE_200_CODES = {
  EMPTY_BODY: "FAKE_200_EMPTY_BODY",
  HTML_BODY: "FAKE_200_HTML_BODY",
  JSON_ERROR_NON_EMPTY: "FAKE_200_JSON_ERROR_NON_EMPTY",
  JSON_ERROR_MESSAGE_NON_EMPTY: "FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY",
  JSON_MESSAGE_KEYWORD_MATCH: "FAKE_200_JSON_MESSAGE_KEYWORD_MATCH",
} as const;

// SSE 快速过滤：仅当文本里“看起来存在 JSON key”时才进入 parseSSEData（避免无谓解析）。
// 注意：这里必须是 `"key"\s*:` 形式，避免误命中 JSON 字符串内容里的 `\"key\"`。
const MAY_HAVE_JSON_ERROR_KEY = /"error"\s*:/;
const MAY_HAVE_JSON_MESSAGE_KEY = /"message"\s*:/;

const HTML_DOC_SNIFF_MAX_CHARS = 1024;
const HTML_DOCTYPE_RE = /^<!doctype\s+html[\s>]/i;
const HTML_HTML_TAG_RE = /^<html[\s>]/i;

/**
 * 判断文本是否“很像”一个完整的 HTML 文档（强信号）。
 *
 * 规则（偏保守）：
 * - 仅当文本以 `<` 开头时才继续；
 * - 仅在前 1024 字符内检测 `<!doctype html ...>` 或以 `<html ...>` 开头；
 * - 不做 HTML 解析/清洗，避免误判与额外开销。
 *
 * 说明：调用方应先对文本做 `trim()`，并在需要时移除 BOM（`\uFEFF`）。
 */
function isLikelyHtmlDocument(trimmedText: string): boolean {
  if (!trimmedText.startsWith("<")) return false;
  const head = trimmedText.slice(0, HTML_DOC_SNIFF_MAX_CHARS);
  return HTML_DOCTYPE_RE.test(head) || HTML_HTML_TAG_RE.test(head);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasNonEmptyValue(value: unknown): boolean {
  // 这里的“非空”是为了判断“error 字段是否有内容”。
  // - string：trim 后非空
  // - number：非 0 且非 NaN（避免把默认 0 当作错误）
  // - boolean：true 视为非空
  // - array/object：存在元素/键才算非空
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return !Number.isNaN(value) && value !== 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

export function sanitizeErrorTextForDetail(text: string): string {
  // 注意：这里的目的不是“完美脱敏”，而是尽量降低上游错误信息中意外夹带敏感内容的风险。
  // 若后续发现更多敏感模式，可在不改变检测语义的前提下补充。
  let sanitized = text;

  // Bearer token
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");

  // Common API key prefixes (OpenAI/Claude/Codex 等)
  sanitized = sanitized.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/giu, "[REDACTED_KEY]");
  sanitized = sanitized.replace(/\bAIza[0-9A-Za-z_-]{16,}\b/g, "[REDACTED_KEY]");

  // JWT（base64url 三段）
  sanitized = sanitized.replace(
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    "[JWT]"
  );

  // Email
  sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]");

  // 通用敏感键值（尽量覆盖常见写法）
  sanitized = sanitized.replace(
    /\b(password|token|secret|api[_-]?key)\b\s*[:=]\s*['"]?[^'"\s]+['"]?/gi,
    "$1:***"
  );

  // 常见配置/凭证路径（避免把文件名/路径泄露到审计字段里）
  sanitized = sanitized.replace(/\/[\w.-]+\.(?:env|ya?ml|json|conf|ini)/gi, "[PATH]");

  return sanitized;
}

function truncateForDetail(text: string, maxLen: number = 200): string {
  const trimmed = sanitizeErrorTextForDetail(text).trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

function detectFromJsonObject(
  obj: Record<string, unknown>,
  rawJsonChars: number,
  options: Required<Pick<DetectionOptions, "maxJsonCharsForMessageCheck" | "messageKeyword">>
): UpstreamErrorDetectionResult {
  // 判定优先级：
  // 1) `error` 非空：直接判定为错误（强信号）
  // 2) 小体积 JSON 下，`message` 命中关键字：判定为错误（弱信号，但能覆盖部分“错误只写在 message”场景）
  const errorValue = obj.error;
  if (hasNonEmptyValue(errorValue)) {
    // 优先展示 string 或 error.message，避免把整个对象塞进 detail
    if (typeof errorValue === "string") {
      return {
        isError: true,
        code: FAKE_200_CODES.JSON_ERROR_NON_EMPTY,
        detail: truncateForDetail(errorValue),
      };
    }

    if (isPlainRecord(errorValue) && typeof errorValue.message === "string") {
      return {
        isError: true,
        code: FAKE_200_CODES.JSON_ERROR_MESSAGE_NON_EMPTY,
        detail: truncateForDetail(errorValue.message),
      };
    }

    return { isError: true, code: FAKE_200_CODES.JSON_ERROR_NON_EMPTY };
  }

  if (rawJsonChars < options.maxJsonCharsForMessageCheck) {
    const message = typeof obj.message === "string" ? obj.message : null;

    // 注意：仅检查 message 字段本身，不扫描其它字段。
    if (message && options.messageKeyword.test(message)) {
      return {
        isError: true,
        code: FAKE_200_CODES.JSON_MESSAGE_KEYWORD_MATCH,
        detail: truncateForDetail(message),
      };
    }
  }

  return { isError: false };
}

/**
 * 用于“流式 SSE 已经结束后”的补充检查：
 * - 响应体为空：视为错误
 * - JSON 里包含非空 error 字段：视为错误
 * - 小于 1000 字符的 JSON：若 message 包含 "error" 字样：视为错误
 *
 * 注意与限制：
 * - 该函数不负责判断 HTTP 状态码；调用方通常只在“上游返回 200 且 SSE 正常结束后”使用它。
 * - 对 SSE 文本，仅解析 `data:` 事件中的 JSON（通过 parseSSEData）。
 * - 如果文本不是合法 JSON / SSE，函数会返回 `{isError:false}`（不做过度猜测）。
 */
export function detectUpstreamErrorFromSseOrJsonText(
  text: string,
  options: DetectionOptions = {}
): UpstreamErrorDetectionResult {
  const merged: Required<Pick<DetectionOptions, "maxJsonCharsForMessageCheck" | "messageKeyword">> =
    {
      maxJsonCharsForMessageCheck:
        options.maxJsonCharsForMessageCheck ?? DEFAULT_MAX_JSON_CHARS_FOR_MESSAGE_CHECK,
      messageKeyword: options.messageKeyword ?? DEFAULT_MESSAGE_KEYWORD,
    };

  let trimmed = text.trim();
  if (!trimmed) {
    return { isError: true, code: FAKE_200_CODES.EMPTY_BODY };
  }

  // 某些上游会带 UTF-8 BOM（\uFEFF），会导致 startsWith("{") / startsWith("<") 等快速判断失效。
  // 这里仅剥离首字符 BOM，并再做一次 trimStart，避免误判。
  if (trimmed.charCodeAt(0) === 0xfeff) {
    trimmed = trimmed.slice(1).trimStart();
  }

  // 情况 0：明显的 HTML 文档（通常是网关/WAF/Cloudflare 返回的错误页）
  //
  // 说明：
  // - 此处不依赖 Content-Type：部分上游会缺失/错误设置该字段；
  // - 仅匹配 doctype/html 标签等“强信号”，避免把普通 `<...>` 文本误判为 HTML 页面。
  if (isLikelyHtmlDocument(trimmed)) {
    return {
      isError: true,
      code: FAKE_200_CODES.HTML_BODY,
      // 避免对超大 HTML 做无谓处理：仅截取前段用于脱敏/截断与排查
      detail: truncateForDetail(trimmed.slice(0, 4096)),
    };
  }

  // 情况 1：纯 JSON（对象）
  // 上游可能 Content-Type 设置为 SSE，但实际上返回 JSON；此处只处理对象格式（{...}），
  // 不处理数组（[...]）以避免误判（数组场景的语义差异较大，后续若确认需要再扩展）。
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isPlainRecord(parsed)) {
        return detectFromJsonObject(parsed, trimmed.length, merged);
      }
    } catch {
      // JSON 解析失败：不视为错误，交由上层逻辑处理
    }
    return { isError: false };
  }

  if (trimmed.startsWith("[")) {
    return { isError: false };
  }

  // 情况 2：SSE 文本。快速过滤：既无 "error"/"message" key 时跳过解析
  // 注意：这里要求 key 命中 `"key"\s*:`，尽量避免误命中 JSON 字符串内容里的 `\"error\"`。
  if (!MAY_HAVE_JSON_ERROR_KEY.test(text) && !MAY_HAVE_JSON_MESSAGE_KEY.test(text)) {
    return { isError: false };
  }

  // parseSSEData 会把每个事件的 data 尝试解析成对象；我们只对 object data 做结构化判定。
  const events = parseSSEData(text);
  for (const evt of events) {
    if (!isPlainRecord(evt.data)) continue;
    // 性能优化：只有在 message 是字符串、且“看起来足够小”时才需要精确计算 JSON 字符数。
    // 对大多数 SSE 事件（message 为对象、或没有 message），无需 JSON.stringify。
    let chars = 0;
    const errorValue = evt.data.error;
    const messageValue = evt.data.message;
    if (!hasNonEmptyValue(errorValue) && typeof messageValue === "string") {
      if (messageValue.length >= merged.maxJsonCharsForMessageCheck) {
        chars = merged.maxJsonCharsForMessageCheck; // >= 阈值即可跳过 message 关键字判定
      } else {
        try {
          chars = JSON.stringify(evt.data).length;
        } catch {
          // stringify 失败时回退为近似值（仍保持“仅小体积 JSON 才做 message 检测”的意图）
          chars = messageValue.length;
        }
      }
    }

    const res = detectFromJsonObject(evt.data, chars, merged);
    if (res.isError) return res;
  }

  return { isError: false };
}
