/**
 * /api/v1 管理 API 的类型出口
 *
 * 集中导出 @hono/zod-openapi 的内部类型别名，避免散落于业务模块。
 */

import type { OpenAPIHono } from "@hono/zod-openapi";

/**
 * OpenAPIHono 文档配置对象类型
 *
 * 与 `app.doc(path, config)` / `app.getOpenAPIDocument(config)` 接收的入参形状一致。
 * 由于 @hono/zod-openapi 没有公开导出该类型，这里使用 ReturnType/Parameters 推导。
 */
export type OpenAPIObjectConfig = Parameters<OpenAPIHono["getOpenAPIDocument"]>[0];
