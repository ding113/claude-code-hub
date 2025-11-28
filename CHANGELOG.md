# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Add error response override feature allowing custom response body and status code configuration for error rules (#234) @ding113
- Add Overlay and Stacked display modes for dashboard statistics charts (#234) @ding113
- Add provider availability monitoring dashboard with real-time health status, metrics, and heatmap visualization (#216) @ding113
- Add smart circuit breaker probing for faster provider recovery with configurable intervals (#216) @ding113
- Add enhanced provider testing with three-layer validation and preset templates for relay service verification (#216) @ding113
- Add real-time monitoring big screen dashboard with live metrics, 24h trends, provider slots status, and activity stream (#184) @ding113
- Add dark mode support with theme switcher in Dashboard and settings pages (#171) @ding113
- Add MCP (Model Context Protocol) passthrough functionality to forward tool calls to third-party AI services (#193) @ding113
- Add provider API test improvements with streaming response detection and enhanced error parsing (#199) @ding113
- Add configurable API test timeout via `API_TEST_TIMEOUT_MS` environment variable (#199) @ding113

### Changed

- Improve drizzle.config.ts to follow Next.js env file priority order (#234) @ding113
- Optimize navigation translations across all locales (en, ja, ru, zh-CN, zh-TW) (#234) @ding113
- Improve `prompt_limit` error rule regex pattern matching (#234) @ding113
- Improve provider page performance by fixing N+1 queries and SQL full table scans (#216) @ding113
- Enhance error parsing with nested error structure support for relay services (#216) @ding113
- Adjust streaming idle timeout range from 1-120s to 60-600s (0 to disable) (#216) @ding113
- Add provider-specific User-Agent headers to avoid Cloudflare detection (#210) @ding113
- Increase provider dialog width to prevent horizontal scrollbar on long model redirect names (#210) @ding113
- Enhance data dashboard with comprehensive optimizations and improvements (#183) @ding113
- Update default provider timeout to unlimited for better compatibility (#199) @ding113
- Adjust streaming silent period timeout from 10s to 300s (#199) @ding113
- Improve usage records status code color display for better visibility (#199) @ding113
- Clarify provider response model labeling (#199) @ding113

### Fixed

- Fix API action adapter to pass schema params as positional args instead of object (#232) @ding113
- Fix availability monitoring Invalid Date error when selecting 15-minute time range (#231) @ding113
- Fix database migration duplicate enum type creation error (#181) @ding113
- Fix error handling and status codes in response handler, improve user management page UX (#179) @ding113
- Fix infinite loop in leaderboard tab switching (#178) @ding113
- Fix CI failures: Prettier formatting and React Hooks ESLint error in theme-switcher (#173) @ding113
- Fix Gemini model redirect not working correctly (#199) @ding113
- Fix model redirect info not being saved to database (#199) @ding113
- Fix provider multi-tag matching issue (#199) @ding113
- Fix error rules regex matching and cache refresh issues (#199) @ding113
- Fix proxy fallback "Body has already been read" error (#199) @ding113
- Fix ErrorRuleDetector lazy initialization race condition (#199) @ding113
- Fix Anthropic API test sending duplicate auth headers (#199) @ding113
- Fix Codex API test request body format (#199) @ding113
- Fix Pino logger timestamp configuration placement (#199) @ding113
- Fix data import cross-version compatibility and error prompts (#199) @ding113
