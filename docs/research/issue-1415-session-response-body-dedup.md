# Issue #1415 Session Response Body Redis 去重设计

## 结论

Issue [#1415](https://github.com/ding113/claude-code-hub/issues/1415) 需要解决的是同一
`request sequence` 内的物理复制, 不需要跨 session 或跨租户共享正文. 最小且完整的方案是:

1. 先按 `STORE_SESSION_MESSAGES` 生成最终可存储正文, 再做精确字符串去重和 UTF-8 字节计数.
2. 将 legacy, before, after 三个逻辑视图存入一个 request-scoped Redis Hash.
3. 用 Lua 原子替换 Hash 和三个旧正文 key 组成的完整 generation.
4. 新 reader 只在 Hash 不存在或明确标记为 `layout=legacy` 时读取旧 key; dedup Hash 存在但
   正文缺失时不得回退旧值.
5. 使用 reader-first 两阶段发布. 第一阶段保持旧 writer, 第二阶段才启用去重 writer.

该方案把共享域限制在一个 request, 不引入跨请求 refcount, GC, TTL 延长或内容相等性泄漏.

## 已确认的现状

修复前, `ProxyResponseHandler` 的 4 个终态路径分别写入 legacy response, before body 和
after body. `SessionManager.storeSessionResponse()` 与
`SessionManager.storeSessionResponsePhaseSnapshot()` 对每份正文独立执行 `SETEX`.

读取同样分成 3 条路径:

- `SessionManager.getSessionResponse()` 读取 scoped legacy response.
- `SessionManager.getSessionResponsePhaseSnapshot(..., "before")` 读取 before body.
- `SessionManager.getSessionResponsePhaseSnapshot(..., "after")` 读取 after body.

Dashboard action 会同时读取这 3 个视图. headers 和 meta 使用独立 key, 因此正文缺失不应影响
状态码, URL 和阶段诊断信息. 这些事实可从以下一手源码核对:

- `src/app/v1/_lib/proxy/response-handler.ts`
- `src/actions/active-sessions.ts`
- `src/actions/session-response.ts`
- `src/lib/session-manager.ts`

#1408 的机制复现记录了 64 个约 7.5 MiB SSE response 在旧布局下形成约 1.4 GiB 原始正文,
并在 RDB 窗口把 Redis peak 推到约 1.5 GiB. 原始调查见
`docs/troubleshooting/issue-1408-replay-oom.md`.

## 约束冲突与取舍

### 当前旧 reader 无法直接读取引用

当前旧 reader 对三个 key 执行普通 `GET`. Redis 不会让多个 key 自动共享一个任意字符串 value.
如果新 writer 把旧 key 改写为引用描述符, 旧 reader 会把描述符当正文; 如果新 writer省略重复
key, 旧 reader 会返回 `null`.

因此, 以下三个目标不能在单阶段滚动中同时成立:

- 当前旧 reader 无需升级即可读取新布局.
- 新 writer 只保存一份物理正文.
- 不改变三个逻辑视图的返回值.

继续双写三份旧正文虽然兼容旧 reader, 但会直接保留 #1415 要消除的放大器. 本实现采用
reader-first 发布, 将可回滚下限提升到已经理解新布局的版本.

### 三份不同正文不可能无损装入 5 MiB 总预算

任意三份互不相同且各为 5 MiB 的正文至少需要 15 MiB 原始值. 不存在能对任意输入保证压缩到
5 MiB 的无损布局. 因此 `SESSION_RESPONSE_BODY_MAX_BYTES` 在去重模式中的契约是:

- 去重后的唯一正文总字节数不超预算时, 三个视图分别可读.
- 唯一正文总字节数超预算时, 写入 authoritative empty marker, 不保留部分正文.
- headers 和 meta 继续独立保存.

authoritative marker 防止更新或重试超限后错误回退到上一 generation 的旧正文.

## 数据布局

每个 `(sessionId, requestSequence)` 使用一个 Hash:

```text
session:{sessionId}:req:{sequence}:response-bodies:v1
```

字段如下:

```text
schema=1
layout=dedup
total_bytes=<去重后唯一正文 UTF-8 总字节数>
over_budget=0|1
present:legacy=1
present:before=1
present:after=1
ref:legacy=0
ref:before=0
ref:after=1
body:0=<最终可存储正文>
body:1=<另一份不同正文>
```

`present:*` 区分"该视图原本存在但正文因总预算缺失"与"调用方没有提供该视图".
`ref:*` 只指向同一 Hash 内的 `body:*`, 不使用正文 hash, 因此没有 hash collision 或跨 request
内容相等性 side channel.

## 写入与读取协议

`SessionManager.storeSessionResponseBodySet()` 接收完整的 legacy/before/after 集合. 生产终态路径
不再发起三个独立 body writer, 从而避免异步到达顺序把不同 retry generation 混在一起.

dedup 写入 Lua 同时声明 Hash 和三个旧正文 key:

1. 原子删除上一 generation 的 Hash 和旧正文 key.
2. 写入固定字段, present/ref 和唯一 body.
3. 对整个 Hash 执行一次 `EXPIRE`.

flag 关闭时, writer 在同一脚本内写三个旧正文 key, 并将 Hash 写为小型
`schema=1, layout=legacy` generation marker. 新 reader 看到该 marker 后读取旧 key; 完全不理解
Hash 的旧 reader 仍直接读取旧 key. flag 开启和关闭的 writer 使用同一组 `KEYS`, 因此 retry,
回滚和异构 writer 并发时, Redis 只会暴露最后一个完整执行的 generation.

读 Lua 同时声明 Hash 和目标 view 的 legacy key, 在同一 Redis 命令中读取
layout/present/ref/body 或旧正文. 因此 writer 切换 generation 时, reader 不会在看到 legacy marker
后再读到已被下一 generation 删除的旧 key. dedup Hash 与内部引用同时过期, 不会产生独立
blob/ref 的悬空或 orphan 状态. 旧正文清理不再是 best-effort 后置命令, 因此 dedup generation
成功时不会同时残留三份旧正文.

当前 Redis client 使用 standalone `ioredis`, 不是 Redis Cluster. 跨四个旧 key 的原子脚本依赖
这一现有部署契约; 若未来引入 Redis Cluster, 需要先统一 key hash tag 再迁移.

## 隐私与预算顺序

正文处理顺序固定为:

```text
原始 view
  -> STORE_SESSION_MESSAGES redaction
  -> 最终存储字符串
  -> 精确字符串去重
  -> Buffer.byteLength(..., "utf8") 聚合计数
  -> Redis Hash
```

原始敏感正文不会参与共享 key 派生, 也不会进入全局或 tenant-wide content hash.
`STORE_SESSION_RESPONSE_BODY=false` 在任何 Redis body 写入前直接返回.

脱敏能力范围保持既有契约: 可解析 JSON 通过 `redactResponseBody()`, 非 JSON/SSE 仍按原样存储.
#1415 不改变该诊断语义; request-scoped Hash 不跨 session, sequence 或租户共享物理 value, 因而不会
把原样 SSE 扩散到新的共享域.

## 发布流程

新增 `SESSION_RESPONSE_BODY_DEDUP_ENABLED`, 默认 `false`.

1. Release A: 所有实例部署新 reader, flag 保持 `false`, writer 原子写旧 key 和
   `layout=legacy` marker.
2. 确认所有运行实例和回滚版本都至少为 Release A.
3. Release B: 设置 flag 为 `true`, writer 切换到单 Hash 布局.
4. 至少等待一个 `SESSION_TTL` 后, 才能考虑移除旧 key fallback.

Release B 可以回滚到 Release A: false writer 会原子取代已有 dedup generation, 新 reader 随即
读取本次 legacy generation. 不能回滚到完全不理解 Hash 的 Release A 之前版本. 这是物理去重和
旧 reader 语义之间的结构性边界, 不是通过额外双写可以消除的实现细节.

## 验证矩阵

自动化测试覆盖:

- 三视图全同, 三种两两相同, 三者不同.
- 脱敏后相同与脱敏后不同.
- UTF-8 精确边界, 重复正文只计一次, 唯一正文聚合超限.
- authoritative marker 不回退 stale legacy key.
- v1 key TTL 窗口读取兼容.
- 同 sequence 覆盖, dedup/legacy 切换和异构 writer 并发 generation 原子性.
- 单 Hash TTL, ref/body 同时过期, 无悬空引用.
- rollout flag 关闭时继续旧布局.
- `STORE_SESSION_RESPONSE_BODY=false` 完全跳过正文.

负载验收复用 `tests/load/issue-1408-replay-oom/`, 使用精确 5,242,880-byte SSE response 和
8 x 8 request waves. `inspect-redis.cjs` 按 manifest 对每个 request 记录 `HSTRLEN`, refs,
`total_bytes`, TTL, 旧 key, `used_memory_peak`, RDB 状态和 Redis 容器 OOM/exit 状态. active
artifact 验证正文预算, expired artifact 按同一 manifest 自动验证 Hash 与旧正文 key 均已清理.

## 2026-08-12 完整 5 MiB 负载验收

正式存储验收使用隔离的 `cch1415-*` Docker daemon, PostgreSQL, Redis 7.4.10 和本仓库构建的
应用镜像. mock 使用 `CCH_MOCK_RESPONSE_MODE=complete`, 将 `response.completed` 终态事件计入
每个 response 精确 5,242,880-byte SSE wire body. driver 使用 `CCH_REQUEST_MODE=complete` 等待
每个客户端 response 结束. 这与 #1408 的默认 `disconnect` 挂起流复现互补, 不能将两者的 Node
内存结论混为一谈.

工作负载为 8 x 8 requests, `SESSION_TTL=300`,
`SESSION_RESPONSE_BODY_DEDUP_ENABLED=true`, `SESSION_RESPONSE_BODY_MAX_BYTES=5242880`.
所有 64 个 response 完成后等待 70 秒, 触发并等待 Redis `BGSAVE`, 随后在 TTL 窗口内检查 active
artifact, 最后按相同 manifest 轮询 expiry. 运行前后宿主均为 `d_state=0`; IO PSI `avg10` 均为
`some=0.00`, `full=0.00`.

| 检查项 | 实际结果 |
| --- | --- |
| 已完成 response / bundles | 64 / 64 |
| 原始 body 预算 | 335,544,320 bytes = 64 x 5,242,880 bytes |
| `totalRawBodyBytes` / `totalDeclaredBytes` | 335,544,320 / 335,544,320 bytes |
| body fields / identical three-view refs | 64 / 64 |
| 旧 response body keys / dangling refs | 0 / 0 |
| Redis `used_memory` / `used_memory_peak` at active check | 412,133,448 / 437,018,776 bytes |
| Redis BGSAVE | `rdb_saves=1`, `rdb_last_bgsave_status=ok`, `rdb_last_cow_size=2,330,624` bytes |
| Redis container | running, `OOMKilled=false`, `ExitCode=0` |
| App container peak / final cgroup memory | 417,484,800 / 245,481,472 bytes |
| Redis container peak / final cgroup memory | 376,094,720 / 55,201,792 bytes |
| Expired artifact | 0 manifest bundles, 0 legacy response body keys, passed |

`reports/issue-1415-20260812a.samples.txt.redis.json` and
`reports/issue-1415-20260812a.samples.txt.redis-expired.json` are machine-local artifacts for this
run. The implementation does not commit generated multi-MiB load artifacts; the table above records
the acceptance evidence necessary to reproduce and review the result.

## 未采用的方案

- 在三个旧 key 中写 ref marker: 旧 reader 会把 marker 当正文.
- 同时写新 Hash 和三份旧正文: 不满足内存上界.
- tenant-wide 或 global content-addressed blob: 引入 refcount, TTL/GC 和跨请求泄漏面.
- 三个独立 writer 增量维护 refcount: retry 和异步乱序可生成混合 generation.
- 独立 blob/ref keys: 需要额外事务和 GC 才能避免 TTL 错位与悬空引用.
- 压缩或 delta: 无法对任意不同正文保证固定总上界, 并显著增加读取迁移复杂度.

## 一手来源

- [GitHub Issue #1415](https://github.com/ding113/claude-code-hub/issues/1415)
- [GitHub Issue #1408](https://github.com/ding113/claude-code-hub/issues/1408)
- [GitHub PR #1414](https://github.com/ding113/claude-code-hub/pull/1414)
- `src/lib/session-manager.ts`
- `src/app/v1/_lib/proxy/response-handler.ts`
- `src/app/v1/_lib/proxy/warmup-guard.ts`
- `src/actions/active-sessions.ts`
- `src/actions/session-response.ts`
- `tests/load/issue-1408-replay-oom/`
