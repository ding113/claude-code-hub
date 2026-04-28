/**
 * /api/v1 客户端的查询键集中注册表。
 *
 * 设计目标：
 * - 单一入口，避免散落的字符串字面量；
 * - 各资源后续通过 `Object.assign(v1Keys, { resource: ... })` 追加自身命名空间；
 * - 顶层 `all` 用于一次性失效全部 v1 缓存。
 */

export const v1Keys = {
  /** 顶层根键，所有 v1 查询都派生自此 */
  all: ["v1"] as const,
  // 资源级注册项由后续任务以 Object.assign 追加，本文件保持轻量。
} as const;

/**
 * v1Keys 上所有值的联合类型。
 *
 * 在追加资源键后，可派生 `typeof v1Keys.<resource>.<method>(...)` 风格的精确类型。
 */
export type V1QueryKey = (typeof v1Keys)[keyof typeof v1Keys];
