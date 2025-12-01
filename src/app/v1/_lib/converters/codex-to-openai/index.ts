/**
 * Codex (Response API) → OpenAI Compatible 转换器注册
 *
 * 将 Codex 与 OpenAI Compatible 之间的请求/响应转换器注册到全局注册表。
 */

import { registerTransformer } from "../registry";
import { transformCodexRequestToOpenAI } from "./request";
import {
  transformCodexNonStreamResponseToOpenAI,
  transformCodexStreamResponseToOpenAI,
} from "./response";

// 注册 Codex → OpenAI Compatible 转换器
// 请求：Codex → OpenAI（使用本模块的请求转换器）
// 响应：OpenAI → Codex（实际上是 Codex → OpenAI，使用本模块的响应转换器）
registerTransformer("codex", "openai-compatible", transformCodexRequestToOpenAI, {
  stream: transformCodexStreamResponseToOpenAI,
  nonStream: transformCodexNonStreamResponseToOpenAI,
});
