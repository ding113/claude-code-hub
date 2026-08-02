import type { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { messageRequest } from "@/drizzle/schema";

const dialect = new PgDialect();
const compile = (value: unknown) => dialect.sqlToQuery(value as SQL).sql.toLowerCase();

describe("Proxy Status indexes", () => {
  it("indexes bounded active requests", () => {
    const index = getTableConfig(messageRequest).indexes.find(
      (entry) => entry.config.name === "idx_message_request_proxy_status_active"
    );
    expect(index).toBeDefined();
    expect(compile(index?.config.columns[0])).toContain("created_at");
    expect(compile(index?.config.columns[0])).toContain("desc nulls last");
    expect(index?.config.columns[1]).toMatchObject({ name: "user_id" });
    const predicate = compile(index?.config.where);
    expect(predicate).toContain('"status_code" is null');
    expect(predicate).toContain('"is_replay" = false');
    expect(predicate).toContain("warmup");
  });

  it("indexes the deterministic latest finalized request per user", () => {
    const index = getTableConfig(messageRequest).indexes.find(
      (entry) => entry.config.name === "idx_message_request_proxy_status_latest"
    );
    expect(index).toBeDefined();
    expect(index?.config.columns[0]).toMatchObject({ name: "user_id" });
    expect(compile(index?.config.columns[1])).toContain("updated_at");
    expect(compile(index?.config.columns[1])).toContain("desc nulls last");
    expect(index?.config.columns[2]).toMatchObject({ name: "id", indexConfig: { order: "desc" } });
    const predicate = compile(index?.config.where);
    expect(predicate).toContain('"status_code" is not null');
    expect(predicate).toContain('"is_replay" = false');
  });
});
