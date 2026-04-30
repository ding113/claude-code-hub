/**
 * /api/v1 类型化客户端的统一对外入口。
 *
 * 用法：
 *   import { fetchApi, ApiError, localizeError } from "@/lib/api-client/v1/client";
 *
 * 设计：
 * - re-export fetcher / errors 中的核心 API；
 * - 暴露一个空的 `apiClient` 命名空间，资源模块（如 webhook-targets）通过 `Object.assign`
 *   挂载具体方法，避免循环依赖；
 * - 暴露 `setApiBaseUrl` 用于测试或多环境 (e.g. 桌面客户端) 切换。
 */

export type { ErrorTranslator, InvalidParam, ProblemJson } from "@/lib/api-client/v1/errors";
export { ApiError, localizeError } from "@/lib/api-client/v1/errors";
export type { FetchApiInit } from "@/lib/api-client/v1/fetcher";
export {
  __resetCsrfTokenCacheForTests,
  fetchApi,
  getApiBaseUrl,
  setApiBaseUrl,
} from "@/lib/api-client/v1/fetcher";
export type { V1QueryKey } from "@/lib/api-client/v1/keys";
export { v1Keys } from "@/lib/api-client/v1/keys";

/**
 * 资源模块挂载点。后续任务会通过 `Object.assign(apiClient, { webhookTargets: {...} })`
 * 增量补全。占位形状故意保持空对象，让类型可被扩展。
 */
export const apiClient: Record<string, unknown> = {};
