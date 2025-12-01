import { logger } from "@/lib/logger";

/**
 * 企业微信机器人消息类型
 */
export interface WeChatMarkdownMessage {
  msgtype: "markdown";
  markdown: {
    content: string;
  };
}

/**
 * 企业微信机器人发送结果
 */
export interface WeChatBotResponse {
  errcode: number;
  errmsg: string;
}

/**
 * 企业微信机器人 SDK
 * 文档: https://developer.work.weixin.qq.com/document/path/91770
 */
export class WeChatBot {
  private webhookUrl: string;
  private maxRetries: number;

  constructor(webhookUrl: string, maxRetries = 3) {
    this.webhookUrl = webhookUrl;
    this.maxRetries = maxRetries;
  }

  /**
   * 发送 Markdown 格式消息
   * @param content Markdown 格式的消息内容
   * @returns 发送结果
   */
  async sendMarkdown(content: string): Promise<{ success: boolean; error?: string }> {
    const message: WeChatMarkdownMessage = {
      msgtype: "markdown",
      markdown: {
        content,
      },
    };

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info({
          action: "wechat_bot_send",
          attempt,
          contentLength: content.length,
        });

        const response = await fetch(this.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result: WeChatBotResponse = await response.json();

        if (result.errcode === 0) {
          logger.info({
            action: "wechat_bot_success",
            attempt,
          });
          return { success: true };
        } else {
          throw new Error(`WeChat API Error ${result.errcode}: ${result.errmsg}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error({
          action: "wechat_bot_error",
          attempt,
          error: errorMessage,
          willRetry: attempt < this.maxRetries,
        });

        // 最后一次尝试失败
        if (attempt === this.maxRetries) {
          return { success: false, error: errorMessage };
        }

        // 重试延迟: 1秒 -> 2秒 -> 4秒
        const delay = 2 ** (attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return { success: false, error: "Max retries exceeded" };
  }

  /**
   * 测试 Webhook 连通性
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    return this.sendMarkdown("**测试消息**\n\n企业微信机器人连接成功！");
  }
}

/**
 * 发送企业微信通知（工厂函数）
 * @param webhookUrl Webhook 地址
 * @param content Markdown 格式内容
 * @returns 发送结果
 */
export async function sendWeChatNotification(
  webhookUrl: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  if (!webhookUrl) {
    return { success: false, error: "Webhook URL is empty" };
  }

  const bot = new WeChatBot(webhookUrl);
  return bot.sendMarkdown(content);
}
