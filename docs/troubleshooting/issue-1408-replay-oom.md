# Issue #1408 Replay 断线流内存失控根因报告

## 调查结论

Issue #1408 的 Node 内存失控触发链已经在本地完成机制级复现和因子隔离。该链路能够在受控
环境中稳定触发同类 V8 heap OOM，并与生产环境的 Replay 配置、客户端断线和 Redis 压力现象
高度重合。

已经证明的主触发链由两个同时存在的生命周期缺陷组成：

1. `ReplaySpool` 在活跃响应期间把每个流块解码成字符串，同时保存在本地
   `parts[]`、待写 `pending`/`writeChain` batch 和 Redis LIST 中。本地 `parts[]` 会一直保留
   整条响应，直到上游出现终态或 Replay 被禁用。
2. Replay owner 的客户端断开后，`ProxyResponseHandler` 把普通 60 秒 drain 窗口改成
   `REPLAY_MAX_DETACHED_MS`，默认 300 秒。spool 后续失效时，这个已选定的窗口不会降级，
   因而失去 Replay 价值的上游流仍可能被保留到 300 秒。

这两点使断线流的 JS 字符串、ArrayBuffer、Undici Response、后台任务和 socket 在同一个
300 秒窗口内按请求波次叠加。持续到来的断线请求不需要形成永久引用泄漏，也可以在最早一批
请求进入超时回收之前耗尽 V8 heap 或容器内存。

生产故障发生时没有 heap snapshot，因此本报告证明的是“存在一条足以解释并复现 #1408 的
决定性机制”，不是从生产进程对象图中证明了唯一根因。shadow/hedge 请求复制等其他 v0.9.x
内存放大路径仍可能在实际流量中共同贡献。

## 适用版本与代码边界

- 有效复现版本：`v0.9.2`，提交 `ccbad37f266e3e69d57a4427e2f27cf288796e63`
- 修复目标分支：`dev`，调查时提交 `3fe3225c9f6397d22db27193199e2a8fef4a05f7`
- `/v1/responses` 真实 Codex 转换路径
- `ENABLE_REQUEST_REPLAY=true`
- `REPLAY_MAX_PAYLOAD_BYTES=8 MiB`
- `REPLAY_MAX_DETACHED_MS=300000`
- `STREAM_GATE_MODE=enforce`

PR #1405 已补充 queued batch/abort 清理与 request copy-on-write，但 `dev` 中仍保留整条
`ReplaySpool.parts[]`，也没有处理 spool 失效后的 drain 窗口降级。因此 #1405 降低了部分
异常路径的保留风险，但没有覆盖本报告复现的主触发链。

## 本地复现夹具

隔离环境使用独立 PostgreSQL、Redis、mock upstream 和两个 v0.9.2 app 容器。app 容器限制为
1 GiB，避免实验影响扩散到其他进程。

mock upstream 对每个请求发送有效的 `response.output_text.delta` SSE 帧，累计约 7.5 MiB 后
保持连接打开且不发送终态。客户端确认 mock 收到请求后约 250 ms 主动断开。

可重复运行的夹具已纳入仓库：

```text
tests/load/issue-1408-replay-oom/mock-upstream.cjs
tests/load/issue-1408-replay-oom/drive-disconnect-waves.cjs
tests/load/issue-1408-replay-oom/memory-probe.cjs
tests/load/issue-1408-replay-oom/sample-container.sh
tests/load/issue-1408-replay-oom/run-wave.sh
tests/load/issue-1408-replay-oom/start-mock-container.sh
tests/load/issue-1408-replay-oom/README.md
```

本次调查的原始采样与 fatal report 保留在本机：

```text
/private/tmp/cch1408-wave-on-samples.out
/private/tmp/cch1408-wave-off-samples.out
/private/tmp/cch1408-wave-64k-samples.out
/private/tmp/cch1408-wave-fixed2-samples.out
/private/tmp/cch1408-wave-fixed2-repeat2-samples.out
/private/tmp/cch1408-on-reports/report.20260811.072324.1.0.001.json
```

## 证据一：Replay 把断线 drain 从 60 秒延长到 300 秒

固定 8 个断线请求时：

| 场景 | 25 秒 | 60 秒 | 300 秒后 |
| --- | --- | --- | --- |
| Replay off | external 79.62 MiB，ArrayBuffer 75.65 MiB，21 sockets | 8/8 timeout 开始释放 | external 4.73 MiB，ArrayBuffer 0.77 MiB，13 sockets |
| Replay on | external 81.10 MiB，ArrayBuffer 77.13 MiB，21 sockets | 0/8 timeout，继续保持 | 8/8 timeout 后释放 |

Replay-on 在终态清理后的最终状态为：

```text
external     4.67 MiB
arrayBuffers 0.70 MiB
TCP sockets  13
Async tasks  0
```

这说明单波请求最终会释放，但 300 秒窗口允许多个请求波次在释放前持续叠加。

## 证据二：40 个活跃 Replay 流复现 V8 heap OOM

以 10 秒间隔发送 5 波、每波 8 个不同 Replay 请求。所有请求均在客户端断开后保持上游悬挂。

| 活跃任务 | heapUsed | external | ArrayBuffer | RSS |
| ---: | ---: | ---: | ---: | ---: |
| 8 | 193.78 MiB | 92.27 MiB | 88.30 MiB | 383.68 MiB |
| 16 | 258.36 MiB | 168.32 MiB | 164.35 MiB | 520.14 MiB |
| 24 | 315.20 MiB | 240.16 MiB | 236.19 MiB | 664.54 MiB |
| 32 | 380.65 MiB | 314.59 MiB | 310.62 MiB | 811.62 MiB |
| 40 | 382.60 MiB | 311.58 MiB | 307.61 MiB | 793.50 MiB |

随后 Node 进程直接输出：

```text
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

容器退出码为 `133`。Node fatal report 记录：

```text
javascriptHeap.usedMemory                 437,947,120 bytes
javascriptHeap.memoryLimit                562,036,736 bytes
javascriptHeap.externalMemory             369,633,015 bytes
javascriptHeap.heapSpaces.old_space.used  408,208,280 bytes
resourceUsage.rss                         904,556,544 bytes
resourceUsage.maxRss                      929,734,656 bytes
```

这与 #1408 的生产现象属于同一种 Node 内存增长并最终退出的故障类别。本地容器有 1 GiB 限制，
所以在约 0.9 GiB RSS 时提前终止；生产容器没有内存限制，允许同一类请求波次继续累积到更高
RSS。生产环境约 30 GiB 的绝对值不能仅由该缩小夹具外推。

## 证据三：64 KiB spool 上限隔离出 `parts[]` heap 主因

第三组实验保持 Replay 和 300 秒 drain 不变，只把 `REPLAY_MAX_PAYLOAD_BYTES` 降到 64 KiB。
每个 spool 在首个大块后立即 `payload_too_large`，清空本地 `parts[]`，但上游流仍按 300 秒
窗口 drain。

相同 8 波、共 64 个活跃断线请求的结果：

```text
active stream tasks  64
heapUsed             133.46 MiB
external             586.72 MiB
arrayBuffers         582.75 MiB
RSS                  886.67 MiB
container            running
```

正常 8 MiB spool 在 40 个活跃流时 `heapUsed` 已到 382.60 MiB 并触发 V8 fatal OOM；64 KiB
spool 在 64 个活跃流时 `heapUsed` 仍约 133 MiB。唯一关键变量是 spool 本地正文是否继续保留。
因此 `ReplaySpool.parts[]` 是本次 V8 heap OOM 的决定性持有对象，300 秒 detached drain 是并发
驻留时间放大器。

## 证据四：Session Response Body 三份复制放大 Redis

第一版 Node 修复移除 `parts[]` 并缩短失效 spool 的 drain 后，Node 已不再触发 V8 OOM，但隔离
Redis 在约 300 秒 RDB 保存点仍退出 `137`。检查 Redis key 和配置后确认：

- `STORE_SESSION_RESPONSE_BODY=true`；
- 本夹具约 7.5 MiB 的 SSE 小于 `STREAM_STATS_MAX_BUFFER_BYTES=10 MiB`，会形成完整统计快照；
- 同一正文写入 legacy/request response、before snapshot、after snapshot 三份 Redis key；
- 64 个请求约产生 `3 x 64 x 7.5 MiB = 1.4 GiB` 的正文值。

第一版修复 Redis 的实际峰值为：

```text
used_memory_human      1.50G
used_memory_peak_human 1.51G
OOMKilled=true
ExitCode=137
```

旧版应用 fatal OOM 发生在 Redis 退出之前，因此 Redis 退出不是 Node fatal 的起因；它是独立的
伴随放大器。RDB/AOF fork 与写入压力会进一步放大整机内存和 I/O 压力，这与 #1408 中 Redis
`bio_aof` 阻塞、healthcheck 超时的后续现象一致。

## 代码持有链

当前路径可以简化为：

```text
upstream Uint8Array
  -> ResponseHandler.observeChunk()
  -> BoundedStreamTextAccumulator / stream transport buffers
  -> ReplaySpool.observe()
       -> TextDecoder string
       -> pending[]
       -> queued writeChain batch
       -> parts[] retained until terminal
       -> Redis LIST copy

client disconnect
  -> responsePump.startDrain()
  -> replay owner selects 300s timeout
  -> each new request wave adds another retained response
  -> V8 old_space reaches heap limit before oldest wave expires

stream finalization
  -> storeSessionResponse()
  -> before response snapshot
  -> after response snapshot
  -> three Redis values retain the same multi-MiB SSE body until SESSION_TTL
  -> RDB/AOF persistence amplifies Redis memory and I/O pressure
```

spool 因 payload 超限、Redis 异常或 owner lease 丢失而失效时，会清理自身正文，但
`ProxyResponseHandler` 已经选择的 300 秒 timer 仍继续运行，所以失效后的 Response、ArrayBuffer、
socket 和后台任务仍会保留。这解释了 8 MiB 超限样本在 spool 清空后依然保持约 77 MiB
ArrayBuffer 到 300 秒的现象。

## 已实现修复

修复在 `dev` 提交 `3fe3225c9f6397d22db27193199e2a8fef4a05f7` 的工作树上完成，包含：

1. 删除 `ReplaySpool.parts[]`，活跃正文只长期保存在 Redis fenced chunks 中。
2. 完成时从 Redis 回读 chunks，校验数量后重建 durable payload；大 payload 的回读、拼接和 PG
   持久化全局串行，避免多个终态同时形成 heap 峰值。
3. Redis write-behind backlog 上限固定为 1 MiB。超过时以
   `write_backlog_too_large` fail-open 关闭当前 spool，并立即清空 pending/queued batch。
4. spool disable、halt 或 abort 通过一次性 `onInactive` 通知 response handler；若客户端已断开，
   drain 从 Replay 300 秒降回普通 60 秒，并从实际断线时刻计算剩余时间。
5. 新增 `SESSION_RESPONSE_BODY_MAX_BYTES`，默认 5 MiB、范围 64 KiB 到 64 MiB。legacy response
   和 before/after snapshot 都按 UTF-8 字节限制；超限时删除同 key 的旧正文，但继续保存
   headers/meta。三份 response body 的物理存储去重由 #1415 跟踪。
6. 保留 Replay fenced owner、终态计费屏障、live attach、PG durable winner 和冲突处理语义。

## 修复负载回归

修复镜像保持相同 PostgreSQL、provider、key、mock、Replay 配置和 1 GiB app cgroup，连续运行
两组完整 64 请求波次，另有一组 8 请求预检，共 136 个断线请求。

第一组关键点：

| 活跃任务 | heapUsed | external | ArrayBuffer | RSS |
| ---: | ---: | ---: | ---: | ---: |
| 40 | 87.97 MiB | 371.74 MiB | 367.77 MiB | 594.50 MiB |
| 48 | 87.86 MiB | 442.92 MiB | 438.95 MiB | 679.63 MiB |

第二组在复用同一进程和 allocator 状态后，48 个活跃任务时 `heapUsed=92.01 MiB`；整个波次
最高观测 `heapUsed=155.31 MiB`、`RSS=905.63 MiB`，随后 64 个任务全部清理，`heapUsed` 回到
约 95 MiB。对比旧版 40 个任务时 `heapUsed=382.60 MiB` 并 fatal OOM，Node heap 持有链已经
被切断。继续静默等待 GC 后，进程为 `heapUsed=83.38 MiB`、`external=4.64 MiB`、
`ArrayBuffer=0.67 MiB`、13 sockets，证明第二轮峰值没有形成阶梯式引用累积。

累计运行日志：

```text
Client abort drain window exceeded  136
write_backlog_too_large             136
oversized session body skipped      408
FATAL ERROR / heap out of memory      0
remaining async tasks                 0
```

Redis 在两轮后：

```text
used_memory_human       2.87M
used_memory_peak_human  5.34M
rdb_saves               3
rdb_last_bgsave_status  ok
rdb_last_cow_size       1138688
container               running, oom=false, exit=0
```

上述负载回归显式使用 1 MiB session body 边界，证明它消除了原先约 1.50 GiB 的三份正文驻留，
并已跨过 `save 300 100` 的 RDB fork 点。当前产品默认值为 5 MiB；1 MiB 到 5 MiB 正文仍可能
形成三份 Redis value，该放大边界及 5 MiB 负载/RDB 验证由 #1415 跟踪，不属于上述实验已证明的范围。

## Issue #1415 5 MiB 去重后续验收

Issue #1415 已将同一 `(sessionId, requestSequence)` 的 legacy, before 和 after response body
改为一个 request-scoped Redis Hash 中的 `body:*` 字段和 view refs. 这项后续验收使用同一仓库的
fixture, 但选择 complete-response 模式而非本报告用于复现 Replay 生命周期的 disconnect 模式:

```text
CCH_MOCK_RESPONSE_BYTES=5242880
CCH_MOCK_RESPONSE_MODE=complete
CCH_REQUEST_MODE=complete
CCH_WAVES=8
CCH_REQUESTS_PER_WAVE=8
SESSION_RESPONSE_BODY_DEDUP_ENABLED=true
SESSION_RESPONSE_BODY_MAX_BYTES=5242880
SESSION_TTL=300
```

mock 将 terminal `response.completed` 也计入每个精确 5 MiB SSE body, driver 等待所有 64 个
response 完成. 运行在隔离 Redis 7.4.10 上通过 BGSAVE 和 TTL cleanup 验证:

| 项目 | 结果 |
| --- | --- |
| 64 request response body 原始总量 | 335,544,320 bytes, 等于 `64 x 5,242,880` |
| session body bundles / `body:*` fields / identical refs | 64 / 64 / 64 |
| stale legacy response body keys / dangling refs | 0 / 0 |
| Redis `used_memory_peak` | 437,018,776 bytes |
| RDB / Redis process | `rdb_last_bgsave_status=ok`; running; `OOMKilled=false`; `ExitCode=0` |
| TTL cleanup | manifest 的 64 个 bundle 和所有 legacy response body key 均为 0 |

运行前后宿主观测均为 `d_state=0`, IO PSI `avg10 some=0.00` 和 `full=0.00`. 该结果证明 5 MiB
完整 response 的 session body Redis 原始值预算不再随三个视图线性放大. 它不替代本报告关于
client-disconnect Replay drain 的机制结论, 因为该验收刻意让 response 正常终止以覆盖 session
response body 持久化路径。

## 测试与证据边界

focused 回归共 5 个文件、104 个测试，覆盖：

- 64 KiB flush、1 MiB backlog 包含边界和超限清理；
- Redis/PG 阻塞、abort/disable/halt 竞态、幂等和 active spool 配额释放；
- Redis chunks 缺失、durable 冲突、并发完成串行化和 UTF-8 截断尾部；
- spool 在断线前/后失效，以及活跃 spool 保持完整 300 秒窗口；
- session body 默认值、64 KiB/64 MiB 配置边界、UTF-8 字节边界、旧值删除；
- 超限 snapshot 只删除 body，headers/meta 继续保留。

最终 checkout 已通过 `bun run lint:fix`、`bun run lint`、`bun run typecheck` 和宿主机
`bun run build`。Biome 仅提示配置 schema URL 为 2.5.6、CLI 为 2.5.7，没有 lint 错误或自动改动。

最终全量 `bun run test` 仍只有一个失败。唯一失败是既有 `language-switcher` sessionStorage
console 断言，隔离复跑仍为相同失败，与本次代理、Replay 和 session 存储路径无关。全量并行运行
另报告一次 `price-list-ui-requirements` worker teardown console RPC rejection；该文件隔离复跑 4/4
通过，因此记录为测试 harness 并行 teardown 噪声，不计入本次修复通过项。

## 调查状态

本地机制复现、修复、重复负载和 Redis 持久化边界均已完成。结论是“已证明并修复一条足以复现
`#1408` 的决定性 Replay/断线流内存失控链，同时消除了 Session Response Body 的 Redis 放大器”；
生产 #1408 的唯一对象级根因仍受限于故障现场没有 heap snapshot。
