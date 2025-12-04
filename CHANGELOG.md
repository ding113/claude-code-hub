# 更新日志

本页面记录 Claude Code Hub 的所有版本变更，按时间倒序排列。

---

## [v0.3.24](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.24) - 2025-12-04

### 修复

- 增强熔断器 Redis 状态同步逻辑，非关闭状态下始终检查 Redis 以同步外部重置操作 (#267)

### 其他

- 更新项目依赖

---

## [v0.3.23](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.23) - 2025-12-04

### 新增

- 仪表盘新增今日排行榜组件，便于快速查看当日消费情况
- 用户配额页面增强：添加总消费统计展示和组件重构优化
- 新增 `MAX_RETRY_ATTEMPTS_DEFAULT` 环境变量，支持配置单供应商最大尝试次数 (#237)

### 优化

- 优化用户配额显示组件布局，提升信息展示效率
- 移除废弃的密钥标签页，优化 UI 间距使界面更紧凑

### 修复

- 修复供应商设置页面熔断器状态显示不正确的问题
- 修复供应商管理页面熔断器状态不显示的问题
- 修复新供应商熔断器默认返回 CLOSED 状态的问题
- 修复密钥编辑时每日重置模式（dailyResetMode）未正确保存的问题
- 修复今日排行榜权限检查和供应商列表分页问题
- 修复日语和繁体中文的熔断器相关翻译错误
- 修复 Claude 工作流中非写入用户权限问题

### 其他

- 更新 LiteLLM 价格数据（litellm-prices.json）
- 移除排行榜 API 中无法访问的死代码

---

## [v0.3.22](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.22) - 2025-12-02

### 新增

- 用户和 Key 新增总消费上限（limitTotalUsd）字段，支持设置历史累计消费限制 (#257)
- Codex 供应商支持通过 `prompt_cache_key` 实现 Session 绑定，提升缓存命中率 (#257)
- 全局 HTTP/2 开关配置，支持启用/禁用 HTTP/2 并自动降级处理 (#257)
- 添加 AGENTS.md 项目文档

### 优化

- 总消费限额检查优化：使用 Redis 缓存（5 分钟 TTL）减少数据库查询，并根据时间边界智能选择查询范围 (#257)
- 日志页面时间筛选组件重构：将 datetime 输入替换为紧凑型日期范围选择器，支持前后翻页和自定义范围 (#257)
- 供应商创建时默认启用，减少手动操作步骤 (#257)
- 合并 PR 工作流为三个统一 Action，简化 CI/CD 配置 (#257)
- 供应商组件新增剪贴板访问权限处理，提升复制功能兼容性 (#257)

### 修复

- 修复系统设置 i18n 翻译和保存时机问题 (#257)
- 修复分组筛选器中逗号分隔的标签解析错误 (#257)
- 修复排行榜周度数据的日期条件查询错误 (#257)

### 其他

- GitHub 工作流增强：优化分支同步机制
- 代码格式化更新

---

## [v0.3.21](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.21) - 2025-12-02

### 优化

- 增强数据库安全性：Docker Compose 中 PostgreSQL 端口默认不再对外暴露，仅允许容器内部网络访问

### 其他

- 简化 CI 工作流，移除 submodule 验证相关逻辑

---

## [v0.3.20](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.20) - 2025-12-02

### 新增

- 实现请求过滤器功能，支持对请求内容进行规则匹配和自动替换 (#251)
- 添加用户标签(tags)功能，支持对用户进行分类管理 (#251)
- 排行榜增强：支持按标签筛选用户 (#251)
- 统计图表新增「本月」时间范围选项 (#251)
- 添加 `verboseProviderError` 系统设置，可控制供应商错误信息的详细程度 (#236) ([@sususu98](https://github.com/sususu98))
- 熔断器状态持久化到 Redis，支持多实例共享和重启恢复 (#251)
- 导航栏新增文档入口，链接至 claude-code-hub.app (#251)

### 优化

- 从 ESLint + Prettier 迁移至 Biome，提升代码格式化和检查效率 (#251)
- 升级 recharts 依赖并优化图表功能 (#250)
- 排行榜缓存逻辑重构，提升查询性能 (#251)
- 供应商成本系数(costMultiplier)现可设置为 0，支持免计费供应商 (#241)
- 更新多项依赖以提升性能和安全性 (#250)

### 修复

- 修复 Gemini 流式响应 gzip 解压崩溃问题 (#246) ([@sususu98](https://github.com/sususu98))
- 修复 Gemini 供应商测试连接认证问题 (#246) ([@sususu98](https://github.com/sususu98))
- 修复 Gemini 流式请求超时检测错误 (#246) ([@sususu98](https://github.com/sususu98))
- 空状态下添加按钮并正确应用 billingModelSource 配置 (#251)
- 数据库迁移添加 IF NOT EXISTS 以确保幂等性 (#252)

### 其他

- 移除 Git submodules 相关配置 (#251)
- 重构测试结构，移除未使用的测试代码 (#251)

---

## [v0.3.19](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.19) - 2025-11-30

### 新增

- README 添加 DeepWiki 徽章，支持通过 AI 智能问答探索项目文档

### 其他

- 改进统一文档工作流，升级 checkout action 至 v5 (#244)
- 更新 docs-site 子模块，添加首页内容

---

## [v0.3.18](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.18) - 2025-11-29

### 新增

- 添加独立文档站点 (docs-site) 作为 Git submodule

### 其他

- 统一文档自动化工作流，合并 PR changelog 和 Release Notes 生成流程
- 添加文档更新 prompt 模板 (release-analysis, release-notes, changelog-update, docs-update)
- 优化 CI/CD 配置和 .gitignore 规则

---

## [v0.3.17](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.17) - 2025-11-29

### 其他

- 修改应用部署端口配置 ([#243](https://github.com/ding113/claude-code-hub/pull/243))

---

## [v0.3.16](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.16) - 2025-11-28

### 新增

- 添加 Overlay 和 Stacked 模式逻辑
- 添加错误覆盖功能

### 修复

- 优化导航栏翻译，向中文简洁程度看齐
- 改进 prompt_limit 错误规则的正则匹配 ([#226](https://github.com/ding113/claude-code-hub/pull/226)) ([@sususu98](https://github.com/sususu98))
- 修复可用性监控 15 分钟时间范围的 Invalid Date 错误 ([#227](https://github.com/ding113/claude-code-hub/issues/227), [#231](https://github.com/ding113/claude-code-hub/pull/231))
- API action adapter 改用位置参数传递 schema 参数 ([#230](https://github.com/ding113/claude-code-hub/issues/230), [#232](https://github.com/ding113/claude-code-hub/pull/232))
- 保持多参数 action 的原始行为
- 处理 bucketSizeMinutes 解析的 NaN 情况

---

## [v0.3.15](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.15) - 2025-11-27

### 修复

- 故障转移后无条件更新 Session 绑定 ([#220](https://github.com/ding113/claude-code-hub/pull/220))

---

## [v0.3.14](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.14) - 2025-11-27

### 修复

- 修复供应商可用性监控页面排序顺序 ([#219](https://github.com/ding113/claude-code-hub/pull/219))

---

## [v0.3.13](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.13) - 2025-11-27

### 新增

- 添加供应商可用性监控模块并简化状态逻辑 ([#216](https://github.com/ding113/claude-code-hub/pull/216))

### 优化

- 优化供应商页面性能 - 修复 N+1 查询和 SQL 全表扫描问题
- 统一状态标签配色与请求日志一致
- 使用可选链简化错误提取逻辑
- 简化内容验证逻辑，直接匹配原始响应体
- 添加 relay-pulse 项目致谢

### 修复

- 增强错误解析以支持中转服务的嵌套错误结构 ([#212](https://github.com/ding113/claude-code-hub/pull/212)) ([@Silentely](https://github.com/Silentely))
- 修复响应内容验证失败问题
- 修复供应商每日用量统计 JSONB 字段名错误
- 修复流式静默期超时提示与校验规则不一致
- 修复登录重定向出现双重 locale 前缀问题
- 补充 zh-TW apiTest 缺失的 8 个翻译键
- 移除 DialogContent 硬编码的 sm:max-w-lg 宽度限制
- 修复 PR review 中的多个问题

---

## [v0.3.12](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.12) - 2025-11-26

### 修复

- 调整模型测试免责提醒顺序 ([#208](https://github.com/ding113/claude-code-hub/pull/208)) ([@Silentely](https://github.com/Silentely))
- 为不同 API 提供商添加特定 User-Agent 以避免 Cloudflare 检测 ([#209](https://github.com/ding113/claude-code-hub/pull/209)) ([@Silentely](https://github.com/Silentely))
- 同步调整英文和繁体中文版免责提醒顺序
- 增加服务商弹窗宽度避免模型重定向名称过长时出现横向滚动条
- 修复模型测试免责提醒显示顺序

---

## [v0.3.11](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.11) - 2025-11-26

### 新增

- 添加计费模型来源配置功能

### 修复

- 修复使用记录时间筛选的时区问题 ([#207](https://github.com/ding113/claude-code-hub/pull/207))
- 修复 TagInput 组件输入值在失焦时未保存的问题
- 恢复被误删的迁移文件，修复迁移链一致性
- 修复数据库迁移冲突，合并 0020-0025 为单一幂等迁移
- 修复模型重定向显示问题并简化 UI
- 修复供应商统计归属问题（重试切换后统计错误）
- Count_tokens 端点错误不计入熔断、不触发供应商切换
- 修复模型重定向 i18n 翻译键路径错误
- 优化模型重定向指示器，改为只显示图标
- 修复模型重定向在供应商切换时未重置的问题
- 优化 cache_control 错误规则正则以匹配 Anthropic API 格式
- 补充迁移文件中缺失的 limit_daily_usd 和 daily_reset_time 字段

---

## [v0.3.10](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.10) - 2025-11-25

### 新增

- 实现 MCP 透传功能 ([#157](https://github.com/ding113/claude-code-hub/pull/157), [#193](https://github.com/ding113/claude-code-hub/pull/193)) ([@flintttan](https://github.com/flintttan))
- 支持 GLM MCP 透传功能及多语言配置
- 支持解析和处理流式响应数据
- 增加流式响应信息展示功能
- 改进供应商 API 测试体验 ([#185](https://github.com/ding113/claude-code-hub/pull/185), [#186](https://github.com/ding113/claude-code-hub/pull/186), [#194](https://github.com/ding113/claude-code-hub/pull/194)) ([@Silentely](https://github.com/Silentely))
- 添加 API 测试免责声明翻译
- 增强 API 测试错误解析逻辑
- 优化使用记录状态码颜色显示 ([#188](https://github.com/ding113/claude-code-hub/issues/188))
- 调整流式静默期超时默认值从 10 秒改为 300 秒
- 更新供应商超时配置默认值为不限制

### 修复

- 移除 max_output_tokens 参数以兼容中转服务
- 调整供应商模型测试提示文本
- 修复代码审查中发现的关键问题
- 优化供应商测试和日志系统
- 解决 Docker 构建失败（排除 Node.js 模块）
- 添加 webpack externals 处理 Node.js 内置模块
- 修复 log-time-formatter 的 null 安全问题并添加文档
- 修复 Gemini 模型重定向无效的问题
- 增强 MCP 透传的安全性和稳定性
- 修复供应商 API 测试返回 520 错误的问题
- 修复代理降级时 Body has already been read 错误
- Anthropic API 测试同时发送两种认证头
- 修复 Codex API 测试请求体格式
- 修正 Pino 日志时间戳配置位置
- 修复供应商多标签匹配问题 ([#190](https://github.com/ding113/claude-code-hub/issues/190))
- 修复 Codex 供应商 API 测试失败问题 ([#189](https://github.com/ding113/claude-code-hub/issues/189))
- 修复模型重定向日志记录问题
- 修复错误规则正则匹配问题并增强刷新缓存功能
- 修复 API 测试免责声明翻译键路径错误
- 修复供应商响应模型标签 ([#197](https://github.com/ding113/claude-code-hub/pull/197)) ([@Silentely](https://github.com/Silentely))
- 修复数据导入跨版本兼容性和错误提示问题
- 修复 errorRules.cacheStats i18n 参数不匹配问题
- 恢复被错误删除的 i18n 字段（descriptionFull/Warning）
- 修复错误规则版本更新后无法自动同步的问题
- 修复模型重定向信息未保存到数据库的问题
- 修复 ErrorRuleDetector 懒初始化的竞态条件

---

## [v0.3.9](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.9) - 2025-11-22

### 新增

- 数据大屏全面优化 ([#183](https://github.com/ding113/claude-code-hub/pull/183), [#184](https://github.com/ding113/claude-code-hub/pull/184))

---

## [v0.3.8](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.8) - 2025-11-22

### 修复

- 用户列表为空时显示添加用户按钮 ([#182](https://github.com/ding113/claude-code-hub/pull/182))
- 添加缺失的 dailyResetMode 翻译并优化表单布局

---

## [v0.3.7](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.7) - 2025-11-22

### 修复

- 修复数据库迁移枚举类型重复创建错误 ([#181](https://github.com/ding113/claude-code-hub/pull/181))

---

## [v0.3.6](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.6) - 2025-11-22

### 优化

- 优化用户管理页面用户体验

### 修复

- 在数据库存在字段时循环报错 ([#174](https://github.com/ding113/claude-code-hub/pull/174)) ([@Silentely](https://github.com/Silentely))
- 保持 Schema 和数据库定义的一致性
- 修复排行榜 Tab 切换无限循环问题 ([#177](https://github.com/ding113/claude-code-hub/issues/177), [#178](https://github.com/ding113/claude-code-hub/pull/178))
- 修复 Gemini 供应商请求透传 ([#179](https://github.com/ding113/claude-code-hub/pull/179))
- 改进响应处理器错误处理和状态码
- 使用 502 Bad Gateway 替代 524 处理上游响应失败

---

## [v0.3.5](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.5) - 2025-11-21

### 新增

- 添加深色模式支持 ([#171](https://github.com/ding113/claude-code-hub/pull/171))

### 优化

- 供应商限额管理页面重构为列表布局 ([#170](https://github.com/ding113/claude-code-hub/pull/170))

### 修复

- 移除 usage-doc 页面重复的语言切换器
- 解决 PR #170 审阅意见
- 改进限额 UI 和完成 i18n 翻译
- 解决深色模式 PR 中的所有评审问题
- 自动修复 PR 构建检查中的 CI 失败 ([#173](https://github.com/ding113/claude-code-hub/pull/173))
- 修复供应商限额页面圆环对齐问题

---

## [v0.3.4](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.4) - 2025-11-21

### 新增

- 供应商页面增加排行榜入口 ([#115](https://github.com/ding113/claude-code-hub/issues/115), [#168](https://github.com/ding113/claude-code-hub/pull/168))

### 优化

- 同步密钥表单为双栏布局设计

### 修复

- 在 action-adapter 中强制认证并添加 SSRF 防护
- 禁用 Claude 工作流中的提交签名以解决 OIDC 认证错误
- 处理 Gemini Code Assist 审阅反馈

---

## [v0.3.3](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.3) - 2025-11-21

### 新增

- 添加每日成本限额支持，可配置每日重置时间 ([#145](https://github.com/ding113/claude-code-hub/pull/145), [#161](https://github.com/ding113/claude-code-hub/pull/161)) ([@Silentely](https://github.com/Silentely))
- 添加每日限额重置模式支持（固定时间与滚动窗口）
- 改进错误响应格式，提供更详细的限流和熔断错误信息
- 优化供应商错误处理和限流信息展示
- 添加 dailyResetMode 选择器到编辑密钥表单和配额对话框
- 细化 review workflows 的提示词为专业评审标准

### 优化

- 为每日限额查询添加部分索引
- 添加全面的 Redis 键命名文档

### 修复

- 修复每日成本限制重置时间显示问题
- 修复 provider 选择器中的空指针异常
- 修复非 Claude 模型请求时的供应商格式错配问题 ([#148](https://github.com/ding113/claude-code-hub/pull/148)) ([@sususu98](https://github.com/sususu98))
- 移除复制按钮的 hover 透明度效果，修复移动端无法显示的问题 ([#146](https://github.com/ding113/claude-code-hub/issues/146), [#149](https://github.com/ding113/claude-code-hub/pull/149))
- 修复供应商类型选择器显示错误的模型类型名称
- 修复 Gemini 和 OpenAI Chat Completions 流式响应的 usage 解析问题 ([#153](https://github.com/ding113/claude-code-hub/pull/153)) ([@sususu98](https://github.com/sususu98))
- 重新排序数据库迁移文件避免与上游冲突
- 修复 ErrorRuleDetector 在迁移前启动时的竞态条件问题
- 添加 limitDailyUsd 验证和 dailyResetMode 参数支持
- 用 i18n 翻译替换硬编码错误原因
- 修复 OpenAI Responses API 供应商模型测试 400 问题及优化显示格式 ([#154](https://github.com/ding113/claude-code-hub/pull/154)) ([@Silentely](https://github.com/Silentely))
- 增强隐私保护，扩展请求头黑名单过滤范围 ([#158](https://github.com/ding113/claude-code-hub/pull/158)) ([@Silentely](https://github.com/Silentely))

---

## [v0.3.2](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.2) - 2025-11-21

### 修复

- 改进使用记录表格布局和 i18n ([#155](https://github.com/ding113/claude-code-hub/pull/155)) ([@miraserver](https://github.com/miraserver))

---

## [v0.3.1](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.1) - 2025-11-20

### 新增

- 完整的 Gemini 支持 ([#142](https://github.com/ding113/claude-code-hub/pull/142))
- 供应商新增首字节/流式静默/非流式总超时配置 ([#108](https://github.com/ding113/claude-code-hub/pull/108), [#126](https://github.com/ding113/claude-code-hub/pull/126)) ([@sususu98](https://github.com/sususu98))
- 前端可修改不重试的客户端错误规则
- 独立的用户管理页面
- 用户新增 5 小时/周/月美元上限和并发 Session 上限字段 ([#141](https://github.com/ding113/claude-code-hub/pull/141)) ([@sususu98](https://github.com/sususu98))
- 为系统内达到限额的请求返回 429 响应
- 可自定义供应商端点路径
- 供应商 API 连通性测试（Anthropic/OpenAI/OpenAI Responses）([#132](https://github.com/ding113/claude-code-hub/pull/132), [#134](https://github.com/ding113/claude-code-hub/pull/134)) ([@Silentely](https://github.com/Silentely))
- 支持用户导入/导出功能
- 实现分组管理的可视化标签输入功能
- 添加 Gemini CLI 使用指南
- Gemini 供应商支持及 i18n 和模型过滤
- 端点优先格式检测 + 智能 URL 拼接预览
- 添加开发环境 Dockerfile.dev ([#143](https://github.com/ding113/claude-code-hub/pull/143)) ([@sususu98](https://github.com/sususu98))

### 优化

- 模型重定向体验 ([#135](https://github.com/ding113/claude-code-hub/pull/135))
- 若干 i18n 优化
- 从 pnpm 迁移到 Bun 1.3.2
- 价格表导入和同步提示优化
- 限额编辑对话框滚动布局和双栏网格优化
- URL 预览组件优化
- 用户创建弹框 UI 布局优化

### 修复

- 改进 ProxyForwarder 超时问题的错误日志
- 添加新的 thinking 格式错误模式
- 导入导出用户翻译修复
- 修复多个组件中 useCallback 依赖数组缺失 t 和其他函数的问题
- 将 undici 从 devDependencies 移到 dependencies
- 移除 API 测试按钮组件中不必要的最大宽度限制
- 将 require() 替换为 ES6 imports 解决构建错误
- 解决 Next.js 构建中 File is not defined 错误
- 应用启动时初始化默认错误规则
- 添加错误规则设置缺失的 i18n 键
- 修复流式请求错误处理时的 orphan records 问题 ([#137](https://github.com/ding113/claude-code-hub/pull/137)) ([@sususu98](https://github.com/sususu98))
- 解决所有 PR 审阅问题 - 安全、UX 和代码质量 ([#136](https://github.com/ding113/claude-code-hub/pull/136))
- 修复 HTTP 访问时无法复制密钥的问题
- 添加缺失的 'gemini' 供应商类型到验证 schema
- 添加 Gemini API 认证支持 (x-goog-api-key)
- Gemini 模型名称检测
- 修正 Gemini CLI URL 构造以包含 /models/{model} 路径
- 完成 Gemini 集成 - 支持消息解析和 token 使用量提取
- 增强 CCR 提供商代理模型匹配能力
- 修复 Gemini adapter 类型错误并删除未使用的翻译
- 修复 notifications i18n 翻译问题
- 修复模型重定向标记不显示的 bug 并在决策链中记录重定向信息

---

## [v0.2.41](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.41) - 2025-11-18

### 修复

- 移除网络地址检测的日志输出

---

## [v0.2.40](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.40) - 2025-11-18

### 新增

- 添加 Linux/macOS/Windows 一键部署脚本

---

## [v0.2.39](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.39) - 2025-11-17

### 其他

- 版本发布

---

## [v0.2.38](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.38) - 2025-11-15

### 新增

- 添加供应商组件多语言支持

### 修复

- 添加新的 thinking 格式错误模式 ([#124](https://github.com/ding113/claude-code-hub/pull/124)) ([@sususu98](https://github.com/sususu98))
- 修复中止的代理流终结问题 ([#125](https://github.com/ding113/claude-code-hub/pull/125)) ([@JillVernus](https://github.com/JillVernus))

---

## [v0.2.37](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.37) - 2025-11-11

### 新增

- 引入可配置的 Guard Pipeline 系统 ([#105](https://github.com/ding113/claude-code-hub/pull/105), [#106](https://github.com/ding113/claude-code-hub/pull/106))

### 修复

- 修正供应商类型翻译命名空间

---

## [v0.2.36](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.36) - 2025-11-11

### 新增

- 重构应用为完整 i18n 多语言支持 ([#103](https://github.com/ding113/claude-code-hub/issues/103))
- 实现 3 语言支持：英语、简体中文、繁体中文
- 智能 Markdown 渲染改进
- 表单改进和增强验证
- 添加 Codex 供应商支持

### 优化

- 为提供商表单添加带占位符的清晰端点 URL 预览
- 删除未使用的仪表板组件和设置文件
- 用翻译项替换硬编码导航项

### 修复

- 改进 locale 类型处理和更新 link 组件
- 自动修复 PR 构建检查中的 CI 失败
- 用翻译键替换 users.ts 中的硬编码中文字符串
- 修正设置导航中的翻译键不匹配
- 修正 provider-form-temp.json 中的 JSON 语法错误
- 更新用户操作中的错误日志消息
- 添加所有 locale 的缺失 provider-chain 翻译键
- 在所有 locale 索引文件中注册 provider-chain 命名空间
- 为所有错误返回添加 errorCode 并修复硬编码 locale
- 重构 data.guide 翻译为嵌套格式
- 用 'all' 值替换端点过滤 SelectItem 中的空字符串

---

## [v0.2.34](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.34) - 2025-11-09

### 新增

- 扩展不可重试的客户端错误定义和模式

### 修复

- 修复流式响应中的 usage tokens 提取 ([#82](https://github.com/ding113/claude-code-hub/issues/82))
- 修复 CircuitBreaker 请求计数器竞态条件 ([#81](https://github.com/ding113/claude-code-hub/pull/81))

---

## [v0.2.33](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.33) - 2025-11-07

### 优化

- 将版本 badge 移到卡片内部
- 将供应商自定义端点字段宽度增加到 sm:w-[350px]
- 添加 Codex 供应商类型及预览支持

---

## [v0.2.32](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.32) - 2025-11-07

### 新增

- 添加 Codex 供应商类型支持

---

## [v0.2.31](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.31) - 2025-11-06

### 优化

- 设置更保守的默认流式超时
- 优化状态验证逻辑
- 移除连续失败重置逻辑（由成功计数器处理）
- 修正失败计数器递增时机
- 统一状态转换日志格式

### 修复

- 修复熔断器在熔断状态下的错误分类问题
- 修复 providerId 在日志中丢失的问题
- 修复错误引用导致的 lint 警告

---

## [v0.2.30](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.30) - 2025-11-06

### 修复

- 修复使用记录页面供应商列显示问题
- 修复请求统计供应商正则模式
- 修正重试状态值以匹配 OpenAI 响应格式
- 在 ProxyForwarder 中引入非流式响应超时处理

---

## [v0.2.29](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.29) - 2025-11-04

### 新增

- 实现供应商级别 token 限制功能 ([#62](https://github.com/ding113/claude-code-hub/pull/62))
- 每日 session 限制改进

### 优化

- 添加精细限额用量查询
- 优化用户页面，用 sheet 替代跳转显示活跃 sessions 详情
- 为活跃会话添加刷新按钮

### 修复

- 修复创建供应商时 tags 字段保存失败的问题

---

## [v0.2.28](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.28) - 2025-11-02

### 新增

- 添加 user_id 过滤并实现更多 session 清理方法

---

## [v0.2.27](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.27) - 2025-11-02

### 新增

- 添加使用记录筛选功能 ([#57](https://github.com/ding113/claude-code-hub/issues/57))

### 修复

- 修复 usage-logs-table 构建错误

---

## [v0.2.26](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.26) - 2025-11-02

### 新增

- 添加全局用户限额预警支持 ([#55](https://github.com/ding113/claude-code-hub/pull/55))

---

## [v0.2.25](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.25) - 2025-11-02

### 新增

- 供应商选择偏好设置增强 ([#49](https://github.com/ding113/claude-code-hub/pull/49))

### 修复

- 修复使用 Drizzle schema 替代 Redis sessions 查询后消失的 logout 功能

---

## [v0.2.24](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.24) - 2025-11-02

### 新增

- 支持模型重定向 ([#46](https://github.com/ding113/claude-code-hub/issues/46))

### 修复

- 修复对话 token 不计入用户使用统计的问题
- 修复使用 Drizzle schema 替代 Redis sessions 后 logout 功能失效

---

## [v0.2.23](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.23) - 2025-11-01

### 新增

- 添加自定义端点 URL 后缀支持 ([#41](https://github.com/ding113/claude-code-hub/issues/41))
- 支持 OpenAI Response API ([#41](https://github.com/ding113/claude-code-hub/issues/41))

---

## [v0.2.22](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.22) - 2025-11-01

### 新增

- 添加模型定价管理 ([#39](https://github.com/ding113/claude-code-hub/pull/39))
- 添加供应商标签路由功能 ([#40](https://github.com/ding113/claude-code-hub/issues/40))

---

## [v0.2.13](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.13) - 2025-10-31

### 优化

- 改进 UI 布局

---

## [v0.2.12](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.12) - 2025-10-30

### 新增

- 供应商详情显示增强

### 修复

- 修复 updateSession 在 strict mode 下错误
- 修复重复 session 导致的问题
- 修复对话持久化问题

---

## [v0.2.11](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.11) - 2025-10-29

### 新增

- 添加对话记录功能

### 修复

- 修复 session 更新

---

## [v0.2.10](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.10) - 2025-10-29

### 新增

- 用户供应商偏好设置 ([#30](https://github.com/ding113/claude-code-hub/pull/30))
- 添加用户级别限额支持

---

## [v0.2.6](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.6) - 2025-10-27

### 新增

- 支持 Batch API ([#25](https://github.com/ding113/claude-code-hub/pull/25))
- 添加 OpenAI 兼容 API

### 优化

- 优化首页展示
- 美化 error page

---

## [v0.2.5](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.5) - 2025-10-27

### 优化

- 优化 dashboard stats

---

## [v0.2.4](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.4) - 2025-10-27

### 优化

- 根据审查意见改进代码

---

## [v0.2.3](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.3) - 2025-10-27

### 修复

- 修正接口前缀错误

---

## [v0.2.2](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.2) - 2025-10-27

### 新增

- 支持按分钟统计 ([#21](https://github.com/ding113/claude-code-hub/issues/21))

---

## [v0.2.1](https://github.com/ding113/claude-code-hub/releases/tag/v0.2.1) - 2025-10-27

### 新增

- 添加熔断器机制

---

## [v0.1.52](https://github.com/ding113/claude-code-hub/releases/tag/v0.1.52) - 2025-10-25

### 新增

- 添加密钥管理功能

### 修复

- 修复 SSE 处理问题

---

## [v0.1.51](https://github.com/ding113/claude-code-hub/releases/tag/v0.1.51) - 2025-10-25

### 新增

- 核心代理功能
- 供应商管理
- 用户认证

---

## 如何升级

### Docker Compose 升级

```bash
# 拉取最新镜像并重启
docker compose pull && docker compose up -d

# 查看更新后的日志
docker compose logs -f app
```

### 一键部署脚本升级

重新运行部署脚本，会自动检测并升级：

```bash
./deploy.sh
```

{% callout type="warning" title="升级前备份" %}
建议在升级前备份数据库：
```bash
docker compose exec postgres pg_dump -U postgres claude_code_hub > backup.sql
```
{% /callout %}

---

## 版本兼容性

### 数据库迁移

- 升级时会自动执行数据库迁移（`AUTO_MIGRATE=true`）
- 生产环境建议手动检查迁移内容后执行
- 迁移脚本位于 `drizzle/` 目录

### 配置变更

新版本可能引入新的环境变量或变更默认值：

- 查看 `.env.example` 了解新增配置
- 查看 CHANGELOG 中的 **优化** 部分了解行为变更

### API 兼容性

- 次版本升级保持 API 向后兼容
- 主版本升级可能包含不兼容变更，请查看 **Breaking Changes**

---

## 反馈与贡献

- **发现 Bug**：[提交 Issue](https://github.com/ding113/claude-code-hub/issues/new)
- **功能建议**：[参与讨论](https://github.com/ding113/claude-code-hub/discussions)
- **贡献代码**：[阅读贡献指南](https://github.com/ding113/claude-code-hub/blob/main/CONTRIBUTING.md)

---

## 贡献者

感谢所有外部贡献者的付出：

- [@Silentely](https://github.com/Silentely)
- [@sususu98](https://github.com/sususu98)
- [@flintttan](https://github.com/flintttan)
- [@JillVernus](https://github.com/JillVernus)
- [@miraserver](https://github.com/miraserver)
