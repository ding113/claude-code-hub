/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DeleteModelDialog } from "@/app/[locale]/settings/prices/_components/delete-model-dialog";
import { loadMessages } from "./test-messages";

const modelPricesActionMocks = vi.hoisted(() => ({
  deleteSingleModelPrice: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/actions/model-prices", () => modelPricesActionMocks);

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("sonner", () => sonnerMocks);

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

describe("DeleteModelDialog: 删除流程", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  test("删除成功：应调用 action、提示成功、触发回调与事件", async () => {
    const messages = loadMessages();
    const onSuccess = vi.fn();
    const priceUpdatedListener = vi.fn();
    window.addEventListener("price-data-updated", priceUpdatedListener);

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DeleteModelDialog modelName="model-to-delete" onSuccess={onSuccess} />
      </NextIntlClientProvider>
    );

    const trigger = Array.from(document.querySelectorAll("button")).find(
      (el) => el.textContent?.trim() === "Delete"
    );
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    const dialog = document.querySelector(
      '[data-slot="alert-dialog-content"]'
    ) as HTMLElement | null;
    expect(dialog).toBeTruthy();

    const confirmButton = Array.from(dialog!.querySelectorAll("button")).find(
      (el) => el.textContent?.trim() === "Delete"
    );
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(modelPricesActionMocks.deleteSingleModelPrice).toHaveBeenCalledWith("model-to-delete");
    expect(sonnerMocks.toast.success).toHaveBeenCalled();
    expect(sonnerMocks.toast.error).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
    expect(priceUpdatedListener).toHaveBeenCalled();

    window.removeEventListener("price-data-updated", priceUpdatedListener);
    unmount();
  });

  test("删除失败：应提示错误且不触发成功回调", async () => {
    modelPricesActionMocks.deleteSingleModelPrice.mockResolvedValueOnce({
      ok: false,
      error: "bad",
    });

    const messages = loadMessages();
    const onSuccess = vi.fn();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DeleteModelDialog modelName="model-to-delete" onSuccess={onSuccess} />
      </NextIntlClientProvider>
    );

    const trigger = Array.from(document.querySelectorAll("button")).find(
      (el) => el.textContent?.trim() === "Delete"
    );
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    const dialog = document.querySelector(
      '[data-slot="alert-dialog-content"]'
    ) as HTMLElement | null;
    expect(dialog).toBeTruthy();

    const confirmButton = Array.from(dialog!.querySelectorAll("button")).find(
      (el) => el.textContent?.trim() === "Delete"
    );
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(modelPricesActionMocks.deleteSingleModelPrice).toHaveBeenCalledWith("model-to-delete");
    expect(sonnerMocks.toast.error).toHaveBeenCalledWith("bad");
    expect(onSuccess).not.toHaveBeenCalled();

    unmount();
  });
});
