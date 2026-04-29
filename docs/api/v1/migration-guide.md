# Status: Deprecated — Migrating from `/api/actions/*` to `/api/v1/*`

> **Status: Deprecated.** 旧版 `POST /api/actions/{module}/{action}` 接口已进入维护期，仅供向后兼容；所有新集成请使用全新的 [Management API v1](./README.md)。
>
> 完整契约（OpenAPI 3.1）参见 [`/api/v1/openapi.json`](../../../) 与交互式文档 [`/api/v1/scalar`](../../../)。

本指南为下游工具（Web UI、第三方 SDK、CI 脚本、自定义 dashboard）提供「旧 action → 新端点」的精确映射，供一次性迁移使用。

## 通用迁移要点

1. **请求方法/路径**：旧版统一为 `POST /api/actions/{module}/{action}`，请求体放参数；新版按 REST 约定使用 `GET/POST/PATCH/PUT/DELETE`，资源路径名词化，动作以 `{resource}:{verb}` 表达（如 `:reset`、`:reveal`、`:test`）。
2. **响应信封**：旧版返回 `{ ok, data, error }`；新版直接返回数据 JSON，错误返回 RFC 9457 `application/problem+json`，并带 `errorCode` 字段。
3. **认证**：新版同时支持 `Authorization: Bearer`、`X-Api-Key`、`Cookie auth-token`，并对 cookie 通道强制 `X-CCH-CSRF`（写方法）。
4. **分页**：新版日志/会话使用 cursor 游标 (`?cursor=&pageSize=`)，model-prices catalog 使用 `?page=&limit=`。
5. **真密钥披露**：旧版多个 action 有泄漏风险；新版唯一披露入口为 `GET /api/v1/providers/{id}/key:reveal`，list/detail 一律不返回明文。

---

## 用户管理（users）

| Legacy action                               | Method  | New endpoint                                    |
| ------------------------------------------- | ------- | ----------------------------------------------- |
| `users/getUsers`                            | GET     | `/api/v1/users`                                 |
| `users/getUsersBatch`                       | GET     | `/api/v1/users` (batch query params)            |
| `users/searchUsers` / `searchUsersForFilter`| GET     | `/api/v1/users?q=...`                           |
| `users/getUsersUsageBatch`                  | GET     | `/api/v1/users` (`include=usage`)               |
| `users/getAllUserTags`                      | GET     | `/api/v1/users/tags`                            |
| `users/getAllUserKeyGroups`                 | GET     | `/api/v1/users/key-groups`                      |
| `users/addUser` / `createUserOnly`          | POST    | `/api/v1/users`                                 |
| `users/editUser`                            | PATCH   | `/api/v1/users/{id}`                            |
| `users/removeUser`                          | DELETE  | `/api/v1/users/{id}`                            |
| `users/toggleUserEnabled`                   | POST    | `/api/v1/users/{id}:enable`                     |
| `users/renewUser`                           | POST    | `/api/v1/users/{id}:renew`                      |
| `users/resetUserLimitsOnly`                 | POST    | `/api/v1/users/{id}/limits:reset`               |
| `users/resetUserAllStatistics`              | POST    | `/api/v1/users/{id}/limits:reset` (full mode)   |
| `users/getUserLimitUsage` / `getUserAllLimitUsage` | GET | `/api/v1/users/{id}` (limits embedded) / `/api/v1/admin/users/{id}/insights/overview` |
| `users/batchUpdateUsers`                    | POST    | `/api/v1/users:batchUpdate`                     |

## 密钥管理（keys）

| Legacy action               | Method  | New endpoint                              |
| --------------------------- | ------- | ----------------------------------------- |
| `keys/getKeys`              | GET     | `/api/v1/users/{userId}/keys`             |
| `keys/getKeysWithStatistics`| GET     | `/api/v1/users/{userId}/keys?include=stats` |
| `keys/addKey`               | POST    | `/api/v1/users/{userId}/keys`             |
| `keys/editKey`              | PATCH   | `/api/v1/keys/{id}`                       |
| `keys/removeKey`            | DELETE  | `/api/v1/keys/{id}`                       |
| `keys/toggleKeyEnabled`     | POST    | `/api/v1/keys/{id}:enable`                |
| `keys/renewKeyExpiresAt`    | POST    | `/api/v1/keys/{id}:renew`                 |
| `keys/resetKeyLimitsOnly`   | POST    | `/api/v1/keys/{id}/limits:reset`          |
| `keys/getKeyLimitUsage`     | GET     | `/api/v1/keys/{id}/limit-usage`           |
| `keys/batchUpdateKeys`      | POST    | `/api/v1/keys:batchUpdate` (路由模块共享) |
| `keys/patchKeyLimit`        | PATCH   | `/api/v1/keys/{id}` (limit fields)        |
| `key-quota/getKeyQuotaUsage`| GET     | `/api/v1/keys/{id}/limit-usage` 或 `/api/v1/me/quota` |

> 安全：新版仅在 `POST /api/v1/users/{userId}/keys` 创建响应中返回 `key.fullKey` 一次。后续 list/detail 永不返回明文。

## 供应商管理（providers）

| Legacy action                        | Method  | New endpoint                                    |
| ------------------------------------ | ------- | ----------------------------------------------- |
| `providers/getProviders`             | GET     | `/api/v1/providers`                             |
| `providers/getProviderStatisticsAsync`| GET    | `/api/v1/providers/health`                      |
| `providers/getAvailableProviderGroups`| GET    | `/api/v1/providers/groups`                      |
| `providers/getProviderGroupsWithCount`| GET    | `/api/v1/provider-groups`                       |
| `providers/addProvider`              | POST    | `/api/v1/providers`                             |
| `providers/editProvider`             | PATCH   | `/api/v1/providers/{id}`                        |
| `providers/removeProvider`           | DELETE  | `/api/v1/providers/{id}`                        |
| `providers/autoSortProviderPriority` | POST    | `/api/v1/providers:autoSortPriority`            |
| `providers/batchUpdateProviders`     | POST    | `/api/v1/providers:batchUpdate`                 |
| `providers/resetProviderCircuit`     | POST    | `/api/v1/providers/{id}/circuit:reset`          |
| `providers/resetProviderUsage`       | POST    | `/api/v1/providers/{id}/usage:reset`            |
| `providers/batchResetCircuits`       | POST    | `/api/v1/providers/circuits:batchReset`         |
| `providers/revealKey` (issue #1123)  | GET     | `/api/v1/providers/{id}/key:reveal`             |

## 供应商端点与厂商（provider-endpoints）

| Legacy action                              | Method  | New endpoint                                              |
| ------------------------------------------ | ------- | --------------------------------------------------------- |
| `provider-endpoints/getProviderVendors`    | GET     | `/api/v1/provider-vendors`                                |
| `provider-endpoints/getDashboardProviderVendors` | GET | `/api/v1/provider-vendors` (`include=dashboard`)         |
| `provider-endpoints/getProviderVendorById` | GET     | `/api/v1/provider-vendors/{id}`                           |
| `provider-endpoints/editProviderVendor`    | PATCH   | `/api/v1/provider-vendors/{id}`                           |
| `provider-endpoints/removeProviderVendor`  | DELETE  | `/api/v1/provider-vendors/{id}`                           |
| `provider-endpoints/getProviderEndpoints`  | GET     | `/api/v1/provider-vendors/{vendorId}/endpoints`           |
| `provider-endpoints/getProviderEndpointsByVendor` | GET | `/api/v1/provider-vendors/{vendorId}/endpoints`         |
| `provider-endpoints/getDashboardProviderEndpoints` | GET | `/api/v1/provider-vendors/{vendorId}/endpoints`        |
| `provider-endpoints/addProviderEndpoint`   | POST    | `/api/v1/provider-vendors/{vendorId}/endpoints`           |
| `provider-endpoints/editProviderEndpoint`  | PATCH   | `/api/v1/provider-endpoints/{id}`                         |
| `provider-endpoints/removeProviderEndpoint`| DELETE  | `/api/v1/provider-endpoints/{id}`                         |
| `provider-endpoints/probeProviderEndpoint` | POST    | `/api/v1/provider-endpoints/{id}:probe`                   |
| `provider-endpoints/getProviderEndpointProbeLogs` | GET | `/api/v1/provider-endpoints/{id}/probe-logs`            |
| `provider-endpoints/batchGetProviderEndpointProbeLogs` | GET | `/api/v1/provider-endpoints/{id}/probe-logs` (batch) |
| `provider-endpoints/getEndpointCircuitInfo`| GET     | `/api/v1/provider-endpoints/{id}/circuit`                 |
| `provider-endpoints/batchGetEndpointCircuitInfo` | GET | `/api/v1/provider-endpoints/{id}/circuit` (batch)         |
| `provider-endpoints/resetEndpointCircuit`  | POST    | `/api/v1/provider-endpoints/{id}/circuit:reset`           |
| `provider-endpoints/batchGetVendorTypeEndpointStats` | GET | `/api/v1/provider-vendors/{id}/endpoints` (`include=stats`) |
| `provider-endpoints/getVendorTypeCircuitInfo` | GET   | `/api/v1/provider-vendors/{id}/circuit`                   |
| `provider-endpoints/setVendorTypeCircuitManualOpen` | POST | `/api/v1/provider-vendors/{id}/circuit:manualOpen`     |
| `provider-endpoints/resetVendorTypeCircuit`| POST    | `/api/v1/provider-vendors/{id}/circuit:reset`             |

## 供应商分组（provider-groups）

| Legacy action                       | Method  | New endpoint                          |
| ----------------------------------- | ------- | ------------------------------------- |
| `provider-groups/getProviderGroups` | GET     | `/api/v1/provider-groups`             |
| `provider-groups/createProviderGroup`| POST   | `/api/v1/provider-groups`             |
| `provider-groups/updateProviderGroup`| PATCH  | `/api/v1/provider-groups/{id}`        |
| `provider-groups/deleteProviderGroup`| DELETE | `/api/v1/provider-groups/{id}`        |

## 模型价格（model-prices）

| Legacy action                                         | Method  | New endpoint                                             |
| ----------------------------------------------------- | ------- | -------------------------------------------------------- |
| `model-prices/getModelPrices`                         | GET     | `/api/v1/model-prices`                                   |
| `model-prices/getModelPricesPaginated`                | GET     | `/api/v1/model-prices?page=&limit=`                      |
| `model-prices/getAvailableModelCatalog`               | GET     | `/api/v1/model-prices/catalog`                           |
| `model-prices/getAvailableModelsByProviderType`       | GET     | `/api/v1/model-prices/catalog?providerType=...`          |
| `model-prices/hasPriceTable`                          | GET     | `/api/v1/model-prices/exists`                            |
| `model-prices/uploadPriceTable`                       | POST    | `/api/v1/model-prices:upload`                            |
| `model-prices/checkLiteLLMSyncConflicts`              | POST    | `/api/v1/model-prices:syncLitellmCheck`                  |
| `model-prices/syncLiteLLMPrices`                      | POST    | `/api/v1/model-prices:syncLitellm`                       |
| `model-prices/upsertSingleModelPrice`                 | PUT     | `/api/v1/model-prices/{modelName}`                       |
| `model-prices/deleteSingleModelPrice`                 | DELETE  | `/api/v1/model-prices/{modelName}`                       |
| `model-prices/pinModelPricingProviderAsManual`        | POST    | `/api/v1/model-prices/{modelName}/pricing/{providerType}:pinManual` |
| `model-prices/processPriceTableInternal`              | (内部) | 不公开（仅 `:upload` handler 使用）                      |

## 系统配置（system-config）

| Legacy action                              | Method  | New endpoint                  |
| ------------------------------------------ | ------- | ----------------------------- |
| `system-config/fetchSystemSettings`        | GET     | `/api/v1/system/settings`     |
| `system-config/saveSystemSettings`         | PUT     | `/api/v1/system/settings`     |
| `system-config/getServerTimeZone`          | GET     | `/api/v1/system/timezone`     |

## 通知（notifications + notification-bindings）

| Legacy action                                   | Method  | New endpoint                                    |
| ----------------------------------------------- | ------- | ----------------------------------------------- |
| `notifications/getNotificationSettingsAction`   | GET     | `/api/v1/notifications/settings`                |
| `notifications/updateNotificationSettingsAction`| PUT     | `/api/v1/notifications/settings`                |
| `notifications/testWebhookAction`               | POST    | `/api/v1/notifications/test-webhook`            |
| `notification-bindings/getBindingsForTypeAction`| GET     | `/api/v1/notifications/types/{type}/bindings`   |
| `notification-bindings/updateBindingsAction`    | PUT     | `/api/v1/notifications/types/{type}/bindings`   |

## Webhook 目标（webhook-targets）

| Legacy action                              | Method  | New endpoint                          |
| ------------------------------------------ | ------- | ------------------------------------- |
| `webhook-targets/getWebhookTargetsAction`  | GET     | `/api/v1/webhook-targets`             |
| `webhook-targets/createWebhookTargetAction`| POST    | `/api/v1/webhook-targets`             |
| `webhook-targets/updateWebhookTargetAction`| PATCH   | `/api/v1/webhook-targets/{id}`        |
| `webhook-targets/deleteWebhookTargetAction`| DELETE  | `/api/v1/webhook-targets/{id}`        |
| `webhook-targets/testWebhookTargetAction`  | POST    | `/api/v1/webhook-targets/{id}:test`   |

## 使用日志（usage-logs）与审计日志（audit-logs）

| Legacy action                            | Method  | New endpoint                                          |
| ---------------------------------------- | ------- | ----------------------------------------------------- |
| `usage-logs/getUsageLogs` / `getUsageLogsBatch` | GET | `/api/v1/usage-logs?cursor=&pageSize=`            |
| `usage-logs/getUsageLogsStats`           | GET     | `/api/v1/usage-logs/stats`                            |
| `usage-logs/getFilterOptions`            | GET     | `/api/v1/usage-logs/filter-options`                   |
| `usage-logs/getModelList` / `getStatusCodeList` / `getEndpointList` | GET | `/api/v1/usage-logs/filter-options` (子字段) |
| `usage-logs/getUsageLogSessionIdSuggestions`| GET   | `/api/v1/usage-logs/session-id-suggestions`           |
| `usage-logs/startUsageLogsExport`        | POST    | `/api/v1/usage-logs/exports`                          |
| `usage-logs/getUsageLogsExportStatus`    | GET     | `/api/v1/usage-logs/exports/{jobId}`                  |
| `usage-logs/downloadUsageLogsExport`     | GET     | `/api/v1/usage-logs/exports/{jobId}/download`         |
| `usage-logs/exportUsageLogs`             | POST    | `/api/v1/usage-logs/exports` (legacy同步导出已并入异步) |
| `audit-logs/getAuditLogsBatch`           | GET     | `/api/v1/audit-logs?cursor=&pageSize=`                |
| `audit-logs/getAuditLogDetail`           | GET     | `/api/v1/audit-logs/{id}`                             |

## 会话（active-sessions / session-response / session-origin-chain）

| Legacy action                                 | Method  | New endpoint                                          |
| --------------------------------------------- | ------- | ----------------------------------------------------- |
| `active-sessions/getActiveSessions` / `getAllSessions` | GET | `/api/v1/sessions?cursor=&pageSize=`              |
| `active-sessions/getSessionDetails`           | GET     | `/api/v1/sessions/{sessionId}`                        |
| `active-sessions/getSessionMessages` / `hasSessionMessages` | GET | `/api/v1/sessions/{sessionId}/messages`     |
| `active-sessions/getSessionRequests`          | GET     | `/api/v1/sessions/{sessionId}/requests`               |
| `active-sessions/terminateActiveSession`      | DELETE  | `/api/v1/sessions/{sessionId}`                        |
| `active-sessions/terminateActiveSessionsBatch`| POST    | `/api/v1/sessions:batchTerminate`                     |
| `session-response/getSessionResponse`         | GET     | `/api/v1/sessions/{sessionId}/response`               |
| `session-origin-chain/getSessionOriginChain`  | GET     | `/api/v1/sessions/{sessionId}/origin-chain`           |

## Dashboard（statistics / overview / 各 dashboard 模块）

| Legacy action                                         | Method  | New endpoint                                    |
| ----------------------------------------------------- | ------- | ----------------------------------------------- |
| `overview/getOverviewData`                            | GET     | `/api/v1/dashboard/overview`                    |
| `statistics/getUserStatistics`                        | GET     | `/api/v1/dashboard/statistics`                  |
| `dashboard-realtime/getDashboardRealtimeData`         | GET     | `/api/v1/dashboard/realtime`                    |
| `concurrent-sessions/getConcurrentSessions`           | GET     | `/api/v1/dashboard/concurrent-sessions`         |
| `provider-slots/getProviderSlots`                     | GET     | `/api/v1/dashboard/provider-slots`              |
| `rate-limit-stats/getRateLimitStats`                  | GET     | `/api/v1/dashboard/rate-limit-stats`            |
| `client-versions/fetchClientVersionStats`             | GET     | `/api/v1/dashboard/client-versions`             |
| `proxy-status/getProxyStatus`                         | GET     | `/api/v1/dashboard/proxy-status`                |
| `dispatch-simulator/simulateDispatchDecisionTree`     | POST    | `/api/v1/dashboard/dispatch-simulator:decisionTree` |
| `dispatch-simulator/simulateDispatchAction`           | POST    | `/api/v1/dashboard/dispatch-simulator:simulate` |

## 自助查询（my-usage → me）

| Legacy action                       | Method  | New endpoint                          |
| ----------------------------------- | ------- | ------------------------------------- |
| `my-usage/getMyUsageMetadata`       | GET     | `/api/v1/me/metadata`                 |
| `my-usage/getMyQuota`               | GET     | `/api/v1/me/quota`                    |
| `my-usage/getMyTodayStats`          | GET     | `/api/v1/me/today`                    |
| `my-usage/getMyUsageLogs` / `getMyUsageLogsBatch` | GET | `/api/v1/me/usage-logs`        |
| `my-usage/getMyUsageLogsBatchFull`  | GET     | `/api/v1/me/usage-logs/full`          |
| `my-usage/getMyAvailableModels`     | GET     | `/api/v1/me/usage-logs/models`        |
| `my-usage/getMyAvailableEndpoints`  | GET     | `/api/v1/me/usage-logs/endpoints`     |
| `my-usage/getMyStatsSummary`        | GET     | `/api/v1/me/usage-logs/stats-summary` |
| `my-usage/getMyIpGeoDetails`        | GET     | `/api/v1/me/ip-geo/{ip}`              |

## 公开状态与 IP geo

| Legacy action                                | Method  | New endpoint                                |
| -------------------------------------------- | ------- | ------------------------------------------- |
| `public-status/savePublicStatusSettings`     | PUT     | `/api/v1/public/status/settings`            |
| `GET /api/public-status` （旧专有路径）      | GET     | `/api/v1/public/status`                     |
| 自助 IP 详情（admin）                        | GET     | `/api/v1/ip-geo/{ip}`                       |

## 策略与规则（error-rules / request-filters / sensitive-words）

| Legacy action                                              | Method  | New endpoint                                      |
| ---------------------------------------------------------- | ------- | ------------------------------------------------- |
| `error-rules/listErrorRules`                               | GET     | `/api/v1/error-rules`                             |
| `error-rules/createErrorRuleAction`                        | POST    | `/api/v1/error-rules`                             |
| `error-rules/updateErrorRuleAction`                        | PATCH   | `/api/v1/error-rules/{id}`                        |
| `error-rules/deleteErrorRuleAction`                        | DELETE  | `/api/v1/error-rules/{id}`                        |
| `error-rules/refreshCacheAction`                           | POST    | `/api/v1/error-rules/cache:refresh`               |
| `error-rules/getCacheStats`                                | GET     | `/api/v1/error-rules/cache/stats`                 |
| `error-rules/testErrorRuleAction`                          | POST    | `/api/v1/error-rules:test`                        |
| `request-filters/listRequestFilters`                       | GET     | `/api/v1/request-filters`                         |
| `request-filters/createRequestFilterAction`                | POST    | `/api/v1/request-filters`                         |
| `request-filters/updateRequestFilterAction`                | PATCH   | `/api/v1/request-filters/{id}`                    |
| `request-filters/deleteRequestFilterAction`                | DELETE  | `/api/v1/request-filters/{id}`                    |
| `request-filters/refreshRequestFiltersCache`               | POST    | `/api/v1/request-filters/cache:refresh`           |
| `request-filters/listProvidersForFilterAction`             | GET     | `/api/v1/request-filters/options/providers`       |
| `request-filters/getDistinctProviderGroupsAction`          | GET     | `/api/v1/request-filters/options/groups`          |
| `sensitive-words/listSensitiveWords`                       | GET     | `/api/v1/sensitive-words`                         |
| `sensitive-words/createSensitiveWordAction`                | POST    | `/api/v1/sensitive-words`                         |
| `sensitive-words/updateSensitiveWordAction`                | PATCH   | `/api/v1/sensitive-words/{id}`                    |
| `sensitive-words/deleteSensitiveWordAction`                | DELETE  | `/api/v1/sensitive-words/{id}`                    |
| `sensitive-words/refreshCacheAction`                       | POST    | `/api/v1/sensitive-words/cache:refresh`           |
| `sensitive-words/getCacheStats`                            | GET     | `/api/v1/sensitive-words/cache/stats`             |

## 管理员-用户洞察（admin-user-insights）

| Legacy action                                       | Method  | New endpoint                                                  |
| --------------------------------------------------- | ------- | ------------------------------------------------------------- |
| `admin-user-insights/getUserInsightsOverview`       | GET     | `/api/v1/admin/users/{id}/insights/overview`                  |
| `admin-user-insights/getUserInsightsKeyTrend`       | GET     | `/api/v1/admin/users/{id}/insights/key-trend`                 |
| `admin-user-insights/getUserInsightsModelBreakdown` | GET     | `/api/v1/admin/users/{id}/insights/model-breakdown`           |
| `admin-user-insights/getUserInsightsProviderBreakdown` | GET  | `/api/v1/admin/users/{id}/insights/provider-breakdown`        |

---

## 完成迁移后

- 设置 `LEGACY_ACTIONS_DOCS_MODE=hidden` 让旧文档返回 404，避免开发者混用。
- 进一步设置 `ENABLE_LEGACY_ACTIONS_API=false`，使旧执行端点返回 410 Gone（problem+json）。
- 旧 API 计划在 `LEGACY_ACTIONS_SUNSET_DATE`（默认 `2026-12-31`）正式移除。
