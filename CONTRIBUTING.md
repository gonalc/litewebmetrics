# Contributing

Thanks for your interest in contributing to `litewebmetrics`.

## Prerequisites

- [Bun](https://bun.sh/) v1.0 or later

## Setup

```bash
git clone https://github.com/gonalc/litewebmetrics.git
cd analyzer/sdks/web-analytics
bun install
```

## Development

```bash
bun run dev        # Watch mode
bun run build      # Full build (clean + compile + size check)
bun test           # Run tests
bun test:watch     # Tests in watch mode
bun run lint       # TypeScript type checking
```

## Bundle Size

The core build (`analytics.min.js`) must stay under **3KB gzipped**. Run `bun run size-check` to verify before submitting a PR.

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure `bun run build` and `bun test` pass
4. Open a pull request with a clear description of the change

## Architecture

- `src/core.ts` — Self-contained minimal build (IIFE, <3KB)
- `src/index.ts` — Full-featured entry point (ESM + IIFE)
- `src/slim.ts` — Middle-ground build
- `src/analytics.ts` — Core `Analytics` class used by index and slim
- `src/types.ts` — Shared types and defaults
- `src/version.ts` — Auto-generated version (do not edit manually)

## Reporting Issues

Use [GitHub Issues](https://github.com/gonalc/litewebmetrics/issues). For bugs, include:

- Browser and OS
- SDK version (`analytics.version`)
- Steps to reproduce
