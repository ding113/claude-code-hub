import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { ThinkingEffortDisplay } from "./thinking-effort-display";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

describe("ThinkingEffortDisplay", () => {
  test("未记录思考强度时显示占位符", () => {
    const html = renderToStaticMarkup(<ThinkingEffortDisplay specialSettings={null} />);

    expect(html).toContain(">-</span>");
    expect(html).not.toContain('data-slot="thinking-effort"');
  });

  test("显示 Codex 请求中的思考强度", () => {
    const html = renderToStaticMarkup(
      <ThinkingEffortDisplay
        specialSettings={[
          {
            type: "codex_reasoning_effort",
            scope: "request",
            hit: true,
            effort: "high",
          },
        ]}
      />
    );

    expect(html).toContain('data-slot="thinking-effort"');
    expect(html).toContain("high");
    expect(html).toContain("reasoningEffort.tooltip");
    expect(html).not.toContain("overridden");
  });

  test("供应商覆写 Codex 强度时显示请求值和实际值", () => {
    const html = renderToStaticMarkup(
      <ThinkingEffortDisplay
        specialSettings={[
          {
            type: "codex_reasoning_effort",
            scope: "request",
            hit: true,
            effort: "low",
          },
          {
            type: "provider_parameter_override",
            scope: "provider",
            providerId: 1,
            providerName: "Codex",
            providerType: "codex",
            hit: true,
            changed: true,
            changes: [{ path: "reasoning.effort", before: "low", after: "max", changed: true }],
          },
        ]}
      />
    );

    expect(html).toContain("low");
    expect(html).toContain("max");
    expect(html).toContain("reasoningEffort.overridden");
    expect(html).toContain("lucide-arrow-right");
  });

  test("显示 Anthropic 请求中的思考强度", () => {
    const html = renderToStaticMarkup(
      <ThinkingEffortDisplay
        specialSettings={[
          {
            type: "anthropic_effort",
            scope: "request",
            hit: true,
            effort: "medium",
          },
        ]}
      />
    );

    expect(html).toContain('data-slot="thinking-effort"');
    expect(html).toContain("medium");
    expect(html).toContain("effort.tooltip");
    expect(html).not.toContain("overridden");
  });

  test("供应商覆写 Anthropic 强度时显示请求值和实际值", () => {
    const html = renderToStaticMarkup(
      <ThinkingEffortDisplay
        specialSettings={[
          {
            type: "anthropic_effort",
            scope: "request",
            hit: true,
            effort: "medium",
          },
          {
            type: "provider_parameter_override",
            scope: "provider",
            providerId: 2,
            providerName: "Anthropic",
            providerType: "claude",
            hit: true,
            changed: true,
            changes: [
              { path: "output_config.effort", before: "medium", after: "high", changed: true },
            ],
          },
        ]}
      />
    );

    expect(html).toContain("medium");
    expect(html).toContain("high");
    expect(html).toContain("effort.overridden");
    expect(html).toContain("lucide-arrow-right");
  });

  test("供应商剥离 Anthropic 强度时仅显示请求值与覆写说明", () => {
    const html = renderToStaticMarkup(
      <ThinkingEffortDisplay
        specialSettings={[
          {
            type: "anthropic_effort",
            scope: "request",
            hit: true,
            effort: "medium",
          },
          {
            type: "provider_parameter_override",
            scope: "provider",
            providerId: 2,
            providerName: "Anthropic",
            providerType: "claude",
            hit: true,
            changed: true,
            changes: [
              { path: "output_config.effort", before: "medium", after: null, changed: true },
            ],
          },
        ]}
      />
    );

    expect(html).toContain("medium");
    expect(html).toContain("effort.overridden");
    expect(html).not.toContain("lucide-arrow-right");
  });

  test("同时存在两种审计时优先展示 Codex 强度", () => {
    const html = renderToStaticMarkup(
      <ThinkingEffortDisplay
        specialSettings={[
          {
            type: "anthropic_effort",
            scope: "request",
            hit: true,
            effort: "medium",
          },
          {
            type: "codex_reasoning_effort",
            scope: "request",
            hit: true,
            effort: "xhigh",
          },
        ]}
      />
    );

    expect(html).toContain("xhigh");
    expect(html).toContain("reasoningEffort.tooltip");
    expect(html).not.toContain(">medium<");
  });
});
