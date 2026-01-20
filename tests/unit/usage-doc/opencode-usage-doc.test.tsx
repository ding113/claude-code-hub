/**
 * @vitest-environment happy-dom
 */

import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";
import { UsageDocContent } from "@/app/[locale]/usage-doc/page";
import { locales } from "@/i18n/config";

// 测试环境不加载 next-intl/navigation -> next/navigation 的真实实现（避免 Next.js 运行时依赖）
vi.mock("@/i18n/routing", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
}));

function loadUsageMessages(locale: string) {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "messages", locale, "usage.json"), "utf8")
  );
}

function renderWithIntl(locale: string, node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const usageMessages = loadUsageMessages(locale);

  act(() => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={{ usage: usageMessages }} timeZone="UTC">
        {node}
      </NextIntlClientProvider>
    );
  });

  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("UsageDoc - OpenCode 配置教程", () => {
  test("OpenCode 段落应位于 Gemini CLI 之后、Droid 之前", () => {
    const { unmount } = renderWithIntl("en", <UsageDocContent origin="http://localhost:23000" />);

    const h2Ids = Array.from(document.querySelectorAll("h2")).map((el) => el.id);

    expect(h2Ids).toContain("gemini");
    expect(h2Ids).toContain("opencode");
    expect(h2Ids).toContain("droid");
    expect(h2Ids.indexOf("gemini")).toBeLessThan(h2Ids.indexOf("opencode"));
    expect(h2Ids.indexOf("opencode")).toBeLessThan(h2Ids.indexOf("droid"));

    unmount();
  });

  test("应提供单份 opencode.json 示例，且包含 cch 端点与所有要求模型", () => {
    const { unmount } = renderWithIntl("en", <UsageDocContent origin="http://localhost:23000" />);

    const text = document.body.textContent || "";

    expect(text).toContain('"$schema": "https://opencode.ai/config.json"');
    expect(text).toContain('"baseURL": "http://localhost:23000/v1"');

    expect(text).toContain('"npm": "@ai-sdk/anthropic"');
    expect(text).toContain('"npm": "@ai-sdk/google"');
    expect(text).toContain('"npm": "@ai-sdk/openai"');
    expect(text).not.toContain("@ai-sdk/openai-compatible");

    expect(text).toContain("claude-haiku-4-5-20251001");
    expect(text).toContain("claude-sonnet-4-5-20250929");
    expect(text).toContain("claude-opus-4-5-20251101");

    expect(text).toContain('"model": "openai/gpt-5.2"');
    expect(text).toContain('"small_model": "openai/gpt-5.2-small"');

    expect(text).toContain("gpt-5.2");
    expect(text).toContain("gpt-5.2-small");
    expect(text).toContain('"reasoningEffort": "xhigh"');
    expect(text).toContain('"reasoningEffort": "medium"');
    expect(text).toContain('"store": false');
    expect(text).toContain('"setCacheKey": true');
    expect(text).toContain("reasoning.encrypted_content");

    expect(text).toContain("gemini-3-pro-preview");
    expect(text).toContain("gemini-3-flash-preview");
    expect(text).toContain('"baseURL": "http://localhost:23000/v1beta"');

    unmount();
  });

  test("应包含官方安装方式示例（curl/npm/bun/brew/paru，以及 Windows 包管理器）", () => {
    const { unmount } = renderWithIntl("en", <UsageDocContent origin="http://localhost:23000" />);

    const text = document.body.textContent || "";

    expect(text).toContain("curl -fsSL https://opencode.ai/install | bash");
    expect(text).toContain("npm install -g opencode-ai");
    expect(text).toContain("npm mirror registries");
    expect(text).toContain("bun add -g opencode-ai");
    expect(text).toContain("brew install anomalyco/tap/opencode");
    expect(text).toContain("paru -S opencode-bin");

    expect(text).toContain("choco install opencode");
    expect(text).toContain("scoop bucket add extras");
    expect(text).toContain("scoop install extras/opencode");

    unmount();
  });

  test("5 语言 messages/ 需包含 OpenCode 段落的关键翻译键", () => {
    for (const locale of locales) {
      const usageMessages = loadUsageMessages(locale);

      expect(usageMessages).toHaveProperty("opencode.title");
      expect(usageMessages).toHaveProperty("opencode.description");
      expect(usageMessages).toHaveProperty("opencode.installation.title");
      expect(usageMessages).toHaveProperty("opencode.installation.script.title");
      expect(usageMessages).toHaveProperty("opencode.installation.npm.title");
      expect(usageMessages).toHaveProperty("opencode.installation.npm.note");
      expect(usageMessages).toHaveProperty("opencode.installation.bun.title");
      expect(usageMessages).toHaveProperty("opencode.installation.macos.homebrew.title");
      expect(usageMessages).toHaveProperty("opencode.installation.linux.homebrew.title");
      expect(usageMessages).toHaveProperty("opencode.installation.linux.paru.title");
      expect(usageMessages).toHaveProperty("opencode.installation.windows.note");
      expect(usageMessages).toHaveProperty("opencode.configuration.title");
      expect(usageMessages).toHaveProperty("opencode.startup.title");
      expect(usageMessages).toHaveProperty("opencode.commonIssues.title");

      expect(usageMessages).toHaveProperty("layout.headerTitle");
      expect(usageMessages).toHaveProperty("layout.loginConsole");

      expect(usageMessages).toHaveProperty("placeholders.windowsUserName");
      expect(usageMessages).toHaveProperty("placeholders.shellConfig.linux");
      expect(usageMessages).toHaveProperty("placeholders.shellConfig.macos");
      expect(usageMessages).toHaveProperty("placeholders.codexVsCodeConfigFiles");

      expect(usageMessages).toHaveProperty("claudeCode.installation.nativeInstall.macos.curls");

      expect(usageMessages).toHaveProperty("snippets.comments.updateHomebrew");
      expect(usageMessages).toHaveProperty("snippets.comments.installNodeJs");
      expect(usageMessages).toHaveProperty("snippets.comments.ubuntuDebian");
      expect(usageMessages).toHaveProperty("snippets.comments.centosRhelFedora");
      expect(usageMessages).toHaveProperty("snippets.comments.addToPathIfMissing");
      expect(usageMessages).toHaveProperty("snippets.comments.checkEnvVar");
      expect(usageMessages).toHaveProperty("snippets.comments.testNetworkConnection");
    }
  });
});
