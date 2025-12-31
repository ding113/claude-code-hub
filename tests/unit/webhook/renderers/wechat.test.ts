import { describe, expect, it } from "vitest";
import { WeChatRenderer } from "@/lib/webhook/renderers/wechat";
import type { StructuredMessage } from "@/lib/webhook/types";

describe("WeChatRenderer", () => {
  const renderer = new WeChatRenderer();

  it("should render basic message with header", () => {
    const message: StructuredMessage = {
      header: { title: "测试标题", icon: "🔔", level: "info" },
      sections: [],
      timestamp: new Date("2025-01-02T12:00:00Z"),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    expect(body.msgtype).toBe("markdown");
    expect(body.markdown.content).toContain("🔔 测试标题");
  });

  it("should render text section", () => {
    const message: StructuredMessage = {
      header: { title: "标题", level: "info" },
      sections: [{ content: [{ type: "text", value: "普通文本内容" }] }],
      timestamp: new Date(),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    expect(body.markdown.content).toContain("普通文本内容");
  });

  it("should render quote section", () => {
    const message: StructuredMessage = {
      header: { title: "标题", level: "warning" },
      sections: [{ content: [{ type: "quote", value: "引用内容" }] }],
      timestamp: new Date(),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    expect(body.markdown.content).toContain("> 引用内容");
  });

  it("should render fields section", () => {
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

    expect(body.markdown.content).toContain("**详细信息**");
    expect(body.markdown.content).toContain("名称: 测试");
    expect(body.markdown.content).toContain("状态: 正常");
  });

  it("should render list section with icons", () => {
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

    expect(body.markdown.content).toContain("🥇 **用户A**");
    expect(body.markdown.content).toContain("消费 $10");
  });

  it("should render divider", () => {
    const message: StructuredMessage = {
      header: { title: "标题", level: "info" },
      sections: [{ content: [{ type: "divider" }] }],
      timestamp: new Date(),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    expect(body.markdown.content).toContain("---");
  });

  it("should render footer sections", () => {
    const message: StructuredMessage = {
      header: { title: "标题", level: "info" },
      sections: [],
      footer: [{ content: [{ type: "text", value: "底部提示信息" }] }],
      timestamp: new Date(),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    expect(body.markdown.content).toContain("底部提示信息");
  });

  it("should include timestamp", () => {
    const message: StructuredMessage = {
      header: { title: "标题", level: "info" },
      sections: [],
      timestamp: new Date("2025-01-02T12:00:00Z"),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body);

    expect(body.markdown.content).toContain("2025");
  });
});
