/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import enMessages from "../../../../messages/en";
import { BasicInfoSection } from "../../../../src/app/[locale]/settings/providers/_components/forms/provider-form/sections/basic-info-section";

const providerFormContextMock = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {
    basic: {
      name: "",
      url: "",
      key: "",
      websiteUrl: "",
    },
    routing: {
      providerType: "openai-compatible",
    },
    ui: {
      isPending: false,
    },
  },
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/components/quick-paste-dialog",
  () => ({
    QuickPasteDialog: () => <button type="button">Quick Paste</button>,
  })
);

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/provider-form-context",
  () => ({
    useProviderForm: () => ({
      state: providerFormContextMock.state,
      dispatch: providerFormContextMock.dispatch,
      mode: "create",
      provider: null,
      hideUrl: false,
      hideWebsiteUrl: false,
      batchProviders: null,
    }),
  })
);

function renderWithIntl(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {node}
      </NextIntlClientProvider>
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("BasicInfoSection base URL guidance", () => {
  beforeEach(() => {
    providerFormContextMock.dispatch.mockClear();
    document.body.innerHTML = "";
  });

  test("renders inline guidance text and tooltip help for the API address field", () => {
    const { container, unmount } = renderWithIntl(<BasicInfoSection />);

    expect(document.getElementById("url")).not.toBeNull();
    expect(container.textContent).toContain(
      "Use your provider's base address. For request forwarding, preview, and provider testing, you can also paste a version path or exact endpoint here."
    );
    expect(container.textContent).toContain(
      "Examples: https://relay.example.com/openai, https://relay.example.com/openai/v1, https://relay.example.com/openai/v1/responses. Claude Code Hub reuses the path you provide instead of appending the same endpoint twice."
    );

    const helpTrigger = container.querySelector("button[data-smart-input-tooltip]");
    expect(helpTrigger).not.toBeNull();
    expect(helpTrigger?.getAttribute("aria-label")).toBe(
      "Examples: https://relay.example.com/openai, https://relay.example.com/openai/v1, https://relay.example.com/openai/v1/responses. Claude Code Hub reuses the path you provide instead of appending the same endpoint twice."
    );

    unmount();
  });
});
