import { describe, expect, it } from "vitest";
import { TelegramRenderer } from "@/lib/webhook/renderers/telegram";
import type { StructuredMessage } from "@/lib/webhook/types";

describe("TelegramRenderer", () => {
  it("should render HTML payload with chat_id and parse_mode", () => {
    const renderer = new TelegramRenderer("123");

    const message: StructuredMessage = {
      header: { title: '测试 <标题>&"', level: "info" },
      sections: [
        { content: [{ type: "text", value: 'Hello & <world> "' }] },
        { content: [{ type: "quote", value: "引用 <tag>" }] },
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
              style: "bullet",
              items: [{ primary: "用户A", secondary: '消费 <10>& "' }],
            },
          ],
        },
      ],
      timestamp: new Date("2025-01-02T12:00:00Z"),
    };

    const result = renderer.render(message);
    const body = JSON.parse(result.body) as any;

    expect(body.chat_id).toBe("123");
    expect(body.parse_mode).toBe("HTML");
    expect(body.disable_web_page_preview).toBe(true);
    expect(body.text).toContain("<b>测试 &lt;标题&gt;&amp;&quot;</b>");
    expect(body.text).toContain("Hello &amp; &lt;world&gt; &quot;");
    expect(body.text).toContain("&gt; 引用 &lt;tag&gt;");
    expect(body.text).toContain("<b>字段</b>");
    expect(body.text).toContain("<b>状态</b>: &lt;OK&gt;&amp;");
    expect(body.text).toContain("- <b>用户A</b>");
    expect(body.text).toContain("消费 &lt;10&gt;&amp; &quot;");
    expect(body.text).toContain("2025");
  });
});
