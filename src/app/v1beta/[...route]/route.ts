import "@/lib/polyfills/file";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { registerCors } from "@/app/v1/_lib/cors";
import { handleAvailableModels } from "@/app/v1/_lib/models/available-models";
import { handleProxyRequest } from "@/app/v1/_lib/proxy-handler";

export const runtime = "nodejs";

// Gemini API 路由处理器（/v1beta/models/{model}:generateContent）
const app = new Hono().basePath("/v1beta");

registerCors(app);

// 模型列表端点（聚合式，返回用户可用的所有模型）
app.get("/models", handleAvailableModels);

// 所有 Gemini API 请求都通过 proxy handler 处理
// 格式检测会自动识别 Gemini 请求体中的 contents 字段
app.all("*", handleProxyRequest);

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
export const OPTIONS = handle(app);
export const HEAD = handle(app);
