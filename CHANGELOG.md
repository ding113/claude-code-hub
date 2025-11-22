# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Add real-time monitoring big screen dashboard with live metrics, 24h trends, provider slots status, and activity stream (#184) @ding113
- Add dark mode support with theme switcher in Dashboard and settings pages (#171) @ding113
- Add dark mode support to provider quota management page (#170) @ding113

### Changed

- Merge dev to main with internationalization improvements (Japanese, Russian, Traditional Chinese) and UI enhancements for daily limit dialogs (#182) @ding113
- Refactor provider quota management page from card layout to compact list layout with circular progress indicators, search, and sorting capabilities (#170) @ding113

### Changed

- Enhance data dashboard with comprehensive optimizations and improvements (#183) @ding113

### Fixed

- Fix database migration duplicate enum type creation error (#181) @ding113
- Fix error handling and status codes in response handler, improve user management page UX (#179) @ding113
- Fix infinite loop in leaderboard tab switching (#178) @ding113
- Fix CI failures: Prettier formatting and React Hooks ESLint error in theme-switcher (#173) @ding113
