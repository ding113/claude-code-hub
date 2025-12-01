/**
 * OpenAI Compatible → Codex Response API 转换器注册
 *
 * 将 OpenAI Compatible 与 Codex 之间的请求/响应转换器注册到全局注册表。
 *
 * 转换方向：
 * - 请求：OpenAI → Codex（用户发送 OpenAI 格式，转换为 Codex 格式发给上游）
 * - 响应：Codex → OpenAI（上游返回 Codex 格式，转换为 OpenAI 格式返回给用户）
 */

// 复用现有的 Codex → OpenAI 响应转换器
import {
  transformCodexNonStreamResponseToOpenAI,
  transformCodexStreamResponseToOpenAI,
} from "../codex-to-openai/response";
import { registerTransformer } from "../registry";
import { transformOpenAIRequestToCodex } from "./request";

// 注册 OpenAI Compatible → Codex 转换器
// 请求：OpenAI → Codex（使用本模块的请求转换器）
// 响应：Codex → OpenAI（复用 codex-to-openai 的响应转换器）
registerTransformer("openai-compatible", "codex", transformOpenAIRequestToCodex, {
  stream: transformCodexStreamResponseToOpenAI,
  nonStream: transformCodexNonStreamResponseToOpenAI,
});
