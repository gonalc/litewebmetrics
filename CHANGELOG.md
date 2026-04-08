# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2026-04-08

### Added
- Cloudflare Workers deployment support via Wrangler (`wrangler.example.jsonc`)
- Versioned bundle copies in `dist/v{version}/` for immutable CDN caching
- `public/_headers` with Cache-Control rules: 1-year immutable for versioned paths, 5-minute TTL for root
- `deploy` npm script (`bun run build && wrangler deploy`)

### Changed
- CDN URL in README updated to `sdk.litewebmetrics.com/v{version}/analytics.min.js`
- `data-endpoint` attribute removed from script tag example (endpoint now configured server-side)

## [0.0.1] - 2026-04-05

### Added
- Core analytics engine with pageview and custom event tracking (`src/analytics.ts`, `src/core.ts`)
- Network layer with `sendBeacon` and `fetch` fallback, adaptive batching based on connection quality (`src/network.ts`, `src/network-adapter.ts`)
- Offline event queuing with automatic retry on reconnect
- SPA navigation tracking via `pushState`, `replaceState`, and `popstate`
- localStorage-based visitor ID persistence and sessionStorage session management (`src/storage.ts`)
- UTM parameter extraction and bot detection/filtering
- TypeScript types with branded IDs (`src/types.ts`)
- Utility functions including data saver mode detection (`src/utils.ts`)
- Multiple build outputs: ESM, IIFE, and minified bundles (`src/index.ts`, `src/slim.ts`, `src/index.prod.ts`)
- Script tag auto-initialization via `data-*` attributes
- Build scripts: bundle builder, version injector, and bundle size checker (target: <3KB gzipped)
- Full test suite with coverage for all modules
