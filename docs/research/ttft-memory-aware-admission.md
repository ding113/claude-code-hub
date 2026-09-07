# 首内容排队与内存感知准入

关联 #1473，部分涉及 #1466。v0.9.5 的门控按每请求 40 MiB 预留，默认四个 worker 各分到 64 MiB，因此每个 worker 同时只有一个请求能等待首内容。慢上游占住这个位置，其他请求即使上游很快也会被本地队列阻塞。

## 请求与门控

- 门控从 128 KiB 工作集开始，随自有字节块和解析堆栈实际增长。扩容不持有部分正文排队，不能立即取得容量就把前缀逐块暂存到磁盘。首内容之后按原顺序回放。
- 增量 JSON/SSE 分类只保存协议路径事实和有界错误预览，不为大工具参数、图片或回显帧创建完整对象。重复 JSON 键、错误优先级、compaction、终止帧和合法深层 JSON 保持既有语义。
- 入站正文只有一个流消费者；压缩输入和解压输出逐块检查大小、必要时暂存。JSON 物化前按字节和对象结构估算容量，密集小对象的预算高于同样长度的长文本。
- 过滤、重试和 multipart 仍保留完整语义。日志视图改为按需生成；未启用调试正文或 Langfuse 时不长期保存出站序列化副本。
- 首次向上游发请求前取得门控基础容量。本地准入最多等待 20 秒，容量不足返回本地 `429`、`local_capacity_exceeded`、`Retry-After: 1`；不触发供应商 failover、健康扣分或熔断。

当前 dev 已在高并发模式跳过提交前门控，本变更保留这一行为。评估本变更时应分别测试高并发开关；从 v0.9.5 升级后的延迟下降不能全部归因于本变更。

## 自动预算

令 R 为当前可用 RAM，S 为可用 swap：

```text
H = R + 0.5 * S
reserve = max(256 MiB, 0.1 * R)
autoBudget = floor(0.6 * max(0, H - reserve))
hotBudget = min(autoBudget, floor(max(0, R - reserve)))
```

Linux 使用 MemAvailable、SwapFree，同时检查可见 cgroup v2/v1 的成员和祖先限制，遵守 memory.high、swap 禁用及 v1 memory+swap 联合限额。无法确认容器 swap 额度时不增加 swap 容量；非 Linux 以可用物理内存保守估计。

`CCH_MEMORY_BUDGET_BYTES` 可明确指定受管分配预算，替代自动比例；显式模式保留 10% 当前 RAM 余量并遵守热点物理容量。该值约束正文物化与门控工作集，并非进程 RSS 硬上限；需要硬上限时应使用容器/cgroup 内存限制。DB、Replay、detached drain 和异步写队列继续使用原有独立限额，尚未全部迁入同一个分配器。

cluster primary 只协调字节授权，worker 按 MiB 小批量借用，无正文 IPC。worker 退出后才回收其授权；IPC 断开停止新授权。每秒检查实际内存、PSI 和 swap I/O，压力上升时缩减新分配目标，恢复有滞回且不超过固定启动基线，已在使用的租约不会被强行撤销。

入站暂存租约在文件操作结束时显式归还；已解析请求的租约跟随请求上下文，经 FinalizationRegistry 在所有持有者被 GC 后归还，避免后台计费或 Replay 尚在读取时提前超卖。该策略保守，逻辑请求结束到 GC 之间的额度仍被占用，可通过 `usedBytes` 与 `processMemory` 对照观察。

worker 自动上限为 32，仍按 floor(vCPU/2)、实际可用物理内存、数据库连接和既有共享预算取更小值。提高上限不代表低内存或默认连接预算环境一定会启动 32 个 worker。

## 磁盘暂存与故障

`CCH_MEMORY_SPILL_DIR` 默认是系统临时目录下的 cch-spool，必须位于真实磁盘，拒绝 tmpfs/ramfs。每个部署使用独立目录。文件权限为 0600；目录包含 PID 与 Linux 进程启动标识，启动及定期扫描只删除已确认退出或 PID 被复用的自有目录。

`CCH_MEMORY_SPILL_MAX_BYTES` 默认 8 GiB，按 worker 分摊并进一步限制为可用磁盘的 10%；每 worker 最多 256 个文件。写入逐块等待完成，不积累后台写队列。单次暂存操作最长等待 20 秒，取消立即结束请求等待；内核 I/O 不能强行取消时保留租约和文件所有权，直到操作结束后清理。配额、文件系统或磁盘操作失败均按本地容量不足处理。

## 观测与验证

`memory_plan_resolved`、`worker_memory_ready`、每 30 秒的 `worker_memory_stats` 提供预算来源、在用/峰值额度、等待者、拒绝数、进程 RSS/heap/external/ArrayBuffer，以及 admission、正文读取/解压/物化、gate 阶段的次数、累计/最大耗时和字节数。指标不记录请求内容。

专项验证：

```sh
bunx vitest run --config tests/configs/memory-aware.config.mts --coverage
```

包含 cgroup/资源公式、IPC 与退出回收、20 秒本地 429、SSE 差分、大正文六种解码路径、磁盘配额/取消/超时/遗留文件回收，以及一个上游延迟 60 秒时另 100 个小流仍能通过的回归。#1466 中其他响应体、缓存、独立队列或运行时内存增长仍需要独立诊断，本变更不宣称完全解决该 issue。
