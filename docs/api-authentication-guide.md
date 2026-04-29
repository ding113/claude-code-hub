# API 认证使用指南

## 概述

Claude Code Hub 的新版管理 API 位于 `/api/v1/*`。它和代理 API `/v1/*`
互相独立，也和已弃用的 Server Action 适配层 `/api/actions/*` 独立。

新版管理 API 支持三种凭据传递方式：

- Cookie session：`Cookie: auth-token=<session>`
- Bearer token：`Authorization: Bearer <token>`
- 用户 API Key：`X-Api-Key: <key>`

访问权限按路由分为三层：

- `public`：无需认证，例如 `GET /api/v1/public/status`。
- `read`：接受有效 session、`ADMIN_TOKEN` 或任意有效用户 API Key。
- `admin`：默认接受有效 session Cookie、opaque session bearer token 和
  `ADMIN_TOKEN`。用户 API Key 仅在 `ENABLE_API_KEY_ADMIN_ACCESS=true` 且属于
  admin 用户时可调用 admin 路由。

Cookie 认证的写操作需要 CSRF 保护：先调用 `GET /api/v1/auth/csrf`，再在
`POST`、`PUT`、`PATCH`、`DELETE` 请求中携带 `X-CCH-CSRF`。Bearer 和
`X-Api-Key` 请求不需要 CSRF header。

生产环境建议显式配置 `CSRF_SECRET`。多副本部署必须让所有实例使用同一个
`CSRF_SECRET`，否则一个实例签发的 cookie 写操作 token 可能无法被另一个实例验证。

旧版 `/api/actions/*` 仍可用但已弃用，响应会带标准 `Deprecation`、`Sunset`
与指向 `/api/v1/openapi.json` 的 successor `Link`。设置
`ENABLE_LEGACY_ACTIONS_API=false` 后，旧 action 执行接口返回
`410 application/problem+json`。

## Cookie Session

适合浏览器内测试和 Scalar/Swagger UI。

1. 访问 Claude Code Hub 登录页面。
2. 使用 `ADMIN_TOKEN` 或允许 Web UI 登录的用户 API Key 登录。
3. 浏览器会设置 `auth-token` Cookie。
4. 在同一浏览器访问 `/api/v1/scalar` 或 `/api/v1/docs`，文档页会自动携带
   Cookie。

Cookie 写操作示例：

```bash
csrf_token="$(curl -s 'http://localhost:13500/api/v1/auth/csrf' \
  -b 'auth-token=your-session-token' | jq -r '.csrfToken')"

curl -X PATCH 'http://localhost:13500/api/v1/users/1' \
  -H 'Content-Type: application/json' \
  -H "X-CCH-CSRF: ${csrf_token}" \
  -b 'auth-token=your-session-token' \
  -d '{"note":"updated by REST API"}'
```

浏览器 fetch 示例：

```javascript
const csrf = await fetch("/api/v1/auth/csrf", {
  credentials: "include",
}).then((res) => res.json());

const user = await fetch("/api/v1/users/1", {
  method: "PATCH",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "X-CCH-CSRF": csrf.csrfToken,
  },
  body: JSON.stringify({ note: "updated by REST API" }),
}).then(async (res) => {
  if (!res.ok) throw await res.json();
  return res.json();
});

console.log(user);
```

## Bearer Token

适合脚本、CLI 和服务端 SDK。

```bash
curl 'http://localhost:13500/api/v1/users?limit=20' \
  -H 'Authorization: Bearer your-session-or-admin-token'
```

Node.js 示例：

```javascript
const response = await fetch("http://localhost:13500/api/v1/users?limit=20", {
  headers: {
    Authorization: `Bearer ${process.env.CCH_TOKEN}`,
  },
});

if (!response.ok) {
  const problem = await response.json();
  throw new Error(`${problem.errorCode}: ${problem.detail}`);
}

const page = await response.json();
console.log(page.users ?? page.items ?? page);
```

## X-Api-Key

适合第三方工具读取自身范围内的数据。

```bash
curl 'http://localhost:13500/api/v1/me/quota' \
  -H 'X-Api-Key: your-user-api-key'
```

admin 路由默认不接受用户 API Key。确需允许第三方管理工具通过 admin 用户
API Key 调用管理端接口时，必须显式设置：

```bash
ENABLE_API_KEY_ADMIN_ACCESS=true
```

开启后仍要求该 API Key 对应的用户角色为 `admin`。普通用户 API Key 不能调
admin 路由。

## 响应格式

成功响应直接返回资源或列表对象，不再使用 legacy `{ ok, data }` 包装。

```json
{
  "users": [
    {
      "id": 1,
      "name": "admin",
      "role": "admin"
    }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

失败响应使用 `application/problem+json`：

```json
{
  "type": "urn:claude-code-hub:problem:auth.forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "Admin access is required.",
  "instance": "/api/v1/providers",
  "errorCode": "auth.forbidden",
  "errorParams": {}
}
```

前端和第三方客户端应优先使用 `errorCode` 和 `errorParams` 做错误分支与本地化，
不要依赖 `detail` 的展示语言。

## 常见问题

### 401 Unauthorized

请求没有携带凭据，或凭据无效、过期、已撤销。

处理方式：

- Cookie 模式确认请求携带 `Cookie: auth-token=...`。
- 浏览器 fetch 确认设置 `credentials: "include"`。
- Bearer 模式确认使用 `Authorization: Bearer <token>`。
- `X-Api-Key` 模式确认 key 未被禁用、未过期。

### 403 Forbidden

当前身份没有访问该路由的权限。

处理方式：

- admin 路由使用管理员 session 或 `ADMIN_TOKEN`。
- 用户 API Key 调 admin 路由前确认 `ENABLE_API_KEY_ADMIN_ACCESS=true`，且 key
  所属用户为 admin。
- Cookie 写操作确认已携带当前 session 对应的 `X-CCH-CSRF`。

### 404 Not Found

资源不存在，或该资源属于已隐藏/已弃用类型。新版 `/api/v1` 不暴露
`claude-auth` 与 `gemini-cli` provider 类型。

## 相关资源

- OpenAPI JSON：`/api/v1/openapi.json`
- Swagger UI：`/api/v1/docs`
- Scalar UI：`/api/v1/scalar`
- Public Status API：`public-status-api.md`
- API Key admin access 安全说明：`security/api-key-admin-access.md`
- GitHub 仓库：`https://github.com/ding113/claude-code-hub`
