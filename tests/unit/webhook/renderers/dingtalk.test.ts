import { describe, expect, it } from "vitest";
import { DingTalkRenderer } from "@/lib/webhook/renderers/dingtalk";
import type { StructuredMessage } from "@/lib/webhook/types";

describe("DingTalkRenderer", () => {
  const renderer = new DingTalkRenderer();

  it("should render markdown payload with escaped content", () => {
    const message: StructuredMessage = {
      header: { title: "测试 <标题>&", level: "info" },
      sections: [
        {
          title: "概览",
          content: [{ type: "text", value: "Hello & <world>" }],
        },
        {
          content: [{ type: "quote", value: "引用 <tag>" }],
        },
        {
          title: "字段",
          content: [
            {
              type: "fields",
              items: [{ label: "状态", value: "<OK>&" }],
            },
          ],
        },
        {
          content: [
            {
              type: "list",
              style: "ordered",
              items: [{ primary: "用户A", secondary: "消费 <10>&" }],
            },
          ],
        },
      ],
      footer: [{ content: [{ type: "text", value: "footer" }] }],
      timestamp: new Date("2025-01-02T12:00:00Z"),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body) as any;

    expect(body.msgtype).toBe("markdown");
    expect(body.markdown.title).toBe("测试 &lt;标题&gt;&amp;");
    expect(body.markdown.text).toContain("### 测试 &lt;标题&gt;&amp;");
    expect(body.markdown.text).toContain("**概览**");
    expect(body.markdown.text).toContain("Hello &amp; &lt;world&gt;");
    expect(body.markdown.text).toContain("> 引用 &lt;tag&gt;");
    expect(body.markdown.text).toContain("- 状态: &lt;OK&gt;&amp;");
    expect(body.markdown.text).toContain("1. **用户A**");
    expect(body.markdown.text).toContain("消费 &lt;10&gt;&amp;");
    expect(body.markdown.text).toContain("footer");
    expect(body.markdown.text).toContain("2025");
  });
});
