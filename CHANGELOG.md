# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Add per-provider client real IP forwarding control (#20)
  - New `forwardClientRealIp` toggle in provider settings under "Privacy & Security Configuration"
  - Controls whether to forward client IP headers (x-forwarded-for, x-real-ip, cf-connecting-ip, etc.)
  - Supports 22 IP-related headers including Cloudflare, Azure, Akamai
  - Default: disabled (privacy protection)
  - UI includes warning icon and privacy notice
- Add real-time monitoring big screen dashboard with live metrics, 24h trends, provider slots status, and activity stream (#184) @ding113
- Add dark mode support with theme switcher in Dashboard and settings pages (#171) @ding113
- Add MCP (Model Context Protocol) passthrough functionality to forward tool calls to third-party AI services (#193) @ding113

### Changed

- Enhance data dashboard with comprehensive optimizations and improvements (#183) @ding113

### Fixed

- Fix database migration duplicate enum type creation error (#181) @ding113
- Fix error handling and status codes in response handler, improve user management page UX (#179) @ding113
- Fix infinite loop in leaderboard tab switching (#178) @ding113
- Fix CI failures: Prettier formatting and React Hooks ESLint error in theme-switcher (#173) @ding113
