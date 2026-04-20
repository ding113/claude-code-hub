/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BatchEditToolbar } from "@/app/[locale]/dashboard/_components/user/batch-edit/batch-edit-toolbar";

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

const messages = {
  dashboard: {
    userManagement: {
      batchEdit: {
        enterMode: "批量编辑",
        exitMode: "退出",
        selectAll: "全选",
        selectedCount: "已选 {users} 个用户，{keys} 个密钥",
        downloadSelected: "下载 Key TXT",
        editSelected: "编辑选中项",
      },
    },
  },
};

describe("BatchEditToolbar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("批量模式下显示下载按钮，并在没有选中 key 时禁用", () => {
    const { container, unmount } = render(
      <NextIntlClientProvider locale="zh-CN" messages={messages}>
        <BatchEditToolbar
          isMultiSelectMode={true}
          allSelected={false}
          selectedUsersCount={1}
          selectedKeysCount={0}
          totalUsersCount={3}
          onEnterMode={vi.fn()}
          onExitMode={vi.fn()}
          onSelectAll={vi.fn()}
          onDownloadSelectedKeys={vi.fn()}
          onEditSelected={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    const buttons = Array.from(container.querySelectorAll("button"));
    const downloadButton = buttons.find((button) => button.textContent?.includes("下载 Key TXT"));

    expect(downloadButton).toBeTruthy();
    expect(downloadButton?.hasAttribute("disabled")).toBe(true);

    unmount();
  });

  test("点击下载按钮会调用回调", async () => {
    const onDownloadSelectedKeys = vi.fn();

    const { container, unmount } = render(
      <NextIntlClientProvider locale="zh-CN" messages={messages}>
        <BatchEditToolbar
          isMultiSelectMode={true}
          allSelected={true}
          selectedUsersCount={2}
          selectedKeysCount={3}
          totalUsersCount={2}
          onEnterMode={vi.fn()}
          onExitMode={vi.fn()}
          onSelectAll={vi.fn()}
          onDownloadSelectedKeys={onDownloadSelectedKeys}
          onEditSelected={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    const buttons = Array.from(container.querySelectorAll("button"));
    const downloadButton = buttons.find((button) => button.textContent?.includes("下载 Key TXT"));

    expect(downloadButton).toBeTruthy();

    await act(async () => {
      downloadButton?.click();
      await Promise.resolve();
    });

    expect(onDownloadSelectedKeys).toHaveBeenCalledTimes(1);

    unmount();
  });
});
