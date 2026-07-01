import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string, values?: Record<string, string>) => {
    if (namespace === "dashboard.logs.table" && key === "reasoningEffort") {
      return `Effort: ${values?.effort ?? ""}`;
    }
    if (namespace === "dashboard.logs.table" && key === "reasoningEffortShort") {
      return `${values?.effort ?? ""}`;
    }
    if (namespace === "dashboard.logs.table" && key === "reasoningEffortApplied") {
      return `Applied: ${values?.effort ?? ""}`;
    }
    if (namespace === "dashboard.logs.table" && key === "reasoningEffortAppliedShort") {
      return `${values?.effort ?? ""}`;
    }
    return namespace ? `${namespace}.${key}` : key;
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children, variant }: { children?: ReactNode; variant?: string }) => (
    <div data-slot="tooltip-content" data-variant={variant}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/customs/model-vendor-icon", () => ({
  ModelVendorIcon: ({ modelId }: { modelId: string }) => <span data-slot="vendor">{modelId}</span>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className, onClick }: React.ComponentProps<"span">) => (
    <span className={className} onClick={onClick}>
      {children}
    </span>
  ),
}));

vi.mock("@/lib/utils/clipboard", () => ({
  copyTextToClipboard: vi.fn(async () => true),
}));

import { ModelDisplayWithRedirect } from "./model-display-with-redirect";

describe("ModelDisplayWithRedirect", () => {
  test("renders compact inline effort badge and expanded tooltip details", () => {
    const html = renderToStaticMarkup(
      <ModelDisplayWithRedirect
        originalModel="o3"
        currentModel="o3-mini"
        actualResponseModel="o3-mini-2026-01"
        billingModelSource="redirected"
        reasoningOutputTokens={321}
        specialSettings={[
          {
            type: "reasoning_effort",
            scope: "request",
            hit: true,
            path: "reasoning.effort",
            effort: "medium",
          },
          {
            type: "provider_parameter_override",
            scope: "provider",
            providerId: 1,
            providerName: "codex",
            providerType: "codex",
            hit: true,
            changed: true,
            changes: [{ path: "reasoning.effort", before: "medium", after: "high", changed: true }],
          },
        ]}
      />
    );

    expect(html).not.toContain("Effort: medium");
    expect(html).toContain(">medium<");
    expect(html).toContain("dashboard.logs.details.modelRedirect.billingModel");
    expect(html).toContain("dashboard.logs.details.modelAudit.responseModelLabel");
    expect(html).toContain("dashboard.logs.details.effort.tooltip");
    expect(html).toContain("dashboard.logs.details.effort.overridden");
    expect(html).toContain("dashboard.logs.details.billingDetails.reasoningTokens");
    expect(html).toContain("321");
    expect(html).toContain("o3-mini-2026-01");
    expect(html).toContain("high");
    expect(html).toContain('data-variant="popover"');
    expect(html).not.toContain("dashboard.logs.details.billingDetails.reasoningShort");
    expect(html).not.toContain("Applied: medium");
  });

  test("shows applied badge copy when effort only exists from provider override", () => {
    const html = renderToStaticMarkup(
      <ModelDisplayWithRedirect
        originalModel="gpt-5.4"
        currentModel="gpt-5.4"
        actualResponseModel="gpt-5.4"
        billingModelSource="original"
        specialSettings={[
          {
            type: "provider_parameter_override",
            scope: "provider",
            providerId: 1,
            providerName: "codex",
            providerType: "codex",
            hit: true,
            changed: true,
            changes: [{ path: "reasoning.effort", before: null, after: "high", changed: true }],
          },
        ]}
      />
    );

    expect(html).toContain("Applied: high");
    expect(html).toContain(">high<");
    expect(html).toContain("dashboard.logs.details.effort.appliedTooltip");
    expect(html).toContain("dashboard.logs.details.effort.injectedByProvider");
  });

  test("keeps the desktop effort badge adjacent to the billing model text", () => {
    const html = renderToStaticMarkup(
      <ModelDisplayWithRedirect
        originalModel="gpt-5.4"
        currentModel="gpt-5.4"
        actualResponseModel="gpt-5.4"
        billingModelSource="original"
        specialSettings={[
          {
            type: "anthropic_effort",
            scope: "request",
            hit: true,
            effort: "high",
          },
        ]}
      />
    );

    expect(html).toContain('data-slot="logs-billing-model-effort"');
    expect(html).toMatch(
      /data-slot="logs-billing-model-text"[^>]*class="[^"]*block min-w-0 truncate[^"]*"/
    );
    expect(html).not.toMatch(/data-slot="logs-billing-model-text"[^>]*class="[^"]*flex-1[^"]*"/);
  });

  test("stays single-line when there is no response-model mismatch", () => {
    const html = renderToStaticMarkup(
      <ModelDisplayWithRedirect
        originalModel="claude-sonnet"
        currentModel="claude-sonnet"
        actualResponseModel="claude-sonnet"
        billingModelSource="original"
        specialSettings={[
          {
            type: "anthropic_effort",
            scope: "request",
            hit: true,
            effort: "low",
          },
        ]}
      />
    );

    expect(html).toContain(">low<");
    expect(html).not.toContain("Effort: low");
    expect(html).not.toContain("dashboard.logs.details.modelAudit.responseModelLabel");
  });
});
