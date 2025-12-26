import { parse as parseToml } from "smol-toml";

export interface RemoteConfigMetadata {
  version: string;
}

export interface RemoteVendorBalanceCheckConfig {
  enabled?: boolean;
  endpoint?: string;
  jsonpath?: string;
  interval_seconds?: number;
  low_threshold_usd?: number;
  [key: string]: unknown;
}

export interface RemoteVendorEndpointConfig {
  name: string;
  url: string;
  api_format: string;
  [key: string]: unknown;
}

export interface RemoteVendorConfig {
  slug: string;
  name: string;
  category: string;
  tags?: string[];
  website_url?: string;
  favicon_url?: string;
  endpoints: RemoteVendorEndpointConfig[];
  balance_check?: RemoteVendorBalanceCheckConfig;
  [key: string]: unknown;
}

export interface RemoteVendorsToml {
  metadata: RemoteConfigMetadata;
  vendors: RemoteVendorConfig[];
}

export interface RemotePricesOverrideToml {
  metadata: RemoteConfigMetadata;
  prices: Record<string, Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((v) => typeof v === "string");
  return items.length === value.length ? items : undefined;
}

function requireMetadataVersion(doc: Record<string, unknown>): string {
  const metadataRaw = doc.metadata;
  const metadata = isRecord(metadataRaw) ? metadataRaw : null;
  const version = metadata ? metadata.version : undefined;
  return requireString(version, "metadata.version");
}

export function parseTomlDocument(text: string): unknown {
  return parseToml(text);
}

export function parseVendorsToml(text: string): RemoteVendorsToml {
  const doc = requireRecord(parseTomlDocument(text), "TOML document");
  const version = requireMetadataVersion(doc);

  if (!Array.isArray(doc.vendors)) {
    throw new Error("vendors must be an array");
  }

  const vendors: RemoteVendorConfig[] = doc.vendors.map((raw, idx) => {
    const vendor = requireRecord(raw, `vendors[${idx}]`);
    const endpointsRaw = vendor.endpoints;

    const endpoints: RemoteVendorEndpointConfig[] = Array.isArray(endpointsRaw)
      ? endpointsRaw.map((epRaw, epIdx) => {
          const endpoint = requireRecord(epRaw, `vendors[${idx}].endpoints[${epIdx}]`);
          return {
            name: requireString(endpoint.name, `vendors[${idx}].endpoints[${epIdx}].name`),
            url: requireString(endpoint.url, `vendors[${idx}].endpoints[${epIdx}].url`),
            api_format: requireString(
              endpoint.api_format,
              `vendors[${idx}].endpoints[${epIdx}].api_format`
            ),
            ...endpoint,
          };
        })
      : [];

    const balanceCheckRaw = vendor.balance_check;
    const balance_check = balanceCheckRaw
      ? (requireRecord(
          balanceCheckRaw,
          `vendors[${idx}].balance_check`
        ) as RemoteVendorBalanceCheckConfig)
      : undefined;

    return {
      ...vendor,
      slug: requireString(vendor.slug, `vendors[${idx}].slug`),
      name: requireString(vendor.name, `vendors[${idx}].name`),
      category: requireString(vendor.category, `vendors[${idx}].category`),
      tags: optionalStringArray(vendor.tags),
      website_url: optionalString(vendor.website_url),
      favicon_url: optionalString(vendor.favicon_url),
      endpoints,
      ...(balance_check ? { balance_check } : {}),
    };
  });

  return {
    metadata: { version },
    vendors,
  };
}

export function parsePricesOverrideToml(text: string): RemotePricesOverrideToml {
  const doc = requireRecord(parseTomlDocument(text), "TOML document");
  const version = requireMetadataVersion(doc);

  const pricesRaw = requireRecord(doc.prices, "prices");
  const prices: Record<string, Record<string, unknown>> = {};

  for (const [modelName, raw] of Object.entries(pricesRaw)) {
    prices[modelName] = requireRecord(raw, `prices.${modelName}`);
  }

  return {
    metadata: { version },
    prices,
  };
}
