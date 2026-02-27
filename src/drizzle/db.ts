import "server-only";

import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnvConfig } from "@/lib/config/env.schema";
import * as schema from "./schema";

type DbInstance = PgDatabase<any, typeof schema>;

let dbInstance: DbInstance | null = null;

function createDbInstance(): DbInstance {
  const env = getEnvConfig();

  // Demo: allow embedded database for dev environments without Postgres.
  // Production should always use DSN (real Postgres).
  const useEmbeddedDb = env.NODE_ENV !== "production" && env.CCH_EMBEDDED_DB === true;
  if (useEmbeddedDb) {
    const dataDir = env.CCH_EMBEDDED_DB_DIR ?? "data/pglite";
    return drizzlePglite({ connection: { dataDir }, schema });
  }

  const connectionString = env.DSN;

  if (!connectionString) {
    throw new Error("DSN environment variable is not set");
  }

  // postgres.js 默认 max=10，在高并发下容易出现查询排队
  // 这里采用“生产环境默认更大、同时可通过 env 覆盖”的策略，兼容单机与 k8s 多副本
  const defaultMax = env.NODE_ENV === "production" ? 20 : 10;
  const client = postgres(connectionString, {
    max: env.DB_POOL_MAX ?? defaultMax,
    idle_timeout: env.DB_POOL_IDLE_TIMEOUT ?? 20,
    connect_timeout: env.DB_POOL_CONNECT_TIMEOUT ?? 10,
  });
  return drizzlePostgres(client, { schema });
}

export function getDb(): DbInstance {
  if (!dbInstance) {
    dbInstance = createDbInstance();
  }

  return dbInstance;
}

export const db = new Proxy({} as DbInstance, {
  get(_target, prop, receiver) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, receiver);

    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export type Database = ReturnType<typeof getDb>;
