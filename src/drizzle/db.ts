import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnvConfig } from "@/lib/config/env.schema";
import { createAdmittedSqlClient } from "./admitted-client";
import * as schema from "./schema";

type DbLane = "data" | "control" | "writer";
type DbPoolLifecycleState = "open" | "closing" | "closed";
type DatabaseInstance = PostgresJsDatabase<typeof schema>;
type SqlClient = ReturnType<typeof postgres>;

interface PoolBudget {
  data: number;
  control: number;
  writer: number;
}

interface PoolInstance {
  client: SqlClient;
  db: DatabaseInstance;
}

const APPLICATION_NAMES: Record<DbLane, string> = {
  data: "claude-code-hub:data",
  control: "claude-code-hub:control",
  writer: "claude-code-hub:writer",
};
const MIN_OUTSTANDING_PER_POOL = 32;
const OUTSTANDING_PER_CONNECTION = 8;

const globalForDbScope = globalThis as typeof globalThis & {
  __CCH_DATA_DB_SCOPE__?: AsyncLocalStorage<DbLane>;
};
const dataDbScope = globalForDbScope.__CCH_DATA_DB_SCOPE__ ?? new AsyncLocalStorage<DbLane>();
globalForDbScope.__CCH_DATA_DB_SCOPE__ = dataDbScope;

let poolInstances: Partial<Record<DbLane, PoolInstance>> = {};
let closePromise: Promise<void> | null = null;
let poolLifecycleState: DbPoolLifecycleState = "open";

function splitPoolBudget(total: number): PoolBudget {
  if (total === 1) return { data: 0, control: 1, writer: 0 };
  if (total === 2) return { data: 1, control: 1, writer: 0 };

  const writer = 1;
  const control = Math.min(total - 2, Math.max(1, Math.round(total * 0.2)));
  return { data: total - control - writer, control, writer };
}

function getPoolBudget(): PoolBudget {
  const env = getEnvConfig();
  const defaultTotal = env.NODE_ENV === "production" ? 20 : 10;
  return splitPoolBudget(env.DB_POOL_MAX ?? defaultTotal);
}

function resolvePhysicalLane(lane: DbLane, budget: PoolBudget): DbLane {
  if (budget[lane] > 0) return lane;
  if (lane === "writer") return budget.control > 0 ? "control" : "data";
  return "control";
}

function createDbInstance(lane: DbLane, max: number): PoolInstance {
  const env = getEnvConfig();
  const connectionString = env.DSN;

  if (!connectionString) {
    throw new Error("DSN environment variable is not set");
  }

  const client = postgres(connectionString, {
    max,
    idle_timeout: env.DB_POOL_IDLE_TIMEOUT ?? 20,
    connect_timeout: env.DB_POOL_CONNECT_TIMEOUT ?? 10,
    connection: {
      application_name: APPLICATION_NAMES[lane],
      statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
      lock_timeout: env.DB_LOCK_TIMEOUT_MS,
    },
  });
  const admittedClient = createAdmittedSqlClient(client, {
    pool: lane,
    maxOutstanding: Math.max(MIN_OUTSTANDING_PER_POOL, max * OUTSTANDING_PER_CONNECTION),
  });

  return {
    client,
    db: drizzle(admittedClient, { schema }),
  };
}

function getPool(lane: DbLane): DatabaseInstance {
  if (poolLifecycleState !== "open") {
    throw new Error(`Database pools are ${poolLifecycleState}`);
  }

  const budget = getPoolBudget();
  const physicalLane = resolvePhysicalLane(lane, budget);
  const existing = poolInstances[physicalLane];
  if (existing) return existing.db;

  const created = createDbInstance(physicalLane, budget[physicalLane]);
  poolInstances[physicalLane] = created;
  return created.db;
}

export function runWithDataDbScope<T>(callback: () => T): T {
  return dataDbScope.run("data", callback);
}

export function withDataDbScope<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult
): (...args: TArgs) => TResult {
  return (...args) => runWithDataDbScope(() => handler(...args));
}

export function getDb(): DatabaseInstance {
  return getPool(dataDbScope.getStore() === "data" ? "data" : "control");
}

export function getMessageWriterDb(): DatabaseInstance {
  return getPool("writer");
}

export function closeDbPools(): Promise<void> {
  if (closePromise) return closePromise;

  poolLifecycleState = "closing";
  const pools = Object.values(poolInstances);
  let resolveClose!: () => void;
  let rejectClose!: (reason?: unknown) => void;
  const publishedClosePromise = new Promise<void>((resolve, reject) => {
    resolveClose = resolve;
    rejectClose = reject;
  });
  closePromise = publishedClosePromise;

  void (async () => {
    try {
      const results = await Promise.allSettled(
        pools.map(({ client }) => client.end({ timeout: 5 }))
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (failure) throw failure.reason;
    } finally {
      poolInstances = {};
      poolLifecycleState = "closed";
    }
  })().then(resolveClose, rejectClose);

  return publishedClosePromise;
}

export const db = new Proxy({} as DatabaseInstance, {
  get(_target, property) {
    const instance = getDb();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export type Database = ReturnType<typeof getDb>;
