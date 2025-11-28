# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Add real-time monitoring big screen dashboard with live metrics, 24h trends, provider slots status, and activity stream (#184) @ding113
- Add dark mode support with theme switcher in Dashboard and settings pages (#171) @ding113
- Add MCP (Model Context Protocol) passthrough functionality to forward tool calls to third-party AI services (#193) @ding113

### Changed

- Enhance data dashboard with comprehensive optimizations and improvements (#183) @ding113

### Fixed

- Fix API action adapter to pass schema params as positional args instead of object (#232) @ding113
- Fix availability monitoring Invalid Date error when selecting 15-minute time range (#231) @ding113
- Fix database migration duplicate enum type creation error (#181) @ding113
- Fix error handling and status codes in response handler, improve user management page UX (#179) @ding113
- Fix infinite loop in leaderboard tab switching (#178) @ding113
- Fix CI failures: Prettier formatting and React Hooks ESLint error in theme-switcher (#173) @ding113
