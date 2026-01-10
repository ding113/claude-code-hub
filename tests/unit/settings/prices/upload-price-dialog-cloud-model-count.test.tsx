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
import { UploadPriceDialog } from "@/app/[locale]/settings/prices/_components/upload-price-dialog";

// 测试环境不加载 next/navigation 的真实实现（避免 Next.js 运行时依赖）
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("sonner", () => sonnerMocks);

function loadMessages() {
  const base = path.join(process.cwd(), "messages/en");
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(base, name), "utf8"));

  return {
    common: read("common.json"),
    errors: read("errors.json"),
    ui: read("ui.json"),
    forms: read("forms.json"),
    settings: read("settings.json"),
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
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("UploadPriceDialog: 云端模型数量应异步显示", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  test("打开弹窗后应先显示加载态，随后展示云端模型数量", async () => {
    const messages = loadMessages();
    const originalFetch = globalThis.fetch;

    let resolveFetch: ((value: unknown) => void) | null = null;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UploadPriceDialog defaultOpen />
      </NextIntlClientProvider>
    );

    expect(document.body.textContent).toContain("System has built-in price table");
    expect(document.body.textContent).toContain(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (messages as any).settings.prices.dialog.cloudModelCountLoading
    );

    resolveFetch?.({
      json: async () => ({ ok: true, data: { count: 123 } }),
    });

    await act(async () => {
      await flushPromises();
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(document.body.textContent).toContain("Currently supports 123 models");

    globalThis.fetch = originalFetch;
    unmount();
  });
});
