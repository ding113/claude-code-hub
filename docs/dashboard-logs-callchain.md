# Dashboard Logs（Usage Logs）入口与调用链盘点

本文用于锁定 `/dashboard/logs` 的真实入口与关键调用链边界，避免后续需求实现与验收口径跑偏。

## 1) 路由入口（Server）

- 路由：`/dashboard/logs`
- 入口页面：`src/app/[locale]/dashboard/logs/page.tsx`
  - 登录态校验：`getSession()`（未登录重定向到 `/login`）
  - 数据区块入口：`UsageLogsDataSection`（`src/app/[locale]/dashboard/logs/_components/usage-logs-sections.tsx`）

## 2) 真实渲染链路（Client）

当前页面实际使用“虚拟列表”链路：

- 虚拟列表入口：`UsageLogsViewVirtualized`（`src/app/[locale]/dashboard/logs/_components/usage-logs-view-virtualized.tsx`）
  - URL -> filters 解析：`parseLogsUrlFilters()`（`src/app/[locale]/dashboard/logs/_utils/logs-query.ts`）
  - filters -> URL 回填：`buildLogsUrlQuery()`（`src/app/[locale]/dashboard/logs/_utils/logs-query.ts`）
  - Filters 面板：`UsageLogsFilters`
  - 列表：`VirtualizedLogsTable`
  - 统计面板：`UsageLogsStatsPanel`

仓库内仍存在“非虚拟表格”实现（目前不被路由引用，属于历史/备用路径）：

- `UsageLogsView`（`src/app/[locale]/dashboard/logs/_components/usage-logs-view.tsx`）
- `UsageLogsTable`（`src/app/[locale]/dashboard/logs/_components/usage-logs-table.tsx`）

## 3) 过滤器 / URL / 时间语义

- URL 参数解析/构建（统一入口）：`src/app/[locale]/dashboard/logs/_utils/logs-query.ts`
  - `sessionId`：字符串（trim 后空值不落盘）
  - `startTime/endTime`：毫秒时间戳
- 秒级时间工具：`src/app/[locale]/dashboard/logs/_utils/time-range.ts`
  - UI endTime 为“包含式”秒；对后端转换为“排他上界”（`endExclusive = endInclusive + 1s`）
  - 后端查询语义保持：`created_at >= startTime` 且 `created_at < endTime`

## 4) 数据获取链路（Actions -> Repository）

### 列表（无限滚动）

- Action：`src/actions/usage-logs.ts#getUsageLogsBatch`
- Repo：`src/repository/usage-logs.ts#findUsageLogsBatch`

### 统计（折叠面板按需加载）

- Action：`src/actions/usage-logs.ts#getUsageLogsStats`
- Repo：`src/repository/usage-logs.ts#findUsageLogsStats`

### 导出 CSV

- Action：`src/actions/usage-logs.ts#exportUsageLogs`
- Repo：`src/repository/usage-logs.ts#findUsageLogsWithDetails`
- CSV 生成：`src/actions/usage-logs.ts#generateCsv`

### Session ID 联想（候选查询）

- Action：`src/actions/usage-logs.ts#getUsageLogSessionIdSuggestions`
- Repo：`src/repository/usage-logs.ts#findUsageLogSessionIdSuggestions`

## 5) 本需求相关影响面（文件/符号清单）

**前端（logs 页面内聚）**：

- URL/过滤器：`src/app/[locale]/dashboard/logs/_utils/logs-query.ts`
- 秒级时间：`src/app/[locale]/dashboard/logs/_utils/time-range.ts`
- 过滤器 UI：`src/app/[locale]/dashboard/logs/_components/usage-logs-filters.tsx`
- 虚拟列表：`src/app/[locale]/dashboard/logs/_components/virtualized-logs-table.tsx`
- 非虚拟表格：`src/app/[locale]/dashboard/logs/_components/usage-logs-table.tsx`
- 统计面板：`src/app/[locale]/dashboard/logs/_components/usage-logs-stats-panel.tsx`

**后端（Actions/Repo）**：

- Actions：`src/actions/usage-logs.ts`
  - `getUsageLogsBatch/getUsageLogsStats/exportUsageLogs/getUsageLogSessionIdSuggestions`
- Repo：`src/repository/usage-logs.ts`
  - `findUsageLogsBatch/findUsageLogsWithDetails/findUsageLogsStats/findUsageLogSessionIdSuggestions`

**i18n（用户可见文案）**：

- `messages/*/dashboard.json`（`dashboard.logs.filters.*` / `dashboard.logs.columns.*`）

## 6) 边界说明（在范围内 / 不在范围内）

在范围内（本次需求直接相关）：

- `sessionId` 精确筛选 + URL 回填 + UI 展示（列/复制/tooltip）
- 秒级时间输入与 `endExclusive` 语义对齐（`< endTime`）
- Session ID 联想（最小成本：minLen + debounce + limit）

不在范围内（需另开 issue/评审确认后再做）：

- 针对联想查询的索引/物化/离线表（优化类工程）
- 改动数据库 schema 或迁移
- Logs 页面其它过滤项语义调整（非本需求验收口径）

