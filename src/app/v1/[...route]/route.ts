import "@/lib/polyfills/file";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { handleChatCompletions } from "@/app/v1/_lib/codex/chat-completions-handler";
import { registerCors } from "@/app/v1/_lib/cors";
import { handleProxyRequest } from "@/app/v1/_lib/proxy-handler";
import { logger } from "@/lib/logger";
import { sensitiveWordDetector } from "@/lib/sensitive-word-detector";
import { SessionTracker } from "@/lib/session-tracker";

export const runtime = "nodejs";

// 初始化 SessionTracker（清理旧 Set 格式数据）
SessionTracker.initialize().catch((err) => {
  logger.error("[App] SessionTracker initialization failed:", err);
});

// 初始化敏感词检测器（加载缓存）
sensitiveWordDetector.reload().catch((err) => {
  logger.error("[App] SensitiveWordDetector initialization failed:", err);
});

const app = new Hono().basePath("/v1");

registerCors(app);

// OpenAI Compatible API 路由
app.post("/chat/completions", handleChatCompletions);

// Response API 路由（支持 Codex）
app.post("/responses", handleChatCompletions); // OpenAI

// Claude API 和其他所有请求（fallback）
app.all("*", handleProxyRequest);

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
export const OPTIONS = handle(app);
export const HEAD = handle(app);
