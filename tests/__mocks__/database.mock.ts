/**
 * Database Mock Infrastructure for Testing
 *
 * Since the project uses PostgreSQL with Drizzle ORM, and better-sqlite3
 * has incompatible schema syntax, we use a repository-level mocking approach.
 *
 * This provides:
 * - Mock data factories for common entities
 * - Repository function mocks
 * - Type-safe test fixtures
 *
 * Usage:
 * ```typescript
 * import { createMockProvider, createMockUser } from "../__mocks__/database.mock";
 *
 * const provider = createMockProvider({ name: "Test Provider" });
 * const user = createMockUser({ name: "Test User" });
 * ```
 */

// ============================================================================
// Type Definitions (matching Drizzle schema)
// ============================================================================

export interface MockProvider {
  id: number;
  name: string;
  type: "claude" | "claude-auth" | "codex" | "gemini" | "openai-compatible";
  url: string;
  apiKey: string;
  enabled: boolean;
  weight: number;
  priority: number;
  costMultiplier: string;
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;
  modelRedirects: Record<string, string> | null;
  maxConcurrentRequests: number | null;
  rpmLimit: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockUser {
  id: number;
  name: string;
  role: "admin" | "user";
  enabled: boolean;
  rpmLimit: number | null;
  dailyLimitUsd: string | null;
  limit5hUsd: string | null;
  limitWeeklyUsd: string | null;
  limitMonthlyUsd: string | null;
  limitConcurrentSessions: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockKey {
  id: number;
  userId: number;
  hash: string;
  name: string;
  enabled: boolean;
  isPrimary: boolean;
  rpmLimit: number | null;
  dailyLimitUsd: string | null;
  limit5hUsd: string | null;
  limitWeeklyUsd: string | null;
  limitMonthlyUsd: string | null;
  limitConcurrentSessions: number | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockMessage {
  id: number;
  keyId: number;
  providerId: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  cost: string;
  cached: boolean;
  createdAt: Date;
}

export interface MockErrorRule {
  id: number;
  name: string;
  pattern: string;
  description: string | null;
  enabled: boolean;
  isBuiltin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Mock Data Factories
// ============================================================================

let mockIdCounter = 1;

/**
 * Reset ID counter for test isolation
 */
export function resetMockIdCounter(): void {
  mockIdCounter = 1;
}

/**
 * Create a mock provider with default values
 */
export function createMockProvider(
  overrides: Partial<MockProvider> = {}
): MockProvider {
  const id = overrides.id ?? mockIdCounter++;
  return {
    id,
    name: `Provider ${id}`,
    type: "claude",
    url: "https://api.anthropic.com",
    apiKey: `sk-test-${id}`,
    enabled: true,
    weight: 100,
    priority: 1,
    costMultiplier: "1.0",
    proxyUrl: null,
    proxyFallbackToDirect: false,
    modelRedirects: null,
    maxConcurrentRequests: null,
    rpmLimit: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock user with default values
 */
export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  const id = overrides.id ?? mockIdCounter++;
  return {
    id,
    name: `User ${id}`,
    role: "user",
    enabled: true,
    rpmLimit: null,
    dailyLimitUsd: null,
    limit5hUsd: null,
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitConcurrentSessions: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock API key with default values
 */
export function createMockKey(overrides: Partial<MockKey> = {}): MockKey {
  const id = overrides.id ?? mockIdCounter++;
  return {
    id,
    userId: overrides.userId ?? 1,
    hash: `hash-${id}`,
    name: `Key ${id}`,
    enabled: true,
    isPrimary: false,
    rpmLimit: null,
    dailyLimitUsd: null,
    limit5hUsd: null,
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitConcurrentSessions: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock message (request log) with default values
 */
export function createMockMessage(
  overrides: Partial<MockMessage> = {}
): MockMessage {
  const id = overrides.id ?? mockIdCounter++;
  return {
    id,
    keyId: overrides.keyId ?? 1,
    providerId: overrides.providerId ?? 1,
    model: "claude-sonnet-4-20250514",
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: null,
    cacheReadTokens: null,
    cost: "0.001",
    cached: false,
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock error rule with default values
 */
export function createMockErrorRule(
  overrides: Partial<MockErrorRule> = {}
): MockErrorRule {
  const id = overrides.id ?? mockIdCounter++;
  return {
    id,
    name: `Error Rule ${id}`,
    pattern: "test.*error",
    description: null,
    enabled: true,
    isBuiltin: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Repository Mock Store
// ============================================================================

/**
 * In-memory store for mock data
 * Use this to simulate database operations
 */
export interface MockDataStore {
  providers: Map<number, MockProvider>;
  users: Map<number, MockUser>;
  keys: Map<number, MockKey>;
  messages: MockMessage[];
  errorRules: Map<number, MockErrorRule>;
}

/**
 * Create a fresh mock data store
 */
export function createMockDataStore(): MockDataStore {
  return {
    providers: new Map(),
    users: new Map(),
    keys: new Map(),
    messages: [],
    errorRules: new Map(),
  };
}

/**
 * Seed mock data store with initial data
 */
export function seedMockDataStore(
  store: MockDataStore,
  data: {
    providers?: MockProvider[];
    users?: MockUser[];
    keys?: MockKey[];
    messages?: MockMessage[];
    errorRules?: MockErrorRule[];
  }
): void {
  if (data.providers) {
    for (const provider of data.providers) {
      store.providers.set(provider.id, provider);
    }
  }
  if (data.users) {
    for (const user of data.users) {
      store.users.set(user.id, user);
    }
  }
  if (data.keys) {
    for (const key of data.keys) {
      store.keys.set(key.id, key);
    }
  }
  if (data.messages) {
    store.messages.push(...data.messages);
  }
  if (data.errorRules) {
    for (const rule of data.errorRules) {
      store.errorRules.set(rule.id, rule);
    }
  }
}

/**
 * Reset mock data store
 */
export function resetMockDataStore(store: MockDataStore): void {
  store.providers.clear();
  store.users.clear();
  store.keys.clear();
  store.messages = [];
  store.errorRules.clear();
  resetMockIdCounter();
}

// ============================================================================
// Repository Function Mocks
// ============================================================================

/**
 * Deep clone helper to prevent object mutation issues
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Create mock repository functions for providers
 */
export function createMockProviderRepository(store: MockDataStore) {
  return {
    findAll: async () => Array.from(store.providers.values()).map(deepClone),
    findById: async (id: number) => {
      const provider = store.providers.get(id);
      return provider ? deepClone(provider) : null;
    },
    findEnabled: async () =>
      Array.from(store.providers.values())
        .filter((p) => p.enabled)
        .map(deepClone),
    create: async (data: Partial<MockProvider>) => {
      const provider = createMockProvider(data);
      store.providers.set(provider.id, provider);
      return deepClone(provider);
    },
    update: async (id: number, data: Partial<MockProvider>) => {
      const existing = store.providers.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...data, updatedAt: new Date() };
      store.providers.set(id, updated);
      return deepClone(updated);
    },
    delete: async (id: number) => {
      store.providers.delete(id);
    },
  };
}

/**
 * Create mock repository functions for users
 */
export function createMockUserRepository(store: MockDataStore) {
  return {
    findAll: async () => Array.from(store.users.values()).map(deepClone),
    findById: async (id: number) => {
      const user = store.users.get(id);
      return user ? deepClone(user) : null;
    },
    findEnabled: async () =>
      Array.from(store.users.values())
        .filter((u) => u.enabled)
        .map(deepClone),
    create: async (data: Partial<MockUser>) => {
      const user = createMockUser(data);
      store.users.set(user.id, user);
      return deepClone(user);
    },
    update: async (id: number, data: Partial<MockUser>) => {
      const existing = store.users.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...data, updatedAt: new Date() };
      store.users.set(id, updated);
      return deepClone(updated);
    },
    delete: async (id: number) => {
      store.users.delete(id);
    },
  };
}

/**
 * Create mock repository functions for keys
 */
export function createMockKeyRepository(store: MockDataStore) {
  return {
    findAll: async () => Array.from(store.keys.values()).map(deepClone),
    findById: async (id: number) => {
      const key = store.keys.get(id);
      return key ? deepClone(key) : null;
    },
    findByUserId: async (userId: number) =>
      Array.from(store.keys.values())
        .filter((k) => k.userId === userId)
        .map(deepClone),
    findByHash: async (hash: string) => {
      const key = Array.from(store.keys.values()).find((k) => k.hash === hash);
      return key ? deepClone(key) : null;
    },
    create: async (data: Partial<MockKey>) => {
      const key = createMockKey(data);
      store.keys.set(key.id, key);
      return deepClone(key);
    },
    update: async (id: number, data: Partial<MockKey>) => {
      const existing = store.keys.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...data, updatedAt: new Date() };
      store.keys.set(id, updated);
      return deepClone(updated);
    },
    delete: async (id: number) => {
      store.keys.delete(id);
    },
  };
}
