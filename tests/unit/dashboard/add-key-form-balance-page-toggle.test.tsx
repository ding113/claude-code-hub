/**
 * @vitest-environment happy-dom
 *
 * AddKeyForm: Balance Query Page toggle copy alignment test
 * Verifies that the toggle uses balanceQueryPage translations and
 * description changes dynamically based on toggle state.
 */

import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Dialog } from "@/components/ui/dialog";
import { AddKeyForm } from "@/app/[locale]/dashboard/_components/user/forms/add-key-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("sonner", () => sonnerMocks);

const keysActionMocks = vi.hoisted(() => ({
  addKey: vi.fn(async () => ({ ok: true, data: { generatedKey: "sk-test", name: "test" } })),
}));
vi.mock("@/actions/keys", () => keysActionMocks);

const providersActionMocks = vi.hoisted(() => ({
  getAvailableProviderGroups: vi.fn(async () => []),
}));
vi.mock("@/actions/providers", () => providersActionMocks);

function loadMessages() {
  const base = path.join(process.cwd(), "messages/en");
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(base, name), "utf8"));

  return {
    common: read("common.json"),
    errors: read("errors.json"),
    quota: read("quota.json"),
    ui: read("ui.json"),
    dashboard: read("dashboard.json"),
    forms: read("forms.json"),
  };
}

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

describe("AddKeyForm: Balance Query Page toggle copy alignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("should use balanceQueryPage label from keyEditSection translations", async () => {
    const messages = loadMessages();
    const onSuccess = vi.fn();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Dialog open onOpenChange={() => {}}>
          <AddKeyForm userId={1} isAdmin onSuccess={onSuccess} />
        </Dialog>
      </NextIntlClientProvider>
    );

    // The label should be "Independent Personal Usage Page" from balanceQueryPage translations
    // NOT "Allow Web UI Login" from addKeyForm.canLoginWebUi
    const expectedLabel =
      messages.dashboard.userManagement.keyEditSection.fields.balanceQueryPage.label;
    const oldLabel = messages.dashboard.addKeyForm.canLoginWebUi.label;

    // Find the label element for the toggle
    const labelElement = document.body.querySelector('label[for="can-login-web-ui"]');
    expect(labelElement).toBeTruthy();

    const labelText = labelElement?.textContent;
    expect(labelText).toBe(expectedLabel);
    expect(labelText).not.toBe(oldLabel);

    unmount();
  });

  test("should show descriptionEnabled when switch is ON (canLoginWebUi=false)", async () => {
    const messages = loadMessages();
    const onSuccess = vi.fn();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Dialog open onOpenChange={() => {}}>
          <AddKeyForm userId={1} isAdmin onSuccess={onSuccess} />
        </Dialog>
      </NextIntlClientProvider>
    );

    // Default state: canLoginWebUi=false, so switch is ON (checked)
    // Should show descriptionEnabled
    const expectedDescription =
      messages.dashboard.userManagement.keyEditSection.fields.balanceQueryPage.descriptionEnabled;

    // Find the description paragraph in the toggle container
    const toggleContainer = document.body.querySelector(
      'label[for="can-login-web-ui"]'
    )?.parentElement;
    const descriptionParagraph = toggleContainer?.querySelector("p");

    expect(descriptionParagraph).toBeTruthy();
    expect(descriptionParagraph?.textContent).toBe(expectedDescription);

    unmount();
  });

  test("should show descriptionDisabled when switch is OFF (canLoginWebUi=true)", async () => {
    const messages = loadMessages();
    const onSuccess = vi.fn();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Dialog open onOpenChange={() => {}}>
          <AddKeyForm userId={1} isAdmin onSuccess={onSuccess} />
        </Dialog>
      </NextIntlClientProvider>
    );

    // Find and click the switch to toggle it OFF
    const switchElement = document.body.querySelector(
      'button[role="switch"][id="can-login-web-ui"]'
    ) as HTMLButtonElement;
    expect(switchElement).toBeTruthy();

    // Initially switch is ON (checked), click to turn OFF
    await act(async () => {
      switchElement.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    // After toggle: canLoginWebUi=true, switch is OFF
    // Should show descriptionDisabled
    const expectedDescription =
      messages.dashboard.userManagement.keyEditSection.fields.balanceQueryPage.descriptionDisabled;

    const toggleContainer = document.body.querySelector(
      'label[for="can-login-web-ui"]'
    )?.parentElement;
    const descriptionParagraph = toggleContainer?.querySelector("p");

    expect(descriptionParagraph).toBeTruthy();
    expect(descriptionParagraph?.textContent).toBe(expectedDescription);

    unmount();
  });

  test("should toggle description dynamically when switch state changes", async () => {
    const messages = loadMessages();
    const onSuccess = vi.fn();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Dialog open onOpenChange={() => {}}>
          <AddKeyForm userId={1} isAdmin onSuccess={onSuccess} />
        </Dialog>
      </NextIntlClientProvider>
    );

    const descriptionEnabled =
      messages.dashboard.userManagement.keyEditSection.fields.balanceQueryPage.descriptionEnabled;
    const descriptionDisabled =
      messages.dashboard.userManagement.keyEditSection.fields.balanceQueryPage.descriptionDisabled;

    const getDescription = () => {
      const toggleContainer = document.body.querySelector(
        'label[for="can-login-web-ui"]'
      )?.parentElement;
      return toggleContainer?.querySelector("p")?.textContent;
    };

    const switchElement = document.body.querySelector(
      'button[role="switch"][id="can-login-web-ui"]'
    ) as HTMLButtonElement;

    // Initial state: switch ON, show descriptionEnabled
    expect(getDescription()).toBe(descriptionEnabled);

    // Toggle OFF
    await act(async () => {
      switchElement.click();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(getDescription()).toBe(descriptionDisabled);

    // Toggle back ON
    await act(async () => {
      switchElement.click();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(getDescription()).toBe(descriptionEnabled);

    unmount();
  });
});
