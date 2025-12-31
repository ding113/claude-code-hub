import { describe, expect, it } from "vitest";
import { FeishuCardRenderer } from "@/lib/webhook/renderers/feishu";
import type { StructuredMessage } from "@/lib/webhook/types";

describe("FeishuCardRenderer", () => {
  const renderer = new FeishuCardRenderer();

  it("should render interactive card with correct structure", () => {
    const message: StructuredMessage = {
      header: { title: "测试标题", icon: "🔔", level: "info" },
      sections: [],
      timestamp: new Date("2025-01-02T12:00:00Z"),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    expect(body.msg_type).toBe("interactive");
    expect(body.card.schema).toBe("2.0");
    expect(body.card.header.title.content).toContain("🔔 测试标题");
    expect(body.card.header.template).toBe("blue");
  });

  it("should map level to correct template color", () => {
    const levels = [
      { level: "info" as const, template: "blue" },
      { level: "warning" as const, template: "orange" },
      { level: "error" as const, template: "red" },
    ];

    for (const { level, template } of levels) {
      const message: StructuredMessage = {
        header: { title: "标题", level },
        sections: [],
        timestamp: new Date(),
      };

      const result = renderer.render(message);
      const body = JSON.parse(result.body);

      expect(body.card.header.template).toBe(template);
    }
  });

  it("should render text section as markdown element", () => {
    const message: StructuredMessage = {
      header: { title: "标题", level: "info" },
      sections: [{ content: [{ type: "text", value: "普通文本内容" }] }],
      timestamp: new Date(),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    const elements = body.card.body.elements;
    expect(
      elements.some((e: any) => e.tag === "markdown" && e.content.includes("普通文本内容"))
    ).toBe(true);
  });

  it("should render quote as markdown with quote syntax", () => {
    const message: StructuredMessage = {
      header: { title: "标题", level: "warning" },
      sections: [{ content: [{ type: "quote", value: "引用内容" }] }],
      timestamp: new Date(),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    const elements = body.card.body.elements;
    expect(
      elements.some((e: any) => e.tag === "markdown" && e.content.includes("> 引用内容"))
    ).toBe(true);
  });

  it("should render fields as column set", () => {
    const message: StructuredMessage = {
      header: { title: "标题", level: "error" },
      sections: [
        {
          title: "详细信息",
          content: [
            {
              type: "fields",
              items: [
                { label: "名称", value: "测试" },
                { label: "状态", value: "正常" },
              ],
            },
          ],
        },
      ],
      timestamp: new Date(),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    const bodyStr = JSON.stringify(body.card.body);
    expect(bodyStr).toContain("名称");
    expect(bodyStr).toContain("测试");
  });

  it("should render list items", () => {
    const message: StructuredMessage = {
      header: { title: "排行榜", level: "info" },
      sections: [
        {
          content: [
            {
              type: "list",
              style: "ordered",
              items: [
                { icon: "🥇", primary: "用户A", secondary: "消费 $10" },
                { icon: "🥈", primary: "用户B", secondary: "消费 $5" },
              ],
            },
          ],
        },
      ],
      timestamp: new Date(),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    const bodyStr = JSON.stringify(body.card.body);
    expect(bodyStr).toContain("🥇");
    expect(bodyStr).toContain("用户A");
  });

  it("should render divider element", () => {
    const message: StructuredMessage = {
      header: { title: "标题", level: "info" },
      sections: [{ content: [{ type: "divider" }] }],
      timestamp: new Date(),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    const elements = body.card.body.elements;
    expect(elements.some((e: any) => e.tag === "hr")).toBe(true);
  });

  it("should include timestamp in footer", () => {
    const message: StructuredMessage = {
      header: { title: "标题", level: "info" },
      sections: [],
      timestamp: new Date("2025-01-02T12:00:00Z"),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    const bodyStr = JSON.stringify(body.card.body);
    expect(bodyStr).toContain("2025");
  });
});
