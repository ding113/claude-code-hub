# API 认证使用指南

## 📋 概述

Claude Code Hub 的所有 API 端点通过 **HTTP Cookie** 进行认证，Cookie 名称为 `auth-token`。

## 🔐 认证方式

### 方法 1：通过 Web UI 登录（推荐）

这是最简单的认证方式，适合在浏览器中测试 API。

**步骤：**

1. 访问 Claude Code Hub 登录页面（通常是 `http://localhost:23000` 或您部署的域名）
2. 使用您的 API Key 或管理员令牌（ADMIN_TOKEN）登录
3. 登录成功后，浏览器会自动设置 `auth-token` Cookie（有效期 7 天）
4. 在同一浏览器中访问 API 文档页面即可直接测试（Cookie 自动携带）

**优点：**
- ✅ 无需手动处理 Cookie
- ✅ 可以直接在 Scalar/Swagger UI 中测试 API
- ✅ 浏览器自动管理 Cookie 的生命周期

### 方法 2：手动获取 Cookie（用于脚本或编程调用）

如果需要在脚本、自动化工具或编程环境中调用 API，需要手动获取并设置 Cookie。

**步骤：**

1. 先通过浏览器登录 Claude Code Hub
2. 打开浏览器开发者工具（按 F12 键）
3. 切换到以下标签页之一：
   - Chrome/Edge: `Application` → `Cookies`
   - Firefox: `Storage` → `Cookies`
   - Safari: `Storage` → `Cookies`
4. 在 Cookie 列表中找到 `auth-token`
5. 复制该 Cookie 的值（例如：`cch_1234567890abcdef...`）
6. 在 API 调用中通过 HTTP Header 携带该 Cookie

**优点：**
- ✅ 适合自动化脚本和后台服务
- ✅ 可以在任何支持 HTTP 请求的环境中使用
- ✅ 便于集成到 CI/CD 流程

## 💻 使用示例

### curl 示例

```bash
# 基本用法：通过 Cookie Header 认证
curl -X POST 'http://localhost:23000/api/actions/users/getUsers' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: auth-token=your-token-here' \
  -d '{}'

# 使用 -b 参数（curl 的 Cookie 简写）
curl -X POST 'http://localhost:23000/api/actions/users/getUsers' \
  -H 'Content-Type: application/json' \
  -b 'auth-token=your-token-here' \
  -d '{}'

# 从文件读取 Cookie
curl -X POST 'http://localhost:23000/api/actions/users/getUsers' \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{}'
```

### JavaScript (fetch) 示例

#### 浏览器环境（推荐）

```javascript
// Cookie 自动携带，无需手动设置
fetch('/api/actions/users/getUsers', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include', // 重要：告诉浏览器携带 Cookie
  body: JSON.stringify({}),
})
  .then(res => res.json())
  .then(data => {
    if (data.ok) {
      console.log('成功:', data.data);
    } else {
      console.error('失败:', data.error);
    }
  });
```

#### Node.js 环境

```javascript
const fetch = require('node-fetch');

// 手动设置 Cookie
fetch('http://localhost:23000/api/actions/users/getUsers', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': 'auth-token=your-token-here',
  },
  body: JSON.stringify({}),
})
  .then(res => res.json())
  .then(data => {
    if (data.ok) {
      console.log('成功:', data.data);
    } else {
      console.error('失败:', data.error);
    }
  });
```

### Python 示例

#### 使用 requests 库

```python
import requests

# 方式 1：使用 Session（推荐，自动管理 Cookie）
session = requests.Session()
session.cookies.set('auth-token', 'your-token-here')

response = session.post(
    'http://localhost:23000/api/actions/users/getUsers',
    json={},
)

if response.json()['ok']:
    print('成功:', response.json()['data'])
else:
    print('失败:', response.json()['error'])

# 方式 2：直接在 headers 中设置 Cookie
response = requests.post(
    'http://localhost:23000/api/actions/users/getUsers',
    json={},
    headers={
        'Content-Type': 'application/json',
        'Cookie': 'auth-token=your-token-here'
    }
)
```

#### 使用 httpx 库（异步支持）

```python
import httpx

async def get_users():
    async with httpx.AsyncClient() as client:
        response = await client.post(
            'http://localhost:23000/api/actions/users/getUsers',
            json={},
            headers={
                'Cookie': 'auth-token=your-token-here'
            }
        )
        return response.json()

# 使用示例
import asyncio
result = asyncio.run(get_users())
```

### Go 示例

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
)

func main() {
    url := "http://localhost:23000/api/actions/users/getUsers"

    // 创建请求体
    body := bytes.NewBuffer([]byte("{}"))

    // 创建请求
    req, err := http.NewRequest("POST", url, body)
    if err != nil {
        panic(err)
    }

    // 设置 Headers
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Cookie", "auth-token=your-token-here")

    // 发送请求
    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        panic(err)
    }
    defer resp.Body.Close()

    // 解析响应
    respBody, _ := io.ReadAll(resp.Body)
    var result map[string]interface{}
    json.Unmarshal(respBody, &result)

    if result["ok"].(bool) {
        fmt.Println("成功:", result["data"])
    } else {
        fmt.Println("失败:", result["error"])
    }
}
```

## ⚠️ 常见问题

### 1. 401 Unauthorized - "未认证"

**原因：** 缺少 `auth-token` Cookie

**解决方法：**
- 确认请求中包含了 `Cookie: auth-token=...` Header
- 检查 Cookie 值是否正确（不要包含额外的空格或换行符）
- 在浏览器环境确保设置了 `credentials: 'include'`

### 2. 401 Unauthorized - "认证无效或已过期"

**原因：** Cookie 无效、已过期或已被撤销

**解决方法：**
- 重新登录获取新的 `auth-token`
- 检查用户账号是否被禁用
- 确认 API Key 是否设置了 `canLoginWebUi` 权限

### 3. 403 Forbidden - "权限不足"

**原因：** 当前用户没有访问该端点的权限

**解决方法：**
- 检查端点是否需要管理员权限（标记为 `[管理员]`）
- 使用管理员账号登录（使用 `ADMIN_TOKEN` 或具有 admin 角色的用户）

### 4. 浏览器环境 Cookie 未自动携带

**原因：** 未设置 `credentials: 'include'`

**解决方法：**
```javascript
fetch('/api/actions/users/getUsers', {
  credentials: 'include', // 添加这一行
  // ... 其他配置
})
```

### 5. 跨域请求 Cookie 问题

**原因：** CORS 策略限制

**解决方法：**
- 确保 API 服务器配置了正确的 CORS 策略
- 在前端请求中设置 `credentials: 'include'`
- 使用相同域名或配置服务器允许跨域 Cookie

## 🔒 安全最佳实践

1. **不要在公共场合分享 Cookie 值**
   - `auth-token` 相当于您的登录凭证
   - 泄露后他人可以冒充您的身份操作系统

2. **定期更换 API Key**
   - Cookie 有效期为 7 天
   - 到期后需要重新登录

3. **使用 HTTPS**
   - 生产环境务必启用 HTTPS
   - 确保 `ENABLE_SECURE_COOKIES=true`（默认值）

4. **环境变量管理**
   - 将 Cookie 值存储在环境变量中
   - 不要硬编码在代码仓库中

## 📚 相关资源

- [OpenAPI 文档](/api/actions/docs) - Swagger UI
- [Scalar API 文档](/api/actions/scalar) - 现代化 API 文档界面
- [GitHub 仓库](https://github.com/ding113/claude-code-hub) - 查看源码和更多文档
