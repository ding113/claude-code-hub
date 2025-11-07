<p align="right">
  <a href="./README.md" aria-label="Switch to Chinese version of this README">中文</a> | <strong>English</strong>
</p>

<div align="center">

# Claude Code Hub

**🚀 Intelligent AI API relay and proxy platform**

Designed for teams and enterprises that need to centrally manage multiple AI service providers

[![Container Image](https://img.shields.io/badge/ghcr.io-ding113%2Fclaude--code--hub-181717?logo=github)](https://github.com/ding113/claude-code-hub/pkgs/container/claude-code-hub)
[![License](https://img.shields.io/github/license/ding113/claude-code-hub)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/ding113/claude-code-hub)](https://github.com/ding113/claude-code-hub/stargazers)
[![Telegram](https://img.shields.io/badge/Telegram-@ygxz__group-26A5E4?logo=telegram)](https://t.me/ygxz_group)

[Features](#-features) •
[Quick Deployment](#-quick-deployment) •
[Usage Guide](#-usage-guide) •
[FAQ](#-faq)

</div>

> **💡 Acknowledgements**
> This project is a heavily customized fork of [zsio/claude-code-hub](https://github.com/zsio/claude-code-hub).
> Many thanks to the original author [@zsio](https://github.com/zsio) for the open-source contribution!

> **💬 Join the community**
>
> Feel free to join the Telegram group to discuss product usage, feature requests, and technical questions:
>
> <div align="center">
>
> **📱 [Tap to join @ygxz_group](https://t.me/ygxz_group)**
>
> </div>

---

## ✨ Features

### Core Capabilities

- **🔄 Unified proxy** - Single API endpoint that fronts every AI provider (OpenAI, Claude, Gemini, etc.)
- **⚖️ Intelligent load balancing** - Weight-based routing with automatic failover and sticky sessions
- **👥 Multi-tenancy** - Full user system with granular permissions and quota management
- **🔑 Key management** - API key generation, rotation, and expiration governance
- **📊 Real-time monitoring** - Request analytics, cost tracking, performance insights, and visual dashboards
- **🎨 Modern UI** - Responsive Shadcn UI-based admin console with dark mode support
- **🚀 Production ready** - One-command Docker deployment, automated DB migrations, and health checks

This fork delivers extensive enhancements over [zsio/claude-code-hub](https://github.com/zsio/claude-code-hub):

- **📋 Detailed logging** - Full request history with token usage, cost calculations, cache hits, and more
- **🔒 Concurrency control** - Session limits per user and per provider
- **⏱️ Multi-window rate limiting** - 5-hour / weekly / monthly spending ceilings for flexible quota control
- **📈 Leaderboards** - Daily and monthly rankings to reveal user/provider utilization at a glance
- **🎚️ Priority routing** - Provider-level priority and weight settings for precise traffic shaping
- **🔗 Decision chain tracing** - Complete provider call-chain history with error-driven failover visibility
- **🛡️ Circuit breaker** - Automatic short-term fuse when a provider fails to prevent repeated errors
- **💰 Price sync** - One-click LiteLLM price import covering Claude, OpenAI, Codex, and every other model family
- **🤖 OpenAI compatibility** - Works with Codex CLI and other OpenAI-style coding tools, including model redirects and price policies
- **💵 Currency symbol configuration** - Optional frontend currency display aligned with provider cost multipliers
- **🎯 Model allowlist** - Restrict callable models per provider for fine-grained access control
- **🧹 Log cleanup** - Automatic history pruning to keep the database lean
- **🛡️ Sensitive phrase filtering** - Built-in safeguard to keep the platform compliant
- **📝 Session details** - Optional logging for UA, request, and response payloads to debug provider performance
- **🔐 Key-level permissions** - Optionally forbid specific keys from logging in to the web UI to enforce sharing boundaries
- **📖 Public usage docs** - Rewritten public documentation with anonymous access for faster onboarding
- **📚 Automated API docs** - OpenAPI 3.1.0 plus Swagger UI and Scalar UI with 39 REST endpoints

### UI Preview

<div align="center">

![首页](/public/readme/首页.png)

_Home dashboard – system overview and quick shortcuts_

![供应商管理](/public/readme/供应商管理.png)

_Provider management – configure upstream services, weights, and throttling_

![排行榜](/public/readme/排行榜.png)

_Leaderboards – instant visibility into user and provider usage_

![日志](/public/readme/日志.png)

_Detailed logs – token accounting, cost tracking, and call-chain tracing_

</div>

## 🚀 Quick Deployment

### Prerequisites

- Docker and Docker Compose
- ⏱️ The full stack spins up in **under 2 minutes**

### One-Command Deployment

**1. Configure environment variables**

Copy `.env.example` to `.env` and adjust the required values:

```bash
cp .env.example .env
```

**⚠️ You must change `ADMIN_TOKEN` to a strong secret!**

See the full environment reference: [.env.example](.env.example)

**2. Start the stack**

```bash
# 启动所有服务（后台运行）
docker compose up -d

# 查看启动日志
docker compose logs -f
```

**3. Verify the deployment**

```bash
docker compose ps
```

Ensure all three containers report `healthy` or `running`:

- `claude-code-hub-db` (PostgreSQL)
- `claude-code-hub-redis` (Redis)
- `claude-code-hub-app` (Application service)

### Configuration Files

- **[docker-compose.yaml](docker-compose.yaml)** - Docker Compose definition
- **[.env.example](.env.example)** - Environment variable template

### Common Management Commands

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
<summary><b>More management commands</b></summary>

**Service management**:

```bash
docker compose stop             # 停止服务
docker compose down             # 停止并删除容器
docker compose restart redis    # 重启 Redis
```

**Database operations**:

```bash
# SQL 备份
docker exec claude-code-hub-db pg_dump -U postgres claude_code_hub > backup.sql

# 恢复数据
docker exec -i claude-code-hub-db psql -U postgres claude_code_hub < backup.sql
```

**Redis operations**:

```bash
docker compose exec redis redis-cli ping           # 检查连接
docker compose exec redis redis-cli info stats     # 查看统计
docker compose exec redis redis-cli --scan         # 查看所有 key
docker compose exec redis redis-cli FLUSHALL       # ⚠️ 清空数据
```

**Full reset** (⚠️ Deletes all data):

```bash
docker compose down && rm -rf ./data/ && docker compose up -d
```

</details>

## 📖 Usage Guide

### 1️⃣ Initial setup

Visit http://localhost:23000 for the first login and authenticate with `ADMIN_TOKEN`.

### 2️⃣ Add AI providers

Navigate to **Settings → Provider Management** and click “Add Provider”:

> **📌 Important: API format compatibility**
>
> This platform **only supports the Claude Code API format** (e.g., Zhipu GLM, Kimi, Packy). To integrate other formats such as Gemini, OpenAI, or Ollama, first deploy `claude-code-router` for protocol conversion, then register the converted endpoint here.

### 3️⃣ Create users and keys

**Add a user**:

1. Go to **Settings → User Management**
2. Click “Add User”
3. Configure:
   - User name
   - Description
   - RPM limit (requests per minute)
   - Daily quota (USD)

**Generate an API key**:

1. Select the user and choose “Generate Key”
2. Set a key name
3. Optionally configure an expiration time
4. **⚠️ Copy the key immediately** (it is only shown once)

### 4️⃣ Use the proxy API

Users can call the proxy with their generated keys:
See `http://localhost:23000/usage-doc`

### 5️⃣ Monitor and analyze

The **Dashboard** view provides:

- 📈 Real-time request trends
- 💰 Cost statistics and analysis
- 👤 Active user rankings
- 🔧 Provider performance comparison
- ⚠️ Anomalous request monitoring

### 6️⃣ Configure model pricing

Head to **Settings → Price Management** to set per-model billing rates:

- Configure input/output token pricing per model (Claude and OpenAI formats included)
- Dedicated pricing for cache tokens (`cache_creation_input_tokens`, `cache_read_input_tokens`)
- Automatic cost calculation per request
- Exportable cost reports

**OpenAI pricing example**:

- Model: `gpt-5-codex`
- Input price (USD per million tokens): `0.003`
- Output price (USD per million tokens): `0.006`

### 7️⃣ API documentation and integrations

A complete REST API is available for every administrative action.

**Access the API docs**:

After logging in, open **Settings → API Documentation** or visit directly:

- **Scalar UI** (recommended): `http://localhost:23000/api/actions/scalar`
- **Swagger UI**: `http://localhost:23000/api/actions/docs`
- **OpenAPI JSON**: `http://localhost:23000/api/actions/openapi.json`

**Highlights**:

- 📋 **39 REST API endpoints** covering the full feature set
- 🔐 Cookie-based authentication
- 📝 Comprehensive request/response samples
- 🧪 Interactive testing surface
- 📦 Auto-validated types (Zod schemas)

**Available modules**:

- User, key, and provider management
- Model pricing, analytics, usage logs
- Sensitive term policies, session management, notification management

**API example**:

```bash
# 创建用户（需要先登录获取 session cookie）
curl -X POST http://localhost:23000/api/actions/users/addUser \
  -H "Content-Type: application/json" \
  -H "Cookie: session=your-session-cookie" \
  -d '{
    "name": "Alice",
    "rpm": 60,
    "dailyQuota": 10
  }'
```

**Full documentation**: see [API Documentation Guide](docs/api-documentation.md)

## 🛠️ FAQ

<details>
<summary><b>❓ How do I reset the admin password?</b></summary>

Edit `.env`, update `ADMIN_TOKEN`, then restart:

```bash
docker compose restart app
```

</details>

<details>
<summary><b>❓ What if the port is already in use?</b></summary>

Adjust the port mapping in `docker-compose.yaml`:

```yaml
services:
  app:
    ports:
      - "8080:23000" # 修改左侧端口为可用端口
```

</details>

<details>
<summary><b>❓ What should I do when database migrations fail?</b></summary>

1. Inspect the application logs:

   ```bash
   docker compose logs app | grep -i migration
   ```

2. Run the migration manually:

   ```bash
   docker compose exec app pnpm db:migrate
   ```

3. If it still fails, reset the database (⚠️ data loss):

   ```bash
   docker compose down && rm -rf ./data/postgres && docker compose up -d
   ```

</details>

<details>
<summary><b>❓ Redis connection issues?</b></summary>

The platform uses a **Fail Open strategy**, so Redis outages do not block request handling.

Check Redis status:

```bash
docker compose ps redis
docker compose exec redis redis-cli ping  # 应返回 PONG
```

When Redis is unavailable, rate limiting gracefully degrades and traffic continues to pass.

See the [Common Management Commands](#common-management-commands) section for more Redis tips.

</details>

<details>
<summary><b>❓ Unable to sign in over HTTP?</b></summary>

**Symptom**: When using HTTP (non-localhost), the login page warns about insecure cookies and rejects the session.

**Cause**: By default `ENABLE_SECURE_COOKIES=true`, so cookies are only transmitted over HTTPS. Browsers allow HTTP on localhost but not on remote hosts.

**Solution**:

**Option 1: Use HTTPS (recommended)**

Configure a reverse proxy (e.g., Nginx) with TLS as shown in [How do I configure a reverse proxy (Nginx + HTTPS)?](#-how-do-i-configure-a-reverse-proxy-nginx--https)

**Option 2: Allow HTTP cookies (reduced security)**

Update `.env`:

```bash
ENABLE_SECURE_COOKIES=false
```

Restart the app:

```bash
docker compose restart app
```

⚠️ **Security warning**: Disabling secure cookies permits HTTP transport and should only be used in internal or test environments.

</details>

<details>
<summary><b>❓ Which AI providers are supported?</b></summary>

**Only Claude Code-compatible APIs are supported.**

**Direct support**:

- Providers that natively expose the Claude Code protocol

**Indirect support** (requires [claude-code-router](https://github.com/zsio/claude-code-router) for translation):

- 🔄 Zhipu AI (GLM), Moonshot AI (Kimi), Packy, etc.
- 🔄 Alibaba Qwen, Baidu ERNIE Bot, etc.
- 🔄 Any other non-Claude-Code AI services

</details>

<details>
<summary><b>❓ How do I configure a reverse proxy (Nginx + HTTPS)?</b></summary>

Sample Nginx configuration:

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

After enabling HTTPS, keep `ENABLE_SECURE_COOKIES=true` (the default) to enforce secure cookie transport.

</details>

<details>
<summary><b>❓ How do I use the API documentation?</b></summary>

The platform includes full REST documentation to streamline integrations.

**Access**:

1. Sign in to the admin console
2. Open **Settings → API Documentation**
3. Pick Scalar UI (recommended) or Swagger UI
4. Execute API calls directly from the docs

**Authentication**:

- All endpoints rely on cookie auth
- Sign in through the web UI to obtain a session cookie
- Include the cookie to call any endpoint

**Supported capabilities**:

- 39 REST endpoints
- Full coverage of user, key, provider, pricing, log, and analytics modules
- Interactive testing without extra tooling

**Full documentation**: see [API Documentation Guide](docs/api-documentation.md)

</details>

<details>
<summary><b>❓ Large price tables load slowly?</b></summary>

Version v0.2.21+ introduces pagination for price tables to dramatically improve performance at scale.

**Highlights**:

- 50 rows per page by default
- Model search with built-in debounce to avoid repeated calls
- Page size options: 20 / 50 / 100 / 200 rows
- URL parameters persist, so refreshes keep context

**How to use**:

1. Go to **Settings → Price Management**
2. Filter models with the top search bar
3. Browse via the pagination controls
4. Adjust rows per page as needed

**Performance optimizations**:

- SQL-level pagination prevents full table scans
- 500ms debounced search to cut unnecessary queries
- SSR plus client interactivity for fast first paint

</details>

## 🤝 Contributing

We welcome Issues and Pull Requests!

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 🙏 Credits

This project draws inspiration from the following open-source efforts:

- **[zsio/claude-code-hub](https://github.com/zsio/claude-code-hub)** - Core foundation of this project; thanks to [@zsio](https://github.com/zsio) for the excellent architecture
- **[router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** - The Codex CLI OpenAI compatibility layer builds upon this MIT-licensed implementation

Huge thanks to the authors and contributors of these projects!

## 📄 License

This project uses the [MIT License](LICENSE).

**References**:

- The Codex CLI OpenAI compatibility layer is adapted from [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (MIT)

## 🌟 Star History

If the project helps you, please consider leaving a ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=ding113/claude-code-hub&type=Date)](https://star-history.com/#ding113/claude-code-hub&Date)

## 📞 Support & Feedback

<div align="center">

**[🐛 Report Issues](https://github.com/ding113/claude-code-hub/issues)** •
**[💡 Request Features](https://github.com/ding113/claude-code-hub/issues/new)** •
**[📖 Read the Docs](https://github.com/ding113/claude-code-hub/wiki)**

Based on [zsio/claude-code-hub](https://github.com/zsio/claude-code-hub) • Modified by [ding113](https://github.com/ding113)

</div>
