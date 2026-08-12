import "@/lib/polyfills/file";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { registerCors } from "@/app/v1/_lib/cors";
import {
  handleAvailableModels,
  handleCodexModels,
  handleOpenAICompatibleModels,
} from "@/app/v1/_lib/models/available-models";
import { handleProxyRequest } from "@/app/v1/_lib/proxy-handler";
import { logger } from "@/lib/logger";
import { sensitiveWordDetector } from "@/lib/sensitive-word-detector";
import { SessionTracker } from "@/lib/session-tracker";

export const runtime = "nodejs";

// 初始化 SessionTracker（清理旧 Set 格式数据）
SessionTracker.initialize().catch((err) => {
  logger.error("[App] SessionTracker initialization failed:", err);
});

// 仅在测试或构建阶段允许跳过预热，避免生产环境静默关闭敏感词拦截。
const hasDsn = Boolean(process.env.DSN?.trim());
const canSkipDsnWarmup =
  process.env.NODE_ENV === "test" || process.env.NEXT_PHASE === "phase-production-build";

if (hasDsn) {
  sensitiveWordDetector.reload().catch((err) => {
    logger.error("[App] SensitiveWordDetector initialization failed:", err);
  });
} else if (canSkipDsnWarmup) {
  logger.info("[App] SensitiveWordDetector warmup skipped: DSN not configured");
} else {
  throw new Error("[App] DSN is required for SensitiveWordDetector warmup");
}

const app = new Hono().basePath("/v1");

registerCors(app);

// 模型列表端点
app.get("/models", handleAvailableModels); // 聚合式，返回用户可用的所有模型
app.get("/responses/models", handleCodexModels); // 只返回 codex 类型（用于 /v1/responses）
app.get("/chat/completions/models", handleOpenAICompatibleModels); // 只返回 openai-compatible 类型
app.get("/chat/models", handleOpenAICompatibleModels); // 简写路径

// 本地推理服务器探测端点——快速短路，不转发上游。
// Hermes Agent 等客户端用这些端点探测目标是不是本地推理服务器
// （LM Studio / Ollama / llama.cpp / vLLM）。CCH 是 API 网关，不是本地
// 推理服务，直接返回 404 让客户端快速判定"非本地服务器"，避免 catch-all
// 把探测请求转发到上游 sub2api 后白白等 2~3 秒超时。
app.all("/props", (c) => c.json({ error: "not_a_local_server" }, 404));
app.all("/models/:model", (c) => c.json({ error: "model_not_found" }, 404));

// OpenAI Compatible API 路由
app.post("/chat/completions", handleProxyRequest);

// Response API 路由（支持 Codex）
app.post("/responses", handleProxyRequest);

// 内部健康自检端点（不走 proxy，仅验证 Hono 中间件链可用）
app.get("/_ping", (c) => c.json({ status: "pong" }));

// Claude API 和其他所有请求（fallback）
app.all("*", handleProxyRequest);

export { app as v1App };

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
export const OPTIONS = handle(app);
export const HEAD = handle(app);
