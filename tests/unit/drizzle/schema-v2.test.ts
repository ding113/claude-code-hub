import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import { providers } from "@/drizzle/schema";
import {
  modelPriceSourceEnum,
  modelPricesV2,
  remoteConfigSync,
  vendorApiFormatEnum,
  vendorBalanceChecks,
  vendorCategoryEnum,
  vendorEndpoints,
  vendorKeys,
  vendors,
} from "@/drizzle/schema-v2";

describe("schema-v2 (vendor architecture)", () => {
  test("api_format enum 仅允许 claude|codex|gemini", () => {
    expect(vendorApiFormatEnum.enumValues).toEqual(["claude", "codex", "gemini"]);
  });

  test("vendors 表包含关键字段并对 slug 做唯一约束", () => {
    const cfg = getTableConfig(vendors);
    const colNames = cfg.columns.map((c) => c.name);

    expect(cfg.name).toBe("vendors");
    expect(colNames).toContain("slug");
    expect(colNames).toContain("category");
    expect(colNames).toContain("is_managed");
    expect(colNames).toContain("balance_check_endpoint");
    expect(colNames).toContain("balance_check_jsonpath");

    const uniqueSlugIndex = cfg.indexes.find((idx) => {
      const cols = idx.config.columns.map((c) => c.name);
      return idx.config.unique === true && cols.length === 1 && cols[0] === "slug";
    });
    expect(uniqueSlugIndex).toBeTruthy();
  });

  test("vendor_endpoints 表包含 vendor_id + api_format + latency_ms + health_check_*", () => {
    const cfg = getTableConfig(vendorEndpoints);
    const colNames = cfg.columns.map((c) => c.name);

    expect(cfg.name).toBe("vendor_endpoints");
    expect(colNames).toContain("vendor_id");
    expect(colNames).toContain("api_format");
    expect(colNames).toContain("latency_ms");
    expect(colNames).toContain("health_check_enabled");
    expect(colNames).toContain("health_check_endpoint");
  });

  test("vendor_keys 继承 providers 全量字段，并增加 is_user_override + balance_usd", () => {
    const providerCols = getTableConfig(providers).columns.map((c) => c.name);
    const keyCols = getTableConfig(vendorKeys).columns.map((c) => c.name);
    const keyColSet = new Set(keyCols);

    for (const col of providerCols) {
      expect(keyColSet.has(col)).toBe(true);
    }

    expect(keyColSet.has("vendor_id")).toBe(true);
    expect(keyColSet.has("endpoint_id")).toBe(true);
    expect(keyColSet.has("is_user_override")).toBe(true);
    expect(keyColSet.has("balance_usd")).toBe(true);
    expect(keyColSet.has("balance_updated_at")).toBe(true);
  });

  test("vendor_balance_checks 表存在并可用于记录余额检查历史", () => {
    const cfg = getTableConfig(vendorBalanceChecks);
    const colNames = cfg.columns.map((c) => c.name);

    expect(cfg.name).toBe("vendor_balance_checks");
    expect(colNames).toContain("vendor_key_id");
    expect(colNames).toContain("checked_at");
    expect(colNames).toContain("balance_usd");
    expect(colNames).toContain("is_success");
  });

  test("model_prices_v2 支持 source 追踪 + 用户覆写 + remote_version", () => {
    expect(modelPriceSourceEnum.enumValues).toEqual(["remote", "local", "user"]);

    const cfg = getTableConfig(modelPricesV2);
    const colNames = cfg.columns.map((c) => c.name);

    expect(cfg.name).toBe("model_prices_v2");
    expect(colNames).toContain("model_name");
    expect(colNames).toContain("price_data");
    expect(colNames).toContain("source");
    expect(colNames).toContain("is_user_override");
    expect(colNames).toContain("remote_version");
  });

  test("remote_config_sync 表存在并用于记录远程配置同步状态", () => {
    const cfg = getTableConfig(remoteConfigSync);
    const colNames = cfg.columns.map((c) => c.name);

    expect(cfg.name).toBe("remote_config_sync");
    expect(colNames).toContain("config_key");
    expect(colNames).toContain("remote_version");
    expect(colNames).toContain("last_synced_at");
  });
});

describe("migration 0041_vendor_architecture.sql", () => {
  test("包含新表创建与 providers -> vendor_keys 数据迁移", () => {
    const sql = readFileSync(resolve(process.cwd(), "drizzle/0041_vendor_architecture.sql"), "utf8");

    expect(sql).toContain('CREATE TYPE "vendor_api_format"');
    expect(sql).toContain('CREATE TYPE "vendor_category"');
    expect(sql).toContain('CREATE TYPE "model_price_source_v2"');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "vendors"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "vendor_endpoints"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "vendor_keys"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "vendor_balance_checks"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "model_prices_v2"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "remote_config_sync"');

    expect(sql).toContain("-- 数据迁移脚本（providers -> vendor_keys）");
    expect(sql).toContain('INSERT INTO "vendor_keys"');
    expect(sql).toContain('"is_user_override"');
  });
});
