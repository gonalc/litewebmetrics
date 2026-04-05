#!/usr/bin/env bun
/**
 * Builds all SDK bundle formats with the ANALYTICS_ENDPOINT env var
 * injected at compile time so it never appears in source control.
 *
 * Uses Bun for most builds + esbuild for the optimized full minified IIFE.
 * Requires ANALYTICS_ENDPOINT to be set (in .env or the environment).
 */

import * as esbuild from 'esbuild';

const endpoint = process.env.ANALYTICS_ENDPOINT;
if (!endpoint) {
  console.error('Error: ANALYTICS_ENDPOINT is not set. Add it to your .env file.');
  process.exit(1);
}

const define = {
  ANALYTICS_ENDPOINT: JSON.stringify(endpoint),
  __DEBUG__: 'true',
};

const prodDefine = {
  ...define,
  __DEBUG__: 'false',
};

console.log('  Building bundles...');

// Use esbuild directly for the full minified IIFE (best tree shaking + minification)
const esbuildResult = esbuild.buildSync({
  entryPoints: ['src/index.prod.ts'],
  outfile: 'dist/analytics.full.min.js',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  minify: true,
  treeShaking: true,
  legalComments: 'none',
  define: prodDefine,
  pure: ['console.log', 'console.warn', 'console.error'],
  drop: ['debugger'],
});

if (esbuildResult.errors.length > 0) {
  for (const err of esbuildResult.errors) console.error(err);
  process.exit(1);
}

// Use Bun for the remaining builds
const results = await Promise.all([
  // Core — ultra-minimal IIFE (<3KB)
  Bun.build({
    entrypoints: ['src/core.ts'],
    outdir: 'dist',
    naming: 'analytics.min.js',
    format: 'iife',
    target: 'browser',
    minify: true,
    define: prodDefine,
  }),

  // ESM (full exports for tree-shakeable consumers)
  Bun.build({
    entrypoints: ['src/index.ts'],
    outdir: 'dist',
    naming: 'analytics.esm.js',
    format: 'esm',
    target: 'browser',
    define,
  }),

  // IIFE unminified (dev)
  Bun.build({
    entrypoints: ['src/index.prod.ts'],
    outdir: 'dist',
    naming: 'analytics.js',
    format: 'iife',
    target: 'browser',
    define,
  }),
]);

let failed = false;
for (const result of results) {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    failed = true;
  }
}

if (failed) process.exit(1);

console.log('  Bundles built successfully.');
