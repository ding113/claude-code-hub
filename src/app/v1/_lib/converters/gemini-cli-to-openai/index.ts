/**
 * Gemini CLI → OpenAI Compatible API 转换器模块
 *
 * 导出并注册 Gemini CLI 到 OpenAI Compatible API 的请求和响应转换器。
 *
 * 注意：这是双向转换器
 * - Gemini CLI → OpenAI Compatible: 用于将 Gemini CLI 格式请求转换为 OpenAI 格式后发送到 OpenAI 兼容提供商
 * - OpenAI → Gemini CLI: 用于将 OpenAI 响应转换回 Gemini CLI 格式返回给客户端
 */

import { registerTransformer } from "../registry";
import { transformGeminiCLIRequestToOpenAI } from "./request";
import {
  transformOpenAINonStreamResponseToGeminiCLI,
  transformOpenAIStreamResponseToGeminiCLI,
} from "./response";

// 注册 Gemini CLI → OpenAI Compatible 转换器
registerTransformer(
  "gemini-cli",
  "openai-compatible",
  // 请求转换器
  transformGeminiCLIRequestToOpenAI,
  // 响应转换器
  {
    stream: transformOpenAIStreamResponseToGeminiCLI,
    nonStream: transformOpenAINonStreamResponseToGeminiCLI,
  }
);

// 导出转换函数供测试使用
export {
  transformGeminiCLIRequestToOpenAI,
  transformOpenAIStreamResponseToGeminiCLI,
  transformOpenAINonStreamResponseToGeminiCLI,
};
