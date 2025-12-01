/**
 * 转换器主入口
 *
 * 自动导入并注册所有转换器到全局注册表。
 *
 * 使用方式：
 * ```ts
 * import "@/app/v1/_lib/converters"; // 自动注册所有转换器
 * import { defaultRegistry } from "@/app/v1/_lib/converters/registry";
 *
 * // 转换请求
 * const transformed = defaultRegistry.transformRequest('codex', 'claude', model, request, stream);
 *
 * // 转换响应
 * const result = defaultRegistry.transformStreamResponse('codex', 'claude', ctx, model, origReq, transReq, chunk, state);
 * ```
 */

// 导入转换器（副作用：自动注册到 defaultRegistry）
// Codex (Response API) 相关转换器
import "./codex-to-claude";
import "./codex-to-openai";
import "./claude-to-codex";

// OpenAI Compatible 相关转换器
import "./openai-to-claude";
import "./openai-to-codex"; // OpenAI → Codex 转换器（新增）
import "./claude-to-openai";

// Gemini CLI 相关转换器
import "./gemini-cli-to-claude";
import "./gemini-cli-to-openai";

// 导出核心类型和注册表
export { defaultRegistry, registerTransformer, TransformerRegistry } from "./registry";
export {
  buildForwardMapFromRequest,
  buildReverseMapFromRequest,
  ToolNameMapper,
} from "./tool-name-mapper";
export type {
  Format,
  RequestTransform,
  ResponseNonStreamTransform,
  ResponseStreamTransform,
  ResponseTransform,
  TransformerConfig,
  TransformerMetadata,
  TransformState,
} from "./types";
