# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Add real-time monitoring big screen dashboard with live metrics, 24h trends, provider slots status, and activity stream (#184) @ding113
- Add dark mode support with theme switcher in Dashboard and settings pages (#171) @ding113
- Add MCP (Model Context Protocol) passthrough functionality to forward tool calls to third-party AI services (#193) @ding113
- Add provider API test improvements with streaming response detection and enhanced error parsing (#199) @ding113
- Add configurable API test timeout via `API_TEST_TIMEOUT_MS` environment variable (#199) @ding113

### Changed

- Enhance data dashboard with comprehensive optimizations and improvements (#183) @ding113
- Update default provider timeout to unlimited for better compatibility (#199) @ding113
- Adjust streaming silent period timeout from 10s to 300s (#199) @ding113
- Improve usage records status code color display for better visibility (#199) @ding113
- Clarify provider response model labeling (#199) @ding113

### Fixed

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
