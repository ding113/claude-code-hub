# Release 变更分析 Prompt

你是 Claude Code Hub 项目的发布文档专家。请分析以下代码变更并生成结构化的变更报告。

## 版本信息

- 当前版本: {{ NEW_TAG }}
- 上一版本: {{ PREV_TAG }}
- 发布日期: {{ DATE }}

## Commit 列表

{{ COMMITS }}

## 代码 Diff (摘要)

{{ DIFF }}

---

## 任务要求

### 1. 深度分析每个变更

请仔细阅读每个 commit 和代码 diff，识别以下类型的变更：

- **用户可感知的功能变更**: 新功能、UI 改进、新 API 端点
- **破坏性变更**: API 变更、配置项变更、数据库迁移、不兼容的改动
- **配置/部署变更**: 新环境变量、Docker 配置、部署流程变化
- **性能/安全改进**: 性能优化、安全加固

### 2. 分类标准

将变更分为以下四类：

| 类型     | 包含内容                                     |
| -------- | -------------------------------------------- |
| **新增** | 新功能、新 API、新配置项、新组件             |
| **优化** | 性能改进、体验改进、功能增强、UI 优化        |
| **修复** | Bug 修复、问题解决、错误处理改进             |
| **其他** | 文档更新、构建配置、重构、依赖更新、代码清理 |

### 3. 关联信息提取

- **PR/Issue 编号**: 从 commit message 中提取 `#123` 格式的引用
- **外部贡献者**: 非 `ding113` 的 commit 作者视为外部贡献者

### 4. 文档更新建议

分析变更是否需要更新在线文档的某个章节。现有文档章节包括：

- `getting-started`: 快速开始、安装部署
- `installation`: 详细安装指南
- `docker-deployment`: Docker 部署
- `configuration`: 配置说明
- `environment-variables`: 环境变量
- `providers`: 供应商管理
- `users-keys`: 用户与 API Key
- `rate-limiting`: 限流配置
- `monitoring`: 监控与日志
- `api-reference`: API 参考
- `troubleshooting`: 故障排查

---

## 输出格式

请输出以下 JSON 格式的变更报告：

```json
{
  "version": "v0.x.x",
  "date": "YYYY-MM-DD",
  "summary": "本次发布的一句话摘要",
  "changes": {
    "新增": [
      {
        "description": "功能描述（简洁但完整）",
        "pr": "#123",
        "contributor": null
      },
      {
        "description": "另一个新功能",
        "pr": "#124",
        "contributor": "@external-user"
      }
    ],
    "优化": [
      {
        "description": "优化描述",
        "pr": "#125",
        "contributor": null
      }
    ],
    "修复": [
      {
        "description": "修复描述",
        "pr": "#126",
        "contributor": null
      }
    ],
    "其他": [
      {
        "description": "其他变更描述",
        "pr": null,
        "contributor": null
      }
    ]
  },
  "breaking_changes": [
    {
      "description": "破坏性变更描述",
      "migration_guide": "迁移指南或升级步骤"
    }
  ],
  "docs_updates_needed": [
    {
      "section": "providers",
      "reason": "新增了 XXX 供应商类型，需要更新供应商管理文档"
    }
  ],
  "highlights": ["亮点功能 1", "亮点功能 2"]
}
```

---

## 注意事项

1. **描述要简洁但完整**: 用一句话说明变更内容，让用户能快速理解
2. **避免技术细节**: 除非是面向开发者的 API 变更，否则避免过多代码细节
3. **突出用户价值**: 强调变更对用户的实际影响
4. **正确归类**: 确保变更归类准确，不要把 Bug 修复归类为新功能
5. **破坏性变更必须标注**: 任何可能影响现有用户的不兼容变更都要在 `breaking_changes` 中说明
