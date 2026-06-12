/**
 * @vitest-environment happy-dom
 *
 * AddKeyForm: 自助建 key 路由测试 (U03)
 * 非管理员提交必须直达会话定向端点 addOwnKey（payload 不含 userId），
 * 管理员提交走 addKey（携带目标 userId），两条路径互不触碰。
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
  addOwnKey: vi.fn(async () => ({ ok: true, data: { generatedKey: "sk-test", name: "test" } })),
}));
vi.mock("@/lib/api-client/v1/actions/keys", () => keysActionMocks);

const providersActionMocks = vi.hoisted(() => ({
  getAvailableProviderGroups: vi.fn(async () => []),
}));
vi.mock("@/lib/api-client/v1/actions/providers", () => providersActionMocks);

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

async function fillNameAndSubmit() {
  const nameInput = document.body.querySelector('input[placeholder*="key"]') as HTMLInputElement;
  expect(nameInput).toBeTruthy();
  // 通过原生 setter 写值，绕过 React 的 value tracker 去重，否则合成 onChange 不触发
  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;
  await act(async () => {
    nativeValueSetter?.call(nameInput, "test-key");
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // happy-dom 不会因点击 submit 按钮触发表单提交，直接派发 submit 事件；
  // useZodForm.handleSubmit 内部仍会跑 zod 校验，未通过则不会调用 action。
  const formEl = document.body.querySelector("form") as HTMLFormElement | null;
  expect(formEl).toBeTruthy();
  await act(async () => {
    formEl?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe("AddKeyForm: self-service routing (U03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  test("non-admin submit calls addOwnKey without userId and never calls addKey", async () => {
    const messages = loadMessages();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Dialog open onOpenChange={() => {}}>
          <AddKeyForm userId={1} onSuccess={vi.fn()} />
        </Dialog>
      </NextIntlClientProvider>
    );

    await fillNameAndSubmit();

    expect(keysActionMocks.addOwnKey).toHaveBeenCalledTimes(1);
    expect(keysActionMocks.addKey).not.toHaveBeenCalled();

    const payload = keysActionMocks.addOwnKey.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.hasOwn(payload, "userId")).toBe(false);
    expect(payload.name).toBe("test-key");

    unmount();
  });

  test("admin submit calls addKey with the target userId and never calls addOwnKey", async () => {
    const messages = loadMessages();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Dialog open onOpenChange={() => {}}>
          <AddKeyForm userId={42} isAdmin onSuccess={vi.fn()} />
        </Dialog>
      </NextIntlClientProvider>
    );

    await fillNameAndSubmit();

    expect(keysActionMocks.addKey).toHaveBeenCalledTimes(1);
    expect(keysActionMocks.addOwnKey).not.toHaveBeenCalled();

    const payload = keysActionMocks.addKey.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.userId).toBe(42);

    unmount();
  });
});
