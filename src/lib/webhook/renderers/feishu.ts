import type {
  ListItem,
  MessageLevel,
  Section,
  SectionContent,
  StructuredMessage,
  WebhookPayload,
} from "../types";
import { formatDateTime } from "../utils/date";
import type { Renderer } from "./index";

interface CardElement {
  tag: string;
  [key: string]: unknown;
}

export class FeishuCardRenderer implements Renderer {
  render(message: StructuredMessage): WebhookPayload {
    const elements: CardElement[] = [];

    // Sections
    for (const section of message.sections) {
      elements.push(...this.renderSection(section));
    }

    // Footer
    if (message.footer) {
      elements.push({ tag: "hr" });
      for (const section of message.footer) {
        elements.push(...this.renderSection(section));
      }
    }

    // Timestamp
    elements.push({
      tag: "markdown",
      content: formatDateTime(message.timestamp),
      text_size: "notation",
    });

    const card = {
      msg_type: "interactive",
      card: {
        schema: "2.0",
        header: this.renderHeader(message),
        body: {
          elements,
        },
      },
    };

    return { body: JSON.stringify(card) };
  }

  private renderHeader(message: StructuredMessage): object {
    const { title, icon, level } = message.header;
    const displayTitle = icon ? `${icon} ${title}` : title;

    return {
      title: { tag: "plain_text", content: displayTitle },
      template: this.levelToTemplate(level),
    };
  }

  private levelToTemplate(level: MessageLevel): string {
    switch (level) {
      case "error":
        return "red";
      case "warning":
        return "orange";
      default:
        return "blue";
    }
  }

  private renderSection(section: Section): CardElement[] {
    const elements: CardElement[] = [];

    if (section.title) {
      elements.push({
        tag: "markdown",
        content: `**${section.title}**`,
      });
    }

    for (const content of section.content) {
      elements.push(...this.renderContent(content));
    }

    return elements;
  }

  private renderContent(content: SectionContent): CardElement[] {
    switch (content.type) {
      case "text":
        return [{ tag: "markdown", content: content.value }];

      case "quote":
        return [{ tag: "markdown", content: `> ${content.value}` }];

      case "fields":
        return this.renderFields(content.items);

      case "list":
        return this.renderList(content.items);

      case "divider":
        return [{ tag: "hr" }];
    }
  }

  private renderFields(items: { label: string; value: string }[]): CardElement[] {
    const columns = items.map((item) => ({
      tag: "column",
      width: "weighted",
      weight: 1,
      elements: [
        {
          tag: "markdown",
          content: `**${item.label}**\n${item.value}`,
        },
      ],
    }));

    const rows: CardElement[] = [];
    for (let i = 0; i < columns.length; i += 2) {
      rows.push({
        tag: "column_set",
        flex_mode: "bisect",
        columns: columns.slice(i, i + 2),
      });
    }

    return rows;
  }

  private renderList(items: ListItem[]): CardElement[] {
    const lines: string[] = [];

    for (const item of items) {
      const icon = item.icon ? `${item.icon} ` : "";
      let line = `${icon}**${item.primary}**`;
      if (item.secondary) {
        line += `\n${item.secondary}`;
      }
      lines.push(line);
    }

    return [{ tag: "markdown", content: lines.join("\n\n") }];
  }
}
