import type {
  ListItem,
  Section,
  SectionContent,
  StructuredMessage,
  WebhookPayload,
} from "../types";
import type { Renderer } from "./index";

export class DingTalkRenderer implements Renderer {
  render(message: StructuredMessage): WebhookPayload {
    const markdown = {
      msgtype: "markdown",
      markdown: {
        title: this.escapeText(message.header.title),
        text: this.buildMarkdown(message),
      },
    };

    return { body: JSON.stringify(markdown) };
  }

  private buildMarkdown(message: StructuredMessage): string {
    const lines: string[] = [];

    lines.push(`### ${this.escapeText(message.header.title)}`);
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

    lines.push(this.formatTimestamp(message.timestamp));
    return lines.join("\n").trim();
  }

  private renderSection(section: Section): string[] {
    const lines: string[] = [];

    if (section.title) {
      lines.push(`**${this.escapeText(section.title)}**`);
    }

    for (const content of section.content) {
      lines.push(...this.renderContent(content));
    }

    return lines;
  }

  private renderContent(content: SectionContent): string[] {
    switch (content.type) {
      case "text":
        return [this.escapeText(content.value)];

      case "quote":
        return [`> ${this.escapeText(content.value)}`];

      case "fields":
        return content.items.map(
          (item) => `- ${this.escapeText(item.label)}: ${this.escapeText(item.value)}`
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
      lines.push(`${prefix} **${this.escapeText(item.primary)}**`);
      if (item.secondary) {
        lines.push(`  ${this.escapeText(item.secondary)}`);
      }
    });

    return lines;
  }

  private escapeText(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  private formatTimestamp(date: Date): string {
    return date.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
}
