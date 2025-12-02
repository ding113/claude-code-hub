/**
 * Claude Messages API → OpenAI Compatible 转换器注册
 *
 * 将 Claude 与 OpenAI Compatible 之间的请求/响应转换器注册到全局注册表。
 */

import {
  transformClaudeNonStreamResponseToOpenAI,
  transformClaudeStreamResponseToOpenAI,
} from "../openai-to-claude/response"; // 复用 OpenAI → Claude 的响应转换器（反向）
import { registerTransformer } from "../registry";
import { transformClaudeRequestToOpenAI } from "./request";

// 注册 Claude → OpenAI Compatible 转换器
// 请求：Claude → OpenAI（使用本模块的请求转换器）
// 响应：OpenAI → Claude（实际上是 Claude → OpenAI，复用响应转换器）
//
// 注意：这里复用了 openai-to-claude/response.ts 中的响应转换器，
// 因为 Claude → OpenAI 的响应转换逻辑是相同的（都是将 Claude 响应转为 OpenAI 格式）
registerTransformer("claude", "openai-compatible", transformClaudeRequestToOpenAI, {
  stream: transformClaudeStreamResponseToOpenAI,
  nonStream: transformClaudeNonStreamResponseToOpenAI,
});
