# CCH 性能优化落地方案

## 1. 结论

本轮性能问题的主因不是 CPU 或宿主机算力不足，而是上游低质量请求被重试、hedge、长超时和大上下文放大后，进一步推高 Node 常驻内存、Redis 大对象、连接池和多副本后台任务数量。

本轮优先落地不新增 Pod、sidecar、PVC、Redis、PgBouncer、CronJob 或其他外部组件的优化。实施原则是先消除确定性的资源放大器，再为重试总 deadline 和 AvailableModels 上游缓存建立独立契约，避免在一个 PR 中同时改变多套转发语义。

## 2. 本轮已落地

### 2.1 TTFT 与 TTFB 分离

- `TTFB` 定义为网关收到请求到最终 winner 的响应头到达。
- `TTFT` 定义为网关收到请求到首个协议有效内容到达，不把 SSE comment、metadata、usage-only、空 delta 或 terminal frame 当作首 token。
- 新口径写入 `timingSemanticsVersion = 2`。历史混合口径不回填，不参与 TTFB、TTFT 和 TPS 聚合。
- 输出速率使用 `outputTokens / (durationMs - ttftMs)`。TTFT 不可用时输出速率也不可用。
- 请求详情、普通日志表、虚拟日志表、排行榜、Public Status 和 Langfuse 均使用统一口径。

收益：避免把旧 TTFT 数值错误展示为 TTFB，也避免用错误的首字时间计算输出速率和排行榜指标。

### 2.2 排行榜成功率和缓存系数

- redirect 后的供应商和模型继续计算成功率，并标记统计口径为 original 或 redirected。
- 只有没有可计数 outcome 时才显示“不适用”。
- 流式、非流式和 Gemini terminal 路径均写入 cache effectiveness 所需字段。
- 聚合任务使用持久 cursor、幂等窗口 upsert 和数据库 advisory lock，避免多实例重复聚合及重复窗口。

收益：修复排行榜成功率全部“不适用”和缓存系数缺失，同时把缓存效果聚合从副本级重复工作收敛为单次有效工作。

### 2.3 Session 快照默认落盘

- 系统设置支持 `filesystem`、`redis` 和 `disabled`，默认 `filesystem`。
- filesystem store 使用 gzip level 1、单异步 worker、atomic rename、文件锁和跨 Pod 清理锁。
- TTL 继承 `SESSION_TTL`，过期文件自动删除。
- 默认单逻辑快照上限 8 MiB、单 Pod pending 上限 64 MiB、目录上限 10 GiB。
- 写入在请求热路径上只做有界入队；超大快照、队列预算不足、损坏文件或磁盘读取失败均 fail-open，不阻塞网关转发。
- backend 切换会原子更新 settings cache 并重配置 store，避免保存设置后短暂回退到 filesystem。

收益：把完整大请求快照从 Redis 内存和 AOF 中移出，同时以明确的大小、队列和目录预算限制本地磁盘风险。

限制：Kubernetes 默认使用节点本地 `hostPath`，只保证同一节点上的副本可共享。多节点部署应切换为 Redis 或自行提供共享文件系统。本轮不新增共享存储组件。

### 2.4 多副本后台任务治理

- cache effectiveness 使用 PostgreSQL transaction advisory lock。
- cloud price sync、replay cleanup 和 probe-log cleanup 使用 PostgreSQL advisory lock，并在锁被占用时直接跳过。
- Redis leader lock 在 production 中 fail-closed；Redis 未 ready 或获取异常时不回退为每 Pod 的 memory lock。
- replay 和 cache effectiveness scheduler 增加防重入、current promise、stop flag 和有界 shutdown quiescence。
- shutdown 在关闭 PostgreSQL 和 Redis 前先停止 scheduler 并等待在途任务退出。

收益：副本数量增加时，聚合、清理和同步任务不再按副本线性放大，也避免资源关闭期间后台任务继续访问已关闭连接。

### 2.5 Endpoint probe 指数退避

- endpoint 保存连续探测失败次数。
- 成功后归零；失败时由 SQL 原子加一。
- 调度间隔按 `10s -> 20s -> 40s -> 80s -> ...` 退避，默认上限 10 分钟。
- `ENDPOINT_PROBE_IDLE_DB_POLL_INTERVAL_MS` 已接入实际调度器。

收益：持续超时或不可达的 endpoint 不再以固定高频率被所有调度周期重复探测，减少无效连接、日志和定时任务压力；恢复成功后自动回到正常频率。

### 2.6 Kubernetes 资源与连接池

- `DB_POOL_MAX` 从 18/24 级别收敛到 8，降低副本扩张时的 PostgreSQL 理论连接上限。
- App request 调整为 `250m CPU / 2Gi memory`，limit 调整为 `2 CPU / 5Gi memory`。
- HPA 删除 memory metric，仅保留 CPU 70%，避免 Node 常驻内存直接触发无收益扩容。
- liveness/startup 使用 `/api/health/live`，readiness 使用 `/api/health/ready`，readiness timeout 为 5 秒。
- dashboard 日志轮询间隔调整为 10 秒。
- Session snapshot 目录挂载到节点本地 hostPath。

收益：避免低 CPU、高常驻内存场景持续扩容，降低连接池和后台任务随副本数放大的风险，同时保留针对进程存活与依赖就绪的独立健康检查。

## 3. 当前建议直接执行的运维动作

这些动作不需要代码或新增组件，收益高且风险低：

1. 禁用欠费、quota 用尽、分组停用、持续 5xx 或持续超时的 provider/endpoint。
2. 对错误率接近 100% 或长期达到 probe 退避上限的 endpoint 建立人工复核清单，不依赖大量 fallback 掩盖故障。
3. 为超大上下文设置更低并发或独立 provider group，优先控制同时驻留的大请求数量。
4. 观察 Redis `used_memory`、AOF rewrite、session key 大小和 eviction 是否在切换 filesystem 后持续下降。
5. 观察 PostgreSQL CCH 连接数是否随 `DB_POOL_MAX=8` 稳定在安全区间。

## 4. 建议拆分为后续独立 PR

### 4.1 Request-local first-content deadline

这是下一项最高优先级优化，但不应在本轮同时实现。推荐契约：

```text
一个 request-local absolute first-content deadline
所有 provider retry、hedge、rectifier 和 transport fallback 共享剩余时间
H2 -> H1、proxy -> direct、WS -> HTTP 不计为 provider attempt
首个协议有效内容到达后解除 first-content deadline
客户端 abort 继续保持 499，provider timeout 和 deadline timeout 使用稳定的独立分类
```

收益：从根源限制请求长时间驻留，避免失败 provider 通过多层 transport fallback 和 provider fallback 把总耗时扩大到 60-100 秒以上。

拆分原因：legacy serial、legacy hedge、Discovery、H2/H1、proxy/direct、Responses WS/HTTP 和 rectifier 都要共享同一 absolute deadline；粗暴加入最大 attempt 数会把 transport fallback 错计为 provider retry，存在明显兼容风险。

### 4.2 AvailableModels per-provider cache、singleflight 和共享限并发

推荐契约：

```text
只缓存每个 provider 的成功模型结果，不缓存用户或 group 聚合结果
同一 provider/config fingerprint 的并发请求 singleflight
使用进程级共享并发上限，结果按原 provider 顺序回填
失败不覆盖成功 cache，瞬时失败不做长 negative cache
provider 配置变更时通过现有 invalidation 广播清理本地缓存
group、活动时间窗和用户可见性仍在每次请求实时过滤
```

收益：减少上游 `/models` 重复请求和无界 fan-out，降低多个客户端同时刷新模型列表时的 stampede。

拆分原因：必须同时保证 group 隔离、活动时间窗、allowlist、配置失效、失败缓存和结果顺序；只加一个 TTL Map 容易返回已禁用 provider 或跨 group 的旧模型。

## 5. 明确不做

- 不新增 Pod、sidecar、CronJob、PgBouncer、Redis 实例、metrics adapter 或共享存储组件。
- 不用 SQLite 保存 Session 快照。当前数据模型是按 sessionId 读取和合并的压缩 JSON blob，filesystem atomic file 的写放大和清理路径更短，也避免 SQLite WAL、vacuum 和跨进程锁竞争。
- 不继续使用 memory HPA 作为主要扩容信号。后续如需改为活跃流、并发或 RPS，应先复用现有可观测数据或平台能力，不能为本优化额外引入组件。
- 不在本轮加入统一 outbound attempt counter。
- 不回填历史 TTFT/TTFB 混合数据，以免产生看似精确但语义错误的指标。

## 6. 验收与观察指标

上线后建议按 1 小时、24 小时和 7 天三个窗口对比：

- Redis session/snapshot key 总字节、最大 key、eviction、AOF 大小和 rewrite 时长。
- 单 Pod 与总 Node 内存、HPA 副本数、CPU utilization、readiness failure。
- PostgreSQL CCH 连接数和连接等待。
- endpoint probe 次数、持续失败 endpoint 的实际探测间隔。
- cache effectiveness scheduler 每窗口实际执行次数和重复窗口数。
- TTFB P50/P95/P99、TTFT P50/P95/P99、TTFB 与 TTFT 的差值。
- 请求 attempt/hedge 分布、499、`STREAM_RESPONSE_TIMEOUT` 和“所有供应商暂时不可用”数量。
- 大上下文请求的并发数、驻留时长和单请求 snapshot 大小。

如果 Redis 内存和后台重复任务明显下降，但请求 P95/P99 仍主要由多轮 fallback 决定，应优先实施 request-local first-content deadline，而不是继续增加副本或连接池。
