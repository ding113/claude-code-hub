import { createHmac } from "node:crypto";
import type { Dispatcher } from "undici";
import { logger } from "@/lib/logger";
import { createProxyAgentForProvider, type ProxyConfig } from "@/lib/proxy-agent";
import { createRenderer, type Renderer } from "./renderers";
import type {
  ProviderType,
  StructuredMessage,
  WebhookPayload,
  WebhookResult,
  WebhookSendOptions,
  WebhookTargetConfig,
} from "./types";
import { withRetry } from "./utils/retry";

export interface WebhookNotifierOptions {
  maxRetries?: number;
}

export class WebhookNotifier {
  private readonly maxRetries: number;
  private readonly renderer: Renderer;
  private readonly providerType: ProviderType;
  private readonly config: WebhookTargetConfig;
  private readonly proxyConfig: ProxyConfig | null;

  constructor(target: string | WebhookTargetConfig, options?: WebhookNotifierOptions) {
    this.maxRetries = options?.maxRetries ?? 3;
    this.config =
      typeof target === "string"
        ? {
            providerType: WebhookNotifier.detectProvider(target),
            webhookUrl: target,
          }
        : target;

    this.providerType = this.config.providerType;
    this.renderer = createRenderer(this.providerType, this.config);
    this.proxyConfig = this.createProxyConfig();
  }

  async send(message: StructuredMessage, options?: WebhookSendOptions): Promise<WebhookResult> {
    const payload = this.renderer.render(message, options);
    const url = this.getEndpointUrl();

    try {
      return await withRetry(() => this.doSend(url, payload), {
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

  private static detectProvider(webhookUrl: string): ProviderType {
    const url = new URL(webhookUrl);
    if (url.hostname === "qyapi.weixin.qq.com") return "wechat";
    if (url.hostname === "open.feishu.cn") return "feishu";
    throw new Error(`Unsupported webhook hostname: ${url.hostname}`);
  }

  private getEndpointUrl(): string {
    switch (this.providerType) {
      case "telegram": {
        const botToken = this.config.telegramBotToken?.trim();
        if (!botToken) {
          throw new Error("Telegram Bot Token 不能为空");
        }
        return `https://api.telegram.org/bot${botToken}/sendMessage`;
      }

      case "dingtalk": {
        const webhookUrl = this.getWebhookUrlOrThrow();
        return this.withDingtalkSignature(webhookUrl);
      }

      case "wechat":
      case "feishu":
      case "custom":
        return this.getWebhookUrlOrThrow();
    }
  }

  private getWebhookUrlOrThrow(): string {
    const url = this.config.webhookUrl?.trim();
    if (!url) {
      throw new Error("Webhook URL 不能为空");
    }
    return url;
  }

  private withDingtalkSignature(webhookUrl: string): string {
    const secret = this.config.dingtalkSecret?.trim();
    if (!secret) {
      return webhookUrl;
    }

    const timestamp = Date.now();
    const stringToSign = `${timestamp}\n${secret}`;
    const sign = createHmac("sha256", secret).update(stringToSign).digest("base64");

    const url = new URL(webhookUrl);
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);
    return url.toString();
  }

  private createProxyConfig(): ProxyConfig | null {
    const proxyUrl = this.config.proxyUrl?.trim();
    if (!proxyUrl) {
      return null;
    }

    const targetUrl = this.getProxyTargetUrl();
    return createProxyAgentForProvider(
      {
        id: this.config.id ?? 0,
        name: this.config.name ?? "webhook",
        proxyUrl,
        proxyFallbackToDirect: this.config.proxyFallbackToDirect ?? false,
      },
      targetUrl,
      false
    );
  }

  private getProxyTargetUrl(): string {
    if (this.providerType === "telegram") {
      return "https://api.telegram.org";
    }
    return new URL(this.getWebhookUrlOrThrow()).origin;
  }

  private async doSend(url: string, payload: WebhookPayload): Promise<WebhookResult> {
    logger.info({
      action: "webhook_send",
      provider: this.providerType,
      bodyLength: payload.body.length,
    });

    const init: RequestInit & { dispatcher?: Dispatcher } = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...payload.headers,
      },
      body: payload.body,
      ...(this.proxyConfig ? { dispatcher: this.proxyConfig.agent as Dispatcher } : {}),
    };

    try {
      return await this.sendOnce(url, init);
    } catch (error) {
      if (this.proxyConfig?.fallbackToDirect) {
        logger.warn("Webhook 代理发送失败，尝试直连降级", {
          provider: this.providerType,
          targetUrl: new URL(url).origin,
        });

        return await this.sendOnce(url, {
          ...init,
          dispatcher: undefined,
        });
      }
      throw error;
    }
  }

  private async sendOnce(
    url: string,
    init: RequestInit & { dispatcher?: Dispatcher }
  ): Promise<WebhookResult> {
    const response = await fetch(url, init);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}${errorBody ? ` - ${errorBody}` : ""}`
      );
    }

    if (this.providerType === "custom") {
      // 自定义 webhook 不要求响应结构，但仍需消费 body 以便连接复用（undici fetch）。
      await response.arrayBuffer().catch(() => undefined);
      return { success: true };
    }

    const result = (await response.json()) as Record<string, unknown>;
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

      case "dingtalk":
        if (response.errcode === 0) {
          return { success: true };
        }
        throw new Error(`DingTalk API Error ${response.errcode}: ${response.errmsg}`);

      case "telegram":
        if (response.ok === true) {
          return { success: true };
        }
        throw new Error(`Telegram API Error: ${response.description ?? "unknown"}`);

      case "custom":
        return { success: true };
    }
  }
}

/**
 * 便捷函数：发送结构化消息到 webhook
 */
export async function sendWebhookMessage(
  target: string | WebhookTargetConfig,
  message: StructuredMessage,
  options?: WebhookSendOptions
): Promise<WebhookResult> {
  if (!target) {
    return { success: false, error: "Webhook URL is empty" };
  }

  const notifier = new WebhookNotifier(target);
  return notifier.send(message, options);
}
