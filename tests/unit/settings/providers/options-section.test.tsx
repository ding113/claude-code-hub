/** @vitest-environment happy-dom */

const mockDispatch = vi.fn();
const mockUseProviderForm = vi.fn();

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("framer-motion", () => ({
  motion: { div: ({ children, ...rest }: any) => <div {...rest}>{children}</div> },
}));
vi.mock("lucide-react", () => {
  const stub = ({ className }: any) => <span data-testid="icon" className={className} />;
  return { Clock: stub, Info: stub, Settings: stub, Timer: stub };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/provider-form-context",
  () => ({
    useProviderForm: (...args: any[]) => mockUseProviderForm(...args),
  })
);
vi.mock("@/app/[locale]/settings/providers/_components/adaptive-thinking-editor", () => ({
  AdaptiveThinkingEditor: (props: any) => <div data-testid="adaptive-thinking-editor" />,
}));
vi.mock("@/app/[locale]/settings/providers/_components/thinking-budget-editor", () => ({
  ThinkingBudgetEditor: (props: any) => <div data-testid="thinking-budget-editor" />,
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: any) => <span className={className}>{children}</span>,
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children, className }: any) => <div className={className}>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ id, checked, onCheckedChange, disabled }: any) => (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-testid="switch"
      onClick={() => onCheckedChange(!checked)}
    />
  ),
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => <>{children}</>,
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
}));

import type React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { OptionsSection } from "@/app/[locale]/settings/providers/_components/forms/provider-form/sections/options-section";
import type { ProviderFormState } from "@/app/[locale]/settings/providers/_components/forms/provider-form/provider-form-types";

function render(node: React.ReactNode) {
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

function createMockState(
  overrides: {
    routing?: Partial<ProviderFormState["routing"]>;
    ui?: Partial<ProviderFormState["ui"]>;
  } = {}
): ProviderFormState {
  return {
    basic: {
      name: "",
      url: "",
      key: "",
      websiteUrl: "",
    },
    routing: {
      providerType: "claude",
      groupTag: [],
      preserveClientIp: false,
      modelRedirects: {},
      allowedModels: [],
      allowedClients: [],
      blockedClients: [],
      priority: 0,
      groupPriorities: {},
      weight: 1,
      costMultiplier: 1,
      cacheTtlPreference: "inherit",
      swapCacheTtlBilling: false,
      context1mPreference: "inherit",
      codexReasoningEffortPreference: "inherit",
      codexReasoningSummaryPreference: "inherit",
      codexTextVerbosityPreference: "inherit",
      codexParallelToolCallsPreference: "inherit",
      codexServiceTierPreference: "inherit",
      anthropicMaxTokensPreference: "inherit",
      anthropicThinkingBudgetPreference: "inherit",
      anthropicAdaptiveThinking: null,
      geminiGoogleSearchPreference: "inherit",
      activeTimeStart: null,
      activeTimeEnd: null,
      ...overrides.routing,
    },
    rateLimit: {
      limit5hUsd: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: null,
    },
    circuitBreaker: {
      failureThreshold: undefined,
      openDurationMinutes: undefined,
      halfOpenSuccessThreshold: undefined,
      maxRetryAttempts: null,
    },
    network: {
      proxyUrl: "",
      proxyFallbackToDirect: false,
      firstByteTimeoutStreamingSeconds: undefined,
      streamingIdleTimeoutSeconds: undefined,
      requestTimeoutNonStreamingSeconds: undefined,
    },
    mcp: {
      mcpPassthroughType: "none",
      mcpPassthroughUrl: "",
    },
    batch: {
      isEnabled: "no_change",
    },
    ui: {
      activeTab: "basic",
      activeSubTab: null,
      isPending: false,
      showFailureThresholdConfirm: false,
      ...overrides.ui,
    },
  };
}

function setMockForm({
  state = createMockState(),
  mode = "create",
}: {
  state?: ProviderFormState;
  mode?: "create" | "edit" | "batch";
} = {}) {
  mockUseProviderForm.mockReturnValue({
    state,
    dispatch: mockDispatch,
    mode,
    enableMultiProviderTypes: true,
    hideUrl: false,
    hideWebsiteUrl: false,
    groupSuggestions: [],
    dirtyFields: new Set(),
  });
}

function renderSection({
  state = createMockState(),
  mode = "create",
}: {
  state?: ProviderFormState;
  mode?: "create" | "edit" | "batch";
} = {}) {
  setMockForm({ state, mode });
  return render(<OptionsSection />);
}

function getBodyText() {
  return document.body.textContent || "";
}

function getActiveTimeToggle(container: HTMLDivElement) {
  return container.querySelectorAll('[data-testid="switch"]')[2] as HTMLButtonElement | null;
}

describe("OptionsSection", () => {
  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    vi.clearAllMocks();
    setMockForm();
  });

  describe("common section rendering", () => {
    it("renders Advanced Settings section", () => {
      const { unmount } = renderSection();

      expect(getBodyText()).toContain("sections.routing.options.title");

      unmount();
    });

    it("renders preserveClientIp toggle", () => {
      const { unmount } = renderSection();

      expect(document.getElementById("preserve-client-ip")).toBeTruthy();

      unmount();
    });

    it("renders swapCacheTtlBilling toggle", () => {
      const { unmount } = renderSection();

      expect(document.getElementById("swap-cache-ttl-billing")).toBeTruthy();

      unmount();
    });

    it("renders active time section", () => {
      const { unmount } = renderSection();

      expect(getBodyText()).toContain("sections.routing.activeTime.title");

      unmount();
    });
  });

  describe("conditional rendering - claude provider", () => {
    it("shows context1m for claude type", () => {
      const { unmount } = renderSection({
        state: createMockState({ routing: { providerType: "claude" } }),
      });

      expect(getBodyText()).toContain("sections.routing.context1m.label");

      unmount();
    });

    it("shows Anthropic overrides for claude type", () => {
      const { unmount } = renderSection({
        state: createMockState({ routing: { providerType: "claude" } }),
      });

      expect(getBodyText()).toContain("sections.routing.anthropicOverrides.maxTokens.label");

      unmount();
    });

    it("hides Codex overrides for claude type", () => {
      const { unmount } = renderSection({
        state: createMockState({ routing: { providerType: "claude" } }),
      });

      expect(getBodyText()).not.toContain("sections.routing.codexOverrides.title");

      unmount();
    });

    it("hides Gemini overrides for claude type", () => {
      const { unmount } = renderSection({
        state: createMockState({ routing: { providerType: "claude" } }),
      });

      expect(getBodyText()).not.toContain("sections.routing.geminiOverrides.title");

      unmount();
    });
  });

  describe("conditional rendering - codex provider", () => {
    it("shows Codex overrides for codex type", () => {
      const { unmount } = renderSection({
        state: createMockState({ routing: { providerType: "codex" } }),
      });

      expect(getBodyText()).toContain("sections.routing.codexOverrides.title");

      unmount();
    });

    it("hides context1m for codex type", () => {
      const { unmount } = renderSection({
        state: createMockState({ routing: { providerType: "codex" } }),
      });

      expect(getBodyText()).not.toContain("sections.routing.context1m.label");

      unmount();
    });

    it("hides Anthropic overrides for codex type", () => {
      const { unmount } = renderSection({
        state: createMockState({ routing: { providerType: "codex" } }),
      });

      expect(getBodyText()).not.toContain("sections.routing.anthropicOverrides.maxTokens.label");

      unmount();
    });
  });

  describe("conditional rendering - gemini provider", () => {
    it("shows Gemini overrides for gemini type", () => {
      const { unmount } = renderSection({
        state: createMockState({ routing: { providerType: "gemini" } }),
      });

      expect(getBodyText()).toContain("sections.routing.geminiOverrides.title");

      unmount();
    });

    it("hides Codex overrides for gemini type", () => {
      const { unmount } = renderSection({
        state: createMockState({ routing: { providerType: "gemini" } }),
      });

      expect(getBodyText()).not.toContain("sections.routing.codexOverrides.title");

      unmount();
    });

    it("hides Anthropic overrides for gemini type", () => {
      const { unmount } = renderSection({
        state: createMockState({ routing: { providerType: "gemini" } }),
      });

      expect(getBodyText()).not.toContain("sections.routing.anthropicOverrides.maxTokens.label");

      unmount();
    });
  });

  describe("conditional rendering - batch mode", () => {
    it("shows all override sections in batch mode", () => {
      const { unmount } = renderSection({ mode: "batch" });

      expect(getBodyText()).toContain("sections.routing.codexOverrides.title");
      expect(getBodyText()).toContain("sections.routing.anthropicOverrides.maxTokens.label");
      expect(getBodyText()).toContain("sections.routing.geminiOverrides.title");

      unmount();
    });
  });

  describe("dispatch actions", () => {
    it("dispatches SET_PRESERVE_CLIENT_IP on toggle", () => {
      const { unmount } = renderSection();
      const toggle = document.getElementById("preserve-client-ip") as HTMLButtonElement;

      act(() => {
        toggle.click();
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_PRESERVE_CLIENT_IP",
        payload: true,
      });

      unmount();
    });

    it("dispatches SET_SWAP_CACHE_TTL_BILLING on toggle", () => {
      const { unmount } = renderSection();
      const toggle = document.getElementById("swap-cache-ttl-billing") as HTMLButtonElement;

      act(() => {
        toggle.click();
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_SWAP_CACHE_TTL_BILLING",
        payload: true,
      });

      unmount();
    });

    it("dispatches active time start/end when enabling", () => {
      const { container, unmount } = renderSection();
      const toggle = getActiveTimeToggle(container);

      act(() => {
        toggle?.click();
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_ACTIVE_TIME_START",
        payload: "09:00",
      });
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_ACTIVE_TIME_END",
        payload: "22:00",
      });

      unmount();
    });

    it("dispatches null when disabling active time", () => {
      const { container, unmount } = renderSection({
        state: createMockState({
          routing: {
            activeTimeStart: "09:00",
            activeTimeEnd: "22:00",
          },
        }),
      });
      const toggle = getActiveTimeToggle(container);

      act(() => {
        toggle?.click();
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_ACTIVE_TIME_START",
        payload: null,
      });
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_ACTIVE_TIME_END",
        payload: null,
      });

      unmount();
    });
  });

  describe("active time UI", () => {
    it("shows time inputs when active time enabled", () => {
      const { container, unmount } = renderSection({
        state: createMockState({
          routing: {
            activeTimeStart: "09:00",
            activeTimeEnd: "22:00",
          },
        }),
      });

      expect(container.querySelectorAll('input[type="time"]')).toHaveLength(2);

      unmount();
    });

    it("hides time inputs when active time disabled", () => {
      const { container, unmount } = renderSection({
        state: createMockState({
          routing: {
            activeTimeStart: null,
            activeTimeEnd: null,
          },
        }),
      });

      expect(container.querySelectorAll('input[type="time"]')).toHaveLength(0);

      unmount();
    });

    it("shows cross-day hint when start > end", () => {
      const { unmount } = renderSection({
        state: createMockState({
          routing: {
            activeTimeStart: "22:00",
            activeTimeEnd: "06:00",
          },
        }),
      });

      expect(getBodyText()).toContain("sections.routing.activeTime.crossDayHint");

      unmount();
    });
  });

  describe("disabled state", () => {
    it("disables switches when isPending", () => {
      const { container, unmount } = renderSection({
        state: createMockState({
          ui: {
            isPending: true,
          },
        }),
      });
      const switches = Array.from(
        container.querySelectorAll('[data-testid="switch"]')
      ) as HTMLButtonElement[];

      expect(switches).toHaveLength(3);
      for (const toggle of switches) {
        expect(toggle.hasAttribute("disabled")).toBe(true);
      }

      unmount();
    });
  });

  describe("edit mode", () => {
    it("uses edit- prefixed IDs in edit mode", () => {
      const { unmount } = renderSection({ mode: "edit" });

      expect(document.getElementById("edit-preserve-client-ip")).toBeTruthy();

      unmount();
    });
  });

  describe("batch mode badges", () => {
    it("shows codex-only badge in batch mode", () => {
      const { unmount } = renderSection({
        mode: "batch",
        state: createMockState({ routing: { providerType: "codex" } }),
      });

      expect(getBodyText()).toContain("batchNotes.codexOnly");

      unmount();
    });
  });
});
