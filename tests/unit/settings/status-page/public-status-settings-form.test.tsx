/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicStatusSettingsForm } from "@/app/[locale]/settings/status-page/_components/public-status-settings-form";
import { toast } from "sonner";

const mockRefresh = vi.hoisted(() => vi.fn());
const mockSavePublicStatusSettings = vi.hoisted(() => vi.fn());
const modelMultiSelectPropsSpy = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/actions/public-status", () => ({
  savePublicStatusSettings: mockSavePublicStatusSettings,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ children, ...props }: { children?: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock("@/app/[locale]/settings/providers/_components/model-multi-select", () => ({
  ModelMultiSelect: ({
    catalogScope,
    providerType,
    selectedModels,
    onChange,
  }: {
    catalogScope?: string;
    providerType?: string;
    selectedModels: string[];
    onChange: (models: string[]) => void;
  }) => {
    modelMultiSelectPropsSpy({ catalogScope, providerType, selectedModels });

    return (
      <button
        type="button"
        data-testid="public-status-model-picker"
        onClick={() => onChange([...selectedModels, "gpt-4.1"])}
      >
        picker
      </button>
    );
  },
}));

vi.mock("@/components/section", () => ({
  Section: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    type = "button",
    asChild,
    ...props
  }: {
    children?: ReactNode;
    onClick?: () => void;
    type?: "button" | "submit";
    asChild?: boolean;
  }) =>
    asChild ? (
      children
    ) : (
      <button type={type} onClick={onClick} {...props}>
        {children}
      </button>
    ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean;
    onCheckedChange?: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children?: ReactNode }) => <label>{children}</label>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
  }) => (
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("public-status settings form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSavePublicStatusSettings.mockResolvedValue({
      ok: true,
      data: {
        publicStatusProjectionWarningCode: null,
      },
    });
  });

  it("renders the reusable model picker and a preview link when there are publishable groups", async () => {
    const { container, unmount } = render(
      <PublicStatusSettingsForm
        initialWindowHours={24}
        initialAggregationIntervalMinutes={5}
        initialGroups={
          [
            {
              groupName: "openai",
              enabled: true,
              displayName: "OpenAI",
              publicGroupSlug: "openai",
              explanatoryCopy: "Primary public models",
              sortOrder: 0,
              publicModels: [{ modelKey: "gpt-4.1", providerTypeOverride: "codex" }],
            },
          ] as never
        }
      />
    );

    expect(container.querySelector('[data-testid="public-status-model-picker"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="public-status-preview-link"]')).not.toBeNull();
    expect(modelMultiSelectPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogScope: "all",
        providerType: "openai-compatible",
      })
    );

    unmount();
  });

  it("submits structured publicModels instead of legacy publicModelKeys textareas", async () => {
    const { container, unmount } = render(
      <PublicStatusSettingsForm
        initialWindowHours={24}
        initialAggregationIntervalMinutes={5}
        initialGroups={
          [
            {
              groupName: "openai",
              enabled: true,
              displayName: "OpenAI",
              publicGroupSlug: "openai",
              explanatoryCopy: "Primary public models",
              sortOrder: 0,
              publicModels: [{ modelKey: "gpt-4.1", providerTypeOverride: "codex" }],
            },
          ] as never
        }
      />
    );

    const submitButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("statusPage.form.save")
    );
    expect(submitButton).toBeTruthy();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockSavePublicStatusSettings).toHaveBeenCalledWith({
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
      groups: [
        {
          groupName: "openai",
          displayName: "OpenAI",
          publicGroupSlug: "openai",
          explanatoryCopy: "Primary public models",
          sortOrder: 0,
          publicModels: [{ modelKey: "gpt-4.1", providerTypeOverride: "codex" }],
        },
      ],
    });

    unmount();
  });

  it("updates selected models and provider override before submit", async () => {
    const { container, unmount } = render(
      <PublicStatusSettingsForm
        initialWindowHours={24}
        initialAggregationIntervalMinutes={5}
        initialGroups={
          [
            {
              groupName: "openai",
              enabled: true,
              displayName: "OpenAI",
              publicGroupSlug: "openai",
              explanatoryCopy: "Primary public models",
              sortOrder: 0,
              publicModels: [{ modelKey: "claude-3.7-sonnet", providerTypeOverride: "claude" }],
            },
          ] as never
        }
      />
    );

    const picker = container.querySelector('[data-testid="public-status-model-picker"]');
    expect(picker).toBeTruthy();

    await act(async () => {
      picker?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const selects = Array.from(container.querySelectorAll("select"));
    const providerOverrideSelect = selects[1];
    expect(providerOverrideSelect).toBeTruthy();

    if (providerOverrideSelect instanceof HTMLSelectElement) {
      providerOverrideSelect.value = "codex";
      await act(async () => {
        providerOverrideSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    const submitButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("statusPage.form.save")
    );

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockSavePublicStatusSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        groups: [
          expect.objectContaining({
            publicModels: [
              { modelKey: "claude-3.7-sonnet", providerTypeOverride: "codex" },
              { modelKey: "gpt-4.1" },
            ],
          }),
        ],
      })
    );

    unmount();
  });

  it("default group keeps groupName while submitting a custom public slug", async () => {
    const { container, unmount } = render(
      <PublicStatusSettingsForm
        initialWindowHours={24}
        initialAggregationIntervalMinutes={5}
        initialGroups={
          [
            {
              groupName: "default",
              enabled: true,
              displayName: "Platform",
              publicGroupSlug: "platform",
              explanatoryCopy: "Default route",
              sortOrder: 2,
              publicModels: [{ modelKey: "gpt-4.1", providerTypeOverride: "openai-compatible" }],
            },
          ] as never
        }
      />
    );

    const submitButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("statusPage.form.save")
    );
    expect(submitButton).toBeTruthy();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockSavePublicStatusSettings).toHaveBeenLastCalledWith({
      publicStatusWindowHours: 24,
      publicStatusAggregationIntervalMinutes: 5,
      groups: [
        {
          groupName: "default",
          displayName: "Platform",
          publicGroupSlug: "platform",
          explanatoryCopy: "Default route",
          sortOrder: 2,
          publicModels: [{ modelKey: "gpt-4.1", providerTypeOverride: "openai-compatible" }],
        },
      ],
    });

    unmount();
  });

  it("blocks submit and highlights slug inputs when enabled groups share the same slug", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 0;
      });

    const { container, unmount } = render(
      <PublicStatusSettingsForm
        initialWindowHours={24}
        initialAggregationIntervalMinutes={5}
        initialGroups={
          [
            {
              groupName: "openai-primary",
              enabled: true,
              displayName: "OpenAI Primary",
              publicGroupSlug: "Open AI",
              explanatoryCopy: "Primary public models",
              sortOrder: 0,
              publicModels: [{ modelKey: "gpt-4.1" }],
            },
            {
              groupName: "openai-fallback",
              enabled: true,
              displayName: "OpenAI Fallback",
              publicGroupSlug: "open-ai",
              explanatoryCopy: "Fallback public models",
              sortOrder: 1,
              publicModels: [{ modelKey: "gpt-4.1" }],
            },
          ] as never
        }
      />
    );

    const submitButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("statusPage.form.save")
    );
    expect(submitButton).toBeTruthy();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockSavePublicStatusSettings).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("statusPage.form.duplicateSlug");
    const invalidSlugInputs = container.querySelectorAll('[aria-invalid="true"]');
    expect(invalidSlugInputs).toHaveLength(2);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(document.activeElement).toBe(invalidSlugInputs[0]);

    unmount();
    requestAnimationFrame.mockRestore();
  });

  it("expands collapsed conflicting groups before focusing the first duplicate slug input", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    let frameCallback: FrameRequestCallback | undefined;
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frameCallback = callback;
        return 1;
      });

    const { container, unmount } = render(
      <PublicStatusSettingsForm
        initialWindowHours={24}
        initialAggregationIntervalMinutes={5}
        initialGroups={
          [
            {
              groupName: "openai-primary",
              enabled: true,
              displayName: "OpenAI Primary",
              publicGroupSlug: "Open AI",
              explanatoryCopy: "Primary public models",
              sortOrder: 0,
              publicModels: [{ modelKey: "gpt-4.1" }],
            },
            {
              groupName: "openai-fallback",
              enabled: true,
              displayName: "OpenAI Fallback",
              publicGroupSlug: "open-ai",
              explanatoryCopy: "Fallback public models",
              sortOrder: 1,
              publicModels: [{ modelKey: "gpt-4.1" }],
            },
          ] as never
        }
      />
    );

    const getInputByValue = (value: string) =>
      Array.from(container.querySelectorAll("input")).find((input) => input.value === value);
    const getGroupToggleButton = (groupName: string) =>
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes(groupName)
      );

    await act(async () => {
      getGroupToggleButton("openai-primary")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      getGroupToggleButton("openai-fallback")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });

    expect(getInputByValue("Open AI")).toBeUndefined();
    expect(getInputByValue("open-ai")).toBeUndefined();

    const submitButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("statusPage.form.save")
    );
    expect(submitButton).toBeTruthy();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockSavePublicStatusSettings).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("statusPage.form.duplicateSlug");

    const invalidSlugInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('[aria-invalid="true"]')
    );
    expect(invalidSlugInputs).toHaveLength(2);
    expect(invalidSlugInputs.map((input) => input.value)).toEqual(["Open AI", "open-ai"]);

    await act(async () => {
      frameCallback?.(0);
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(document.activeElement).toBe(invalidSlugInputs[0]);

    unmount();
    requestAnimationFrame.mockRestore();
  });
});
