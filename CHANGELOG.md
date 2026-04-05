# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - 2026-04-05

### Changed
- `endpoint` is now a required configuration option (no default endpoint)
- Version is now auto-injected from package.json at build time

### Fixed
- Version string consistency across all entry points

## [0.1.2] - 2026-03-15

### Added
- Adaptive network batching based on connection quality (2G/3G/4G)
- Event priority system (high/normal/low) for adaptive flushing
- Data saver mode detection

## [0.1.1] - 2026-03-01

### Added
- Offline event queuing with automatic retry
- SPA navigation tracking (pushState, replaceState, popstate)
- Bundle size monitoring script (core target: <3KB gzipped)
- Bot detection and filtering
- UTM parameter extraction

## [0.1.0] - 2026-02-15

### Added
- Core analytics tracking (pageviews and custom events)
- Script tag auto-initialization with `data-*` attributes
- ES Module, IIFE, and minified build outputs
- sendBeacon with fetch fallback
- localStorage visitor ID persistence
- sessionStorage session management
- TypeScript types with branded IDs
