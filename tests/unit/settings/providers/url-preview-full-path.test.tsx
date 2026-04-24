/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import enMessages from "../../../../messages/en";
import { UrlPreview } from "../../../../src/app/[locale]/settings/providers/_components/forms/url-preview";

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => sonnerMocks);

function renderWithIntl(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {node}
      </NextIntlClientProvider>
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("UrlPreview full-path compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("合法 full-path base URL 应原样预览且不显示 duplicate warning", () => {
    const { container, unmount } = renderWithIntl(
      <UrlPreview baseUrl="https://relay.example.com/openai/v1/responses" providerType="codex" />
    );

    expect(container.textContent).toContain("https://relay.example.com/openai/v1/responses");
    expect(container.textContent).not.toContain("Duplicate path detected");

    unmount();
  });

  test("bare /openai preview stays single-versioned", () => {
    const { container, unmount } = renderWithIntl(
      <UrlPreview baseUrl="https://api.gptclubapi.xyz/openai" providerType="codex" />
    );

    expect(container.textContent).toContain("https://api.gptclubapi.xyz/openai/v1/responses");
    expect(container.textContent).not.toContain(
      "https://api.gptclubapi.xyz/openai/v1/v1/responses"
    );
    expect(container.textContent).not.toContain("Duplicate path detected");

    unmount();
  });

  test("bare /openai/ preview stays single-versioned", () => {
    const { container, unmount } = renderWithIntl(
      <UrlPreview baseUrl="https://api.gptclubapi.xyz/openai/" providerType="codex" />
    );

    expect(container.textContent).toContain("https://api.gptclubapi.xyz/openai/v1/responses");
    expect(container.textContent).not.toContain(
      "https://api.gptclubapi.xyz/openai/v1/v1/responses"
    );
    expect(container.textContent).not.toContain("Duplicate path detected");

    unmount();
  });

  test("合法重复业务片段不应触发 duplicate warning", () => {
    const { container, unmount } = renderWithIntl(
      <UrlPreview
        baseUrl="https://relay.example.com/team/team/openai/v1/responses"
        providerType="codex"
      />
    );

    expect(container.textContent).toContain(
      "https://relay.example.com/team/team/openai/v1/responses"
    );
    expect(container.textContent).not.toContain("Duplicate path detected");

    unmount();
  });

  test("完整 Chat endpoint base URL 只应预览当前 endpoint，不应再拼出 /v1/models", () => {
    const { container, unmount } = renderWithIntl(
      <UrlPreview
        baseUrl="https://relay.example.com/openai/v1/chat/completions"
        providerType="openai-compatible"
      />
    );

    expect(container.textContent).toContain("https://relay.example.com/openai/v1/chat/completions");
    expect(container.textContent).not.toContain("OpenAI Models");
    expect(container.textContent).not.toContain(
      "https://relay.example.com/openai/v1/chat/completions/v1/models"
    );

    unmount();
  });

  test("完整子端点 base URL 只应预览当前子端点，不应重复追加 suffix", () => {
    const { container, unmount } = renderWithIntl(
      <UrlPreview
        baseUrl="https://proxy.example.com/anthropic/v1/messages/count_tokens"
        providerType="claude"
      />
    );

    expect(container.textContent).toContain(
      "https://proxy.example.com/anthropic/v1/messages/count_tokens"
    );
    expect(container.textContent).not.toContain("Claude Messages");
    expect(container.textContent).not.toContain(
      "https://proxy.example.com/anthropic/v1/messages/count_tokens/v1/messages/count_tokens"
    );

    unmount();
  });

  test("版本根路径预览应只追加 endpoint，不重复拼接 /v1", () => {
    const { container, unmount } = renderWithIntl(
      <UrlPreview baseUrl="https://relay.example.com/openai/v1" providerType="openai-compatible" />
    );

    expect(container.textContent).toContain("https://relay.example.com/openai/v1/chat/completions");
    expect(container.textContent).not.toContain(
      "https://relay.example.com/openai/v1/v1/chat/completions"
    );

    unmount();
  });

  test("真实重复路径仍应显示 duplicate warning", () => {
    const { container, unmount } = renderWithIntl(
      <UrlPreview
        baseUrl="https://relay.example.com/openai/v1/responses/v1/responses"
        providerType="codex"
      />
    );

    expect(container.textContent).toContain("Duplicate path detected");

    unmount();
  });

  test("双版本前缀也应触发 duplicate warning", () => {
    const { container, unmount } = renderWithIntl(
      <UrlPreview
        baseUrl="https://relay.example.com/openai/v1/v1/chat/completions"
        providerType="openai-compatible"
      />
    );

    expect(container.textContent).toContain("Duplicate path detected");

    unmount();
  });
});
