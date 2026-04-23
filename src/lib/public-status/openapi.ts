import {
  PUBLIC_STATUS_FILTER_STATUS_VALUES,
  PUBLIC_STATUS_INCLUDE_VALUES,
  PUBLIC_STATUS_ROUTE_STATUS_VALUES,
} from "@/lib/public-status/public-api-contract";

type OpenApiLikeDocument = {
  paths?: Record<string, any>;
  tags?: Array<{ name: string; description?: string }>;
};

const PUBLIC_STATUS_TAG = {
  name: "公开状态",
  description: "面向匿名访问的状态看板与站点元数据接口",
};

const publicStatusTimelineBucketSchema = {
  type: "object",
  required: [
    "bucketStart",
    "bucketEnd",
    "state",
    "availabilityPct",
    "ttfbMs",
    "tps",
    "sampleCount",
  ],
  properties: {
    bucketStart: { type: "string", format: "date-time" },
    bucketEnd: { type: "string", format: "date-time" },
    state: {
      type: "string",
      enum: [...PUBLIC_STATUS_FILTER_STATUS_VALUES],
    },
    availabilityPct: { type: ["number", "null"] },
    ttfbMs: { type: ["number", "null"] },
    tps: { type: ["number", "null"] },
    sampleCount: { type: "number" },
  },
} as const;

const publicStatusModelSchema = {
  type: "object",
  required: [
    "publicModelKey",
    "label",
    "vendorIconKey",
    "requestTypeBadge",
    "latestState",
    "availabilityPct",
    "latestTtfbMs",
    "latestTps",
    "timeline",
  ],
  properties: {
    publicModelKey: { type: "string" },
    label: { type: "string" },
    vendorIconKey: { type: "string" },
    requestTypeBadge: { type: "string" },
    latestState: {
      type: "string",
      enum: [...PUBLIC_STATUS_FILTER_STATUS_VALUES],
    },
    availabilityPct: { type: ["number", "null"] },
    latestTtfbMs: { type: ["number", "null"] },
    latestTps: { type: ["number", "null"] },
    timeline: {
      type: "array",
      items: publicStatusTimelineBucketSchema,
    },
  },
} as const;

const publicStatusGroupSchema = {
  type: "object",
  required: ["publicGroupSlug", "displayName", "explanatoryCopy", "models"],
  properties: {
    publicGroupSlug: { type: "string" },
    displayName: { type: "string" },
    explanatoryCopy: { type: ["string", "null"] },
    models: {
      type: "array",
      items: publicStatusModelSchema,
    },
  },
} as const;

const publicStatusResponseSchema = {
  type: "object",
  required: [
    "generatedAt",
    "freshUntil",
    "status",
    "rebuildState",
    "defaults",
    "resolvedQuery",
    "meta",
    "groups",
  ],
  properties: {
    generatedAt: { type: ["string", "null"], format: "date-time" },
    freshUntil: { type: ["string", "null"], format: "date-time" },
    status: {
      type: "string",
      enum: [...PUBLIC_STATUS_ROUTE_STATUS_VALUES],
    },
    rebuildState: {
      type: "object",
      required: ["state", "hasSnapshot", "reason"],
      properties: {
        state: {
          type: "string",
          enum: ["fresh", "stale", "rebuilding", "no-data"],
        },
        hasSnapshot: { type: "boolean" },
        reason: { type: ["string", "null"] },
      },
    },
    defaults: {
      type: ["object", "null"],
      required: ["intervalMinutes", "rangeHours"],
      properties: {
        intervalMinutes: { type: "number" },
        rangeHours: { type: "number" },
      },
    },
    resolvedQuery: {
      type: "object",
      required: [
        "intervalMinutes",
        "rangeHours",
        "groupSlugs",
        "models",
        "statuses",
        "q",
        "include",
      ],
      properties: {
        intervalMinutes: { type: "number" },
        rangeHours: { type: "number" },
        groupSlugs: { type: "array", items: { type: "string" } },
        models: { type: "array", items: { type: "string" } },
        statuses: {
          type: "array",
          items: {
            type: "string",
            enum: [...PUBLIC_STATUS_FILTER_STATUS_VALUES],
          },
        },
        q: { type: ["string", "null"] },
        include: {
          type: "array",
          items: {
            type: "string",
            enum: [...PUBLIC_STATUS_INCLUDE_VALUES],
          },
        },
      },
    },
    meta: {
      type: ["object", "null"],
      required: ["siteTitle", "siteDescription", "timeZone"],
      properties: {
        siteTitle: { type: ["string", "null"] },
        siteDescription: { type: ["string", "null"] },
        timeZone: { type: ["string", "null"] },
      },
    },
    groups: {
      type: "array",
      items: publicStatusGroupSchema,
    },
  },
} as const;

const publicStatusValidationErrorSchema = {
  type: "object",
  required: ["error", "details"],
  properties: {
    error: { type: "string" },
    details: {
      type: "array",
      items: {
        type: "object",
        required: ["field", "code", "message"],
        properties: {
          field: { type: "string" },
          code: {
            type: "string",
            enum: [
              "invalid_number",
              "invalid_enum",
              "invalid_text",
              "too_many_values",
              "value_too_long",
            ],
          },
          message: { type: "string" },
          value: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

const publicSiteMetaSchema = {
  type: "object",
  required: ["available", "siteTitle", "siteDescription", "timeZone", "source"],
  properties: {
    available: { type: "boolean" },
    siteTitle: { type: ["string", "null"] },
    siteDescription: { type: ["string", "null"] },
    timeZone: { type: ["string", "null"] },
    source: {
      type: "string",
      enum: ["projection"],
    },
    reason: {
      type: "string",
      enum: ["projection_missing"],
    },
  },
} as const;

const publicSiteMetaErrorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string" },
  },
} as const;

function withPublicStatusTag(document: OpenApiLikeDocument): OpenApiLikeDocument["tags"] {
  const existingTags = document.tags ?? [];
  if (existingTags.some((tag) => tag.name === PUBLIC_STATUS_TAG.name)) {
    return existingTags;
  }

  return [...existingTags, PUBLIC_STATUS_TAG];
}

export function appendPublicStatusOpenApi(
  document: OpenApiLikeDocument | any
): OpenApiLikeDocument {
  const paths = document.paths ?? {};

  return {
    ...document,
    tags: withPublicStatusTag(document),
    paths: {
      ...paths,
      "/api/public-status": {
        get: {
          summary: "读取公开状态投影",
          description:
            "读取无需认证的公开状态投影，支持 interval、rangeHours、groupSlug/groupSlugs、model/models、status、q、include 查询参数，并返回公开安全字段。",
          tags: [PUBLIC_STATUS_TAG.name],
          security: [],
          parameters: [
            {
              name: "interval",
              in: "query",
              description:
                "时间粒度。支持整数分钟或 legacy `Xm` 形式；允许窗口为 5、15、30、60，超出时按最近值夹取。",
              required: false,
              schema: { type: "string" },
              examples: {
                numeric: { value: "15" },
                legacy: { value: "5m" },
              },
            },
            {
              name: "rangeHours",
              in: "query",
              description: "查询窗口小时数，缺省使用 projection 默认值，最终夹取到 [1, 168]。",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 168 },
              example: 24,
            },
            {
              name: "groupSlug",
              in: "query",
              description: "按单个公开分组 slug 过滤。",
              required: false,
              schema: { type: "string" },
              example: "openai",
            },
            {
              name: "groupSlugs",
              in: "query",
              description: "按逗号分隔的多个公开分组 slug 过滤。",
              required: false,
              schema: { type: "string" },
              example: "openai,anthropic",
            },
            {
              name: "model",
              in: "query",
              description: "按单个公开模型标识或展示名精确过滤。",
              required: false,
              schema: { type: "string" },
              example: "gpt-4.1",
            },
            {
              name: "models",
              in: "query",
              description: "按逗号分隔的多个公开模型标识或展示名精确过滤。",
              required: false,
              schema: { type: "string" },
              example: "gpt-4.1,claude-3.7",
            },
            {
              name: "status",
              in: "query",
              description: `按逗号分隔的状态过滤，允许值：${PUBLIC_STATUS_FILTER_STATUS_VALUES.join(", ")}。`,
              required: false,
              schema: { type: "string" },
              example: "failed,degraded",
            },
            {
              name: "q",
              in: "query",
              description: "模糊搜索公开分组名称、slug、模型展示名和模型标识。",
              required: false,
              schema: { type: "string", maxLength: 120 },
              example: "claude",
            },
            {
              name: "include",
              in: "query",
              description: `返回字段选择，逗号分隔；允许值：${PUBLIC_STATUS_INCLUDE_VALUES.join(", ")}。缺省返回全部公开字段。`,
              required: false,
              schema: { type: "string" },
              example: "meta,defaults,groups,timeline",
            },
          ],
          responses: {
            200: {
              description:
                "成功返回公开状态快照；当无快照但正在重建时，仍返回 200 并在 body 中用 status/rebuildState 明确表达。",
              content: {
                "application/json": {
                  schema: publicStatusResponseSchema,
                  examples: {
                    filteredReady: {
                      summary: "已过滤的正常响应",
                      value: {
                        generatedAt: "2026-04-23T04:00:00.000Z",
                        freshUntil: "2026-04-23T04:05:00.000Z",
                        status: "ready",
                        rebuildState: {
                          state: "fresh",
                          hasSnapshot: true,
                          reason: null,
                        },
                        defaults: {
                          intervalMinutes: 5,
                          rangeHours: 24,
                        },
                        resolvedQuery: {
                          intervalMinutes: 5,
                          rangeHours: 24,
                          groupSlugs: ["anthropic"],
                          models: [],
                          statuses: ["failed"],
                          q: "claude",
                          include: ["meta", "defaults", "groups", "timeline"],
                        },
                        meta: {
                          siteTitle: "Claude Code Hub",
                          siteDescription: "Claude Code Hub public status",
                          timeZone: "UTC",
                        },
                        groups: [
                          {
                            publicGroupSlug: "anthropic",
                            displayName: "Anthropic",
                            explanatoryCopy: "Anthropic public models",
                            models: [
                              {
                                publicModelKey: "claude-3.7",
                                label: "Claude 3.7 Sonnet",
                                vendorIconKey: "anthropic",
                                requestTypeBadge: "anthropic",
                                latestState: "failed",
                                availabilityPct: 20,
                                latestTtfbMs: 900,
                                latestTps: null,
                                timeline: [],
                              },
                            ],
                          },
                        ],
                      },
                    },
                    rebuildingWithoutSnapshot: {
                      summary: "无快照但已排队重建",
                      value: {
                        generatedAt: null,
                        freshUntil: null,
                        status: "no_snapshot",
                        rebuildState: {
                          state: "rebuilding",
                          hasSnapshot: false,
                          reason: null,
                        },
                        defaults: {
                          intervalMinutes: 5,
                          rangeHours: 24,
                        },
                        resolvedQuery: {
                          intervalMinutes: 5,
                          rangeHours: 24,
                          groupSlugs: [],
                          models: [],
                          statuses: [],
                          q: null,
                          include: ["meta", "defaults", "groups", "timeline"],
                        },
                        meta: {
                          siteTitle: null,
                          siteDescription: null,
                          timeZone: null,
                        },
                        groups: [],
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: "查询参数校验失败。",
              content: {
                "application/json": {
                  schema: publicStatusValidationErrorSchema,
                  example: {
                    error: "Invalid public status query parameters",
                    details: [
                      {
                        field: "status",
                        code: "invalid_enum",
                        message: "status must be one of: operational, degraded, failed, no_data",
                        value: "unknown",
                      },
                    ],
                  },
                },
              },
            },
            503: {
              description:
                "Redis 或投影读取不可用，且请求无法退化为 projection-missing 语义时返回。",
              content: {
                "application/json": {
                  schema: publicStatusResponseSchema,
                  example: {
                    generatedAt: null,
                    freshUntil: null,
                    status: "rebuilding",
                    rebuildState: {
                      state: "rebuilding",
                      hasSnapshot: false,
                      reason: null,
                    },
                    defaults: {
                      intervalMinutes: 5,
                      rangeHours: 24,
                    },
                    resolvedQuery: {
                      intervalMinutes: 5,
                      rangeHours: 24,
                      groupSlugs: [],
                      models: [],
                      statuses: [],
                      q: null,
                      include: ["meta", "defaults", "groups", "timeline"],
                    },
                    meta: null,
                    groups: [],
                  },
                },
              },
            },
          },
        },
      },
      "/api/public-site-meta": {
        get: {
          summary: "读取公开站点元数据投影",
          description:
            "读取无需认证的公开站点标题、描述和时区，只使用 public-status projection，不走系统设置或默认值 fallback。",
          tags: [PUBLIC_STATUS_TAG.name],
          security: [],
          responses: {
            200: {
              description: "成功返回 projection 元数据；若 projection 缺失，则 available=false。",
              content: {
                "application/json": {
                  schema: publicSiteMetaSchema,
                  examples: {
                    available: {
                      summary: "projection 可用",
                      value: {
                        available: true,
                        siteTitle: "Claude Code Hub",
                        siteDescription: "Claude Code Hub public status",
                        timeZone: "UTC",
                        source: "projection",
                      },
                    },
                    projectionMissing: {
                      summary: "projection 缺失",
                      value: {
                        available: false,
                        siteTitle: null,
                        siteDescription: null,
                        timeZone: null,
                        source: "projection",
                        reason: "projection_missing",
                      },
                    },
                  },
                },
              },
            },
            503: {
              description: "projection 读取异常。",
              content: {
                "application/json": {
                  schema: publicSiteMetaErrorSchema,
                  example: {
                    error: "Public site metadata unavailable",
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
