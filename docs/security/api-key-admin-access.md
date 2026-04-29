# API Key Admin Access — Security Trade-off

> 适用范围：环境变量 `ENABLE_API_KEY_ADMIN_ACCESS`（默认 `false`）
> 影响表面：`/api/v1/*`（管理 API），admin tier 端点

本文档说明 `ENABLE_API_KEY_ADMIN_ACCESS` 的安全语义、威胁模型、审计现状与生产环境推荐。

## 默认行为（推荐）

`ENABLE_API_KEY_ADMIN_ACCESS=false` 时：

- `admin` tier 端点（如 `POST /api/v1/users`、`POST /api/v1/providers`、`GET /api/v1/providers/{id}/key:reveal` 等）只接受两类身份：
  1. **登录会话**：`Cookie: auth-token=...`，并强制 `X-CCH-CSRF` 头校验。
  2. **管理员令牌**：`Authorization: Bearer <ADMIN_TOKEN>` 或 `X-Api-Key: <ADMIN_TOKEN>`。
- 用户层面的 API key（`role=user` 或 `role=admin` 用户的 user keys）即便附在 `X-Api-Key` 头上，访问 admin tier 时也会被拒绝（401/403）。
- `read` tier 与 `public` tier 不受影响：所有有效 API key 仍可调用其本人范围内的 `/api/v1/me/*` 等读端点。

## 开启后的行为

`ENABLE_API_KEY_ADMIN_ACCESS=true` 时：

- 在前述基础上，**额外允许** 拥有者 `role=admin` 的用户 API key 访问 admin tier 端点（同样可走 `Authorization: Bearer` 或 `X-Api-Key`）。
- 适用场景：第三方 SDK、CI 脚本、外部 dashboard 需要程序化调用管理 API，但又不便分发 `ADMIN_TOKEN`。

## 威胁模型与代价

启用后，以下风险显著上升：

1. **密钥即超管会话**。一旦某个 admin 用户的 API key 泄漏（被截获、提交到代码仓库、记录在客户端日志……），攻击者立即拥有与登录会话等价的破坏力，可创建/删除用户、揭示供应商真密钥、修改通知绑定等。
2. **吊销路径变长**。Cookie 会话可由用户主动登出或服务端 server-side 失效；而被泄漏的 API key 必须通过数据库层手动 `DELETE` 对应密钥行（或调用 `DELETE /api/v1/keys/{id}`），中间窗口内攻击仍可继续。
3. **CSRF 防御被绕过**。CSRF 仅保护 cookie 通道；API key 调用本身不经过浏览器，CSRF 中间件会跳过校验。攻击者持有 key 即可直接发起任何写请求。
4. **横向影响**。admin 用户的 key 可能同时是一个低敏感场景下分发出去的密钥（例如开发自测），现在它隐式获得了管理面写权限。

## 审计可见性

`/api/v1/*` 已经全程接入 `runWithRequestContext`，即每次 admin tier 写请求都会写入 audit log（`audit_logs` 表），字段包含：

- 调用身份：`actorUserId`、`keyId`（若是 API key 通道）、`authMode`（`session` / `api-key` / `admin-token`）。
- 网络上下文：`clientIp`、`userAgent`。
- 操作数据：`module`、`action`、`requestSummary`（脱敏后的入参）、`responseStatus`。

> 审计可以检测和追溯被滥用的 API key，但不能在事前阻止滥用。换言之，开启此开关后，运营方需要承诺尽快响应审计告警，并具备紧急吊销密钥的运维剧本。

## 生产环境建议

- **保持默认 `false`** 是最安全的策略。Web UI 内部的所有写操作均通过 Cookie + CSRF 完成，并不依赖此开关。
- 仅当存在以下需求之一时考虑开启：
  - 第三方 SDK / 自动化脚本必须通过 `X-Api-Key` 调用管理 API；
  - 该 SDK 不能在每次部署时重新读取 `ADMIN_TOKEN`；
  - 已经为 admin 用户配置了**短期、单一用途、强 IP 限定**的 API key。
- 开启时同时建议：
  - 为 admin 用户的 API key 设置严格的 `expiresAt`、`limit5hUsd`、`limitDailyUsd`，限制即便泄漏的爆炸半径。
  - 在网关或反向代理层为 `/api/v1/*` 增加 IP allowlist。
  - 监控 audit log 中 `authMode=api-key` 且 access tier 为 `admin` 的写操作，配置异常告警。

## 相关阅读

- [v1 README](../api/v1/README.md) — 介绍三种认证方式与三个 access tier。
- [migration-guide](../api/v1/migration-guide.md) — 旧 `/api/actions/*` → 新 `/api/v1/*` 端点对照。
- [api-authentication-guide](../api-authentication-guide.md) — 通用认证用法与 cookie 获取流程。
