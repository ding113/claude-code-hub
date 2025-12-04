# PR #255 余额并发防透支方案（设计草案）

## 背景
- 现状：余额筛选在选路时仅检查 `balanceUsd <= 0`，未预占额度；会话复用下高并发可能在余额极低时仍被多次放行，导致透支。
- 目标：在转发前做原子预占（reserve），把“已占用未结算额度”与余额一起校验，避免穿透；同时兼容会话复用。

## 数据模型（Redis）
- Key：`provider:balance:{id}`（Hash）
  - `balance`：当前余额（字符串表示 decimal）
  - `reserved`：已预占但未结算的额度
- 可选：`provider:reserve:{id}:{reserveId}` 记录单次预占值（用于会话复用或补偿），TTL 短。

## 预占流程（Lua 原子脚本）
输入：`providerId`, `estimate_cost`, `reserved_max_factor`, `reserve_id`
1. 读 `balance`, `reserved`（缺省视为 0）。
2. `available = balance - reserved`，若 `available < estimate_cost` → 拒绝。
3. 计算 `reserved_cap = min(balance, reserved_max_factor)`；若 `reserved + estimate_cost > reserved_cap` → 拒绝（硬上限防穿透）。
4. `reserved += estimate_cost` 写回；返回 OK、`reserve_id`、`estimate_cost`。
5. 会话复用：若已存在同 `reserve_id`，直接返回 OK（避免重复预占）。

## 结算流程（Lua 原子脚本）
输入：`reserve_id`, `estimate_cost`, `actual_cost`
1. `reserved -= estimate_cost`，若 <0 则归零。
2. `balance -= actual_cost`，允许变为 0/负数但可触发隔离。
3. 删除/过期 `reserve_id` 记录；返回最新 `balance`, `reserved`。

## 参数建议
- `estimate_cost`：滑动窗口均值或 95 分位，限制下/上界（如 0.02 ~ 0.5）。
- `reserved_max_factor`：硬上限（如 `2 * 最近均值 * 并发上限`），或直接用 `min(balance, threshold)`。
- TTL：`reserve_id` 记录 1~5 分钟，超时自动释放。

## 失败与降级
- Redis 不可用：进入“保守拒绝”模式，若余额 < 小阈值（如 0.1）则拒绝，宁可少放行避免放大透支；记录告警。
- 结算失败：落盘日志 + 重试队列；若连续失败，对 provider 设置短期隔离标记。
- 会话复用：每次请求仍需带上 `reserve_id`，无则走新预占；过期会话视为新请求。

## 集成点
- 选路前（`provider-selector`）：调用预占 Lua，失败则该 provider 不可选。
- 响应后（`response-handler`）：调用结算 Lua，依据真实 `actual_cost` 调整。
- 指标：记录预占/结算成功率、拒绝原因（余额不足/超上限/Redis 故障）。

## 实施清单（建议顺序）
1) Redis Lua 脚本：实现预占/结算双脚本，使用同一 hash/key，Decimal 字符串存储。
2) 估值与上限：落地 `estimate_cost` 计算（滑动窗口 + 上下限），新增 `reserved_max_factor` 可配置项。
3) Selector 集成：在 `provider-selector` 选路前调用预占；失败则跳过该 provider。
4) Response 集成：在 `response-handler` 结算真实 cost，释放 reserved；缺失 reserve 时走幂等补偿。
5) 会话复用：在 session 中传递/复用 `reserve_id`，TTL 1~5 分钟；过期清理任务。
6) 观测与告警：埋点预占/拒绝/结算成功率与原因；余额<0、Redis 降级触发告警。
7) 降级策略：Redis 不可用时启用保守拒绝+本地隔离兜底，记录日志。

## 风险与缓解
- 估值偏差：`estimate_cost` 过低仍可穿透，过高导致拒绝率高。缓解：用滑动均值/95 分位并设上下限（可配置），监控拒绝率和真实成本偏差及时调参。
- reserved 上限调优：`reserved_cap = min(balance, reserved_max_factor)` 失准会过严/过松。缓解：`reserved_max_factor` 可配置，结合并发上限、均值成本做动态调整。
- 会话复用一致性：缺失/过期 `reserve_id` 会重复预占；TTL 过短易误释放，过长会挂死。缓解：`reserve_id` 必传，TTL 1~5 分钟，过期清理；可在 session 存储 `reserve_id`。
- 失败补偿泄漏：请求超时/崩溃未结算导致 reserved 悬挂。缓解：定期清理过期 reserve 记录；结算若无记录走幂等校正路径。
- Redis 可用性依赖：Redis 故障破坏预占。缓解：降级策略（余额低阈值直接拒绝）、本地隔离兜底、故障告警。
- 原子性/精度：Lua 需单 key/hash，数值用字符串防浮点误差；避免跨 slot。Decimal → 字符串。
- DoS 风险：低成本请求刷预占阻断正常流量。缓解：按用户/租户/来源做速率/并发限制，对估值过小设置最小预占。
- 负数余额：结算可打到负数，selector 会挡掉 <=0。缓解：balance < 0 时触发隔离或告警，需运营介入充值。
- 幂等与重试：结算重试可能重复扣 reserved。缓解：`reserve_id` 结算幂等标记或确保结算仅执行一次。
- TTL 单位：setex/psetex 混用会出错。缓解：统一秒或毫秒，常量明确。
- 指标缺失：无观测难调参。缓解：上报预占/拒绝/结算成功率与原因分类（余额不足/超上限/Redis 故障等）。
