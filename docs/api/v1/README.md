# Claude Code Hub Management API (v1)

`/api/v1/*` 是 Claude Code Hub 的官方管理 API（Management API），用于以纯 REST 风格管理用户、密钥、供应商、模型价格、通知、Webhook、日志、会话等资源。

> 提示：v1 是**管理面**，与下列 API 在路径、用途、认证策略上严格隔离，请勿混用。

| API 表面          | 路径前缀         | 用途                                            | 状态        |
| ----------------- | ---------------- | ----------------------------------------------- | ----------- |
| 代理 API          | `/v1/*`          | OpenAI / Anthropic 兼容的请求转发（业务流量）   | 稳定        |
| 管理 API（本文） | `/api/v1/*`      | 资源管理、统计查询、控制面动作                  | 稳定（v1） |
| 旧版 Actions API  | `/api/actions/*` | 旧版 Server Actions 桥接接口                    | 已弃用     |

---

## 一、认证（Authentication）

`/api/v1/*` 支持三种认证方式，按优先级取第一个非空者：

1. **`Authorization: Bearer <token>`**（推荐用于脚本/CLI）
2. **`X-Api-Key: <token>`**（推荐用于第三方系统集成）
3. **`Cookie: auth-token=...`**（Web UI 登录后自动携带）

`<token>` 的取值与登录系统一致：可以是 `ADMIN_TOKEN`（管理员）或某个用户密钥（user API key）。

### 三个权限分层（Access Tiers）

| Tier        | 描述                            | 典型端点                                           |
| ----------- | ------------------------------- | -------------------------------------------------- |
| `public`    | 完全公开，不要求认证            | `GET /api/v1/public/status`                        |
| `read`      | 任意有效身份均可访问            | `GET /api/v1/auth/csrf`、`GET /api/v1/me/*`        |
| `admin`     | 仅管理员（`role=admin`）可调用 | `GET /api/v1/users`、`POST /api/v1/providers` 等  |

> 安全注意：默认情况下，`admin` tier 仅接受 Cookie 会话或 `ADMIN_TOKEN`。若需让用户 API key 也可访问 admin 端点（用于第三方 SDK 集成），需要显式开启 `ENABLE_API_KEY_ADMIN_ACCESS=true`。详见 [API Key Admin Access 安全权衡](../../security/api-key-admin-access.md)。

---

## 二、CSRF 保护（仅 Cookie 通道）

为防御跨站请求伪造，所有 cookie-auth 的写方法（POST/PUT/PATCH/DELETE）必须携带 CSRF 令牌。

1. **获取令牌**：`GET /api/v1/auth/csrf`，响应形如：
   ```json
   { "csrfToken": "<token>", "mode": "cookie" }
   ```
2. **写请求时回传**：在请求头中附加 `X-CCH-CSRF: <token>`。
3. **API key / Bearer 通道**：`mode` 返回 `"api-key"` / `"admin-token"`，`csrfToken` 为 `null`。这些通道不受 CSRF 保护，但建议结合 IP 限制与短期密钥轮换降低风险。

---

## 三、错误信封：RFC 9457 problem+json

所有 4xx/5xx 错误响应均使用 `Content-Type: application/problem+json`，结构如下：

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Validation failed: name must be at least 3 characters.",
  "instance": "/api/v1/users",
  "errorCode": "VALIDATION_FAILED",
  "errors": [{ "field": "name", "code": "TOO_SHORT" }]
}
```

- `errorCode` 是稳定字符串（不随翻译变化），前端使用它在 i18n 资源里查表显示对应文案。
- 校验失败 (`VALIDATION_FAILED`) 会在 `errors` 数组中给出具体字段。

---

## 四、分页约定

| 模式                 | 适用资源                                       | 关键字段                                    |
| -------------------- | ---------------------------------------------- | ------------------------------------------- |
| **Cursor 游标**      | 高速增长的不可变流（usage-logs、audit-logs、sessions） | `cursor` / `pageSize`，响应 `pageInfo.nextCursor` |
| **page + limit**     | 静态/低频资源（model-prices catalog、tags 等） | `page` / `limit`                            |

---

## 五、OpenAPI 文档与交互式 UI

| URL                       | 用途                                |
| ------------------------- | ----------------------------------- |
| `GET /api/v1/openapi.json` | 完整 OpenAPI 3.1 JSON               |
| `GET /api/v1/scalar`      | Scalar UI（推荐，支持 try-it-now） |
| `GET /api/v1/docs`        | Swagger UI                          |
| `GET /api/v1/health`      | 管理 API 自身的轻量健康探针         |

---

## 六、典型 curl 示例

### 6.1 列出用户（X-Api-Key + admin）

```bash
curl -s 'http://localhost:13500/api/v1/users?page=0&limit=20' \
  -H 'X-Api-Key: <ADMIN_TOKEN_OR_ADMIN_USER_KEY>' \
  -H 'Accept: application/json'
```

### 6.2 揭示供应商真密钥（issue #1123）

```bash
curl -s 'http://localhost:13500/api/v1/providers/42/key:reveal' \
  -H 'Authorization: Bearer <ADMIN_TOKEN>' \
  -H 'Accept: application/json'
```

> 该端点为唯一披露明文密钥的入口，其余 list/detail 均不返回明文，且每次调用会写入 audit log。

### 6.3 Cookie 通道下的 CSRF 往返

```bash
# 1. 取令牌（Cookie 已通过浏览器登录获得）
TOKEN=$(curl -s --cookie "auth-token=<auth-token>" \
  'http://localhost:13500/api/v1/auth/csrf' | jq -r .csrfToken)

# 2. 携带 X-CCH-CSRF 写资源
curl -s -X PATCH 'http://localhost:13500/api/v1/users/3' \
  --cookie "auth-token=<auth-token>" \
  -H "X-CCH-CSRF: ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"note": "VIP"}'
```

---

## 七、相关环境变量

| 变量名                          | 默认值        | 说明                                                                 |
| ------------------------------- | ------------- | -------------------------------------------------------------------- |
| `ENABLE_LEGACY_ACTIONS_API`     | `true`        | 旧版 `/api/actions/*` 是否仍可调用（迁移期默认开启，仅附加废弃头）  |
| `LEGACY_ACTIONS_DOCS_MODE`      | `deprecated` | `deprecated` 仍展示旧文档；`hidden` 旧文档返回 404                  |
| `LEGACY_ACTIONS_SUNSET_DATE`    | `2026-12-31` | 旧 API 计划下线日期（写入 `Sunset` 响应头）                          |
| `ENABLE_API_KEY_ADMIN_ACCESS`   | `false`       | 是否允许 admin 用户的 API key 访问 admin tier 端点（默认关闭）       |

---

## 八、迁移与文档导航

- 旧版 → 新版完整端点对照表：参见 [migration-guide.md](./migration-guide.md)。
- API key 访问管理面的安全权衡：参见 [../../security/api-key-admin-access.md](../../security/api-key-admin-access.md)。
- 一般认证用法（Cookie/Bearer 取得方式）：参见 [../../api-authentication-guide.md](../../api-authentication-guide.md)。
- 公开状态 API 契约：参见 [../../public-status-api.md](../../public-status-api.md)。
