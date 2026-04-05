/**
 * @youranalytics/web-sdk Utility Functions
 * Performance-focused utilities with browser compatibility
 */

import type { UtmParams, NetworkInfo, ConnectionType } from './types';

// =============================================================================
// Capability Cache
// =============================================================================

/** Cache for capability checks to avoid repeated detection */
const capabilityCache: Record<string, boolean | null> = {
  beacon: null,
  fetch: null,
  compression: null,
};

// =============================================================================
// URL Parsing
// =============================================================================

/**
 * Parse query string into key-value object.
 * Uses URLSearchParams if available, falls back to manual parsing.
 *
 * @param search - Query string (with or without leading '?')
 * @returns Parsed key-value pairs
 *
 * @example
 * parseQueryString('?foo=bar&baz=qux')
 * // Returns: { foo: 'bar', baz: 'qux' }
 */
export function parseQueryString(search: string): Record<string, string> {
  if (!search || search === '?') return {};

  const queryString = search.startsWith('?') ? search.slice(1) : search;
  if (!queryString) return {};

  const params = new URLSearchParams(queryString);
  const result: Record<string, string> = {};
  params.forEach((value, key) => { result[key] = value; });
  return result;
}

/**
 * Extract UTM parameters from current URL query string.
 * Handles both standard query strings and hash-based routing.
 *
 * @returns UTM parameters found in URL
 *
 * @example
 * // URL: https://example.com?utm_source=google&utm_medium=cpc
 * getUtmParams()
 * // Returns: { source: 'google', medium: 'cpc' }
 */
export function getUtmParams(): UtmParams {
  if (typeof window === 'undefined' && typeof globalThis === 'undefined') {
    return {};
  }

  let search = '';

  try {
    // Try standard location.search first
    if (typeof window !== 'undefined' && window.location) {
      search = window.location.search;

      // Also check hash for hash-based routing (#/page?utm_source=x)
      if (!search && window.location.hash) {
        const hashQueryIndex = window.location.hash.indexOf('?');
        if (hashQueryIndex !== -1) {
          search = window.location.hash.slice(hashQueryIndex);
        }
      }
    }
  } catch {
    return {};
  }

  const params = parseQueryString(search);

  return {
    ...(params.utm_source && { source: params.utm_source }),
    ...(params.utm_medium && { medium: params.utm_medium }),
    ...(params.utm_campaign && { campaign: params.utm_campaign }),
    ...(params.utm_term && { term: params.utm_term }),
    ...(params.utm_content && { content: params.utm_content }),
  };
}

// =============================================================================
// Network Detection
// =============================================================================

/** Navigator connection interface for Network Information API */
export interface NavigatorConnection {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/** Extended navigator with connection property */
interface NavigatorWithConnection extends Navigator {
  connection?: NavigatorConnection;
  mozConnection?: NavigatorConnection;
  webkitConnection?: NavigatorConnection;
}

/**
 * Get network connection from navigator.
 */
export function getNavigatorConnection(): NavigatorConnection | null {
  if (typeof navigator === 'undefined') return null;

  const nav = navigator as NavigatorWithConnection;
  return nav.connection || nav.mozConnection || nav.webkitConnection || null;
}

/**
 * Get detailed network quality information.
 * Uses the Network Information API when available.
 *
 * @returns Network info or null if API not available
 */
export function getConnectionInfo(): NetworkInfo | null {
  const connection = getNavigatorConnection();

  if (!connection) {
    return null;
  }

  const effectiveType = connection.effectiveType as ConnectionType | undefined;

  return {
    effectiveType: effectiveType || 'unknown',
    downlink: connection.downlink,
    rtt: connection.rtt,
    saveData: connection.saveData,
  };
}

/**
 * Get simplified connection type.
 * Returns 'unknown' if Network Information API is not available.
 *
 * @returns Connection type: 'slow-2g' | '2g' | '3g' | '4g' | 'unknown'
 */
export function getConnectionType(): ConnectionType {
  const connection = getNavigatorConnection();

  if (!connection || !connection.effectiveType) {
    return 'unknown';
  }

  const type = connection.effectiveType;

  // Validate it's a known type
  if (type === 'slow-2g' || type === '2g' || type === '3g' || type === '4g') {
    return type;
  }

  return 'unknown';
}

// =============================================================================
// Bot Detection
// =============================================================================

/** Bot user agent regex — covers search engines, headless browsers, HTTP clients, and crawlers */
const BOT_RE = /bot|crawler|spider|scraper|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|exabot|facebot|ia_archiver|headless|phantom|selenium|puppeteer|playwright|webdriver|curl|wget|python-requests|python-urllib|java\/|apache-httpclient|okhttp|axios\/|lighthouse|pagespeed|gtmetrix/;

/**
 * Detect if the current user agent is a bot or crawler.
 * Used to skip tracking for automated traffic.
 */
export function isBot(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent?.toLowerCase() || '';
  if (!ua) return false;
  return BOT_RE.test(ua) || (navigator as unknown as Record<string, unknown>).webdriver === true;
}

// =============================================================================
// Performance Utilities
// =============================================================================

/**
 * Debounce function calls.
 * Delays execution until after wait milliseconds have elapsed
 * since the last time the function was invoked.
 *
 * @param func - Function to debounce
 * @param wait - Milliseconds to wait
 * @returns Debounced function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: unknown, ...args: Parameters<T>): void {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func.apply(this, args);
      timeoutId = null;
    }, wait);
  };
}

/**
 * Throttle function calls.
 * Ensures function runs at most once per specified time period.
 *
 * @param func - Function to throttle
 * @param limit - Minimum milliseconds between calls
 * @returns Throttled function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  let lastArgs: Parameters<T> | null = null;

  return function (this: unknown, ...args: Parameters<T>): void {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;

      setTimeout(() => {
        inThrottle = false;
        // Execute with last args if called during throttle
        if (lastArgs !== null) {
          func.apply(this, lastArgs);
          lastArgs = null;
        }
      }, limit);
    } else {
      // Save last args for execution after throttle period
      lastArgs = args;
    }
  };
}

// =============================================================================
// Browser Compatibility
// =============================================================================

/** Create a cached capability check */
function cachedCheck(key: string, detect: () => boolean): () => boolean {
  return () => {
    if (capabilityCache[key] !== null) return capabilityCache[key]!;
    const r = detect();
    capabilityCache[key] = r;
    return r;
  };
}

export const supportsBeacon = cachedCheck('beacon', () => typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function');
export const supportsFetch = cachedCheck('fetch', () => typeof fetch === 'function');
export const supportsCompression = cachedCheck('compression', () => typeof CompressionStream !== 'undefined');

export function resetCapabilityCache(): void {
  capabilityCache.beacon = null;
  capabilityCache.fetch = null;
  capabilityCache.compression = null;
}

// =============================================================================
// Data Validation
// =============================================================================

/** Maximum event name length */
const MAX_EVENT_NAME_LENGTH = 100;

/** Maximum string property length */
const MAX_STRING_LENGTH = 1000;

/** Maximum object depth for sanitization */
const MAX_OBJECT_DEPTH = 5;

/**
 * Sanitize event names for consistency and safety.
 * - Converts to lowercase
 * - Replaces spaces with underscores
 * - Removes special characters (keeps alphanumeric and underscore)
 * - Limits length to 100 characters
 *
 * @param name - Raw event name
 * @returns Sanitized event name
 */
export function sanitizeEventName(name: string): string {
  if (typeof name !== 'string') {
    return 'unknown_event';
  }

  if (!name.trim()) {
    return 'unknown_event';
  }

  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/[^a-z0-9_]/g, '') // Remove special characters
    .slice(0, MAX_EVENT_NAME_LENGTH); // Limit length
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value == null) return null;
  const t = typeof value;
  if (t === 'string') return (value as string).slice(0, MAX_STRING_LENGTH);
  if (t === 'number') return Number.isFinite(value) ? value : null;
  if (t === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_OBJECT_DEPTH) return '[max depth]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeValue(item, depth + 1));
  if (t === 'object') {
    try {
      const r: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).slice(0, 100)) {
        const v = (value as Record<string, unknown>)[k];
        if (v !== undefined) r[k] = sanitizeValue(v, depth + 1);
      }
      return r;
    } catch { return '[object]'; }
  }
  return null;
}

export function sanitizeProperties(props: Record<string, unknown>): Record<string, unknown> {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
  try { return sanitizeValue(props, 0) as Record<string, unknown>; } catch { return {}; }
}

// =============================================================================
// Page Context
// =============================================================================

/** Safely access a browser API value with a fallback */
function safeGet<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export function getPageUrl(): string {
  return safeGet(() => (typeof window !== 'undefined' && window.location) ? window.location.href : '', '');
}

export function getPageTitle(): string | undefined {
  return safeGet(() => (typeof document !== 'undefined' && document.title) ? document.title : undefined, undefined);
}

export function getReferrer(): string | undefined {
  return safeGet(() => (typeof document !== 'undefined' && document.referrer) ? document.referrer : undefined, undefined);
}

export function getUserAgent(): string {
  return safeGet(() => (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '', '');
}

export function getScreenDimensions(): { width: number; height: number } {
  return safeGet(() => (typeof window !== 'undefined' && window.screen)
    ? { width: window.screen.width || 0, height: window.screen.height || 0 }
    : { width: 0, height: 0 }, { width: 0, height: 0 });
}
