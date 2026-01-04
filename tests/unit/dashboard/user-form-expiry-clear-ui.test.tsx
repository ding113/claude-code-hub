/**
 * @vitest-environment happy-dom
 */

import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Dialog } from "@/components/ui/dialog";
import { UserForm } from "@/app/[locale]/dashboard/_components/user/forms/user-form";

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

const usersActionMocks = vi.hoisted(() => ({
  editUser: vi.fn(async () => ({ ok: true })),
  addUser: vi.fn(async () => ({ ok: true, data: { user: { id: 1 } } })),
}));
vi.mock("@/actions/users", () => usersActionMocks);

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
    notifications: read("notifications.json"),
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

function clickButtonByText(text: string) {
  const buttons = Array.from(document.body.querySelectorAll("button"));
  const btn = buttons.find((b) => (b.textContent || "").includes(text));
  if (!btn) {
    throw new Error(`未找到按钮: ${text}`);
  }
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("UserForm: 清除 expiresAt 后应提交 null", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("编辑模式：点击 Clear Date 后提交应调用 editUser(..., { expiresAt: null })", async () => {
    const messages = loadMessages();
    const expiresAt = new Date("2026-01-04T23:59:59.999Z");

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Dialog open onOpenChange={() => {}}>
          <UserForm
            user={{ id: 123, name: "u", rpm: null, dailyQuota: null, expiresAt }}
            currentUser={{ role: "admin" }}
          />
        </Dialog>
      </NextIntlClientProvider>
    );

    await act(async () => {
      clickButtonByText("2026-01-04");
    });

    await act(async () => {
      clickButtonByText("Clear Date");
    });

    const submit = document.body.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    expect(submit).toBeTruthy();

    await act(async () => {
      submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(usersActionMocks.editUser).toHaveBeenCalledTimes(1);
    const [, payload] = usersActionMocks.editUser.mock.calls[0] as [number, any];
    expect(payload.expiresAt).toBeNull();

    unmount();
  });
});
