import { Hono } from "hono";
import { handleChatCompletions } from "@/app/v1/_lib/codex/chat-completions-handler";
import { registerCors } from "@/app/v1/_lib/cors";
import {
  handleAvailableModels,
  handleCodexModels,
  handleOpenAICompatibleModels,
} from "@/app/v1/_lib/models/available-models";
import { handleProxyRequest } from "@/app/v1/_lib/proxy-handler";

export function createV1App(basePath: string): Hono {
  const app = new Hono().basePath(basePath);

  registerCors(app);

  app.get("/models", handleAvailableModels);
  app.get("/responses/models", handleCodexModels);
  app.get("/chat/completions/models", handleOpenAICompatibleModels);
  app.get("/chat/models", handleOpenAICompatibleModels);

  app.post("/chat/completions", handleChatCompletions);
  app.post("/responses", handleChatCompletions);
  app.all("*", handleProxyRequest);

  return app;
}
