# 更新日志

本页面记录 Claude Code Hub 的所有版本变更，按时间倒序排列。

---

## [v0.5.1](https://github.com/ding113/claude-code-hub/releases/tag/v0.5.1) - 2026-01-26

### 新增

- 供应商端点管理功能，支持为供应商配置多个端点并实现健康探测和故障转移 (#651)
- 可用性仪表板，实时展示供应商和端点的健康状态、延迟曲线和探测日志 (#646)
- Agent Pool 连接管理机制，优化代理连接复用和并发控制 (#646)
- 会话状态工具函数，支持批量查询并发会话数和会话状态判断 (#646)
- SSL 证书错误检测和端点重试限制，提升网络错误处理能力 (#646)

### 优化

- 实时会话面板 UX 改进，优化交互体验和数据展示 (#646)
- 图表和标签输入组件稳定性增强 (#646)
- 会话消息存储策略调整：`STORE_SESSION_MESSAGES` 环境变量改为控制消息脱敏而非存储开关 (#655)
- Dashboard 日志 UI 模块化过滤器和错误详情展示优化 (#654)
- Dashboard 统计图表过滤零使用量用户，提升图例可读性 (#650)
- 会话状态标签统一为 4 字母格式，改善视觉一致性 (#650)
- 可用性图表颜色修复，移除 OKLCH 变量的 hsl() 包装器 (#650)

### 修复

- 修复代理重试时端点粘性问题，确保重试请求使用相同端点 (#651)
- 修复 Thinking 签名整流器对额外签名字段错误的处理 (#646)
- 修复用户限流执行问题 (#643)
- 修复探测成功日志过滤导致延迟曲线无法渲染的问题 (#636)
- 修复供应商 vendor 聚合自动回填逻辑 (#635)

### 其他

- 新增多项单元测试覆盖：Agent Pool、端点选择器、探测调度器、SSL 错误检测等
- i18n 翻译更新：新增可用性仪表板和供应商网络设置相关翻译

---

## [v0.4.3](https://github.com/ding113/claude-code-hub/releases/tag/v0.4.3) - 2026-01-20

### 新增

- Dashboard 日志页面全屏模式，提升数据查看体验 (#632)
- Dashboard 日志秒级时间筛选 + Session ID 精确筛选/联想/展示功能 (#611) [@YangQing-Lin](https://github.com/YangQing-Lin)
- 用户管理增强：统计数据重置功能和 i18n 完善 (#610) [@miraserver](https://github.com/miraserver)
- 个人使用页面统计缓存和时区修复 (#623) [@miraserver](https://github.com/miraserver)
- 排行榜新增用户标签/分组筛选下拉建议，提升筛选体验 (#607)
- API 错误响应中包含 Session ID，便于快速定位问题日志

### 优化

- 文档更新：明确 1M 上下文继承行为说明
- UI 增强：添加无障碍标签并优化对话框样式
- i18n 完善：修正日语全角括号显示、本地化密钥配额权限错误提示
- 移除认证模块中的硬编码服务端错误回退

### 修复

- 修复模型重定向后供应商耗尽问题 (#633)
- 修复 Dockerfile 中 HOSTNAME 环境变量设置 (#622) [@hwa](https://github.com/hwa)
- 修复多用户环境下容器名称冲突问题 (#625) [@SaladDay](https://github.com/SaladDay)
- 修复 1M 上下文标头兼容问题
- 修复 my-usage 页面日期范围夏令时安全问题
- 修复脚本中硬编码的 Docker 容器名称

### 其他

- 新增多项单元测试覆盖
- 更新 README 中 Privnode 优惠详情
- 忽略临时 scratch 目录

---

## [v0.4.2](https://github.com/ding113/claude-code-hub/releases/tag/v0.4.2) - 2026-01-12

### 新增

- Codex 会话标识符自动补全功能，提升会话管理效率 (#599)
- 供应商分组字段长度扩展至 200 字符，支持更复杂的分组配置 (#591) [@Hwwwww-dev](https://github.com/Hwwwww-dev)

### 优化

- i18n 设置模块拆分优化，引入翻译质量门禁机制 (#588) [@YangQing-Lin](https://github.com/YangQing-Lin)
- OpenCode 使用文档更新，添加 GPT-5.2 和 Gemini v1beta 配置示例 (#597)

### 修复

- 修复 Codex 会话完成响应中错误注入元数据的问题 (#601)
- 修复供应商自定义模型白名单无法移除的问题 (#592, #593)
- 修复 Edge Runtime 下 AsyncTaskManager 导致的 process.once 构建警告 (#589) [@YangQing-Lin](https://github.com/YangQing-Lin)
- 修复 Thinking 签名整流器对 "signature: Field required" 错误的检测和触发逻辑 (#594)

---

## [v0.4.1](https://github.com/ding113/claude-code-hub/releases/tag/v0.4.1) - 2026-01-11

### 新增

- 价格表 UI 支持自定义模型价格和缓存价格配置 (#583) [@NieiR](https://github.com/NieiR)
- 手动模型价格管理功能，支持添加/编辑/删除自定义模型定价 (#573) [@NieiR](https://github.com/NieiR)
- 按成本倍数自动排序供应商优先级功能 (#555, #569) [@YangQing-Lin](https://github.com/YangQing-Lin)
- 个人使用页面统计摘要卡片，支持自动刷新和可折叠日志 (#559) [@miraserver](https://github.com/miraserver)
- Thinking signature 整流器，自动处理跨渠道 thinking block 签名兼容问题 (#576)
- FluxFix 响应修复器，修复上游返回的截断 JSON、异常编码和 SSE 格式问题 (#570)
- 新增 "Too much media" 错误规则，识别媒体内容超限错误 (#572)
- TOML 云端价格表支持，计费查询失败时采用 fail-open 策略 (#580)
- OpenCode 使用指南文档 (#582, #586)
- 稳定版本发布工作流支持 (v0.4.0+)

### 优化

- 统一请求特殊设置命中的展示方式，改进日志可读性 (#574)
- 移除本地 seed 价格表，强制使用云端同步确保价格数据实时性 (#584)

### 修复

- 修复 thinking 启用时 tool_use 作为首个 block 导致请求失败的问题 (#577)
- 修复日志页面供应商链徽章溢出显示问题 (#581) [@YangQing-Lin](https://github.com/YangQing-Lin)
- 修复 Drizzle 数据库迁移幂等性问题 (#578) [@YangQing-Lin](https://github.com/YangQing-Lin)
- 修复密钥表单供应商分组选择时 default 未自动移除的问题 [@NieiR](https://github.com/NieiR)

---

## [v0.3.42](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.42) - 2026-01-07

### 新增

- Session 详情页重设计，改进布局和用户体验 (f52a2651)
- 供应商级别参数覆写审计功能，支持 Codex reasoning/text/parallel_tool_calls 覆写 (#557, #536)
- 供应商查询缓存功能，支持缓存开关配置，默认启用 (#554, #556) [@hank9999](https://github.com/hank9999)
- Gemini 非流式错误规则 (#547) [@Kevin Cui](https://github.com/kevin-cui-tw)
- Anthropic Warmup 请求拦截功能 (#525)
- tool_use missing tool_result 错误规则 (#550, #551)
- Codex reasoning effort mismatch 错误规则 (#544)

### 优化

- 供应商保存异步架构重构，提升保存性能 (54bada89)
- 拆分 unified-edit-dialog 为专用对话框组件，改善代码结构 (#539) [@NieiR](https://github.com/NieiR)
- Session Messages 提升内容阈值并支持导出完整请求 (#537)
- 管理后台 UI 改进 (#538) [@miraserver](https://github.com/miraserver)

### 修复

- 修复 SessionStats 组件日期类型问题 (57ac4d6d)
- 修复 CodeDisplay 组件缺少 className prop (c622705b)
- 修复 /v1/responses 和 /v1/chat/completions 未使用 GuardPipeline 的问题 (#552)
- 修复添加新供应商后列表未刷新的问题 (#546) [@NieiR](https://github.com/NieiR)
- 补齐 system_settings 缺失列 (17014402)
- 修复供应商总限额编辑、生效和重置逻辑 (#535)
- 修复 Key 清除到期时间使用空字符串传参问题 (#534)
- 修复 my-usage 今日统计与只读 API 自助查询 (#532)
- 修复清除用户/Key 到期时间后保存不生效的问题 (#533)
- 修复用户限额未设置时 Key 限额仍生效的问题 (#531)
- 修复供应商搜索框重复清除按钮 (af17948d)
- 修复 CodeRabbit webhook 反馈问题 (#527)

### 其他

- 为 available-models 工具函数添加单元测试 (#528) [@NieiR](https://github.com/NieiR)
- 更新使用文档中 Codex 模型配置 (#545)
- 更新 AGENT 指导文档 (cc32b47b)
- 重新生成 blocked_by 索引迁移 (3250f210)

---

## [v0.3.41](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.41) - 2026-01-03

### 新增

- 新增 `/v1/models` 端点，聚合返回用户可用模型列表 (#517) [@NieiR](https://github.com/NieiR)
- Webhook 系统重构：支持多目标管理、自定义模板、统一渲染架构 (#506)
- Webhook 引导系统：旧配置迁移向导，一键升级到新架构
- 通知系统增强：支持多类型通知绑定和全局配置 (#506)

### 优化

- 数据库连接池优化：采用 lazy connection 降低资源占用 (#503)
- 请求日志写入优化：实现异步批量写入缓冲区，减少数据库压力 (#503)
- Webhook 模板系统：支持占位符变量替换和多平台适配（钉钉、Telegram、企业微信）
- 限额时区判断统一：修复用户层级和 Key 层级每日限额时区不一致问题 (#507)
- 管理后台 UX 改进：优化对话框体验和 i18n 问题修复 (#514)
- 内部 URL 白名单验证：允许配置内部地址避免 SSRF 误报 (#516)

### 修复

- 修复 Gemini 供应商 User-Agent 透传问题 (a4797187)
- 修复 Codex Session 提取：优先使用 `prompt_cache_key` 作为会话标识 (#521)
- 修复 `/v1/models` 分组隔离：确保用户只能看到授权的供应商模型 (#522)
- 修复 Webhook 处理逻辑：加固多目标通知的并发安全性 (#522)
- 添加 "Invalid signature in thinking block" 错误规则 (#519)
- 请求过滤器改进：修复 SOCKS 代理问题 (#501)

### 其他

- 新增数据库迁移：notification_bindings, webhook_targets 表 (0043)
- 更新 LiteLLM 模型价格数据

---

## [v0.3.40](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.40) - 2026-01-01

### 新增

- 供应商模型动态获取功能，支持从上游 API 动态获取允许的模型列表 (#491) [@NieiR](https://github.com/NieiR)
- Redis Pub/Sub 缓存失效通知机制，实现多实例间缓存同步 (#493)
- RPM 限流管理功能，支持每分钟请求数限制配置 (#499)

### 优化

- 供应商故障阈值配置优化，允许 failureThreshold 设置为 0 或超过 100 (#498) [@Tethys Plex](https://github.com/Privnode-HQ)
- Session 详情记录增强，补全请求和响应的完整 payload (#495)
- 排行榜输出速率计算优化，修复除以过小值导致的异常 (#497) [@NieiR](https://github.com/NieiR)
- 客户端模式匹配规范化，统一处理连字符和下划线 (c79b87c)

### 修复

- 修复 E2E 测试中 RPM 验证的测试用例 (ca0ada4)
- 移除新建用户时的默认限额配置，提供更清晰的配置体验 (#499)

### 其他

- 多语言翻译更新（英语/日语/俄语/简体中文/繁体中文）
- 代码格式化和 Biome lint 修复

---

## [v0.3.39](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.39) - 2025-12-31

### 新增

- 新增飞书 (Feishu) Webhook 通知支持，支持飞书机器人卡片消息推送 (#490) [@Kevin Cui](https://github.com/kevin-cui-tw)
- Webhook 平台自动检测功能，根据 URL 自动识别平台类型并显示对应徽章 (#487)
- 请求过滤器新增供应商/分组绑定功能，支持为特定供应商或供应商分组设置独立的过滤规则 (#484)
- 供应商管理页面新增内联编辑功能，支持直接在列表中编辑优先级、权重和成本系数 (#486) [@YangQing-Lin](https://github.com/YangQing-Lin)

### 优化

- 供应商权重最小值从 0 调整为 1，提升配置清晰度 (#486) [@YangQing-Lin](https://github.com/YangQing-Lin)
- 请求过滤器表格 UI 优化，改进布局、滚动和工具提示显示 (#484)
- 优化分组标签匹配性能，减少迭代数据集大小 (#484)

### 修复

- 修复代理转发器中未知 HTTP 状态码错误地兜底返回 OK 的问题 (#490)
- 修复 HTTP statusText 处理问题以及 Gemini GET/HEAD 请求的处理逻辑 (#481) [@near](https://github.com/near)
- 修复请求过滤器的安全性和 UX 问题，改进表单布局和错误提示 (#488)

### 其他

- 重构 Webhook 模块架构，统一渲染器接口和模板系统 (#490)
- 新增多项单元测试覆盖：请求过滤器绑定、Webhook 渲染器、HTTP 状态文本等
- 移除旧的微信机器人模块代码，改用新的 Webhook 架构 (#490)

---

## [v0.3.38](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.38) - 2025-12-29

### 新增

- Session 详情页新增请求/响应头日志展示，支持 Tab 切换查看 (#469)
- 排行榜新增排序和供应商类型筛选功能 (#448) [@YewFence](https://github.com/YewFence)
- 虚拟化表格组件 (use-virtualizer hook) 用于大数据量列表性能优化 (#467) [@NightYuYyy](https://github.com/NightYuYyy)
- 新增 `FETCH_CONNECT_TIMEOUT` 环境变量，统一配置 Undici 连接超时（默认 30 秒）(#479, #480)

### 优化

- 供应商管理页面 UX 改进，优化交互体验 (#446) [@miraserver](https://github.com/miraserver)
- 用户筛选与排序体验优化，移除使用日志用户筛选限制 (#462, #449) [@NightYu](https://github.com/NightYuYyy)
- 缓存 tooltip 显示改进，当 5m/1h breakdown 不可用时提供友好提示 (#445) [@Hwwwww](https://github.com/Hwwwww-dev)
- TagInput 组件和虚拟化表格稳定性增强 (#467) [@NightYuYyy](https://github.com/NightYuYyy)
- SSE 解析工具增强，添加错误处理和测试 (#469)
- Session 消息客户端 SSE 性能和 matchMedia 回退优化 (#469)

### 修复

- 修复计费模型来源配置不生效问题 (#464)
- Codex instructions 一律透传，移除缓存与策略 (#475)
- 修复 Session 详情页中的 tool_use_id 验证问题 (#473, #472)
- 修复日志表格中供应商名称溢出问题 (#478) [@YangQing-Lin](https://github.com/YangQing-Lin)
- 请求过滤器 header 修改追踪修复，确保在 Session 详情中正确显示 (#465)
- 数据导入组件优化，移除重复描述文本 (#458) [@Abner](https://github.com)

### 其他

- 新增多项单元测试：undici 超时、proxy forwarder、session 等 (#469, #479)
- 移除 codex-instructions-cache.ts 模块，简化代码结构 (#475)
---

## [v0.3.37](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.37) - 2025-12-24

### 新增

- Session 详情页新增请求/响应头日志展示，支持 Tab 切换查看 (#417)
- 新增 TTFB（首字节时间）和输出速率性能指标追踪 (#421)
- Codex 并发请求 Session 隔离功能，提升多请求场景稳定性 (#430)
- 非管理员用户新增个人配额页面 (my-quota) (#412)
- 用户页面供应商分组选择增强 (#424) [@Hwwwww-dev](https://github.com/Hwwwww-dev)
- 认证错误和用户/密钥状态显示优化 (#425) [@NightYu](https://github.com/NightYuYyy)
- 错误规则决策链记录匹配规则详情 (#416)

### 优化

- 使用日志表格列宽优化，采用全 flex 布局提升显示效果 (#437)
- 供应商列宽度调整，防止内容重叠 (#443)
- 支持缓存 5m/1h token 顶层扁平格式解析 (#443)
- 排行榜视图时区和性能优化 (#436)
- 移除 CANNOT_DISABLE_LAST_KEY 硬编码中文回退 [@NightYu](https://github.com/NightYuYyy)
- 提取 normalizeRequestSequence 为共享工具函数并增强 JSON 解析日志

### 修复

- 修复删除密钥的两个问题 (#431, #438) [@NightYu](https://github.com/NightYuYyy)
- 修复快捷续期到期时间计算和刷新问题 [@NightYu](https://github.com/NightYuYyy)
- 修复创建新密钥时 isEnabled 状态未正确保存的问题 [@NightYu](https://github.com/NightYuYyy)
- 修复编辑对话框中禁用所有密钥的问题 [@NightYu](https://github.com/NightYuYyy)
- 修复 i18n 命名空间、翻译和图表高度问题 (#426)
- 修复筛选器下拉和分页 Bug (#428, #429)
- 修复空消息内容验证错误规则
- 修复错误规则测试页面的误报警告 [@sususu](https://github.com/sususu98)
- 修复分页时区和性能问题
- 添加缺失的 rateLimits 和 userStatus 翻译
- 修复 matchedRule 字段的 undefined 检查
- 修复密钥重定向目标并增强错误处理

### 其他

- 新增 Session 管理辅助函数单元测试 (#420)
- 新增 requestSequence 工具函数测试
- 新增 usage metrics 提取测试

---

## [v0.3.36](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.36) - 2025-12-23

### 新增

- 用户和密钥快速续期功能，支持快速选择 7天/30天/90天/1年 或自定义日期续期 (#414) [@NightYu](https://github.com/NightYuYyy)
- 用户和密钥状态翻译支持（多语言）(#414) [@NightYu](https://github.com/NightYuYyy)
- 供应商分组新增默认值处理，优化数据库和 UI 逻辑 (#411)

### 优化

- 更新错误消息描述，提升用户体验 (#411)
- 移除 docker-compose 中的外部卷配置，简化部署流程 (#411)
- 增强代理请求处理和错误管理机制 (#411)
- 恢复 Claude 工作流作为 Codex 的备用选项

### 修复

- 修复用户本地过期状态更新时的 user.id 依赖问题 (#414) [@NightYu](https://github.com/NightYuYyy)
- 修复 maxAttemptsPerProvider 配置在供应商重试逻辑中未生效的问题 (#403, #415)
- 修复统计组件中按钮元素缺少 cursor pointer 的问题，改善用户体验 (#401) [@Hwwwww](https://github.com/Hwwwww-dev)
- 修复健康检查命令和错误规则插入逻辑 (#411) [@NightYu](https://github.com/NightYuYyy)
- 修复 readLocalVersionFile 中的错误处理 (#411) [@NightYu](https://github.com/NightYuYyy)
- 修复 releaseUrl 使用通用 releases 页面 (#411)

---

## [v0.3.34](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.34) - 2025-12-22

### 新增

- Dashboard 和排行榜新增供应商缓存命中率统计，支持查看各供应商的缓存利用情况 (#399) [@ding113](https://github.com/ding113)

### 优化

- 简化 ProviderCacheHitRateEntry 数据结构，提升排行榜视图性能

### 修复

- 修复 Dashboard 缓存命中请求的本地化显示问题

---

## [v0.3.33](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.33) - 2025-12-20

### 新增

- 供应商新增实际选择优先级排序选项，支持按实际使用优先级排序 (#389)
- 用户和密钥批量编辑功能，支持同时修改多个用户或密钥的配额、限额等字段 (#385)
- 批量编辑支持批量大小限制和错误处理，提升批量操作安全性
- 用户管理新增基于角色的访问控制，普通用户只能查看自己的数据

### 优化

- Dashboard 组件全面优化：统计卡片、流量趋势、模型分布等组件布局和交互改进
- 用户管理功能增强：改进用户可见性控制、优化表格自动展开逻辑、增强权限验证
- 配额显示组件优化：改进百分比计算、倒计时逻辑和数据缓存处理
- 密钥管理增强：新增更新后验证机制、用户组同步功能
- Session 管理页面访问控制：实现基于角色的页面访问限制
- 用户查询改进：修正游标分页和排序逻辑，提升查询性能

### 修复

- 修复数据库导入导出路由的锁管理问题，实现 MonitoredStream 确保锁释放
- 修复 Dockerfile，安装 PostgreSQL 18 客户端以兼容新版本数据库
- 修复配额卡片组件中的百分比计算和倒计时逻辑错误
- 修复用户限额徽章数据缓存和错误状态处理问题
- 修复使用日志查询占位符数据问题
- 修复余额查询页面描述和开关行为逻辑
- 修复 Session 消息检索和代理状态检索的访问控制问题
- 修复配额和 Session 页面的管理员访问控制

### 其他

- Dashboard 翻译文件更新，增强多语言支持
- TypeScript 配置优化，改进类型检查和编译性能

---

## [v0.3.32](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.32) - 2025-12-20

### 新增

- Session 缓存清理和优雅关闭钩子，支持应用关闭时自动清理缓存 (#381)

### 优化

- Dashboard 组件全面增强 Suspense 和骨架屏加载，提升页面加载体验 (#378)
- 多个设置页面（客户端版本、错误规则、请求过滤器、敏感词）新增骨架屏加载组件 (#378)
- 供应商管理页面加载状态优化，改进用户体验 (#378)
- 日志功能重构，改进日志结构和可读性
- Dockerfile 优化，改进构建和运行时环境配置
- 代理和响应管理模块的错误处理和日志记录增强

### 修复

- 修复供应商列表 CRUD 操作后不自动刷新的问题
- 修复日志模块动态导入的 TypeScript 类型错误

### 其他

- 添加 CLAUDE.md 项目指导文档，为 Claude Code 提供代码库上下文
- 移除 next.config.ts 中未使用的日志依赖

---

## [v0.3.31](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.31) - 2025-12-19

### 新增

- 用户客户端（CLI/IDE）限制功能，支持限制用户使用特定客户端 (#341) [@miraserver](https://github.com/miraserver)
- 用户模型限制功能，支持限制用户可使用的模型列表 (#347) [@miraserver](https://github.com/miraserver)
- 使用日志游标分页查询，提升大数据量下的查询性能 (#371)
- 用户面板功能增强：配额使用详情、快速续期对话框、新用户引导教程 (#362)
- API 文档增强：Vitest 测试框架集成和参数映射支持 (#355)
- 限制规则覆写提示，编辑时显示已存在类型的提示 [@NightYu](https://github.com/NightYuYyy)
- "Tool names must be unique" 错误规则，改进 Claude Code 工具名称冲突处理 (#366)
- Redis TLS 证书跳过验证支持 (`REDIS_TLS_REJECT_UNAUTHORIZED`) (#360) [@Silentely](https://github.com/Silentely)
- 日期选择器清除按钮，支持快速清空日期字段 (#345)
- 响应头清理功能，提升 Bun 运行时兼容性 [@NightYu](https://github.com/NightYuYyy)

### 优化

- 限额管理系统检查顺序优化，改进错误响应格式 (#359) [@NightYu](https://github.com/NightYuYyy)
- 使用日志筛选器懒加载，减少初始页面加载时间
- 虚拟化日志表格列宽和布局调整，提升大数据量展示体验
- Dockerfile 改用 Bun 和 Debian 基础镜像，减少镜像体积
- 排行榜排名徽章对齐统一 (#344)
- 限额规则表格添加工具提示，改进信息展示

### 修复

- 修复 dailyQuota 处理问题 (#370)
- 修复限制规则表单提交事件传播问题
- 修复 TypeScript 类型错误（null vs undefined）(#376)
- 修复 Codex 请求强制 stream=true 问题 (#369)
- 修复 Recharts Tooltip formatter 参数类型错误
- 修复用户管理表描述本地化问题 [@NightYu](https://github.com/NightYuYyy)
- 修复用户每日配额允许为 0（无限制）(#346)
- 修复 API Key 加载失败错误处理和本地化

### 其他

- 测试框架从 Jest 迁移到 Vitest，新增 API 完整性测试 (#355)
- 更新使用文档模型名称配置
- 数据库迁移文件优化（游标分页索引）
- 多语言翻译更新（中英日俄）
- 代码质量改进

---

## [v0.3.30](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.30) - 2025-12-13

### 新增

- 供应商支持 1M 上下文窗口配置，包含分层定价和代理管道集成 (#337)
- 移动端响应式导航汉堡菜单，改进小屏幕设备体验 [@Hwwwww-dev](https://github.com/Hwwwww-dev)
- 供应商独立管理页面 [@Hwwwww-dev](https://github.com/Hwwwww-dev)
- 系统设置导航悬浮下拉菜单 [@Hwwwww-dev](https://github.com/Hwwwww-dev)
- Session 请求列表支持排序选项 [@Hwwwww-dev](https://github.com/Hwwwww-dev)
- 错误时间线支持查看请求详情，便于调试
- Gemini 200K token 分层定价支持
- Long Context 定价计划错误规则
- 部署脚本增强：支持 CLI 参数和 Caddy HTTPS (#316)
- my-usage 页面新增每日用户配额统计、缓存列和自动刷新功能 (#316)

### 优化

- 日志页面性能大幅优化：使用批量查询、缓存和可见性轮询 (#337)
- 语言切换器简化为仅图标按钮 [@Hwwwww-dev](https://github.com/Hwwwww-dev)

### 修复

- 修复 Gemini 缓存 token 重复计费问题 (#338) [@sususu98](https://github.com/sususu98)
- 支持 Gemini thoughtsTokenCount 计费 [@sususu98](https://github.com/sususu98)
- 修复供应商分组过滤逻辑，隐藏无关分组的供应商 [@Hwwwww-dev](https://github.com/Hwwwww-dev)
- 修复供应商页面和可用性页面的响应式布局问题 [@Hwwwww-dev](https://github.com/Hwwwww-dev)
- 修复 PostgreSQL 返回字符串值时调用 toFixed 的 TypeError
- 允许普通用户访问 getUsers API (#300)
- 修复用户密钥详情中 React 渲染杂散 "0" 的问题
- 日志翻页离开第 1 页时自动暂停刷新
- 安全性改进：在客户端错误响应中隐藏供应商名称
- 新增 "model is required" 预设错误规则

### 其他

- 更新使用文档：Codex 推荐模型更新为 gpt-5.2 with xhigh reasoning
- 更新 LiteLLM 模型价格数据

---

## [v0.3.29](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.29) - 2025-12-12

### 其他

- 更新 LiteLLM 模型价格数据

---

## [v0.3.28](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.28) - 2025-12-10

### 新增

- 日志页面新增快速日期筛选器（今日/昨日/近7天/近30天）和 CSV 导出功能 (#314)
- Session 监控页面新增分页功能，支持分别对活跃和非活跃 Session 进行分页浏览 (#314)

### 优化

- 每日排行榜改用滚动 24 小时窗口计算，替代原先基于日历日的统计方式 (#314)
- 上游 404 错误现在触发供应商故障切换而不计入熔断器，提升中转服务兼容性 (#314)

### 修复

- 修复 Anthropic SSE 流式响应中 output_tokens 提取问题，现在从 message_delta 事件正确获取 (#313)

---

## [v0.3.27](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.27) - 2025-12-10

### 新增

- 供应商新增 IP 透传功能（`preserve_client_ip`），可将客户端 IP 传递给上游供应商 (#294) [@NightYuYyy](https://github.com/NightYuYyy)
- 新增会话绑定清理工具 (`scripts/clear-session-bindings.ts`)，支持按优先级、ID、名称筛选清理 (#268) [@sususu98](https://github.com/sususu98)
- 仪表盘新增计费详情展示功能

### 优化

- 用户管理 API 增强：改进验证逻辑和响应结构，支持更多字段 (#303) [@NightYuYyy](https://github.com/NightYuYyy)
- 改进 Session 绑定清理工具的类型安全性 (#268) [@sususu98](https://github.com/sususu98)

### 修复

- 修复缓存创建 tokens（5 分钟/1 小时）和 TTL 未保存到数据库的问题，同时修复 React 渲染 bug (#310)
- 修复从 Claude message_start SSE 事件中提取缓存创建 tokens 的问题
- 添加 tool_use_id 错误规则并修复密钥供应商分组 bugs
- 修复 key provider group 相关问题 (#296) [@Hwwwww-dev](https://github.com/Hwwwww-dev)
- 修复 KeyListHeader 组件中 DialogContent 样式问题 (#295) [@Hwwwww-dev](https://github.com/Hwwwww-dev)
- 解决应用 CORS 头时的 TypeError immutable 错误 (#292) [@sususu98](https://github.com/sususu98)
- 修复点击同步规则时的错误 (#309) [@sususu98](https://github.com/sususu98)
- 修复 my-usage 页面成本值的空值处理问题
- 修复迁移索引缺少 IF NOT EXISTS 导致的幂等性问题

### 其他

- 更新 LiteLLM 价格数据
- 多语言翻译更新（日语、俄语、简体中文、繁体中文）

---

## [v0.3.26](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.26) - 2025-12-07

### 新增

- 新增个人使用页面 (my-usage)，用户可查看个人配额、使用日志和过期信息 (#282)
- Session 内请求追踪功能，支持在 Session 详情页查看单个请求详情 (#289)
- 批量终止活跃 Session 功能，管理员可在 Session 管理页批量终止 Session (#279) [@Silentely](https://github.com/Silentely)
- 用户过期时间管理功能，支持设置用户账户过期日期 (#273) [@NightYuYyy](https://github.com/NightYuYyy)
- Cache TTL 偏好设置，供应商和密钥管理支持配置缓存 TTL 偏好
- 供应商分组功能，密钥可关联指定的供应商分组
- 错误覆写支持多格式和异步规则检测 (#258) [@sususu98](https://github.com/sususu98)
- 新增模型相关错误模式（输入/上下文限制等），增强错误识别和报告能力

### 优化

- 替换原生日期选择器为 shadcn/ui DatePickerField，提升日期选择体验
- 个人使用页面筛选器与请求日志页面对齐，统一用户体验
- 图表工具提示可见性改进，数据展示更清晰
- 登录流程和权限管理增强，支持只读访问路径
- Gemini 透传超时机制优化 + undici 超时配置 (#258) [@sususu98](https://github.com/sususu98)

### 修复

- 修复 CORS 预检请求返回 401 的问题 (#287) [@ylxmf2005](https://github.com/ylxmf2005)
- 修复 Session 消息页面 URL locale 重复问题和响应体存储问题
- 修复迁移索引创建缺少 IF NOT EXISTS 导致的重复创建错误
- 修复用户 Schema 中 providerGroup 字段未设置 nullable 的问题
- 修复代理转发器和供应商链格式化的错误处理
- 修复日期筛选时区问题，使用毫秒时间戳确保准确性 (#274)

### 其他

- 更新 GitHub 工作流文件，改进 CI/CD 流程
- 代码格式化更新

---

## [v0.3.25](https://github.com/ding113/claude-code-hub/releases/tag/v0.3.25) - 2025-12-05

### 修复

- 增强代理转发器日志安全性，隐藏 URL 中的查询参数和 API 密钥 (#272)
- 增强代理转发器错误诊断，添加详细的错误原因、堆栈追踪和请求上下文信息 (#272)
- 优化请求头处理，将 "connection" 加入黑名单以改善 undici 兼容性 (#272)

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
