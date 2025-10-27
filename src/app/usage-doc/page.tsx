"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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
  return (
    <pre
      data-language={language}
      className="group relative my-5 overflow-x-auto rounded-md bg-black px-3 py-4 sm:px-4 sm:py-5 font-mono text-[11px] sm:text-[13px] text-white"
      role="region"
      aria-label={`代码示例 - ${language}`}
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
    configPath: { macos: string; windows: string };
  };
}

/**
 * 三个 CLI 工具的配置定义
 */
const CLI_CONFIGS: Record<string, CLIConfig> = {
  claudeCode: {
    title: "Claude Code 使用指南",
    id: "claude-code",
    cliName: "claude",
    packageName: "@anthropic-ai/claude-code",
    vsCodeExtension: {
      name: "Claude Code for VS Code",
      configFile: "config.json",
      configPath: {
        macos: "~/.claude",
        windows: "C:\\Users\\你的用户名\\.claude",
      },
    },
  },
  codex: {
    title: "Codex CLI 使用指南",
    id: "codex",
    cliName: "codex",
    packageName: "@openai/codex",
    vsCodeExtension: {
      name: "Codex – OpenAI's coding agent",
      configFile: "config.toml 和 auth.json",
      configPath: {
        macos: "~/.codex",
        windows: "C:\\Users\\你的用户名\\.codex",
      },
    },
  },
  droid: {
    title: "Droid CLI 使用指南",
    id: "droid",
    cliName: "droid",
    officialInstallUrl: {
      macos: "https://app.factory.ai/cli",
      windows: "https://app.factory.ai/cli/windows",
    },
    requiresOfficialLogin: true,
  },
};

interface UsageDocContentProps {
  origin: string;
}

function UsageDocContent({ origin }: UsageDocContentProps) {
  const resolvedOrigin = origin || "当前站点地址";

  /**
   * 渲染 Node.js 安装步骤
   */
  const renderNodeJsInstallation = (os: OS) => {
    if (os === "macos") {
      return (
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>方法一：使用 Homebrew（推荐）</h4>
          <CodeBlock
            language="bash"
            code={`# 更新 Homebrew
brew update
# 安装 Node.js
brew install node`}
          />
          <h4 className={headingClasses.h4}>方法二：官网下载</h4>
          <ol className="list-decimal space-y-2 pl-6">
            <li>
              访问{" "}
              <a
                href="https://nodejs.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline"
              >
                https://nodejs.org/
              </a>
            </li>
            <li>下载适合 macOS 的 LTS 版本（需 v18 或更高）</li>
            <li>打开下载的 .pkg 文件，按照安装向导完成</li>
          </ol>
        </div>
      );
    } else if (os === "windows") {
      return (
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>方法一：官网下载（推荐）</h4>
          <ol className="list-decimal space-y-2 pl-6">
            <li>
              访问{" "}
              <a
                href="https://nodejs.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline"
              >
                https://nodejs.org/
              </a>
            </li>
            <li>下载 LTS 版本（需 v18 或更高）</li>
            <li>双击 .msi 文件，按向导安装（保持默认设置）</li>
          </ol>
          <h4 className={headingClasses.h4}>方法二：使用包管理器</h4>
          <CodeBlock
            language="powershell"
            code={`# 使用 Chocolatey
choco install nodejs

# 或使用 Scoop
scoop install nodejs`}
          />
          <blockquote className="space-y-1 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">提示</p>
            <p>建议使用 PowerShell 而不是 CMD，以获得更好的体验</p>
          </blockquote>
        </div>
      );
    } else {
      // linux
      return (
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>方法一：使用官方仓库（推荐）</h4>
          <CodeBlock
            language="bash"
            code={`# 添加 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
# 安装 Node.js
sudo apt-get install -y nodejs`}
          />
          <h4 className={headingClasses.h4}>方法二：使用系统包管理器</h4>
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
        <p>安装完成后，打开终端/命令行，输入以下命令验证：</p>
        <CodeBlock
          language={lang}
          code={`node --version
npm --version`}
        />
        <p>如果显示版本号，说明安装成功了！</p>
      </div>
    );
  };

  /**
   * 渲染 Claude Code 安装
   */
  const renderClaudeCodeInstallation = (os: OS) => {
    const lang = os === "windows" ? "powershell" : "bash";
    const sudoNote =
      os !== "windows"
        ? "\n\n如果遇到权限问题，可以使用 sudo：\n\nsudo npm install -g @anthropic-ai/claude-code"
        : "";

    return (
      <div className="space-y-3">
        <p>打开终端/命令行，运行以下命令：</p>
        <CodeBlock language={lang} code={`npm install -g @anthropic-ai/claude-code`} />
        {sudoNote && <p className="text-sm text-muted-foreground">提示：{sudoNote}</p>}
        <p>验证安装：</p>
        <CodeBlock language={lang} code={`claude --version`} />
        <p>如果显示版本号，恭喜！Claude Code 已成功安装。</p>
      </div>
    );
  };

  /**
   * 渲染 Claude Code 配置
   */
  const renderClaudeCodeConfiguration = (os: OS) => {
    const lang = os === "windows" ? "powershell" : "bash";
    const configPath =
      os === "windows" ? "%USERPROFILE%\\.claude\\settings.json" : "~/.claude/settings.json";
    const shellConfig =
      os === "linux"
        ? "~/.bashrc 或 ~/.zshrc"
        : os === "macos"
          ? "~/.zshrc 或 ~/.bash_profile"
          : "";

    return (
      <div className="space-y-4">
        <h4 className={headingClasses.h4}>方法一：settings.json 配置（推荐）</h4>
        <div className="space-y-3">
          <p>
            根据您的操作系统，在对应位置创建{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
              settings.json
            </code>{" "}
            文件：
          </p>
          <CodeBlock language={lang} code={configPath} />
          <p>添加以下配置内容：</p>
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
            <p className="font-semibold text-foreground">重要</p>
            <p>
              请将{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                your-api-key-here
              </code>{" "}
              替换为您的实际 API 密钥。
            </p>
            <p>密钥获取方式：登录控制台 → 设置 → API 密钥管理 → 创建密钥</p>
          </blockquote>
        </div>

        <h4 className={headingClasses.h4}>方法二：环境变量配置</h4>
        <div className="space-y-3">
          {os === "windows" ? (
            <>
              <p>临时设置（当前会话）：</p>
              <CodeBlock
                language="powershell"
                code={`$env:ANTHROPIC_BASE_URL = "${resolvedOrigin}"
$env:ANTHROPIC_AUTH_TOKEN = "your-api-key-here"`}
              />
              <p>永久设置（用户级）：</p>
              <CodeBlock
                language="powershell"
                code={`[System.Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "${resolvedOrigin}", [System.EnvironmentVariableTarget]::User)
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", "your-api-key-here", [System.EnvironmentVariableTarget]::User)`}
              />
              <p className="text-sm text-muted-foreground">
                设置后需要重新打开 PowerShell 窗口才能生效。
              </p>
            </>
          ) : (
            <>
              <p>临时设置（当前会话）：</p>
              <CodeBlock
                language="bash"
                code={`export ANTHROPIC_BASE_URL="${resolvedOrigin}"
export ANTHROPIC_AUTH_TOKEN="your-api-key-here"`}
              />
              <p>永久设置：</p>
              <p className="text-sm">添加到您的 shell 配置文件（{shellConfig}）：</p>
              <CodeBlock
                language="bash"
                code={`echo 'export ANTHROPIC_BASE_URL="${resolvedOrigin}"' >> ${shellConfig.split(" ")[0]}
echo 'export ANTHROPIC_AUTH_TOKEN="your-api-key-here"' >> ${shellConfig.split(" ")[0]}
source ${shellConfig.split(" ")[0]}`}
              />
            </>
          )}
        </div>
      </div>
    );
  };

  /**
   * 渲染 Codex 安装
   */
  const renderCodexInstallation = (os: OS) => {
    const lang = os === "windows" ? "powershell" : "bash";
    const adminNote = os === "windows" ? "以管理员身份运行 PowerShell，" : "";

    return (
      <div className="space-y-3">
        <p>{adminNote}执行：</p>
        <CodeBlock
          language={lang}
          code={`npm i -g @openai/codex --registry=https://registry.npmmirror.com`}
        />
        <p>验证安装：</p>
        <CodeBlock language={lang} code={`codex --version`} />
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
        <h4 className={headingClasses.h4}>方法一：配置文件方式（推荐）</h4>
        <div className="space-y-3">
          <ol className="list-decimal space-y-2 pl-6">
            <li>
              打开文件资源管理器，找到{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                {configPath}
              </code>{" "}
              文件夹（不存在则创建）
            </li>
            <li>
              创建{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                config.toml
              </code>{" "}
              文件
            </li>
            <li>使用文本编辑器打开，添加以下内容：</li>
          </ol>
          <CodeBlock
            language="toml"
            code={`model_provider = "cch"
model = "gpt-5-codex"
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

[tools]
web_search = true
view_image = true

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
            <li>
              创建{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                auth.json
              </code>{" "}
              文件，添加：
            </li>
          </ol>
          <CodeBlock
            language="json"
            code={`{
  "OPENAI_API_KEY": "your-api-key-here"
}`}
          />
          <blockquote className="space-y-2 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">重要提示</p>
            <ul className="list-disc space-y-2 pl-4">
              <li>
                将{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                  your-api-key-here
                </code>{" "}
                替换为您的 cch API 密钥
              </li>
              <li>
                <strong>注意：</strong>Codex 使用 OpenAI 兼容格式，端点包含{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">/v1</code>{" "}
                路径
              </li>
            </ul>
          </blockquote>
        </div>

        <h4 className={headingClasses.h4}>方法二：环境变量配置</h4>
        <div className="space-y-3">
          {os === "windows" ? (
            <>
              <p>在 PowerShell 中运行：</p>
              <CodeBlock
                language="powershell"
                code={`[System.Environment]::SetEnvironmentVariable("CCH_API_KEY", "your-api-key-here", [System.EnvironmentVariableTarget]::User)`}
              />
              <p className="text-sm text-muted-foreground">
                设置后需要重新打开 PowerShell 窗口才能生效。
              </p>
            </>
          ) : (
            <>
              <p>设置环境变量：</p>
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
   * 渲染 Droid 安装
   */
  const renderDroidInstallation = (os: OS) => {
    if (os === "macos" || os === "linux") {
      return (
        <div className="space-y-3">
          <CodeBlock language="bash" code={`curl -fsSL https://app.factory.ai/cli | sh`} />
          {os === "linux" && (
            <blockquote className="space-y-1 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
              <p className="font-semibold text-foreground">提示</p>
              <p>
                Linux 用户需确保已安装{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                  xdg-utils
                </code>
                ：
              </p>
              <CodeBlock language="bash" code={`sudo apt-get install xdg-utils`} />
            </blockquote>
          )}
        </div>
      );
    } else {
      // windows
      return (
        <div className="space-y-3">
          <p>在 PowerShell 中执行：</p>
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
          <p className="font-semibold text-foreground">前置步骤：必须先登录 Droid 官方账号</p>
          <ol className="list-decimal space-y-2 pl-4">
            <li>
              运行{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">droid</code>{" "}
              命令
            </li>
            <li>按提示通过浏览器登录 Factory 官方账号</li>
            <li>登录成功后，才能继续配置自定义模型</li>
          </ol>
        </blockquote>

        <h4 className={headingClasses.h4}>配置自定义模型</h4>
        <div className="space-y-3">
          <p>配置文件路径：</p>
          <CodeBlock language={os === "windows" ? "powershell" : "bash"} code={configPath} />
          <p>编辑配置文件，添加以下内容：</p>
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
            <p className="font-semibold text-foreground">重要说明</p>
            <ul className="list-disc space-y-2 pl-4">
              <li>
                将{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                  your-api-key-here
                </code>{" "}
                替换为您的 cch API 密钥
              </li>
              <li>
                <strong>Anthropic 格式：</strong>使用{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                  {resolvedOrigin}
                </code>
                （无 /v1）
              </li>
              <li>
                <strong>OpenAI 格式：</strong>使用{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                  {resolvedOrigin}/v1
                </code>
                （需要 /v1）
              </li>
            </ul>
          </blockquote>
        </div>

        <h4 className={headingClasses.h4}>切换模型</h4>
        <div className="space-y-3">
          <ol className="list-decimal space-y-2 pl-6">
            <li>重启 Droid</li>
            <li>
              输入{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">/model</code>{" "}
              命令
            </li>
            <li>
              选择 <strong>GPT-5-Codex [cch]</strong> 或 <strong>Sonnet 4.5 [cch]</strong>
            </li>
            <li>开始使用！</li>
          </ol>
        </div>
      </div>
    );
  };

  /**
   * 渲染 VS Code 扩展配置
   */
  const renderVSCodeExtension = (cli: "claudeCode" | "codex", os: OS) => {
    const config = CLI_CONFIGS[cli].vsCodeExtension;
    if (!config) return null;

    const configPath = config.configPath[os === "macos" ? "macos" : "windows"];

    if (cli === "claudeCode") {
      return (
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>VS Code 扩展配置</h4>
          <ol className="list-decimal space-y-2 pl-6">
            <li>
              在 VS Code 扩展中搜索并安装 <strong>{config.name}</strong>
            </li>
            <li>
              在{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                {configPath}
              </code>{" "}
              目录下创建{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                config.json
              </code>{" "}
              文件（如果没有）
            </li>
            <li>添加以下内容：</li>
          </ol>
          <CodeBlock
            language="json"
            code={`{
  "primaryApiKey": "any-value"
}`}
          />
          <blockquote className="space-y-1 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">注意</p>
            <p>
              是{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                config.json
              </code>
              ，不是{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                settings.json
              </code>
            </p>
            <p>
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                primaryApiKey
              </code>{" "}
              字段值可以为任意内容，只要存在即可
            </p>
          </blockquote>
        </div>
      );
    } else {
      // codex
      return (
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>VS Code 扩展配置</h4>
          <ol className="list-decimal space-y-2 pl-6">
            <li>
              在 VS Code 扩展中搜索并安装 <strong>{config.name}</strong>
            </li>
            <li>
              确保已按照上述步骤配置好{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                config.toml
              </code>{" "}
              和{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                auth.json
              </code>
            </li>
            <li>
              设置环境变量{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                CCH_API_KEY
              </code>
            </li>
          </ol>
          <blockquote className="space-y-1 rounded-lg border-l-2 border-primary/50 bg-muted/40 px-4 py-3">
            <p className="font-semibold text-foreground">重要</p>
            <p>
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">env_key</code>{" "}
              只能是环境变量名称（如 CCH_API_KEY），不能是完整的密钥
            </p>
            <p>如果直接填写密钥，会报错找不到令牌或令牌配置错误</p>
          </blockquote>
        </div>
      );
    }
  };

  /**
   * 渲染启动与验证
   */
  const renderStartupVerification = (cli: CLIConfig, os: OS) => {
    const lang = os === "windows" ? "powershell" : "bash";
    return (
      <div className="space-y-3">
        <h4 className={headingClasses.h4}>启动 {cli.cliName}</h4>
        <p>在项目目录下运行：</p>
        <CodeBlock
          language={lang}
          code={`cd ${os === "windows" ? "C:\\path\\to\\your\\project" : "/path/to/your/project"}
${cli.cliName}`}
        />
        <p>首次启动时，{cli.cliName} 会进行初始化配置。</p>
      </div>
    );
  };

  /**
   * 渲染常见问题
   */
  const renderCommonIssues = (cli: CLIConfig, os: OS) => {
    const lang = os === "windows" ? "powershell" : "bash";

    return (
      <div className="space-y-4">
        <h4 className={headingClasses.h4}>常见问题</h4>

        <div className="space-y-3">
          <p className="font-semibold text-foreground">1. 命令未找到</p>
          {os === "windows" ? (
            <ul className="list-disc space-y-2 pl-6">
              <li>
                确保 npm 全局路径（通常是{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                  C:\Users\你的用户名\AppData\Roaming\npm
                </code>
                ）已添加到系统 PATH
              </li>
              <li>重新打开 PowerShell 窗口</li>
            </ul>
          ) : (
            <>
              <CodeBlock
                language="bash"
                code={`# 检查 npm 全局安装路径
npm config get prefix

# 添加到 PATH（如果不在）
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.${os === "macos" ? "zshrc" : "bashrc"}
source ~/.${os === "macos" ? "zshrc" : "bashrc"}`}
              />
            </>
          )}
        </div>

        {cli.id !== "droid" && (
          <div className="space-y-3">
            <p className="font-semibold text-foreground">2. API 连接失败</p>
            {os === "windows" ? (
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
          <p className="font-semibold text-foreground">
            {cli.id === "droid" ? "2" : "3"}. 更新 {cli.cliName}
          </p>
          {cli.packageName ? (
            <CodeBlock
              language={lang}
              code={
                cli.id === "codex"
                  ? `npm i -g ${cli.packageName} --registry=https://registry.npmmirror.com`
                  : `npm install -g ${cli.packageName}`
              }
            />
          ) : (
            <p>重新运行安装脚本即可更新到最新版本。</p>
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
      macos: "macOS",
      windows: "Windows",
      linux: "Linux",
    };

    return (
      <div key={`${cli.id}-${os}`} className="space-y-6">
        <h3 id={`${cli.id}-${os}`} className={headingClasses.h3}>
          {osNames[os]}
        </h3>

        {/* 环境准备 */}
        {cli.packageName && (
          <div className="space-y-3">
            <h4 className={headingClasses.h4}>环境准备：安装 Node.js</h4>
            <p>{cli.cliName} 需要 Node.js 环境才能运行（需 v18 或更高版本）。</p>
            {renderNodeJsInstallation(os)}
            {renderNodeJsVerification(os)}
          </div>
        )}

        {/* CLI 安装 */}
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>安装 {cli.cliName}</h4>
          {cli.id === "claudeCode" && renderClaudeCodeInstallation(os)}
          {cli.id === "codex" && renderCodexInstallation(os)}
          {cli.id === "droid" && renderDroidInstallation(os)}
        </div>

        {/* 连接 cch 服务配置 */}
        <div className="space-y-3">
          <h4 className={headingClasses.h4}>连接 cch 服务</h4>
          {cli.id === "claudeCode" && renderClaudeCodeConfiguration(os)}
          {cli.id === "codex" && renderCodexConfiguration(os)}
          {cli.id === "droid" && renderDroidConfiguration(os)}
        </div>

        {/* VS Code 扩展配置 */}
        {(cli.id === "claudeCode" || cli.id === "codex") &&
          renderVSCodeExtension(cli.id as "claudeCode" | "codex", os)}

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
        <p>
          Claude Code 是 Anthropic 官方推出的 AI 编程助手，支持通过 cch
          代理服务使用。本指南将帮助您在不同操作系统上完成安装和配置。
        </p>
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
        <p>
          Codex 是 OpenAI 官方的命令行 AI 编程助手，支持通过 cch 代理使用。
          <strong className="text-foreground">
            {" "}
            注意：Codex 使用 OpenAI 兼容格式，端点需要包含 /v1 路径。
          </strong>
        </p>
        {(["macos", "windows", "linux"] as OS[]).map((os) =>
          renderPlatformGuide(CLI_CONFIGS.codex, os)
        )}
      </section>

      <hr className="border-border/60" />

      {/* Droid CLI 使用指南 */}
      <section className="space-y-6">
        <h2 id={CLI_CONFIGS.droid.id} className={headingClasses.h2}>
          📚 {CLI_CONFIGS.droid.title}
        </h2>
        <p>
          Droid 是 Factory AI 开发的交互式终端 AI 编程助手，支持通过 cch 代理服务使用。
          <strong className="text-foreground"> 使用前必须先注册并登录 Droid 官方账号。</strong>
        </p>
        {(["macos", "windows", "linux"] as OS[]).map((os) =>
          renderPlatformGuide(CLI_CONFIGS.droid, os)
        )}
      </section>

      <hr className="border-border/60" />

      {/* 常用命令 */}
      <section className="space-y-4">
        <h2 id="common-commands" className={headingClasses.h2}>
          📚 常用命令
        </h2>
        <p>启动 Claude Code 后，您可以使用以下常用命令：</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">/help</code> -
            查看帮助信息
          </li>
          <li>
            <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">/clear</code> -
            清空对话历史，开启新对话
          </li>
          <li>
            <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">/compact</code> -
            总结当前对话
          </li>
          <li>
            <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">/cost</code> -
            查看当前对话已使用的金额
          </li>
          <li>
            <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">/model</code> -
            切换模型（Droid 专用）
          </li>
          <li>
            更多命令查看{" "}
            <a
              href="https://docs.claude.com/zh-CN/docs/claude-code/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-4 transition-colors hover:text-primary/80"
            >
              官方文档
            </a>
          </li>
        </ul>
      </section>

      {/* 通用故障排查 */}
      <section className="space-y-4">
        <h2 id="troubleshooting" className={headingClasses.h2}>
          🔍 通用故障排查
        </h2>

        <div className="space-y-3">
          <p className="font-semibold text-foreground">安装失败</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>检查网络连接是否正常</li>
            <li>确保有管理员权限（Windows）或使用 sudo（macOS / Linux）</li>
            <li>尝试使用代理或镜像源（npm 可使用 --registry 参数）</li>
          </ul>
        </div>

        <div className="space-y-3">
          <p className="font-semibold text-foreground">API 密钥无效</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>确认密钥已正确复制（无多余空格）</li>
            <li>检查密钥是否在有效期内</li>
            <li>验证账户权限是否正常</li>
            <li>确认使用了正确的端点格式（Anthropic 无 /v1，OpenAI 有 /v1）</li>
          </ul>
        </div>

        <div className="space-y-3">
          <p className="font-semibold text-foreground">端点配置错误</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Claude Code / Droid Anthropic 模型：</strong>使用{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                {resolvedOrigin}
              </code>
              （无 /v1）
            </li>
            <li>
              <strong>Codex / Droid OpenAI 模型：</strong>使用{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                {resolvedOrigin}/v1
              </code>
              （必须包含 /v1）
            </li>
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
        跳转到主要内容
      </a>
      <a
        href="#toc-navigation"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-40 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        跳转到目录导航
      </a>

      <div className="relative flex gap-6 lg:gap-8">
        {/* 左侧主文档 */}
        <div className="flex-1 min-w-0">
          {/* 文档容器 */}
          <div className="relative bg-card rounded-xl shadow-sm border p-4 sm:p-6 md:p-8 lg:p-12">
            {/* 文档内容 */}
            <main id="main-content" role="main" aria-label="文档内容">
              <UsageDocContent origin={serviceOrigin} />
            </main>
          </div>
        </div>

        {/* 右侧目录导航 - 桌面端 */}
        <aside id="toc-navigation" className="hidden lg:block w-64 shrink-0" aria-label="页面导航">
          <div className="sticky top-24 space-y-4">
            <div className="bg-card rounded-lg border p-4">
              <h4 className="font-semibold text-sm mb-3">本页导航</h4>
              <TocNav
                tocItems={tocItems}
                activeId={activeId}
                tocReady={tocReady}
                onItemClick={scrollToSection}
              />
            </div>

            {/* 快速操作 */}
            <div className="bg-card rounded-lg border p-4">
              <h4 className="font-semibold text-sm mb-3">快速链接</h4>
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
              aria-label="打开目录导航"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[85vw] sm:w-[400px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>文档导航</SheetTitle>
            </SheetHeader>
            <div className="mt-6 space-y-6">
              <div>
                <h4 className="font-semibold text-sm mb-3">本页导航</h4>
                <TocNav
                  tocItems={tocItems}
                  activeId={activeId}
                  tocReady={tocReady}
                  onItemClick={scrollToSection}
                />
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold text-sm mb-3">快速链接</h4>
                <QuickLinks isLoggedIn={isLoggedIn} onBackToTop={() => setSheetOpen(false)} />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
