/**
 * 流式帧内容分类器（CCHP Layer-1 内容信号的 TypeScript 移植）。
 *
 * 对单个完整 SSE 帧（event 名 + data JSON）给出五态判定：
 * - content：携带用户可感知内容，可作为「首个有效内容 chunk」开启透传
 * - error：上游错误信号（fake-200 / 流中 error 帧），commit 前出现即 failover
 * - malformed：data 不是合法 JSON 载荷，立即终止当前 attempt（fail-closed）
 * - terminal：干净终止标记（[DONE] / message_stop 等），不开启透传
 * - neutral：bookkeeping / 未知事件，继续缓冲，由首块超时兜底
 *
 * 判定优先级：sentinel(terminal) > malformed > error > content > terminal > neutral。
 * error 先于 content：fake-200 上游可能在 error 帧里附带残缺内容字段。
 * 未知事件一律中性（provider 新增 lifecycle 事件前向兼容）。
 *
 * 规则数据移植自 CCHP generated/content_signals.json（团队拥有版权），
 * 求值语义与 CCHP pkg/protocol/sdkcatalog/content_gate.go 对齐：
 * - 规则内多条件 AND；空规则永不命中
 * - anyPaths：任一路径解析出「非空」值即命中（gjson 语义，见 isNonEmptyValue）
 * - valueMatches：路径值（数组则任一元素）等于任一候选串
 */

export type ProtocolFamily = "anthropic" | "openai-chat" | "openai-responses" | "gemini";

export type FrameVerdict = "content" | "error" | "malformed" | "terminal" | "neutral";

interface ValueMatch {
  path: string;
  values: string[];
}

interface FrameRule {
  eventTypes?: string[];
  anyPaths?: string[];
  valueMatches?: ValueMatch[];
}

interface StreamSignal {
  contentRules: FrameRule[];
  errorRules: FrameRule[];
  terminalRules?: FrameRule[];
  terminalEvents?: string[];
  doneSentinel?: string;
}

const STREAM_SIGNALS: Record<ProtocolFamily, StreamSignal> = {
  anthropic: {
    contentRules: [
      {
        // text_delta / input_json_delta / thinking_delta / signature_delta / citations_delta
        eventTypes: ["content_block_delta"],
        anyPaths: [
          "delta.text",
          "delta.partial_json",
          "delta.thinking",
          "delta.signature",
          "delta.citation",
        ],
      },
      {
        // start 帧即携带实体 payload 的内容块；text/thinking 空启动块等 delta
        eventTypes: ["content_block_start"],
        valueMatches: [
          {
            path: "content_block.type",
            values: [
              "tool_use",
              "server_tool_use",
              "mcp_tool_use",
              "redacted_thinking",
              "web_search_tool_result",
              "web_fetch_tool_result",
              "code_execution_tool_result",
              "bash_code_execution_tool_result",
              "text_editor_code_execution_tool_result",
              "tool_search_tool_result",
              "mcp_tool_result",
              "container_upload",
            ],
          },
        ],
      },
    ],
    errorRules: [
      // SSE event: error + data {"type":"error","error":{...}}
      { eventTypes: ["error"] },
      // 任意帧携带非空顶层 error 对象（非规范上游 fake-200 兜底）
      { anyPaths: ["error"] },
    ],
    terminalEvents: ["message_stop"],
  },
  "openai-chat": {
    contentRules: [
      {
        // chunk 无事件名；delta 携带 content/tool_calls/refusal/audio 即内容
        anyPaths: [
          "choices.#.delta.content",
          "choices.#.delta.tool_calls",
          "choices.#.delta.function_call",
          "choices.#.delta.refusal",
          "choices.#.delta.audio.data",
          "choices.#.delta.audio.transcript",
        ],
      },
    ],
    errorRules: [
      // data: {"error":{...}} 可出现在流中任意位置
      { anyPaths: ["error"] },
    ],
    doneSentinel: "[DONE]",
  },
  "openai-responses": {
    contentRules: [
      {
        // 所有 *.delta 内容事件载荷字段统一为 delta
        eventTypes: [
          "response.output_text.delta",
          "response.refusal.delta",
          "response.reasoning_text.delta",
          "response.reasoning_summary_text.delta",
          "response.audio.delta",
          "response.audio.transcript.delta",
          "response.function_call_arguments.delta",
          "response.custom_tool_call_input.delta",
          "response.code_interpreter_call_code.delta",
          "response.mcp_call_arguments.delta",
        ],
        anyPaths: ["delta"],
      },
      {
        // 渐进图片生成 partial base64
        eventTypes: ["response.image_generation_call.partial_image"],
        anyPaths: ["partial_image_b64"],
      },
      {
        // done 帧携带完整文本（兜住跳过 delta 的上游）
        eventTypes: [
          "response.output_text.done",
          "response.reasoning_text.done",
          "response.reasoning_summary_text.done",
        ],
        anyPaths: ["text"],
      },
      {
        eventTypes: ["response.audio.transcript.done"],
        anyPaths: ["transcript", "text"],
      },
      {
        eventTypes: ["response.refusal.done"],
        anyPaths: ["refusal"],
      },
      {
        eventTypes: ["response.function_call_arguments.done", "response.mcp_call_arguments.done"],
        anyPaths: ["arguments"],
      },
      {
        eventTypes: ["response.custom_tool_call_input.done"],
        anyPaths: ["input"],
      },
      {
        eventTypes: ["response.code_interpreter_call_code.done"],
        anyPaths: ["code"],
      },
      {
        // function_call / mcp_call output item 携带工具名 = 模型已决定调用工具
        eventTypes: ["response.output_item.added"],
        anyPaths: ["item.name"],
      },
    ],
    errorRules: [
      // 顶层 error 事件（code/message/param）
      { eventTypes: ["error"] },
      // 整个 response 失败（response.error 已填充）；
      // 子工具失败（mcp_call.failed 等）模型可继续，为中性
      { eventTypes: ["response.failed"] },
      // 任意帧携带非空 error 对象（response.* 事件的 error:null 不命中）
      { anyPaths: ["error", "response.error"] },
    ],
    terminalEvents: ["response.completed", "response.incomplete"],
  },
  gemini: {
    contentRules: [
      {
        // candidates[].content.parts[] 任一实体载荷字段非空
        anyPaths: [
          "candidates.#.content.parts.#.text",
          "candidates.#.content.parts.#.inlineData.data",
          "candidates.#.content.parts.#.fileData.fileUri",
          "candidates.#.content.parts.#.functionCall.name",
          "candidates.#.content.parts.#.functionResponse.name",
          "candidates.#.content.parts.#.executableCode.code",
          "candidates.#.content.parts.#.codeExecutionResult.output",
        ],
      },
    ],
    errorRules: [
      // 流中 {"error":{code,message,status}} chunk
      { anyPaths: ["error"] },
      // prompt 被安全策略拦截（首 chunk，无 candidates）
      { anyPaths: ["promptFeedback.blockReason"] },
      {
        // 异常终止原因；STOP 与 MAX_TOKENS 为正常终止
        valueMatches: [
          {
            path: "candidates.#.finishReason",
            values: [
              "SAFETY",
              "RECITATION",
              "LANGUAGE",
              "BLOCKLIST",
              "PROHIBITED_CONTENT",
              "SPII",
              "MALFORMED_FUNCTION_CALL",
              "IMAGE_SAFETY",
              "UNEXPECTED_TOOL_CALL",
              "IMAGE_PROHIBITED_CONTENT",
              "NO_IMAGE",
              "IMAGE_RECITATION",
              "IMAGE_OTHER",
              "OTHER",
            ],
          },
        ],
      },
    ],
    terminalRules: [
      // chunk 无事件名；finishReason 出现即近终止（无显式终止哨兵）
      { anyPaths: ["candidates.#.finishReason"] },
    ],
  },
};

/**
 * 供应商类型 → 协议家族映射。
 *
 * 门控分类作用于上游原生 wire 格式（在 ResponseFixer / Gemini 转换之前），
 * 因此按 provider 类型而非入口格式选择家族。未知类型返回 null（跳过门控，fail-open）。
 */
export function mapProviderTypeToFamily(
  providerType: string | null | undefined
): ProtocolFamily | null {
  switch (providerType) {
    case "claude":
    case "claude-auth":
      return "anthropic";
    case "codex":
      return "openai-responses";
    case "openai-compatible":
      return "openai-chat";
    case "gemini":
    case "gemini-cli":
      return "gemini";
    default:
      return null;
  }
}

/**
 * 对单个完整 SSE 帧分类。
 *
 * eventName 为空时取 data 顶层 "type" 字段作为事件判别值（OpenAI Responses /
 * Anthropic 的 data 内嵌 type；OpenAI Chat 与 Gemini 无事件名走纯路径规则）。
 * data 非 JSON 时：命中 doneSentinel -> terminal；空 data 保持中性；
 * 其余损坏或非对象/数组 JSON -> malformed（fail-closed）。
 *
 * 分类器自身异常一律吞为 neutral：绝不因门控 bug 杀正常流。
 */
export function classifyFrame(
  family: ProtocolFamily,
  eventName: string | null,
  data: string
): FrameVerdict {
  try {
    return classifyFrameInner(STREAM_SIGNALS[family], eventName, data);
  } catch {
    return "neutral";
  }
}

function classifyFrameInner(
  signal: StreamSignal,
  eventName: string | null,
  data: string
): FrameVerdict {
  const trimmed = data.trim();
  if (trimmed.length > 0 && signal.doneSentinel && trimmed === signal.doneSentinel) {
    return "terminal";
  }
  if (trimmed.length === 0) {
    return "neutral";
  }
  const first = trimmed[0];
  if (first !== "{" && first !== "[") {
    return "malformed";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return "malformed";
  }
  if (parsed === null || typeof parsed !== "object") {
    return "malformed";
  }

  let effective = (eventName ?? "").trim();
  if (effective === "" && !Array.isArray(parsed)) {
    const typeField = (parsed as Record<string, unknown>).type;
    if (typeof typeField === "string") {
      effective = typeField;
    }
  }

  for (const rule of signal.errorRules) {
    if (frameRuleMatches(rule, effective, parsed)) return "error";
  }
  for (const rule of signal.contentRules) {
    if (frameRuleMatches(rule, effective, parsed)) return "content";
  }
  for (const rule of signal.terminalRules ?? []) {
    if (frameRuleMatches(rule, effective, parsed)) return "terminal";
  }
  if (effective !== "" && signal.terminalEvents?.includes(effective)) {
    return "terminal";
  }
  return "neutral";
}

/** 单条帧规则 AND 语义；空规则永不命中（防目录笔误把所有帧判成内容/错误）。 */
function frameRuleMatches(rule: FrameRule, eventType: string, parsed: unknown): boolean {
  if (rule.eventTypes && rule.eventTypes.length > 0 && !rule.eventTypes.includes(eventType)) {
    return false;
  }
  if (rule.anyPaths && rule.anyPaths.length > 0) {
    let hit = false;
    for (const path of rule.anyPaths) {
      if (isNonEmptyValue(resolvePath(parsed, path))) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }
  if (rule.valueMatches) {
    for (const match of rule.valueMatches) {
      if (!valueMatchHits(match, parsed)) return false;
    }
  }
  return (
    (rule.eventTypes?.length ?? 0) > 0 ||
    (rule.anyPaths?.length ?? 0) > 0 ||
    (rule.valueMatches?.length ?? 0) > 0
  );
}

/** 路径值（数组则任一元素）的字符串形式等于任一候选值即命中。 */
function valueMatchHits(match: ValueMatch, parsed: unknown): boolean {
  if (!match.path || match.values.length === 0) return false;
  const resolved = resolvePath(parsed, match.path);
  if (resolved === undefined) return false;
  const candidates = Array.isArray(resolved) ? resolved : [resolved];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && match.values.includes(candidate)) return true;
    if (typeof candidate === "number" || typeof candidate === "boolean") {
      if (match.values.includes(String(candidate))) return true;
    }
  }
  return false;
}

/**
 * gjson 风格路径求值：`a.b.c` 逐层取键；`#` 段在数组上映射收集。
 *
 * 含 `#` 的路径返回收集数组（可能为空数组 = 存在性视路径而定）；
 * 路径中断（键不存在 / 非对象）返回 undefined。
 */
function resolvePath(node: unknown, path: string): unknown {
  const segments = path.split(".");
  return resolveSegments(node, segments, 0);
}

function resolveSegments(node: unknown, segments: string[], index: number): unknown {
  if (index === segments.length) {
    return node;
  }
  const segment = segments[index];
  if (segment === "#") {
    if (!Array.isArray(node)) return undefined;
    const collected: unknown[] = [];
    for (const item of node) {
      const resolved = resolveSegments(item, segments, index + 1);
      if (resolved !== undefined) {
        if (Array.isArray(resolved) && segments.slice(index + 1).includes("#")) {
          // 嵌套 # 收集结果展平（gjson a.#.b.#.c 语义）
          collected.push(...resolved);
        } else {
          collected.push(resolved);
        }
      }
    }
    return collected;
  }
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return undefined;
  }
  const child = (node as Record<string, unknown>)[segment];
  if (child === undefined) return undefined;
  return resolveSegments(child, segments, index + 1);
}

/**
 * gjson 语义的「非空」判定：
 * - 字符串：非 ""（base64 / 文本 / URL）
 * - 数字：算内容（含 0）
 * - true 算内容；false / null / undefined 不算
 * - 数组：任一元素非空（覆盖 # 收集结果）
 * - 对象：至少一个键（空对象不算内容）
 */
function isNonEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return value !== "";
  if (typeof value === "number" || value === true) return true;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isNonEmptyValue(item)) return true;
    }
    return false;
  }
  if (typeof value === "object") {
    for (const _key in value as Record<string, unknown>) {
      return true;
    }
    return false;
  }
  return false;
}
