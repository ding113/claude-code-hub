import type {
  ProviderType,
  StructuredMessage,
  WebhookPayload,
  WebhookSendOptions,
  WebhookTargetConfig,
} from "../types";
import { CustomRenderer } from "./custom";
import { DingTalkRenderer } from "./dingtalk";
import { FeishuCardRenderer } from "./feishu";
import { TelegramRenderer } from "./telegram";
import { WeChatRenderer } from "./wechat";

export interface Renderer {
  render(message: StructuredMessage, options?: WebhookSendOptions): WebhookPayload;
}

export function createRenderer(provider: ProviderType, config?: WebhookTargetConfig): Renderer {
  switch (provider) {
    case "wechat":
      return new WeChatRenderer();
    case "feishu":
      return new FeishuCardRenderer();
    case "dingtalk":
      return new DingTalkRenderer();
    case "telegram": {
      const chatId = config?.telegramChatId?.trim();
      if (!chatId) {
        throw new Error("Telegram Chat ID 不能为空");
      }
      return new TelegramRenderer(chatId);
    }
    case "custom": {
      const template = config?.customTemplate ?? null;
      if (!template || typeof template !== "object" || Array.isArray(template)) {
        throw new Error("自定义 Webhook 模板不能为空");
      }
      return new CustomRenderer(template, config?.customHeaders ?? null);
    }
    default: {
      const _exhaustiveCheck: never = provider;
      throw new Error(`不支持的推送渠道: ${provider}`);
    }
  }
}
