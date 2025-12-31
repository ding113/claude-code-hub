import type { ProviderType, StructuredMessage, WebhookPayload } from "../types";
import { FeishuCardRenderer } from "./feishu";
import { WeChatRenderer } from "./wechat";

export interface Renderer {
  render(message: StructuredMessage): WebhookPayload;
}

export function createRenderer(provider: ProviderType): Renderer {
  switch (provider) {
    case "wechat":
      return new WeChatRenderer();
    case "feishu":
      return new FeishuCardRenderer();
  }
}
