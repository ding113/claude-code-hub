<p align="right">
  <a href="./README.en.md" aria-label="Switch to English version of this README">English</a> | <strong>中文</strong>
</p>

<div align="center">

# Claude Code Hub

**🚀 智能 AI API 代理中转服务平台｜面向团队的多供应商统一接入、弹性调度与精细化运营中心**

[![Container Image](https://img.shields.io/badge/ghcr.io-ding113%2Fclaude--code--hub-181717?logo=github)](https://github.com/ding113/claude-code-hub/pkgs/container/claude-code-hub)
[![License](https://img.shields.io/github/license/ding113/claude-code-hub)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/ding113/claude-code-hub)](https://github.com/ding113/claude-code-hub/stargazers)
[![Telegram Group](https://img.shields.io/badge/Telegram-交流群-blue?logo=telegram)](https://t.me/ygxz_group)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/ding113/claude-code-hub)

Claude Code Hub 通过 Next.js 15 + Hono + PostgreSQL + Redis 组合，实现 Claude/OpenAI 兼容 API 代理、智能负载均衡、实时监控、价格管理与自动化文档，帮助团队安全、可观测地管理多家 AI 服务商。

💬 **加入讨论**：有部署、功能或技术问题？欢迎加入 [Telegram 交流群](https://t.me/ygxz_group) 与社区一起讨论！

</div>

---

<table>
<tr>
<td width="200">
<a href="https://cubence.com?source=cch">
<img src="public/readme/cubence.jpg" alt="Cubence Logo" width="180"/>
</a>
</td>
<td>
<b>💎 特别优惠</b>：<a href="https://cubence.com?source=cch">Cubence</a> 一家稳定高效的AI服务中转平台，为 Claude Code、Codex、Gemini 等AI工具提供中转服务，有着不错的稳定性和性价比。<br/>
Cubence 为 CCH 的使用用户提供了特别的优惠折扣：在购买时使用优惠券 <code>DING113CCH</code>，可享受 <b>20% 优惠折扣</b> → <a href="https://cubence.com?source=cch">立即访问</a>
</td>
</tr>
</table>

## ✨ 核心功能 Highlights

- 🤖 **智能负载均衡**：权重 + 优先级 + 分组调度，内置熔断保护与最多 3 次故障转移，保障请求稳定。
- 🧩 **多供应商管理**：同时接入 Claude、Codex、Gemini CLI、OpenAI Compatible，自定义模型重定向与 HTTP/HTTPS/SOCKS 代理。
- 🛡️ **限流与并发控制**：RPM、金额（5 小时/周/月）、并发 Session 多维限制，Redis Lua 脚本确保原子性与 Fail-Open 降级。
- 📘 **自动化 OpenAPI 文档**：39 个 REST 端点由 Server Actions 自动生成 OpenAPI 3.1.0，Swagger + Scalar UI 双界面即刻试用。
- 📊 **实时监控与统计**：仪表盘、活跃 Session、消耗排行榜、决策链记录、代理状态追踪，秒级掌控运行态势。
- 💰 **价格表管理**：分页查询 + SQL 优化，支持搜索防抖、LiteLLM 同步，千级模型也能快速检索。
- 🔁 **Session 管理**：5 分钟上下文缓存，记录决策链，避免频繁切换供应商并保留全链路审计。
- 🔄 **OpenAI 兼容层**：支持 `/v1/chat/completions`，自动格式转换、工具调用、reasoning 字段与 Codex CLI 指令注入。

## ⚡️ 快速开始 Quick Start

### 环境要求

- Docker 与 Docker Compose（推荐使用最新版本）
- 可选（本地开发）：Node.js ≥ 20，Bun ≥ 1.3

### 🚀 一键部署脚本（✨ 推荐方式，全自动安装）

一键部署脚本会**自动完成**以下所有步骤：

- 检查并安装 Docker 和 Docker Compose（Linux/macOS 支持自动安装）
- 创建部署目录并配置文件
- 生成安全的管理员令牌和数据库密码
- 启动所有服务并等待健康检查
- 显示访问地址和管理员令牌

**Linux / macOS:**

```bash
# 下载并运行部署脚本
curl -fsSL https://raw.githubusercontent.com/ding113/claude-code-hub/main/scripts/deploy.sh -o deploy.sh
chmod +x deploy.sh
./deploy.sh
```

或者使用 wget：

```bash
wget https://raw.githubusercontent.com/ding113/claude-code-hub/main/scripts/deploy.sh
chmod +x deploy.sh
./deploy.sh
```

**Windows (PowerShell 管理员模式):**

```powershell
# 下载并运行部署脚本
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/ding113/claude-code-hub/main/scripts/deploy.ps1" -OutFile "deploy.ps1"
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
.\deploy.ps1
```

**部署目录：**

- Linux: `/www/compose/claude-code-hub`
- macOS: `~/Applications/claude-code-hub`
- Windows: `C:\ProgramData\claude-code-hub`

**分支选择：**

脚本会提示选择部署分支：

- `main`（默认）：稳定版本，推荐生产环境使用
- `dev`：开发版本，包含最新功能，用于测试

**重要提示：**

- ⚠️ 请妥善保存脚本输出的**管理员令牌**（Admin Token），这是登录后台的唯一凭证！
- ⚠️ Windows 用户：如果未安装 Docker Desktop，脚本会自动打开下载页面

### 三步启动（Docker Compose）

1. **克隆项目并配置环境**

   ```bash
   git clone https://github.com/ding113/claude-code-hub.git
   cd claude-code-hub
   cp .env.example .env
   ```

2. **修改配置文件**

   编辑 `.env` 文件，**必须修改** `ADMIN_TOKEN`（后台登录令牌）：

   ```bash
   # 必须修改此项！
   ADMIN_TOKEN=your-secure-token-here

   # Docker Compose 默认配置（通常无需修改）
   DSN=postgres://postgres:postgres@postgres:5432/claude_code_hub
   REDIS_URL=redis://redis:6379
   ```

3. **启动服务**

   ```bash
   docker compose up -d
   ```

   查看启动状态：

   ```bash
   docker compose ps
   docker compose logs -f app
   ```

### 访问应用

启动成功后：

- **管理后台**：`http://localhost:23000`（使用 `.env` 中的 `ADMIN_TOKEN` 登录）
- **API 文档（Scalar UI）**：`http://localhost:23000/api/actions/scalar`
- **API 文档（Swagger UI）**：`http://localhost:23000/api/actions/docs`

> 💡 **提示**：如需修改端口，请编辑 `docker-compose.yml` 中的 `ports` 配置。

## 🖼️ 界面预览 Screenshots

| 功能       | 截图                                                 | 说明                                                                              |
| ---------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| 仪表盘     | ![Dashboard](public/readme/首页.png)                 | 汇总调用量、成本、活跃 Session 与时间分布，实时洞察整体使用情况。                 |
| 供应商管理 | ![Provider Management](public/readme/供应商管理.png) | 为每个供应商配置权重、成本系数、并发限制、代理及模型重定向，实现精细调度。        |
| 日志与审计 | ![Logs](public/readme/日志.png)                      | 统一查询请求日志，支持时间/用户/供应商/模型筛选，查看 Token、成本与缓冲命中情况。 |
| 排行榜     | ![Leaderboard](public/readme/排行榜.png)             | 按用户统计请求数、Token 与成本，用于费用分摊与用量治理。                          |

## 🏗️ 架构说明 Architecture

### 高层架构

```
客户端 / CLI / 第三方系统
        │
        ▼
Next.js 15 App Router (v1 API 路由)
        │
Hono + Proxy Pipeline (认证 → Session 分配 → 限流 → 供应商选择 → 请求转发 → 响应处理)
        │
多供应商 (Claude / OpenAI / Gemini / 第三方) + PostgreSQL + Redis
```

- **App 层**：`src/app` 中的 dashboard、settings、api actions，提供 UI 与内部 API。
- **Proxy 核心**：`src/app/v1/_lib/proxy-handler.ts` 串联 Auth、SessionGuard、RateLimitGuard、ProviderResolver、Forwarder、ResponseHandler。
- **业务逻辑**：`src/lib` 存放限流、Session、熔断器、代理、price-sync；`src/repository` 封装 Drizzle ORM 查询。
- **文档体系**：`src/app/api/actions/[...route]/route.ts` 自动注册 Action → OpenAPI 端点。

### 数据流与组件

1. **入口**：请求携带 API Key 命中 Next.js API Route → `ProxyAuthenticator` 校验身份。
2. **上下文管理**：`SessionManager` 从 Redis 读取 5 分钟缓存，控制并发并记录决策链。
3. **限流**：`RateLimitService` 使用 Lua 脚本原子写入 RPM/金额/并发指标，Redis 不可用则 Fail-Open 降级。
4. **调度**：`ProviderResolver` 根据权重、优先级、熔断状态与 Session 复用策略选择最佳供应商，至多 3 次重试。
5. **转发与兼容**：`ProxyForwarder` + `ResponseTransformer` 适配 Claude/OpenAI/Response API，支持代理与模型重定向。
6. **监控**：日志、排行榜、价格表等 UI 通过 `repository` 查询 PostgreSQL，以小时级聚合呈现指标。

## 🚢 部署指南 Deployment

### 🐳 Docker Compose（✨ 推荐方式，开箱即用）

Docker Compose 是**首选部署方式**，自动配置数据库、Redis 和应用服务，无需手动安装依赖，适合生产环境快速部署。

1. 准备 `.env`（参考 `.env.example`）；确认 `DSN` 与 `REDIS_URL` 指向 Compose 内的服务。
2. 启动：
   ```bash
   docker compose up -d
   ```
3. 查看日志与状态：
   ```bash
   docker compose logs -f app
   docker compose ps
   ```
4. 升级：
   ```bash
   docker compose pull && docker compose up -d
   ```
   若需停止并清理，执行 `docker compose down`.

### 本地开发（dev 工具链）

1. 进入 `dev/` 目录：`cd dev`.
2. `make dev` 一键启动 PostgreSQL + Redis + bun dev。
3. 常用命令：
   - `make db`：仅启动数据库与 Redis
   - `make logs` / `make logs-app`：快速查看服务日志
   - `make clean` / `make reset`：清理或重置环境
4. 推荐使用 `make migrate`、`make db-shell` 处理数据库变更。

### 手动部署（bun build + start）

1. 安装依赖并构建：
   ```bash
   bun install
   bun run build      # 自动复制 VERSION
   ```
2. 设置环境变量（建议通过系统服务或 PM2 注入），确保数据库、Redis 可访问。
3. 启动生产服务器：
   ```bash
   bun run start
   ```
4. 注意：首次运行可开启 `AUTO_MIGRATE=true` 自动迁移，生产环境完成后建议改为 `false` 并使用 Drizzle CLI 手动管理。

## ⚙️ 配置说明 Configuration

| 变量                                       | 默认值                   | 说明与建议                                                                   |
| ------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------- |
| `ADMIN_TOKEN`                              | `change-me`              | 后台登录令牌，部署前必须修改。                                               |
| `DSN`                                      | -                        | PostgreSQL 连接串，如 `postgres://user:pass@host:5432/db`.                   |
| `AUTO_MIGRATE`                             | `true`                   | 启动时自动执行 Drizzle 迁移；生产环境可关闭以人工控制。                      |
| `REDIS_URL`                                | `redis://localhost:6379` | Redis 地址，支持 `rediss://` 用于 TLS。                                      |
| `ENABLE_RATE_LIMIT`                        | `true`                   | 控制多维限流开关；Fail-Open 策略在 Redis 不可用时自动降级。                  |
| `SESSION_TTL`                              | `300`                    | Session 缓存时间（秒），影响供应商复用策略。                                 |
| `ENABLE_SECURE_COOKIES`                    | `true`                   | 仅 HTTPS 场景能设置 Secure Cookie；HTTP 访问（非 localhost）需改为 `false`。 |
| `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS` | `false`                  | 是否将网络错误计入熔断器；开启后能更激进地阻断异常线路。                     |
| `APP_PORT`                                 | `23000`                  | 生产端口，可被容器或进程管理器覆盖。                                         |
| `APP_URL`                                  | 空                       | 设置后 OpenAPI 文档 `servers` 将展示正确域名/端口。                          |
| `API_TEST_TIMEOUT_MS`                      | `15000`                  | 供应商 API 测试超时时间（毫秒，范围 5000-120000），跨境网络可适当提高。      |

> 布尔变量请直接写 `true/false` 或 `1/0`，勿加引号，避免被 Zod 转换为真值。更多字段参考 `.env.example`。

## ❓ FAQ

1. **数据库连接失败怎么办？**
   - 确认 `DSN` 格式与凭据无误；Docker 场景下使用服务名（如 `postgres:5432`）。
   - 查看 `docker compose ps` 或本地 PostgreSQL 状态，必要时通过 `make db-shell` 诊断。

2. **Redis 离线会影响服务吗？**
   - 平台采用 Fail-Open 策略：限流与会话统计会降级，但请求仍会继续；建议监控日志中的 Redis Error 并尽快恢复。

3. **熔断器持续打开如何排查？**
   - 查看日志中的 `[CircuitBreaker]` 记录，确认是否由于 4xx/5xx 或网络错误导致。
   - 在管理后台检查供应商健康状态，等待 30 分钟或重启应用重置状态。

4. **提示“无可用供应商”该怎么办？**
   - 检查供应商是否启用、权重/优先级设置合理，以及是否达到并发/金额限制。
   - 查看决策链日志，确认是否被熔断或代理失败导致。

5. **代理配置失败？**
   - 确认 URL 含协议前缀（`http://`、`socks5://` 等），并使用后台“测试连接”按钮验证。
   - 若启用降级策略（`proxy_fallback_to_direct`），请在日志中确认是否已自动切换至直连。

## 🤝 贡献指南 Contributing

欢迎通过 Issue / PR 参与开发，提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，遵循双语目录、分支命名和 Conventional Commits 规则。

## 🌐 致谢 Acknowledgments

项目基于 [zsio/claude-code-hub](https://github.com/zsio/claude-code-hub) 深度改进，OpenAI 兼容层参考 [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)，供应商检测功能参考 [prehisle/relay-pulse](https://github.com/prehisle/relay-pulse)。感谢原作者及社区贡献者！

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=ding113/claude-code-hub&type=Date)](https://star-history.com/#ding113/claude-code-hub&Date)

## 📜 许可证 License

本项目采用 [MIT License](LICENSE)，可自由使用与二次开发，仍需遵守条款并保留致谢信息。
