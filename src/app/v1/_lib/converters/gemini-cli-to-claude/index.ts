/**
 * Gemini CLI → Claude Messages API 转换器模块
 *
 * 导出并注册 Gemini CLI 到 Claude 的请求和响应转换器。
 */

import { registerTransformer } from "../registry";
import { transformGeminiCLIRequestToClaude } from "./request";
import {
  transformGeminiCLINonStreamResponseToClaude,
  transformGeminiCLIStreamResponseToClaude,
} from "./response";

// 注册 Gemini CLI → Claude 转换器
registerTransformer(
  "gemini-cli",
  "claude",
  // 请求转换器
  transformGeminiCLIRequestToClaude,
  // 响应转换器
  {
    stream: transformGeminiCLIStreamResponseToClaude,
    nonStream: transformGeminiCLINonStreamResponseToClaude,
  }
);

// 导出转换函数供测试使用
export {
  transformGeminiCLIRequestToClaude,
  transformGeminiCLIStreamResponseToClaude,
  transformGeminiCLINonStreamResponseToClaude,
};
