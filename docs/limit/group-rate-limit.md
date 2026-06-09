# 用户组 × 模型组 限额 — 设计方案（修订版）

> 目标：重构现有「按模型限额」模块，引入**模型组**与**用户组**两维度、**取最大值**的合并语义，以及**临时提额**能力；命中模型维度限额时该轴消费**完全切分**——既跳过[用户管理]页面的全局成本检查，也**不计入**该轴主线全局额（通过 `usage_ledger` 按轴打标实现，见 §5.3/§16.1）。
>
> **改动边界（重要）**：分支上已提交的「按模型限额」Phase 1-5 **尚未上线**，可自由重构——`user_model_limits` / `key_model_limits` 两表及其 CRUD/API/UI 均可推倒重来，无需兼容。「不破坏原有逻辑」专指 **`origin/main` 主线**（代理流程、全局限额 `ProxyRateLimitGuard`、guard pipeline、`usage_ledger` 等）。`ENABLE_MODEL_RATE_LIMIT=false` 时整体行为与 main 完全一致。
>
> **合并策略（实现前必读）**：上游同步与落地合并见 [`../merge/group-rate-limit-merge-plan.md`](../merge/group-rate-limit-merge-plan.md)（开发期持续吸收 upstream）与 [`../merge/group-rate-limit-landing-plan.md`](../merge/group-rate-limit-landing-plan.md)（特性合入与落地后姿态）。**主线 inline 改动须按 seam 化实现**（§5.2.4 的 `backfill.ts`、§8、§14），把 response-handler 等热文件的冲突面降到最小。

---

## 1. 需求与已决策项

### 1.1 需求

1. 「按模型限额」新增**模型组**与**用户组**两维度。
2. 用户组由 `users.tags` 分类；限额主体可为**单用户**、**用户组**，并保留 **Key**。
3. 模型组由管理员按模型名归集；限额目标为**模型组**（单模型 = 单元素模型组）。
4. 命中模型维度限额时，遵循模型维度限额，[用户管理]页面全局限额对该请求不再生效。
5. 用户可申请**临时提额**（提额度 + 有效期）。

### 1.2 已拍板决策

| 编号 | 决策 | 结论 |
|---|---|---|
| D1 | 重构自由度 | Phase 1-5 未上线，可推倒重来；只保证不破坏 `origin/main` 主线。 |
| D2 | 主体维度 | **Key + 用户 + 用户组**三类。 |
| D3 | Key 关系 | Key 侧为**独立预算桶，AND 生效**（同主线 Key/User 关系）；用户侧按 max 合并。 |
| D4 | 合并语义 | 用户隶属多个用户组、或叠加个人配置时，同一周期档**取最大值（最宽松）**。**不再使用优先级裁决**。 |
| D5 | 用户组限额口径 | **按成员的人均上限**（非全组共享预算）——对该用户**自身**在该模型组上的消费计量。这使「取最大值」在同一口径下成立。 |
| D6 | 模型组分区 | **全局互斥**：一个模型在全系统只属一个模型组（DB 唯一约束）；单模型限额 = 单元素组。 |
| D7 | 目标解析 | 由于 D6，目标维度坍缩为「查该模型唯一所属的组」，**无目标优先级**。 |
| D8 | 旁路语义 | **按轴旁路**：用户侧命中则旁路主线用户级全局成本限额；Key 侧命中则旁路主线 Key 级全局成本限额（见 §5）。RPM/并发**不旁路**。 |
| D9 | 回退 | 模型不属任何组，或某轴无任何配置 → 该轴遵循[用户管理]页配置（主线）。 |
| D10 | 提额 | **additive，作用于指定单个周期**。建模为**独立授予账本** `quota_boost_grants`（非限额行内联列）；同一 (用户,组,窗口) **可多条不同有效期并自然叠加**；有效期内该档 `上限 += Σ提额度`（见 §7）。 |
| D11 | 提额主体 | **仅个人用户**（账本 `userId` 强约束）；用户组与 Key **不可**提额。 |
| D12 | 提额过期 | 当前时间超过有效期 `end` 即由定时任务**DELETE 过期授予行**，避免每请求判定（见 §7.1）。撤销提额 = 删行。 |
| D14 | 提额申请流 | **当前系统不实现**用户自助申请/审批工作流；管理员在 Dashboard 直接增删授予行（无 pending/审批状态机）。 |
| D13 | 旁路计入口径（**v1 已采纳完全切分**） | **配置轴完全切分**：命中某轴模型限额时，该请求消费**既跳过该轴主线全局检查、也不计入该轴主线全局额**。实现为 `usage_ledger` **按轴打标**两列 `counted_in_user_global` / `counted_in_key_global`（写入期由 bypass 标记冻结，默认 true），全局聚合按标记过滤（见 §5.3/§16.1）。已否决初版「仅跳过检查、消费仍计入」与读取期 `NOT IN` 排除（理由见 §16.1）。 |

---

## 2. 计量与口径基线（沿用主线，不破坏）

- DB 权威源：`usage_ledger`（已含 `model` 列）。
- 计数：复刻主线 lease（DB 权威 + Redis 切片 + 原子 Lua 扣减），fail-open 由 `MODEL_RATE_LIMIT_FAIL_OPEN` 控制。
- 模型口径：`session.getCurrentModel()`（重定向后实际服务模型），对齐 `usage_ledger.model`。
- 周期档：5h / daily / weekly / monthly / total，及 fixed/rolling 模式（沿用 `dailyResetModeEnum`）。RPM/并发 v1 不纳入模型维度。

---

## 3. 数据模型（全新设计；旧两表废弃重建）

### 3.1 `model_groups` — 模型组

```ts
export const modelGroups = pgTable("model_groups", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  isSingleton: boolean("is_singleton").notNull().default(false), // 单模型快捷组标记
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ nameUnique: uniqueIndex("model_groups_name_idx").on(t.name) }));
```

### 3.2 `model_group_members` — 模型→组的全局互斥映射（D6）

```ts
export const modelGroupMembers = pgTable("model_group_members", {
  id: serial("id").primaryKey(),
  modelGroupId: integer("model_group_id").notNull().references(() => modelGroups.id, { onDelete: "cascade" }),
  model: varchar("model", { length: 128 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  modelUnique: uniqueIndex("model_group_members_model_idx").on(t.model), // 一个模型只属一个组（DB 强约束）
  byGroup: index("model_group_members_group_idx").on(t.modelGroupId),
}));
```

- 请求期反查 `model → groupId` 为单条索引查询（`WHERE model = ?`）。
- 「单模型限额」= 建一个 `isSingleton=true`、仅含该模型的组（UI 提供快捷入口）。
- 添加已属其他组的模型 → 唯一约束/应用层校验报错。

### 3.3 `user_groups` — 用户组（tag 登记，无 priority）

```ts
export const userGroups = pgTable("user_groups", {
  id: serial("id").primaryKey(),
  tag: varchar("tag", { length: 255 }).notNull(),  // 映射 users.tags 中某 tag
  name: varchar("name", { length: 128 }),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ tagUnique: uniqueIndex("user_groups_tag_idx").on(t.tag) }));
```

- 成员资格由 `users.tags @> [tag]` 派生（复用 GIN 索引 `idx_users_tags_gin`），**无独立成员表**。

### 3.4 `model_group_limits` — 统一限额表（仅基准五档）

```ts
export const limitSubjectEnum = pgEnum("limit_subject", ["user", "key", "user_group"]);
export const boostWindowEnum  = pgEnum("boost_window", ["5h", "daily", "weekly", "monthly", "total"]);

export const modelGroupLimits = pgTable("model_group_limits", {
  id: serial("id").primaryKey(),
  subjectType: limitSubjectEnum("subject_type").notNull(),
  subjectId: integer("subject_id").notNull(),       // userId | keyId | userGroupId
  modelGroupId: integer("model_group_id").notNull().references(() => modelGroups.id, { onDelete: "cascade" }),
  // —— 五档基准限额 ——
  rpmLimit: integer("rpm_limit"),                   // 预留，v1 不强制
  limit5hUsd: numeric("limit_5h_usd", { precision: 10, scale: 2 }),
  limit5hResetMode: dailyResetModeEnum("limit_5h_reset_mode").default("fixed").notNull(),
  dailyLimitUsd: numeric("daily_limit_usd", { precision: 10, scale: 2 }),
  limitWeeklyUsd: numeric("limit_weekly_usd", { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric("limit_monthly_usd", { precision: 10, scale: 2 }),
  limitTotalUsd: numeric("limit_total_usd", { precision: 10, scale: 2 }),
  limit5hCostResetAt: timestamp("limit_5h_cost_reset_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniq: uniqueIndex("model_group_limits_uniq_idx").on(t.subjectType, t.subjectId, t.modelGroupId),
  bySubject: index("model_group_limits_subject_idx").on(t.subjectType, t.subjectId),
  byGroup: index("model_group_limits_group_idx").on(t.modelGroupId),
}));
```

- 限额行只存基准五档；临时提额拆到独立账本 `quota_boost_grants`（§3.5，D10），不再内联在此表。
- 一条 (subject, group) 唯一。

### 3.5 `quota_boost_grants` — 临时提额授予账本（D10/D11/D12/D14）

```ts
export const quotaBoostGrants = pgTable("quota_boost_grants", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // D11 仅个人用户
  modelGroupId: integer("model_group_id").notNull().references(() => modelGroups.id, { onDelete: "cascade" }),
  window: boostWindowEnum("window").notNull(),       // 作用单档（D10）
  amountUsd: numeric("amount_usd", { precision: 10, scale: 2 }).notNull(),
  validPeriod: tstzrange("valid_period").notNull(),  // 有效期 [from, end)
  note: text("note"),                                // 管理员备注（可选）
  createdBy: integer("created_by"),                  // 操作管理员（可选审计）
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byTarget: index("quota_boost_grants_target_idx").on(t.userId, t.modelGroupId, t.window),
  periodGist: index("quota_boost_grants_period_gist").using("gist", t.validPeriod),
}));
```

- **无 `status` 字段、无状态机（D14）**：管理员写入即生效（到 `validPeriod` 起点起算），撤销 = 删行。
- 同一 (userId, modelGroupId, window) 允许**多条不同有效期并存**，解析时叠加（§4.4）。
- `tstzrange` 需 `customType` 或 drizzle range 支持；不支持则退化为 `validFrom` / `validTo` 两列（过期索引改建在 `validTo`）。

### 3.6 `usage_ledger` 按轴打标列（完全切分基石，D13）

完全切分要求全局额聚合能区分「计入全局 / 模型组单算」的消费。为避免读取期 `NOT IN` 的追溯性与漂移（§16.1），在主线 `usage_ledger` 增两列，**写入期冻结归属**：

```ts
// usage_ledger 追加（主线表变更）
countedInUserGlobal: boolean("counted_in_user_global").notNull().default(true),
countedInKeyGlobal:  boolean("counted_in_key_global").notNull().default(true),
```

- **取值（落账时写入）**：`counted_in_user_global = !session.bypassUserGlobalCost`，`counted_in_key_global = !session.bypassKeyGlobalCost`（在 `updateRequestCostFromUsage` 落账处与 `costUsd` 一并写入；bypass 标记在 guard 阶段已就绪，见 §5.2）。
- **默认 `true`** → 历史行、flag 关闭、模型无组、fail-open（不置 bypass，§5.2）全部计入全局，保证「flag off 与 main 逐字节一致」与历史行无须回填。
- **单一事实源**：同一对标记同时驱动「DB 全局聚合过滤」「Redis 全局桶扣减/计数跳过」「展示分栏」三处（§5.3/§6/§10），口径恒一致，无漂移、无 `NOT IN`、无追溯重分类。
- 索引：全局聚合在现有 `(userId, createdAt)` / `(key, createdAt)` 上追加 `counted_in_*_global = true` 残余过滤；绝大多数行为 true，无须独立索引。

### 3.7 迁移

旧 `user_model_limits` / `key_model_limits` 未上线，直接在 `schema.ts` 删除并以上述表替代。**`usage_ledger` 两列为主线表变更**，与新五表一并 `bun run db:generate` → review → `db:migrate` → `validate:migrations`。

> **合并友好（实现约定）**：本特性对 `schema.ts` 的改动（新五表 + `usage_ledger` 2 列 + `system_config` 5 列）**集中放在文件末尾、用 region 注释包裹**，降低与 upstream schema 编辑的文本冲突；生成的迁移应为**最高编号**。每次同步 upstream 后**不手工 merge 迁移生成物（journal/snapshot），而是丢弃后 `db:generate` 重生成**（见合并计划 §5）。

---

## 4. 解析算法

请求上下文：`keyId`、`userId`、`model`、`tags = user.tags`、`now`。

### 4.1 目标解析（D7）

```
G = SELECT model_group_id FROM model_group_members WHERE model = :model
若 G 为空 → 该模型不属任何组 → enforced=[]，两轴均回退主线（D9）。
```

> **热路径缓存（强约束，v1 必做）**：`model→groupId` 反查**不得**每请求打 DB。`model_groups` / `model_group_members` / `user_groups` 均为管理员低频变更、每请求高频读，必须走**进程内短 TTL 缓存快照**——采用 `provider-cache.ts` 同款 **L1 + Redis pub/sub 失效** 模式（见 `src/lib/cache/provider-cache.ts`、`publishCacheInvalidation` / `subscribeCacheInvalidation`），写操作（增删组/成员/tag 登记）本地失效**并广播**，保证多 Pod 集群近即时一致。**不要**用 `system-settings-cache.ts` 的纯进程内单点失效——那只清本进程、是跨 Pod 陈旧的根因。叠加 stale-while-revalidate（见 §17.3 OPT-C）。否则 flag 开启后，**即使全系统零模型组**，每请求仍会平白多一次同步 DB 往返横在转发前，并在高并发下放大 PG QPS、吃满连接池——这是企业级网关真正会爆的点。详见 §4.7。

### 4.2 Key 侧（独立桶，AND）

```
keyRow = model_group_limits WHERE subject=(key, keyId) AND modelGroupId=G
keySide = keyRow ? { bucket:(key,keyId,G), caps: effCaps(keyRow, now) } : null
```

### 4.3 用户侧（max 合并，人均口径 D5）

```
sources = []
indivRow = limits WHERE subject=(user, userId) AND group=G;       if indivRow: sources += indivRow
for ug in userGroups WHERE tag IN user.tags:
    ugRow = limits WHERE subject=(user_group, ug.id) AND group=G;  if ugRow: sources += ugRow
若 sources 为空 → userSide=null（用户侧回退主线，D9）
否则 userSide = {
  bucket: (user, userId, G),                 // 始终按该用户自身消费计量（人均口径）
  caps[w] = MAX over sources of effCap(src, w, now)   // 逐档取最大
}
```

### 4.4 提额生效（D10/D11/D12；F1 虚拟个人 source；F2 缓存读取）

提额来自 `quota_boost_grants`（仅个人用户，D11），通过抬高「个人 source」的上限生效。逐档 `w` 计算：

```
boostSum(userId, G, w, now) =
  Σ amountUsd over 满足 user_id=userId AND model_group_id=G AND window=w
                  AND valid_period @> now 的授予          // 多条自然叠加

groupMax[w] = MAX over 用户组 sources of cap[w]            // 无用户组 source → 不存在

# 个人 source 基线（F1：无个人行时合成虚拟个人 source）
personalBase[w] =
  存在个人限额行            → 个人行 cap[w]
  否则存在任一用户组 source → groupMax[w]                  // 虚拟个人 source
  否则（无任何 source）     → 缺省（提额惰性，见下）

personalEff[w] = personalBase 缺省 ? 缺省
               : (personalBase[w]==null ? null : personalBase[w] + boostSum)

# 回到 §4.3：
caps[w] = MAX(groupMax[w], personalEff[w])                 // 仅对存在项取 max
```

- **F1 合成虚拟个人 source（已采纳方案 B）**：用户**无个人限额行、仅命中用户组限额**时，提额仍以「该用户在该组的用户组上限 `groupMax`」为基线叠加生效，避免「授予了却不生效」。`boostSum=0` 时虚拟 source = `groupMax`，与无提额行为完全一致（无回归）。
- **提额惰性边界**：当用户在该组**无任何 source**（个人 + 用户组皆无）时，提额**不**凭空创建模型组限额——否则会把本应「回退主线全局额」（D9）错误收紧成一个 = 提额度的模型桶（方向相反）。此时 `userSide=null`，照常回退主线。
- **F2 缓存读取（已采纳短 TTL）**：活跃授予随限额行一并进入 §4.7 解析快照（短 TTL + 写操作失效）；请求期对快照内授予做 **in-memory `valid_period @> now`** 判定。因此：
  - **时间窗激活/失效是 in-memory 精确判定、零延迟**（含「预排未来生效」的授予，到点即生效）；
  - **仅管理员增删授予行**有 ≤TTL 传播延迟（写时失效则即时）；
  - §7.1 的过期 DELETE 仅做存储清理，残留过期行也因 `@> now` 兜底不会误生效。
- 提额抬高的是个人 source 上限，再参与 §4.3 的 max；计量对象仍是该 user 自身（人均口径 D5 不变）。
- `null`（无限）在 max 中视为 +∞ 取胜；某档全为 null → 该档无限。

### 4.5 最终

```
enforced = [keySide, userSide].filter(非 null)   // 两桶 AND 全部通过
```

### 4.6 示例

| 配置 | 请求 | 结果 |
|---|---|---|
| 模型 opus 属组 `g-opus`；user 5 个人 (user,g-opus) 日额 \$10；tag team-a (user_group,g-opus) 日额 \$30 | opus | userSide 日额 = max(10,30)=\$30，按 user 5 自身消费计量；旁路用户级全局额 |
| 同上，给 **user 5 个人** 一条提额授予：window=daily, +\$50, 有效期内（D11 仅个人用户）| opus（期内） | 个人 source 日额 = 10+50=\$60；userSide = max(60, 30)=\$60 |
| 同上，再给 user 5 追加第二条提额：window=daily, +\$20, 有效期重叠 | opus（两条均有效）| 个人 source 日额 = 10+50+20=\$80（多条叠加）；userSide = max(80,30)=\$80 |
| key 99 设 (key,g-opus) 日额 \$5；user 无配置 | opus | keySide=\$5（旁路 Key 级全局额）；userSide=null（用户级走主线全局额） |
| 模型 sonnet 不属任何组 | sonnet | enforced=[]，完全走主线全局额 |

### 4.7 热路径与缓存（性能基线）

模型 guard 插在 `rateLimit` **之前**，其全部解析与检查都横在 `forwardStartTime` 之前，直接计入转发前延迟。设计两条硬约束：

1. **解析走缓存快照，零热路径 DB 往返**：解析所需的全部数据均从进程内短 TTL 快照读取（§4.1 注 + F2），快照组成（F4）：
   - `model→groupId` 反查表、各组成员列表（`model_group_members`）；
   - `tag→user_group` 登记、各 `(subjectType, subjectId, modelGroupId)` 限额行（`model_group_limits`）；
   - 活跃/未来提额授予行（`quota_boost_grants`，按 `(userId, modelGroupId, window)` 索引）——请求期在内存做 `valid_period @> now` 判定（§4.4 F2）。
   写操作（增删组/成员/tag/限额/提额）触发对应失效；目标：flag 开启且**任意配置组合**下，解析阶段**新增 0 次 DB 往返**（含提额，不再有 GiST 往返）。
2. **lease 检查并行，不串行**：同一桶 5 档、以及 keySide / userSide 两桶之间用 `Promise.all` 并发（注意：现有 `src/lib/model-rate-limit/service.ts` 是串行 `for...await`，重写时改并行）。「允许通过」路径上所有档位反正都要查一遍，无 early-exit 红利；违规时在已返回结果里按固定优先级裁决错误码即可，不影响语义。

> **每请求新增 I/O 预估**（达成上述约束后）：
> - flag off：0（与 main 逐字节一致）。
> - flag on、模型无组：0 DB（快照命中）+ 0 Redis。
> - flag on、单轴命中：0 DB + ≤5 Redis（并行）；同时主线对应轴成本档被旁路（§5），净 Redis 大致持平。
> - flag on、双轴命中：0 DB + ≤10 Redis（并行）；主线 User-_/Key-_ 成本档均旁路。

### 4.8 端到端场景（审查辅助）

统一背景：用户管理页给 **User U5 全局日额 = \$10**；`opus ∈ g-opus`，`sonnet` 不属任何组。详尽走查见评审报告 `group-rate-limit-review.html` §5。

| 案例 | 配置 | 序列 / 请求 | 结果与启示 |
|---|---|---|---|
| **A 完全切分对比** | `(user,g-opus)` 日 \$30 | opus×8@\$3 后发 sonnet \$5 | opus \$24 计模型桶但 `counted_user=false`，**不污染全局**；全局已用仅 \$5 → sonnet 放行。旧「仍计入」会让全局 = \$24 → 误杀 sonnet。 |
| **B 非对称轴** | 仅 `(user,g-opus)` \$30；Key K 全局日 \$8；无 `(key,g-opus)` | opus×3@\$3 | user 轴切分（`counted_user=false`），key 轴回退主线（`counted_key=true`）→ 第 3 条被 **Key 全局 \$8** 拦截（user-mg \$9 本可放行）。 |
| **C 人均口径** | `team-a (user_group,g-opus)` 日 \$30；U5 另有个人 \$10；U7 无个人行 | U5/U7 各发 opus | U5 = max(10,30)=\$30、U7=\$30，**各自独立桶**（10 人 = 10×\$30，非共享）。 |
| **D 提额 F1** | 接 C，给 U7（仅组限额）授予 daily +\$50 | opus（期内） | `personalBase=groupMax \$30`（虚拟 source）→ `personalEff=80` → cap = max(30,80)=**\$80**；不做 F1 则提额被丢弃。 |
| **E 提额惰性** | U9 在 g-opus 无任何配置，误授予 +\$50 | opus | 无 source → 提额惰性、不凭空建限额 → `userSide=null` 回退主线（no-op）。 |
| **F fail-open** | `(user,g-opus)` \$30；Redis 故障 | opus | 模型档 fail-open → **不置 bypass** → `counted_user=true`、主线全局档照常执行（不双重放行）。 |

---

## 5. 覆盖语义与 Guard Pipeline（D8，按轴切分）

### 5.1 规则（完全切分，D13）

- **用户侧命中**（userSide≠null）→ ① 跳过主线 **User 级**成本检查、改由 userSide 桶裁决；② 该请求消费**不计入** User 主线全局额（`counted_in_user_global=false`）。
- **Key 侧命中**（keySide≠null）→ ① 跳过主线 **Key 级**成本检查、改由 keySide 桶裁决；② 该请求消费**不计入** Key 主线全局额（`counted_in_key_global=false`）。
- 某轴未命中 → 该轴照常走主线全局成本限额且**正常计入**（D9 回退，标记保持默认 true）。
- **RPM 与并发 Session 始终生效**（资源护栏，不切分）。

> 完全切分（而非「仅跳过检查」）的理由：若命中轴的消费仍计入全局桶，则模型限额的额度只有在「全局额 ≥ 模型消费」时才用得满，且分组消费会污染全局桶、拖累该用户/Key 的**未分组**流量——违背「配置了模型限额则全局不生效」的预期。切分后命中轴与全局额成为**独立预算**：配置轴只受模型桶治理，未配置轴照常受全局额护栏（D9）。
>
> 按轴切分的理由：Key 与 User 在主线本就是两个独立 AND 预算桶。模型维度沿用此结构 + 双标记列，能让 D9「用户侧无配置 → 遵循[用户管理]」与 D3「Key 独立 AND」同时成立，且降级平滑。

### 5.2 接入实现

1. 扩展钩子 `registerExtensionStep` 增加可选 `insertBefore`（与现有 `insertAfter` 并存）；`modelRateLimit` 改 splice 在 `rateLimit` **之前**。
2. `model-rate-limit-guard` 解析 §4 得 `enforced`；逐桶 `checkCostLimitsWithLease`（越界 throw `RateLimitError`，`MODEL_*` 码）；**仅在该桶检查真实执行（非 fail-open）且通过时**才置对应 bypass 标记：
   - `session.bypassUserGlobalCost = userSide 检查已执行且通过`
   - `session.bypassKeyGlobalCost  = keySide  检查已执行且通过`
   - `session.setResolvedModelLimits(enforced)`（供回填扣减同组桶）

   > **CRITICAL — fail-open 不得置 bypass（防双重放行）**：模型 guard 在 Redis 故障时按 `MODEL_RATE_LIMIT_FAIL_OPEN` 放行（`service.ts` 已 fail-open）。若此时仍置 bypass 标记，结果是「模型档没拦（fail-open）+ 主线成本档被旁路（bypass）= 该请求成本闸门全开」。因此 fail-open（`result.failOpen === true`）的桶**必须保留对应主线全局额护栏**，即不置该轴 bypass，让主线 `ProxyRateLimitGuard` 继续兜底。该不变量写进回归测试（§11、§15）。
3. 主线 `ProxyRateLimitGuard.ensure()`（`rate-limit-guard.ts`）做受标记守卫的最小改动：
   - 每个 **User-*** 成本档检查包进 `if (!session.bypassUserGlobalCost)`；
   - 每个 **Key-*** 成本档检查包进 `if (!session.bypassKeyGlobalCost)`；
   - RPM / 并发块**不加守卫**。
   - flag 关闭时两标记恒 false → 零行为变化。
4. **落账打标 + 回填跳过**（完全切分关键；**seam 化实现**，见合并计划 §3.1）：可外移逻辑放入新文件 `src/lib/model-rate-limit/backfill.ts`，response-handler（最高频文件）只留极小调用点：
   - `backfill.ts` 暴露：`resolveCountedFlags(session)` → `{countedUser, countedKey} = {!bypassUserGlobalCost, !bypassKeyGlobalCost}`；`modelBucketDecrements(session, costFloat)` → 按 `resolvedModelLimits` 生成模型桶 decrement（全新增、可完全外移）。
   - `response-handler` 仅改两处：① `updateRequestCostFromUsage` 落账时用 `resolveCountedFlags` 写两列；② `trackCostToRedis` 的 `decrementLeaseBudget` 数组里，**被旁路轴的 User-_/Key-_ 全局扣减用条件 spread 跳过**（`...(session.bypassUserGlobalCost ? [] : [/* user 4 档 */])`，与既有 `...(flag ? [...] : [])` 写法同构），再 `...modelBucketDecrements(...)` 追加模型桶；provider 桶照常。
   - **CRITICAL — 5h-fixed 计数器也须按轴跳过**：lease 播种里**只有 5h-fixed 窗口**从 Redis 计数器 `{type}:{id}:cost_5h_fixed` 取数（`lease-service.readFixed5hWindowState`），其余档（5h-rolling、daily/weekly/monthly、total）一律从已按 `counted_in_*_global` 过滤的 DB 聚合播种。该计数器由 `trackCost` 写入，且 `trackCost` 在 decrement 数组**之外无条件调用**——因此仅跳过 `decrementLeaseBudget` 数组不足以切分 5h-fixed：被旁路轴的消费仍会 INCRBYFLOAT 进 `cost_5h_fixed`，主线全局 5h-fixed lease 每次刷新都从被污染的计数器重新播种，从而消耗主线全局 5h 额度（违背 §4.8-A）。**实现修正**：`trackCost` 新增 `bypassKeyGlobalCost?` / `bypassUserGlobalCost?` 选项，被旁路轴**跳过其 key/user 5h-fixed 写入**（provider 与其余档不动）。daily/weekly/monthly/total/5h-rolling 因从过滤后 DB 播种，无需跳过 `trackCost`。回归见 §11「完全切分打标」与 `service-extra.test.ts`。
   - **说明**：全局轴「跳过」是 gate 既有主线 decrement 调用，**无法完全外移**，只能在数组处做局部条件 spread（小而幂等）；`resolveCountedFlags` 与模型桶 decrement 则完全落在 `backfill.ts`。这与 §3.6 标记、§6 聚合过滤三处同源，保证 Redis 切片与 DB 重播种口径一致、无漂移。
   - flag 关闭时两标记恒 false / 条件 spread 恒取全集 → 全部正常计入，零行为变化。

### 5.3 完全切分：检查跳过 + 计量切分（按轴打标，D13）

- **配置轴 = 检查跳过 + 计量切分**：命中轴既跳过主线成本档 `if` 判定（§5.2.3），又**不计入**该轴主线全局额。
- `usage_ledger` 仍**无条件记录每条请求的实际成本**（口径不变），但新增两列 `counted_in_*_global` 标注该笔成本是否计入对应轴全局额（§3.6）；模型桶 `decrementLease` 照常无条件执行。
- 主线**全局额聚合**（lease 播种 + total 计数 + 回填扣减）一律按 `counted_in_*_global = true` 过滤（§6），因此被切分轴的消费**不再**进入该轴主线全局桶——配置轴与全局额成为独立预算。
- **非对称仍正确**：只配 userSide、未配 keySide 时，`counted_in_user_global=false`（不计 User 全局）但 `counted_in_key_global=true`（仍计 Key 全局，Key 轴照常受全局护栏）。
- **展示口径（UI 必须明示且分栏，§10）**：因消费按轴切分，用户「计入全局额」的数字会小于其「总消费」。额度卡/my-usage 须拆「计入全局 / 模型组单算」两栏并明示，避免「总花费 ≠ 全局额度判定」的困惑。

---

## 6. lease 桶与 DB 聚合

| 桶 | lease key | DB 权威聚合（`usage_ledger`）|
|---|---|---|
| Key 侧 | `lease:key-mg:{keyId}:{groupId}:{window}[:{mode}]` | `keyId` 且 `model IN (组成员)` |
| 用户侧 | `lease:user-mg:{userId}:{groupId}:{window}[:{mode}]` | `userId` 且 `model IN (组成员)` |

- **无跨成员聚合**：用户组限额是人均上限（D5），用户侧桶恒按该 user 自身计量；用户组只贡献「cap 值」，不改变计量对象。
- `total` 档无 lease 窗口，但**复刻主线 `checkTotalCostLimit` 的 Redis 读穿缓存**（`total_cost:model:*`，5min TTL）而非每请求直连 DB（**修正**：主线 total 是 Redis 缓存 + DB 兜底 + 异步写回，非纯 DB 聚合）。详见 §17.1（OPT-A）。
- 模型桶聚合：`sumScopeCostByModelsInTimeRange(scope, id, models[], start, end)`（`model IN (...)`，沿用现有 `sumUserCostByModelInTimeRange` 写法）。组成员列表来自 `model_group_members`。

### 6.1 主线全局额聚合按标记过滤（完全切分，D13）

主线全局桶的 DB 聚合改为**只统计计入全局的消费**：

- `sumUserCostInTimeRange` / `sumUserTotalCost`（User 轴）追加 `AND counted_in_user_global = true`；`sumKeyCostInTimeRange` / `sumKeyTotalCost`（Key 轴）追加 `AND counted_in_key_global = true`。
- **不可原地改这些共享函数**（同时服务展示/告警）。两种落地任选其一，建议前者：
  - **加可选参数** `countedInGlobalOnly?: boolean`（默认 false → 与 main 逐字节一致），仅**限额检查**调用方（`lease-service.queryDbUsage`、`checkTotalCostLimit` 的 DB 兜底）传 `true`；
  - 或新增 `sum*CostCountedInGlobalInTimeRange` 变体函数。
- **展示侧**（§10）用同源标记拆栏：`counted_*=true` → 「计入全局」，`counted_*=false` → 「模型组单算」，两者之和 = 总消费。
- 一致性保证：DB 聚合过滤、Redis 回填跳过（§5.2.4）、展示分栏，三处全部由 `counted_in_*_global` 同一标记驱动 → lease 重播种与运行时扣减口径恒一致。

---

## 7. 提额（授予账本，无申请流）

建模为独立账本 `quota_boost_grants`（§3.5），而非限额行内联列。

- **字段**：`userId`（D11 仅个人用户）、`modelGroupId`、`window`（作用单档）、`amountUsd`（提额度）、`validPeriod`（有效期 `[from,end)`）、`note`/`createdBy`（可选审计）。
- **无申请/审批工作流（D14）**：当前系统**不实现**用户自助申请、审批状态机。管理员在 Dashboard 直接为「某用户 × 某模型组 × 某窗口」**新增/删除授予行**。生效时机（F2 缓存）：增删授予**写时失效解析快照 → 近即时生效**（无写时失效则 ≤TTL 传播）；而 `validPeriod` 的**时间窗到点生效/失效是 in-memory 精确判定、无延迟**（§4.4 F2）。**撤销提额 = 删行**。
- **可叠加（D10）**：同一 (userId, modelGroupId, window) 允许多条不同有效期并存，解析时对当前有效者求和（§4.4）。
- 生效见 §4.4：`valid_period @> now` 的授予，其 `amountUsd` 累加到对应窗口个人 source 上限。

### 7.1 过期清理（D12）

需求：**当前时间超过有效期 `end` 即删除提额，避免每请求都计算时间窗**。

- **清理动作**：直接 **DELETE 过期授予行**（基准五档在 `model_group_limits`，不受影响）。
  ```sql
  DELETE FROM quota_boost_grants WHERE upper(valid_period) <= now();
  ```
  （退化为两列时 `WHERE valid_to <= now()`。）
- **触发方式**：复用 `instrumentation.ts` 既有定时器模式（如会话缓存 `startCacheCleanup(60)`、云价 `startCloudPriceSyncScheduler` 的 `setInterval`），新增 `startBoostExpiryCleanup()`：`register()` 内带 `__CCH_*` 幂等守卫启动，周期 60s 跑一次上述 DELETE。
- **与解析的关系**：清理让活跃授予集保持很小，使 §4.4 的取数廉价。两次清理之间残留的过期行，由 §4.4 的 `valid_period @> now` 兜底保证**不会**错误生效（清理是优化，不影响正确性）。

---

## 8. 文件清单

```
src/drizzle/schema.ts
  - 删除 userModelLimits / keyModelLimits
  + modelGroups / modelGroupMembers / userGroups / modelGroupLimits / quotaBoostGrants + 两 enum
  + usage_ledger 增 counted_in_user_global / counted_in_key_global 两列（主线表变更，§3.6）

src/repository/
  model-group.ts        # 模型组 + 成员 CRUD；model→groupId 反查；互斥校验
  user-group.ts         # 用户组(tag) CRUD；tag↔成员（派生）
  model-group-limit.ts  # model_group_limits CRUD（按 subject）
  quota-boost.ts        # quota_boost_grants CRUD；活跃授予查询；过期 DELETE
  usage-aggregate.ts    # sumScopeCostByModelsInTimeRange（或并入现有聚合文件）
  statistics.ts         # 全局聚合加 countedInGlobalOnly 过滤（§6.1）：sumUser/KeyCostInTimeRange、sumUser/KeyTotalCost

src/lib/model-rate-limit/
  resolver.ts       # §4：目标解析 + keySide + userSide(max) + 提额叠加 → ModelLimit[]
  keys.ts           # §6 lease key（key-mg / user-mg）
  service.ts        # checkCostLimitsWithLease(桶) / decrementLease(桶)；total 桶走 Redis 读穿缓存（OPT-A §17.1）；模型 lease 传 floor / 模型 percent（OPT-B §17.2）
  types.ts          # ModelLimit(含 bucket + caps) + flag
  cache.ts          # §4.1/§4.7/§17.3 解析快照（model→group / 组成员 / tag→组限额行）；L1 + Redis pub/sub 失效（照 provider-cache.ts）+ stale-while-revalidate（OPT-C）+ 零组短路（OPT-F）
  boost-cleanup.ts  # §7.1 startBoostExpiryCleanup()：60s DELETE 过期授予行
  backfill.ts       # §5.2.4 seam：resolveCountedFlags() + modelBucketDecrements()（response-handler 仅留极小调用点）

src/lib/rate-limit/
  lease-service.ts  # queryDbUsage 传 countedInGlobalOnly=true（§6.1）
  service.ts        # checkTotalCostLimit DB 兜底传 countedInGlobalOnly=true（§6.1）

src/instrumentation.ts   # register() 内启动 startBoostExpiryCleanup()（__CCH_* 幂等守卫）

src/app/v1/_lib/proxy/
  model-rate-limit-guard.ts  # 解析 enforced、逐桶检查、置 bypassUser/KeyGlobalCost（fail-open 不置，§5.2）
  rate-limit-guard.ts        # User-* / Key-* 成本档按标记守卫；RPM/并发不变
  guard-pipeline.ts          # ExtensionStep.insertBefore
  session.ts                 # bypassUserGlobalCost / bypassKeyGlobalCost + resolvedModelLimits[]
  response-handler.ts        # §5.2.4 仅 2 处极小调用点：resolveCountedFlags 写两列 + decrement 数组条件 spread（逻辑在 backfill.ts）

src/app/api/v1/resources/
  model-groups/{router,handlers}.ts
  user-groups/{router,handlers}.ts
  model-limits/{router,handlers}.ts   # 重写为 model_group_limits（仅基准五档）
  quota-boosts/{router,handlers}.ts   # 提额授予 列表/新增/删除（无审批）
  _root/app.ts                         # 挂新路由

src/actions/{model-group,user-group,model-limit,quota-boost}.ts
src/actions/{my-usage,users,keys,key-quota}.ts   # 展示分栏：计入全局 / 模型组单算（§10）
src/app/[locale]/dashboard/quotas/{model-groups,user-groups,model-limits}/   # 三页面（限额页内嵌提额授予列表）
messages/<locale>/quota.json   # 5 语言追加/重写 modelLimits 子树（含提额、切分提示、展示分栏）
```

---

## 9. Admin REST API

```
# 模型组 + 成员
GET/POST/PATCH/DELETE  /api/v1/resources/model-groups[/:id]
POST/DELETE            /api/v1/resources/model-groups/:id/members   # { model } / ?model=

# 用户组
GET/POST/PATCH/DELETE  /api/v1/resources/user-groups[/:id]

# 限额（统一表，仅基准五档）
GET    /api/v1/resources/model-limits?subjectType=&subjectId=
POST   /api/v1/resources/model-limits   # { subjectType, subjectId, modelGroupId, ...caps }
DELETE /api/v1/resources/model-limits/:id

# 提额授予（账本，无审批；仅个人用户 D11）
GET    /api/v1/resources/quota-boosts?userId=&modelGroupId=
POST   /api/v1/resources/quota-boosts   # { userId, modelGroupId, window, amountUsd, validPeriod, note? }
DELETE /api/v1/resources/quota-boosts/:id   # 撤销 = 删行
```

复用 admin auth；zod-openapi；`openapi:check && openapi:lint && test:v1` 通过。

---

## 10. Dashboard UI

- **模型组管理**（新）：建组、增删成员（模型多选，复用 `model-combobox`）；「单模型」快捷建单元素组；成员互斥冲突提示。
- **用户组管理**（新）：从 `getAllUserTags()` 选 tag 登记为组。
- **按模型限额**（重写）：主体选择器（用户 / 用户组 / Key）+ 模型组选择器 + 五档限额。
- **提额授予**（限额页内嵌，**仅主体=个人用户时可见**，D11/D14）：展示该 (用户×模型组) 的活跃/未来授予列表，支持**新增**（窗口下拉 + 提额度 + 起止时间）与**删除**（=撤销）；**无申请/审批入口**，管理员直接操作。
  - **F1 提示**：明示「提额会在该用户的有效上限（个人行或其用户组上限，取较高基线）之上叠加；用户即使只命中用户组限额，提额也生效」。
  - **F2 提示**：明示「`validPeriod` 到点即时生效/失效；新增或删除授予最长 N 秒（缓存 TTL）后对线上请求生效」。
- **用量展示分栏（完全切分必需，D13/§5.3/§6.1）**：`my-usage`、用户/Key 额度卡、`cost-alert` 须按 `counted_in_*_global` 拆「**计入全局额** / **模型组单算**」两栏（两者之和 = 总消费）。否则会出现「总花费 ≠ 全局额度判定值」的困惑。全局额度卡的「已用」只取「计入全局额」部分。
- **语义提示**：明示「命中本限额后，该轴 [用户管理] 全局成本限额**不再生效、且该消费不计入全局额**（完全切分）；RPM/并发仍生效」「用户组限额为人均上限」「多源取最大值」。
- 5 语言 i18n；过 `i18n:audit-placeholders:fail`、`i18n:audit-messages-no-emoji:fail`。

---

## 11. 测试（≥80%）

| 层 | 关键断言 |
|---|---|
| Resolver | 目标唯一组解析；userSide 多源取 max；提额仅个人用户、按档叠加（多条求和）参与 max；keySide 独立；模型无组→enforced 空 |
| 提额 F1（虚拟 source）| 无个人行、仅用户组限额时提额仍以 groupMax 为基线叠加生效；boost=0 时虚拟 source = groupMax（无回归）；无任何 source 时提额惰性（userSide 仍 null，不凭空建限额）|
| 提额账本 | 多条有效期重叠叠加求和；`valid_period @> now` 内外切换；过期 DELETE 后不再生效；删行=撤销即时生效 |
| 提额 F2（缓存）| 时间窗到点 in-memory 精确生效/失效（零延迟）；增删授予写时失效后即时生效；快照内过期行因 `@> now` 不误生效 |
| Service | key-mg / user-mg 桶 lease key 与 DB 聚合口径；五档越界 `MODEL_*`；fail-open |
| Guard | userSide 命中→`bypassUserGlobalCost`；keySide 命中→`bypassKeyGlobalCost`；RPM/并发恒检查；flag 关闭直通；**fail-open 不置 bypass** |
| 完全切分打标 | 落账两列 = `!bypass*`；命中轴消费不计入该轴全局聚合、不扣该轴全局 lease；非对称（仅 userSide）→ 不计 User 全局但仍计 Key 全局；标记默认 true |
| 全局聚合过滤 | `countedInGlobalOnly` 过滤生效；展示分栏两值之和 = 总消费；改分组不追溯历史行（写入冻结） |
| 主线回归 | 两标记 false / 标记恒 true 时与 main 逐字节一致 |
| Repository | 模型成员唯一约束（互斥）；各表 CRUD；tstzrange 读写；过期 DELETE |
| 集成 | 真实 Redis+PG：人均口径计量、提额期内/外切换与叠加、完全切分（命中轴消费不入全局、未配置轴照常入全局）、lease 重播种与回填跳过口径一致、RPM 仍拦截、回填多桶扣减 |

---

## 12. 阶段

- **A** Schema + Repository（五表/两 enum、成员互斥、提额账本、聚合查询、过期 DELETE）+ 单测。
- **B** Resolver + Service（§4/§6/§7 含提额叠加）+ 单测。
- **C** Guard 覆盖（`insertBefore`、按轴标记、主线成本档守卫、多桶回填）+ 回归/集成。
- **D** Admin API（四组端点 + OpenAPI）。
- **E** Dashboard UI（三页面 + 提额授予列表）+ i18n。
- **F** 文档（`docs/api`）+ CHANGELOG；PR → `dev`，squash-merge。

---

## 13. 风险

| 风险 | 缓解 |
|---|---|
| 主线成本档按轴拆分守卫引回归 | flag 默认 off、bypass 标记默认 false、`counted_in_*_global` 默认 true；写「flag 关闭逐字节一致」回归单测 |
| 模型组互斥被绕过（同模型多组） | `model_group_members.model` 唯一索引 + 应用层校验 |
| 提额 tstzrange 兼容性 | drizzle 不支持则降级 `validFrom/validTo` 两列 |
| max 合并语义被误解为「全组共享预算」 | 文档/UI 明示 D5「人均上限」；测试固化按 user 自身计量 |
| 提额过期残留 | 解析按 `valid_period @> now` 实时判定，过期自动失效；定时 DELETE 保活跃集小 |
| 与 main 同步冲突 | 主线 diff 仅 `guard-pipeline`/`rate-limit-guard`/`session`/`response-handler`/`app.ts`/`schema.ts`/`statistics.ts`/`lease-service.ts`/`rate-limit/service.ts`；其余新文件 |
| **完全切分使全局聚合变模型感知** | 用 `usage_ledger` 按轴打标（§3.6），三处（DB 过滤/Redis 跳过/展示）同源标记；默认 true 保「flag off 与 main 一致」；已否决读取期 `NOT IN`（R1/R2，§16.1）|
| **展示口径分裂（总花费 ≠ 全局额度判定）** | `my-usage`/额度卡/`cost-alert` 按标记拆「计入全局/模型组单算」两栏（§10），两值之和 = 总消费 |
| **lease 重播种与回填口径漂移** | 播种过滤、回填跳过、展示三处由同一对 `counted_in_*_global` 标记驱动，行级冻结 → 无漂移 |
| **热路径 DB 往返放大 / PG QPS 打满** | 解析走进程内短 TTL 缓存快照（§4.1/§4.7），目标无组场景 0 新增 DB 往返；lease 检查 `Promise.all` 并行；§15 加 micro-benchmark 验收 |
| **fail-open × bypass 双重放行** | fail-open 的桶不置对应 bypass 标记，保留主线全局额护栏（§5.2 CRITICAL）；回归测试固化 |

---

## 14. 主线最小 diff 估算

> 注意：本表统计**改动行数**；热路径**每请求新增 I/O** 是独立维度，见下方与 §4.7。评审以「行数 + I/O」两个维度共同拍板。

| 文件 | 行数 | 说明 |
|---|---|---|
| `schema.ts` | +115 / -40 | 新五表两 enum（含 `quota_boost_grants`），删旧两表；`usage_ledger` +2 标记列（§3.6）|
| `guard-pipeline.ts` | +8 | `insertBefore` |
| `rate-limit-guard.ts` | +14 | User-*/Key-* 成本档按轴守卫（RPM/并发不变）|
| `session.ts` | +10 | 两 bypass 标记 + resolvedModelLimits[] |
| `response-handler.ts` | **+8**（seam 化后） | 仅 2 处调用点：`resolveCountedFlags` 写两列 + decrement 数组条件 spread；其余逻辑在新文件 `backfill.ts`（§5.2.4，把最高频文件冲突面降到最小）|
| `statistics.ts` | +12 | 4 个全局聚合加 `countedInGlobalOnly` 过滤（§6.1，默认 false）|
| `lease-service.ts` / `rate-limit/service.ts` | +6 | `queryDbUsage` / `checkTotalCostLimit` DB 兜底传 `countedInGlobalOnly=true` |
| `instrumentation.ts` | +6 | `register()` 内启动提额过期清理定时器 |
| `_root/app.ts` | +3 | 挂三路由 |
| `messages/*/quota.json`×5 | +子树 | 不改主线其他 key |

**每请求新增 I/O 估算**（达成 §4.7 缓存 + 并行约束后）：

| 场景 | 新增 DB 往返 | 新增 Redis 往返 | 备注 |
|---|---|---|---|
| flag off | 0 | 0 | 与 main 逐字节一致 |
| flag on、模型无组 | 0（快照命中） | 0 | 解析即返回 enforced=[] |
| flag on、单轴命中 | 0（快照命中） | ≤5（并行） | 主线对应轴成本档旁路 + 该轴全局回填跳过，净 Redis 大致持平 |
| flag on、双轴命中 | 0（快照命中） | ≤10（并行） | 主线 User-_/Key-_ 成本档均旁路 + 两轴全局回填均跳过 |

> 若**不做**缓存（每请求实查 `model_group_members` 等），无组场景即 +1 DB、命中场景 +4~6 DB **串行**横在转发前——故 §4.7 缓存为 v1 硬约束，非优化项。完全切分的两标记列写入随落账 UPDATE 完成，无新增往返。

`ENABLE_MODEL_RATE_LIMIT=false`（或标记恒 true）时零行为变化。

> **可上游化的通用 seam（hybrid，落地计划 §4.1）**：`insertBefore`、`statistics` 的 `countedInGlobalOnly?`、`lease.ts` 的 `minSliceUsd?`、`session` 的按轴 bypass 字段——均以**通用命名、无产品观点**实现，以便落地后作为小 PR 贡献回 upstream，把永久冲突面收敛到近零。

---

## 15. 验收

- [ ] flag 关闭：与 main 逐字节一致。
- [ ] 模型无组 / 某轴无配置：该轴走主线全局额（D9）。
- [ ] 用户侧多源取最大值；提额仅个人用户可配、按指定档叠加（多条求和）且仅在有效期内；用户组/Key 无提额。
- [ ] 提额账本无审批流（管理员直增删）；过期由定时任务 DELETE，删行即时撤销；过期后不再参与计算。
- [ ] 用户组为人均上限（按 user 自身消费计量）。
- [ ] Key 侧独立 AND；命中按轴切分对应主线全局成本档（检查跳过）；RPM/并发仍生效。
- [ ] **完全切分（D13）**：命中轴消费**不计入**该轴主线全局额（不进 lease 播种、不扣全局 lease、不增 total/daily 计数）；落账 `counted_in_*_global = !bypass*`。
- [ ] **非对称切分**：仅配 userSide 时，消费不计入 User 全局但**仍计入** Key 全局。
- [ ] **改分组不追溯**：模型加入/移出组只影响其后新行，历史消费归属不变（标记写入冻结）。
- [ ] **展示分栏**：`my-usage`/额度卡/`cost-alert` 拆「计入全局 / 模型组单算」，两值之和 = 总消费；全局额度卡「已用」只取计入全局部分。
- [ ] 五档越界返回正确 `MODEL_*` 码 + i18n（含模型组名 / 数值占位符）。
- [ ] 模型成员全局互斥（DB 约束生效）。
- [ ] **fail-open 不置 bypass**：模拟 Redis 故障，模型档 fail-open 时主线对应轴全局成本档仍执行（不双重放行）、且该消费仍计入全局（标记 true）——回归测试断言（§5.2 CRITICAL）。
- [ ] **热路径缓存生效**：解析走进程内快照，写操作触发失效；模型无组场景每请求 0 新增 DB 往返。
- [ ] **micro-benchmark**：flag on 且零配置时，p50/p99 转发前延迟相对 main 增量 < 约定阈值；lease 检查并行（非串行）。
- [ ] **OPT-A（total 缓存）**：配置 total 模型限额时稳态每请求 0 次 total DB 聚合（命中 `total_cost:model:*`）；未命中才查 DB 并异步写回；模型桶聚合**不**按 `counted_in_*_global` 过滤。
- [ ] **OPT-B（小额度桶）**：设 `quotaModelLeaseMinSliceUsd` / 模型 percent 后小额度桶刷新频次下降；floor 被 remaining 收口、不超发；全 null 时与未优化逐字节一致。
- [ ] **OPT-C（stale-while-revalidate）**：快照过期 / 失效后除进程首启外无请求阻塞于 DB 重建；并发刷新去重；失效经 pub/sub 广播、跨 Pod 一致。
- [ ] **OPT-F（零组短路）**：全系统无模型组时 guard 在 per-model 查找前返回，flag on 零配置每请求 0 DB / 0 Redis。
- [ ] 覆盖率 ≥80%；OpenAPI lint、i18n audit、typecheck、build 全绿。

---

## 16. 开放点

- **O1 提额申请流（已定稿）**：**当前系统不实现**用户自助申请/审批工作流（D14）。提额为管理员直接在 `quota_boost_grants` 增删授予行（无 pending/审批状态机）。自助申请→审批若未来需要，可在账本上叠加 `status` 列扩展，不影响现有结构。
- **O5 切分口径（已定稿，v1 采纳完全切分）**：v1 采「**配置轴完全切分**」（D13/§5.3）——命中某轴模型限额时，该请求消费既跳过该轴全局检查、也**不计入**该轴主线全局额。实现为 `usage_ledger` **按轴打标**（`counted_in_user_global` / `counted_in_key_global`，写入期由 bypass 标记冻结），全局聚合按标记过滤（§3.6/§5.3/§6.1）。已否决初版「仅跳过检查、消费仍计入」（模型限额额度需全局额 ≥ 模型消费才用得满、分组消费污染未分组流量）与读取期 `NOT IN` 排除（追溯重分类 + 口径分裂，见 §16.1）。选型对比与被否决方案见 §16.1。
- **O2 模型组匹配**：v1 精确模型名；前缀/通配模式放 v2。
- **O3 RPM/并发模型维度**：v1 不纳入。
- **O4 旁路粒度（已定稿）**：采「**按轴旁路**」（§5.1，双标记 `bypassUserGlobalCost` / `bypassKeyGlobalCost`）。理由：唯一同时满足 D3（Key 独立 AND）、D8（命中即覆盖）、D9（某轴未配置则回退 [用户管理]）的方案——非对称情形下，未配置模型限额的那一轴**保留主线全局额护栏**，不会失去成本约束。已否决「任一轴命中即同时旁路两级」的单标记方案（会在非对称情形违背 D9，使未配置轴变为无成本上限）。

### 16.1 完全切分选型：按轴打标（已采纳）vs 读取期 `NOT IN`（已否决）

> 结论：完全切分把全局额聚合从「模型无关」改成「模型感知」，改动量约为初版「仅跳过检查」（主线约 +45 行）的 **3~5 倍**。**v1 采纳「按轴写入期打标」**（§3.6），它把改动从「读写多路模型感知 + 强一致排除集」收敛为「写入打标 + 读取布尔过滤」，并规避读取期 `NOT IN` 的两个结构性缺陷（R1/R2）。

**主线全局额的三条计费路径（改动靶点，均模型无关）**

| 路径 | 位置 | 作用 |
|---|---|---|
| lease 播种（5h/daily/weekly/monthly） | `lease-service.ts` `queryDbUsage` → `sumUserCostInTimeRange`/`sumKeyCostInTimeRange`（`statistics.ts`） | Redis 切片初值 = limit − DB 用量 |
| total 档计数 | `service.ts` `checkTotalCostLimit` → Redis `total_cost:*`（5min TTL）+ DB 兜底 `sumUserTotalCost`/`sumKeyTotalCost` | 永久额 |
| 回填扣减 | `response-handler.ts` `trackCost` / `trackUserDailyCost` / 8 个 `decrementLeaseBudget` | 每请求无条件递增/递减全局桶 |

> 关键事实：`sumUserCostInTimeRange` / `sumKeyCostInTimeRange` / `sumUserTotalCost` **同时被「限额检查」与「展示/告警」复用**（`actions/users.ts`、`actions/keys.ts`、`actions/my-usage.ts`、`actions/key-quota.ts`、`notification/tasks/cost-alert.ts`）。这是风险 R1 的根因。

**已采纳：按轴写入期打标的改动点**

谓词不是「模型在不在组」，而是「**该轴当时是否真被旁路**」（= `!bypassAxis`，与 §5.2 的 fail-open 守卫自洽）。改动点：

1. **schema**：`usage_ledger` +2 列 `counted_in_user_global` / `counted_in_key_global`（默认 true，§3.6）。
2. **落账打标**：`updateRequestCostFromUsage` 写两列 = `!bypassUserGlobalCost` / `!bypassKeyGlobalCost`（近零额外开销，标记已在 session 上）。
3. **全局聚合按标记过滤**：`sumUserCostInTimeRange`/`sumUserTotalCost`/`sumKeyCostInTimeRange`/`sumKeyTotalCost` 加可选 `countedInGlobalOnly` 参数（默认 false → 与 main 一致），仅限额检查调用方传 true（§6.1）。
4. **回填按轴跳过**：被旁路轴跳过其全局 `decrementLeaseBudget`；并跳过 `trackCost` 中**该轴的 5h-fixed 计数器写入**（唯一从 Redis 计数器播种的全局档，见 §5.2.4 CRITICAL）。其余档（daily/weekly/monthly/total/5h-rolling）从已过滤 DB 播种，故 `trackCost`/`trackUserDailyCost` 其余写入无需跳过。
5. **展示分栏**：`my-usage`、用户/Key 额度卡、`cost-alert` 按标记拆「计入全局 / 模型组单算」两栏（§10）。

> 三处（DB 过滤、Redis 回填跳过、展示）由**同一对标记**驱动 → 无漂移、无 `NOT IN`、无追溯。「flag off / 模型无组 / fail-open」标记恒 true → 与 main 逐字节一致。

**已否决：读取期 `NOT IN` 排除（保留为否决依据）**

读取期对全局聚合加 `AND model NOT IN (:已分组模型集)` 看似更省（无新列），但因上述聚合函数被「检查」与「展示/告警」复用，且历史行被追溯重判，有两个结构性缺陷，故否决：

| 等级 | 缺陷 | 打标方案如何规避 |
|---|---|---|
| 高 | **R1 口径分裂** | 聚合函数被展示与执行复用，只改执行会出现「已用 \$100/上限 \$100 却不拦截」 | 标记同源，展示与执行用同一过滤，可一致拆栏 |
| 高 | **R2 追溯重分类** | `NOT IN` 对全部历史行生效：加入组的瞬间历史消费追溯退出全局桶（凭空多预算）、移出组则瞬间超限被拦 | 标记写入即冻结，改分组只影响未来行 |
| 中 | **R3 漂移窗口** | 排除集缓存与回填跳过短暂不一致时全局 lease 漂移至 re-seed 才自愈 | 标记冻结在行上，播种与扣减恒一致 |
| 低 | **R6 谓词歧义** | 「属任意组」还是「属有限额的组」？排除集随轴/用户而变 | 谓词即「该轴是否被旁路」，天然按轴、无歧义 |

**两方案均需注意 R4（provider 不切分）**：O5 只涉 user/key 全局额，provider 桶仍按全模型聚合，须在文档/UI 明示。

---

## 17. 性能优化补充设计（OPT-A..F）

> **规模基线：目标部署用户量 ≤ 1 万。** 下列设计据此取舍——OPT-E 明确**不做**懒加载拆分（避免过度设计）；其余以「消除 p99 尖刺、保持稳态亚毫秒」为目标。本节为 §2/§4.7/§6/§14/§15 的修订与补充，落地以本节为准。
>
> **落地后延迟基线（达成本节优化后）**：flag off / 模型无组 ≈ **0**；稳态单/双轴命中 ≈ **一次并行 Redis 往返（~0.3–1ms）**，且命中轴会跳过主线该轴串行成本档、净开销往往更小；偶发的 lease 刷新 tick ≈ 该 1 个请求 +1–5ms。相对一次数百 ms–数秒的上游 LLM 调用，稳态新增在端到端 p50 中占比 < 0.5%。

### 17.1 OPT-A：模型 total 档复刻主线 Redis 读穿缓存

**问题**：`total` 档无 lease 窗口；若每请求直连 DB 做 `model IN (members)` 近全 history 聚合，则任何配置了 total 模型限额的请求都在热路径上多一次随历史增长的聚合（现有 `ModelRateLimitService` 即此问题）。

**设计**（对齐主线 `checkTotalCostLimit`，`service.ts:456-481`）：
- 缓存键 `total_cost:model:{scope}:{scopeId}:{groupId}[:{resetAtMs}]`，TTL `300s`。
- 读穿：命中→用缓存值；未命中→`sumScopeCostByModelsInTimeRange(scope, scopeId, members, start, now)`，**异步**写回缓存（不阻塞请求），fail-open。
- **与完全切分的关系（关键）**：模型桶聚合**不**按 `counted_in_*_global` 过滤——模型桶是「模型限额自己的预算」，统计该 scope 在组成员模型上的**全部**消费，与全局额是否旁路无关。`counted_in_*_global` 仅作用于**主线全局额**聚合（§6.1），二者预算独立。
- **限额变更无需失效**：缓存的是**用量**（与 limit 无关）；比较时用快照里最新的 `limitTotalUsd`。同主线，over-grant 上限 = TTL（5min），可接受。

### 17.2 OPT-B：模型桶 lease 切片下限 / 独立 percent

**问题**：lease 切片 = `limit × percent`（默认 5%）。模型组限额常远小于全局额（如 \$5/日 → 切片 \$0.25），几个请求即耗尽 → 频繁 `refreshCostLeaseFromDb` → 热路径 DB，lease 的「摊薄 DB」红利在小桶上失效。

**设计**：
- 新增系统设置（`system_config` 表 + `SystemSettings` 类型 + cache 默认值；**全部 nullable、默认 null → 行为与今一致、零回归**）：
  - `quotaModelLeasePercent5h / Daily / Weekly / Monthly`：模型维度专用百分比，null 时回退全局 `quotaLeasePercent*`。
  - `quotaModelLeaseMinSliceUsd`：模型桶切片下限（floor），null 时无下限。
- `calculateLeaseSlice`（`lib/rate-limit/lease.ts` 纯函数）**加可选参数** `minSliceUsd?`（默认 undefined → 主线调用方不受影响）：
  ```
  remaining = max(0, limitAmount - currentUsage)
  base      = limitAmount * percent
  withFloor = minSliceUsd ? max(base, minSliceUsd) : base
  withCap   = capUsd ? min(withFloor, capUsd) : withFloor
  slice     = min(withCap, remaining)        // 恒被 remaining 收口 → 不会过授
  ```
  下限被 `remaining` 收口，故小额度桶最坏 = 一次性租掉全部剩余（等价精确计数），不会超发。
- 仅 `ModelLeaseService.refreshCostLeaseFromDb` 传入 floor 与模型 percent；主线 lease 不变。

### 17.3 OPT-C：解析快照 stale-while-revalidate

**问题**：`provider-cache` 式缓存在过期/失效时让**触发请求阻塞**等 DB 重建（约 5 条查询）——每 TTL 边界 / 每次写失效后那 1 个请求 +5~20ms。

**设计**（在 §4.7 的 L1 + Redis pub/sub 基础上，照 `provider-cache.ts`）：
- `getModelLimitSnapshot`：
  ```
  if (cache.data) {
    if (fresh)  return cache.data;
    triggerBackgroundRefresh();   // 不 await
    return cache.data;            // 立即返回旧快照
  }
  return await triggerBackgroundRefresh();   // 仅真冷启动阻塞
  ```
  `triggerBackgroundRefresh` 以 `refreshPromise` + `version` 去重（防并发刷新 / 防旧刷新覆盖新失效）。
- **失效（pub/sub 收到）改为「标记过期 + 触发后台刷新」而非置 null**：写操作后各 Pod 继续服务上一版快照、后台重建，**无任何请求阻塞**；新增配置最多「上一刷新周期」内不生效（与已接受的「集群 ≤TTL 传播」一致）。仅进程首启（无任何旧数据）那一个请求 await。
- TTL 仍保留作兜底（pub/sub fire-and-forget、可能丢消息）。
- **写路径同步刷新（已定，Option 2）**：`publishModelLimitCacheInvalidation()` 在广播前**先 `await` 一次本地重建**（绑定模块级默认 fetcher `configureModelLimitCache(buildModelLimitSnapshot)`），使**写请求落到的那个 Pod 写后即时新鲜**（read-your-writes、测试确定）；其余 Pod 收 pub/sub 后走 markStale + serve-stale。
  - **影响范围**：同步刷新只在**管理员写配置路径**（非代理热路径），终端用户代理请求延迟零影响；admin Save 多付一次重建（几 ms，可忽略）。
  - **边界澄清**：read-your-writes 仅对「写请求所在 Pod」成立；多 Pod 集群的集群级新鲜度由 **pub/sub 传播**决定（亚秒级，兜底 ≤TTL），与本选项无关。配置短暂陈旧只影响「用哪个 limit 值」，预算计数是 Redis 原子 + DB 权威，不会双花。

### 17.4 OPT-D：`counted_in_*_global` 部分索引（基准门控，默认不加）

- 完全切分后，重度使用模型组的用户其 ledger 多数行 `counted=false`；主线全局聚合 `AND counted_in_*_global=true` 在 `(userId/key, createdAt)` 上做残余过滤、扫并丢弃 false 行。**仅影响全局 lease 刷新（每 ~10s），非每请求**，影响有界。
- v1 **默认不加索引**（同原方案）。§15 micro-benchmark 增加「重度模型组用户的全局 lease 刷新」用例；**仅当**实测热点时再加：
  ```sql
  CREATE INDEX CONCURRENTLY idx_usage_ledger_user_counted ON usage_ledger (user_id, created_at) WHERE counted_in_user_global;
  CREATE INDEX CONCURRENTLY idx_usage_ledger_key_counted  ON usage_ledger (key, created_at)     WHERE counted_in_key_global;
  ```
- ≤1 万用户量级下大概率无需；列为「观测后决策」。

### 17.5 OPT-E：规模假设 ≤1 万用户 → 单一全局快照，不做懒加载拆分

- 最坏即「每个用户都配个人模型限额」≈ ≤1 万行 `model_group_limits(subject=user)` + 少量组/用户组/Key 行 + 小提额集；进程内 Map 约数 MB，重建 ≈ 5 条索引查询、几 ms。**结论：v1 用单一全局进程内快照即可，明确不实现「全局快照 + 按 user 懒加载」拆分**（避免过度设计）。
- 运营建议：优先用**用户组限额**（行数小）而非逐用户个人行。
- 未来触发条件（仅记录，v1 不做）：个人限额行数量级达 1e5+，或快照重建 p99 超阈值 → 再评估拆分。

### 17.6 OPT-F：零组系统的最早短路

- guard / resolver 入口：`if (snapshot.modelToGroup.size === 0) return null`（全系统无任何模型组时，连 per-model 查找都跳过）。保证「flag on 但功能实际未启用」严格零开销。

### 17.7 受影响的配置 / Schema / 章节同步

- **`system_config`（主线表变更）**：新增 5 列（OPT-B：`quota_model_lease_percent_5h/daily/weekly/monthly`、`quota_model_lease_min_slice_usd`），均 nullable、默认 null。随 §3.7 迁移一并 `db:generate`；同步更新 `SystemSettings` 类型与 `system-settings-cache.ts` 的 DEFAULT / fallback。
- **§6** total 行已按 OPT-A 修正；**§4.7** 缓存参考已改为 `provider-cache.ts`（L1 + pub/sub）。**§8** `cache.ts` / `service.ts` 职责已补 OPT-A/C/F。
- **§14 主线 diff 增量**：`system_config` +5 列；`lease.ts` 加 `minSliceUsd?` 参数（+~6 行，默认 null 时零行为变化）；`cache.ts` subscribe/publish 接线均在热路径之外，「flag off / 模型无组 0 RTT」基线不变。
- **§15** 已新增 OPT-A/B/C/F 验收项。

---

## 18. 测试场景目录（驱动 unit / integration / E2E）

> 本节是 §4.6/§4.8/§11 的可执行化展开：每个场景给 `ID | 配置/前置 | 动作/序列 | 期望 | 覆盖`，ID 稳定可引用、直接映射到 §11 的测试层。约定层级：**unit**=resolver/纯函数/缓存（无 I/O 或 mock Redis）；**integration**=真实 Redis+PG 的 service/guard/聚合；**E2E**=完整代理链路。

### 18.0 分析：OPT 引入 / 既有未枚举的新边界（立例理由）

1. **OPT-A 反直觉**：模型 total 桶**统计被全局旁路的消费**（不按 `counted_in_*` 过滤）——易误写成漏算，单立 T-TA-3。
2. **OPT-B 安全/回归**：`floor>remaining` 被 remaining 收口不超发（T-LF-2）；`floor/percent` 全 null 与全局逐字节一致（T-LF-3）。
3. **OPT-C 写进程也吃 stale**：`markStale` 保留旧数据 + serve-stale → 连发起写的 Pod 在后台刷新前也短暂返回旧配置。**待决（T-SC-6）**：写路径是否对本 Pod 强制同步刷新。
4. **逐档跨源 max**：不同窗口由不同 source 取胜（T-RS-4）。
5. **null + 提额**：null 取胜、提额忽略（T-RS-6）；提额落在无 source 的窗口→按档惰性（T-BO-5）。
6. **counted_in 默认 true 四路径**：flag off / 无组 / fail-open / 历史行各自断言（T-PT-7 / T-FO-2）。
7. **改分组不追溯**：写入冻结，需"先消费→后改组→归属不变"序列（T-PT-6）。

### 18.1 Resolver / 合并 / 提额解析（unit）

| ID | 配置/前置 | 动作/序列 | 期望 | 覆盖 |
|---|---|---|---|---|
| T-RS-1 | opus∈g-opus | resolve(opus) | G=g-opus | §4.1/D7 |
| T-RS-2 | sonnet 不属任何组 | resolve(sonnet) | enforced=[]，两轴回退主线 | D9 |
| T-RS-3 | 个人(user,g)日$10 + tag team-a(user_group,g)日$30 | resolve | userSide 日=max(10,30)=30，bucket 按 user 自身计量 | D4/D5 |
| T-RS-4 | 个人 daily$10/weekly$100；组 daily$30/weekly$50 | resolve | daily=30(组)、weekly=100(个人)——逐档跨源取胜 | D4 |
| T-RS-5 | 仅 key(key,g)日$5；user 无配置 | resolve | keySide=5（独立 AND）；userSide=null | D3/D9 |
| T-RS-6 | 个人某档=null（无限），组该档$30 | resolve | 该档=null（无限取胜）；若有提额则被忽略 | §4.4 |
| T-RS-7 | 个人 + 两个用户组均命中 | resolve | 逐档 max over 三源 | D4 |

### 18.2 提额账本（unit + integration）

| ID | 配置/前置 | 动作/序列 | 期望 | 覆盖 |
|---|---|---|---|---|
| T-BO-1 | 无个人行、仅组限额$30 + 提额 daily+$50 期内 | resolve | personalBase=groupMax$30→eff=80→cap=max(30,80)=80 | F1 |
| T-BO-2 | 同上 boost=0 | resolve | 虚拟 source=groupMax$30，与无提额一致（无回归） | F1 |
| T-BO-3 | 无任何 source + 误授提额 | resolve | userSide=null，提额惰性、不凭空建限额 | §4.4 |
| T-BO-4 | 两条重叠有效期 +$50/+$20 | resolve | 个人档 +70（多条求和） | D10 |
| T-BO-5 | 提额 window=weekly 但无任何 weekly source | resolve | weekly 档惰性 no-op | §4.4 |
| T-BO-6 | 提额 validFrom 在未来 | now<from / now≥from 两次 | 到点 in-memory 精确生效、零延迟 | F2 |
| T-BO-7 | 提额已过期、清理前残留行 | resolve | `@>now` 兜底不误生效 | §7.1 |
| T-BO-8 | 过期 DELETE 执行后 | resolve | 行消失、不参与计算 | D12 |
| T-BO-9 | 删授予行=撤销 | publish 后 resolve | 即时撤销（pub/sub） | D14 |
| T-BO-10 | 试图给 user_group / key 提额 | API/校验 | 拒绝（仅个人用户） | D11 |

### 18.3 完全切分 / 按轴打标（integration，real PG+Redis）

| ID | 配置/前置 | 动作/序列 | 期望 | 覆盖 |
|---|---|---|---|---|
| T-PT-1 | (user,g-opus)日$30；用户全局日$10 | opus×8@$3 后 sonnet$5 | opus$24 计模型桶、counted_user=false 不污染全局；全局仅$5→sonnet 放行 | §4.8-A |
| T-PT-2 | 仅(user,g)；KeyK 全局日$8；无(key,g) | opus×3@$3 | counted_user=false、counted_key=true→第3条被 Key 全局$8 拦 | §4.8-B |
| T-PT-3 | userSide 命中（非 fail-open） | 落账 | counted_in_user_global=!bypassUser=false；counted_key=true | §5.2.4 |
| T-PT-4 | 命中后 | 全局聚合 vs 模型桶聚合 | 全局只统计 counted=true；模型桶统计全部 | §6.1 |
| T-PT-5 | 命中后 | 展示分栏 | 计入全局 + 模型组单算 = 总消费；全局额度卡"已用"只取计入全局 | §5.3/§10 |
| T-PT-6 | 先消费→模型加入组→再查 | 历史归属 | 写入冻结、不追溯重分类 | §16.1-R2 |
| T-PT-7 | flag off / 无组 / 历史行 | 落账 | counted_in_*=true（默认） | §3.6 |

### 18.4 OPT-A：模型 total 读穿缓存（integration）

| ID | 配置/前置 | 动作/序列 | 期望 | 覆盖 |
|---|---|---|---|---|
| T-TA-1 | total 模型限额$100 | 同实体连发 N 请求 | 稳态每请求 0 次 total DB 聚合（命中 `total_cost:model:*`） | OPT-A |
| T-TA-2 | 缓存未命中 | 首请求 | 查 DB + 异步写回，不阻塞请求 | OPT-A |
| T-TA-3 | userSide 命中、消费被全局旁路 | 模型 total 聚合 | **仍计入**该消费（不按 counted_in 过滤） | OPT-A 关键 |
| T-TA-4 | 累计≥$100 | 下一请求 | MODEL_TOTAL_* 错误码 + i18n | §11 |
| T-TA-5 | 缓存 TTL(300s) 过期 | 过期后请求 | 重新查 DB 并写回 | OPT-A |

### 18.5 OPT-B：lease 切片 floor / 模型 percent（unit + integration）

| ID | 配置/前置 | 动作/序列 | 期望 | 覆盖 |
|---|---|---|---|---|
| T-LF-1 | limit=$5/日，floor=$1，percent=5% | calculateLeaseSlice | slice=max($0.25,$1)=$1（floor 生效） | OPT-B |
| T-LF-2 | remaining=$0.5 < floor$1 | calculateLeaseSlice | slice=min($1,$0.5)=$0.5（被 remaining 收口、不超发） | OPT-B 安全 |
| T-LF-3 | minSliceUsd=null、模型 percent=null | calculateLeaseSlice | =limit×全局 percent（与未优化逐字节一致） | OPT-B 回归 |
| T-LF-4 | 模型 percent=20%、全局5% | refresh | 用 20%（模型覆盖全局） | OPT-B |
| T-LF-5 | floor > quotaLeaseCapUsd | calculateLeaseSlice | cap 取胜（min） | OPT-B |
| T-LF-6 | 小桶 + floor vs 无 floor | 同序列请求计 refresh 次数 | 有 floor 时 refresh 次数显著下降 | OPT-B 效果 |

### 18.6 OPT-C：快照缓存 stale-while-revalidate + pub/sub（unit + integration）

| ID | 配置/前置 | 动作/序列 | 期望 | 覆盖 |
|---|---|---|---|---|
| T-SC-1 | warm | getModelLimitSnapshot | 即时返回、0 DB | OPT-C |
| T-SC-2 | stale（有旧数据） | read | 返回旧快照 + 触发后台刷新、请求不阻塞 | OPT-C |
| T-SC-3 | 冷（data=null） | read | await 重建（仅进程首次） | OPT-C |
| T-SC-4 | pub/sub 收到失效 | 之后 read | markStale 保留旧数据、serve stale 直到刷新落地 | OPT-C |
| T-SC-5 | 并发刷新 | 多请求同时触发 | refreshPromise 去重、version 防旧刷新覆盖新失效 | OPT-C |
| T-SC-6 | 写进程本地（Option 2：写路径同步刷新） | `await publishModelLimitCacheInvalidation()` 后同 Pod read | 快照**已含**新写入行（read-your-writes、确定性断言，无时序 flaky） | OPT-C / §17.3 |
| T-SC-7 | Redis 不可用 | subscribe 失败 | 降级到 TTL、不抛异常 | OPT-C |

### 18.7 Guard / pipeline / fail-open / 互斥（unit + integration）

| ID | 配置/前置 | 动作/序列 | 期望 | 覆盖 |
|---|---|---|---|---|
| T-GD-1 | flag off | 全链路 | 与 main 逐字节一致（无 model guard） | §13/§15 |
| T-GD-2 | flag on | pipeline build | modelRateLimit 在 rateLimit 之前（insertBefore） | §5.2.1 |
| T-GD-3 | userSide 命中 | guard | bypassUserGlobalCost=true、主线 User 成本档跳过 | §5.2 |
| T-GD-4 | keySide 命中 | guard | bypassKeyGlobalCost=true | §5.2 |
| T-GD-5 | 命中任意轴 | guard | RPM/并发仍检查（不旁路） | D8 |
| T-FO-1 | Redis 故障 | 模型档 fail-open | **不置 bypass**、主线全局档仍执行（不双重放行） | §5.2 CRITICAL |
| T-FO-2 | fail-open | 落账 | counted_in_*=true（仍计入全局） | §4.8-F |
| T-FO-3 | 一档 fail-open、其余通过 | checkBucket | failOpen=true→不置 bypass | §5.2 |
| T-OF-1 | 全系统 0 组 | guard | per-model 查找前短路、0 DB/0 Redis | OPT-F |
| T-MX-1 | 加已属他组的模型 | repo/API | 唯一约束/校验报错 | D6 |
| T-SM-1 | 合并护栏（落地后常驻 CI） | 断言 seam 锚点存在 | `registerExtensionStep`/`insertBefore`/4 个 sum 签名/`checkTotalCostLimit`/`calculateLeaseSlice(minSliceUsd?)` 仍在；upstream 改名即红 | 合并计划 §6 |

### 18.8 E2E 端到端旅程（real proxy + Redis + PG）

| ID | 配置/前置 | 动作/序列 | 期望 | 覆盖 |
|---|---|---|---|---|
| T-E2E-1 | flag off | 正常代理一轮 | 行为/计量与 main 一致 | 回归 |
| T-E2E-2 | (user,g)日$30 | opus 连发至耗尽 | 第 N 条 MODEL_DAILY_*；全局额未被消耗（切分） | D13 |
| T-E2E-3 | 非对称（仅 userSide，Key 全局$8） | opus 连发 | Key 全局先拦 | §4.8-B |
| T-E2E-4 | (user,g)日$30 + 提额+$50 期内 | opus 连发；跨越有效期 | 期内上限$80、期外回$30 | D10/F2 |
| T-E2E-5 | team-a(user_group,g)日$30，U5/U7 | 两用户各发 | 各自独立$30（人均，非共享) | D5 |
| T-E2E-6 | Redis 故障注入 | opus 请求 | 模型档 fail-open + 主线全局档兜底拦截 | §5.2 |
| T-E2E-7 | (user,g)日$30 + User RPM=5 | 6 连发 | 第 6 条 RPM 拦（模型限额不旁路 RPM） | D8 |
| T-E2E-8 | total 模型$100 | 连发跨越$100 | total 缓存命中稳态、越界 MODEL_TOTAL | OPT-A |
| T-E2E-9 | **降级为 integration（已定，Option B）**：单进程 + 真 Redis pub/sub | publish 失效 → 之后 read | 订阅者 markStale 触发、下一次重建反映 DB 变更 | P-1 / OPT-C |

> **决策记录**：
> - **T-SC-6 → Option 2（写路径同步刷新）**：写 Pod 即时新鲜 + 测试确定；只在 admin 写路径，终端用户代理请求零影响（详见 §17.3）。
> - **T-E2E-9 → Option B（integration，单进程 + 真 Redis pub/sub）**：覆盖订阅接线/channel/失效→重建；pub/sub 机制已由 `provider-cache.ts` / `circuit-breaker.ts` 现网验证，真·双实例 E2E 后置/不做。
