/**
 * CPT v1 -> 内部 ModelPriceData 转换器。
 *
 * 新云端价格表以「模型 x 多 provider 报价 x 价格轨道」组织,价格为 decimal 字符串
 * (per_M_tokens 等单位);内部计费管线使用 per-token 的 number 字段。本模块将
 * 每个模型转换为一条以裸模型名(canonical model_name)为键的 ModelPriceData:
 * - 顶层字段来自默认报价(第一个 official 变体,否则第一个变体)
 * - pricing 映射保留每个 provider 变体的转换结果(多来源价格选择/对比/固化用)
 * - tracks 中可识别的分层(>200K / >272K / priority 服务档)映射为既有分层字段
 */
import { iconFileForVendor, type VendorIconFileEntry } from "@/lib/model-vendor/vendor-icon-files";
import { vendorDisplayName } from "@/lib/model-vendor/vendor-inference";
import type { ModelPriceData } from "@/types/model-price";
import type {
  CptCharge,
  CptModelEntry,
  CptPricingVariant,
  CptProviderInfo,
  CptTable,
  CptTrack,
  CptTrackTrigger,
} from "./cpt-schema";

const MILLION = 1_000_000;

/** 追踪阈值的容差归一:200000/200001 视为 200K,272000/272001 视为 272K */
const TIER_200K_MIN = 200000;
const TIER_200K_MAX = 200001;
const TIER_272K_MIN = 272000;
const TIER_272K_MAX = 272001;

export interface CloudVendorSummary {
  vendor: string;
  name: string;
  icon?: string;
  iconMono?: boolean;
  modelCount: number;
}

export interface ConvertedCptTable {
  models: Record<string, ModelPriceData>;
  vendors: CloudVendorSummary[];
  providers: Record<string, CptProviderInfo>;
  version: string;
  currency: string;
  refreshedAt: string;
}

function parseDecimal(value: string | undefined): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 浮点乘算后收敛精度,避免 0.1*3 之类的长尾污染存储 */
function roundPrecision(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value === 0) return 0;
  return Number(value.toPrecision(12));
}

type ChargeFieldTarget = { kind: "per_token"; field: string } | { kind: "scalar"; field: string };

/** per_M_tokens 计费维度 -> 内部 per-token 字段 */
const TOKEN_CHARGE_FIELDS: Record<string, string> = {
  prompt: "input_cost_per_token",
  completion: "output_cost_per_token",
  cache_read: "cache_read_input_token_cost",
  cache_write: "cache_creation_input_token_cost",
  cache_write_1h: "cache_creation_input_token_cost_above_1hr",
};

/** 分层轨道可映射的计费维度 -> 200K/272K 字段名 */
const TIER_FIELD_BY_CHARGE: Record<string, { above200k: string; above272k: string }> = {
  prompt: {
    above200k: "input_cost_per_token_above_200k_tokens",
    above272k: "input_cost_per_token_above_272k_tokens",
  },
  completion: {
    above200k: "output_cost_per_token_above_200k_tokens",
    above272k: "output_cost_per_token_above_272k_tokens",
  },
  cache_read: {
    above200k: "cache_read_input_token_cost_above_200k_tokens",
    above272k: "cache_read_input_token_cost_above_272k_tokens",
  },
  cache_write: {
    above200k: "cache_creation_input_token_cost_above_200k_tokens",
    above272k: "cache_creation_input_token_cost_above_272k_tokens",
  },
  cache_write_1h: {
    above200k: "cache_creation_input_token_cost_above_1hr_above_200k_tokens",
    above272k: "cache_creation_input_token_cost_above_1hr_above_272k_tokens",
  },
};

/** priority 服务档可映射的计费维度 -> priority 字段名(含分层组合) */
const PRIORITY_FIELD_BY_CHARGE: Record<
  string,
  { base: string; above200k?: string; above272k?: string }
> = {
  prompt: {
    base: "input_cost_per_token_priority",
    above200k: "input_cost_per_token_above_200k_tokens_priority",
    above272k: "input_cost_per_token_above_272k_tokens_priority",
  },
  completion: {
    base: "output_cost_per_token_priority",
    above200k: "output_cost_per_token_above_200k_tokens_priority",
    above272k: "output_cost_per_token_above_272k_tokens_priority",
  },
  cache_read: {
    base: "cache_read_input_token_cost_priority",
    above200k: "cache_read_input_token_cost_above_200k_tokens_priority",
    above272k: "cache_read_input_token_cost_above_272k_tokens_priority",
  },
};

function chargeTarget(chargeKey: string, charge: CptCharge): ChargeFieldTarget | null {
  if (charge.unit === "per_M_tokens") {
    const tokenField = TOKEN_CHARGE_FIELDS[chargeKey];
    if (tokenField) return { kind: "per_token", field: tokenField };
    if (chargeKey === "image_input")
      return { kind: "per_token", field: "input_cost_per_image_token" };
    if (chargeKey === "image_output") {
      return { kind: "per_token", field: "output_cost_per_image_token" };
    }
    return null;
  }
  if (charge.unit === "per_image") {
    if (chargeKey === "image_input") return { kind: "scalar", field: "input_cost_per_image" };
    if (chargeKey === "image_output" || chargeKey.startsWith("image_output")) {
      // 仅取无尺寸后缀的基础档;带尺寸变体(image_output_1024x1536 等)跳过
      if (chargeKey !== "image_output") return null;
      return { kind: "scalar", field: "output_cost_per_image" };
    }
    return null;
  }
  if (charge.unit === "per_request" && chargeKey === "request") {
    return { kind: "scalar", field: "input_cost_per_request" };
  }
  return null;
}

/** track factor 解析:charge_factors 覆盖默认 factor */
function trackFactorFor(track: CptTrack, chargeKey: string): number | null {
  const explicit = track.charge_factors?.[chargeKey];
  if (explicit !== undefined) return parseDecimal(explicit);
  return parseDecimal(track.factor);
}

type TrackClass =
  | { kind: "default" }
  | { kind: "tier"; tier: "200k" | "272k" }
  | { kind: "priority" }
  | { kind: "priority_tier"; tier: "200k" | "272k" }
  | { kind: "unsupported" };

function classifyThreshold(threshold: number | undefined): "200k" | "272k" | null {
  if (typeof threshold !== "number") return null;
  if (threshold >= TIER_200K_MIN && threshold <= TIER_200K_MAX) return "200k";
  if (threshold >= TIER_272K_MIN && threshold <= TIER_272K_MAX) return "272k";
  return null;
}

function isPriorityTrigger(trigger: CptTrackTrigger): boolean {
  return (
    trigger.kind === "body_matches" &&
    trigger.field === "service_tier" &&
    typeof trigger.pattern === "string" &&
    /priority/.test(trigger.pattern)
  );
}

/** Claude 1M beta 等长上下文轨道的 header 触发条件(辅助条件,不影响分层归类) */
function isLongContextHeaderTrigger(trigger: CptTrackTrigger): boolean {
  return trigger.kind === "header_matches";
}

function classifyTrack(track: CptTrack): TrackClass {
  const triggers = Array.isArray(track.triggers) ? track.triggers : [];
  if (triggers.length === 0) return { kind: "default" };

  let tier: "200k" | "272k" | null = null;
  let priority = false;

  for (const trigger of triggers) {
    if (trigger.kind === "input_tokens_above") {
      const classified = classifyThreshold(trigger.threshold);
      if (!classified) return { kind: "unsupported" };
      tier = classified;
      continue;
    }
    if (isPriorityTrigger(trigger)) {
      priority = true;
      continue;
    }
    if (isLongContextHeaderTrigger(trigger)) {
      // 长上下文 beta header(如 anthropic-beta: context-1m-*)与 tokens 阈值组合出现,
      // 计费侧由 context1mApplied 标志控制,这里按分层轨道归类即可
      continue;
    }
    return { kind: "unsupported" };
  }

  if (tier && priority) return { kind: "priority_tier", tier };
  if (tier) return { kind: "tier", tier };
  if (priority) return { kind: "priority" };
  return { kind: "unsupported" };
}

/**
 * 转换单个 provider 报价变体为内部价格字段集合。
 * 返回 null 表示该变体没有任何可识别的计费字段。
 */
export function convertCptVariant(variant: CptPricingVariant): Record<string, unknown> | null {
  const charges = variant.charges ?? {};
  const tracks = Array.isArray(variant.tracks) ? variant.tracks : [];
  const defaultTrack = tracks.find(
    (track) => !Array.isArray(track.triggers) || track.triggers.length === 0
  );

  const node: Record<string, unknown> = {};
  let hasBillableField = false;

  const basePriceOf = (chargeKey: string): number | null => {
    const charge = charges[chargeKey];
    if (!charge) return null;
    return parseDecimal(charge.price);
  };

  // 基础价:base price x 默认轨道 factor(无默认轨道时 factor=1)
  for (const [chargeKey, charge] of Object.entries(charges)) {
    if (!charge || typeof charge !== "object") continue;
    // 币种覆盖的报价(如 CNY)与内部 USD 计费不可比,跳过该维度
    if (typeof charge.currency === "string" && charge.currency && charge.currency !== "USD") {
      continue;
    }
    const target = chargeTarget(chargeKey, charge);
    const price = parseDecimal(charge.price);
    if (!target || price === null || price < 0) continue;

    const factor = defaultTrack ? trackFactorFor(defaultTrack, chargeKey) : 1;
    const effective = price * (factor ?? 1);
    const value =
      target.kind === "per_token" ? roundPrecision(effective / MILLION) : roundPrecision(effective);
    node[target.field] = value;
    hasBillableField = true;
  }

  // web_search(per_k_calls)-> 每次查询成本,保持与旧格式 search_context_cost_per_query 兼容
  const webSearch = charges.web_search;
  if (webSearch?.unit === "per_k_calls") {
    const price = parseDecimal(webSearch.price);
    if (price !== null && price >= 0) {
      const perQuery = roundPrecision(price / 1000);
      node.search_context_cost_per_query = {
        search_context_size_low: perQuery,
        search_context_size_medium: perQuery,
        search_context_size_high: perQuery,
      };
      hasBillableField = true;
    }
  }

  const fileSearch = charges.file_search_call ?? charges.file_search;
  if (fileSearch?.unit === "per_k_calls") {
    const price = parseDecimal(fileSearch.price);
    if (price !== null && price >= 0) {
      node.file_search_cost_per_1k_calls = roundPrecision(price);
    }
  }

  // 分层/priority 轨道:base price x 轨道 factor
  for (const track of tracks) {
    const classified = classifyTrack(track);
    if (classified.kind === "default" || classified.kind === "unsupported") continue;

    if (classified.kind === "tier" || classified.kind === "priority_tier") {
      const isPriority = classified.kind === "priority_tier";
      for (const [chargeKey, fields] of Object.entries(TIER_FIELD_BY_CHARGE)) {
        const basePrice = basePriceOf(chargeKey);
        if (basePrice === null) continue;
        const factor = trackFactorFor(track, chargeKey);
        if (factor === null || factor < 0) continue;

        const field = isPriority
          ? classified.tier === "200k"
            ? PRIORITY_FIELD_BY_CHARGE[chargeKey]?.above200k
            : PRIORITY_FIELD_BY_CHARGE[chargeKey]?.above272k
          : classified.tier === "200k"
            ? fields.above200k
            : fields.above272k;
        if (!field) continue;

        node[field] = roundPrecision((basePrice * factor) / MILLION);
        hasBillableField = true;
      }
      continue;
    }

    // priority 服务档(不带 tokens 阈值)
    for (const [chargeKey, fields] of Object.entries(PRIORITY_FIELD_BY_CHARGE)) {
      const basePrice = basePriceOf(chargeKey);
      if (basePrice === null) continue;
      const factor = trackFactorFor(track, chargeKey);
      if (factor === null || factor < 0) continue;
      node[fields.base] = roundPrecision((basePrice * factor) / MILLION);
      hasBillableField = true;
    }
  }

  if (!hasBillableField) return null;
  return node;
}

const CAPABILITY_FIELD_MAP: Record<string, string[]> = {
  assistant_prefill: ["supports_assistant_prefill"],
  computer_use: ["supports_computer_use"],
  function_calling: ["supports_function_calling", "supports_tool_choice"],
  pdf_input: ["supports_pdf_input"],
  prompt_caching: ["supports_prompt_caching"],
  reasoning: ["supports_reasoning"],
  structured_output: ["supports_response_schema"],
  vision: ["supports_vision"],
  audio_input: ["supports_audio_input"],
  audio_output: ["supports_audio_output"],
  video_input: ["supports_video_input"],
  web_search: ["supports_web_search"],
};

function modeOfModelType(modelType: string | null | undefined): string {
  if (!modelType) return "chat";
  switch (modelType) {
    case "chat":
      return "chat";
    case "completion":
      return "completion";
    case "responses":
      return "responses";
    case "image":
    case "image_generation":
      return "image_generation";
    default:
      return modelType;
  }
}

function variantPricingKey(variant: CptPricingVariant): string {
  const region = typeof variant.region === "string" && variant.region ? `@${variant.region}` : "";
  return `${variant.provider}${region}`;
}

function resolveVendorIcon(
  vendor: string,
  providers: Record<string, CptProviderInfo>
): VendorIconFileEntry | null {
  const provider = providers[vendor];
  if (provider?.icon) {
    return { file: provider.icon, mono: provider.icon_mono === true };
  }
  return iconFileForVendor(vendor);
}

const MAX_ALIASES_PER_MODEL = 64;

/**
 * 转换单个模型条目。返回 null 表示所有报价变体都无可计费字段。
 */
export function convertCptModelEntry(
  entry: CptModelEntry,
  providers: Record<string, CptProviderInfo>
): ModelPriceData | null {
  const variants = Array.isArray(entry.pricing) ? entry.pricing : [];
  const pricingMap: Record<string, Record<string, unknown>> = {};
  const officialKeys: string[] = [];

  let defaultKey: string | null = null;
  let defaultNode: Record<string, unknown> | null = null;

  for (const variant of variants) {
    if (!variant || typeof variant.provider !== "string" || !variant.provider) continue;
    const converted = convertCptVariant(variant);
    if (!converted) continue;

    const key = variantPricingKey(variant);
    const node: Record<string, unknown> = { ...converted };
    if (variant.official === true) {
      node.official = true;
    }
    if (typeof variant.provider_model_id === "string" && variant.provider_model_id) {
      node.provider_model_id = variant.provider_model_id;
    }
    pricingMap[key] = node;

    if (variant.official === true) {
      officialKeys.push(key);
      if (!defaultKey) {
        defaultKey = key;
        defaultNode = converted;
      }
    }
  }

  const pricingKeys = Object.keys(pricingMap);
  if (pricingKeys.length === 0) return null;

  if (!defaultKey) {
    defaultKey = pricingKeys[0];
    defaultNode = { ...pricingMap[defaultKey] };
    delete defaultNode.official;
    delete defaultNode.provider_model_id;
  }

  const vendorIcon = resolveVendorIcon(entry.vendor, providers);

  const priceData: ModelPriceData = {
    ...(defaultNode as Partial<ModelPriceData>),
    mode: modeOfModelType(entry.model_type) as ModelPriceData["mode"],
    display_name: entry.display_name || entry.model_name,
    vendor: entry.vendor,
    slug: entry.slug,
    providers: pricingKeys,
    pricing: pricingMap,
    official_pricing_provider: officialKeys[0] ?? null,
  };
  delete (priceData as Record<string, unknown>).official;
  delete (priceData as Record<string, unknown>).provider_model_id;

  if (vendorIcon) {
    priceData.vendor_icon = vendorIcon.file;
    if (vendorIcon.mono) priceData.vendor_icon_mono = true;
  }

  if (Array.isArray(entry.aliases) && entry.aliases.length > 0) {
    const aliases = entry.aliases
      .filter((alias) => typeof alias === "string" && alias.trim() && alias !== entry.model_name)
      .slice(0, MAX_ALIASES_PER_MODEL);
    if (aliases.length > 0) {
      priceData.aliases = aliases;
    }
  }

  if (typeof entry.family === "string" && entry.family) {
    priceData.model_family = entry.family;
  }
  if (typeof entry.max_input_tokens === "number") {
    priceData.max_input_tokens = entry.max_input_tokens;
  }
  if (typeof entry.max_output_tokens === "number") {
    priceData.max_output_tokens = entry.max_output_tokens;
    priceData.max_tokens = entry.max_output_tokens;
  }
  if (entry.deprecated === true) {
    priceData.deprecated = true;
  }
  if (typeof entry.knowledge_cutoff === "string" && entry.knowledge_cutoff) {
    priceData.knowledge_cutoff = entry.knowledge_cutoff;
  }

  if (entry.capabilities && typeof entry.capabilities === "object") {
    for (const [capability, fields] of Object.entries(CAPABILITY_FIELD_MAP)) {
      if (entry.capabilities[capability] === true) {
        for (const field of fields) {
          (priceData as Record<string, unknown>)[field] = true;
        }
      }
    }
  }

  return priceData;
}

/** bare 模型名冲突时的择优:官方报价 > 非 other vendor > 报价变体多者 */
function preferEntry(a: CptModelEntry, b: CptModelEntry): CptModelEntry {
  const officialA = a.pricing?.some((variant) => variant?.official === true) ?? false;
  const officialB = b.pricing?.some((variant) => variant?.official === true) ?? false;
  if (officialA !== officialB) return officialA ? a : b;
  if ((a.vendor === "other") !== (b.vendor === "other")) return a.vendor === "other" ? b : a;
  return (b.pricing?.length ?? 0) > (a.pricing?.length ?? 0) ? b : a;
}

/**
 * 转换整张 CPT 价格表。
 * models 以 canonical bare model_name 为键(与内部 model_prices.model_name 对齐)。
 */
export function convertCptTable(table: CptTable): ConvertedCptTable {
  const entryByName = new Map<string, CptModelEntry>();
  for (const entry of table.models) {
    const name = entry.model_name.trim();
    if (!name) continue;
    const existing = entryByName.get(name);
    entryByName.set(name, existing ? preferEntry(existing, entry) : entry);
  }

  const models: Record<string, ModelPriceData> = Object.create(null);
  const vendorCounts = new Map<string, number>();

  for (const [name, entry] of entryByName) {
    if (name === "__proto__" || name === "constructor" || name === "prototype") continue;
    const converted = convertCptModelEntry(entry, table.providers);
    if (!converted) continue;
    models[name] = converted;
    vendorCounts.set(entry.vendor, (vendorCounts.get(entry.vendor) ?? 0) + 1);
  }

  const vendors: CloudVendorSummary[] = Array.from(vendorCounts.entries())
    .map(([vendor, modelCount]) => {
      const icon = resolveVendorIcon(vendor, table.providers);
      return {
        vendor,
        name: table.providers[vendor]?.name ?? vendorDisplayName(vendor),
        ...(icon ? { icon: icon.file, iconMono: icon.mono === true } : {}),
        modelCount,
      };
    })
    .sort((a, b) => b.modelCount - a.modelCount || a.vendor.localeCompare(b.vendor));

  return {
    models,
    vendors,
    providers: table.providers,
    version: table.version,
    currency: table.currency,
    refreshedAt: table.refreshed_at,
  };
}
