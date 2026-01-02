import type {
  ListItem,
  Section,
  SectionContent,
  StructuredMessage,
  WebhookPayload,
} from "../types";
import { formatTimestamp } from "../utils/date";
import type { Renderer } from "./index";

export class WeChatRenderer implements Renderer {
  render(message: StructuredMessage): WebhookPayload {
    const lines: string[] = [];

    // Header
    lines.push(this.renderHeader(message));
    lines.push("");

    // Sections
    for (const section of message.sections) {
      lines.push(...this.renderSection(section));
      lines.push("");
    }

    // Footer
    if (message.footer) {
      lines.push("---");
      for (const section of message.footer) {
        lines.push(...this.renderSection(section));
      }
      lines.push("");
    }

    // Timestamp
    lines.push(formatTimestamp(message.timestamp));

    const content = lines.join("\n");

    return {
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: { content },
      }),
    };
  }

  private renderHeader(message: StructuredMessage): string {
    const { title, icon, level } = message.header;
    const levelIcon = this.getLevelIcon(level);
    const displayIcon = icon || levelIcon;
    return `## ${displayIcon} ${title}`;
  }

  private getLevelIcon(level: string): string {
    switch (level) {
      case "error":
        return "🚨";
      case "warning":
        return "⚠️";
      case "info":
        return "📊";
      default:
        return "📊";
    }
  }

  private renderSection(section: Section): string[] {
    const lines: string[] = [];

    if (section.title) {
      lines.push(`**${section.title}**`);
    }

    for (const content of section.content) {
      lines.push(...this.renderContent(content));
    }

    return lines;
  }

  private renderContent(content: SectionContent): string[] {
    switch (content.type) {
      case "text":
        return [content.value];

      case "quote":
        return [`> ${content.value}`];

      case "fields":
        return content.items.map((item) => `${item.label}: ${item.value}`);

      case "list":
        return this.renderList(content.items);

      case "divider":
        return ["---"];
    }
  }

  private renderList(items: ListItem[]): string[] {
    const lines: string[] = [];
    for (const item of items) {
      const icon = item.icon ? `${item.icon} ` : "";
      let line = `${icon}**${item.primary}**`;
      if (item.secondary) {
        line += `\n${item.secondary}`;
      }
      lines.push(line);
      lines.push("");
    }
    return lines;
  }
}
