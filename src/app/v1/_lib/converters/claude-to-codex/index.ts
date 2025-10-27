/**
 * Claude Messages API → Codex (Response API) 转换器注册
 *
 * 将 Claude 与 Codex 之间的请求/响应转换器注册到全局注册表。
 */

import { registerTransformer } from "../registry";
import { transformClaudeRequestToCodex } from "./request";
import {
  transformCodexStreamResponseToClaude,
  transformCodexNonStreamResponseToClaude,
} from "../codex-to-claude/response";

// 注册 Claude → Codex 转换器
// 请求：Claude → Codex（使用本模块的请求转换器）
// 响应：Codex → Claude（使用 codex-to-claude 的响应转换器）
registerTransformer(
  "claude",
  "codex",
  transformClaudeRequestToCodex,
  {
    stream: transformCodexStreamResponseToClaude,
    nonStream: transformCodexNonStreamResponseToClaude,
  }
);
