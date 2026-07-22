import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { CodexReasoningEffortDisplay } from "./codex-reasoning-effort-display";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

describe("CodexReasoningEffortDisplay", () => {
  test("未记录 Codex 思考强度时显示占位符", () => {
    const html = renderToStaticMarkup(<CodexReasoningEffortDisplay specialSettings={null} />);

    expect(html).toContain(">-</span>");
    expect(html).not.toContain('data-slot="codex-reasoning-effort"');
  });

  test("显示 Codex 请求中的思考强度", () => {
    const html = renderToStaticMarkup(
      <CodexReasoningEffortDisplay
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

    expect(html).toContain('data-slot="codex-reasoning-effort"');
    expect(html).toContain("high");
    expect(html).toContain("tooltip");
    expect(html).not.toContain("overridden");
  });

  test("供应商覆写时显示请求值和实际值", () => {
    const html = renderToStaticMarkup(
      <CodexReasoningEffortDisplay
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
    expect(html).toContain("overridden");
    expect(html).toContain("lucide-arrow-right");
  });
});
