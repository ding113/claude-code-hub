import type {
  ListItem,
  Section,
  SectionContent,
  StructuredMessage,
  WebhookPayload,
} from "../types";
import { formatTimestamp } from "../utils/date";
import type { Renderer } from "./index";

export class TelegramRenderer implements Renderer {
  constructor(private readonly chatId: string) {}

  render(message: StructuredMessage): WebhookPayload {
    const html = this.buildHtml(message);
    return {
      body: JSON.stringify({
        chat_id: this.chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    };
  }

  private buildHtml(message: StructuredMessage): string {
    const lines: string[] = [];

    lines.push(`<b>${this.escapeHtml(message.header.title)}</b>`);
    lines.push("");

    for (const section of message.sections) {
      lines.push(...this.renderSection(section));
      lines.push("");
    }

    if (message.footer) {
      lines.push("---");
      for (const section of message.footer) {
        lines.push(...this.renderSection(section));
      }
      lines.push("");
    }

    lines.push(this.escapeHtml(formatTimestamp(message.timestamp)));
    return lines.join("\n").trim();
  }

  private renderSection(section: Section): string[] {
    const lines: string[] = [];

    if (section.title) {
      lines.push(`<b>${this.escapeHtml(section.title)}</b>`);
    }

    for (const content of section.content) {
      lines.push(...this.renderContent(content));
    }

    return lines;
  }

  private renderContent(content: SectionContent): string[] {
    switch (content.type) {
      case "text":
        return [this.escapeHtml(content.value)];

      case "quote":
        return [`&gt; ${this.escapeHtml(content.value)}`];

      case "fields":
        return content.items.map(
          (item) => `<b>${this.escapeHtml(item.label)}</b>: ${this.escapeHtml(item.value)}`
        );

      case "list":
        return this.renderList(content.items, content.style);

      case "divider":
        return ["---"];
    }
  }

  private renderList(items: ListItem[], style: "ordered" | "bullet"): string[] {
    const lines: string[] = [];

    items.forEach((item, index) => {
      const prefix = style === "ordered" ? `${index + 1}.` : "-";
      lines.push(`${prefix} <b>${this.escapeHtml(item.primary)}</b>`);
      if (item.secondary) {
        lines.push(`  ${this.escapeHtml(item.secondary)}`);
      }
    });

    return lines;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
}
