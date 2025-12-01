/**
 * Codex (Response API) ↔ Claude Messages API 转换器注册
 *
 * 将 Codex 与 Claude 之间的请求/响应转换器注册到全局注册表。
 */

import {
  transformClaudeNonStreamResponseToCodex,
  transformClaudeStreamResponseToCodex,
} from "../claude-to-codex/response";
import { registerTransformer } from "../registry";
import { transformCodexRequestToClaude } from "./request";

// 注册 Codex → Claude 转换器
// 请求：Codex → Claude（使用本模块的请求转换器）
// 响应：Claude → Codex（使用 claude-to-codex 的响应转换器）
registerTransformer("codex", "claude", transformCodexRequestToClaude, {
  stream: transformClaudeStreamResponseToCodex,
  nonStream: transformClaudeNonStreamResponseToCodex,
});
