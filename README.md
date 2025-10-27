<div align="center">

# Claude Code Hub

**🚀 智能 AI API 代理中转服务平台**

专为需要统一管理多个 AI 服务提供商的团队和企业设计

[![Container Image](https://img.shields.io/badge/ghcr.io-ding113%2Fclaude--code--hub-181717?logo=github)](https://github.com/ding113/claude-code-hub/pkgs/container/claude-code-hub)
[![License](https://img.shields.io/github/license/ding113/claude-code-hub)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/ding113/claude-code-hub)](https://github.com/ding113/claude-code-hub/stargazers)

[功能特性](#-功能特性) •
[快速部署](#-快速部署) •
[使用指南](#-使用指南) •
[常见问题](#-常见问题)

</div>

> **💡 致谢**
> 本项目基于 [zsio/claude-code-hub](https://github.com/zsio/claude-code-hub) 二次开发而来。
> 感谢原作者 [@zsio](https://github.com/zsio) 的开源贡献!

---

## ✨ 功能特性

### 核心能力

- **🔄 统一代理** - 一个 API 接口管理所有 AI 服务提供商（OpenAI、Claude、Gemini 等）
- **⚖️ 智能负载** - 基于权重的智能分发 + 自动故障转移 + 会话保持
- **👥 多租户** - 完整的用户体系，细粒度权限控制和配额管理
- **🔑 密钥管理** - API Key 生成、轮换、过期管理
- **📊 实时监控** - 请求统计、成本追踪、性能分析、可视化报表
- **🎨 现代 UI** - 基于 Shadcn UI 的响应式管理面板，深色模式
- **🚀 生产就绪** - Docker 一键部署、自动数据库迁移、健康检查

本项目基于 [zsio/claude-code-hub](https://github.com/zsio/claude-code-hub) 进行了大量增强和优化：

- **📋 详细日志记录** - 完整的请求日志，包含 Token 使用、成本计算、缓存命中等详细信息
- **🔒 并发控制** - 支持为用户和供应商设置并发 Session 限制
- **⏱️ 多时段限流** - 5小时/周/月 三个时间窗口的金额限制，更灵活的配额管理
- **📈 统计排行榜** - 日统计、月统计排行榜，快速了解用户和供应商使用情况
- **🎚️ 优先级路由** - 支持多供应商优先级和权重设置，精细化流量分配
- **🔗 决策链追踪** - 完整的供应商调用链记录，支持错误切换决策链显示
- **🛡️ 熔断保护** - 供应商出错时自动临时熔断，避免重复调用失败的服务
- **💰 价格同步** - 一键拉取 LiteLLM 模型价格表，自动更新价格信息
- **🤖 OpenAI 兼容** - 支持 Codex CLI 等 OpenAI 格式的 AI 编程工具，包括模型重定向、价格管理

### 界面预览

<div align="center">

![首页](/public/readme/首页.png)

_首页面板 - 系统概览与快速访问_

![供应商管理](/public/readme/供应商管理.png)

_供应商管理 - 配置上游服务、权重分配、流量限制_

![排行榜](/public/readme/排行榜.png)

_统计排行榜 - 用户和供应商使用情况一目了然_

![日志](/public/readme/日志.png)

_详细日志记录 - Token 使用、成本计算、调用链追踪_

</div>

## 🚀 快速部署

### 前置要求

- Docker 和 Docker Compose
- ⏱️ 仅需 **2 分钟**即可启动完整服务

### 一键部署

**1. 配置环境变量**

复制 `.env.example` 为 `.env` 并修改必要配置：

```bash
cp .env.example .env
```

**⚠️ 必须修改 `ADMIN_TOKEN` 为强密码！**

查看完整环境变量说明：[.env.example](.env.example)

**2. 启动服务**

```bash
# 启动所有服务（后台运行）
docker compose up -d

# 查看启动日志
docker compose logs -f
```

**3. 验证部署**

```bash
docker compose ps
```

确保三个容器都是 `healthy` 或 `running` 状态：

- `claude-code-hub-db` (PostgreSQL)
- `claude-code-hub-redis` (Redis)
- `claude-code-hub-app` (应用服务)

### 配置文件说明

- **[docker-compose.yaml](docker-compose.yaml)** - Docker Compose 配置文件
- **[.env.example](.env.example)** - 环境变量配置模板

### 常用管理命令

```bash
# 查看日志
docker compose logs -f          # 所有服务
docker compose logs -f app      # 仅应用

# 重启服务
docker compose restart app      # 重启应用

# 升级到最新版本
docker compose pull && docker compose up -d

# 备份数据（数据持久化在宿主机 ./data/ 目录）
# - ./data/postgres 映射到容器 /data (PostgreSQL 数据目录: /data/pgdata)
# - ./data/redis 映射到容器 /data (Redis AOF 持久化文件)
tar -czf backup_$(date +%Y%m%d_%H%M%S).tar.gz ./data/
```

<details>
<summary><b>更多管理命令</b></summary>

**服务管理**：

```bash
docker compose stop             # 停止服务
docker compose down             # 停止并删除容器
docker compose restart redis    # 重启 Redis
```

**数据库操作**：

```bash
# SQL 备份
docker exec claude-code-hub-db pg_dump -U postgres claude_code_hub > backup.sql

# 恢复数据
docker exec -i claude-code-hub-db psql -U postgres claude_code_hub < backup.sql
```

**Redis 操作**：

```bash
docker compose exec redis redis-cli ping           # 检查连接
docker compose exec redis redis-cli info stats     # 查看统计
docker compose exec redis redis-cli --scan         # 查看所有 key
docker compose exec redis redis-cli FLUSHALL       # ⚠️ 清空数据
```

**完全重置**（⚠️ 会删除所有数据）：

```bash
docker compose down && rm -rf ./data/ && docker compose up -d
```

</details>

## 📖 使用指南

### 1️⃣ 初始设置

首次访问 http://localhost:23000
使用 `ADMIN_TOKEN` 登录管理后台。

### 2️⃣ 添加 AI 服务提供商

进入 **设置 → 供应商管理**，点击"添加供应商"：

> **📌 重要说明：API 格式兼容性**
>
> 本服务**仅支持 Claude Code 格式**的 API 接口（如智谱 GLM、Kimi、Packy 等）。如果您需要使用其他格式的 AI 服务，比如 Gemini、OpenAI、 Ollama 等格式，请先使用 `claude-code-router` 进行格式转换，然后将转换后的服务地址添加到本系统。

### 3️⃣ 创建用户和密钥

**添加用户**：

1. 进入 **设置 → 用户管理**
2. 点击"添加用户"
3. 配置：
   - 用户名称
   - 描述信息
   - RPM 限制（每分钟请求数）
   - 每日额度（USD）

**生成 API 密钥**：

1. 选择用户，点击"生成密钥"
2. 设置密钥名称
3. 设置过期时间（可选）
4. **⚠️ 复制并保存密钥**（仅显示一次）

### 4️⃣ 使用代理 API

用户使用生成的密钥调用服务：
查看 `http://localhost:23000/usage-doc`

### 5️⃣ 监控和统计

**仪表盘**页面提供：

- 📈 实时请求量趋势
- 💰 成本统计和分析
- 👤 用户活跃度排行
- 🔧 供应商性能对比
- ⚠️ 异常请求监控

### 6️⃣ 配置模型价格

进入 **设置 → 价格管理**，配置各模型的计费单价：

- 支持按模型配置输入/输出 Token 单价（包括 Claude 和 OpenAI 格式模型）
- 支持缓存 Token 单独定价（`cache_creation_input_tokens`、`cache_read_input_tokens`）
- 自动计算请求成本
- 导出成本报表

**OpenAI 模型价格配置示例**：

- 模型名称：`gpt-5-codex`
- 输入价格（USD/M tokens）：`0.003`
- 输出价格（USD/M tokens）：`0.006`

## 🛠️ 常见问题

<details>
<summary><b>❓ 如何重置管理员密码？</b></summary>

编辑 `.env` 文件，修改 `ADMIN_TOKEN`，然后重启：

```bash
docker compose restart app
```

</details>

<details>
<summary><b>❓ 端口已被占用怎么办？</b></summary>

编辑 `docker-compose.yaml`，修改端口映射：

```yaml
services:
  app:
    ports:
      - "8080:23000" # 修改左侧端口为可用端口
```

</details>

<details>
<summary><b>❓ 数据库迁移失败怎么办？</b></summary>

1. 检查应用日志：

   ```bash
   docker compose logs app | grep -i migration
   ```

2. 手动执行迁移：

   ```bash
   docker compose exec app pnpm db:migrate
   ```

3. 如果持续失败，重置数据库（⚠️ 会丢失数据）：
   ```bash
   docker compose down && rm -rf ./data/postgres && docker compose up -d
   ```

</details>

<details>
<summary><b>❓ Redis 连接失败怎么办？</b></summary>

本服务采用 **Fail Open 策略**，Redis 连接失败不会影响服务可用性。

检查 Redis 状态：

```bash
docker compose ps redis
docker compose exec redis redis-cli ping  # 应返回 PONG
```

Redis 不可用时，限流功能会自动降级，所有请求仍然正常通过。

更多 Redis 操作请参考[常用管理命令](#常用管理命令)部分。

</details>

<details>
<summary><b>❓ HTTP 访问时无法登录怎么办？</b></summary>

**问题现象**：使用 HTTP 访问系统（非 localhost）时，登录页面显示 Cookie 安全警告，无法登录。

**原因**：默认情况下，系统启用了 Cookie 安全策略（`ENABLE_SECURE_COOKIES=true`），仅允许 HTTPS 传输 Cookie。浏览器会自动放行 localhost 的 HTTP 访问，但拒绝远程 HTTP。

**解决方案**：

**方案 1：使用 HTTPS 访问（推荐）**

配置反向代理（如 Nginx）并启用 HTTPS，参见下方 [如何配置反向代理（Nginx + HTTPS）](#-如何配置反向代理nginx--https) 部分。

**方案 2：允许 HTTP Cookie（降低安全性）**

编辑 `.env` 文件，添加或修改：

```bash
ENABLE_SECURE_COOKIES=false
```

重启应用：

```bash
docker compose restart app
```

⚠️ **安全警告**：设置为 `false` 会允许 HTTP 传输 Cookie，仅推荐用于内网部署或测试环境。

</details>

<details>
<summary><b>❓ 支持哪些 AI 服务提供商？</b></summary>

**本服务仅支持 Claude Code 格式的 API 接口。**

**直接支持**：

- 原生提供 Claude Code 格式接口的服务商

**间接支持**（需要先部署 [claude-code-router](https://github.com/zsio/claude-code-router) 进行协议转换）：

- 🔄 智谱 AI (GLM)、Moonshot AI (Kimi)、Packy 等
- 🔄 阿里通义千问、百度文心一言等
- 🔄 其他非 Claude Code 格式的 AI 服务

</details>

<details>
<summary><b>❓ 如何配置反向代理（Nginx + HTTPS）？</b></summary>

Nginx 配置示例：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:23000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

配置 HTTPS 后，确保 `.env` 中 `ENABLE_SECURE_COOKIES=true`（默认值），以启用 Cookie 安全传输。

</details>

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 🙏 致谢

本项目的开发过程中参考和借鉴了以下优秀的开源项目：

- **[zsio/claude-code-hub](https://github.com/zsio/claude-code-hub)** - 本项目的基础框架，感谢 [@zsio](https://github.com/zsio) 提供的优秀架构设计
- **[router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** - Codex CLI OpenAI 兼容层的实现参考了该项目，感谢其在 MIT 协议下的开源贡献

特别感谢上述项目的作者和贡献者！

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE)

**关于引用和参考**：

- Codex CLI 的 OpenAI 兼容层实现参考了 [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 项目（MIT 协议）

## 🌟 Star History

如果这个项目对你有帮助，请给它一个 ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=ding113/claude-code-hub&type=Date)](https://star-history.com/#ding113/claude-code-hub&Date)

## 📞 支持与反馈

<div align="center">

**[🐛 报告问题](https://github.com/ding113/claude-code-hub/issues)** •
**[💡 功能建议](https://github.com/ding113/claude-code-hub/issues/new)** •
**[📖 查看文档](https://github.com/ding113/claude-code-hub/wiki)**

Based on [zsio/claude-code-hub](https://github.com/zsio/claude-code-hub) • Modified by [ding113](https://github.com/ding113)

</div>
