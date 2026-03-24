/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ProviderGroupSelect } from "@/app/[locale]/dashboard/_components/user/forms/provider-group-select";
import { TagInput } from "@/components/ui/tag-input";

const providerActionsMocks = vi.hoisted(() => ({
  getProviderGroupsWithCount: vi.fn(async () => ({ ok: true, data: [] })),
}));

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("@/actions/providers", () => providerActionsMocks);
vi.mock("sonner", () => sonnerMocks);

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

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

beforeEach(() => {
  vi.clearAllMocks();
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
    const translations = {
      label: "Provider group",
      placeholder: "Enter group",
      description: "desc",
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
    const { container, unmount } = render(
      <ProviderGroupSelect value="" onChange={onChange} translations={translations} />
    );

    const input = container.querySelector("input");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await typeAndSubmit(input as HTMLInputElement, "中文分组");

    expect(onChange).toHaveBeenCalledWith("中文分组");
    expect(sonnerMocks.toast.error).not.toHaveBeenCalled();

    unmount();
  });
});
