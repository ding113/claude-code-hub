import { buildTemplateVariables } from "../templates/placeholders";
import type { StructuredMessage, WebhookPayload, WebhookSendOptions } from "../types";
import type { Renderer } from "./index";

export class CustomRenderer implements Renderer {
  constructor(
    private readonly template: Record<string, unknown>,
    private readonly headers: Record<string, string> | null
  ) {}

  render(message: StructuredMessage, options?: WebhookSendOptions): WebhookPayload {
    const template = options?.templateOverride ?? this.template;
    if (!template || typeof template !== "object" || Array.isArray(template)) {
      throw new Error("自定义 Webhook 模板必须是 JSON 对象");
    }

    const variables = buildTemplateVariables({
      message,
      notificationType: options?.notificationType,
      data: options?.data,
    });

    const bodyObject = this.interpolate(template, variables);

    return {
      body: JSON.stringify(bodyObject),
      ...(this.headers ? { headers: this.headers } : {}),
    };
  }

  private interpolate(value: unknown, variables: Record<string, string>): unknown {
    if (typeof value === "string") {
      return this.interpolateString(value, variables);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.interpolate(item, variables));
    }

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(record)) {
        result[key] = this.interpolate(item, variables);
      }
      return result;
    }

    return value;
  }

  private interpolateString(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replaceAll(key, value);
    }
    return result;
  }
}
