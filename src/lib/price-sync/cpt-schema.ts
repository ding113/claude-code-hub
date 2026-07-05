/**
 * CCHP Cloud Pricing Table (CPT) v1 schema types and parser.
 *
 * Source: https://cch-plus.com/pricing/v1/models.json
 * Schema: https://cch-plus.com/pricing/v1/models.schema.json
 *
 * All prices are decimal strings to avoid float ambiguity; the converter
 * (cpt-convert.ts) parses them into per-token numbers for internal billing.
 */

export const CPT_SCHEMA_ID = "cchp.pricing-table/v1";

export type CptChargeUnit =
  | "per_M_characters"
  | "per_M_tokens"
  | "per_M_tokens_per_hour"
  | "per_image"
  | "per_k_calls"
  | "per_request"
  | "per_second";

export interface CptCharge {
  price: string;
  unit: CptChargeUnit;
  currency?: string;
}

export interface CptTrackTrigger {
  kind: "body_matches" | "endpoint_matches" | "header_matches" | "input_tokens_above";
  field?: string;
  header?: string;
  pattern?: string;
  threshold?: number;
  inclusive?: boolean;
}

export interface CptTrack {
  label: string;
  factor: string;
  charge_factors?: Record<string, string>;
  triggers: CptTrackTrigger[];
}

export interface CptPricingVariant {
  provider: string;
  official: boolean;
  source: string;
  provider_model_id?: string;
  region?: string | null;
  charges: Record<string, CptCharge>;
  tracks?: CptTrack[] | null;
  finetune_charges?: Record<string, CptCharge>;
}

export interface CptModelEntry {
  slug: string;
  model_name: string;
  vendor: string;
  display_name: string;
  aliases?: string[];
  family?: string;
  model_type?: string | null;
  intro?: string;
  intro_i18n?: Record<string, string>;
  knowledge_cutoff?: string;
  released_at?: string;
  deprecated?: boolean;
  deprecation_date?: string;
  status?: string;
  docs_url?: string;
  max_input_tokens?: number;
  max_output_tokens?: number;
  capabilities?: Record<string, boolean>;
  modalities?: { input?: string[]; output?: string[] };
  pricing: CptPricingVariant[];
  rate_limits?: { rpm?: number; tpm?: number };
  reasoning_config?: { budget_min?: number; mandatory?: boolean };
  benchmarks?: Record<string, number | null>;
}

export interface CptProviderInfo {
  name: string;
  doc?: string;
  icon?: string;
  icon_mono?: boolean;
}

export interface CptTable {
  schema: typeof CPT_SCHEMA_ID;
  version: string;
  currency: string;
  refreshed_at: string;
  models: CptModelEntry[];
  providers: Record<string, CptProviderInfo>;
}

export type CptParseResult = { ok: true; data: CptTable } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判断一个已解析的 JSON 值是否为 CPT v1 价格表(用于上传格式嗅探) */
export function isCptTableLike(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.schema === CPT_SCHEMA_ID && Array.isArray(value.models);
}

/**
 * 解析并校验 CPT v1 价格表 JSON 文本。
 * 只做结构级校验(必填字段/类型),字段内容的健壮性由转换器兜底。
 */
export function parseCptTable(jsonText: string): CptParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `价格表 JSON 解析失败: ${message}` };
  }
  return parseCptTableValue(parsed);
}

/** 同 parseCptTable,但接受已解析的 JSON 值(用于上传路径复用) */
export function parseCptTableValue(parsed: unknown): CptParseResult {
  if (!isRecord(parsed)) {
    return { ok: false, error: "价格表格式无效：根节点不是对象" };
  }

  if (parsed.schema !== CPT_SCHEMA_ID) {
    return {
      ok: false,
      error: `价格表格式无效：schema 不是 ${CPT_SCHEMA_ID}（实际为 ${String(parsed.schema)}）`,
    };
  }

  if (!Array.isArray(parsed.models)) {
    return { ok: false, error: "价格表格式无效：缺少 models 数组" };
  }

  if (!isRecord(parsed.providers)) {
    return { ok: false, error: "价格表格式无效：缺少 providers 字典" };
  }

  const models: CptModelEntry[] = [];
  for (const entry of parsed.models) {
    if (!isRecord(entry)) continue;
    if (typeof entry.model_name !== "string" || !entry.model_name.trim()) continue;
    if (typeof entry.slug !== "string" || !entry.slug.trim()) continue;
    if (typeof entry.vendor !== "string" || !entry.vendor.trim()) continue;
    if (!Array.isArray(entry.pricing)) continue;
    models.push(entry as unknown as CptModelEntry);
  }

  if (models.length === 0) {
    return { ok: false, error: "价格表格式无效：models 为空" };
  }

  const providers: Record<string, CptProviderInfo> = Object.create(null);
  for (const [slug, info] of Object.entries(parsed.providers)) {
    if (slug === "__proto__" || slug === "constructor" || slug === "prototype") continue;
    if (!isRecord(info) || typeof info.name !== "string") continue;
    providers[slug] = info as unknown as CptProviderInfo;
  }

  return {
    ok: true,
    data: {
      schema: CPT_SCHEMA_ID,
      version: typeof parsed.version === "string" ? parsed.version : "",
      currency: typeof parsed.currency === "string" ? parsed.currency : "USD",
      refreshed_at: typeof parsed.refreshed_at === "string" ? parsed.refreshed_at : "",
      models,
      providers,
    },
  };
}
