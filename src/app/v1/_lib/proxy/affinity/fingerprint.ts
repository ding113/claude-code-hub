import { sha256Hex, stableStringify } from "@/lib/request-identity";
import type { ClientFormat } from "../format-mapper";

/**
 * 最长前缀亲和的链式指纹（CCHP planner/session/fingerprint.go 的移植与改进）。
 *
 * 算法：
 *   F_sys = H( normalize(system + tools) )
 *   F_i   = H( F_{i-1} || normalize(message_i) )
 * H = sha256 截 32 hex（只需系统内自洽，不与 CCHP 字节对齐）。
 * 任意单字符改动令 F_i 及更深全部改变，查找时自然回落到最长未变祖先。
 *
 * 对 CCHP 已知缺陷的三处改进（获批计划明确采纳）：
 * 1. 工具 Parameters 用键序稳定的 canonical JSON 全量序列化（CCHP 丢弃嵌套值）；
 * 2. 图片/文档取内容 sha256 摘要（CCHP 仅取 base64 长度，同长异图会碰撞）；
 * 3. anthropic cache_control 断点标记在消息边界上（子消息粒度省略：真实客户端的
 *    断点落在顶层块边界，消息级边界已覆盖前缀匹配语义）。
 *
 * 归一化规则：
 * - role 永远进哈希；tool_use/tool_call 的易变 id 一律剥离（网关可能重写）；
 * - openai chat 的前导 system/developer 消息并入 F_sys（跨对话稳定段）；
 * - 空消息跳过；任何异常返回 null（fail-open，不做亲和）。
 */

export interface FingerprintBoundary {
  /** 0 = F_sys（系统+工具）；>=1 = 第 depth 条会话消息后的累计边界 */
  depth: number;
  /** sha256 截 32 hex */
  fp: string;
  /** 从开头到本边界（含）的规范化累计字节数，用于最长匹配排序与理论缓存估算 */
  prefixBytes: number;
  /** anthropic cache_control 显式断点落在本消息上 */
  hasCacheControl?: boolean;
}

export interface FingerprintChain {
  sys: FingerprintBoundary;
  /** 浅 -> 深（追加式构建），长度受 window 截断，Sys 永远单独保留 */
  tail: FingerprintBoundary[];
}

export const DEFAULT_AFFINITY_WINDOW = 8;
export const MAX_AFFINITY_WINDOW = 64;

const SEP = "";

export function fingerprintTip(chain: FingerprintChain): FingerprintBoundary {
  return chain.tail.length > 0 ? chain.tail[chain.tail.length - 1] : chain.sys;
}

/**
 * 供查找使用的最深 -> 最浅指纹序列。
 *
 * 只包含会话消息边界（tail），不含 F_sys：仅系统提示词 + 工具相同的
 * 跨对话请求不应命中亲和（过宽匹配会把无关对话粘到同一供应商）。
 */
export function fingerprintsDeepestFirst(chain: FingerprintChain): string[] {
  const out: string[] = [];
  for (let i = chain.tail.length - 1; i >= 0; i--) {
    out.push(chain.tail[i].fp);
  }
  return out;
}

export function computeFingerprintChain(
  message: Record<string, unknown>,
  format: ClientFormat,
  window: number = DEFAULT_AFFINITY_WINDOW
): FingerprintChain | null {
  try {
    return computeChainInner(message, format, normalizeWindow(window));
  } catch {
    return null;
  }
}

function normalizeWindow(window: number): number {
  if (!Number.isFinite(window) || window <= 0) return DEFAULT_AFFINITY_WINDOW;
  return Math.min(Math.floor(window), MAX_AFFINITY_WINDOW);
}

interface NormalizedMessage {
  bytes: string;
  hasCacheControl: boolean;
}

function computeChainInner(
  message: Record<string, unknown>,
  format: ClientFormat,
  window: number
): FingerprintChain | null {
  const extracted = extractConversation(message, format);
  if (!extracted) return null;

  const sysBytes = extracted.sysSegments.join("");
  const sysFp = h32(sysBytes);
  let cumBytes = byteLength(sysBytes);
  const sys: FingerprintBoundary = { depth: 0, fp: sysFp, prefixBytes: cumBytes };

  const tail: FingerprintBoundary[] = [];
  let prev = sysFp;
  let depth = 0;
  for (const normalized of extracted.messages) {
    if (normalized.bytes.length === 0) continue;
    depth++;
    prev = h32(prev + normalized.bytes);
    cumBytes += byteLength(normalized.bytes);
    tail.push({
      depth,
      fp: prev,
      prefixBytes: cumBytes,
      ...(normalized.hasCacheControl ? { hasCacheControl: true } : {}),
    });
  }

  if (tail.length > window) {
    tail.splice(0, tail.length - window);
  }

  return { sys, tail };
}

function h32(input: string): string {
  return sha256Hex(input).slice(0, 32);
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

interface ExtractedConversation {
  sysSegments: string[];
  messages: NormalizedMessage[];
}

function extractConversation(
  body: Record<string, unknown>,
  format: ClientFormat
): ExtractedConversation | null {
  switch (format) {
    case "claude":
      return extractClaude(body);
    case "openai":
      return extractOpenAIChat(body);
    case "response":
      return extractResponses(body);
    case "gemini":
      return extractGemini(body);
    case "gemini-cli": {
      const request = body.request;
      if (request && typeof request === "object") {
        return extractGemini(request as Record<string, unknown>);
      }
      return extractGemini(body);
    }
    default:
      return null;
  }
}

// ===== claude (Anthropic Messages) =====

function extractClaude(body: Record<string, unknown>): ExtractedConversation | null {
  const messages = body.messages;
  if (!Array.isArray(messages)) return null;

  const sysSegments: string[] = [SEP];
  const system = body.system;
  if (typeof system === "string") {
    sysSegments.push(system);
  } else if (Array.isArray(system)) {
    for (const block of system) {
      sysSegments.push(normalizeContentBlock(block));
    }
  }
  appendTools(sysSegments, body.tools, (tool) => ({
    name: readString(tool, "name"),
    description: readString(tool, "description"),
    parameters: readRecord(tool, "input_schema"),
  }));

  const normalizedMessages: NormalizedMessage[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const msg = raw as Record<string, unknown>;
    const parts: string[] = [SEP, readString(msg, "role")];
    let hasCacheControl = false;
    const content = msg.content;
    if (typeof content === "string") {
      parts.push(SEP, "text:", content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        parts.push(normalizeContentBlock(block));
        if (
          block &&
          typeof block === "object" &&
          (block as Record<string, unknown>).cache_control
        ) {
          hasCacheControl = true;
        }
      }
    }
    normalizedMessages.push(finishMessage(parts, hasCacheControl));
  }

  return { sysSegments, messages: normalizedMessages };
}

/** anthropic 内容块归一化（system 块与 message 块共用）。 */
function normalizeContentBlock(block: unknown): string {
  if (!block || typeof block !== "object") {
    return typeof block === "string" ? `${SEP}text:${block}` : "";
  }
  const typed = block as Record<string, unknown>;
  const type = readString(typed, "type");
  switch (type) {
    case "text":
      return `${SEP}text:${readString(typed, "text")}`;
    case "thinking":
      // 思考签名跨轮可能变化，不入指纹
      return `${SEP}thinking:${readString(typed, "thinking")}`;
    case "redacted_thinking":
      return `${SEP}redacted_thinking:${readString(typed, "data")}`;
    case "tool_use":
      // 剥 id，保留工具身份（name + input）
      return `${SEP}tool_use:${readString(typed, "name")}:${stableStringify(typed.input ?? null)}`;
    case "tool_result":
      // 剥 tool_use_id，保留结果内容
      return `${SEP}tool_result:${serializeUnknownContent(typed.content)}`;
    case "image":
    case "document": {
      const source = readRecord(typed, "source");
      return `${SEP}${type}:${digestMediaSource(source)}`;
    }
    default:
      return type ? `${SEP}${type}:${stableStringify(stripVolatileKeys(typed))}` : "";
  }
}

function digestMediaSource(source: Record<string, unknown> | null): string {
  if (!source) return "";
  const mediaType = readString(source, "media_type") || readString(source, "mediaType");
  const data = readString(source, "data");
  if (data) {
    // 内容摘要（而非长度）：同长异图不碰撞；base64 原文绝不进指纹
    return `${mediaType}:${sha256Hex(data).slice(0, 32)}`;
  }
  const url = readString(source, "url");
  return `${mediaType}:${url}`;
}

// ===== openai (Chat Completions) =====

function extractOpenAIChat(body: Record<string, unknown>): ExtractedConversation | null {
  const messages = body.messages;
  if (!Array.isArray(messages)) return null;

  const sysSegments: string[] = [SEP];
  appendTools(sysSegments, body.tools, (tool) => {
    const fn = readRecord(tool, "function");
    return {
      name: fn ? readString(fn, "name") : readString(tool, "name"),
      description: fn ? readString(fn, "description") : readString(tool, "description"),
      parameters: fn ? readRecord(fn, "parameters") : null,
    };
  });

  const normalizedMessages: NormalizedMessage[] = [];
  let inLeadingSystem = true;
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const msg = raw as Record<string, unknown>;
    const role = readString(msg, "role");
    // 前导 system/developer 消息属于跨对话稳定段，并入 F_sys
    if (inLeadingSystem && (role === "system" || role === "developer")) {
      sysSegments.push(SEP, role, ":", serializeUnknownContent(msg.content));
      continue;
    }
    inLeadingSystem = false;

    const parts: string[] = [SEP, role];
    parts.push(SEP, "content:", serializeUnknownContent(msg.content));
    const toolCalls = msg.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const call of toolCalls) {
        if (!call || typeof call !== "object") continue;
        const typedCall = call as Record<string, unknown>;
        const fn = readRecord(typedCall, "function");
        // 剥 call id
        parts.push(
          SEP,
          "tool_call:",
          fn ? readString(fn, "name") : "",
          ":",
          fn ? readString(fn, "arguments") : ""
        );
      }
    }
    if (msg.tool_call_id !== undefined) {
      // tool 角色消息：剥 tool_call_id，内容已在 content 段
      parts.push(SEP, "tool_result");
    }
    normalizedMessages.push(finishMessage(parts, false));
  }

  return { sysSegments, messages: normalizedMessages };
}

// ===== response (OpenAI Responses / Codex) =====

function extractResponses(body: Record<string, unknown>): ExtractedConversation | null {
  const input = body.input;

  const sysSegments: string[] = [SEP];
  const instructions = body.instructions;
  if (typeof instructions === "string") {
    sysSegments.push(instructions);
  }
  appendTools(sysSegments, body.tools, (tool) => ({
    name: readString(tool, "name"),
    description: readString(tool, "description"),
    parameters: readRecord(tool, "parameters"),
  }));

  const normalizedMessages: NormalizedMessage[] = [];
  if (typeof input === "string") {
    normalizedMessages.push({ bytes: `${SEP}user${SEP}text:${input}`, hasCacheControl: false });
  } else if (Array.isArray(input)) {
    for (const raw of input) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const type = readString(item, "type") || "message";
      const parts: string[] = [SEP];
      switch (type) {
        case "message":
          parts.push(
            readString(item, "role"),
            SEP,
            "content:",
            serializeUnknownContent(item.content)
          );
          break;
        case "function_call":
          // 剥 call_id / id
          parts.push(
            "function_call",
            SEP,
            readString(item, "name"),
            ":",
            readString(item, "arguments")
          );
          break;
        case "function_call_output":
          parts.push("function_call_output", SEP, serializeUnknownContent(item.output));
          break;
        case "reasoning":
          parts.push("reasoning", SEP, serializeUnknownContent(item.summary ?? item.content));
          break;
        default:
          parts.push(type, SEP, stableStringify(stripVolatileKeys(item)));
      }
      normalizedMessages.push(finishMessage(parts, false));
    }
  } else {
    return null;
  }

  return { sysSegments, messages: normalizedMessages };
}

// ===== gemini =====

function extractGemini(body: Record<string, unknown>): ExtractedConversation | null {
  const contents = body.contents;
  if (!Array.isArray(contents)) return null;

  const sysSegments: string[] = [SEP];
  const systemInstruction =
    readRecord(body, "systemInstruction") ?? readRecord(body, "system_instruction");
  if (systemInstruction) {
    const parts = systemInstruction.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        sysSegments.push(normalizeGeminiPart(part));
      }
    }
  }
  appendTools(sysSegments, flattenGeminiTools(body.tools), (decl) => ({
    name: readString(decl, "name"),
    description: readString(decl, "description"),
    parameters: readRecord(decl, "parameters"),
  }));

  const normalizedMessages: NormalizedMessage[] = [];
  for (const raw of contents) {
    if (!raw || typeof raw !== "object") continue;
    const content = raw as Record<string, unknown>;
    const parts: string[] = [SEP, readString(content, "role")];
    const contentParts = content.parts;
    if (Array.isArray(contentParts)) {
      for (const part of contentParts) {
        parts.push(normalizeGeminiPart(part));
      }
    }
    normalizedMessages.push(finishMessage(parts, false));
  }

  return { sysSegments, messages: normalizedMessages };
}

function flattenGeminiTools(tools: unknown): unknown[] {
  if (!Array.isArray(tools)) return [];
  const declarations: unknown[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    const decls = (tool as Record<string, unknown>).functionDeclarations;
    if (Array.isArray(decls)) {
      declarations.push(...decls);
    } else {
      declarations.push(tool);
    }
  }
  return declarations;
}

function normalizeGeminiPart(part: unknown): string {
  if (!part || typeof part !== "object") return "";
  const typed = part as Record<string, unknown>;
  if (typeof typed.text === "string") {
    return `${SEP}text:${typed.text}`;
  }
  const functionCall = readRecord(typed, "functionCall");
  if (functionCall) {
    return `${SEP}tool_use:${readString(functionCall, "name")}:${stableStringify(functionCall.args ?? null)}`;
  }
  const functionResponse = readRecord(typed, "functionResponse");
  if (functionResponse) {
    // 剥易变 id，保留工具名 + 响应内容
    return `${SEP}tool_result:${readString(functionResponse, "name")}:${stableStringify(functionResponse.response ?? null)}`;
  }
  const inlineData = readRecord(typed, "inlineData") ?? readRecord(typed, "inline_data");
  if (inlineData) {
    const mime = readString(inlineData, "mimeType") || readString(inlineData, "mime_type");
    const data = readString(inlineData, "data");
    return `${SEP}image:${mime}:${data ? sha256Hex(data).slice(0, 32) : ""}`;
  }
  const fileData = readRecord(typed, "fileData") ?? readRecord(typed, "file_data");
  if (fileData) {
    const mime = readString(fileData, "mimeType") || readString(fileData, "mime_type");
    const uri = readString(fileData, "fileUri") || readString(fileData, "file_uri");
    return `${SEP}file:${mime}:${uri}`;
  }
  return `${SEP}part:${stableStringify(stripVolatileKeys(typed))}`;
}

// ===== 共享工具 =====

interface NormalizedToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown> | null;
}

function appendTools(
  segments: string[],
  tools: unknown,
  project: (tool: Record<string, unknown>) => NormalizedToolSpec
): void {
  if (!Array.isArray(tools) || tools.length === 0) return;
  const specs: NormalizedToolSpec[] = [];
  for (const raw of tools) {
    if (!raw || typeof raw !== "object") continue;
    const spec = project(raw as Record<string, unknown>);
    if (!spec.name) continue;
    specs.push(spec);
  }
  // 按 name 排序：工具顺序差异不产生不同 F_sys
  specs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const spec of specs) {
    segments.push(
      SEP,
      spec.name,
      ":",
      spec.description,
      ":",
      spec.parameters ? stableStringify(spec.parameters) : ""
    );
  }
}

function finishMessage(parts: string[], hasCacheControl: boolean): NormalizedMessage {
  // 只有分隔符 + role 而无任何内容段的消息视为空
  const bytes = parts.join("");
  const meaningful = parts.length > 2;
  return { bytes: meaningful ? bytes : "", hasCacheControl };
}

function serializeUnknownContent(content: unknown): string {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  return stableStringify(content);
}

const VOLATILE_KEYS = new Set(["id", "call_id", "tool_use_id", "tool_call_id", "cache_control"]);

function stripVolatileKeys(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (VOLATILE_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
