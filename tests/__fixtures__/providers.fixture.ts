/**
 * Test Fixtures - Providers
 *
 * Pre-defined provider configurations for testing various scenarios:
 * - Single provider setups
 * - Multi-provider setups with different weights/priorities
 * - Error scenarios (disabled, rate limited, etc.)
 */

import { createMockProvider, type MockProvider } from "../__mocks__/database.mock";

// ============================================================================
// Single Provider Fixtures
// ============================================================================

/**
 * Basic Claude provider for simple tests
 */
export const basicClaudeProvider: MockProvider = createMockProvider({
  id: 1,
  name: "Basic Claude",
  type: "claude",
  url: "https://api.anthropic.com",
  apiKey: "sk-ant-test-basic",
  enabled: true,
  weight: 100,
  priority: 1,
});

/**
 * Basic Codex provider
 */
export const basicCodexProvider: MockProvider = createMockProvider({
  id: 2,
  name: "Basic Codex",
  type: "codex",
  url: "https://api.openai.com",
  apiKey: "sk-codex-test-basic",
  enabled: true,
  weight: 100,
  priority: 1,
});

/**
 * OpenAI compatible provider
 */
export const openAICompatibleProvider: MockProvider = createMockProvider({
  id: 3,
  name: "OpenAI Compatible",
  type: "openai-compatible",
  url: "https://custom-api.example.com",
  apiKey: "sk-custom-test",
  enabled: true,
  weight: 100,
  priority: 1,
});

// ============================================================================
// Multi-Provider Fixtures (Weight-based)
// ============================================================================

/**
 * Three providers with different weights for load balancing tests
 * Total weight: 100 (70 + 20 + 10)
 */
export const weightedProviders: MockProvider[] = [
  createMockProvider({
    id: 10,
    name: "High Weight Provider",
    type: "claude",
    weight: 70,
    priority: 1,
  }),
  createMockProvider({
    id: 11,
    name: "Medium Weight Provider",
    type: "claude",
    weight: 20,
    priority: 1,
  }),
  createMockProvider({
    id: 12,
    name: "Low Weight Provider",
    type: "claude",
    weight: 10,
    priority: 1,
  }),
];

// ============================================================================
// Multi-Provider Fixtures (Priority-based)
// ============================================================================

/**
 * Providers with different priorities for failover tests
 * Lower priority number = higher priority (selected first)
 */
export const priorityProviders: MockProvider[] = [
  createMockProvider({
    id: 20,
    name: "Primary Provider (P1)",
    type: "claude",
    weight: 100,
    priority: 1, // Highest priority
  }),
  createMockProvider({
    id: 21,
    name: "Secondary Provider (P2)",
    type: "claude",
    weight: 100,
    priority: 2, // Fallback
  }),
  createMockProvider({
    id: 22,
    name: "Tertiary Provider (P3)",
    type: "claude",
    weight: 100,
    priority: 3, // Last resort
  }),
];

// ============================================================================
// Error Scenario Fixtures
// ============================================================================

/**
 * Disabled provider (should be skipped)
 */
export const disabledProvider: MockProvider = createMockProvider({
  id: 30,
  name: "Disabled Provider",
  type: "claude",
  enabled: false,
  weight: 100,
  priority: 1,
});

/**
 * Provider with rate limiting
 */
export const rateLimitedProvider: MockProvider = createMockProvider({
  id: 31,
  name: "Rate Limited Provider",
  type: "claude",
  enabled: true,
  weight: 100,
  priority: 1,
  rpmLimit: 10, // Low RPM limit for testing
});

/**
 * Provider with max concurrent requests limit
 */
export const concurrencyLimitedProvider: MockProvider = createMockProvider({
  id: 32,
  name: "Concurrency Limited Provider",
  type: "claude",
  enabled: true,
  weight: 100,
  priority: 1,
  maxConcurrentRequests: 5,
});

// ============================================================================
// Proxy Configuration Fixtures
// ============================================================================

/**
 * Provider with HTTP proxy configured
 */
export const proxyProvider: MockProvider = createMockProvider({
  id: 40,
  name: "Proxied Provider",
  type: "claude",
  enabled: true,
  weight: 100,
  priority: 1,
  proxyUrl: "http://proxy.example.com:8080",
  proxyFallbackToDirect: false,
});

/**
 * Provider with proxy and fallback enabled
 */
export const proxyWithFallbackProvider: MockProvider = createMockProvider({
  id: 41,
  name: "Proxy with Fallback",
  type: "claude",
  enabled: true,
  weight: 100,
  priority: 1,
  proxyUrl: "http://proxy.example.com:8080",
  proxyFallbackToDirect: true,
});

/**
 * Provider with SOCKS proxy
 */
export const socksProxyProvider: MockProvider = createMockProvider({
  id: 42,
  name: "SOCKS Proxy Provider",
  type: "claude",
  enabled: true,
  weight: 100,
  priority: 1,
  proxyUrl: "socks5://proxy.example.com:1080",
});

// ============================================================================
// Model Redirect Fixtures
// ============================================================================

/**
 * Provider with model redirects configured
 */
export const modelRedirectProvider: MockProvider = createMockProvider({
  id: 50,
  name: "Model Redirect Provider",
  type: "claude",
  enabled: true,
  weight: 100,
  priority: 1,
  modelRedirects: {
    "claude-opus-4": "claude-opus-4-20250514",
    "claude-sonnet-4": "claude-sonnet-4-20250514",
  },
});

// ============================================================================
// Cost Configuration Fixtures
// ============================================================================

/**
 * Provider with high cost multiplier
 */
export const highCostProvider: MockProvider = createMockProvider({
  id: 60,
  name: "High Cost Provider",
  type: "claude",
  enabled: true,
  weight: 100,
  priority: 1,
  costMultiplier: "1.5",
});

/**
 * Provider with low cost multiplier (discount)
 */
export const discountProvider: MockProvider = createMockProvider({
  id: 61,
  name: "Discount Provider",
  type: "claude",
  enabled: true,
  weight: 100,
  priority: 1,
  costMultiplier: "0.8",
});

// ============================================================================
// Complex Scenario Fixtures
// ============================================================================

/**
 * Mix of providers for complex routing tests
 * Includes: enabled/disabled, different types, different priorities
 */
export const mixedProviders: MockProvider[] = [
  createMockProvider({
    id: 70,
    name: "Primary Claude",
    type: "claude",
    enabled: true,
    weight: 60,
    priority: 1,
  }),
  createMockProvider({
    id: 71,
    name: "Secondary Claude",
    type: "claude",
    enabled: true,
    weight: 40,
    priority: 1,
  }),
  createMockProvider({
    id: 72,
    name: "Backup Codex",
    type: "codex",
    enabled: true,
    weight: 100,
    priority: 2,
  }),
  createMockProvider({
    id: 73,
    name: "Disabled Provider",
    type: "claude",
    enabled: false,
    weight: 100,
    priority: 1,
  }),
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all enabled providers from a list
 */
export function getEnabledProviders(providers: MockProvider[]): MockProvider[] {
  return providers.filter((p) => p.enabled);
}

/**
 * Get providers by type
 */
export function getProvidersByType(
  providers: MockProvider[],
  type: MockProvider["type"]
): MockProvider[] {
  return providers.filter((p) => p.type === type);
}

/**
 * Get providers by priority
 */
export function getProvidersByPriority(
  providers: MockProvider[],
  priority: number
): MockProvider[] {
  return providers.filter((p) => p.priority === priority);
}
