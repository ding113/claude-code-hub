# 网关多核心运行模式

## 目标与结论

生产启动入口 `cluster.js` 可以在一个容器内运行多个完整的 `server.js` 网关进程，把不同请求的 JSON 处理、过滤、格式转换、响应分析、usage 计算和写回工作并行分散到多个 V8 event loop。默认 `auto` 模式只在探测到 **至少 4 个有效 vCPU** 且内存与共享预算足够时启用。

实现刻意没有把“大请求体 -> 单独 JSON worker -> 完整对象返回”作为方案。普通 JavaScript 对象跨 `worker_threads` 或子进程时需要 structured clone/序列化，大字符串、tools schema、base64 图片和深层对象会同时保留字节、字符串、AST 与克隆结果，峰值内存往往比节省的 event-loop 时间更危险。当前模式让一条请求从 socket 读取到最终结算始终归属于同一个 worker；primary 只转交 socket handle，不通过 IPC 发送正文或对象树。

请求完成后的 usage、计费、replay complete、亲和绑定和 durable message 写入也保留在同一请求 worker 中。这样既不复制响应正文，也不破坏现有事务顺序；由于请求本身已分布到多个进程，这些终态计算会自然并行。

逐阶段热点、所有可并行化候选、parse-only worker 的内存模型和后续实施门槛见[多核心并行化与热点拆分审计](./research/gateway-multicore-parallelization-analysis.md)。

## 默认行为

| 环境 | `CCH_MULTICORE_MODE=auto` 的行为 |
| --- | --- |
| 非 production 或 CI | 单进程 |
| 有效 vCPU < 4 | 单进程 |
| 4 vCPU、内存/预算足够 | 2 个完整网关 worker |
| 6 vCPU、内存/预算足够 | 3 个完整网关 worker |
| 8+ vCPU、内存/预算足够 | 最多 4 个完整网关 worker |
| 未配置 Redis 跨进程缓存失效 | 单进程 |
| 内存或任一共享预算不足以安全容纳 2 个 worker | 单进程 |

自动数量为以下容量的最小值：

```text
min(4, floor(effective_vCPU / 2), memory_capacity, shared_budget_capacity)
```

每个进程预留两个 vCPU 的原因是主 JavaScript 线程之外仍有 GC、异步 zlib/libuv、TLS 和原生代码工作，避免“4 vCPU 启 4 个主线程”把尾延迟和内存推到不可控区间。需要覆盖默认值时可显式设置 worker 数。

## 资源探测

`server-lib/multicore.js` 使用最保守的可见资源值：

- CPU：`os.availableParallelism()`、cgroup v2 `cpu.max`、cgroup v1 CFS quota 和 cpuset 的最小值；小数 quota 向下取整。
- 内存：`os.totalmem()` 与 cgroup v2/v1 memory limit 的最小值。
- 默认每个完整网关预留 1024 MiB，并为轻量 primary/运行时开销预留 256 MiB。

自动模式还要求配置 `REDIS_URL`，且 `ENABLE_RATE_LIMIT` 不能关闭。错误规则、请求过滤器、敏感词、Provider cache、系统设置、Provider group 计费倍率、熔断配置和 API Key Vacuum Filter 等进程本地快照使用 Redis Pub/Sub 接收微小的失效通知；没有这条控制通道时自动回退单进程，避免管理写入只刷新命中它的某一个 worker。显式要求多进程但缺少该通道会直接启动失败。Redis 在启动或运行期间暂时不可用时，订阅登记不会丢失：共享订阅器按 1 秒到 60 秒的指数退避持续重试；首次订阅和每次重连成功后都会向所有登记者合成一次 resync 失效，强制从数据库等权威存储重载，从而覆盖 Pub/Sub 无法补发的断线窗口。恢复前仍沿用现有多实例 fail-open 语义。

Provider group 倍率缓存额外使用版本号阻止“更新通知到达后，较早发出的 DB 查询才返回并重新写入旧值”的竞态；更新广播只在数据库提交后发送。每进程缓存最多保留 10,000 个原始 group 表达式，TTL 为 60 秒，避免高基数字符串在多个 V8 heap 中无界累积。多核心 worker 会在报告 ready 前完成首次订阅尝试；Redis 临时不可用时保留 TTL 降级语义、持续后台恢复且不在请求正文路径排队。

系统设置缓存使用相同的查询版本栅栏，覆盖计费口径、hedge loser、stream gate、replay、限额 lease 和响应策略等热路径开关。保存操作在数据库提交后先清空本进程，再发布不含设置内容的失效消息；其他 worker 收到后只清本地快照。发布失败时仍由 60 秒 TTL 收敛，不会把完整配置对象放进 Redis Pub/Sub。

因此，容器看到宿主机有很多核心但 cgroup 只分配 3.5 vCPU 时，有效值为 3，不会自动启用。没有容器 CPU quota 的 Docker 部署会按宿主机可见核心判断；共享宿主机上建议显式设置容器 quota 或 `CCH_MULTICORE_WORKERS`。

## 进程拓扑与启动顺序

```text
                         public :3000
                              |
                    cluster primary (轻量)
                  只分发 socket handle，不读正文
                     /          |          \
                    /           |           \
          worker 0             worker 1      worker N
       gateway-control          gateway       gateway
       请求 + 后台任务           仅请求          仅请求
             |                    |              |
      127.0.0.1:随机端口   127.0.0.1:随机端口  127.0.0.1:随机端口
       私有 WS 回环 HTTP      私有 WS 回环 HTTP   私有 WS 回环 HTTP
```

1. primary 只启动 slot 0。
2. slot 0 完成 Next prepare、迁移、规则同步、队列和 scheduler 初始化并开始监听。
3. slot 0 通过一个只有 type/index/pid 的小型 IPC 消息报告 ready。
4. primary 再启动其余 request-only worker；它们验证数据库并加载各自的本地缓存，不重复启动 singleton 后台任务。

这样可避免多个新进程在迁移和默认数据尚未就绪时同时接流量，也避免 Bull consumer、价格同步、outbox recovery、探测与清理调度器在同一容器内成倍注册。slot 0 异常退出时 supervisor 会用同一角色和同一资源分片重启它。

## WebSocket 正确性

`/v1/responses` WebSocket 的连接队列、per-process secret 和持久上游 WS session 都具有进程归属。若它仍回环到共享的公共端口，cluster 可能把内部 HTTP 请求交给另一个 worker，造成 secret 不匹配或 `store=false + previous_response_id` 续接状态丢失。

每个 worker 现在创建独占的 `127.0.0.1:0` HTTP listener，且显式使用 `exclusive: true`。该 worker 接收的 WS frame 只回到自己的随机端口，因此：

- 客户端 WS 连接、frame queue、内部 HTTP 请求和上游持久 session 始终在同一进程；
- 不需要在进程间共享 secret；
- 大 WS 正文不会经过 cluster IPC；
- shutdown 同时关闭公共 listener、私有 listener 和 WebSocket server。

这里仍保留既有的 WS -> 本机 HTTP 序列化成本。进一步删除这次序列化需要把 Next/Hono proxy core 抽成可直接调用的内部 API，是独立的大型重构；本次实现优先消除跨进程错误路由和新增内存复制。

## 内存与连接预算

完整进程会复制 V8 heap、Next 模块缓存、Redis/DB client、socket pool 和本地 cache。为了不让“2~4 个进程”直接变成“2~4 倍预算”，launcher 将下列已有配置解释为**一个容器内的聚合预算**并按 slot 确定性分摊，余数优先给较低 slot：

| 聚合配置 | 默认总量 | 每个 worker 的最低合法分片 | 目的 |
| --- | ---: | ---: | --- |
| `DB_POOL_MAX` | 20 | 1 | 保持容器内数据库连接总上限 |
| `MESSAGE_REQUEST_ASYNC_MAX_PENDING` | 5000 | 100 | 限制 durable message writer 排队对象 |
| `DETACHED_STREAM_MAX_CONCURRENCY` | 64 | 1 | 防止 detached stream 数量倍增 |
| `DETACHED_STREAM_BUDGET_BYTES` | 64 MiB | 3 MiB + 64 KiB | 限制 detached/replay 缓冲 |
| `DETACHED_STREAM_METERING_RESERVE_BYTES` | 16 MiB | 64 KiB | 保留最小计量空间 |
| `STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP` | 256 MiB | `4 * STREAM_GATE_PREBUFFER_BYTE_CAP` | 限制 stream gate 前缀缓冲 |
| `REPLAY_MAX_CONCURRENT_SPOOLS` | 64 | 1 | 防止每进程各自获得完整 spool 并发 |

例如默认 2 worker 时，`DB_POOL_MAX=20` 变成 10/10；3 worker 时是 7/7/6。Kubernetes 的多个 Pod 仍各自拥有一份聚合预算，所以数据库总连接上限需要按 Pod 数继续核算。

显式 worker 数超过内存容量或无法为每个 worker 生成合法分片时，launcher 会 fail fast，而不是悄悄启动一个可能 OOM 或配置校验失败的集群。自动模式则安全回退单进程。每请求正文上限、单响应上限等请求级限制不会分摊。

### 为什么不用正文 IPC

- `child_process.send()` 需要序列化与解析；普通对象和字符串不是共享内存。
- `worker.postMessage()` 的普通对象需要 structured clone；即便 transfer 原始 `ArrayBuffer`，解析后的 AST 返回主线程仍要整树复制。
- `SharedArrayBuffer` 只能共享字节，不能共享普通 JavaScript 对象。
- 为保持“同步语义”使用 `Atomics.wait()` 会直接阻塞 gateway event loop。
- 大请求排队到独立解析池还需要同时限制 task 数与 queued bytes，否则多个接近 100 MiB 的正文会快速放大 RSS。

完整请求分片避免上述复制：worker 从自己的 socket 直接读取，所有中间字符串/AST/转换结果在同一 heap 内产生并尽早释放。

## 配置

```dotenv
# auto | on | off；多进程要求 REDIS_URL 且 ENABLE_RATE_LIMIT 未关闭
CCH_MULTICORE_MODE=auto

# 可选精确值。1 强制单进程；production 下 2~32 可覆盖 CPU 门槛，但仍受内存/预算校验。
# CCH_MULTICORE_WORKERS=4

# worker 数量的内存安全模型
CCH_MULTICORE_MEMORY_PER_WORKER_MB=1024
CCH_MULTICORE_PRIMARY_MEMORY_RESERVE_MB=256

# 可选的启动/关闭监督边界；关闭默认值为 SHUTDOWN_HARD_EXIT_MS + 5 秒
# CCH_MULTICORE_READY_TIMEOUT_MS=180000
# CCH_MULTICORE_SHUTDOWN_TIMEOUT_MS=33000
```

常用操作：

- 回滚到旧的单进程拓扑：`CCH_MULTICORE_MODE=off` 或 `CCH_MULTICORE_WORKERS=1`。
- 4 vCPU 但内存小于默认安全模型：保持单进程，或在压测证明安全后显式下调 `CCH_MULTICORE_MEMORY_PER_WORKER_MB`；最低允许 256 MiB，不代表生产推荐值。
- 指定更多 worker：同时复核聚合 DB/stream/replay/writer 预算；launcher 最多允许 32，自动模式最多 4。
- 外部已经为每个容器限制到 1~2 vCPU：维持单进程并通过 Pod/容器副本横向扩展通常更简单。

`CCH_MULTICORE_ACTIVE`、`CCH_MULTICORE_WORKER_INDEX`、`CCH_MULTICORE_WORKER_COUNT` 和 `CCH_MULTICORE_BACKGROUND_OWNER` 由 launcher 写入，不能作为普通部署配置手工拼装。

## 故障与关闭语义

- worker 未在 ready deadline 内启动：先发送 `SIGTERM`，5 秒仍未退出则发送 `SIGKILL`，随后按原 slot 重启。
- worker 发出异步 `error`：先等待短暂的自然 `exit`；若 Node 未再发出 `exit`，则发送 `SIGKILL`，再经过有界宽限期合成且仅合成一次终态。迟到的真实 `exit` 由 worker record 身份检查忽略，不会重复计数或拉起。
- worker 意外退出：指数退避重启，slot 和资源预算不变。
- 同一 slot 在 60 秒内连续失败 5 次：primary 判定 crash loop，终止整个容器，让外层 Docker/Kubernetes supervisor 重新创建干净实例。
- primary 收到 `SIGTERM`/`SIGINT`：转发到所有 worker；worker 继续使用现有的 readiness flip、HTTP/WS drain、durable writer flush、DB/Redis cleanup 顺序。
- 超过 primary shutdown deadline：向残留 worker 发送 `SIGKILL` 并以非零状态退出。

普通 usage/billing 写入没有改成裸 fire-and-forget，也没有移到不耐久的进程内队列；worker 崩溃仍沿用原有请求事务语义。

## 运维与验证

启动日志中的关键事件：

- `multicore_plan_resolved`：有效 CPU/内存、是否启用、worker 数和原因；
- `multicore_worker_started` / `multicore_worker_ready`：slot 生命周期；
- `multicore_cluster_ready`：全部 slot 已 ready；
- `multicore_worker_exited` / `multicore_worker_crash_loop`：异常和重启；
- `server_listening`：包含 worker index/count 与其私有回环端口。

上线前至少对比单进程、自动模式和显式 worker 数，按请求类型分桶观察：

1. 每进程 CPU、event-loop utilization/delay、GC、RSS、heap、external/ArrayBuffer；
2. 吞吐、TTFT、p50/p95/p99、错误率；
3. 1 KiB 到大 body、明文及 gzip/br/zstd、非流式/SSE/WebSocket；
4. DB pool、Redis、upstream socket、writer pending、detached/stream gate/replay 预算；
5. worker kill、slot 0 kill、启动超时、优雅关闭和 WS 续接。

Node cluster 主要按连接分流。少数超长 keep-alive、HTTP/2 多路复用或单条 WebSocket 连接仍会固定在一个 worker，不能仅用“总 CPU 未打满”判断实现失效；压测必须同时观察连接数、每连接请求数和各 worker 负载。对大规模 Kubernetes 部署，外部 L7 按请求分流的多 Pod 仍是首选，内置多进程用于充分利用单 Pod 的 4+ vCPU 配额。
