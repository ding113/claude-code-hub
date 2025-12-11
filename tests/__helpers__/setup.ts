/**
 * Global Test Setup
 *
 * This file is preloaded before all tests run (configured in bunfig.toml).
 * It sets up:
 * - Module mocks for Next.js server-only packages
 * - Environment variables for test mode
 * - MSW server lifecycle (conditionally)
 *
 * Note: This setup is automatically loaded by Bun's test runner.
 * Individual test files should import specific mocks as needed.
 *
 * IMPORTANT: This file should NOT import any project source code
 * to avoid dependency issues with server-only packages.
 */

import { mock, beforeAll, afterAll, afterEach } from "bun:test";

// ============================================================================
// Module Mocks (must be before any imports that use these modules)
// ============================================================================

// Mock server-only to allow importing server modules in tests
// This is required because server-only throws when imported outside Next.js RSC runtime
// See: https://bun.sh/docs/test/mocks#mock-module
mock.module("server-only", () => ({}));

// In-memory cookie storage for tests (used by next/headers mock)
const testCookieStore = new Map<string, string>();

// Mock next/headers to provide cookies() in test environment
// This is required because cookies() throws when called outside Next.js request scope
mock.module("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const value = testCookieStore.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      testCookieStore.set(name, value);
    },
    delete: (name: string) => {
      testCookieStore.delete(name);
    },
    has: (name: string) => testCookieStore.has(name),
    getAll: () =>
      Array.from(testCookieStore.entries()).map(([name, value]) => ({
        name,
        value,
      })),
  }),
  headers: () => ({
    get: () => null,
    has: () => false,
    entries: () => [],
    keys: () => [],
    values: () => [],
    forEach: () => {},
  }),
}));

/**
 * Set a test authentication cookie
 * Call this in beforeAll() to simulate authenticated user
 */
export function setTestAuthCookie(token: string) {
  testCookieStore.set("auth-token", token);
}

/**
 * Clear all test cookies
 * Call this in afterAll() to clean up test state
 */
export function clearTestCookies() {
  testCookieStore.clear();
}

// ============================================================================
// Environment Setup
// ============================================================================

// Ensure we're in test mode
process.env.NODE_ENV = "test";

// Disable rate limiting by default in tests
process.env.ENABLE_RATE_LIMIT = "false";

// Use mock Redis URL to signal test mode
process.env.REDIS_URL = "mock://localhost:6379";

// Disable circuit breaker network errors in tests
process.env.ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS = "false";

// Set default ADMIN_TOKEN for tests (can be overridden by test files)
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || "test-admin-token";

// ============================================================================
// MSW Server Lifecycle (Lazy Initialization)
// ============================================================================

// MSW server is initialized lazily to avoid importing it when not needed
let mswServer: ReturnType<typeof import("msw/node").setupServer> | null = null;
let mswInitialized = false;

/**
 * Initialize MSW server if not already done
 * This is called by test files that need HTTP mocking
 */
export async function initializeMswServer() {
  if (mswInitialized) return mswServer;

  try {
    const { server } = await import("../__mocks__/providers.mock");
    mswServer = server;
    mswServer.listen({ onUnhandledRequest: "warn" });
    mswInitialized = true;

    if (process.env.DEBUG_TESTS === "true") {
      console.log("[Test Setup] MSW server started");
    }

    return mswServer;
  } catch (error) {
    // Provide detailed error information for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";

    console.error("[Test Setup] MSW server initialization failed:");
    console.error(`  Error: ${errorMessage}`);
    if (errorStack) {
      console.error(`  Stack: ${errorStack}`);
    }

    // In CI environment, fail fast instead of silently continuing
    if (process.env.CI === "true") {
      throw new Error(`MSW initialization failed in CI environment: ${errorMessage}`);
    }

    console.warn("[Test Setup] Continuing without MSW - HTTP requests will hit real network!");
    return null;
  }
}

/**
 * Reset MSW handlers to defaults
 */
export function resetMswHandlers() {
  if (mswServer) {
    mswServer.resetHandlers();
  }
}

/**
 * Close MSW server
 */
export function closeMswServer() {
  if (mswServer) {
    mswServer.close();
    mswInitialized = false;
    mswServer = null;

    if (process.env.DEBUG_TESTS === "true") {
      console.log("[Test Setup] MSW server closed");
    }
  }
}

// ============================================================================
// Global Hooks (Optional - only for tests that need them)
// ============================================================================

// Note: These hooks only affect tests that use MSW
// Tests that don't need HTTP mocking can ignore these

beforeAll(async () => {
  // MSW is initialized lazily, not automatically
  // Test files that need it should call initializeMswServer()
});

afterEach(() => {
  // Reset MSW handlers if server is active
  resetMswHandlers();
});

afterAll(() => {
  // Close MSW server if it was initialized
  closeMswServer();
});
