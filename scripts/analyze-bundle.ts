#!/usr/bin/env bun
/**
 * Bundle litewebmetrics
 * Provides detailed breakdown of what's in the bundle
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';

// =============================================================================
// Configuration
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
  bold: '\x1b[1m',
};

// =============================================================================
// Helpers
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function bar(percent: number, width = 30): string {
  const filled = Math.round(percent * width);
  const empty = width - filled;
  return colors.green + ''.repeat(filled) + colors.dim + ''.repeat(empty) + colors.reset;
}

// =============================================================================
// Analysis Functions
// =============================================================================

interface CodeSection {
  name: string;
  pattern: RegExp;
  description: string;
}

const CODE_SECTIONS: CodeSection[] = [
  { name: 'Analytics Class', pattern: /class\s+Analytics|Analytics\s*=\s*class/g, description: 'Core Analytics class' },
  { name: 'NetworkAdapter', pattern: /NetworkAdapter|sendAdaptive|RetryStrategy/g, description: 'Adaptive network handling' },
  { name: 'Storage', pattern: /localStorage|sessionStorage|getVisitorId|getSessionId/g, description: 'Browser storage' },
  { name: 'Event Handling', pattern: /addEventListener|removeEventListener|beforeunload/g, description: 'DOM events' },
  { name: 'Network/Fetch', pattern: /sendBeacon|fetch\s*\(|XMLHttpRequest/g, description: 'HTTP requests' },
  { name: 'Compression', pattern: /CompressionStream|gzip|compress/g, description: 'Data compression' },
  { name: 'Utility Functions', pattern: /debounce|throttle|sanitize|isBot/g, description: 'Helper utilities' },
  { name: 'Type Guards', pattern: /isValid\w+|typeof\s+\w+\s*[!=]==?\s*['"](?:string|number|object|undefined)/g, description: 'Runtime validation' },
];

function analyzeContent(content: string): void {
  console.log('\n' + colors.bold + 'Code Section Analysis:' + colors.reset + '\n');

  for (const section of CODE_SECTIONS) {
    const matches = content.match(section.pattern);
    const count = matches?.length ?? 0;

    if (count > 0) {
      console.log(`  ${colors.cyan}${section.name}${colors.reset}`);
      console.log(`     ${colors.dim}${section.description}${colors.reset}`);
      console.log(`     References: ${count}`);
      console.log('');
    }
  }
}

function analyzeStrings(content: string): void {
  console.log(colors.bold + 'String Literals Analysis:' + colors.reset + '\n');

  // Find all string literals
  const stringPattern = /(['"`])(?:(?!\1)[^\\]|\\.)*\1/g;
  const strings = content.match(stringPattern) || [];

  // Group by length
  const short = strings.filter(s => s.length <= 10);
  const medium = strings.filter(s => s.length > 10 && s.length <= 50);
  const long = strings.filter(s => s.length > 50);

  console.log(`  Short strings (≤10 chars):   ${short.length}`);
  console.log(`  Medium strings (11-50 chars): ${medium.length}`);
  console.log(`  Long strings (>50 chars):     ${long.length}`);

  if (long.length > 0) {
    console.log('\n  ' + colors.yellow + 'Longest strings (potential optimization targets):' + colors.reset);
    const sorted = long.sort((a, b) => b.length - a.length).slice(0, 5);
    for (const str of sorted) {
      const truncated = str.length > 60 ? str.slice(0, 57) + '...' : str;
      console.log(`     ${truncated} ${colors.dim}(${str.length} chars)${colors.reset}`);
    }
  }

  console.log('');
}

function analyzeSize(filepath: string): void {
  const content = readFileSync(filepath, 'utf-8');
  const rawSize = content.length;
  const gzipSize = gzipSync(content, { level: 9 }).length;

  console.log(colors.bold + 'Size Breakdown:' + colors.reset + '\n');

  // Estimate section sizes by counting characters
  const sections = [
    { name: 'Functions', pattern: /function\s+\w+|=>\s*\{|=>\s*[^{]/g },
    { name: 'Classes', pattern: /class\s+\w+/g },
    { name: 'Variables', pattern: /(?:const|let|var)\s+\w+/g },
    { name: 'Comments', pattern: /\/\*[\s\S]*?\*\/|\/\/.*/g },
  ];

  for (const section of sections) {
    const matches = content.match(section.pattern) || [];
    const percent = matches.length / 100; // Rough estimate

    console.log(`  ${section.name.padEnd(15)} ${matches.length.toString().padStart(4)} occurrences`);
  }

  console.log('');
  console.log(colors.bold + 'Compression:' + colors.reset + '\n');
  console.log(`  Raw size:     ${formatBytes(rawSize)}`);
  console.log(`  Gzipped:      ${formatBytes(gzipSize)}`);
  console.log(`  Ratio:        ${((1 - gzipSize / rawSize) * 100).toFixed(1)}% reduction`);
  console.log('');
}

// =============================================================================
// Main
// =============================================================================

const minFile = join(distDir, 'analytics.min.js');

console.log('\n' + colors.cyan + '=' .repeat(60) + colors.reset);
console.log(colors.cyan + '  Bundle Analysis' + colors.reset);
console.log(colors.cyan + '=' .repeat(60) + colors.reset);

if (!existsSync(minFile)) {
  console.log(colors.red + '\n  Error: analytics.min.js not found.' + colors.reset);
  console.log(colors.dim + '  Run `bun run build:min` first.\n' + colors.reset);
  process.exit(1);
}

const content = readFileSync(minFile, 'utf-8');

analyzeSize(minFile);
analyzeContent(content);
analyzeStrings(content);

console.log(colors.cyan + '=' .repeat(60) + colors.reset + '\n');
