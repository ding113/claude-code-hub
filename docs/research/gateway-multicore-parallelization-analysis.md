# CCH 网关多核心并行化与热点拆分审计

> 审计日期：2026-08-29
>
> 基线：最新 dev 加 feat/gateway-multicore
>
> 性质：源码与架构审计。生产收益仍须用真实流量分布和固定资源压测确认。

## 执行结论

Node.js 可以让一个应用使用 4 个乃至更多 CPU 核心，但单个 V8 主事件循环不会自动并行执行
JavaScript。CCH 当前最稳健的并行边界是**完整请求**，而不是 JSON.parse、usage、敏感词或每个
SSE chunk：多个完整 gateway worker 直接从共享监听端口接收不同连接，每条请求从 socket、正文、
对象树、上游响应到最终结算始终归同一 worker 所有。

本分支据此实现了资源感知的 Node cluster：

- auto 仅在 production、有效 vCPU 不少于 4、内存和共享预算足够、Redis 失效通道可用时开启；
- 4 vCPU 默认 2 个 gateway worker，6 vCPU 默认 3 个，8 vCPU 及以上默认最多 4 个；
- primary 只转交 socket handle，应用 IPC 只有 type、workerIndex、pid 三个 ready 字段；
- 请求正文和解析后的普通 JavaScript 对象不经过 IPC，不产生第二份跨 isolate 对象树；
- usage、转换、统计和写回随请求自然分布到多个进程，不额外搬运响应正文；
- DB、detached stream、replay、prebuffer 和 writer pending 等既有配置被解释为容器聚合预算并按
  worker 分片，避免进程数直接乘大共享依赖和缓冲上限；
- 仅 slot 0 运行 singleton 后台任务，其余 worker 只初始化请求必需的本地状态；
- 每个 worker 有独占的 IPv4 loopback listener，Responses WebSocket 内部请求不会被另一 worker
  接走；
- 系统设置与 Provider group 计费倍率缓存使用提交后 Redis 广播和查询版本 fence；倍率缓存
  另有 60 秒 TTL 与每进程 10,000 项上限，避免跨进程旧值和高基数内存增长；
- worker error、缺失 exit、启动超时、crash loop 和 shutdown 都有有界监督。

因此，本次没有加入 parse-only worker，也没有把终态 SQL/Redis 写回改成进程内 fire-and-forget。
这不是保守地少做，而是当前源码约束下同时兼顾吞吐、峰值内存和账务正确性的最优第一阶段。

## 判断原则

评估“能否并行”必须同时回答五个问题：

1. 工作是否真正在 JavaScript 主线程消耗 CPU，还是本来就在等待 DB、Redis、上游网络或 libuv？
2. 输入和输出跨 isolate 时要复制多少字节、字符串和对象节点？
3. 是否能转移唯一 ownership，还是主线程仍需保留原始正文或完整 AST？
4. 任务失败、进程退出、取消或重试时，是否会漏记或重复计费、泄漏 lease、破坏 replay/affinity？
5. 队列是否同时限制任务数和 queued bytes，并纳入 shutdown、超时和监控？

仅把同步函数包装进 Promise、queueMicrotask、setImmediate 或 AsyncTaskManager 不会使用其他核心。
worker_threads 能并行 CPU JavaScript，但普通对象使用 structured clone；child_process IPC 还需要进程
序列化。ArrayBuffer transfer 只能转移原始字节 ownership，不能共享解析后的普通对象图。

## 当前热点与可并行化候选总表

### 请求侧

| 工作 | 性质 | 可选并行边界 | 内存与正确性后果 | 结论 |
| --- | --- | --- | --- | --- |
| socket 与正文读取 | 异步 I/O、body ownership | 完整 gateway worker | primary 不读正文即可零应用级复制 | 已按请求分片 |
| gzip、br、deflate、zstd 解压 | 大正文 CPU 和膨胀分配 | Node 异步 zlib，或粗粒度 request actor | 必须限制解压后大小、in-flight bytes 和线程池竞争 | P1 候选，不单独进程 IPC |
| UTF-8 decode | O(body) CPU 和字符串分配 | 并入粗粒度 actor | 单独返回大字符串仍复制 | 不单拆 |
| JSON.parse | 同步 CPU、创建完整 AST | request actor 内继续完成后续转换 | 把 AST 返回主线程会 structured clone 整棵树，峰值最危险 | 禁止 parse-only 默认方案 |
| pretty JSON 与请求日志正文 | 重复 stringify 和大字符串 | 删除、采样或 actor 内只产小摘要 | 不能把完整 body 再发给日志 worker | P1 先消除工作 |
| header 鉴权和 API key vacuum | 小 CPU、可能 DB/Redis I/O | 在读取大 body 前完成 | 会改变非法请求的错误优先级，需兼容测试 | P1 前移，不送 worker |
| input rectifier | 对象树遍历和修改 | 粗粒度 request actor | 必须固定配置版本和执行顺序 | P2 候选，不单拆 |
| 敏感词提取与匹配 | 随消息长度增长的 CPU | request actor 使用版本化词表 | 返回完整提取文本也可能很大 | 可合并，不单次 IPC |
| request filters | JSON path、正则、deep merge/replace | request actor 使用规则快照 | provider/group 条件和错误语义必须一致 | 可合并，不单次 IPC |
| message extraction | 多协议递归遍历 | 与过滤、指纹共同执行 | 只应返回小型摘要 | 可合并 |
| request/replay identity | stable stringify、hash、全树扫描 | request actor | canonical 字节必须与旧实现完全一致 | 高价值 P1/P2 候选 |
| affinity fingerprint | conversation、tool、media 规范化和 hash | request actor | 影响路由和 generation fence，需要 golden tests | 高价值 P1/P2 候选 |
| provider selection | 本地 cache、共享 breaker、DB/Redis | 完整 gateway worker | 实时状态不适合序列化给 CPU worker | 留请求 worker |
| provider policy、converter、最终 stringify | 对象树 CPU | 选定 provider 后的粗粒度 actor | retry、hedge 和 provider 配置使接口复杂 | profiling 后 P2 |
| header 构造 | 小 Map 操作 | 无 | IPC 固定成本更高 | 留请求 worker |
| upstream fetch | 异步网络和 socket pool | 多 gateway 进程 | 自建 worker 只会复制 client 与连接池 | 留请求 worker |
| hedge、retry、Abort 调度 | timer 与有序状态机 | 完整 gateway worker | winner/loser ownership 不可切碎 | 留请求 worker |

### 响应、usage 与终态

| 工作 | 性质 | 可选并行边界 | 内存与正确性后果 | 结论 |
| --- | --- | --- | --- | --- |
| 非流式 response parse/convert/stringify | 明确正文 CPU | 一次性 response actor | transfer 原始 bytes 后应直接返回最终 bytes 和小摘要 | 先去重，profiling 后 P2 |
| usage、model、tier、error、completion 识别 | 多处重复 parse/scan | 单个 TerminalAnalysis | 各拆一次 IPC 会放大正文和排序问题 | P1 合并为一次分析 |
| 流式 SSE/NDJSON 分析 | 增量协议 CPU | stream pump 内维护紧凑状态 | 逐 chunk IPC 会增加排队、复制、背压和乱序面 | 禁止逐 chunk worker |
| 终态 stream snapshot 再扫描 | 最多若干 MiB 的重复 CPU | pump 结束时直接产摘要 | 摘要必须覆盖异常、截断和 client abort | P1 增量化 |
| Responses WebSocket frame | parse/stringify 与本机 HTTP loopback | 直接调用共享 proxy core | 连接 queue、secret、persistent upstream session 都有进程归属 | 当前用私有 loopback 保正确；P1 删除 loopback |
| 价格查表与 Decimal 成本计算 | 通常较小 CPU | 并入 TerminalAnalysis | 必须固定 price/config 版本 | 不值得独立 IPC |
| message/usage ledger durable commit | DB I/O、事务屏障 | transactional outbox consumer | 至少一次投递要求幂等、版本 fence、重试、DLQ、reconcile | 默认留关键路径 |
| hedge loser 计费 | 并发终态与账务 | durable event 才可外移 | winner/loser 重复和迟到完成风险高 | 不可裸异步 |
| Redis usage、rate-limit、lease | 网络 I/O 与限额一致性 | 仅耐久事件化 | 延迟会弱化限额，crash 会泄漏 lease | 默认留关键路径 |
| replay completed | 有序可见性状态 | durable commit 后的小事件 | 绝不能越过 billing/message commit | 保留 commit barrier |
| affinity/session binding CAS | generation 有序写 | 版本化 durable event | 迟到结果必须被 fence 拒绝 | 默认留关键路径 |
| session response artifact | redact、parse/stringify 加 Redis I/O | 复用 TerminalAnalysis；可选耐久队列 | 影响续接、dashboard 可见性、TTL | CPU 可复用，写入需单独决策 |
| routing trace/public rollup | 小事件构造与外部写 | 已提交后 outbox/consumer | 不得携带完整 body；需幂等 | 适合角色拆分 |
| Langfuse 与详细日志 | 可产生大序列化和网络 I/O | 有界 telemetry queue | 必须有 drop/sample、queued bytes 和脱敏 | 可异步，但不能反压核心请求 |

### 后台与控制面

| 任务 | 多进程风险 | 当前或推荐 owner | 结论 |
| --- | --- | --- | --- |
| migrations | 多 worker 同时启动和等待 | slot 0；PG advisory lock | 已 gate |
| provider vendor/endpoint backfill | 重复扫描 | slot 0；advisory lock | 已 gate |
| ledger backfill、cache effectiveness、replay cleanup | 重复 timer，虽有 DB lock | slot 0/control | 已 gate，长期可独立 control |
| endpoint probe/public status/probe log cleanup | 重复 leader 竞争和连接 | slot 0/control | 已 gate |
| cloud price sync | 进程内标记不能跨进程去重 | slot 0/control | 已 gate |
| routing trace outbox recovery | 重复扫描/竞争 | slot 0/outbox worker | 已 gate，长期可独立 worker |
| Bull cleanup、notification、user reset | 多 gateway 注册会放大 Redis 连接 | slot 0/queue-worker | 已 gate，长期可独立扩缩 |
| session cache cleanup | 每进程自己的 cache | 每个 gateway | 必须每 worker 运行 |
| provider、filter、sensitive、API key、倍率 cache 订阅 | 每进程自己的只读副本 | 每个 gateway | 必须每 worker 运行并支持失效 |
| lifecycle、Langfuse、crash diagnostics | 进程本地 | 每个 gateway | 必须每 worker 运行 |

## 为什么完整请求分片优于 parse-only worker

假设一个大请求包含 tools schema、长消息或 base64 图片。parse-only 方案通常同时存活：

1. Fetch/Node 读取的原始字节；
2. 解码后的 UTF-16 JavaScript 字符串；
3. worker isolate 内的解析对象树；
4. structured clone 到 gateway isolate 的第二棵对象树；
5. rectifier、filter、converter 和 stringify 产生的派生对象或字符串；
6. 排队期间其他请求的同类副本。

即使输入 ArrayBuffer 可以 transfer，第 4 项仍无法通过 transfer 返回。若主线程同步等待 worker，
Atomics.wait 还会直接阻塞 gateway event loop；若异步等待，则必须解决取消、worker crash、队列公平性、
timeout、config snapshot、queued bytes 和 shutdown。parse-only 可能降低主线程 ELU，却增加总 CPU 与 RSS，
因此不能仅凭“更多核心有占用”判断成功。

真正可能成立的 worker_threads 边界是粗粒度 actor：主线程转移唯一输入 bytes，worker 在同一 isolate
连续完成解压、parse、纯 CPU 过滤/指纹/转换和最终 stringify，只返回最终出站 bytes 与固定上限的
TerminalAnalysis。它仍是 P2 实验，因为 CCH 的 DB/Redis/provider/retry 状态会把 actor 切成多个阶段，
而完整 gateway 进程已经用更低复杂度并行了整条链路。

## 内存与 ownership 约束

任何后续并行化必须维持以下不变量：

- primary 和控制进程不得读取、缓存或序列化请求/响应正文；
- 一条请求的普通对象树同一时刻只属于一个 isolate；
- IPC payload 必须是固定上限的小元数据，或 transfer 后失去发送方 ownership 的原始 bytes；
- 队列同时限制 task count 与 queued/resident bytes，拒绝策略必须可观测；
- 解压后大小、单任务 bytes、全局 in-flight bytes、worker heap 和结果 bytes 都有硬上限；
- 大 body 不能因为日志、Langfuse、replay、hedge 或 retry 被无意保留多份；
- 多 gateway 的 V8 heap、Next 模块、local cache、Redis/DB/upstream client 固定开销必须计入容器 RSS；
- 所有“每进程上限”都要明确是否需要按 worker 分片，不能把容器预算乘以进程数。

当前实现通过 socket ownership、极小 ready IPC、私有 WS loopback、聚合预算分片、最低每 worker 内存
预留和倍率 cache 项数上限满足第一阶段约束。它不能消除完整 V8/Next runtime 的固定复制，所以低内存
容器自动回退单进程；这比在压力下依赖 OOM killer 更可预测。

## 终态正确性边界

请求完成后的工作并非都可无序外移。当前关键顺序可以概括为：

```text
上游终态
  -> 协议/usage/成本分析
  -> durable message 与 billing commit
  -> 已提交后的 lease、trace、artifact 等副作用
  -> replay completed 与对外最终可见状态
```

纯分析可以合并或在粗粒度 actor 中执行；durable commit 和它前后的 fence 不能变成裸 void Promise。
如果 profiling 最终证明数据库终态写入是主要瓶颈，唯一可靠的跨进程方向是 transactional outbox：

- 与请求权威状态在同一 DB transaction 写入小事件；
- 使用稳定幂等键和 aggregate version/generation；
- consumer 支持至少一次投递、重试、DLQ、claim 超时和 reconciliation；
- crash injection 证明 enqueue 前失败不会对外宣称完成，enqueue 后重投不会重复计费；
- replay、affinity、lease 和 hedge loser 各自保持现有顺序约束。

这属于事务架构升级，不应仅为让 CPU 图更均匀而实施。

## 实施优先级

### 已完成的 P0

1. 资源感知的完整 gateway 多进程，默认 vCPU 不少于 4 才开启。
2. cgroup CPU quota、cpuset、memory limit 与 os.availableParallelism 的保守探测。
3. 内存和共享预算容量校验、确定性分片、显式配置 fail-fast。
4. slot 0 背景 owner、request-only worker、本地 cache 初始化与 ready 顺序。
5. 私有 WS loopback，避免 cluster 跨 worker 错路由和正文 IPC。
6. worker startup/error/exit/crash-loop/shutdown 的有界监督。
7. standalone 与 Docker 启动入口、server-lib 产物复制和部署文档。
8. 系统设置与 Provider group 倍率跨进程提交后失效、查询版本栅栏和有界降级。

### 下一阶段 P1：先减少工作和复制

1. 建立真实 CPU profile、ELU、event-loop delay、GC 和 body size 分桶基线。
2. 将可安全的 header 鉴权、Content-Length 与 byte admission 前移到读取大正文之前。
3. 评估同步解压改为异步 zlib，并统一限制解压并发和 resident bytes。
4. 删除不必要的 Request clone、生产 pretty body 和重复 stringify/parse。
5. 形成一次性 TerminalAnalysis，流式协议在 pump 内增量维护摘要。
6. 抽取可直接调用的 proxy core，删除 WS 到本机 HTTP 的重复 parse/stringify。
7. 对 Langfuse、日志与 artifact 明确 body 截断、采样、drop 和 byte budget。

### Profiling 后的 P2

只有 P1 后 profile 仍显示纯 CPU 阶段占主导，才建立固定 worker_threads pool，并要求：

- 复用 worker，不按请求创建；
- byte-weighted bounded queue 和 worker heap 上限；
- transferable ArrayBuffer 单一 ownership；
- 粗粒度 request 或 response actor，不做 parse-only 和逐 chunk IPC；
- config snapshot version、typed error、Abort、deadline、worker recycle、shutdown drain；
- standalone worker bundle、source map 和产物契约测试；
- feature flag、单线程回退和与 baseline 的 golden parity。

### P3/P4

- 将 control、queue-worker、admin、init 从 gateway 角色进一步拆出，独立分配 DB/Redis/CPU 预算；
- 仅在终态存储延迟被证实为瓶颈时，使用 transactional outbox 外移可重试副作用。

## Benchmark 与验收矩阵

生产结论不能由单元测试或本机总 CPU 推导。至少比较单进程、auto、显式 2/4 worker，并覆盖：

- 请求体：1 KiB、64 KiB、1 MiB、8 MiB、接近上限；文本、深层 JSON、大 tools、base64；
- encoding：identity、gzip、br、deflate、zstd，以及高压缩比输入；
- 协议：Anthropic、OpenAI、Gemini；非流式、SSE/NDJSON、Responses WebSocket；
- 连接：大量短连接、大量 keep-alive、少量 hot keep-alive、H2 终止方式、长 WS；
- 功能：filters、sensitive、affinity、replay、conversion、hedge、retry、Langfuse；
- 故障：client abort、slow consumer、worker kill、slot 0 kill、Redis 短断、DB admission、shutdown；
- 并发：32、128、512 以及真实业务峰值和 body 分布。

必须按 worker 记录 CPU、ELU、event-loop delay、RSS、heap、external、arrayBuffers、GC、连接数和请求数；
同时观察吞吐、TTFT、p50/p95/p99、错误率、DB pool、Redis latency、upstream sockets、writer pending、
detached/replay/prebuffer bytes。少量 keep-alive 或 WS 连接可能天然倾斜，不能只看容器总 CPU。

worker 或新异步边界的采用门槛至少是：固定总 CPU 下吞吐显著上升，event-loop delay 下降，p99/TTFT
不恶化，RSS 与 queued bytes 有硬上限，并且 billing、replay、affinity、session、lease 与 WS 结果和
baseline 完全一致。parse-only 若只改善 ELU，却增加总 CPU/RSS 或降低吞吐，应直接淘汰。

## 明确不采用的方案

- 每请求创建 Worker 或子进程；
- 用 child_process IPC 搬运大请求或响应；
- worker parse 后 structured-clone 完整 AST 回主线程；
- 将 JSON.parse、敏感词、usage、model、error 各拆成一次 IPC；
- 逐 SSE/NDJSON chunk 往返 worker；
- 用 SharedArrayBuffer 试图共享普通 JavaScript object graph；
- 用 Atomics.wait 保持同步语义并阻塞 gateway；
- 只有 task count、没有 queued bytes 上限的 worker queue；
- 无界增加 UV_THREADPOOL_SIZE、worker 数或每进程连接池；
- 将 DB、Redis、fetch 等异步 I/O 搬到 CPU worker；
- 将 billing、replay、affinity、lease 写回改为非耐久 fire-and-forget；
- 未处理 WebSocket 进程归属就让内部 loopback 进入共享 cluster 端口；
- 让每个 gateway 重复注册 singleton scheduler 和 Bull consumer；
- 仅看总 CPU 使用率，不看 per-worker 连接倾斜、ELU、RSS 和共享依赖饱和。

## 源码索引

- 启动与资源：cluster.js、server-lib/multicore.js、server-lib/cluster-supervisor.js、server.js
- 进程角色：src/instrumentation.ts、src/lib/lifecycle/shutdown.ts
- 请求主链：src/app/v1/_lib/proxy-handler.ts、src/app/v1/_lib/proxy/session.ts、forwarder.ts
- 请求 CPU：request-body-codec.ts、request-filter-engine.ts、message-extractor.ts、affinity/fingerprint.ts
- 响应终态：response-handler.ts、client-abort-metering.ts、src/repository/message.ts
- WebSocket：server.js、src/app/v1/_lib/responses-ws
- cache 一致性：src/lib/redis/pubsub.ts、src/lib/cache、src/repository/provider-groups.ts
- 部署：Dockerfile、deploy/Dockerfile、docs/k8s-deployment.md、docs/multicore-gateway.md

## 官方机制参考

- [Node.js Cluster](https://nodejs.org/api/cluster.html)
- [Node.js Worker threads](https://nodejs.org/api/worker_threads.html)
- [Node.js Child process](https://nodejs.org/api/child_process.html)
- [Node.js Zlib](https://nodejs.org/api/zlib.html)
- [Node.js os.availableParallelism](https://nodejs.org/api/os.html#osavailableparallelism)
- [Node.js Performance hooks](https://nodejs.org/api/perf_hooks.html)
- [Fetch Standard body clone](https://fetch.spec.whatwg.org/#concept-body-clone)
