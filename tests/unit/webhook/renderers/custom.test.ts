import { describe, expect, it } from "vitest";
import { CustomRenderer } from "@/lib/webhook/renderers/custom";
import type { StructuredMessage } from "@/lib/webhook/types";

describe("CustomRenderer", () => {
  const message: StructuredMessage = {
    header: { title: "测试标题", level: "info" },
    sections: [{ content: [{ type: "text", value: "正文内容" }] }],
    timestamp: new Date("2025-01-02T12:00:00Z"),
  };

  it("should interpolate placeholders and include custom headers", () => {
    const renderer = new CustomRenderer(
      {
        text: "title={{title}} provider={{provider_name}}",
        meta: {
          level: "{{level}}",
          when: "{{timestamp}}",
        },
      },
      { "X-Test": "1" }
    );

    const result = renderer.render(message, {
      notificationType: "circuit_breaker",
      data: { providerName: "OpenAI" },
    });

    const body = JSON.parse(result.body) as any;
    expect(result.headers).toEqual({ "X-Test": "1" });
    expect(body.text).toContain("title=测试标题");
    expect(body.text).toContain("provider=OpenAI");
    expect(body.meta.level).toBe("info");
    expect(body.meta.when).toContain("2025-01-02T12:00:00.000Z");
  });

  it("should use templateOverride when provided", () => {
    const renderer = new CustomRenderer({ foo: "{{title}}" }, null);

    const result = renderer.render(message, {
      templateOverride: { bar: "override={{title}}" },
    });

    const body = JSON.parse(result.body) as any;
    expect(body.foo).toBeUndefined();
    expect(body.bar).toBe("override=测试标题");
  });

  it("should throw when templateOverride is invalid", () => {
    const renderer = new CustomRenderer({ foo: "bar" }, null);
    expect(() =>
      renderer.render(message, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        templateOverride: [] as any,
      })
    ).toThrow("自定义 Webhook 模板必须是 JSON 对象");
  });
});
