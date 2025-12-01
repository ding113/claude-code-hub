# 🤝 贡献指南 | CONTRIBUTING

> 🇺🇸 English version is provided after the Chinese section. Scroll to [English Contributing Guide](#english-contributing-guide) for the translation.

## 🔁 语言导航 | Language Navigation

- 🇨🇳 [中文贡献指南](#中文贡献指南)
- 🇺🇸 [English Contributing Guide](#english-contributing-guide)

## 🇨🇳 中文贡献指南

### 📚 中文目录

- [1. 介绍 Introduction](#1-介绍-introduction)
- [2. 行为准则 Code of Conduct](#2-行为准则-code-of-conduct)
- [3. 快速开始 Getting Started](#3-快速开始-getting-started)
- [4. 如何贡献 How to Contribute](#4-如何贡献-how-to-contribute)
- [5. 分支命名 Branch Naming](#5-分支命名-branch-naming)
- [6. 提交格式 Commit Format](#6-提交格式-commit-format)
- [7. 代码风格 Code Style](#7-代码风格-code-style)
- [8. 测试 Testing](#8-测试-testing)
- [9. PR 流程 PR Process](#9-pr-流程-pr-process)
- [10. 问题反馈 Issue Reporting](#10-问题反馈-issue-reporting)

### 1. 介绍 Introduction

Claude Code Hub 是一个面向团队的 AI API 代理平台，支持统一管理多家供应商、智能分流和现代化运维工具。本文档说明如何按照项目既定流程参与贡献，帮助你提交高质量的 Pull Request（PR）。

### 2. 行为准则 Code of Conduct

- 遵循友好、尊重和包容的沟通方式，参考 Contributor Covenant 2.1 精神。
- 尊重不同背景与观点，不得发布任何歧视、骚扰或攻击性言论。
- 讨论基于事实和数据，避免进行人身攻击。
- 社区交流渠道：GitHub Issues/Discussions 与 Telegram 群（见 README），通常会在 2 个工作日内回复。

### 3. 快速开始 Getting Started

1. 克隆仓库并安装依赖：
   ```bash
   git clone https://github.com/ding113/claude-code-hub.git
   cd claude-code-hub
   bun install
   ```
2. 复制并配置环境变量：
   ```bash
   cp .env.example .env
   ```
3. 本地启动：
   ```bash
   bun run dev
   ```
4. 需要容器化体验可参考 `README.md` 与 `.github/CI_CD_SETUP.md` 中的 Docker 流程。

### 4. 如何贡献 How to Contribute

> ⚠️ 重要：所有 PR 必须以 `dev` 分支为目标。  
> 📌 注意：`main` 仅用于发布，禁止直接合并或推送。

1. 在开始前同步最新 `dev`：
   ```bash
   git checkout dev
   git pull origin dev
   ```
2. 根据需求创建功能或修复分支：
   ```bash
   git checkout -b feature/provider-weight-ui
   ```
3. 开发过程中保持变更粒度小，提交前运行必要的检查（见 [测试](#8-测试-testing)）。
4. 提交并推送：
   ```bash
   git add .
   git commit -m "feat: add provider weight ui"
   git push origin feature/provider-weight-ui
   ```
5. 在 GitHub 上创建指向 `dev` 的 PR，详细填写描述、截图与验证步骤。更多工作流细节请阅读 `.github/CI_CD_SETUP.md`。

### 5. 分支命名 Branch Naming

- `feature/<short-description>`：新功能或较大改动（例：`feature/audit-log-export`）
- `fix/<issue-id-or-scope>`：缺陷修复（例：`fix/redis-timeout`）
- `hotfix/<scope>`：紧急线上修复，仍需先合入 `dev`
- `chore/<scope>`：依赖更新、文档、脚本等

### 6. 提交格式 Commit Format

遵循 Conventional Commits，使用英文动词简述改动。常用类型：

| 类型       | 用途               |
| ---------- | ------------------ |
| `feat`     | 新功能或重大增强   |
| `fix`      | 缺陷修复           |
| `chore`    | 构建、配置或文档   |
| `refactor` | 重构，不引入新功能 |
| `test`     | 新增或更新测试     |

示例：`feat: add provider priority routing`

### 7. 代码风格 Code Style

- TypeScript + React 组件遵守 2 空格缩进、双引号和尾随逗号（Biome 默认配置）。
- Tailwind CSS 样式与 JSX 同行，沿用 README 中的 emoji 样式和语气。
- 工具函数保持单一职责，避免重复代码（DRY）。
- 新增文件前参考 `src/` 下相同模块的实现，保持命名一致。

### 8. 测试 Testing

在每次提交前务必运行：

```bash
bun run lint
bun run typecheck
# 如果更改影响运行逻辑，执行端到端验证或 bun run test
```

CI 会在 PR 上运行 `Docker Build Test`（见 `.github/CI_CD_SETUP.md`）。如需验证容器构建，可本地执行：

```bash
docker compose build
```

### 9. PR 流程 PR Process

> ⚠️ 重要：PR 的 base 分支必须是 `dev`，CI 通过后方可合并。  
> 📌 注意：若 PR 过期，请先 `git fetch && git rebase origin/dev`，保持与受保护分支同步。

1. 创建 PR 时附上变更摘要、测试截图或日志。
2. 检查列表：
   - [ ] 目标分支为 `dev`
   - [ ] 所有状态检查（Docker Build Test）已通过
   - [ ] 与 `main` 无直接冲突
   - [ ] 引用相关 Issue 或任务（如有）
3. Reviewer 会在 2 个工作日内反馈；需要改动时请直接推送到同一分支。
4. 合并策略遵循 “Squash and merge”，保持干净的提交历史。

### 10. 问题反馈 Issue Reporting

- 在 GitHub Issues 中创建问题，选择合适的标签（bug/feature/question）。
- 描述内容包括：环境信息、复现步骤、预期结果与实际结果、日志或截图。
- 紧急情况可在 Issues 评论中 @Maintainer 或加入 Telegram 群同步说明。
- 提交 Issue 前可搜索是否已有类似讨论，避免重复。

---

<a id="english-contributing-guide"></a>

## 🇺🇸 English Contributing Guide

### 📚 English Table of Contents

- [1. Introduction](#1-introduction)
- [2. Code of Conduct](#2-code-of-conduct)
- [3. Getting Started](#3-getting-started)
- [4. How to Contribute](#4-how-to-contribute)
- [5. Branch Naming](#5-branch-naming)
- [6. Commit Format](#6-commit-format)
- [7. Code Style](#7-code-style)
- [8. Testing](#8-testing)
- [9. PR Process](#9-pr-process)
- [10. Issue Reporting](#10-issue-reporting)

### 1. Introduction

Claude Code Hub centralizes multiple AI providers with smart routing, tenant controls, and observability. This document explains how to deliver high-quality Pull Requests (PRs) that align with the project roadmap.

### 2. Code of Conduct

- Communicate with respect, empathy, and patience—follow the spirit of Contributor Covenant 2.1.
- Absolutely no harassment, discrimination, or personal attacks.
- Base discussions on facts and data; document trade-offs clearly.
- Primary channels: GitHub Issues/Discussions and the Telegram group listed in `README.md`. Expect responses within two business days.

### 3. Getting Started

1. Clone and install dependencies:
   ```bash
   git clone https://github.com/ding113/claude-code-hub.git
   cd claude-code-hub
   bun install
   ```
2. Copy environment variables and configure secrets:
   ```bash
   cp .env.example .env
   ```
3. Launch the dev server:
   ```bash
   bun run dev
   ```
4. For Docker-based flows, review `README.md` and `.github/CI_CD_SETUP.md`.

### 4. How to Contribute

> ⚠️ Important: Every PR must target the `dev` branch.  
> 📌 Notice: `main` is release-only; never push or merge into it directly.

1. Sync the latest `dev` branch before coding:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/provider-weight-ui
   ```
2. Keep changes scoped and document reasoning inside commits or PR descriptions.
3. Run the checks listed in [Testing](#8-testing) before pushing.
4. Push the branch and open a PR against `dev`. Reference `.github/CI_CD_SETUP.md` for branch protection and CI expectations.

### 5. Branch Naming

- `feature/<short-description>` — new capabilities or UI work
- `fix/<issue-id-or-scope>` — bug fixes
- `hotfix/<scope>` — urgent production fixes (merge into `dev` via PR)
- `chore/<scope>` — docs, tooling, dependency bumps

### 6. Commit Format

Follow Conventional Commits with concise English summaries:

| Type       | Purpose                                     |
| ---------- | ------------------------------------------- |
| `feat`     | Introduce a feature or enhancement          |
| `fix`      | Resolve a bug                               |
| `chore`    | Tooling, docs, or maintenance               |
| `refactor` | Internal refactors without behavior changes |
| `test`     | Add or adjust tests                         |

Example: `fix: handle redis timeout retry`

### 7. Code Style

- Respect the shared Biome config (2-space indent, double quotes, trailing commas).
- Tailwind classes stay close to the JSX they style, mirroring patterns in `src/app`.
- Keep utilities single-purpose and reuse helpers from `src/lib` or `src/actions` when possible.
- Match the conversational tone (emojis + concise explanations) already used in `README.md`.

### 8. Testing

Always verify locally before requesting a review:

```bash
bun run lint
bun run typecheck
# Run bun run test or relevant scripts when logic changes
docker compose build   # optional, mirrors CI Docker Build Test
```

GitHub Actions runs `Docker Build Test` on every PR to `dev` and `main`; see `.github/CI_CD_SETUP.md` for the full matrix.

### 9. PR Process

> ⚠️ Important: Set the PR base to `dev`, ensure CI is green before merging.  
> 📌 Notice: Rebase onto `origin/dev` if the branch falls behind protected rules.

1. Fill out the PR template with context, screenshots/logs, and testing notes.
2. Confirm the checklist:
   - [ ] Base branch is `dev`
   - [ ] Docker Build Test (and other required checks) succeed
   - [ ] Conflicts resolved and branch up to date
   - [ ] Linked Issues or Discussions when applicable
3. Maintainers aim to respond within two business days. Continue pushing to the same branch for follow-up changes.
4. Merges use “Squash and merge” to keep history tidy.

### 10. Issue Reporting

- File Issues with clear titles, labels, reproduction steps, expected vs. actual behavior, and logs or screenshots.
- Include environment details (OS, Docker/Node versions, provider configuration).
- For urgent incidents, leave a comment tagging maintainers or post in the Telegram group.
- Search existing Issues/Discussions to prevent duplicates before creating a new report.

---

感谢你为 Claude Code Hub 做出的贡献！Thanks for helping improve Claude Code Hub!
