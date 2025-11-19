# 错误响应格式说明

## 概述

当请求失败时，API 会返回详细的错误信息，包括错误类型、消息和详细信息。

## 响应格式

```json
{
  "error": {
    "message": "用户友好的错误消息",
    "type": "错误类型（HTTP 状态码对应）",
    "code": "具体的错误代码（可选）",
    "details": {
      "额外的调试信息": "..."
    }
  }
}
```

## 限流相关错误

### 1. 所有供应商达到消费限额

**HTTP 状态码：** 503

**响应示例：**
```json
{
  "error": {
    "message": "所有供应商已达消费限额（1 个供应商）",
    "type": "service_unavailable_error",
    "code": "rate_limit_exceeded",
    "details": {
      "totalAttempts": 1,
      "excludedCount": 0,
      "filteredProviders": [
        {
          "id": 46,
          "name": "Vibe Code(Codex)月卡",
          "reason": "rate_limited",
          "details": "费用限制"
        }
      ]
    }
  }
}
```

**说明：**
- `code: "rate_limit_exceeded"` - 表示因为达到消费限额
- `filteredProviders` - 列出所有被过滤的供应商及原因

### 2. 所有供应商熔断器打开

**HTTP 状态码：** 503

**响应示例：**
```json
{
  "error": {
    "message": "所有供应商熔断器已打开（2 个供应商）",
    "type": "service_unavailable_error",
    "code": "circuit_breaker_open",
    "details": {
      "totalAttempts": 1,
      "excludedCount": 0,
      "filteredProviders": [
        {
          "id": 1,
          "name": "供应商A",
          "reason": "circuit_open",
          "details": "熔断器打开"
        },
        {
          "id": 2,
          "name": "供应商B",
          "reason": "circuit_open",
          "details": "熔断器打开"
        }
      ]
    }
  }
}
```

### 3. 混合原因（限额 + 熔断）

**HTTP 状态码：** 503

**响应示例：**
```json
{
  "error": {
    "message": "所有供应商不可用（1 个达限额，1 个熔断）",
    "type": "service_unavailable_error",
    "code": "mixed_unavailable",
    "details": {
      "totalAttempts": 1,
      "excludedCount": 0,
      "filteredProviders": [
        {
          "id": 1,
          "name": "供应商A",
          "reason": "rate_limited",
          "details": "费用限制"
        },
        {
          "id": 2,
          "name": "供应商B",
          "reason": "circuit_open",
          "details": "熔断器打开"
        }
      ]
    }
  }
}
```

### 4. 所有供应商尝试失败

**HTTP 状态码：** 503

**响应示例：**
```json
{
  "error": {
    "message": "所有供应商不可用（尝试了 3 个供应商）",
    "type": "service_unavailable_error",
    "code": "all_providers_failed",
    "details": {
      "totalAttempts": 3,
      "excludedCount": 3
    }
  }
}
```

**说明：**
- 这种情况发生在尝试多个供应商后都失败（如网络错误、超时等）

## 其他常见错误

### 认证错误

**HTTP 状态码：** 401

```json
{
  "error": {
    "message": "Invalid API key",
    "type": "authentication_error"
  }
}
```

### 限流错误（用户/Key 层）

**HTTP 状态码：** 429

```json
{
  "error": {
    "message": "Key 限流：Key 每日消费上限已达到（1.5000/1.0000）",
    "type": "rate_limit_error"
  }
}
```

## 客户端处理建议

### Codex CLI 客户端

```typescript
try {
  const response = await fetch('/v1/responses', {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const error = await response.json();

    // 检查是否是限流错误
    if (error.error?.code === 'rate_limit_exceeded') {
      console.error('❌ 所有供应商已达消费限额');
      console.error('详情:', error.error.message);

      // 显示被限流的供应商
      if (error.error.details?.filteredProviders) {
        console.error('受影响的供应商:');
        error.error.details.filteredProviders.forEach(p => {
          console.error(`  - ${p.name}: ${p.details}`);
        });
      }

      process.exit(1);
    }

    // 其他错误处理...
  }
} catch (err) {
  console.error('请求失败:', err);
}
```

### Web 前端

```typescript
async function handleApiError(response: Response) {
  const error = await response.json();

  // 根据错误代码显示不同的提示
  switch (error.error?.code) {
    case 'rate_limit_exceeded':
      showNotification({
        type: 'error',
        title: '消费限额已达',
        message: error.error.message,
        details: error.error.details?.filteredProviders
      });
      break;

    case 'circuit_breaker_open':
      showNotification({
        type: 'warning',
        title: '服务暂时不可用',
        message: '供应商熔断器已打开，请稍后重试'
      });
      break;

    case 'all_providers_failed':
      showNotification({
        type: 'error',
        title: '所有供应商不可用',
        message: '请联系管理员检查供应商状态'
      });
      break;

    default:
      showNotification({
        type: 'error',
        title: '请求失败',
        message: error.error.message
      });
  }
}
```

## 日志记录

所有错误都会在服务端日志中记录详细信息：

```json
{
  "level": "error",
  "msg": "ProviderSelector: No available providers after trying all candidates",
  "excludedProviders": [],
  "totalAttempts": 1,
  "errorType": "rate_limit_exceeded",
  "filteredProviders": [
    {
      "id": 46,
      "name": "Vibe Code(Codex)月卡",
      "reason": "rate_limited",
      "details": "费用限制"
    }
  ]
}
```

## 前端日志详情页面

在日志记录详情页面，可以解析 `error_message` 字段来显示友好的错误信息：

```typescript
function renderErrorDetails(log: MessageLog) {
  if (log.statusCode === 503 && log.errorMessage) {
    try {
      const error = JSON.parse(log.errorMessage);

      if (error.error?.code === 'rate_limit_exceeded') {
        return (
          <Alert variant="destructive">
            <AlertTitle>消费限额已达</AlertTitle>
            <AlertDescription>
              {error.error.message}
              {error.error.details?.filteredProviders && (
                <ul className="mt-2 list-disc pl-4">
                  {error.error.details.filteredProviders.map(p => (
                    <li key={p.id}>
                      {p.name}: {p.details}
                    </li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        );
      }
    } catch (e) {
      // 解析失败，显示原始消息
      return <div>{log.errorMessage}</div>;
    }
  }

  return <div>{log.errorMessage}</div>;
}
```

## 总结

新的错误响应格式提供了：

1. ✅ **明确的错误类型** - 通过 `code` 字段快速识别错误原因
2. ✅ **用户友好的消息** - `message` 字段提供清晰的中文说明
3. ✅ **详细的调试信息** - `details` 字段包含完整的上下文
4. ✅ **前端易于处理** - 结构化的 JSON 格式便于解析和显示
5. ✅ **CLI 友好** - 错误信息足够详细，便于命令行显示

这使得无论是 Web 前端、CLI 客户端还是日志系统，都能提供更好的用户体验。
