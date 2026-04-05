/**
 * @youranalytics/web-sdk Network Communication Layer
 * Handles sending events to the analytics server with fallbacks and offline support
 */

// Injected at build time
declare const __DEBUG__: boolean;

import type { EventBatch, RawEvent } from './types';
import { supportsBeacon, supportsFetch, supportsCompression } from './utils';

// =============================================================================
// Constants
// =============================================================================

/** localStorage key for offline event queue */
const OFFLINE_QUEUE_KEY = '_analytics_offline_queue';

/** sessionStorage key for sent request IDs */
const SENT_REQUESTS_KEY = '_analytics_sent_requests';

/** Maximum events to store offline (prevent quota issues) */
const MAX_OFFLINE_EVENTS = 100;

/** Maximum request IDs to track for deduplication */
const MAX_TRACKED_REQUESTS = 100;

/** Maximum payload size for sendBeacon (64KB) */
const MAX_BEACON_PAYLOAD = 64 * 1024;

/** Base delay for exponential backoff (ms) */
const BASE_RETRY_DELAY = 1000;

// =============================================================================
// Debug Logger
// =============================================================================

/** Debug mode flag - can be set externally */
let debugMode = false;

/**
 * Enable or disable debug logging.
 * @param enabled - Whether to enable debug mode
 */
export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

function debugLog(message: string, ...args: unknown[]): void {
  if (__DEBUG__ && debugMode) console.log(`[Analytics Network] ${message}`, ...args);
}

function logError(message: string, error?: unknown): void {
  if (__DEBUG__ && debugMode) console.error(`[Analytics Network] ${message}`, error);
}

// =============================================================================
// NetworkError Class
// =============================================================================

/**
 * Custom error class for network-related errors.
 * Includes status code and retry information.
 */
export class NetworkError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retry?: boolean
  ) {
    super(message);
    this.name = 'NetworkError';

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NetworkError);
    }
  }
}

// =============================================================================
// Primary Transport: sendBeacon
// =============================================================================

/** Send data using navigator.sendBeacon (non-blocking, survives page unload). */
export function sendBeacon(url: string, data: EventBatch): boolean {
  try {
    if (!supportsBeacon()) return false;
    const payload = JSON.stringify(data);
    if (payload.length > MAX_BEACON_PAYLOAD) return false;
    return navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
  } catch {
    return false;
  }
}

// =============================================================================
// Fallback Transport: fetch
// =============================================================================

/** Send data using fetch API with optional Authorization header. */
export async function sendFetch(url: string, data: EventBatch, apiKey?: string): Promise<void> {
  if (!supportsFetch()) throw new NetworkError('Fetch API not available', undefined, false);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data), keepalive: true, credentials: 'omit' });
    if (!response.ok) {
      throw new NetworkError(`HTTP error: ${response.status} ${response.statusText}`, response.status, response.status >= 500 || response.status === 429);
    }
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    throw new NetworkError(error instanceof Error ? error.message : 'Network request failed', undefined, true);
  }
}

// =============================================================================
// Retry Logic with Exponential Backoff
// =============================================================================

/**
 * Wait for specified milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Send with exponential backoff retry (1s, 2s, 4s). */
export async function sendWithRetry(url: string, data: EventBatch, maxRetries = 3, apiKey?: string): Promise<void> {
  let lastError: NetworkError | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await sendFetch(url, data, apiKey);
      return;
    } catch (error) {
      lastError = error instanceof NetworkError ? error : new NetworkError('Unknown error', undefined, true);
      if (!lastError.retry || attempt >= maxRetries) break;
      await delay(BASE_RETRY_DELAY * Math.pow(2, attempt));
    }
  }
  throw lastError || new NetworkError('All retries failed', undefined, false);
}

// =============================================================================
// Compression (optional, for slow networks)
// =============================================================================

/** Compress JSON payload using GZIP via CompressionStream. */
export async function compressData(data: string): Promise<Blob | string> {
  if (!supportsCompression()) return data;
  try {
    const blob = new Blob([data], { type: 'application/json' });
    return await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  } catch {
    return data;
  }
}

/** Send compressed data using fetch. Falls back to uncompressed. */
export async function sendCompressed(url: string, data: EventBatch, apiKey?: string): Promise<void> {
  if (!supportsFetch()) throw new NetworkError('Fetch API not available', undefined, false);
  try {
    const compressed = await compressData(JSON.stringify(data));
    const isCompressed = compressed instanceof Blob;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (isCompressed) headers['Content-Encoding'] = 'gzip';
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(url, { method: 'POST', headers, body: compressed, keepalive: true, credentials: 'omit' });
    if (!response.ok) {
      throw new NetworkError(`HTTP error: ${response.status}`, response.status, response.status >= 500 || response.status === 429);
    }
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    throw new NetworkError(error instanceof Error ? error.message : 'Compressed send failed', undefined, true);
  }
}

// =============================================================================
// Offline Queue Management
// =============================================================================

/** Store events in localStorage when offline. */
export function queueOfflineEvents(events: RawEvent[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const combined = [...getOfflineEvents(), ...events];
    const limited = combined.length > MAX_OFFLINE_EVENTS ? combined.slice(-MAX_OFFLINE_EVENTS) : combined;
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(limited));
  } catch { /* ignore */ }
}

/** Retrieve queued offline events from localStorage. */
export function getOfflineEvents(): RawEvent[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) { clearOfflineEvents(); return []; }
    return parsed as RawEvent[];
  } catch { return []; }
}

/** Clear offline queue. */
export function clearOfflineEvents(): void {
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(OFFLINE_QUEUE_KEY); } catch { /* ignore */ }
}

/** Check if browser is currently offline. */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Register callback for when browser comes back online. Returns cleanup function. */
export function onOnline(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('online', callback);
  return () => window.removeEventListener('online', callback);
}

// =============================================================================
// Request Deduplication
// =============================================================================

/**
 * Generate unique request ID.
 * Format: timestamp_random
 * Used to prevent duplicate sends.
 *
 * @returns Unique request ID
 */
export function generateRequestId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}_${random}`;
}

/**
 * Get the list of sent request IDs from sessionStorage.
 */
function getSentRequestIds(): string[] {
  try {
    if (typeof sessionStorage === 'undefined') {
      return [];
    }

    const stored = sessionStorage.getItem(SENT_REQUESTS_KEY);

    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch {
    return [];
  }
}

/**
 * Save sent request IDs to sessionStorage.
 */
function saveSentRequestIds(ids: string[]): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SENT_REQUESTS_KEY, JSON.stringify(ids));
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Check if request was already sent.
 * Checks sent IDs in sessionStorage.
 *
 * @param requestId - Request ID to check
 * @returns true if request was already sent
 */
export function wasRequestSent(requestId: string): boolean {
  const sentIds = getSentRequestIds();
  return sentIds.includes(requestId);
}

/**
 * Mark request as sent.
 * Stores in sessionStorage. Keeps last MAX_TRACKED_REQUESTS IDs.
 *
 * @param requestId - Request ID to mark as sent
 */
export function markRequestSent(requestId: string): void {
  try {
    const sentIds = getSentRequestIds();

    // Add new ID
    sentIds.push(requestId);

    // Keep only the last N IDs
    const limited =
      sentIds.length > MAX_TRACKED_REQUESTS
        ? sentIds.slice(-MAX_TRACKED_REQUESTS)
        : sentIds;

    saveSentRequestIds(limited);

    debugLog('Marked request as sent:', requestId);
  } catch (error) {
    logError('Failed to mark request as sent:', error);
  }
}

/**
 * Clear all tracked request IDs.
 * Useful for testing.
 */
export function clearSentRequests(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SENT_REQUESTS_KEY);
    }
  } catch {
    // Ignore
  }
}

// =============================================================================
// High-Level Send Function
// =============================================================================

/**
 * Send events to the server using the best available method.
 * Handles offline state, deduplication, and fallbacks.
 *
 * @param url - Endpoint URL
 * @param data - Event batch to send
 * @param options - Send options
 * @returns Promise that resolves when sent (or queued if offline)
 */
export async function send(
  url: string,
  data: EventBatch,
  options: {
    useBeacon?: boolean;
    compress?: boolean;
    retry?: boolean;
    requestId?: string;
    apiKey?: string;
  } = {}
): Promise<void> {
  const {
    useBeacon = true,
    compress = false,
    retry = true,
    requestId,
    apiKey,
  } = options;

  // Check for duplicate request
  if (requestId && wasRequestSent(requestId)) {
    debugLog('Skipping duplicate request:', requestId);
    return;
  }

  // Check offline state
  if (isOffline()) {
    debugLog('Offline, queuing events');
    queueOfflineEvents(data.events as RawEvent[]);
    return;
  }

  try {
    // Try sendBeacon first (non-blocking, survives page unload)
    // Note: sendBeacon can't send custom headers, but server accepts api_key in body
    if (useBeacon && sendBeacon(url, data)) {
      if (requestId) {
        markRequestSent(requestId);
      }
      return;
    }

    // Fall back to fetch with Authorization header
    if (compress) {
      await sendCompressed(url, data, apiKey);
    } else if (retry) {
      await sendWithRetry(url, data, 3, apiKey);
    } else {
      await sendFetch(url, data, apiKey);
    }

    if (requestId) {
      markRequestSent(requestId);
    }
  } catch (error) {
    logError('Send failed:', error);

    // Queue events for offline retry if it's a network error
    if (error instanceof NetworkError && error.retry) {
      queueOfflineEvents(data.events as RawEvent[]);
    }

    // Don't throw to user code - just log
  }
}

// =============================================================================
// Exports for testing
// =============================================================================

export const _testing = {
  OFFLINE_QUEUE_KEY,
  SENT_REQUESTS_KEY,
  MAX_OFFLINE_EVENTS,
  MAX_TRACKED_REQUESTS,
  MAX_BEACON_PAYLOAD,
  BASE_RETRY_DELAY,
};
