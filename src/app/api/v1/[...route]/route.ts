/**
 * Next.js App Router 入口：/api/v1/* 管理 API
 *
 * 通过 Hono 的 `handle(app)` 适配器把 OpenAPIHono 应用桥接到 Next.js 的请求处理函数。
 * 路由实际定义集中在 `_root/app.ts`，本文件仅做绑定与运行时声明。
 */

import { handle } from "hono/vercel";
import { managementApiApp } from "@/app/api/v1/_root/app";

// 数据库 / Redis 等依赖需要 Node.js 运行时
export const runtime = "nodejs";

// 文档与健康检查响应不应被静态化或缓存
export const dynamic = "force-dynamic";

export const GET = handle(managementApiApp);
export const POST = handle(managementApiApp);
export const PUT = handle(managementApiApp);
export const PATCH = handle(managementApiApp);
export const DELETE = handle(managementApiApp);
export const OPTIONS = handle(managementApiApp);
