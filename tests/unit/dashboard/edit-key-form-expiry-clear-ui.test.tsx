import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Dialog } from "@/components/ui/dialog";
import { EditKeyForm } from "@/app/[locale]/dashboard/_components/user/forms/edit-key-form";

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
  editKey: vi.fn(async () => ({ ok: true })),
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

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  act(() => {
    root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
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

describe("EditKeyForm: 清除 expiresAt 后应携带 expiresAt 字段提交（用于触发后端清除）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("点击 Clear Date 后提交应调用 editKey 并携带 expiresAt 字段", async () => {
    const messages = loadMessages();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Dialog open onOpenChange={() => {}}>
          <EditKeyForm
            keyData={{ id: 1, name: "k", expiresAt: "2026-01-04T23:59:59.999Z" }}
            user={{
              id: 10,
              name: "u",
              description: "",
              role: "user",
              rpm: null,
              dailyQuota: null,
              providerGroup: "default",
              tags: [],
              dailyResetMode: "fixed",
              dailyResetTime: "00:00",
              isEnabled: true,
              expiresAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            }}
            isAdmin
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

    expect(keysActionMocks.editKey).toHaveBeenCalledTimes(1);
    const call = keysActionMocks.editKey.mock.calls[0] as unknown as [number, any];
    const [, payload] = call;

    expect("expiresAt" in payload).toBe(true);

    unmount();
  });
});
