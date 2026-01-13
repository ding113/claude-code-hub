/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { UploadPriceDialog } from "@/app/[locale]/settings/prices/_components/upload-price-dialog";
import type { PriceUpdateResult } from "@/types/model-price";
import { loadMessages } from "./test-messages";

const modelPricesActionMocks = vi.hoisted(() => ({
  uploadPriceTable: vi.fn(async () => ({ ok: true, data: null as PriceUpdateResult | null })),
}));
vi.mock("@/actions/model-prices", () => modelPricesActionMocks);

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("sonner", () => sonnerMocks);

const navigationMocks = vi.hoisted(() => {
  const push = vi.fn();
  return {
    __push: push,
    useRouter: () => ({ push }),
  };
});
vi.mock("next/navigation", () => ({
  useRouter: navigationMocks.useRouter,
}));

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

function setFileInput(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
}

describe("UploadPriceDialog: 上传流程", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  test("选择非 JSON/TOML 文件应提示错误并跳过上传", async () => {
    const messages = loadMessages();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { count: 1 } }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UploadPriceDialog defaultOpen />
      </NextIntlClientProvider>
    );

    const input = document.getElementById("price-file-input") as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const file = new File(["x"], "prices.txt", { type: "text/plain" });
    setFileInput(input!, file);

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await flushPromises();
    });

    expect(modelPricesActionMocks.uploadPriceTable).not.toHaveBeenCalled();
    expect(sonnerMocks.toast.error).toHaveBeenCalled();

    globalThis.fetch = originalFetch;
    unmount();
  });

  test("文件过大应提示错误并跳过上传", async () => {
    const messages = loadMessages();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { count: 1 } }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UploadPriceDialog defaultOpen />
      </NextIntlClientProvider>
    );

    const input = document.getElementById("price-file-input") as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const file = new File(["{}"], "prices.json", { type: "application/json" });
    Object.defineProperty(file, "size", { configurable: true, value: 10 * 1024 * 1024 + 1 });
    setFileInput(input!, file);

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await flushPromises();
    });

    expect(modelPricesActionMocks.uploadPriceTable).not.toHaveBeenCalled();
    expect(sonnerMocks.toast.error).toHaveBeenCalled();

    globalThis.fetch = originalFetch;
    unmount();
  });

  test("上传成功应展示结果并触发 price-data-updated 事件", async () => {
    const messages = loadMessages();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { count: 1 } }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const result: PriceUpdateResult = {
      added: ["a", "b"],
      updated: ["c"],
      unchanged: [],
      failed: [],
      total: 3,
    };
    modelPricesActionMocks.uploadPriceTable.mockResolvedValueOnce({ ok: true, data: result });

    const priceUpdatedListener = vi.fn();
    window.addEventListener("price-data-updated", priceUpdatedListener);

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UploadPriceDialog defaultOpen />
      </NextIntlClientProvider>
    );

    const input = document.getElementById("price-file-input") as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const file = new File(["{}"], "prices.json", { type: "application/json" });
    setFileInput(input!, file);

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(modelPricesActionMocks.uploadPriceTable).toHaveBeenCalledWith("{}");
    expect(sonnerMocks.toast.success).toHaveBeenCalled();
    expect(priceUpdatedListener).toHaveBeenCalled();

    // 结果视图应出现 total 数字
    expect(document.body.textContent).toContain("3");

    window.removeEventListener("price-data-updated", priceUpdatedListener);
    globalThis.fetch = originalFetch;
    unmount();
  });

  test("上传成功包含 failed/unchanged 时应渲染对应区块", async () => {
    const messages = loadMessages();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { count: 1 } }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const result: PriceUpdateResult = {
      added: [],
      updated: [],
      unchanged: ["same"],
      failed: ["bad-model"],
      total: 2,
    };
    modelPricesActionMocks.uploadPriceTable.mockResolvedValueOnce({ ok: true, data: result });

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UploadPriceDialog defaultOpen />
      </NextIntlClientProvider>
    );

    const input = document.getElementById("price-file-input") as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const file = new File(["{}"], "prices.json", { type: "application/json" });
    setFileInput(input!, file);

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(document.body.textContent).toContain("Failed:");
    expect(document.body.textContent).toContain("Skipped:");

    globalThis.fetch = originalFetch;
    unmount();
  });

  test("上传失败（ok=false）应提示 updateFailed", async () => {
    const messages = loadMessages();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { count: 1 } }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    modelPricesActionMocks.uploadPriceTable.mockResolvedValueOnce({ ok: false, error: "bad" });

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UploadPriceDialog defaultOpen />
      </NextIntlClientProvider>
    );

    const input = document.getElementById("price-file-input") as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const file = new File(["{}"], "prices.json", { type: "application/json" });
    setFileInput(input!, file);

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(modelPricesActionMocks.uploadPriceTable).toHaveBeenCalled();
    expect(sonnerMocks.toast.error).toHaveBeenCalled();

    globalThis.fetch = originalFetch;
    unmount();
  });

  test("上传失败（data=null）应提示 updateFailed", async () => {
    const messages = loadMessages();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { count: 1 } }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    modelPricesActionMocks.uploadPriceTable.mockResolvedValueOnce({ ok: true, data: null });

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UploadPriceDialog defaultOpen />
      </NextIntlClientProvider>
    );

    const input = document.getElementById("price-file-input") as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const file = new File(["{}"], "prices.json", { type: "application/json" });
    setFileInput(input!, file);

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(modelPricesActionMocks.uploadPriceTable).toHaveBeenCalled();
    expect(sonnerMocks.toast.error).toHaveBeenCalled();
    expect(sonnerMocks.toast.success).not.toHaveBeenCalled();

    globalThis.fetch = originalFetch;
    unmount();
  });

  test("uploading=true 时应阻止关闭对话框", async () => {
    const messages = loadMessages();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { count: 1 } }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    let resolveUpload: ((value: unknown) => void) | null = null;
    const uploadPromise = new Promise((resolve) => {
      resolveUpload = resolve;
    });
    modelPricesActionMocks.uploadPriceTable.mockReturnValueOnce(uploadPromise as never);

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UploadPriceDialog defaultOpen />
      </NextIntlClientProvider>
    );

    const input = document.getElementById("price-file-input") as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const file = new File(["{}"], "prices.json", { type: "application/json" });
    setFileInput(input!, file);

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await flushPromises();
    });

    const closeButton = document.querySelector(
      '[data-slot="dialog-close"]'
    ) as HTMLButtonElement | null;
    expect(closeButton).toBeTruthy();

    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    // uploading 阶段关闭应被阻止：对话框内容仍存在
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeTruthy();

    resolveUpload?.({ ok: false, error: "bad" });

    await act(async () => {
      await flushPromises();
      await flushPromises();
    });

    globalThis.fetch = originalFetch;
    unmount();
  });

  test("isRequired=true 且有更新时，点击底部按钮应跳转 /dashboard", async () => {
    const messages = loadMessages();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { count: 1 } }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const result: PriceUpdateResult = {
      added: ["a"],
      updated: [],
      unchanged: [],
      failed: [],
      total: 1,
    };
    modelPricesActionMocks.uploadPriceTable.mockResolvedValueOnce({ ok: true, data: result });

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <UploadPriceDialog defaultOpen isRequired />
      </NextIntlClientProvider>
    );

    const input = document.getElementById("price-file-input") as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const file = new File(["{}"], "prices.json", { type: "application/json" });
    setFileInput(input!, file);

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    const footerButton = Array.from(document.querySelectorAll("button")).find(
      (el) => el.textContent?.trim() === "Confirm"
    );
    expect(footerButton).toBeTruthy();

    await act(async () => {
      footerButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    expect(navigationMocks.__push).toHaveBeenCalledWith("/dashboard");

    globalThis.fetch = originalFetch;
    unmount();
  });
});
