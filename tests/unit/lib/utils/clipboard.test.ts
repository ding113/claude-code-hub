import { afterEach, describe, expect, test, vi } from "vitest";

import { copyTextToClipboard, copyToClipboard, isClipboardSupported } from "@/lib/utils/clipboard";

function stubSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", {
    value,
    configurable: true,
  });
}

function stubClipboard(writeText: (text: string) => Promise<void> | void) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

function stubExecCommand(impl: (command: string) => boolean) {
  Object.defineProperty(document, "execCommand", {
    value: impl,
    configurable: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clipboard utils", () => {
  test("SSR 环境：isClipboardSupported/copyTextToClipboard 应返回 false", async () => {
    vi.stubGlobal("window", undefined as unknown as Window);

    expect(isClipboardSupported()).toBe(false);
    await expect(copyTextToClipboard("abc")).resolves.toBe(false);
  });

  test("isClipboardSupported: 仅在安全上下文且 Clipboard API 可用时为 true", () => {
    stubSecureContext(false);
    stubClipboard(vi.fn());
    expect(isClipboardSupported()).toBe(false);

    stubSecureContext(true);
    stubClipboard(vi.fn());
    expect(isClipboardSupported()).toBe(true);
  });

  test("copyTextToClipboard: Clipboard API 成功时返回 true", async () => {
    stubSecureContext(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    const execCommand = vi.fn();
    stubExecCommand(execCommand);

    const before = document.querySelectorAll("textarea").length;
    await expect(copyTextToClipboard("abc")).resolves.toBe(true);
    const after = document.querySelectorAll("textarea").length;

    expect(writeText).toHaveBeenCalledWith("abc");
    expect(execCommand).not.toHaveBeenCalled();
    expect(after).toBe(before);
  });

  test("copyTextToClipboard: Clipboard API 失败时应 fallback 到 execCommand", async () => {
    stubSecureContext(true);
    const writeText = vi.fn().mockRejectedValue(new Error("fail"));
    stubClipboard(writeText);

    const execCommand = vi.fn(() => true);
    stubExecCommand(execCommand);

    const before = document.querySelectorAll("textarea").length;
    await expect(copyTextToClipboard("abc")).resolves.toBe(true);
    const after = document.querySelectorAll("textarea").length;

    expect(writeText).toHaveBeenCalledWith("abc");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(after).toBe(before);
  });

  test("copyTextToClipboard: 无 Clipboard API 时走 fallback（execCommand 失败则返回 false）", async () => {
    stubSecureContext(false);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });

    stubExecCommand(() => false);

    await expect(copyTextToClipboard("abc")).resolves.toBe(false);
  });

  test("copyTextToClipboard: fallback 抛错时返回 false", async () => {
    stubSecureContext(false);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });

    stubExecCommand(() => {
      throw new Error("boom");
    });

    await expect(copyTextToClipboard("abc")).resolves.toBe(false);
  });

  test("copyToClipboard: 兼容旧 API（内部调用 copyTextToClipboard）", async () => {
    stubSecureContext(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copyToClipboard("abc")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  test("copyTextToClipboard: 无 document 时 fallback 直接返回 false", async () => {
    stubSecureContext(false);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    vi.stubGlobal("document", undefined as unknown as Document);

    await expect(copyTextToClipboard("abc")).resolves.toBe(false);
  });
});
