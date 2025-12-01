/**
 * OpenAI Compatible ↔ Claude Messages API 转换器注册
 *
 * 将 OpenAI Compatible 与 Claude 之间的请求/响应转换器注册到全局注册表。
 */

import { registerTransformer } from "../registry";
import { transformOpenAIRequestToClaude } from "./request";
import {
  transformClaudeNonStreamResponseToOpenAI,
  transformClaudeStreamResponseToOpenAI,
} from "./response";

// 注册 OpenAI Compatible → Claude 转换器
// 请求：OpenAI → Claude（使用本模块的请求转换器）
// 响应：Claude → OpenAI（使用本模块的响应转换器）
registerTransformer("openai-compatible", "claude", transformOpenAIRequestToClaude, {
  stream: transformClaudeStreamResponseToOpenAI,
  nonStream: transformClaudeNonStreamResponseToOpenAI,
});
