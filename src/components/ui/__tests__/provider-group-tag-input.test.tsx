/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ProviderGroupSelect } from "@/app/[locale]/dashboard/_components/user/forms/provider-group-select";
import { TagInput } from "@/components/ui/tag-input";

// 该组件从 v1 api-client 导入 getProviderGroupsWithCount，必须 mock 这个路径，
// 否则测试会命中真实的 REST 客户端（历史上 mock 错路径掩盖了真实数据流）。
const providerApiMocks = vi.hoisted(() => ({
  getProviderGroupsWithCount: vi.fn(async () => ({ ok: true, data: [] as unknown[] })),
}));

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api-client/v1/actions/providers", () => providerApiMocks);
vi.mock("sonner", () => sonnerMocks);

// 追踪所有挂载的 React root，确保即使某个用例断言失败提前抛出，afterEach 也能卸载，
// 避免残留已挂载的 root 污染后续用例的 document.activeElement / DOM。
const mountedRoots: Array<{ container: HTMLElement; root: Root; unmounted: boolean }> = [];

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  const entry = { container, root, unmounted: false };
  mountedRoots.push(entry);
  return {
    container,
    unmount: () => {
      if (entry.unmounted) return;
      entry.unmounted = true;
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function typeAndSubmit(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 下拉建议项通过 Portal 渲染（无 Dialog 祖先时落到 document.body），按分组名匹配建议按钮。 */
function suggestionButtonsFor(group: string) {
  return Array.from(document.querySelectorAll("button")).filter((btn) =>
    (btn.textContent || "").includes(group)
  );
}

const PROVIDER_GROUP_TRANSLATIONS = {
  label: "Provider group",
  placeholder: "Enter group",
  description: "desc",
  providersSuffix: "providers",
  errors: {
    loadFailed: "Load failed",
  },
  tagInputErrors: {
    empty: "empty",
    duplicate: "duplicate",
    too_long: "too long",
    invalid_format: "invalid format",
    max_tags: "max tags",
  },
};

afterEach(() => {
  for (const entry of mountedRoots.splice(0)) {
    if (entry.unmounted) continue;
    entry.unmounted = true;
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  providerApiMocks.getProviderGroupsWithCount.mockResolvedValue({ ok: true, data: [] });
});

describe("provider-group tag inputs", () => {
  test("默认 TagInput 仍应拒绝中文标签", async () => {
    const onChange = vi.fn();
    const onInvalidTag = vi.fn();
    const { container, unmount } = render(
      <TagInput value={[]} onChange={onChange} onInvalidTag={onInvalidTag} />
    );

    const input = container.querySelector("input");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await typeAndSubmit(input as HTMLInputElement, "中文分组");

    expect(onChange).not.toHaveBeenCalled();
    expect(onInvalidTag).toHaveBeenCalledWith("中文分组", "invalid_format");

    unmount();
  });

  test("ProviderGroupSelect 应允许输入中文分组", async () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <ProviderGroupSelect
        value=""
        onChange={onChange}
        translations={PROVIDER_GROUP_TRANSLATIONS}
      />
    );

    const input = container.querySelector("input");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await typeAndSubmit(input as HTMLInputElement, "中文分组");

    expect(onChange).toHaveBeenCalledWith("中文分组");
    expect(sonnerMocks.toast.error).not.toHaveBeenCalled();

    unmount();
  });

  // 数据流回归：覆盖 mock 路径、ActionResult 解包与建议渲染链路（经 focus -> handleFocus 展开）。
  test("数据加载后点击输入框应展开下拉并列出已有的供应商分组", async () => {
    providerApiMocks.getProviderGroupsWithCount.mockResolvedValue({
      ok: true,
      data: [
        { group: "team-alpha", providerCount: 3 },
        { group: "team-beta", providerCount: 1 },
      ],
    });
    const onChange = vi.fn();
    const { container, unmount } = render(
      <ProviderGroupSelect
        value=""
        onChange={onChange}
        translations={PROVIDER_GROUP_TRANSLATIONS}
      />
    );

    // 等待异步加载完成
    await flush();

    const input = container.querySelector("input") as HTMLInputElement;
    await act(async () => {
      // 点击容器会聚焦输入框，进而触发 onFocus -> handleFocus 展开下拉
      input.focus();
      input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(suggestionButtonsFor("team-alpha").length).toBeGreaterThan(0);
    expect(suggestionButtonsFor("team-beta").length).toBeGreaterThan(0);

    unmount();
  });

  // #1212 核心回归：建议数据在用户聚焦「之后」才异步返回时，下拉应自动展开。
  // 这是 tag-input.tsx 中「首次加载自动展开」effect 的专属守护用例（移除该 effect 则失败）。
  test("回归 #1212：建议数据在聚焦之后异步返回时下拉应自动展开", async () => {
    const deferred = createDeferred<{
      ok: true;
      data: Array<{ group: string; providerCount: number }>;
    }>();
    providerApiMocks.getProviderGroupsWithCount.mockReturnValue(deferred.promise);

    const onChange = vi.fn();
    const { container, unmount } = render(
      <ProviderGroupSelect
        value=""
        onChange={onChange}
        translations={PROVIDER_GROUP_TRANSLATIONS}
      />
    );

    const input = container.querySelector("input") as HTMLInputElement;

    // 用户在数据返回前就聚焦了输入框：此时建议为空，下拉不应展开
    await act(async () => {
      // happy-dom 下 input.focus() 即可触发 React 的 onFocus 并设置 document.activeElement
      input.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(suggestionButtonsFor("team-alpha").length).toBe(0);

    // 数据异步返回，输入框仍处于聚焦状态：下拉应自动展开
    await act(async () => {
      deferred.resolve({ ok: true, data: [{ group: "team-alpha", providerCount: 2 }] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(suggestionButtonsFor("team-alpha").length).toBeGreaterThan(0);

    unmount();
  });

  // #1212 实际场景：字段位于创建用户的 Dialog 内，下拉通过 Portal 渲染进 dialog-content。
  test("在 Dialog 中点击输入框时下拉应渲染到 dialog-content 容器内", async () => {
    providerApiMocks.getProviderGroupsWithCount.mockResolvedValue({
      ok: true,
      data: [{ group: "team-alpha", providerCount: 5 }],
    });
    const onChange = vi.fn();
    const { container, unmount } = render(
      <div data-slot="dialog-content">
        <ProviderGroupSelect
          value=""
          onChange={onChange}
          translations={PROVIDER_GROUP_TRANSLATIONS}
        />
      </div>
    );
    await flush();

    const input = container.querySelector("input") as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const dialogContent = container.querySelector('[data-slot="dialog-content"]') as HTMLElement;
    const buttonsInDialog = Array.from(dialogContent.querySelectorAll("button")).filter((btn) =>
      (btn.textContent || "").includes("team-alpha")
    );
    expect(buttonsInDialog.length).toBeGreaterThan(0);

    unmount();
  });
});
