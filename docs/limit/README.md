# Per-Model 限额扩展模块 — 实施计划

> [!WARNING]
> **本文档为按模型 (user/key × model) 维度的初版计划（Phase 1-5，未上线）。已被修订版方案取代。**
> 修订版引入「模型组 + 用户组」维度、`取最大值` 合并语义、临时提额，并把命中语义改为「按轴覆盖全局成本限额」，
> 详见 [`group-rate-limit.md`](./group-rate-limit.md)。
> 由于初版未上线，修订版**废弃**本文所述的 `user_model_limits` / `key_model_limits` 两表，
> 改以 `model_groups` / `model_group_members` / `user_groups` / `model_group_limits` 四表重建（单模型 = 单元素模型组）。
> 「不破坏原有逻辑」专指 `origin/main` 主线。本文保留作初版基线参考。

> 目标：在不破坏社区主线代码的前提下，为现有用户/Key 限额系统增加**按模型维度**的限额能力。
> 设计原则：新增独立模块（`src/lib/model-rate-limit/` + 对应 schema/API/UI 子路径），**原有限额逻辑零改动**；仅对 guard pipeline 做一次最小化的扩展点开放。

---

## 1. 现状摘要

现有限额体系（社区主线）：

- **数据层**（`src/drizzle/schema.ts`）：`users` / `keys` / `providers` 三张表各自携带一组**周期成本限额**列：`limit_5h_usd` / `daily_limit_usd` / `limit_weekly_usd` / `limit_monthly_usd` / `limit_total_usd`，以及 `rpm_limit`、`limit_concurrent_sessions`、`limit_5h_reset_mode`（fixed/rolling）。
- **服务层**（`src/lib/rate-limit/`）：`RateLimitService` 以 Redis 为主、PG 为兜底，存储 key 形如 `{type}:{id}:cost_{period}_{mode}`；rolling 周期用 ZSET + Lua，fixed 周期用 INCRBYFLOAT。
- **执行点**（`src/app/v1/_lib/proxy/rate-limit-guard.ts`）：在 `CHAT_PIPELINE` 中以 `rateLimit` 步骤注入，先 user 再 key、先 total 再细粒度，违规抛 `RateLimitError`。
- **Pipeline 注册表**（`src/app/v1/_lib/proxy/guard-pipeline.ts`）：`Steps` 是一个**硬编码** record，`CHAT_PIPELINE` 是固定 array。
- **特性开关**：`ENABLE_RATE_LIMIT` 控制总开关；关闭时 Redis 订阅与计数都跳过。
- **模型信息**：`session.getCurrentModel()` 返回重定向后的归一化模型名（另有 `getOriginalModel()` 为用户请求的原模型），**在 rateLimit guard 执行前已就绪**（model guard 排在更前）。
- **限额计数机制**（关键）：主线限额**已全面采用 lease 模式**——DB（`usage_ledger`）为权威用量源，Redis 存预扣"切片"，原子 Lua 扣减。检查走 `RateLimitService.checkCostLimitsWithLease()`，回填走 `response-handler.ts` 的 `trackCost()` + `decrementLeaseBudget()`（fire-and-forget）。`usage_ledger` 已含 `model` 列（`schema.ts:989`），支持按模型维度的 DB 权威聚合。

> 代码核对修正记录（本计划已对照源码核实）：
> - `GuardStep` 实际接口为 `{ name; execute(session): Promise<Response | null> }`（`guard-pipeline.ts:23`），违规通过 `throw RateLimitError` 冒泡，**非** `ensure(): void`。
> - 模型访问器是 `getCurrentModel()` / `getOriginalModel()`，**无** `getModel()`。
> - 成本回填点是 `response-handler.ts:3939`（`trackCost`）+ `:3970`（`decrementLeaseBudget`），**无 ledger 事件总线**，故 model 计数需在此挂钩（这是一处诚实的主线 diff，原 §14 漏算）。
> - `Steps` 是封闭联合类型 `Record<GuardStepKey, GuardStep>`，扩展步骤须在 `build()` 解析数组后按 name splice 注入，不能进 key map。

**痛点**：现有 5h/daily/weekly/monthly 限额是"用户总额度"，无法区分模型。同一用户对 `claude-opus-4` 与 `claude-haiku-4.5` 共享同一桶，价格悬殊导致策略粗糙。

---

## 2. 设计概要

### 2.1 范围

- 维度：`(scope_type, scope_id, model)` — 其中 `scope_type ∈ {user, key}`，model 为归一化字符串。允许通配符 `*` 兜底。
- **模型计量口径（已决策）**：按 `session.getCurrentModel()`（重定向后的实际服务模型）计量，与 `usage_ledger.model` 存储口径一致，保证 lease 的 DB 权威聚合对齐。
- 周期：复用现有 5h / daily / weekly / monthly / total 五档，及 fixed/rolling 模式；RPM 与并发**暂不纳入第一版**（避免对热路径写入造成翻倍压力）。
- **计数机制（已决策）**：复刻主线 **lease 模式**（DB 权威 + Redis 切片 + 原子 Lua 扣减），**不**采用独立 ZSET/STRING 计数（详见 §5）。
- 评估时机：在现有 `rateLimit` guard **之后** 执行新 `modelRateLimit` guard。即使新 guard 失败，原有用户/key 总额限制仍生效。
- 失败语义：复用 `RateLimitError`，新增错误码前缀 `MODEL_*`（如 `MODEL_RATE_LIMIT_DAILY_QUOTA_EXCEEDED`）。

### 2.2 模块边界

| 模块 | 路径 | 是否新建 |
|---|---|---|
| Schema | `src/drizzle/schema.ts` 中 **追加两张新表** `userModelLimits` / `keyModelLimits` | 追加，不改老列 |
| Repository (CRUD) | `src/repository/model-limit.ts` | 新建 |
| Repository (聚合) | 按模型聚合用量：`sumUserCostByModelInTimeRange` / `sumKeyCostByModelInTimeRange`（lease DB 权威源） | 新建（沿用现有 `sumUserCostInTimeRange` 加 `model` 过滤） |
| Service | `src/lib/model-rate-limit/{service,lease,keys,resolver,types}.ts`（复刻 lease，复用 `lib/rate-limit/lease.ts` 纯函数） | 新建 |
| Guard | `src/app/v1/_lib/proxy/model-rate-limit-guard.ts` | 新建 |
| Pipeline 接入 | `guard-pipeline.ts` 扩展钩子（见 §3）| 一次性最小修改 |
| 成本回填挂钩 | `response-handler.ts:3970` 的 `decrementLeaseBudget` 数组内追加 model 维度扣减（见 §7） | 一次性最小修改（flag 守卫） |
| Admin API | `src/app/api/v1/resources/model-limits/{router,handlers}.ts` + `_root/app.ts` 挂载一行 | 新建 + 一行注册 |
| Server Action | `src/actions/model-limit.ts` | 新建 |
| Dashboard UI | `src/app/[locale]/dashboard/quotas/model-limits/` | 新建子路由 |
| i18n | `messages/<locale>/quota.json` 内追加 `modelLimits` 子节 | 追加，不改老 key |
| 启动注册 | `instrumentation.ts` 的 `register()` 内触发扩展注册 | +3 行 |
| Feature flag | `ENABLE_MODEL_RATE_LIMIT` | 新增 env |

---

## 3. 与 Guard Pipeline 的集成（核心折中点）

社区主线的 `guard-pipeline.ts` 把所有步骤写死。**已决策采用方案 A**（开放扩展钩子）。方案 B（复制预设 + 入口切换）记录在文末备查，不再采用。

### 方案 A — 一次性开放扩展点（已采用，修正版）

> 修正：`Steps` 是封闭联合类型 `Record<GuardStepKey, GuardStep>`，`build()` 做 `config.steps.map(k => Steps[k])`。扩展步骤**不能**注入 key map，必须在 `build()` 解析出 `GuardStep[]` 之后、按锚点步骤的 `name` splice 注入。

```ts
// guard-pipeline.ts —— 一次性追加（约 25 行）
export interface ExtensionStep {
  key: string;                 // 唯一标识，用于幂等去重（dev 热重载）
  step: GuardStep;             // 自带 name + execute(session): Promise<Response | null>
  insertAfter: GuardStepKey;   // 锚点步骤名
}
const extensions: ExtensionStep[] = [];

export function registerExtensionStep(ext: ExtensionStep): void {
  if (extensions.some((e) => e.key === ext.key)) return; // 幂等
  extensions.push(ext);
}

// GuardPipelineBuilder.build() 内，解析数组后注入：
static build(config: GuardConfig): GuardPipeline {
  const steps: GuardStep[] = config.steps.map((k) => Steps[k]);
  for (const ext of extensions) {
    const idx = steps.findIndex((s) => s.name === ext.insertAfter);
    if (idx >= 0) steps.splice(idx + 1, 0, ext.step); // 锚点不在该 preset 则自动跳过
  }
  return {
    async run(session) {
      for (const s of steps) {
        const res = await s.execute(session);
        if (res) return res; // early exit
      }
      return null;
    },
  };
}
```

**语义红利**：只有含 `rateLimit` 的 `CHAT_PIPELINE` 才命中锚点；`RAW_PASSTHROUGH_PIPELINE` / `COUNT_TOKENS_PIPELINE` 没有 `rateLimit`，自动不挂 model 限额——无需任何额外判断，天然正确。

新模块在 `instrumentation.ts` 的 `register()`（line 243）内触发注册（见 §8），调用 `registerExtensionStep({ key: "modelRateLimit", step: ModelRateLimitGuard, insertAfter: "rateLimit" })`。

**优点**：所有未来限额扩展都走同一钩子；主线只动一次，语义清晰。
**代价**：动了主线一文件（约 +25 行），不能称"零修改"，但量极小。重构 `guard-pipeline.ts` 时须保持该公开钩子向后兼容（写一行单测固化）。

---

#### 备查：方案 B（已否决）

复制预设 `CHAT_PIPELINE_WITH_MODEL_LIMIT = [...CHAT_PIPELINE, "modelRateLimit"]` + 在 `proxy-handler.ts` 入口按 flag 切换。否决理由：仍需改 `proxy-handler.ts`，且 `modelRateLimit` 仍需进 `Steps`/`GuardStepKey`（封闭联合）才能被预设引用，反而比方案 A 改动更多；叠加未来扩展时复制成本递增。

---

## 4. 数据库 Schema

新增两张表（drizzle 写法），不动 `users` / `keys`：

```ts
// src/drizzle/schema.ts —— 追加在 keys/users 表后
export const userModelLimits = pgTable("user_model_limits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  model: varchar("model", { length: 128 }).notNull(), // "*" = 兜底
  rpmLimit: integer("rpm_limit"),                     // 预留，第一版不强制
  dailyLimitUsd: numeric("daily_limit_usd", { precision: 10, scale: 2 }),
  limit5hUsd: numeric("limit_5h_usd", { precision: 10, scale: 2 }),
  limit5hResetMode: dailyResetModeEnum("limit_5h_reset_mode").default("fixed"),
  limitWeeklyUsd: numeric("limit_weekly_usd", { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric("limit_monthly_usd", { precision: 10, scale: 2 }),
  limitTotalUsd: numeric("limit_total_usd", { precision: 10, scale: 2 }),
  limit5hCostResetAt: timestamp("limit_5h_cost_reset_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniqUserModel: uniqueIndex("user_model_limits_user_model_idx").on(t.userId, t.model),
  byUser: index("user_model_limits_user_idx").on(t.userId),
}));

export const keyModelLimits = pgTable("key_model_limits", {
  // 同上结构，外键 keyId -> keys.id
});
```

**迁移流程**：按 CLAUDE.md 规定走 `bun run db:generate` → review 生成文件 → `bun run db:migrate`；生成后立即跑 `bun run validate:migrations`。

**冲突解析顺序**（运行时）：
1. `keyModelLimits(keyId, model)` 命中 → 用之
2. 否则 `keyModelLimits(keyId, "*")` 命中 → 用之
3. 否则 `userModelLimits(userId, model)` 命中 → 用之
4. 否则 `userModelLimits(userId, "*")` 命中 → 用之
5. 否则不限制（继续走主线限额）

---

## 5. 计数机制 — lease 复刻（已决策）

**决策**：复刻主线 lease 模式，**不**采用独立 ZSET/STRING 计数。理由：(1) 并发安全性已在主线验证（原子 Lua 扣减）；(2) `usage_ledger.model` 列已支持 DB 权威按模型聚合，无需另建权威源；(3) 避免独立计数器与 DB 漂移。

### 5.1 数据流（与主线一致，加 model 维度）

```
检查（guard）：读 Redis lease 切片 → 缺失则查 DB 聚合(sumXxxCostByModelInTimeRange) → 切片写回 Redis → 原子 Lua 扣减判断越界
回填（response-handler）：trackCost 落 usage_ledger（已有 model 列）+ decrementLeaseBudget(model 维度) fire-and-forget
```

### 5.2 Redis lease key（加 model 段，与主线 `lease:` 前缀分隔）

```
lease:user-model:{userId}:{modelHash}:5h:{resetMode}
lease:user-model:{userId}:{modelHash}:daily:{resetMode}
lease:user-model:{userId}:{modelHash}:weekly
lease:user-model:{userId}:{modelHash}:monthly
lease:key-model:{keyId}:{modelHash}:...
```

- `modelHash` = `sha1(normalizedModel).slice(0,16)`，避免 `/`、`:` 等字符污染 key。原始 model 字符串落表，hash 仅作 Redis key。
- `lease:user-model:` / `lease:key-model:` 前缀与主线 `lease:user:` / `lease:key:` 完全分隔，互不踩。
- total 维度不走 lease 窗口（无窗口 TTL），直接查 DB 聚合 `usage_ledger` 比对 `limitTotalUsd`，与主线 `checkTotalCostLimit` 一致。

### 5.3 复用与新建

- **复用**（`src/lib/rate-limit/lease.ts` 纯函数，无副作用）：`calculateLeaseSlice` / `serializeLease` / `deserializeLease` / `isLeaseExpired`。
- **新建** `src/lib/model-rate-limit/lease.ts`：`ModelLeaseService`，平行于 `LeaseService`，内部走同一"读切片→查 DB→扣减"流程，但 DB 源换成按模型聚合查询。
- **新建** repository 聚合：`sumUserCostByModelInTimeRange(userId, model, start, end)` / `sumKeyCostByModelInTimeRange(keyId, model, start, end)`，即现有 `sumUserCostInTimeRange` 加 `AND model = ?`。
- Redis 故障时 fail-open（`MODEL_RATE_LIMIT_FAIL_OPEN`，与主线一致）。

---

## 6. 模块文件清单与职责

```
src/lib/model-rate-limit/
├── keys.ts              # Redis lease key 构造 + modelHash
├── lease.ts             # ModelLeaseService：复刻 LeaseService，复用 rate-limit/lease.ts 纯函数
├── service.ts           # ModelRateLimitService：checkCostLimitsWithLease() / decrementLease()
├── resolver.ts          # 限额查找：4 级冲突解析
├── register.ts          # registerModelRateLimitExtension() → 调 registerExtensionStep()
└── types.ts             # 限额 DTO + flag 读取（isModelRateLimitEnabled）

src/app/v1/_lib/proxy/
└── model-rate-limit-guard.ts   # execute(session): Promise<Response|null>，越界 throw RateLimitError

src/repository/
├── model-limit.ts       # CRUD：findByUser / findByKey / upsert / delete
└── (聚合查询)            # sumUserCostByModelInTimeRange / sumKeyCostByModelInTimeRange
                          #   就近放在现有 sum*CostInTimeRange 所在文件，加 model 过滤

src/actions/
└── model-limit.ts       # "use server" — ActionResult 包装

src/app/api/v1/resources/model-limits/
├── handlers.ts          # listForUser / listForKey / upsert / delete
└── router.ts            # Zod-OpenAPI Hono router；挂载到 /api/v1/resources/model-limits

src/app/[locale]/dashboard/quotas/model-limits/
├── page.tsx             # 列表 + 筛选（用户/Key）
└── _components/
    ├── ModelLimitTable.tsx
    ├── EditModelLimitDialog.tsx
    └── BulkImportDialog.tsx  # 可选：CSV 批量导入

messages/<locale>/quota.json
└── 追加 "modelLimits": { ... }   # 5 个语言文件同步

tests/unit/proxy/model-rate-limit-guard.test.ts
tests/unit/lib/model-rate-limit/service.test.ts
tests/unit/repository/model-limit.test.ts
tests/integration/model-rate-limit.test.ts
```

---

## 7. Guard 实现要点

### 7.1 Guard（修正签名：`execute` 返回 `Response | null`，越界 throw）

```ts
// model-rate-limit-guard.ts
import type { GuardStep } from "./guard-pipeline";
import type { ProxySession } from "./session";

export const ModelRateLimitGuard: GuardStep = {
  name: "modelRateLimit",
  async execute(session: ProxySession): Promise<Response | null> {
    if (!isModelRateLimitEnabled()) return null;
    const user = session.authState?.user;
    const key = session.authState?.key;
    const model = session.getCurrentModel();   // 修正：非 getModel；按实际服务模型计量
    if (!user || !model) return null;

    const limit = await resolveModelLimit({ userId: user.id, keyId: key?.id, model });
    if (!limit) return null;  // 4 级查找均未命中 → 不限制（向后兼容）

    // 越界时内部 throw RateLimitError（前缀 MODEL_*），由 pipeline 冒泡至 proxy-handler
    await ModelRateLimitService.checkCostLimitsWithLease(limit, model);
    return null;
  },
};
```

**注意**：
- 与主线一致用 **lease** 模式（`checkCostLimitsWithLease`），避免"先 check 后 record"的并发越界。
- 违规通过 `throw RateLimitError` 传播——这与主线 `rateLimit` 步骤一致（pipeline `run()` 不 catch，交 proxy-handler 统一处理）。`execute` 正常路径返回 `null`。

### 7.2 成本回填挂钩（修正：这是真实主线 diff，原 §14 漏算）

回填点在 `response-handler.ts:3970` 现有 `decrementLeaseBudget` 的 `Promise.all` 数组。在其中**追加 model 维度扣减**（fire-and-forget，与现有最终一致性级别相同）：

```ts
// response-handler.ts ~3970，在现有 Promise.all([...]) 数组内追加（flag 守卫）
...(isModelRateLimitEnabled() && model
  ? [
      ModelRateLimitService.decrementLease(user.id, "user", model, costFloat),
      ...(key ? [ModelRateLimitService.decrementLease(key.id, "key", model, costFloat)] : []),
    ]
  : []),
```

- `model` 取该处已可得的实际服务模型（与 `usage_ledger.model` 落库口径一致）。
- `ENABLE_MODEL_RATE_LIMIT=false` 时数组为空 → **零行为变化**。
- DB 权威源始终是 `usage_ledger`（已含 model 列），即便 Redis 扣减失败，下次检查会从 DB 聚合重建切片，最终一致。

---

## 8. 配置与开关

`.env.example` 追加（不改老变量）：

```bash
# Per-model rate limit
ENABLE_MODEL_RATE_LIMIT=false   # 默认关闭；依赖 ENABLE_RATE_LIMIT=true
MODEL_RATE_LIMIT_FAIL_OPEN=true # Redis 故障时 fail-open（与主线一致）
```

读取位置：`src/lib/model-rate-limit/types.ts` 的 `isModelRateLimitEnabled()`；guard 入口与回填挂钩均先判 flag。

**启动注册（修正：用 `register()` hook）**：`instrumentation.ts:243` 是 `export async function register()`，已有 `globalThis.__CCH_*` 幂等守卫模式。在其内部触发，比顶层副作用 import 更符合现有约定：

```ts
// instrumentation.ts register() 内
const { registerModelRateLimitExtension } = await import("@/lib/model-rate-limit/register");
registerModelRateLimitExtension(); // 内部调 registerExtensionStep({ key, step, insertAfter: "rateLimit" })
```

---

## 9. Admin REST API

新路由（不动现有路由文件）：

```
GET    /api/v1/resources/model-limits/users/:userId
POST   /api/v1/resources/model-limits/users/:userId      # upsert (model in body)
DELETE /api/v1/resources/model-limits/users/:userId/:model

GET    /api/v1/resources/model-limits/keys/:keyId
POST   /api/v1/resources/model-limits/keys/:keyId
DELETE /api/v1/resources/model-limits/keys/:keyId/:model
```

- 复用现有 admin auth 中间件；遵循 `src/app/api/v1/resources/<name>/{router.ts, handlers.ts}` 结构（参考 `resources/keys/`）
- 用 zod-openapi 描述请求/响应 schema，跑 `bun run openapi:generate` + `bun run openapi:lint` 通过
- **挂载点（精确）**：`src/app/api/v1/_root/app.ts`，按现有 `app.route("/", keysRouter)`（`app.ts:155`）模式追加一行 `app.route("/", modelLimitsRouter)`

---

## 10. Dashboard UI

新路由：`/dashboard/quotas/model-limits`，从 quotas 主导航增加入口。

- **列表视图**：表格列 = `Scope | Subject | Model | 5h | Daily | Weekly | Monthly | Total | Reset Mode | Updated`
- **筛选**：按用户/Key、按模型名搜索
- **编辑**：弹窗表单，与现有 user-quota 编辑形态一致；调用新 Server Action
- **批量导入**：第二阶段再做，先留按钮 disabled

i18n 键示例（`messages/<locale>/quota.json` 追加）：

```json
"modelLimits": {
  "title": "按模型限额",
  "scope": { "user": "用户", "key": "Key" },
  "table": { "model": "模型", "fiveHour": "5 小时", ... },
  "dialog": { "addModel": "新增模型限额", "wildcardHint": "* 表示兜底" }
}
```

5 语言文件 (`zh-CN`, `zh-TW`, `en`, `ja`, `ru`) 同步；提交前跑：
- `bun run i18n:audit-placeholders:fail`
- `bun run i18n:audit-messages-no-emoji:fail`

---

## 11. 测试策略

| 层级 | 文件 | 关键断言 |
|---|---|---|
| Unit / Service | `tests/unit/lib/model-rate-limit/service.test.ts` | 5 个周期分别越界抛 `RateLimitError`；fail-open 行为 |
| Unit / Resolver | `tests/unit/lib/model-rate-limit/resolver.test.ts` | 4 级冲突解析顺序正确，通配符 `*` 命中 |
| Unit / Guard | `tests/unit/proxy/model-rate-limit-guard.test.ts` | flag 关闭时直接通过；session 缺 user/model 时不报错 |
| Unit / Repository | `tests/unit/repository/model-limit.test.ts` | upsert 唯一索引、cascade 删除 |
| Integration | `tests/integration/model-rate-limit.test.ts` | 真实 Redis + PG 跑完一轮 lease/record/越界 |
| Security | 复用现有 auth rate-limit 套路，校验越权访问 admin API |

目标覆盖 ≥ 80%（与 CLAUDE.md Critical Rule 2 对齐），跑 `bun run test:coverage` 验证。

---

## 12. 分阶段实施清单

### Phase 1 — Schema & Service（无 UI 价值，先打地基）
- [ ] schema.ts 追加 `userModelLimits` / `keyModelLimits`
- [ ] `bun run db:generate` → review → `bun run db:migrate` → `bun run validate:migrations`
- [ ] repository 聚合查询 `sumUserCostByModelInTimeRange` / `sumKeyCostByModelInTimeRange`（加 model 过滤）+ 单测
- [ ] `src/repository/model-limit.ts`（CRUD + transformer）+ 单测
- [ ] `src/lib/model-rate-limit/` 全套（keys/lease/resolver/service/types，复用 `rate-limit/lease.ts` 纯函数）+ 单测
- [ ] **不接入 pipeline**，仅暴露 service API

### Phase 2 — Pipeline 接入 + 回填挂钩
- [ ] `guard-pipeline.ts` 增加 `registerExtensionStep()` 钩子 + `build()` splice 注入（方案 A）
- [ ] `model-rate-limit-guard.ts` 实现（`execute` 签名，越界 throw）
- [ ] `register.ts` 在 `instrumentation.ts` 的 `register()` 内 import 触发注册
- [ ] **`response-handler.ts:3970` 追加 model 维度 `decrementLease`（flag 守卫）**
- [ ] `ENABLE_MODEL_RATE_LIMIT` 默认 false，灰度开启
- [ ] 一行单测固化扩展钩子向后兼容（防主线重构回归）
- [ ] 集成测试通过（lease 检查 + 回填 + 越界一轮）

### Phase 3 — Admin API
- [ ] `/api/v1/resources/model-limits/{handlers,router}.ts`
- [ ] 挂载到主 OpenAPI 注册点
- [ ] `bun run openapi:check` + `bun run openapi:lint` 通过
- [ ] `bun run test:v1` 覆盖新端点

### Phase 4 — Dashboard UI
- [ ] `/dashboard/quotas/model-limits/page.tsx` + 组件
- [ ] 5 语言 i18n 落地，过 i18n audit
- [ ] Server Action 包装 + ActionResult 错误展示

### Phase 5 — 文档与上线
- [ ] `docs/api/` 补充新端点说明
- [ ] CHANGELOG 增加条目
- [ ] PR 目标分支 `dev`，按 CONTRIBUTING.md 走 squash-merge

---

## 13. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Redis 写放大（每请求多写一组 key） | Phase 1 加 micro-benchmark；超阈值时改异步合并写入 |
| 与主线 limit 同时违规导致错误消息歧义 | Error code 加 `MODEL_*` 前缀；UI 区分展示 |
| 通配符限额与具体限额叠加语义混乱 | 解析器**只取最具体的一条**（4 级顺序短路） |
| 主线后续重构 `guard-pipeline.ts` | 方案 A 的扩展钩子是公开 API，重构时需保持向后兼容；写一行单测固化 |
| 老用户没有 model 限额配置 | 解析器返回 null → 完全跳过，行为与现在一致，向后兼容 |
| 上游同步主线变更冲突 | 所有新增文件路径独立；diff 仅集中在 schema.ts 追加 + guard-pipeline.ts 钩子 + OpenAPI 注册一行 |

---

## 14. 主线最小 diff 估算

| 文件 | 修改行数 | 类型 |
|---|---|---|
| `src/drizzle/schema.ts` | +50 | 追加表定义 |
| `src/app/v1/_lib/proxy/guard-pipeline.ts` | +25 | 扩展钩子 + `build()` splice（方案 A） |
| `src/app/v1/_lib/proxy/response-handler.ts` | **+8** | **model 维度 lease 扣减（flag 守卫）—— 原 §14 漏算** |
| `src/instrumentation.ts` | +3 | `register()` 内触发扩展注册 |
| `src/app/api/v1/_root/app.ts` | +2 | 挂新路由 `app.route("/", modelLimitsRouter)` |
| repository 聚合查询所在文件 | +追加函数 | `sum*CostByModelInTimeRange`（加 model 过滤，不改老查询） |
| `messages/<locale>/quota.json` × 5 | +追加 sub-tree | 不改老 key |
| `.env.example` | +2 | 追加新变量 |

**合计主线侵入约 90 行追加、0 行删除/改写**（其中 `response-handler.ts` +8 是诚实计入的回填挂钩，flag 关闭时零行为变化）。其余约 90% 工作量落在新建独立文件。

---

## 15. 验收标准

- [ ] `ENABLE_MODEL_RATE_LIMIT=false` 时整套行为与主线完全一致（回归测试通过）
- [ ] `ENABLE_MODEL_RATE_LIMIT=true` 且未配置任何 model 限额时，请求路径无可观察差异
- [ ] 配置后命中 5h/daily/weekly/monthly/total 越界均返回正确错误码与 i18n 消息
- [ ] 单测覆盖率 ≥ 80%，`bun run test:coverage` 通过
- [ ] OpenAPI lint、i18n audit、typecheck、build 全绿
- [ ] Dashboard 可视化创建、编辑、删除一条 user/key × model 限额

---

## 16. 决策记录（已拍板）

1. **方案 A vs B** → **采用方案 A**（`guard-pipeline.ts` 扩展钩子 + `build()` splice，约 +25 行）。方案 B 否决（见 §3 备查）。
2. **模型计量口径** → 按 **`getCurrentModel()`**（实际服务模型，对齐 `usage_ledger.model`）。
3. **计数机制** → **复刻 lease 模式**（DB 权威 + Redis 切片 + 原子扣减），不用独立计数器。
4. **RPM / 并发** → **第一版不纳入**（热路径写放大成本高），放 v2。
5. **通配符语义** → 第一版仅支持精确匹配 + 全兜底 `*`，前缀匹配（`claude-opus-*`）放 v2。
6. **历史 usage 回填** → **不回放**，新限额自激活时刻起计（lease 首次检查会从 `usage_ledger` 聚合当前窗口用量，行为与现有 weekly/monthly 一致）。
7. **Provider 维度**（`provider × model`）→ 放 v2。
