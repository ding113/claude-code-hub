# 常用页面与写入链路性能优化路线图（无感升级优先）

更新时间：2026-03-01

## 目标

- 让常用界面（仪表盘、使用记录、排行榜、供应商管理）在数据量增长/并发增加时，仍能维持稳定的响应时间。
- 显著降低服务器负载（DB CPU/IO、应用 CPU、内存占用、连接数、Redis 压力）。
- 优化需尽量“不改变现有行为”：升级后用户体验应尽可能无感（除了更快、更稳）。

## 约束与原则（确保无感升级）

- 优先做“读路径”优化：缓存/预聚合/索引/分页策略，风险低、收益大。
- 写路径优化必须“可回滚、可开关”：任何改变写入时序/一致性的优化都应有 feature flag，并保留旧路径。
- 迁移必须向后兼容：以“新增表/新增索引/新增字段”为主，避免破坏性变更（drop/rename）。
- 观测先行：每一项优化都要能被指标/日志证明效果，并能在异常时快速降级。

## 现状链路速览（按页面/情形）

### 仪表盘（Dashboard）

- 页面入口：`src/app/[locale]/dashboard/page.tsx`
- 主要数据：
  - Overview：`src/actions/overview.ts` -> `src/lib/redis/overview-cache.ts` -> `src/repository/overview.ts`（读 `usage_ledger`）
  - Statistics：`src/actions/statistics.ts` -> `src/lib/redis/statistics-cache.ts` -> `src/repository/statistics.ts`（读 `usage_ledger`，含 buckets + zero-fill）
- 风险点：
  - 管理员视角可能一次拉取“全体用户/全体 keys 的 bucket 数据”，CPU 与内存放大明显。
  - 缓存 miss 时聚合查询会产生尖刺（thundering herd 已用锁缓解，但仍会打 DB）。

### 使用记录（Usage Logs）

- 页面入口：`src/app/[locale]/dashboard/logs/page.tsx`
- 查询方式：
  - 列表：`src/actions/usage-logs.ts:getUsageLogsBatch` -> `src/repository/usage-logs.ts:findUsageLogsBatch`（keyset pagination，无 COUNT）
  - 筛选项：`src/actions/usage-logs.ts:getFilterOptions` 内存缓存 5 分钟（避免 3 次 DISTINCT）
  - 活跃会话：`src/actions/active-sessions.ts`（SessionTracker + 聚合查询 + 本地缓存）
- 风险点：
  - 前端自动刷新如果全量 refetch 所有 pages，会对 DB 造成持续压力（尤其是多人同时打开 logs 页）。

### 排行榜（Leaderboard）

- 页面入口：`src/app/[locale]/dashboard/leaderboard/page.tsx`
- 数据入口：`src/app/api/leaderboard/route.ts` -> `src/lib/redis/leaderboard-cache.ts` -> `src/repository/leaderboard.ts`（按周期聚合 `usage_ledger`）
- 风险点：
  - 自定义区间/全站维度的聚合可能扫描大量 ledger 数据；缓存 miss 时压力集中。

### 供应商管理（Providers）

- 页面入口：`src/app/[locale]/dashboard/providers/page.tsx`（复用 settings/providers 组件）
- 客户端多请求：
  - providers：`src/actions/providers.ts:getProviders`（当前使用 `findAllProvidersFresh()` 绕过 provider cache）
  - health：`src/actions/providers.ts:getProvidersHealthStatus`
  - statistics：`src/actions/providers.ts:getProviderStatisticsAsync`（前端 60s interval）
  - system-settings：`/api/system-settings`
- 风险点：
  - 多个独立 query 的“瀑布式”刷新容易放大 API/DB QPS。
  - provider 列表绕过缓存会导致频繁全表读取（尤其是多人同时管理）。

### 高频写入情形：每次新请求写入数据库

- 入口：`src/app/v1/_lib/proxy/message-service.ts:ProxyMessageService.ensureContext`
  - 同步写：`src/repository/message.ts:createMessageRequest` -> `message_request INSERT`
- 请求结束/更新：
  - `src/repository/message.ts:updateMessageRequest*`（默认 `MESSAGE_REQUEST_WRITE_MODE=async`，走 `src/repository/message-write-buffer.ts` 批量 UPDATE）
- 派生 ledger：
  - DB trigger：`src/lib/ledger-backfill/trigger.sql`（`AFTER INSERT OR UPDATE ON message_request`，每次写都 upsert `usage_ledger`）
- 风险点：
  - 写放大：每个请求至少 1 次 INSERT + 1 次 UPDATE（甚至更多），且每次都会触发 `usage_ledger` UPSERT。
  - `message_request` 索引较多，写入会额外消耗 CPU/IO；大 JSON 字段会导致 row bloat 与 vacuum 压力。

## 已落地的低风险优化（不改变语义）

- 系统设置缓存跨实例失效通知：在保存系统设置后通过 Redis Pub/Sub 广播失效，让各实例的进程内缓存立即失效（减少重复读 `system_settings`）。
- 使用记录自动刷新减负：前端仅轮询“最新一页”，并合并到现有无限列表（避免 react-query 在 infiniteQuery 下重拉所有 pages）。
- 供应商管理请求瀑布减负：将 providers/health/system-settings 合并为单一 bootstrap 请求（约 4 个请求 -> 2 个请求）；providers 列表改为走 30s TTL + pub/sub 失效的进程缓存（降低 DB 读放大）。

### 已落地代码位置（便于继续扩展）

- 系统设置缓存与失效广播：
  - 缓存实现：`src/lib/config/system-settings-cache.ts`
  - 保存设置后发布失效：`src/actions/system-config.ts`
  - 统一出口（仅 server 侧使用）：`src/lib/config/index.ts`
  - 失败退避：当 DB 不可用时也会缓存 fallback（避免每次调用都重复打点/重试）
- 使用记录页自动刷新减负：
  - 轮询/合并/去重：`src/app/[locale]/dashboard/logs/_components/virtualized-logs-table.tsx`
  - 覆盖测试：`src/app/[locale]/dashboard/logs/_components/virtualized-logs-table.test.tsx`

## 分层优化路线图（按收益/风险分级）

### P0：低风险、优先落地（默认不改变行为）

1) 统一系统设置读路径为缓存（并保持可降级）
- 目标：把全站“频繁读 system_settings”压到接近 0（在 TTL 内/命中场景）。
- 做法：
  - 页面/接口/代理热路径统一改用 `src/lib/config/system-settings-cache.ts:getCachedSystemSettings()`。
  - 依赖 Redis 时用 pubsub 即时失效；无 Redis 时仍按 TTL 自动过期（不影响可用性）。

2) 轮询策略与请求编排（减少无效 QPS）
- 使用记录：保持 keyset pagination；自动刷新仅更新最新页（已落地）。
- 活跃会话：在服务端已有缓存的前提下，前端可考虑仅在 tab 可见时轮询，或对并发计数做短 TTL 缓存（不改变展示语义）。
- 供应商管理：将 providers/health/statistics 的刷新节奏错峰，或合并为单一 endpoints（需要评估 UI 代码改动范围）。

3) 缓存 miss 尖刺治理（降低“缓存雪崩”影响）
- Overview/Statistics/Leaderboard 的 Redis 锁机制已存在，可补充：
  - 更细粒度的 cache key（例如按 scope/filters 维度拆分），避免一个 key 承载过多场景。
  - 在缓存写入失败时记录最小必要信息（避免静默长期退化）。

4) 查询列裁剪与只读路径分离（减少 IO）
- 使用记录列表页：尽量只 select 列表展示所需字段；详情弹窗再拉大字段（如 errorStack、providerChain、specialSettings）。
- 供应商管理列表：主列表优先“轻字段”；统计/健康信息独立异步加载（已基本实现）。

### P1：中风险、需开关/兼容迁移（收益巨大）

1) 写放大治理：让 `usage_ledger` 写入更“按需”
- 方向 A（推荐）：对 trigger 加 `WHEN` 条件，只在关键字段变化时 upsert
  - 示例触发字段：`status_code`、`cost_usd`、`duration_ms`、`tokens`、`blocked_by`、`provider_chain`、`model/provider_id` 等。
  - 优点：不改变外部读模型（usage_ledger 仍是源），但能显著减少重复 UPSERT。
  - 风险：需要严谨列出“影响 billing/统计/展示”的字段集合，避免漏更新。
  - 已落地：在 trigger 函数内对 `usage_ledger` 相关字段与派生值（`final_provider_id` / `is_success`）做对比，无变化直接 `RETURN NEW`，减少无效 UPSERT（迁移：`0078_perf_usage_ledger_trigger_skip_irrelevant_updates.sql`）。
- 方向 B：仅在“终态”写入 ledger（例如 `duration_ms IS NOT NULL` 或 `status_code IS NOT NULL`）
  - 优点：写放大最小。
  - 风险：会改变“进行中请求”的统计可见性，需要产品确认，并必须 feature flag。

2) 大表分区（message_request / usage_ledger）
- 当数据量达到千万级后，聚合与范围查询更依赖分区裁剪。
- 做法：按月/周分区，保留相同 schema 与索引；对读路径保持透明。
- 风险：迁移复杂、需要演练；必须保证自动迁移与回滚策略。

3) 预聚合/rollup 表（从“每次扫明细”到“读汇总”）
- 为 dashboard/leaderboard/statistics 引入 rollup：
  - 例如 `usage_ledger_rollup_hourly` / `usage_ledger_rollup_daily`（按 user/provider/model 维度聚合）
  - 由后台任务或增量触发更新
- UI 查询优先读 rollup，必要时再回退到明细聚合。
- 风险：一致性与延迟（需要定义可接受的统计滞后，例如 30s/1m）。

4) 大字段拆表（降低行膨胀与 vacuum 压力）
- `message_request` 的 `error_stack`、`error_cause`、`provider_chain`、`special_settings` 等可迁移到侧表（按 request_id 1:1）。
- 列表页默认不 join 大字段，只有需要时再 join。
- 风险：需要迁移脚本与读写双写/回读逻辑，建议分阶段上线。

### P2：高风险/架构级（需明确 ROI，通常不作为第一波）

- 将轮询改为推送：SSE/WebSocket（服务器端维护订阅，减少重复查询）。
- 将历史明细转入分析型存储（如 ClickHouse）：
  - Postgres 保留近期热数据；报表/排行榜走分析库。
- 将 message_request/usage_ledger 写入改为 event sourcing + 异步消费（需大量改动与完善的幂等/重放机制）。

## 验收指标（建议纳入监控）

- 页面：
  - 仪表盘/使用记录/排行榜/供应商管理：TTFB、接口 p95/p99、前端渲染耗时（可选）。
- DB：
  - QPS、慢查询数量、CPU、IO、连接数、锁等待、autovacuum 追赶情况、WAL 产出与复制延迟（如有）。
- Redis：
  - 命中率、带宽、锁 key 冲突率、pubsub 消息量。
- 写路径：
  - 每请求写入次数（INSERT/UPDATE/UPSERT）、message_write_buffer flush 频率与失败率、pending queue 大小。

## 文件导航（便于继续深入）

- 系统设置：`src/repository/system-config.ts`、`src/lib/config/system-settings-cache.ts`
- 仪表盘：`src/actions/overview.ts`、`src/actions/statistics.ts`、`src/repository/overview.ts`、`src/repository/statistics.ts`
- 使用记录：`src/actions/usage-logs.ts`、`src/repository/usage-logs.ts`、`src/app/[locale]/dashboard/logs/`
- 排行榜：`src/app/api/leaderboard/route.ts`、`src/lib/redis/leaderboard-cache.ts`、`src/repository/leaderboard.ts`
- 供应商管理：`src/actions/providers.ts`、`src/repository/provider.ts`、`src/app/[locale]/settings/providers/`
- 写入链路：`src/app/v1/_lib/proxy/message-service.ts`、`src/repository/message.ts`、`src/repository/message-write-buffer.ts`、`src/lib/ledger-backfill/trigger.sql`
