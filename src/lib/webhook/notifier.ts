import { logger } from "@/lib/logger";
import { createRenderer, type Renderer } from "./renderers";
import type { ProviderType, StructuredMessage, WebhookPayload, WebhookResult } from "./types";
import { withRetry } from "./utils/retry";

export interface WebhookNotifierOptions {
  maxRetries?: number;
}

export class WebhookNotifier {
  private readonly webhookUrl: string;
  private readonly maxRetries: number;
  private readonly renderer: Renderer;
  private readonly providerType: ProviderType;

  constructor(webhookUrl: string, options?: WebhookNotifierOptions) {
    this.webhookUrl = webhookUrl;
    this.maxRetries = options?.maxRetries ?? 3;
    this.providerType = this.detectProvider();
    this.renderer = createRenderer(this.providerType);
  }

  async send(message: StructuredMessage): Promise<WebhookResult> {
    const payload = this.renderer.render(message);

    try {
      return await withRetry(() => this.doSend(payload), {
        maxRetries: this.maxRetries,
        baseDelay: 1000,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({
        action: "webhook_send_failed",
        provider: this.providerType,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  private detectProvider(): ProviderType {
    const url = new URL(this.webhookUrl);
    if (url.hostname === "qyapi.weixin.qq.com") return "wechat";
    if (url.hostname === "open.feishu.cn") return "feishu";
    throw new Error(`Unsupported webhook hostname: ${url.hostname}`);
  }

  private async doSend(payload: WebhookPayload): Promise<WebhookResult> {
    logger.info({
      action: "webhook_send",
      provider: this.providerType,
      bodyLength: payload.body.length,
    });

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...payload.headers,
      },
      body: payload.body,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return this.checkResponse(result);
  }

  private checkResponse(response: Record<string, unknown>): WebhookResult {
    switch (this.providerType) {
      case "wechat":
        if (response.errcode === 0) {
          return { success: true };
        }
        throw new Error(`WeChat API Error ${response.errcode}: ${response.errmsg}`);

      case "feishu":
        if (response.code === 0) {
          return { success: true };
        }
        throw new Error(`Feishu API Error ${response.code}: ${response.msg}`);
    }
  }
}

/**
 * 便捷函数：发送结构化消息到 webhook
 */
export async function sendWebhookMessage(
  webhookUrl: string,
  message: StructuredMessage
): Promise<WebhookResult> {
  if (!webhookUrl) {
    return { success: false, error: "Webhook URL is empty" };
  }

  const notifier = new WebhookNotifier(webhookUrl);
  return notifier.send(message);
}
