/**
 * Mock for 'server-only' package in test environment
 *
 * The real 'server-only' package throws an error when imported in client components.
 * In Vitest test environment, we need to mock it to allow importing server-side code.
 *
 * This is a no-op module that does nothing, which is fine for tests.
 */

// Export empty object to satisfy any imports
export default {};
