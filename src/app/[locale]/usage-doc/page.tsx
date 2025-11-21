"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TocNav, type TocItem } from "./_components/toc-nav";
import { QuickLinks } from "./_components/quick-links";

const headingClasses = {
  h2: "scroll-m-20 text-2xl font-semibold leading-snug text-foreground",
  h3: "scroll-m-20 mt-8 text-xl font-semibold leading-snug text-foreground",
  h4: "scroll-m-20 mt-6 text-lg font-semibold leading-snug text-foreground",
} as const;

interface CodeBlockProps {
  code: string;
  language: string;
}

function CodeBlock({ code, language }: CodeBlockProps) {
  const t = useTranslations("usage");

  return (
    <pre
      data-language={language}
      className="group relative my-5 overflow-x-auto rounded-md bg-black px-3 py-4 sm:px-4 sm:py-5 font-mono text-[11px] sm:text-[13px] text-white"
      role="region"
      aria-label={t("codeExamples.label", { language })}
      tabIndex={0}
    >
      <code className="block whitespace-pre leading-relaxed">{code.trim()}</code>
    </pre>
  );
}

/**
 * 操作系统类型
 */
type OS = "macos" | "windows" | "linux";

/**
 * CLI 工具配置
 */
interface CLIConfig {
  title: string;
  id: string;
  cliName: string;
  packageName?: string;
  officialInstallUrl?: { macos: string; windows: string };
  requiresOfficialLogin?: boolean;
  vsCodeExtension?: {
    name: string;
    configFile: string;
    configPath: Record<OS, string>;
  };
}

/**
 * 三个 CLI 工具的配置定义
 */
/**
 * Get CLI configurations with translated titles
 */
function getCLIConfigs(t: (key: string) => string): Record<string, CLIConfig> {
  return {
    claudeCode: {
      title: t("claudeCode.title"),
      id: "claude-code",
      cliName: "claude",
      packageName: "@anthropic-ai/claude-code",
      vsCodeExtension: {
        name: "Claude Code for VS Code",
        configFile: "config.json",
        configPath: {
          macos: "~/.claude",
          windows: "C:\\Users\\你的用户名\\.claude",
          linux: "~/.claude",
        },
      },
    },
    codex: {
      title: t("codex.title"),
      id: "codex",
      cliName: "codex",
      packageName: "@openai/codex",
      vsCodeExtension: {
        name: "Codex – OpenAI's coding agent",
        configFile: "config.toml 和 auth.json",
        configPath: {
          macos: "~/.codex",
          windows: "C:\\Users\\你的用户名\\.codex",
          linux: "~/.codex",
        },
      },
    },
    gemini: {
      title: t("gemini.title"),
      id: "gemini",
      cliName: "gemini",
      packageName: "@google/gemini-cli",
    },
    droid: {
      title: t("droid.title"),
      id: "droid",
      cliName: "droid",
      officialInstallUrl: {
        macos: "https://app.factory.ai/cli",
        windows: "https://app.factory.ai/cli/windows",
      },
      requiresOfficialLogin: true,
    },
  };
}

interface UsageDocContentProps {
  origin: string;
}

function UsageDocContent({ origin }: UsageDocContentProps) {
  const t = useTranslations("usage");
  const resolvedOrigin = origin || t("ui.currentSiteAddress");
  const CLI_CONFIGS = getCLIConfigs(t);

  /**
   * 渲染 Node.js 安装步骤
   */
  const renderNodeJsInstallation = (os: OS) => {
    if (os === "macos") {
      return (
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>{t("claudeCode.environmentSetup.macos.homebrew")}</h4>
          <CodeBlock
            language="bash"
            code={`# 更新 Homebrew
brew update
# 安装 Node.js
brew install node`}
          />
          <h4 className={headingClasses.h4}>{t("claudeCode.environmentSetup.macos.official")}</h4>
          <ol className="list-decimal space-y-2 pl-6">
            <li>
              {t("claudeCode.environmentSetup.macos.officialSteps.0")}{" "}
              <a
                href="https://nodejs.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline"
              >
                https://nodejs.org/
              </a>
            </li>
            <li>{t("claudeCode.environmentSetup.macos.officialSteps.1")}</li>
            <li>{t("claudeCode.environmentSetup.macos.officialSteps.2")}</li>
          </ol>
        </div>
      );
    } else if (os === "windows") {
      return (
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>{t("claudeCode.environmentSetup.windows.official")}</h4>
          <ol className="list-decimal space-y-2 pl-6">
            <li>
              {t("claudeCode.environmentSetup.windows.officialSteps.0")}{" "}
              <a
                href="https://nodejs.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline"
              >
                https://nodejs.org/
              </a>
            </li>
            <li>{t("claudeCode.environmentSetup.windows.officialSteps.1")}</li>
            <li>{t("claudeCode.environmentSetup.windows.officialSteps.2")}</li>
          </ol>
          <h4 className={headingClasses.h4}>
            {t("claudeCode.environmentSetup.windows.packageManager")}
          </h4>
          <CodeBlock
            language="powershell"
            code={`# 使用 Chocolatey
choco install nodejs

# 或使用 Scoop
scoop install nodejs`}
          />
          <blockquote className="space-y-1 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">
              {t("claudeCode.installation.nativeInstall.tip")}
            </p>
            <p>{t("claudeCode.environmentSetup.windows.note")}</p>
          </blockquote>
        </div>
      );
    } else {
      // linux
      return (
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>{t("claudeCode.environmentSetup.linux.official")}</h4>
          <CodeBlock
            language="bash"
            code={`# 添加 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
# 安装 Node.js
sudo apt-get install -y nodejs`}
          />
          <h4 className={headingClasses.h4}>
            {t("claudeCode.environmentSetup.linux.packageManager")}
          </h4>
          <CodeBlock
            language="bash"
            code={`# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm

# CentOS/RHEL/Fedora
sudo dnf install nodejs npm`}
          />
        </div>
      );
    }
  };

  /**
   * 渲染验证 Node.js 安装
   */
  const renderNodeJsVerification = (os: OS) => {
    const lang = os === "windows" ? "powershell" : "bash";
    return (
      <div className="space-y-3">
        <p>{t("claudeCode.environmentSetup.verification.description")}</p>
        <CodeBlock
          language={lang}
          code={`node --version
npm --version`}
        />
        <p>{t("claudeCode.environmentSetup.verification.success")}</p>
      </div>
    );
  };

  /**
   * 渲染 Claude Code 安装
   */
  const renderClaudeCodeInstallation = (os: OS) => {
    const lang = os === "windows" ? "powershell" : "bash";

    return (
      <Tabs defaultValue="native" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="native">
            {t("claudeCode.installation.nativeInstall.title")}
          </TabsTrigger>
          <TabsTrigger value="npm">{t("claudeCode.installation.npmInstall.title")}</TabsTrigger>
        </TabsList>

        {/* Native Install 标签页 */}
        <TabsContent value="native" className="space-y-4 mt-4">
          <div className="space-y-3">
            <p>{t("claudeCode.installation.nativeInstall.description")}</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>{t("claudeCode.installation.nativeInstall.advantages.0")}</li>
              <li>{t("claudeCode.installation.nativeInstall.advantages.1")}</li>
              <li>{t("claudeCode.installation.nativeInstall.advantages.2")}</li>
            </ul>
          </div>

          {/* macOS 安装方式 */}
          {os === "macos" && (
            <div className="space-y-4">
              <div className="space-y-3">
                <p className="font-semibold text-foreground">
                  {t("claudeCode.installation.nativeInstall.macos.homebrew")}
                </p>
                <CodeBlock language="bash" code={`brew install --cask claude-code`} />
                <blockquote className="space-y-2 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
                  <p className="font-semibold text-foreground">
                    {t("claudeCode.installation.nativeInstall.macos.autoUpdate")}
                  </p>
                  <p className="text-sm">
                    {t("claudeCode.installation.nativeInstall.macos.autoUpdateText")}
                  </p>
                </blockquote>
              </div>

              <div className="space-y-3">
                <p className="font-semibold text-foreground">
                  {t("claudeCode.installation.nativeInstall.macos.curl")}
                </p>
                <CodeBlock
                  language="bash"
                  code={`# 安装稳定版（默认）
curl -fsSL https://claude.ai/install.sh | bash

# 安装最新版
curl -fsSL https://claude.ai/install.sh | bash -s latest

# 安装指定版本
curl -fsSL https://claude.ai/install.sh | bash -s 1.0.58`}
                />
              </div>
            </div>
          )}

          {/* Linux 安装方式 */}
          {os === "linux" && (
            <div className="space-y-4">
              <div className="space-y-3">
                <p className="font-semibold text-foreground">
                  {t("claudeCode.installation.nativeInstall.linux.curl")}
                </p>
                <CodeBlock
                  language="bash"
                  code={(
                    t.raw("claudeCode.installation.nativeInstall.linux.curls") as string[]
                  ).join("\n")}
                />
              </div>

              <blockquote className="space-y-2 rounded-lg border-l-2 border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3">
                <p className="font-semibold text-foreground">
                  {t("claudeCode.installation.nativeInstall.linux.alpine")}
                </p>
                <p className="text-sm">
                  {t("claudeCode.installation.nativeInstall.linux.alpineText")}
                </p>
                <CodeBlock
                  language="bash"
                  code={(
                    t.raw("claudeCode.installation.nativeInstall.linux.alpineCode") as string[]
                  ).join("\n")}
                />
              </blockquote>
            </div>
          )}

          {/* Windows 安装方式 */}
          {os === "windows" && (
            <div className="space-y-4">
              <div className="space-y-3">
                <p className="font-semibold text-foreground">
                  {t("claudeCode.installation.nativeInstall.windows.powershell")}
                </p>
                <CodeBlock
                  language="powershell"
                  code={(
                    t.raw("claudeCode.installation.nativeInstall.windows.powershells") as string[]
                  ).join("\n")}
                />
              </div>

              <div className="space-y-3">
                <p className="font-semibold text-foreground">
                  {t("claudeCode.installation.nativeInstall.windows.cmd")}
                </p>
                <CodeBlock
                  language="batch"
                  code={(
                    t.raw("claudeCode.installation.nativeInstall.windows.cmds") as string[]
                  ).join("\n")}
                />
              </div>
            </div>
          )}

          {/* 验证安装 */}
          <div className="space-y-3">
            <p className="font-semibold text-foreground">
              {t("claudeCode.installation.nativeInstall.verification.title")}
            </p>
            <p>{t("claudeCode.installation.nativeInstall.verification.description")}</p>
            <CodeBlock
              language={lang}
              code={t("claudeCode.installation.nativeInstall.verification.command")}
            />
            <p>{t("claudeCode.installation.nativeInstall.verification.success")}</p>
          </div>

          <blockquote className="space-y-2 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">
              {t("claudeCode.installation.nativeInstall.tip")}
            </p>
            <p className="text-sm">{t("claudeCode.installation.nativeInstall.tipText")}</p>
          </blockquote>
        </TabsContent>

        {/* NPM 标签页 */}
        <TabsContent value="npm" className="space-y-4 mt-4">
          <div className="space-y-3">
            <p>{t("claudeCode.installation.npmInstall.description")}</p>
          </div>

          <div className="space-y-3">
            <p className="font-semibold text-foreground">{t("claudeCode.installation.title")}</p>
            <CodeBlock language={lang} code={t("claudeCode.installation.npmInstall.command")} />
          </div>

          <blockquote className="space-y-2 rounded-lg border-l-2 border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3">
            <p className="font-semibold text-foreground">
              {t("claudeCode.installation.npmInstall.warning")}
            </p>
            <p className="text-sm">{t("claudeCode.installation.npmInstall.warningText")}</p>
          </blockquote>

          <div className="space-y-3">
            <p className="font-semibold text-foreground">
              {t("claudeCode.installation.npmInstall.verification.title")}
            </p>
            <CodeBlock
              language={lang}
              code={t("claudeCode.installation.nativeInstall.verification.command")}
            />
            <p>{t("claudeCode.installation.npmInstall.verification.success")}</p>
          </div>

          <div className="space-y-3">
            <p className="font-semibold text-foreground">
              {t("claudeCode.installation.npmInstall.migration.title")}
            </p>
            <p>{t("claudeCode.installation.npmInstall.migration.description")}</p>
            <CodeBlock
              language={lang}
              code={t("claudeCode.installation.npmInstall.migration.command")}
            />
            <p className="text-sm text-muted-foreground">
              {t("claudeCode.installation.npmInstall.migration.note")}
            </p>
          </div>
        </TabsContent>
      </Tabs>
    );
  };

  /**
   * 渲染 Claude Code 配置
   */
  const renderClaudeCodeConfiguration = (os: OS) => {
    const configPath =
      os === "windows"
        ? "C:\\Users\\你的用户名\\.claude\\settings.json"
        : "~/.claude/settings.json";
    const shellConfig =
      os === "linux"
        ? "~/.bashrc 或 ~/.zshrc"
        : os === "macos"
          ? "~/.zshrc 或 ~/.bash_profile"
          : "";

    return (
      <div className="space-y-4">
        <h4 className={headingClasses.h4}>{t("claudeCode.configuration.settingsJson.title")}</h4>
        <div className="space-y-3">
          <p>{t("claudeCode.configuration.settingsJson.description")}</p>
          <CodeBlock language="text" code={configPath} />
          <blockquote className="space-y-2 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">
              {t("claudeCode.configuration.settingsJson.pathNote")}
            </p>
            <ul className="list-disc space-y-1 pl-4">
              {(t.raw("claudeCode.configuration.settingsJson.paths") as string[]).map(
                (path: string, i: number) => (
                  <li key={i}>{path}</li>
                )
              )}
            </ul>
          </blockquote>
          <p>{t("claudeCode.configuration.settingsJson.instruction")}</p>
          <CodeBlock
            language="json"
            code={`{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-api-key-here",
    "ANTHROPIC_BASE_URL": "${resolvedOrigin}",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  },
  "permissions": {
    "allow": [],
    "deny": []
  }
}`}
          />
          <blockquote className="space-y-2 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">
              {t("claudeCode.configuration.settingsJson.important")}
            </p>
            <ul className="list-disc space-y-1 pl-4">
              {(t.raw("claudeCode.configuration.settingsJson.importantPoints") as string[]).map(
                (point: string, i: number) => (
                  <li key={i}>{point}</li>
                )
              )}
            </ul>
          </blockquote>
        </div>

        <h4 className={headingClasses.h4}>{t("claudeCode.configuration.envVars.title")}</h4>
        <div className="space-y-3">
          {os === "windows" ? (
            <>
              <p>{t("claudeCode.configuration.envVars.windows.temporary")}</p>
              <CodeBlock
                language="powershell"
                code={`$env:ANTHROPIC_BASE_URL = "${resolvedOrigin}"
$env:ANTHROPIC_AUTH_TOKEN = "your-api-key-here"`}
              />
              <p>{t("claudeCode.configuration.envVars.windows.permanent")}</p>
              <CodeBlock
                language="powershell"
                code={`[System.Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "${resolvedOrigin}", [System.EnvironmentVariableTarget]::User)
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", "your-api-key-here", [System.EnvironmentVariableTarget]::User)`}
              />
              <p className="text-sm text-muted-foreground">
                {t("claudeCode.configuration.envVars.windows.note")}
              </p>
            </>
          ) : (
            <>
              <p>{t("claudeCode.configuration.envVars.unix.temporary")}</p>
              <CodeBlock
                language="bash"
                code={`export ANTHROPIC_BASE_URL="${resolvedOrigin}"
export ANTHROPIC_AUTH_TOKEN="your-api-key-here"`}
              />
              <p>{t("claudeCode.configuration.envVars.unix.permanent")}</p>
              <p className="text-sm">
                {t("claudeCode.configuration.envVars.unix.permanentNote", { shellConfig })}
              </p>
              <CodeBlock
                language="bash"
                code={`echo 'export ANTHROPIC_BASE_URL="${resolvedOrigin}"' >> ${shellConfig.split(" ")[0]}
echo 'export ANTHROPIC_AUTH_TOKEN="your-api-key-here"' >> ${shellConfig.split(" ")[0]}
source ${shellConfig.split(" ")[0]}`}
              />
            </>
          )}
        </div>

        <h4 className={headingClasses.h4}>{t("claudeCode.configuration.verification.title")}</h4>
        <div className="space-y-3">
          <p>{t("claudeCode.configuration.verification.description")}</p>
          {os === "windows" ? (
            <>
              <p>{t("claudeCode.configuration.verification.windowsPowerShell")}</p>
              <CodeBlock
                language="powershell"
                code={`echo $env:ANTHROPIC_BASE_URL
echo $env:ANTHROPIC_AUTH_TOKEN`}
              />
              <p>{t("claudeCode.configuration.verification.windowsCmd")}</p>
              <CodeBlock
                language="cmd"
                code={`echo %ANTHROPIC_BASE_URL%
echo %ANTHROPIC_AUTH_TOKEN%`}
              />
            </>
          ) : (
            <CodeBlock
              language="bash"
              code={`echo $ANTHROPIC_BASE_URL
echo $ANTHROPIC_AUTH_TOKEN`}
            />
          )}
          <p>{t("claudeCode.configuration.verification.expectedOutput")}</p>
          <CodeBlock
            language="text"
            code={`${resolvedOrigin}
sk_xxxxxxxxxxxxxxxxxx`}
          />
          <blockquote className="space-y-2 rounded-lg border-l-2 border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3">
            <p className="font-semibold text-foreground">
              {t("claudeCode.configuration.verification.note")}
            </p>
            <p>{t("claudeCode.configuration.verification.noteText")}</p>
          </blockquote>
        </div>
      </div>
    );
  };

  /**
   * 渲染 Codex 安装
   */
  const renderCodexInstallation = (os: OS) => {
    const lang = os === "windows" ? "powershell" : "bash";
    const adminNote = os === "windows" ? t("codex.installation.adminNote") : "";

    return (
      <div className="space-y-3">
        <p>
          {adminNote}
          {t("codex.installation.instruction")}
        </p>
        <CodeBlock
          language={lang}
          code={`npm i -g @openai/codex --registry=https://registry.npmmirror.com`}
        />
        <p>{t("codex.installation.verification")}</p>
        <CodeBlock language={lang} code={t("codex.installation.command")} />
      </div>
    );
  };

  /**
   * 渲染 Codex 配置
   */
  const renderCodexConfiguration = (os: OS) => {
    const configPath = os === "windows" ? "C:\\Users\\你的用户名\\.codex" : "~/.codex";
    const shellConfig =
      os === "linux"
        ? "~/.bashrc 或 ~/.zshrc"
        : os === "macos"
          ? "~/.zshrc 或 ~/.bash_profile"
          : "";

    return (
      <div className="space-y-4">
        <h4 className={headingClasses.h4}>{t("codex.configuration.configFile.title")}</h4>
        <div className="space-y-3">
          <ol className="list-decimal space-y-2 pl-6">
            {(t.raw("codex.configuration.configFile.steps") as string[]).map(
              (step: string, i: number) => (
                <li key={i}>{step.replace("${configPath}", configPath)}</li>
              )
            )}
          </ol>
          <CodeBlock
            language="toml"
            code={`model_provider = "cch"
model = "gpt-5.1-codex"
model_reasoning_effort = "high"
disable_response_storage = true
sandbox_mode = "workspace-write"
${os === "windows" ? "windows_wsl_setup_acknowledged = true\n" : ""}
[features]
plan_tool = true
apply_patch_freeform = true
view_image_tool = true
web_search_request = true
unified_exec = false
streamable_shell = false
rmcp_client = true

[model_providers.cch]
name = "cch"
base_url = "${resolvedOrigin}/v1"
wire_api = "responses"
env_key = "CCH_API_KEY"
requires_openai_auth = true

[sandbox_workspace_write]
network_access = true`}
          />
          <ol className="list-decimal space-y-2 pl-6" start={4}>
            <li>{t("codex.configuration.configFile.step4")}</li>
          </ol>
          <CodeBlock
            language="json"
            code={`{
  "OPENAI_API_KEY": "your-api-key-here"
}`}
          />
          <blockquote className="space-y-2 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">
              {t("codex.configuration.configFile.important")}
            </p>
            <ul className="list-disc space-y-2 pl-4">
              {(t.raw("codex.configuration.configFile.importantPoints") as string[]).map(
                (point: string, i: number) => (
                  <li key={i}>{point}</li>
                )
              )}
            </ul>
          </blockquote>
        </div>

        <h4 className={headingClasses.h4}>{t("codex.configuration.envVars.title")}</h4>
        <div className="space-y-3">
          {os === "windows" ? (
            <>
              <p>{t("codex.configuration.envVars.windows.instruction")}</p>
              <CodeBlock
                language="powershell"
                code={`[System.Environment]::SetEnvironmentVariable("CCH_API_KEY", "your-api-key-here", [System.EnvironmentVariableTarget]::User)`}
              />
              <p className="text-sm text-muted-foreground">
                {t("codex.configuration.envVars.windows.note")}
              </p>
            </>
          ) : (
            <>
              <p>{t("codex.configuration.envVars.unix.instruction")}</p>
              <CodeBlock
                language="bash"
                code={`echo 'export CCH_API_KEY="your-api-key-here"' >> ${shellConfig.split(" ")[0]}
source ${shellConfig.split(" ")[0]}`}
              />
            </>
          )}
        </div>
      </div>
    );
  };

  /**
   * 渲染 Gemini CLI 安装
   */
  const renderGeminiInstallation = (os: OS) => {
    const lang = os === "windows" ? "powershell" : "bash";

    return (
      <div className="space-y-3">
        <p>{t("gemini.installation.instruction")}</p>
        <CodeBlock language={lang} code={t("gemini.installation.command")} />
        <p>{t("gemini.installation.verification")}</p>
        <CodeBlock language={lang} code={t("gemini.installation.verificationCommand")} />
      </div>
    );
  };

  /**
   * 渲染 Gemini CLI 配置
   */
  const renderGeminiConfiguration = (os: OS) => {
    const configPath = os === "windows" ? "%USERPROFILE%\\.gemini" : "~/.gemini";
    const shellConfig =
      os === "linux"
        ? "~/.bashrc 或 ~/.zshrc"
        : os === "macos"
          ? "~/.zshrc 或 ~/.bash_profile"
          : "";

    return (
      <div className="space-y-4">
        <h4 className={headingClasses.h4}>{t("gemini.configuration.configFile.title")}</h4>
        <div className="space-y-3">
          {/* 创建配置目录 */}
          <h5 className="font-semibold text-foreground">
            {t("gemini.configuration.configFile.step1.title")}
          </h5>
          <p>{t("gemini.configuration.configFile.step1.description")}</p>

          {os === "windows" ? (
            <>
              <p>{t("gemini.configuration.configFile.step1.windows")}</p>
              <CodeBlock language="powershell" code={`mkdir $env:USERPROFILE\\.gemini`} />
            </>
          ) : (
            <>
              <p>{t("gemini.configuration.configFile.step1.macosLinux")}</p>
              <CodeBlock language="bash" code={`mkdir -p ~/.gemini`} />
            </>
          )}

          {/* 创建 .env 配置文件 */}
          <h5 className="font-semibold text-foreground">
            {t("gemini.configuration.configFile.step2.title")}
          </h5>
          <p>{t("gemini.configuration.configFile.step2.description")}</p>
          {os === "windows" ? (
            <p>{t("gemini.configuration.configFile.step2.windowsInstruction")}</p>
          ) : (
            <>
              <p>{t("gemini.configuration.configFile.step2.macosLinuxInstruction")}</p>
              <CodeBlock language="bash" code={`nano ~/.gemini/.env`} />
            </>
          )}
          <p>{t("gemini.configuration.configFile.step2.content")}</p>
          <CodeBlock
            language="bash"
            code={`GOOGLE_GEMINI_BASE_URL=${resolvedOrigin}
GEMINI_API_KEY=your-api-key-here
GEMINI_MODEL=gemini-3-pro-preview`}
          />

          {/* 创建 settings.json 配置文件 */}
          <h5 className="font-semibold text-foreground">
            {t("gemini.configuration.configFile.step3.title")}
          </h5>
          <p>{t("gemini.configuration.configFile.step3.description")}</p>
          <CodeBlock
            language="json"
            code={`{
  "ide": {
    "enabled": true
  },
  "security": {
    "auth": {
      "selectedType": "gemini-api-key"
    }
  }
}`}
          />
          <p>{t("gemini.configuration.configFile.step3.content")}</p>

          {/* 参数说明 */}
          <blockquote className="space-y-2 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">
              {t("gemini.configuration.configFile.parameterNote")}
            </p>
            <ul className="list-disc space-y-1 pl-4">
              {(t.raw("gemini.configuration.configFile.parameters") as string[]).map(
                (param: string, i: number) => (
                  <li key={i}>{param}</li>
                )
              )}
            </ul>
          </blockquote>

          {/* 重要提示 */}
          <blockquote className="space-y-2 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">
              {t("gemini.configuration.configFile.important")}
            </p>
            <ul className="list-disc space-y-1 pl-4">
              {(t.raw("gemini.configuration.configFile.importantPoints") as string[]).map(
                (point: string, i: number) => (
                  <li key={i}>{point}</li>
                )
              )}
            </ul>
          </blockquote>
        </div>

        <h4 className={headingClasses.h4}>{t("gemini.configuration.envVars.title")}</h4>
        <div className="space-y-3">
          <p>{t("gemini.configuration.envVars.description")}</p>
          {os === "windows" ? (
            <>
              <p>{t("gemini.configuration.envVars.windows.powershell")}</p>
              <CodeBlock
                language="powershell"
                code={`$env:GOOGLE_GEMINI_BASE_URL="${resolvedOrigin}"
$env:GEMINI_API_KEY="your-api-key-here"
$env:GEMINI_MODEL="gemini-2.5-pro"`}
              />
              <p>{t("gemini.configuration.envVars.windows.cmd")}</p>
              <CodeBlock
                language="cmd"
                code={`set GOOGLE_GEMINI_BASE_URL=${resolvedOrigin}
set GEMINI_API_KEY=your-api-key-here
set GEMINI_MODEL=gemini-3-pro-preview`}
              />
              <p className="text-sm text-muted-foreground">
                {t("gemini.configuration.envVars.windows.note")}
              </p>
            </>
          ) : (
            <>
              <p>{t("gemini.configuration.envVars.macosLinux.title")}</p>
              <CodeBlock
                language="bash"
                code={`export GOOGLE_GEMINI_BASE_URL="${resolvedOrigin}"
export GEMINI_API_KEY="your-api-key-here"
export GEMINI_MODEL="gemini-2.5-pro"`}
              />
              <p className="text-sm text-muted-foreground">
                {t("gemini.configuration.envVars.macosLinux.note")}
              </p>
            </>
          )}
        </div>

        {/* 启动和验证 */}
        <h4 className={headingClasses.h4}>{t("gemini.startup.title")}</h4>
        <div className="space-y-3">
          <h5 className="font-semibold text-foreground">{t("gemini.startup.startCli.title")}</h5>
          <p>{t("gemini.startup.startCli.description")}</p>
          <CodeBlock
            language={os === "windows" ? "powershell" : "bash"}
            code={`cd ${os === "windows" ? "C:\\path\\to\\your\\project" : "/path/to/your/project"}
gemini`}
          />
          <p>{t("gemini.startup.startCli.note")}</p>

          <h5 className="font-semibold text-foreground">
            {t("gemini.startup.verification.title")}
          </h5>
          <p>{t("gemini.startup.verification.description")}</p>
          <CodeBlock language="text" code={t("gemini.startup.verification.testCommand")} />
          <p>{t("gemini.startup.verification.success")}</p>

          <h5 className="font-semibold text-foreground">{t("gemini.startup.agentMode.title")}</h5>
          <p>{t("gemini.startup.agentMode.description")}</p>
          <CodeBlock
            language={os === "windows" ? "powershell" : "bash"}
            code={t("gemini.startup.agentMode.command")}
          />
          <p>{t("gemini.startup.agentMode.features")}</p>
          <ul className="list-disc space-y-1 pl-6">
            {(t.raw("gemini.startup.agentMode.featureList") as string[]).map(
              (feature: string, i: number) => (
                <li key={i}>{feature}</li>
              )
            )}
          </ul>
        </div>
      </div>
    );
  };

  /**
   * 渲染 Droid 安装
   */
  const renderDroidInstallation = (os: OS) => {
    if (os === "macos" || os === "linux") {
      return (
        <div className="space-y-3">
          <p>{t("droid.installation.linux.instruction")}</p>
          <CodeBlock language="bash" code={`curl -fsSL https://app.factory.ai/cli | sh`} />
          {os === "linux" && (
            <blockquote className="space-y-1 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
              <p className="font-semibold text-foreground">
                {t("claudeCode.installation.nativeInstall.tip")}
              </p>
              <p>{t("droid.installation.linux.note")}</p>
              <CodeBlock language="bash" code={t("droid.installation.linux.command")} />
            </blockquote>
          )}
        </div>
      );
    } else {
      // windows
      return (
        <div className="space-y-3">
          <p>{t("droid.installation.windows.instruction")}</p>
          <CodeBlock language="powershell" code={`irm https://app.factory.ai/cli/windows | iex`} />
        </div>
      );
    }
  };

  /**
   * 渲染 Droid 配置
   */
  const renderDroidConfiguration = (os: OS) => {
    const configPath =
      os === "windows" ? "%USERPROFILE%\\.factory\\config.json" : "~/.factory/config.json";

    return (
      <div className="space-y-4">
        <blockquote className="space-y-2 rounded-lg border-l-2 border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3">
          <p className="font-semibold text-foreground">{t("droid.configuration.prerequisite")}</p>
          <ol className="list-decimal space-y-2 pl-4">
            {(t.raw("droid.configuration.prerequisiteSteps") as string[]).map(
              (step: string, i: number) => (
                <li key={i}>{step}</li>
              )
            )}
          </ol>
        </blockquote>

        <h4 className={headingClasses.h4}>{t("droid.configuration.customModels.title")}</h4>
        <div className="space-y-3">
          <p>{t("droid.configuration.customModels.path")}</p>
          <CodeBlock language={os === "windows" ? "powershell" : "bash"} code={configPath} />
          <p>{t("droid.configuration.customModels.instruction")}</p>
          <CodeBlock
            language="json"
            code={`{
  "custom_models": [
    {
      "model_display_name": "Sonnet 4.5 [cch]",
      "model": "claude-sonnet-4-5-20250929",
      "base_url": "${resolvedOrigin}",
      "api_key": "your-api-key-here",
      "provider": "anthropic"
    },
    {
      "model_display_name": "GPT-5-Codex [cch]",
      "model": "gpt-5-codex",
      "base_url": "${resolvedOrigin}/v1",
      "api_key": "your-api-key-here",
      "provider": "openai"
    }
  ]
}`}
          />
          <blockquote className="space-y-2 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">
              {t("droid.configuration.customModels.important")}
            </p>
            <ul className="list-disc space-y-2 pl-4">
              {(t.raw("droid.configuration.customModels.importantPoints") as string[]).map(
                (point: string, i: number) => (
                  <li key={i}>{point.replace("${resolvedOrigin}", resolvedOrigin)}</li>
                )
              )}
            </ul>
          </blockquote>
        </div>

        <h4 className={headingClasses.h4}>{t("droid.configuration.switching.title")}</h4>
        <div className="space-y-3">
          <ol className="list-decimal space-y-2 pl-6">
            {(t.raw("droid.configuration.switching.steps") as string[]).map(
              (step: string, i: number) => (
                <li key={i}>{step}</li>
              )
            )}
          </ol>
        </div>
      </div>
    );
  };

  /**
   * 渲染 VS Code 扩展配置
   */
  const renderVSCodeExtension = (cli: CLIConfig, os: OS) => {
    const config = cli.vsCodeExtension;
    if (!config) return null;

    const resolvedConfigPath = config.configPath[os];
    if (cli.id === "claude-code") {
      return (
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>{t("claudeCode.vsCodeExtension.title")}</h4>
          <p className="text-sm text-muted-foreground">
            {t("claudeCode.vsCodeExtension.configPath", { path: resolvedConfigPath })}
          </p>
          <ol className="list-decimal space-y-2 pl-6">
            {(t.raw("claudeCode.vsCodeExtension.steps") as string[]).map(
              (step: string, i: number) => (
                <li key={i}>{step}</li>
              )
            )}
          </ol>
          <CodeBlock
            language="jsonc"
            code={`// Path: ${resolvedConfigPath}
{
  "primaryApiKey": "any-value"
}`}
          />
          <blockquote className="space-y-1 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">{t("claudeCode.vsCodeExtension.note")}</p>
            <ul className="list-disc space-y-1 pl-4">
              {(t.raw("claudeCode.vsCodeExtension.notePoints") as string[]).map(
                (point: string, i: number) => (
                  <li key={i}>{point}</li>
                )
              )}
            </ul>
          </blockquote>
        </div>
      );
    } else {
      // codex
      return (
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>{t("codex.vsCodeExtension.title")}</h4>
          <ol className="list-decimal space-y-2 pl-6">
            {(t.raw("codex.vsCodeExtension.steps") as string[]).map((step: string, i: number) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <blockquote className="space-y-1 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">{t("codex.vsCodeExtension.important")}</p>
            <p>{t("codex.vsCodeExtension.importantText")}</p>
          </blockquote>
        </div>
      );
    }
  };

  /**
   * 渲染启动与验证
   */
  const renderStartupVerification = (cli: CLIConfig, os: OS) => {
    // Gemini 的启动和验证已经集成在 renderGeminiConfiguration 中
    if (cli.id === "gemini") {
      return null;
    }

    const lang = os === "windows" ? "powershell" : "bash";
    const titleKey =
      cli.id === "claude-code"
        ? "claudeCode.startup.title"
        : cli.id === "codex"
          ? "codex.startup.title"
          : "droid.startup.title";
    const descKey =
      cli.id === "claude-code"
        ? "claudeCode.startup.description"
        : cli.id === "codex"
          ? "codex.startup.description"
          : "droid.startup.description";
    const initKey =
      cli.id === "claude-code"
        ? "claudeCode.startup.initNote"
        : cli.id === "codex"
          ? "codex.startup.initNote"
          : "droid.startup.initNote";

    return (
      <div className="space-y-3">
        <h4 className={headingClasses.h4}>{t(titleKey)}</h4>
        <p>{t(descKey)}</p>
        <CodeBlock
          language={lang}
          code={`cd ${os === "windows" ? "C:\\path\\to\\your\\project" : "/path/to/your/project"}
${cli.cliName}`}
        />
        <p>{t(initKey)}</p>
      </div>
    );
  };

  /**
   * 渲染常见问题
   */
  const renderCommonIssues = (cli: CLIConfig, os: OS) => {
    const lang = os === "windows" ? "powershell" : "bash";
    const titleKey =
      cli.id === "claude-code"
        ? "claudeCode.commonIssues.title"
        : cli.id === "codex"
          ? "codex.commonIssues.title"
          : cli.id === "gemini"
            ? "gemini.commonIssues.title"
            : "droid.commonIssues.title";
    const cmdNotFoundKey =
      cli.id === "claude-code"
        ? "claudeCode.commonIssues.commandNotFound"
        : cli.id === "codex"
          ? "codex.commonIssues.commandNotFound"
          : cli.id === "gemini"
            ? "gemini.commonIssues.commandNotFound"
            : "droid.commonIssues.commandNotFound";
    const cmdNotFoundWinKey =
      cli.id === "claude-code"
        ? "claudeCode.commonIssues.commandNotFoundWindows"
        : cli.id === "codex"
          ? "codex.commonIssues.commandNotFoundWindows"
          : cli.id === "gemini"
            ? "gemini.commonIssues.commandNotFoundWindows"
            : "droid.commonIssues.commandNotFoundWindows";
    const cmdNotFoundUnixKey =
      cli.id === "claude-code"
        ? "claudeCode.commonIssues.commandNotFoundUnix"
        : cli.id === "codex"
          ? "codex.commonIssues.commandNotFoundUnix"
          : cli.id === "gemini"
            ? "gemini.commonIssues.commandNotFoundUnix"
            : "droid.commonIssues.commandNotFoundUnix";
    const connFailedKey =
      cli.id === "claude-code"
        ? "claudeCode.commonIssues.connectionFailed"
        : cli.id === "gemini"
          ? "gemini.commonIssues.connectionFailed"
          : "codex.commonIssues.connectionFailed";
    const updateKey =
      cli.id === "claude-code"
        ? "claudeCode.commonIssues.updateCli"
        : cli.id === "codex"
          ? "codex.commonIssues.updateCli"
          : cli.id === "gemini"
            ? "gemini.commonIssues.updateCli"
            : "droid.commonIssues.updateCli";

    return (
      <div className="space-y-4">
        <h4 className={headingClasses.h4}>{t(titleKey)}</h4>

        <div className="space-y-3">
          <p className="font-semibold text-foreground">{t(cmdNotFoundKey)}</p>
          {os === "windows" ? (
            <ul className="list-disc space-y-2 pl-6">
              {(t.raw(cmdNotFoundWinKey) as string[]).map((item: string, i: number) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            <CodeBlock
              language="bash"
              code={`# ${t(cmdNotFoundUnixKey)}
npm config get prefix

# 添加到 PATH（如果不在）
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.${os === "macos" ? "zshrc" : "bashrc"}
source ~/.${os === "macos" ? "zshrc" : "bashrc"}`}
            />
          )}
        </div>

        {cli.id !== "droid" && (
          <div className="space-y-3">
            <p className="font-semibold text-foreground">{t(connFailedKey)}</p>
            {cli.id === "gemini" ? (
              // Gemini 特殊处理，显示 connectionSteps
              <ul className="list-disc space-y-2 pl-6">
                {(t.raw("gemini.commonIssues.connectionSteps") as string[]).map(
                  (step: string, i: number) => (
                    <li key={i}>{step}</li>
                  )
                )}
              </ul>
            ) : os === "windows" ? (
              <CodeBlock
                language="powershell"
                code={`# 检查环境变量
echo $env:${cli.id === "codex" ? "CCH_API_KEY" : "ANTHROPIC_AUTH_TOKEN"}

# 测试网络连接
Test-NetConnection -ComputerName ${resolvedOrigin.replace("https://", "").replace("http://", "")} -Port 443`}
              />
            ) : (
              <CodeBlock
                language="bash"
                code={`# 检查环境变量
echo $${cli.id === "codex" ? "CCH_API_KEY" : "ANTHROPIC_AUTH_TOKEN"}

# 测试网络连接
curl -I ${resolvedOrigin}`}
              />
            )}
          </div>
        )}

        <div className="space-y-3">
          <p className="font-semibold text-foreground">{t(updateKey)}</p>
          {cli.packageName ? (
            cli.id === "codex" ? (
              <CodeBlock language={lang} code={t("codex.commonIssues.updateCommand")} />
            ) : cli.id === "gemini" ? (
              <CodeBlock language={lang} code={t("gemini.commonIssues.updateCommand")} />
            ) : (
              <CodeBlock language={lang} code={`npm install -g ${cli.packageName}`} />
            )
          ) : (
            <p>{t("claudeCode.commonIssues.updateNote")}</p>
          )}
        </div>
      </div>
    );
  };

  /**
   * 渲染单个平台的完整指南
   */
  const renderPlatformGuide = (cli: CLIConfig, os: OS) => {
    const osNames = {
      macos: t("platforms.macos"),
      windows: t("platforms.windows"),
      linux: t("platforms.linux"),
    };

    return (
      <div key={`${cli.id}-${os}`} className="space-y-6">
        <h3 id={`${cli.id}-${os}`} className={headingClasses.h3}>
          {osNames[os]}
        </h3>

        {/* 环境准备 */}
        {cli.packageName && (
          <div className="space-y-3">
            <h4 className={headingClasses.h4}>{t("claudeCode.environmentSetup.title")}</h4>
            <p>{t("claudeCode.environmentSetup.description")}</p>
            {renderNodeJsInstallation(os)}
            {renderNodeJsVerification(os)}
          </div>
        )}

        {/* CLI 安装 */}
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>
            {cli.id === "claude-code"
              ? t("claudeCode.installation.title")
              : cli.id === "codex"
                ? t("codex.installation.title")
                : cli.id === "gemini"
                  ? t("gemini.installation.title")
                  : t("droid.installation.title")}{" "}
            {cli.cliName}
          </h4>
          {cli.id === "claude-code" && renderClaudeCodeInstallation(os)}
          {cli.id === "codex" && renderCodexInstallation(os)}
          {cli.id === "gemini" && renderGeminiInstallation(os)}
          {cli.id === "droid" && renderDroidInstallation(os)}
        </div>

        {/* 连接 cch 服务配置 */}
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>
            {cli.id === "claude-code"
              ? t("claudeCode.configuration.title")
              : cli.id === "codex"
                ? t("codex.configuration.title")
                : cli.id === "gemini"
                  ? t("gemini.configuration.title")
                  : t("droid.configuration.title")}
          </h4>
          {cli.id === "claude-code" && renderClaudeCodeConfiguration(os)}
          {cli.id === "codex" && renderCodexConfiguration(os)}
          {cli.id === "gemini" && renderGeminiConfiguration(os)}
          {cli.id === "droid" && renderDroidConfiguration(os)}
        </div>

        {/* VS Code 扩展配置 */}
        {(cli.id === "claude-code" || cli.id === "codex") && renderVSCodeExtension(cli, os)}

        {/* 启动与验证 */}
        {renderStartupVerification(cli, os)}

        {/* 常见问题 */}
        {renderCommonIssues(cli, os)}
      </div>
    );
  };

  /**
   * 主渲染逻辑
   */
  return (
    <article className="space-y-12 text-[15px] leading-6 text-muted-foreground">
      {/* Claude Code 使用指南 */}
      <section className="space-y-6">
        <h2 id={CLI_CONFIGS.claudeCode.id} className={headingClasses.h2}>
          📚 {CLI_CONFIGS.claudeCode.title}
        </h2>
        <p>{t("claudeCode.description")}</p>
        {(["macos", "windows", "linux"] as OS[]).map((os) =>
          renderPlatformGuide(CLI_CONFIGS.claudeCode, os)
        )}
      </section>

      <hr className="border-border/60" />

      {/* Codex CLI 使用指南 */}
      <section className="space-y-6">
        <h2 id={CLI_CONFIGS.codex.id} className={headingClasses.h2}>
          📚 {CLI_CONFIGS.codex.title}
        </h2>
        <p>{t("codex.description")}</p>
        {(["macos", "windows", "linux"] as OS[]).map((os) =>
          renderPlatformGuide(CLI_CONFIGS.codex, os)
        )}
      </section>

      <hr className="border-border/60" />

      {/* Gemini CLI 使用指南 */}
      <section className="space-y-6">
        <h2 id={CLI_CONFIGS.gemini.id} className={headingClasses.h2}>
          📚 {CLI_CONFIGS.gemini.title}
        </h2>
        <p>{t("gemini.description")}</p>
        {(["macos", "windows", "linux"] as OS[]).map((os) =>
          renderPlatformGuide(CLI_CONFIGS.gemini, os)
        )}
      </section>

      <hr className="border-border/60" />

      {/* Droid CLI 使用指南 */}
      <section className="space-y-6">
        <h2 id={CLI_CONFIGS.droid.id} className={headingClasses.h2}>
          📚 {CLI_CONFIGS.droid.title}
        </h2>
        <p>{t("droid.description")}</p>
        {(["macos", "windows", "linux"] as OS[]).map((os) =>
          renderPlatformGuide(CLI_CONFIGS.droid, os)
        )}
      </section>

      <hr className="border-border/60" />

      {/* 常用命令 */}
      <section className="space-y-4">
        <h2 id="common-commands" className={headingClasses.h2}>
          📚 {t("commonCommands.title")}
        </h2>
        <p>{t("commonCommands.description")}</p>
        <ul className="list-disc space-y-2 pl-6">
          {(
            t.raw("commonCommands.commands") as Array<{ command: string; description: string }>
          ).map((cmd: { command: string; description: string }, i: number) => (
            <li key={i}>
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                {cmd.command}
              </code>{" "}
              - {cmd.description}
            </li>
          ))}
          <li>
            {t("commonCommands.moreCommands")}{" "}
            <a
              href="https://docs.claude.com/zh-CN/docs/claude-code/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-4 transition-colors hover:text-primary/80"
            >
              {t("commonCommands.moreCommands")}
            </a>
          </li>
        </ul>
      </section>

      {/* 通用故障排查 */}
      <section className="space-y-4">
        <h2 id="troubleshooting" className={headingClasses.h2}>
          🔍 {t("troubleshooting.title")}
        </h2>

        <div className="space-y-3">
          <p className="font-semibold text-foreground">
            {t("troubleshooting.installationFailed.title")}
          </p>
          <ul className="list-disc space-y-2 pl-6">
            {(t.raw("troubleshooting.installationFailed.steps") as string[]).map(
              (step: string, i: number) => (
                <li key={i}>{step}</li>
              )
            )}
          </ul>
        </div>

        <div className="space-y-3">
          <p className="font-semibold text-foreground">
            {t("troubleshooting.invalidApiKey.title")}
          </p>
          <ul className="list-disc space-y-2 pl-6">
            {(t.raw("troubleshooting.invalidApiKey.steps") as string[]).map(
              (step: string, i: number) => (
                <li key={i}>{step}</li>
              )
            )}
          </ul>
        </div>

        <div className="space-y-3">
          <p className="font-semibold text-foreground">
            {t("troubleshooting.endpointConfigError.title")}
          </p>
          <ul className="list-disc space-y-2 pl-6">
            {(t.raw("troubleshooting.endpointConfigError.points") as string[]).map(
              (point: string, i: number) => (
                <li key={i}>{point.replace("${resolvedOrigin}", resolvedOrigin)}</li>
              )
            )}
          </ul>
        </div>
      </section>
    </article>
  );
}

/**
 * 文档页面
 * 使用客户端组件渲染静态文档内容，并提供目录导航
 * 支持桌面端（sticky sidebar）和移动端（drawer）
 * 提供完整的无障碍支持（ARIA 标签、键盘导航、skip links）
 */
export default function UsageDocPage() {
  const t = useTranslations("usage");
  const [activeId, setActiveId] = useState<string>("");
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [tocReady, setTocReady] = useState(false);
  const [serviceOrigin, setServiceOrigin] = useState(
    () => (typeof window !== "undefined" && window.location.origin) || ""
  );
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setServiceOrigin(window.location.origin);
    // 检查是否已登录（通过检查 auth-token cookie）
    setIsLoggedIn(document.cookie.includes("auth-token="));
  }, []);

  // 生成目录并监听滚动
  useEffect(() => {
    // 获取所有标题
    const headings = document.querySelectorAll("h2, h3");
    const items: TocItem[] = [];

    headings.forEach((heading) => {
      // 为标题添加 id（如果没有的话）
      if (!heading.id) {
        heading.id = heading.textContent?.toLowerCase().replace(/\s+/g, "-") || "";
      }

      items.push({
        id: heading.id,
        text: heading.textContent || "",
        level: parseInt(heading.tagName[1]),
      });
    });

    setTocItems(items);
    setTocReady(true);

    // 监听滚动，高亮当前章节
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 100;

      for (const item of items) {
        const element = document.getElementById(item.id);
        if (element && element.offsetTop <= scrollPosition) {
          setActiveId(item.id);
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll(); // 初始化

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // 点击目录项滚动到对应位置
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const offsetTop = element.offsetTop - 80;
      window.scrollTo({
        top: offsetTop,
        behavior: "smooth",
      });
      // 移动端点击后关闭 Sheet
      setSheetOpen(false);
    }
  };

  return (
    <>
      {/* Skip Links - 无障碍支持 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        {t("skipLinks.mainContent")}
      </a>
      <a
        href="#toc-navigation"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-40 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        {t("skipLinks.tableOfContents")}
      </a>

      <div className="relative flex gap-6 lg:gap-8">
        {/* 左侧主文档 */}
        <div className="flex-1 min-w-0">
          {/* 文档容器 */}
          <div className="relative bg-card rounded-xl shadow-sm border p-4 sm:p-6 md:p-8 lg:p-12">
            {/* 文档内容 */}
            <main id="main-content" role={t("ui.main")} aria-label={t("ui.mainContent")}>
              <UsageDocContent origin={serviceOrigin} />
            </main>
          </div>
        </div>

        {/* 右侧目录导航 - 桌面端 */}
        <aside
          id="toc-navigation"
          className="hidden lg:block w-64 shrink-0"
          aria-label={t("navigation.pageNavigation")}
        >
          <div className="sticky top-24 space-y-4">
            <div className="bg-card rounded-lg border p-4">
              <h4 className="font-semibold text-sm mb-3">{t("navigation.tableOfContents")}</h4>
              <TocNav
                tocItems={tocItems}
                activeId={activeId}
                tocReady={tocReady}
                onItemClick={scrollToSection}
              />
            </div>

            {/* 快速操作 */}
            <div className="bg-card rounded-lg border p-4">
              <h4 className="font-semibold text-sm mb-3">{t("navigation.quickLinks")}</h4>
              <QuickLinks isLoggedIn={isLoggedIn} />
            </div>
          </div>
        </aside>

        {/* 移动端浮动导航按钮 */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button
              variant="default"
              size="icon"
              className="fixed bottom-6 right-6 z-40 lg:hidden shadow-lg"
              aria-label={t("navigation.openTableOfContents")}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[85vw] sm:w-[400px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{t("navigation.documentNavigation")}</SheetTitle>
            </SheetHeader>
            <div className="mt-6 space-y-6">
              <div>
                <h4 className="font-semibold text-sm mb-3">{t("navigation.tableOfContents")}</h4>
                <TocNav
                  tocItems={tocItems}
                  activeId={activeId}
                  tocReady={tocReady}
                  onItemClick={scrollToSection}
                />
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold text-sm mb-3">{t("navigation.quickLinks")}</h4>
                <QuickLinks isLoggedIn={isLoggedIn} onBackToTop={() => setSheetOpen(false)} />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
