import 'server-only';

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnvConfig } from '@/lib/config/env.schema';
import * as schema from './schema';

let dbInstance: PostgresJsDatabase<typeof schema> | null = null;

function createDbInstance(): PostgresJsDatabase<typeof schema> {
  const env = getEnvConfig();
  const connectionString = env.DSN;

  if (!connectionString) {
    throw new Error('DSN environment variable is not set');
  }

  // postgres.js 默认 max=10，在高并发下容易出现查询排队
  // 这里采用“生产环境默认更大、同时可通过 env 覆盖”的策略，兼容单机与 k8s 多副本
  const defaultMax = env.NODE_ENV === 'production' ? 20 : 10;
  const client = postgres(connectionString, {
    max: env.DB_POOL_MAX ?? defaultMax,
    idle_timeout: env.DB_POOL_IDLE_TIMEOUT ?? 20,
    connect_timeout: env.DB_POOL_CONNECT_TIMEOUT ?? 10,
  });
  return drizzle(client, { schema });
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!dbInstance) {
    dbInstance = createDbInstance();
  }

  return dbInstance;
}

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, receiver);

    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

export type Database = ReturnType<typeof getDb>;
