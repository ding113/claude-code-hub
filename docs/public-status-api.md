# Public Status API

## 概述

Claude Code Hub 提供两条无需认证的公开状态接口：

- `GET /api/public-status`
- `GET /api/public-site-meta`

这两条接口只返回公开安全字段，用于 `/status` 页面、外部状态看板和轻量监控集成。它们不会暴露内部 provider 名称、endpoint 地址、原始错误细节或任何管理员专用配置。

OpenAPI 与在线文档入口：

- 原始 OpenAPI JSON：`/api/actions/openapi.json`
- Swagger UI：`/api/actions/docs`
- Scalar UI：`/api/actions/scalar`

## `GET /api/public-status`

### 用途

返回公开状态投影，支持窗口参数、分组过滤、模型过滤、状态过滤、文本搜索和字段裁剪。

### 认证

无需认证，不需要 Cookie，也不需要 Bearer Token。

### 查询参数

- `interval`
  - 允许整数分钟，或兼容旧格式的 `Xm`
  - 允许窗口：`5`、`15`、`30`、`60`
  - 数值超出允许集合时，会夹取到最近值；若距离相同，取更大的窗口
  - 非数字语法返回 `400`
- `rangeHours`
  - 允许整数小时
  - 缺省使用 projection 默认值
  - 最终夹取到 `[1, 168]`
  - 非数字语法返回 `400`
- `groupSlug`
  - 单个公开分组 slug 精确过滤
- `groupSlugs`
  - 逗号分隔的多个公开分组 slug
- `model`
  - 单个公开模型标识或展示名精确过滤
- `models`
  - 逗号分隔的多个公开模型标识或展示名
- `status`
  - 逗号分隔
  - 允许值：`operational`、`degraded`、`failed`、`no_data`
- `q`
  - 文本搜索
  - 搜索范围：公开分组名称、slug、模型展示名、模型标识
- `include`
  - 逗号分隔
  - 允许值：`meta`、`defaults`、`groups`、`timeline`
  - 缺省返回全部公开字段

### 成功响应字段

- `generatedAt`
- `freshUntil`
- `status`
  - `ready`
  - `stale`
  - `rebuilding`
  - `no_snapshot`
  - `no_data`
- `rebuildState`
  - `state`
  - `hasSnapshot`
  - `reason`
- `defaults`
- `resolvedQuery`
- `meta`
- `groups`

### 行为约定

- projection 有数据时，返回 `200`
- 正在重建但当前没有可服务快照时，仍返回 `200`，并通过 `status="no_snapshot"` 与 `rebuildState.hasSnapshot=false` 明确表达
- Redis 或投影读取不可用且无法退化为 projection-missing 语义时，返回 `503`
- 查询参数不合法时，返回 `400`

### 示例：正常过滤请求

```bash
curl "http://localhost:23000/api/public-status?groupSlug=anthropic&status=failed&include=meta,defaults,groups,timeline"
```

```json
{
  "generatedAt": "2026-04-23T04:00:00.000Z",
  "freshUntil": "2026-04-23T04:05:00.000Z",
  "status": "ready",
  "rebuildState": {
    "state": "fresh",
    "hasSnapshot": true,
    "reason": null
  },
  "defaults": {
    "intervalMinutes": 5,
    "rangeHours": 24
  },
  "resolvedQuery": {
    "intervalMinutes": 5,
    "rangeHours": 24,
    "groupSlugs": [
      "anthropic"
    ],
    "models": [],
    "statuses": [
      "failed"
    ],
    "q": null,
    "include": [
      "meta",
      "defaults",
      "groups",
      "timeline"
    ]
  },
  "meta": {
    "siteTitle": "Claude Code Hub",
    "siteDescription": "Claude Code Hub public status",
    "timeZone": "UTC"
  },
  "groups": []
}
```

### 示例：无快照但已排队重建

```json
{
  "generatedAt": null,
  "freshUntil": null,
  "status": "no_snapshot",
  "rebuildState": {
    "state": "rebuilding",
    "hasSnapshot": false,
    "reason": null
  },
  "defaults": {
    "intervalMinutes": 5,
    "rangeHours": 24
  },
  "resolvedQuery": {
    "intervalMinutes": 5,
    "rangeHours": 24,
    "groupSlugs": [],
    "models": [],
    "statuses": [],
    "q": null,
    "include": [
      "meta",
      "defaults",
      "groups",
      "timeline"
    ]
  },
  "meta": null,
  "groups": []
}
```

### 示例：非法过滤参数

```bash
curl "http://localhost:23000/api/public-status?status=unknown"
```

```json
{
  "error": "Invalid public status query parameters",
  "details": [
    {
      "field": "status",
      "code": "invalid_enum",
      "message": "status must be one of: operational, degraded, failed, no_data",
      "value": "unknown"
    }
  ]
}
```

## `GET /api/public-site-meta`

### 用途

返回公开站点标题、描述与时区，只读取 public-status projection。

### 认证

无需认证。

### 成功响应

- `available`
- `siteTitle`
- `siteDescription`
- `timeZone`
- `source`
- `reason`
  - 仅在 projection 缺失时出现

### 示例：projection 可用

```bash
curl "http://localhost:23000/api/public-site-meta"
```

```json
{
  "available": true,
  "siteTitle": "Claude Code Hub",
  "siteDescription": "Claude Code Hub public status",
  "timeZone": "UTC",
  "source": "projection"
}
```

### 示例：projection 缺失

```json
{
  "available": false,
  "siteTitle": null,
  "siteDescription": null,
  "timeZone": null,
  "source": "projection",
  "reason": "projection_missing"
}
```

## 数据来源边界

公开状态接口只消费 public-status projection 及其对应的公开配置，不在运行时回退到默认 helper 或数据库读取。

投影内容覆盖以下公开来源：

- `message_request`
- `provider_groups.description`
- `model_prices`
- `system_settings`

这些来源在投影生成阶段会被裁剪成公开安全字段；运行时 public API 只读投影，不再直接访问这些表。
