#!/usr/bin/env bun
/**
 * Bundle Size Checker
 * Ensures the minified bundle stays under the 3KB gzipped limit
 */

import { gzipSync } from 'zlib';
import { readFileSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// =============================================================================
// Configuration
// =============================================================================

/** Size limits in KB for different builds */
const SIZE_LIMITS = {
  CORE: 3,          // Core build must be < 3KB
  FULL: 12,         // Full build with all features
  ESM: 12,          // ESM module
};

/** Files to check (relative to dist/) */
const FILES_TO_CHECK = [
  { path: 'analytics.min.js', maxSize: SIZE_LIMITS.CORE * 1024, required: true, label: 'Core (required < 3KB)' },
  { path: 'analytics.full.min.js', maxSize: SIZE_LIMITS.FULL * 1024, required: false, label: 'Full (all features)' },
  { path: 'analytics.esm.js', maxSize: SIZE_LIMITS.ESM * 1024, required: false, label: 'ESM Module' },
  { path: 'analytics.js', maxSize: SIZE_LIMITS.FULL * 1024, required: false, label: 'IIFE (unminified)' },
];

// =============================================================================
// Helpers
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distDir = join(__dirname, '..', 'dist');

/** ANSI color codes */
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// =============================================================================
// Size Check Function
// =============================================================================

interface SizeResult {
  path: string;
  label?: string;
  rawSize: number;
  gzipSize: number;
  brotliSize?: number;
  maxSize: number;
  passed: boolean;
}

function checkSize(
  filepath: string,
  maxSize: number
): SizeResult | null {
  const fullPath = join(distDir, filepath);

  // Check if file exists
  if (!existsSync(fullPath)) {
    return null;
  }

  // Read file
  const content = readFileSync(fullPath);
  const rawSize = statSync(fullPath).size;

  // Compress with gzip
  const gzipped = gzipSync(content, { level: 9 });
  const gzipSize = gzipped.length;

  const passed = gzipSize <= maxSize;

  return {
    path: filepath,
    rawSize,
    gzipSize,
    maxSize,
    passed,
  };
}

// =============================================================================
// Main
// =============================================================================

console.log('\n' + colors.cyan + '=' .repeat(60) + colors.reset);
console.log(colors.cyan + '  Bundle Size Report' + colors.reset);
console.log(colors.cyan + '=' .repeat(60) + colors.reset + '\n');

let allPassed = true;
const results: SizeResult[] = [];

for (const file of FILES_TO_CHECK) {
  const result = checkSize(file.path, file.maxSize);

  if (!result) {
    if (file.required) {
      console.log(colors.red + `  ${file.path}: NOT FOUND (required)` + colors.reset);
      allPassed = false;
    } else {
      console.log(colors.dim + `  ${file.path}: not found (optional)` + colors.reset);
    }
    continue;
  }

  // Add label to result
  result.label = (file as { label?: string }).label;
  results.push(result);

  // Only fail on required files
  if (!result.passed && file.required) {
    allPassed = false;
  }

  // Format output
  const icon = result.passed ? colors.green + '  ' : colors.red + '  ';
  const status = result.passed ? 'PASS' : 'FAIL';
  const statusColor = result.passed ? colors.green : colors.red;
  const label = result.label ? ` ${colors.dim}(${result.label})${colors.reset}` : '';

  console.log(`${icon}${result.path}${label}${colors.reset}`);
  console.log(`     Raw:     ${formatBytes(result.rawSize)}`);
  console.log(`     Gzipped: ${formatBytes(result.gzipSize)} ${colors.dim}(limit: ${formatBytes(result.maxSize)})${colors.reset}`);

  if (result.passed) {
    const savings = 1 - result.gzipSize / result.maxSize;
    console.log(`     Status:  ${statusColor}${status}${colors.reset} ${colors.dim}(${formatPercent(savings)} under limit)${colors.reset}`);
  } else {
    const excess = result.gzipSize / result.maxSize - 1;
    const warning = file.required ? '' : colors.dim + ' (optional)' + colors.reset;
    console.log(`     Status:  ${statusColor}${status}${colors.reset} ${colors.yellow}(${formatPercent(excess)} over limit)${warning}${colors.reset}`);
  }

  console.log('');
}

// Summary
console.log(colors.cyan + '-'.repeat(60) + colors.reset);

if (results.length > 0) {
  // Show compression ratios
  const minResult = results.find(r => r.path === 'analytics.min.js');
  if (minResult) {
    const compressionRatio = 1 - minResult.gzipSize / minResult.rawSize;
    console.log(`  Compression ratio: ${formatPercent(compressionRatio)} reduction`);
  }
}

console.log(colors.cyan + '-'.repeat(60) + colors.reset + '\n');

if (allPassed) {
  console.log(colors.green + '  Bundle size check PASSED!' + colors.reset);
  console.log(colors.dim + `  All required files are under their size limits.` + colors.reset);
  console.log('');
  process.exit(0);
} else {
  console.log(colors.red + '  Bundle size check FAILED!' + colors.reset);
  console.log(colors.dim + `  Some required files exceed their size limits.` + colors.reset);
  console.log('');
  console.log('  Tips to reduce bundle size:');
  console.log('  - Remove unused exports');
  console.log('  - Simplify complex functions');
  console.log('  - Use shorter variable names in hot paths');
  console.log('  - Check for duplicate code');
  console.log('');
  process.exit(1);
}
