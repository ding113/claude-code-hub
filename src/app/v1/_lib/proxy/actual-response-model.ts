import type { ProviderType } from "@/types/provider";
import type { ClientFormat } from "./format-mapper";

/**
 * 协议提取档位(8 case + Gemini CLI 复用)
 *
 * 对应关系:
 *   claude        -> anthropic/{non-stream,stream}
 *   openai        -> openai-chat/{non-stream,stream}
 *   response      -> openai-responses/{non-stream,stream}
 *   gemini*       -> gemini/{non-stream,stream}
 */
export type ExtractKind =
  | "openai-chat/non-stream"
  | "openai-chat/stream"
  | "openai-responses/non-stream"
  | "openai-responses/stream"
  | "anthropic/non-stream"
  | "anthropic/stream"
  | "gemini/non-stream"
  | "gemini/stream";

export function kindFromClientFormat(format: ClientFormat, isStream: boolean): ExtractKind | null {
  switch (format) {
    case "claude":
      return isStream ? "anthropic/stream" : "anthropic/non-stream";
    case "openai":
      return isStream ? "openai-chat/stream" : "openai-chat/non-stream";
    case "response":
      return isStream ? "openai-responses/stream" : "openai-responses/non-stream";
    case "gemini":
    case "gemini-cli":
      return isStream ? "gemini/stream" : "gemini/non-stream";
    default:
      return null;
  }
}

/**
 * 根据**上游供应商**类型决定提取 kind。
 *
 * 这是推荐的入口:CCH 可能在 client 格式和 provider 格式之间做转换,
 * 但 actualResponseModel 要反映**上游实际返回**的模型名,
 * 所以应当按 provider 的协议解析响应体。
 */
export function kindFromProviderType(
  providerType: ProviderType,
  isStream: boolean
): ExtractKind | null {
  switch (providerType) {
    case "claude":
    case "claude-auth":
      return isStream ? "anthropic/stream" : "anthropic/non-stream";
    case "openai-compatible":
      return isStream ? "openai-chat/stream" : "openai-chat/non-stream";
    case "codex":
      return isStream ? "openai-responses/stream" : "openai-responses/non-stream";
    case "gemini":
    case "gemini-cli":
      return isStream ? "gemini/stream" : "gemini/non-stream";
    default:
      return null;
  }
}

/**
 * 从上游响应体文本里提取实际返回的模型名
 *
 * 约束:
 * - 返回 `null` 表示未能提取(malformed / 未命中 / 空输入),绝不抛出
 * - 流式入参: 允许 SSE (`data: <json>\n\n`) / NDJSON / 混合;按协议挑首条含模型字段的事件
 * - 非流式入参: 一个完整 JSON 对象
 *
 * 引用: 详见 .claude/plans/worktree-pr-curried-bird.md 表格
 */
export function extractActualResponseModel(
  kind: ExtractKind,
  bodyText: string | null | undefined
): string | null {
  if (!bodyText || typeof bodyText !== "string") return null;
  try {
    switch (kind) {
      case "openai-chat/non-stream":
      case "openai-responses/non-stream":
      case "anthropic/non-stream":
        return readTopLevelModel(parseJsonSafe(bodyText));

      case "gemini/non-stream":
        return readGeminiModelVersion(parseJsonSafe(bodyText));

      case "openai-chat/stream":
        return scanStream(bodyText, readTopLevelModel);

      case "openai-responses/stream":
        return scanStream(bodyText, readResponsesEnvelopeModel);

      case "anthropic/stream":
        return scanStream(bodyText, readAnthropicMessageStartModel);

      case "gemini/stream":
        return scanStream(bodyText, readGeminiModelVersion);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 运行时便捷入口: 给定 provider 类型 / 流标志 / 响应体,返回实际响应模型名。
 * 无法识别 kind 或输入缺失时返回 `null`。
 */
export function extractActualResponseModelForProvider(
  providerType: ProviderType | null | undefined,
  isStream: boolean,
  body: string | null | undefined
): string | null {
  if (!providerType || !body) return null;
  const kind = kindFromProviderType(providerType, isStream);
  if (!kind) return null;
  return extractActualResponseModel(kind, body);
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readTopLevelModel(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  return normalize((obj as { model?: unknown }).model);
}

function readGeminiModelVersion(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const typed = obj as { modelVersion?: unknown; model_version?: unknown };
  return normalize(typed.modelVersion) ?? normalize(typed.model_version);
}

/**
 * OpenAI Responses 流事件信封:
 *   response.created / response.in_progress / response.completed / response.output_text.delta...
 * 只有 `response` 为对象(信封事件)时 `response.model` 有效;文本增量事件不含 model。
 */
function readResponsesEnvelopeModel(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const envelope = (obj as { response?: unknown }).response;
  if (envelope && typeof envelope === "object") {
    const m = normalize((envelope as { model?: unknown }).model);
    if (m) return m;
  }
  return readTopLevelModel(obj);
}

/**
 * Anthropic 流式: 只在 message_start 事件里有 message.model
 *   event: message_start
 *   data: {"type":"message_start","message":{"type":"message","model":"claude-...",...}}
 */
function readAnthropicMessageStartModel(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const typed = obj as { type?: unknown; message?: unknown };
  if (typed.type !== "message_start") return null;
  if (!typed.message || typeof typed.message !== "object") return null;
  return normalize((typed.message as { model?: unknown }).model);
}

/**
 * 扫描流式文本(兼容 SSE 和 NDJSON),对每个可解析的 JSON 对象调用 reader,
 * 返回第一个非空结果。遇到 `[DONE]` / 空行 / malformed / 未命中的事件一律忽略。
 */
function scanStream(text: string, reader: (obj: unknown) => string | null): string | null {
  for (const candidate of extractJsonChunks(text)) {
    const obj = parseJsonSafe(candidate);
    if (!obj) continue;
    const hit = reader(obj);
    if (hit) return hit;
  }
  return null;
}

function* extractJsonChunks(text: string): Generator<string, void, void> {
  const lines = text.split(/\r?\n/);
  let ndjsonBuffer = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (ndjsonBuffer) {
        yield ndjsonBuffer;
        ndjsonBuffer = "";
      }
      continue;
    }

    // SSE 形式: data: {...}  或  data:{...}
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trimStart();
      if (!payload || payload === "[DONE]") continue;
      yield payload;
      continue;
    }

    // 以 ':' 开头是 SSE 注释(例如 keep-alive),忽略
    if (line.startsWith(":")) continue;
    // event: ... / id: ... / retry: ... 这些头字段都跳过
    if (/^(event|id|retry):/i.test(line)) continue;

    // 其余情况视为 NDJSON 的一行(Gemini alt=sse 以外的旧形态)
    // 或者一条跨行 JSON 的一部分(极少见,用 buffer 合并)
    if (line.startsWith("{") && line.endsWith("}")) {
      yield line;
      ndjsonBuffer = "";
    } else {
      ndjsonBuffer += line;
      // 尝试提前 flush 闭合的 JSON
      if (ndjsonBuffer.startsWith("{") && balanced(ndjsonBuffer)) {
        yield ndjsonBuffer;
        ndjsonBuffer = "";
      }
    }
  }

  if (ndjsonBuffer.startsWith("{")) yield ndjsonBuffer;
}

function balanced(s: string): boolean {
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (const ch of s) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return true;
    }
  }
  return false;
}
